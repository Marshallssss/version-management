const { chromium } = require('playwright')
const { readFileSync, mkdirSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext({ baseURL: process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080', viewport: { width: 1366, height: 900 } })
  const post = async (url, data) => {
    const response = await context.request.post(url, { data, headers: { 'Idempotency-Key': randomUUID() } })
    assert(response.ok(), url + ': ' + await response.text())
    return response.status() === 204 ? null : response.json()
  }
  let project
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  mkdirSync('artifacts/workspace-layout', { recursive: true })
  try {
    await post('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    project = await post('/api/v1/projects', { code: 'LAYOUT-' + randomUUID().slice(0, 8), name: '长名称工艺设备与软件协同验证项目', description: '实验室与产线共同使用，覆盖多个结构分类、长版本名称和多腔室机台。', reason: '布局验收' })
    const children = []
    const versions = []
    for (let i = 0; i < 6; i++) {
      const root = await post(`/api/v1/projects/${project.id}/components`, { name: `${i + 1}号非常长的工艺控制分类名称`, reason: '布局验收' })
      const child = await post(`/api/v1/projects/${project.id}/components`, { name: `${i + 1}号工艺下位控制器完整名称`, parentComponentId: root.id, reason: '布局验收' })
      children.push(child)
      versions.push(await post(`/api/v1/components/${child.id}/versions`, { versionNumber: '2026.09.11-laboratory-long-version', maturity: 'Testing', reason: '布局验收' }))
    }
    const machine = await post('/api/v1/machines', { projectId: project.id, name: '一号非常长名称的实验室工艺机台', serialNumber: 'LAYOUT-' + randomUUID().slice(0, 8), owner: '设备负责人', location: '实验室 A 区', stage: 'T2', chambers: [1, 3, 6].map(number => ({ number, stage: 'T1' })), reason: '布局验收' })
    await post(`/api/v1/machines/${machine.id}/facts`, { operationType: 'InitialSnapshot', coverage: 'Full', sourceType: 'manual-ui', reason: '布局验收', items: children.map((child, i) => ({ componentId: child.id, versionId: i === 0 ? null : versions[i].id, absent: i === 0, knownInstalledAt: null })) })
    await page.goto('/')
    await page.evaluate(id => localStorage.setItem('confighub.selected-project-id', id), project.id)
    await page.reload()
    await page.locator('.nav-item').filter({ hasText: '项目' }).click()
    await page.locator('.workspace-layout.inspector-collapsed').waitFor()
    assert.equal(await page.locator('.lab-root-column').count(), 6)
    assert(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.nav-label')).fontSize) >= 14))
    assert(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('h1')).fontSize) <= 28))
    await page.locator('.tree-node').first().click()
    await page.locator('.workspace-layout:not(.inspector-collapsed)').waitFor()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: 'artifacts/workspace-layout/project-expanded.png', fullPage: true })
    await page.locator('.nav-item').filter({ hasText: '机台' }).click()
    assert.equal(await page.locator('.machine-detail-panel:visible').count(), 0)
    await page.locator('.machine-list-item').first().click()
    const detail = page.locator('.machine-detail-panel')
    await detail.getByText('已确认缺失', { exact: true }).waitFor()
    assert.equal(await detail.locator('form:visible').count(), 0)
    assert.equal(await detail.locator('.actual-root-column').count(), 6)
    assert.equal(await detail.locator('.actual-child-branch').count(), 6)
    await detail.getByRole('button', { name: '记录局部观察', exact: true }).click()
    await page.getByRole('dialog').waitFor()
    assert.equal(await page.getByRole('dialog').locator('form').count(), 1)
    await page.getByRole('dialog').getByRole('combobox').first().selectOption(children[1].id)
    await page.locator('.ant-modal-close').click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.getByRole('navigation', { name: '机台详情' }).getByRole('button', { name: '目标与对比' }).click()
    assert.equal(await detail.locator('form:visible').count(), 0)
    await detail.getByRole('button', { name: '指派目标', exact: true }).click()
    await page.getByRole('dialog').waitFor()
    await page.locator('.ant-modal-close').click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.getByRole('navigation', { name: '机台详情' }).getByRole('button', { name: '当前配置' }).click()
    await page.screenshot({ path: 'artifacts/workspace-layout/machine-desktop.png', fullPage: true })
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 900 })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${width}`)
      await page.screenshot({ path: `artifacts/workspace-layout/machine-${width}.png`, fullPage: true })
    }
    await detail.getByRole('button', { name: '返回机台列表' }).click()
    assert.equal(await page.locator('.machine-detail-panel:visible').count(), 0)
    assert.deepEqual(errors, [])
    console.log('Workspace layout passed: readable controls, long-name hierarchy, initial read-only configuration, on-demand operations, absent state, desktop/tablet/mobile layouts.')
  } finally {
    if (project) await post(`/api/v1/projects/${project.id}/archive`, { reason: '布局验收结束' }).catch(() => {})
    await browser.close()
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1 })
