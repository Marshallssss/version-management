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
  const reason = '基线 PDF 页面验收'
  const write = async (url, data, client = admin.request) => {
    const response = await client.post(url, { data, headers: { 'Idempotency-Key': randomUUID() } })
    assert(response.ok(), `${url}: ${await response.text()}`)
    return response.status() === 204 ? null : response.json()
  }
  let project
  try {
    await write('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    project = await write('/api/v1/projects', { code: `PDF-${randomUUID().slice(0, 8)}`, name: '基线导出验收项目', reason })
    const root = await write(`/api/v1/projects/${project.id}/components`, { name: '系统分类', reason })
    const child = await write(`/api/v1/projects/${project.id}/components`, { name: '控制组件 <测试>', parentComponentId: root.id, reason })
    await write(`/api/v1/components/${child.id}/versions`, { versionNumber: 'V1.0.历史', maturity: 'Released', reason })
    const baseline = await write(`/api/v1/projects/${project.id}/baselines`, { seriesCode: 'PDF', baselineCode: 'PDF 冻结快照', publishImmediately: true, reason })
    const before = await (await admin.request.get(`/api/v1/baselines/${baseline.id}`)).json()
    const userName = `pdf-viewer-${randomUUID().slice(0, 8)}`, password = randomUUID()
    await write('/api/v1/admin/users', { userName, password, displayName: 'PDF 只读验收', role: 'Viewer', reason })
    const viewer = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })
    await write('/api/v1/auth/login', { userName, password }, viewer.request)
    mkdirSync('artifacts/baseline-pdf', { recursive: true })
    for (const [role, context] of [['admin', admin], ['viewer', viewer]]) {
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('/')
      await page.evaluate(id => localStorage.setItem('confighub.selected-project-id', id), project.id)
      await page.reload()
      await page.locator('.nav-item').filter({ hasText: /^基线$/ }).click()
      await page.getByRole('heading', { name: 'PDF 冻结快照', exact: true }).waitFor()
      const button = page.getByRole('button', { name: '导出所选基线 PDF', exact: true })
      await button.waitFor()
      const popupPromise = page.waitForEvent('popup')
      await button.click()
      const report = await popupPromise
      await report.getByRole('heading', { name: 'PDF 冻结快照', exact: true }).waitFor()
      assert.equal(await report.locator('tbody tr').count(), 2)
      assert.equal(await report.locator('tbody tr').nth(1).locator('td').nth(1).textContent(), 'V1.0.历史')
      assert.equal(await report.evaluate(() => window.opener), null)
      assert.equal(await report.locator('input,textarea,select').count(), 0)
      await report.evaluate(() => { window.print = () => { window.__printCalled = true } })
      await report.getByRole('button', { name: '保存为 PDF / 打印' }).click()
      assert(await report.evaluate(() => window.__printCalled))
      await report.pdf({ path: `artifacts/baseline-pdf/${role}-actual.pdf`, preferCSSPageSize: true, printBackground: true })
      await page.screenshot({ path: `artifacts/baseline-pdf/${role}-page.png`, fullPage: true })
      await report.close()
      await page.evaluate(() => { window.open = () => null })
      await button.click()
      await page.getByRole('alert').filter({ hasText: '浏览器阻止了导出窗口' }).waitFor()
      assert.deepEqual(errors, [])
    }
    const after = await (await admin.request.get(`/api/v1/baselines/${baseline.id}`)).json()
    assert.deepEqual(after, before, 'Export cannot mutate the snapshot')
    console.log('Baseline PDF UI passed: authenticated admin/Viewer export, desktop/mobile entry, frozen hierarchy/version, print action, actual PDFs, popup-block feedback and read-only snapshot.')
  } finally {
    if (project) await write(`/api/v1/projects/${project.id}/archive`, { reason: 'PDF 验收完成' }).catch(() => {})
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
