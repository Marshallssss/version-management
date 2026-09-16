const { chromium } = require('playwright')
const { readFileSync, mkdirSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  const baseURL = process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080'
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 900 } })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const output = path.resolve('artifacts/navigation-overview')
  mkdirSync(output, { recursive: true })
  const projects = []
  const token = randomUUID().slice(0, 8)
  const write = async (url, data, client = context.request) => {
    const response = await client.post(url, { data, headers: { 'Idempotency-Key': randomUUID() } })
    assert(response.ok(), url + ': ' + await response.text())
    return response.status() === 204 ? null : response.json()
  }
  const get = async url => {
    const response = await context.request.get(url)
    assert(response.ok(), url + ': ' + await response.text())
    return response.json()
  }
  const nav = async (name, target = page) => {
    await target.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click()
    await target.getByRole('heading', { level: 1, name, exact: true }).waitFor()
  }
  const selectProject = async (projectId, target = page) => {
    await target.goto('/')
    await target.evaluate(id => localStorage.setItem('confighub.selected-project-id', id), projectId)
    await target.reload()
  }
  const capture = async name => {
    await page.waitForFunction(() => document.fonts.status === 'loaded')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ': document overflow')
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true, animations: 'disabled' })
  }
  try {
    await write('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    for (const name of ['导航与配置总览验收', '其他项目隔离验收', '空项目验收']) projects.push(await write('/api/v1/projects', { code: 'OVERVIEW-' + projects.length + '-' + token, name, reason: '导航与总览自动化验收' }))
    const [project, other, empty] = projects
    const root = await write(`/api/v1/projects/${project.id}/components`, { name: '控制系统', reason: '验收' })
    const component = await write(`/api/v1/projects/${project.id}/components`, { name: '主控程序', parentComponentId: root.id, reason: '验收' })
    const v1 = await write(`/api/v1/components/${component.id}/versions`, { versionNumber: 'V1-' + token, maturity: 'Released', reason: '验收' })
    const baseline = await write(`/api/v1/projects/${project.id}/baselines`, { seriesCode: 'OVERVIEW', baselineCode: 'BL-' + token, publishImmediately: true, reason: '验收' })
    await write(`/api/v1/projects/${project.id}/standard`, { configurationBaselineId: baseline.id, reason: '显式设置项目标准' })
    const v2 = await write(`/api/v1/components/${component.id}/versions`, { versionNumber: 'V2-' + token, maturity: 'Released', reason: '验收' })
    await write(`/api/v1/components/${component.id}/versions`, { versionNumber: 'V3-testing-' + token, maturity: 'Testing', reason: '实验室数量验收' })
    await write(`/api/v1/component-versions/${v1.id}/patches`, { patchCode: 'HF.1', title: '跨页补丁导航', issueDescription: '引用追溯', resolutionDescription: '稳定性修复', status: 'Released' })
    const machines = []
    for (const [index, name] of ['匹配但严重风险', '配置有差异', '没有配置记录', '没有指派目标'].entries()) {
      const machine = await write('/api/v1/machines', { projectId: project.id, serialNumber: 'OV-' + index + '-' + token, name, location: index < 2 ? '实验室' : '生产现场', stage: 'T2', owner: '验收人员', reason: '验收' })
      machines.push(machine)
      if (index !== 3) await write(`/api/v1/machines/${machine.id}/target`, { configurationBaselineId: baseline.id, reason: '显式指派' })
      if (index !== 2) await write(`/api/v1/machines/${machine.id}/facts`, { operationType: 'InitialSnapshot', coverage: 'Full', sourceType: 'Manual', reason: '验收', items: [{ componentId: component.id, versionId: index === 0 ? v1.id : v2.id, absent: false, knownInstalledAt: null }] })
    }
    await write('/api/v1/machines', { projectId: other.id, serialNumber: 'OTHER-' + token, name: '其他项目机台', reason: '隔离验收' })
    await write(`/api/v1/component-versions/${v1.id}/safety`, { state: 'Blocked', reason: '匹配和风险独立验收' })
    const registry = await get(`/api/v1/projects/${project.id}/machine-registry`)
    assert.equal(registry.items.length, 4)
    const critical = registry.items.find(item => item.id === machines[0].id)
    assert.equal(critical.matchStatus, 'Matched')
    assert.equal(critical.riskSeverity, 'Critical')
    const frozen = await get(`/api/v1/baselines/${baseline.id}`)
    const originalFacts = await get(`/api/v1/machines/${machines[0].id}/facts`)
    await selectProject(project.id)
    const mainNavigation = page.getByRole('navigation', { name: '主导航' })
    assert.equal(await mainNavigation.getByRole('button', { name: '项目', exact: true }).count(), 0)
    assert.equal(await mainNavigation.getByRole('button', { name: '系统运维', exact: true }).count(), 0)
    await page.locator('.overview-metrics button[data-attention=""] strong').filter({ hasText: /^4$/ }).waitFor()
    assert((await page.locator('.project-overview').innerText()).includes('不代表机台实时在线状态'))
    assert.equal(await page.locator('.overview-operations-content').count(), 0, 'Operations start collapsed')
    assert.equal(await page.locator('.overview-baseline-list .standard-mark').innerText(), '项目标准')
    const criticalRow = page.locator('.overview-machine-row').filter({ hasText: '匹配但严重风险' })
    assert((await criticalRow.innerText()).includes('配置匹配'))
    assert((await criticalRow.innerText()).includes('严重风险'))
    const cases = [
      ['', registry.items],
      ['critical', registry.items.filter(item => item.riskSeverity === 'Critical')],
      ['mismatch', registry.items.filter(item => item.matchStatus === 'Mismatch')],
      ['unknown', registry.items.filter(item => !item.matchStatus || item.matchStatus === 'Unknown')],
      ['no-target', registry.items.filter(item => !item.targetBaselineId)],
    ]
    for (const [attention, expected] of cases) {
      await nav('运行总览')
      const metric = page.locator(`.overview-metrics button[data-attention="${attention}"]`)
      assert.equal(await metric.locator('strong').innerText(), String(expected.length))
      await metric.click()
      await page.getByRole('heading', { level: 1, name: '机台', exact: true }).waitFor()
      await page.waitForFunction(count => document.querySelectorAll('.machine-list-item').length === count, expected.length)
      const actualNames = await page.locator('.machine-list-item').allTextContents()
      for (const machine of expected) assert(actualNames.some(text => text.includes(machine.name)), 'Metric navigation must preserve its exact filter')
      assert(!actualNames.some(text => text.includes('其他项目机台')))
      assert.equal(await page.locator('.machine-detail-panel:visible').count(), 0, 'Metric link must show the filtered registry, not a stale detail')
    }
    await nav('运行总览')
    await criticalRow.click()
    await page.locator('.machine-detail-header').filter({ hasText: '匹配但严重风险' }).waitFor()
    await nav('运行总览')
    await page.locator('.overview-project-strip button').filter({ hasText: '当前项目标准' }).click()
    await page.getByRole('heading', { level: 1, name: '基线', exact: true }).waitFor()
    await page.locator('.baseline-snapshot h3').filter({ hasText: 'BL-' + token }).waitFor()
    await page.locator('.snapshot-tree .patch-open').click()
    await page.getByRole('heading', { level: 1, name: '版本', exact: true }).waitFor()
    await page.locator('.component-inspector .patch-list').getByText('HF.1 · 跨页补丁导航', { exact: true }).waitFor()
    assert.equal(await page.locator('.project-baseline-history').count(), 0, 'Version page must not duplicate baseline history')
    await page.getByRole('button', { name: '从测试版本创建基线', exact: true }).click()
    await page.getByRole('heading', { level: 1, name: '基线', exact: true }).waitFor()
    await page.locator('#baseline-composer').waitFor()
    assert.equal(await page.locator('.composer-tree .composer-version-choice').count(), 1)
    await nav('运行总览')
    await page.locator('.overview-project-strip button').filter({ hasText: '实验室测试版本' }).click()
    await page.getByRole('heading', { level: 1, name: '版本', exact: true }).waitFor()
    await page.locator('.laboratory-tree').getByText('V3-testing-' + token, { exact: true }).waitFor()
    await nav('搜索')
    await page.getByLabel('搜索词').fill('BL-' + token)
    await page.locator('.catalog-list .component-row').filter({ hasText: 'BL-' + token }).click()
    await page.getByRole('heading', { level: 1, name: '基线', exact: true }).waitFor()
    await page.locator('.baseline-snapshot h3').filter({ hasText: 'BL-' + token }).waitFor()
    await nav('运行总览')
    for (const width of [1366, 768, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await capture('overview-' + width)
    }
    await page.locator('.overview-operations > summary').click()
    await page.locator('.overview-operations-content').waitFor()
    await page.getByLabel('诊断原因').fill('总览运维入口自动验收')
    await page.getByRole('button', { name: '提交连通性任务', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '任务已提交' }).waitFor()
    await capture('operations-mobile')
    await page.setViewportSize({ width: 1366, height: 900 })
    await selectProject(empty.id)
    await page.getByText('当前项目尚未登记机台。', { exact: true }).waitFor()
    assert.equal(await page.locator('.overview-metrics button[data-attention=""] strong').innerText(), '0')
    assert(!(await page.locator('.project-overview').innerText()).includes('所有机台均有目标且配置匹配'))
    await capture('empty-project')
    await page.route(`**/api/v1/projects/${project.id}/machine-registry`, route => route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ title: '验收读取失败' }) }))
    await selectProject(project.id)
    await page.getByRole('alert').filter({ hasText: '不能据此判断运行正常' }).waitFor()
    for (const metric of await page.locator('.overview-metrics button').all()) {
      assert(await metric.isDisabled())
      assert.equal(await metric.locator('strong').innerText(), '—', 'Failed data must not become a healthy zero')
    }
    await capture('failed-data')
    await page.unroute(`**/api/v1/projects/${project.id}/machine-registry`)
    const userName = 'overview-viewer-' + token
    const password = randomUUID()
    await write('/api/v1/admin/users', { userName, password, displayName: '只读总览验收', role: 'Viewer', reason: '权限验收' })
    const viewer = await browser.newContext({ baseURL })
    try {
      await write('/api/v1/auth/login', { userName, password }, viewer.request)
      const viewerPage = await viewer.newPage()
      await selectProject(project.id, viewerPage)
      await viewerPage.locator('.overview-metrics button[data-attention=""] strong').filter({ hasText: /^4$/ }).waitFor()
      assert.equal(await viewerPage.locator('.overview-operations').count(), 0)
      await nav('基线', viewerPage)
      await viewerPage.locator('.baseline-timeline .timeline-item').first().waitFor()
      assert.equal(await viewerPage.locator('.baseline-history-detail form:visible').count(), 0)
      assert.equal(await viewerPage.getByRole('button', { name: '历史维护', exact: true }).count(), 0)
    } finally { await viewer.close() }
    assert.deepEqual(await get(`/api/v1/baselines/${baseline.id}`), frozen, 'Navigation must not change frozen baseline data')
    assert.deepEqual(await get(`/api/v1/machines/${machines[0].id}/facts`), originalFacts, 'Navigation must not change recorded machine facts')
    assert.deepEqual(errors, [])
    console.log('Navigation and overview acceptance passed: independent version/baseline pages, composer/search/patch links, scoped actionable metrics, Match/Risk separation, empty/error states, Viewer, admin diagnostics and responsive layouts.')
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {})
    for (const project of projects) await write(`/api/v1/projects/${project.id}/archive`, { reason: '总览导航验收完成归档' }).catch(() => {})
    await browser.close()
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1 })
