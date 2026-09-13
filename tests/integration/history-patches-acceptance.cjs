const { chromium } = require('playwright')
const { readFileSync, mkdirSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const baseURL = process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080'
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const output = path.resolve('artifacts/history-patches')
  mkdirSync(output, { recursive: true })
  let project
  const machines = []
  const write = async (url, data, method = 'post', client = context.request) => {
    const response = await client[method](url, { data, headers: { 'Idempotency-Key': randomUUID() } })
    assert(response.ok(), url + ': ' + await response.text())
    return response.status() === 204 ? null : response.json()
  }
  const get = async url => {
    const response = await context.request.get(url)
    assert(response.ok(), url + ': ' + await response.text())
    return response.json()
  }
  const localTime = value => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
  const historicalAt = '2020-06-01T00:00:00Z'
  const openMachine = async (machine, section, target = page) => {
    await target.goto('/')
    await target.evaluate(id => localStorage.setItem('confighub.selected-project-id', id), project.id)
    await target.reload()
    await target.locator('.nav-item').filter({ hasText: '机台' }).click()
    await target.locator('.machine-list-item').filter({ hasText: machine.name }).click()
    await target.getByRole('navigation', { name: '机台详情' }).getByRole('button', { name: new RegExp(section) }).click()
  }
  const expandTarget = async target => {
    const block = target.locator('.machine-target-comparison')
    if (!(await block.evaluate(element => element.open))) await block.locator('summary').click()
    return block
  }
  const preview = async (badge, notice, target = page) => {
    await badge.hover()
    const popup = target.locator('.patch-hover-content:visible')
    await popup.waitFor()
    assert((await popup.innerText()).includes(notice))
    return popup
  }
  const patchPage = async (badge, number, target = page) => {
    await badge.click()
    await target.locator('.component-inspector .patch-list').waitFor()
    assert.equal(await target.locator('.inspector-tabs .active').innerText(), '补丁')
    assert((await target.locator('.selected-version-summary').innerText()).includes(number))
    await target.locator('.patch-location-guide').waitFor()
  }
  const capture = async (panel, name, badge, notice) => {
    for (const width of [1366, 768, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await panel.scrollIntoViewIfNeeded()
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1)
      if (badge) {
        await preview(badge, notice)
        const box = await page.locator('.ant-popover:visible').boundingBox()
        assert(box && box.x >= -1 && box.x + box.width <= width + 1, 'Patch popover must fit the viewport')
      }
      assert(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(await panel.innerText()), 'Internal GUID exposed')
      await page.screenshot({ path: path.join(output, `${name}-${width}.png`), animations: 'disabled' })
      if (badge) {
        await page.getByRole('button', { name: '收起补丁预览', exact: true }).click()
        await page.locator('.patch-hover-content:visible').waitFor({ state: 'hidden' })
      }
    }
    await page.setViewportSize({ width: 1366, height: 900 })
  }
  try {
    await write('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    const token = randomUUID().slice(0, 8)
    project = await write('/api/v1/projects', { code: 'HISTORY-PATCH-' + token, name: '目标历史补丁验收', reason: '自动化验收' })
    const root = await write(`/api/v1/projects/${project.id}/components`, { name: '工艺分类', reason: '验收' })
    const component = name => write(`/api/v1/projects/${project.id}/components`, { name, parentComponentId: root.id, reason: '验收' })
    const control = await component('工艺控制通信组件完整名称')
    const plain = await component('无补丁组件')
    const blocked = await component('匹配但已阻止组件')
    const removed = await component('已确认缺失组件')
    const version = (owner, number, maturity = 'Released') => write(`/api/v1/components/${owner.id}/versions`, { versionNumber: number, maturity, reason: '验收' })
    const v1 = await version(control, 'V1-frozen')
    const plainVersion = await version(plain, 'PLAIN')
    const blockedVersion = await version(blocked, 'BLOCKED-SAME')
    const removedVersion = await version(removed, 'REMOVED')
    const baseline = await write(`/api/v1/projects/${project.id}/baselines`, { seriesCode: 'HISTORY', baselineCode: '历史补丁基线', publishImmediately: true, reason: '先冻结再登记补丁' })
    const frozen = await get(`/api/v1/baselines/${baseline.id}`)
    await write(`/api/v1/projects/${project.id}/standard`, { configurationBaselineId: baseline.id, reason: '显式标准' })
    const v2 = await version(control, 'V2-lab', 'Testing')
    const newMachine = async name => {
      const machine = await write('/api/v1/machines', { projectId: project.id, name, serialNumber: token + '-' + machines.length, reason: '验收' })
      machine.name = name
      machines.push(machine)
      await write(`/api/v1/machines/${machine.id}/target`, { configurationBaselineId: baseline.id, reason: '显式目标' })
      return machine
    }
    const machine = await newMachine('历史与补丁差异机台')
    const matched = await newMachine('完全匹配但有风险机台')
    const entry = (component, version, knownInstalledAt = null) => ({ componentId: component.id, versionId: version.id, absent: false, knownInstalledAt })
    const originalItems = [entry(control, v1), entry(plain, plainVersion, '2019-01-01T00:00:00Z'), entry(blocked, blockedVersion), entry(removed, removedVersion)]
    for (const item of machines) await write(`/api/v1/machines/${item.id}/facts`, { operationType: 'InitialSnapshot', coverage: 'Full', effectiveAt: '2020-01-01T00:00:00Z', sourceType: 'Manual', reason: '补录历史实际', items: originalItems })
    await write(`/api/v1/machines/${machine.id}/facts`, { operationType: 'Observation', coverage: 'Full', effectiveAt: '2021-01-01T00:00:00Z', sourceType: 'Manual', reason: '完整观察不是升级', items: [entry(control, v2), entry(plain, plainVersion, '2019-01-01T00:00:00Z'), entry(blocked, blockedVersion)] })
    const patch = (owner, code, status) => write(`/api/v1/component-versions/${owner.id}/patches`, { patchCode: code, title: code + ' 稳定性修复', issueDescription: '通信超时', resolutionDescription: '优化恢复过程', status })
    for (const [code, status] of [['HF.1', 'Released'], ['HF.2', 'Draft'], ['HF.3', 'Withdrawn']]) await patch(v1, code, status)
    await patch(v2, 'LAB.1', 'Released')
    await patch(blockedVersion, 'BLOCK.1', 'Released')
    await write(`/api/v1/component-versions/${blockedVersion.id}/safety`, { state: 'Blocked', reason: '匹配与风险分离验收' })
    const registeredVersion = await get(`/api/v1/component-versions/${v1.id}`)
    await write(`/api/v1/component-versions/${v1.id}/maintenance`, { versionNumber: 'V1-current-name', createdAt: registeredVersion.version.createdAt, maturity: 'Released', maintenanceMode: true, reason: '名称维护不能改变冻结基线' })
    const snapshot = async () => ({ baseline: await get(`/api/v1/baselines/${baseline.id}`), facts: await get(`/api/v1/machines/${machine.id}/facts`), actual: await get(`/api/v1/machines/${machine.id}/configuration`), historical: await get(`/api/v1/machines/${machine.id}/configuration-at?at=${historicalAt}`), compared: await get(`/api/v1/machines/${machine.id}/compare-history?at=${historicalAt}`) })
    const before = await snapshot()
    assert.deepEqual(before.baseline, frozen)
    assert.equal(before.historical.items.find(item => item.componentId === control.id).knownInstalledAt, null)
    assert.equal(before.actual.find(item => item.componentId === removed.id).state, 'Absent')

    await openMachine(machine, '目标与对比')
    let target = await expandTarget(page)
    let controlRow = target.locator('tbody tr').filter({ hasText: '工艺控制通信组件完整名称' })
    assert((await controlRow.innerText()).includes('V1-frozen'))
    assert((await controlRow.innerText()).includes('V2-lab'))
    assert(!(await controlRow.innerText()).includes('V1-current-name'))
    assert((await target.locator('.comparison-summary').innerText()).includes('风险：严重'))
    assert.equal(await target.locator('tbody tr').filter({ hasText: '匹配但已阻止组件' }).count(), 0)
    const targetBadge = controlRow.locator('.patch-open').first()
    const popup = await preview(targetBadge, '当前补丁记录，非当时快照')
    for (const label of ['已发布', '草稿', '已撤回']) assert((await popup.innerText()).includes(label))
    assert((await page.locator('.patch-preview-heading').innerText()).includes('V1-frozen'))
    await patchPage(targetBadge, 'V1-current-name')

    await openMachine(machine, '目标与对比')
    target = await expandTarget(page)
    controlRow = target.locator('tbody tr').filter({ hasText: '工艺控制通信组件完整名称' })
    await target.getByLabel('只看差异').uncheck()
    assert.equal(await target.locator('tbody tr').filter({ hasText: '无补丁组件' }).locator('.patch-open').count(), 0)
    assert.equal(await target.locator('tbody tr').filter({ hasText: '匹配但已阻止组件' }).locator('.patch-open').count(), 2)
    await capture(target, 'target', controlRow.locator('.patch-open').last(), '不代表机台已安装')
    await patchPage(controlRow.locator('.patch-open').last(), 'V2-lab')

    await openMachine(machine, '目标与对比')
    const standard = page.locator('.machine-standard-comparison')
    const standardRow = standard.locator('tbody tr').filter({ hasText: '工艺控制通信组件完整名称' })
    await preview(standardRow.locator('.patch-open').first(), '当前补丁记录，非当时快照')
    await patchPage(standardRow.locator('.patch-open').first(), 'V1-current-name')

    await openMachine(machine, '历史')
    await page.getByLabel('查看时间', { exact: true }).fill(localTime(historicalAt))
    const history = page.locator('.historical-configuration')
    const historyRow = history.locator('.history-configuration-table tbody tr').filter({ hasText: '工艺控制通信组件完整名称' })
    await historyRow.waitFor()
    assert((await historyRow.innerText()).includes('V1-current-name'), 'History reads current version names, not baseline labels')
    assert((await historyRow.innerText()).includes('已知安装 未知'))
    const historyBadge = historyRow.locator('.patch-open')
    await capture(history, 'historical', historyBadge, '非当时补丁清单，不代表当时已安装')
    await patchPage(historyBadge, 'V1-current-name')

    await openMachine(machine, '历史')
    await page.getByLabel('查看时间', { exact: true }).fill(localTime(historicalAt))
    const comparedRow = page.locator('.history-comparison tbody tr').filter({ hasText: '工艺控制通信组件完整名称' })
    await comparedRow.waitFor()
    await preview(comparedRow.locator('.patch-open').first(), '非当时补丁清单')
    await patchPage(comparedRow.locator('.patch-open').first(), 'V1-current-name')
    await openMachine(machine, '历史')
    await page.getByLabel('查看时间', { exact: true }).fill(localTime(historicalAt))
    await comparedRow.waitFor()
    await preview(comparedRow.locator('.patch-open').last(), '不代表机台已安装')
    await patchPage(comparedRow.locator('.patch-open').last(), 'V2-lab')

    await openMachine(machine, '历史')
    await page.getByLabel('查看时间', { exact: true }).fill(localTime('2022-01-01T00:00:00Z'))
    const absent = page.locator('.history-configuration-table tbody tr').filter({ hasText: '已确认缺失组件' })
    await absent.waitFor()
    assert((await absent.innerText()).includes('已确认缺失'))
    assert.equal(await absent.locator('.patch-open').count(), 0)
    assert((await page.locator('.history-comparison .comparison-summary').innerText()).includes('版本匹配：匹配'))
    assert((await page.locator('.history-comparison .comparison-summary').innerText()).includes('风险：严重'))
    await page.getByLabel('查看时间', { exact: true }).fill('1990-01-01T08:00')
    await history.getByText('此时间点尚无已记录的配置事实。', { exact: true }).waitFor()

    await openMachine(matched, '目标与对比')
    target = await expandTarget(page)
    assert((await target.locator('.comparison-summary').innerText()).includes('版本匹配：匹配'))
    assert((await target.locator('.comparison-summary').innerText()).includes('风险：严重'))
    assert.equal(await target.locator('.patch-open').count(), 0)
    await target.getByLabel('只看差异').uncheck()
    assert.equal(await target.locator('tbody tr').filter({ hasText: '匹配但已阻止组件' }).locator('.patch-open').count(), 2)
    assert.deepEqual(await snapshot(), before, 'Previews and navigation must not mutate baseline, facts, configuration or time semantics')

    const userName = 'history-patch-viewer-' + token
    const password = randomUUID()
    await write('/api/v1/admin/users', { userName, displayName: '历史补丁只读用户', password, role: 'Viewer', reason: '只读验收' })
    const viewer = await browser.newContext({ baseURL })
    try {
      await write('/api/v1/auth/login', { userName, password }, 'post', viewer.request)
      const view = await viewer.newPage()
      view.on('pageerror', error => errors.push(error.message))
      await openMachine(machine, '历史', view)
      await view.getByLabel('查看时间', { exact: true }).fill(localTime(historicalAt))
      const badge = view.locator('.history-configuration-table tbody tr').filter({ hasText: '工艺控制通信组件完整名称' }).locator('.patch-open')
      await patchPage(badge, 'V1-current-name', view)
      assert.equal(await view.locator('.component-inspector form:visible, .patch-record-actions:visible').count(), 0)
      assert.equal(await view.getByRole('button', { name: '登记补丁', exact: true }).count(), 0)
      const denied = await viewer.request.post(`/api/v1/component-versions/${v1.id}/patches`, { data: { patchCode: 'FORBIDDEN', title: '不得写入', issueDescription: '只读', resolutionDescription: '只读', status: 'Draft' }, headers: { 'Idempotency-Key': randomUUID() } })
      assert.equal(denied.status(), 403)
    } finally { await viewer.close() }
    assert.deepEqual(errors, [])
    console.log('History patch acceptance passed: target/standard/history patch navigation, frozen baseline labels, current patch semantics, unchanged facts and installation times, matched risk, Viewer authorization and responsive layouts.')
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    for (const machine of machines) await write(`/api/v1/machines/${machine.id}`, { reason: '验收清理' }, 'delete').catch(() => {})
    if (project) await write(`/api/v1/projects/${project.id}/archive`, { reason: '验收清理' }).catch(() => {})
    await browser.close()
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1 })
