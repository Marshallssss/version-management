const { chromium } = require('playwright')
const { readFileSync, mkdirSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const baseURL = process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080'
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const admin = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } })
  const projects = []
  const token = randomUUID().slice(0, 8)
  const output = path.resolve('artifacts/workspace-context')
  mkdirSync(output, { recursive: true })
  const post = async (url, data, client = admin.request, key = randomUUID()) => {
    const response = await client.post(url, { data, headers: { 'Idempotency-Key': key } })
    assert(response.ok(), url + ': ' + await response.text())
    return response.status() === 204 ? null : response.json()
  }
  const get = async url => {
    const response = await admin.request.get(url)
    assert(response.ok(), await response.text())
    return response.json()
  }
  let page
  try {
    await post('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    for (const name of ['当前项目', '另一项目']) projects.push({ ...await post('/api/v1/projects', { code: `CTX-${projects.length}-${token}`, name: name + token, reason: '上下文验收' }), name: name + token })
    const [a, b] = projects
    const component = await post(`/api/v1/projects/${a.id}/components`, { name: '99-' + token, reason: '验收' })
    const version = await post(`/api/v1/components/${component.id}/versions`, { versionNumber: token + '-V1', reason: '验收' })
    for (let i = 0; i < 21; i++) await post(`/api/v1/projects/${b.id}/components`, { name: `00-${token}-${i}`, reason: '过滤应发生在分页前' })
    const machineA = await post('/api/v1/machines', { projectId: a.id, serialNumber: 'A-' + token, name: '本项目机台' + token, reason: '验收' })
    const machineB = await post('/api/v1/machines', { projectId: b.id, serialNumber: 'B-' + token, name: '远端机台' + token, reason: '验收' })
    const scoped = await get(`/api/v1/search?query=${token}&projectId=${a.id}`)
    assert(scoped.length > 0 && scoped.every(item => item.projectId === a.id))
    assert(scoped.some(item => item.id === component.id), 'Filter must precede per-type limit')
    assert((await get(`/api/v1/search?query=${token}`)).some(item => item.id === machineB.id), 'Legacy global search remains available')
    assert.deepEqual(await get(`/api/v1/search?query=${token}&projectId=${randomUUID()}`), [])
    const dashboard = await get(`/api/v1/dashboard?projectId=${a.id}`)
    assert.equal(dashboard.machineCount, 1)
    assert.equal(dashboard.unknownCount, 1)
    assert.equal((await get(`/api/v1/dashboard?projectId=${randomUUID()}`)).machineCount, 0)

    page = await admin.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    await page.evaluate(id => localStorage.setItem('confighub.selected-project-id', id), a.id)
    await page.reload()
    const navigate = async name => page.locator('.nav-item').filter({ hasText: name }).click()
    const switchProject = async project => {
      await page.locator('.project-switch').click()
      await page.getByRole('dialog').getByLabel('项目', { exact: true }).selectOption(project.id)
      await page.waitForFunction(name => document.querySelector('.project-switch strong')?.textContent === name, project.name)
    }
    await navigate('搜索')
    assert.equal(await page.getByLabel('搜索范围').inputValue(), 'current')
    await page.getByLabel('搜索词').fill('远端机台' + token)
    await page.getByText('没有找到匹配的记录。', { exact: true }).waitFor()
    await page.getByLabel('搜索范围').selectOption('all')
    await page.getByRole('button').filter({ hasText: '远端机台' + token }).click()
    await page.locator('.machine-detail-panel').waitFor()
    assert.equal(await page.locator('.project-switch strong').innerText(), b.name)
    assert.equal(await page.evaluate(() => localStorage.getItem('confighub.selected-project-id')), b.id)
    await navigate('部署记录')
    assert.equal(await page.getByLabel('机台', { exact: true }).inputValue(), machineB.id)
    await switchProject(a)
    assert.equal(await page.getByLabel('机台', { exact: true }).inputValue(), '')
    assert.equal(await page.getByLabel('机台', { exact: true }).locator(`option[value="${machineB.id}"]`).count(), 0)
    await page.getByLabel('机台', { exact: true }).selectOption(machineA.id)
    assert.equal(await page.getByLabel('所属项目').count(), 0)

    await navigate('搜索')
    await page.getByLabel('搜索词').fill('99-' + token)
    await page.getByRole('button').filter({ hasText: '99-' + token }).click()
    await page.locator('.component-inspector:not(.collapsed)').waitFor()
    assert((await page.locator('.component-inspector').innerText()).includes('99-' + token))
    await navigate('版本导入')
    assert.equal(await page.getByLabel('所属项目').count(), 0)
    const openLegacyImport = async () => {
      if (!await page.getByLabel('表格内容（组件名称、版本号）').isVisible()) await page.getByText('粘贴文本导入', { exact: true }).click()
    }
    await openLegacyImport()
    await page.getByLabel('表格内容（组件名称、版本号）').fill(`99-${token}\tV-import`)
    await page.getByLabel('导入原因', { exact: true }).fill('预览项目隔离')
    await page.getByRole('button', { name: '生成预览', exact: true }).click()
    await page.getByRole('button', { name: '提交导入', exact: true }).waitFor()
    await switchProject(b)
    assert.equal(await page.getByRole('button', { name: '提交导入', exact: true }).count(), 0)
    assert.equal(await page.getByLabel('表格内容（组件名称、版本号）').inputValue(), '')
    await switchProject(a)
    assert.equal(await page.getByRole('button', { name: '提交导入', exact: true }).count(), 0)
    let releasePreview
    let previewArrived
    const previewGate = new Promise(resolve => { releasePreview = resolve })
    const arrived = new Promise(resolve => { previewArrived = resolve })
    await page.route('**/api/v1/imports', async route => {
      const response = await route.fetch()
      previewArrived()
      await previewGate
      await route.fulfill({ response })
    })
    await openLegacyImport()
    await page.getByLabel('表格内容（组件名称、版本号）').fill(`99-${token}\tV-late-response`)
    await page.getByLabel('导入原因', { exact: true }).fill('迟到响应验收')
    await page.getByRole('button', { name: '生成预览', exact: true }).click()
    await arrived
    await switchProject(b)
    const lateResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/imports'))
    releasePreview()
    await lateResponse
    await page.unroute('**/api/v1/imports')
    assert.equal(await page.getByRole('button', { name: '提交导入', exact: true }).count(), 0)
    assert.equal(await page.getByLabel('表格内容（组件名称、版本号）').inputValue(), '')
    await switchProject(a)
    await openLegacyImport()
    await page.getByLabel('表格内容（组件名称、版本号）').fill(`99-${token}\tV-import`)
    await page.getByLabel('导入原因', { exact: true }).fill('真实提交验收')
    await page.getByRole('button', { name: '生成预览', exact: true }).click()
    await page.getByRole('button', { name: '提交导入', exact: true }).click()
    await page.getByText(`已向 ${a.name} 导入 1 个版本。`, { exact: true }).waitFor()
    assert((await get(`/api/v1/projects/${a.id}`)).components[0].versions.some(item => item.versionNumber === 'V-import'))
    assert((await get(`/api/v1/projects/${b.id}`)).components.every(item => item.versions.length === 0))
    await page.screenshot({ path: path.join(output, 'import-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: path.join(output, 'import-mobile.png'), fullPage: true })

    // Authorization must precede idempotent responses, including for non-member engineers.
    const stageKey = randomUUID()
    const commitKey = randomUUID()
    const payload = { projectId: a.id, sourceFileName: 'acceptance.tsv', reason: '重放权限验收', rows: [{ componentName: '99-' + token, versionNumber: 'V-replay' }] }
    const batch = await post('/api/v1/imports', payload, admin.request, stageKey)
    await post(`/api/v1/imports/${batch.id}/commit`, undefined, admin.request, commitKey)
    for (const role of ['Viewer', 'Engineer']) {
      const userName = role + '-' + token
      const password = randomUUID()
      await post('/api/v1/admin/users', { userName, displayName: role + '验收', password, role, reason: '权限验收' })
      const context = await browser.newContext({ baseURL })
      await post('/api/v1/auth/login', { userName, password }, context.request)
      for (const [url, data, key] of [
        ['/api/v1/imports', payload, stageKey],
        [`/api/v1/imports/${batch.id}/commit`, undefined, commitKey],
        [`/api/v1/projects/${a.id}/bulk-facts`, { machineIds: [machineA.id], operationType: 'Observation', coverage: 'Partial', reason: '权限验收', items: [{ componentId: component.id, versionId: version.id, absent: false, knownInstalledAt: null }] }, randomUUID()],
      ]) {
        const response = await context.request.post(url, { data, headers: { 'Idempotency-Key': key } })
        assert.equal(response.status(), 403, `${role}: ${url}: ${await response.text()}`)
      }
      if (role === 'Viewer') {
        const view = await context.newPage()
        await view.goto('/')
        await view.locator('.nav-item').filter({ hasText: '部署记录' }).click()
        assert.equal(await view.locator('form:visible').count(), 0)
        assert.equal(await view.locator('.nav-item').filter({ hasText: '导入' }).count(), 0)
        assert.equal(await view.locator('.nav-item').filter({ hasText: '用户与角色' }).count(), 0)
      }
      await context.close()
    }
    assert.deepEqual(errors, [])
    console.log('Workspace context passed: scoped search/dashboard, cross-project navigation, import isolation, Viewer UI and server authorization including replay.')
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
    throw error
  } finally {
    for (const project of projects) await post(`/api/v1/projects/${project.id}/archive`, { reason: '上下文验收结束' }).catch(() => {})
    await browser.close()
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1 })
