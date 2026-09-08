const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const { readFileSync, readdirSync, statSync, mkdirSync } = require('node:fs')
const { once } = require('node:events')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

async function withHost(port, redirectPort, action) {
  let logs = ''
  const host = spawn(path.resolve('src/server/Host/bin/Release/net10.0/ConfigHub.Host.exe'),
    ['--urls', `http://127.0.0.1:${port}`, ...(redirectPort ? ['--HttpsRedirection:HttpsPort', String(redirectPort)] : [])],
    { cwd: path.resolve('src/server/Host'), windowsHide: true })
  host.stdout.on('data', data => { logs += data })
  host.stderr.on('data', data => { logs += data })
  try {
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (host.exitCode !== null) throw new Error('Test Host exited: ' + logs)
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health/live`, { redirect: 'manual' })
        if (response.status === (redirectPort ? 307 : 200)) { ready = true; break }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert(ready, 'Host failed to become ready: ' + logs)
    await action(`http://127.0.0.1:${port}`)
    assert(!/HttpsRedirectionMiddleware\[3\]|Query\[20504\]|fail:/i.test(logs), logs)
  } finally {
    if (host.exitCode === null) { const exited = once(host, 'exit'); host.kill(); await exited }
  }
}

async function main() {
  for (const file of readdirSync('src/server/Host/wwwroot/assets').filter(file => file.endsWith('.js'))) {
    assert(statSync('src/server/Host/wwwroot/assets/' + file).size < 500000, file + ' exceeds chunk budget')
  }
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  await withHost(5098, null, async baseURL => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true })
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } })
    const post = async (url, data) => {
      const response = await context.request.post(url, { data, headers: { 'Idempotency-Key': randomUUID() } })
      assert(response.ok(), url + ': ' + await response.text())
      return response.status() === 204 ? null : response.json()
    }
    let project
    let page
    try {
      await post('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
      project = await post('/api/v1/projects', { code: 'IMPORT-' + randomUUID().slice(0, 8), name: '表格导入验收', reason: '自动化验收' })
      const components = []
      for (const name of ['Main Control', 'Driver']) {
        const component = await post(`/api/v1/projects/${project.id}/components`, { name, reason: '验收' })
        components.push(component)
        for (const number of ['1', '2']) {
          const version = await post(`/api/v1/components/${component.id}/versions`, { versionNumber: number, maturity: 'Released', reason: '验收' })
          for (let patch = 1; patch <= 4; patch++) {
            await post(`/api/v1/component-versions/${version.id}/patches`, { patchCode: 'P' + patch, title: '补丁' + patch, issueDescription: '验收', resolutionDescription: '修复', status: 'Draft' })
          }
        }
      }
      const detail = await (await context.request.get(`/api/v1/projects/${project.id}`)).json()
      assert.equal(detail.components.length, 2)
      for (const component of detail.components) {
        assert.equal(component.versions.length, 2)
        for (const version of component.versions) {
          assert.equal(version.patchCount, 4)
          assert.equal(version.patches.length, 3)
        }
      }
      page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('/')
      await page.evaluate(id => localStorage.setItem('confighub.selected-project-id', id), project.id)
      await page.reload()
      await page.locator('.nav-item').filter({ hasText: '导入' }).click()
      await page.getByLabel('所属项目').selectOption(project.id)
      await page.getByLabel('表格内容（组件名称、版本号）').fill('Main Control\tV 3\nDriver\tV 3')
      await page.getByLabel('导入原因', { exact: true }).fill('制表符导入验收')
      await page.getByRole('button', { name: '生成预览', exact: true }).click()
      await page.getByRole('button', { name: '提交导入', exact: true }).waitFor()
      assert(await page.getByText('Main Control · V 3', { exact: true }).isVisible())
      assert(await page.getByText('Driver · V 3', { exact: true }).isVisible())
      mkdirSync('artifacts/startup-import', { recursive: true })
      await page.screenshot({ path: 'artifacts/startup-import/desktop.png' })
      await page.setViewportSize({ width: 390, height: 844 })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: 'artifacts/startup-import/mobile.png', fullPage: true })
      const committed = page.waitForResponse(response => response.url().includes('/commit') && response.request().method() === 'POST')
      await page.getByRole('button', { name: '提交导入', exact: true }).click()
      assert((await committed).ok())
      const imported = await (await context.request.get(`/api/v1/projects/${project.id}`)).json()
      assert(imported.components.every(component => component.versions.some(version => version.versionNumber === 'V 3')))
      assert.deepEqual(errors, [])
    } catch (error) {
      if (page) {
        mkdirSync('artifacts/startup-import', { recursive: true })
        await page.screenshot({ path: 'artifacts/startup-import/failure.png', fullPage: true })
      }
      throw error
    } finally {
      try {
        if (project) await post(`/api/v1/projects/${project.id}/archive`, { reason: '验收清理' })
      } finally { await browser.close() }
    }
  })
  await withHost(5099, 5443, async baseURL => {
    const response = await fetch(baseURL + '/health/live?check=1', { redirect: 'manual' })
    assert.equal(response.status, 307)
    assert.equal(response.headers.get('location'), 'https://127.0.0.1:5443/health/live?check=1')
  })
  console.log('Startup/import acceptance passed: chunk budget, HTTP, explicit HTTPS redirect, split query collections, TAB preview/commit and desktop/mobile UI.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
