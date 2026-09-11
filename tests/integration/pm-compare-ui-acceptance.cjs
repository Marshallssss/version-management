const { chromium } = require('playwright')
const { readFileSync, mkdirSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext({ baseURL: process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080', viewport: { width: 1366, height: 900 } })
  const output = path.resolve('artifacts/pm-compare-ui')
  mkdirSync(output, { recursive: true })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const write = async (url, data, method = 'POST') => {
    const response = await context.request.fetch(url, { method, data, headers: { 'Idempotency-Key': randomUUID() } })
    assert(response.ok(), `${url}: ${await response.text()}`)
    return response.status() === 204 ? null : response.json()
  }
  const openCompare = async () => {
    await page.goto('/')
    await page.locator('.nav-item').filter({ hasText: '配置比对' }).click()
    await page.getByLabel('左侧配置', { exact: true }).waitFor()
  }
  const selectSide = async (side, kind, id) => {
    await page.getByRole('group', { name: `${side}类型`, exact: true }).getByRole('button', { name: kind, exact: true }).click()
    const select = page.getByLabel(`${side}配置`, { exact: true })
    await select.locator(`option[value="${id}"]`).waitFor({ state: 'attached' })
    await select.selectOption(id)
  }
  const openChamber = async number => {
    const tab = page.getByRole('tablist', { name: '配置范围', exact: true }).getByRole('tab', { name: `PM${number}`, exact: true })
    await tab.click()
    const panel = page.getByRole('tabpanel', { name: `PM${number} 配置对比`, exact: true })
    await panel.waitFor()
    await panel.locator('.chamber-comparison-table tbody tr').first().waitFor()
    return panel
  }
  const summaryHas = async (summary, ...labels) => {
    for (const label of labels) await summary.filter({ hasText: label }).waitFor()
    const text = await summary.innerText()
    for (const label of labels) assert(text.includes(label), `Missing summary label ${label}: ${text}`)
    return text
  }
  const assertNoChamberTabs = async () => {
    await page.locator('.comparison-table tbody tr').first().waitFor()
    assert.equal(await page.getByRole('tab', { name: /^PM[1-6]$/ }).count(), 0)
    assert.equal(await page.locator('.chamber-comparison-table:visible').count(), 0)
  }
  let project
  try {
    await write('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    project = await write('/api/v1/projects', { code: 'PMCOMPAREUI-' + randomUUID().slice(0, 8), name: '整机与腔室配置交叉比较验收项目', reason: '自动化验收' })
    const component = await write(`/api/v1/projects/${project.id}/components`, { name: '工艺控制器与腔室通信程序完整名称', reason: '验收' })
    const v1 = await write(`/api/v1/components/${component.id}/versions`, { versionNumber: 'V1.0-baseline', maturity: 'Released', reason: '验收' })
    const baseline = await write(`/api/v1/projects/${project.id}/baselines`, { seriesCode: 'PMUI', baselineCode: 'BL-1', publishImmediately: true, reason: '验收' })
    const nextBaseline = await write(`/api/v1/projects/${project.id}/baselines`, { seriesCode: 'PMUI', baselineCode: 'BL-2', publishImmediately: true, reason: '验收' })
    const v2 = await write(`/api/v1/components/${component.id}/versions`, { versionNumber: 'V2.0-laboratory', maturity: 'Testing', reason: '验收' })
    await write(`/api/v1/component-versions/${v2.id}/safety`, { state: 'Blocked', reason: '验证版本匹配与安全风险相互独立' })
    const machines = []
    for (const [name, numbers] of [['一号实验室机台完整名称', [1, 6]], ['二号实验室机台完整名称', [1]], ['无腔室机台', []]]) {
      const machine = await write('/api/v1/machines', {
        projectId: project.id, serialNumber: 'PMUI-' + randomUUID().slice(0, 8), name, stage: 'Lab', owner: '测试工程师',
        chambers: numbers.map(number => ({ number, stage: 'Lab' })), reason: '验收'
      })
      machines.push(machine)
      await write(`/api/v1/machines/${machine.id}/facts`, {
        operationType: 'InitialSnapshot', coverage: 'Full', sourceType: 'Manual', reason: '整机配置与基线一致',
        items: [{ componentId: component.id, versionId: v1.id, absent: false, knownInstalledAt: null }]
      })
    }
    const setOverride = machine => write(`/api/v1/machines/${machine.id}/chambers/1/configuration`, {
      items: [{ componentId: component.id, versionId: v2.id }], reason: 'PM1 独立实验室配置'
    }, 'PUT')
    await setOverride(machines[0])
    await page.goto('/')
    await page.evaluate(id => localStorage.setItem('confighub.selected-project-id', id), project.id)
    await openCompare()
    await selectSide('左侧', '机台', machines[0].id)
    await selectSide('右侧', '基线', baseline.id)
    await page.locator('.comparison-table tbody tr').first().waitFor()
    const wholeSummary = page.locator('.compare-summary').filter({ hasNot: page.locator('.chamber-comparison-summary') }).first()
    await summaryHas(wholeSummary, '版本匹配：匹配', '风险：无')
    assert.equal(await page.getByRole('tab', { name: '整机', exact: true }).getAttribute('aria-selected'), 'true')
    assert.equal(await page.getByRole('tablist', { name: '配置范围', exact: true }).getByRole('tab').count(), 3)
    let panel = await openChamber(1)
    await summaryHas(panel.locator('.chamber-comparison-summary'), '版本匹配：不匹配', '风险：严重')
    let cells = panel.locator('.chamber-comparison-table tbody tr').first().locator('td')
    assert((await cells.nth(0).innerText()).includes('V2.0-laboratory'))
    assert((await cells.nth(0).innerText()).includes('PM 特例'))
    assert((await cells.nth(1).innerText()).includes('V1.0-baseline'))
    assert((await cells.nth(1).innerText()).includes('基线快照'))
    panel = await openChamber(6)
    await summaryHas(panel.locator('.chamber-comparison-summary'), '版本匹配：匹配', '风险：无')
    assert((await panel.locator('.chamber-comparison-table').innerText()).includes('沿用整机'))
    assert(!(await panel.innerText()).includes('未安装'), 'A baseline has no chamber-installation state and must not be shown as an uninstalled PM.')
    await page.getByRole('button', { name: '交换左右配置', exact: true }).click()
    assert.equal(await page.getByLabel('左侧配置', { exact: true }).inputValue(), baseline.id)
    assert.equal(await page.getByLabel('右侧配置', { exact: true }).inputValue(), machines[0].id)
    panel = await openChamber(1)
    await summaryHas(panel.locator('.chamber-comparison-summary'), '版本匹配：不匹配', '风险：严重')
    cells = panel.locator('.chamber-comparison-table tbody tr').first().locator('td')
    assert((await cells.nth(0).innerText()).includes('V1.0-baseline'))
    assert((await cells.nth(0).innerText()).includes('基线快照'))
    assert((await cells.nth(1).innerText()).includes('V2.0-laboratory'))
    assert((await cells.nth(1).innerText()).includes('PM 特例'))

    await selectSide('左侧', '机台', machines[0].id)
    await selectSide('右侧', '机台', machines[1].id)
    panel = await openChamber(6)
    await summaryHas(panel.locator('.chamber-comparison-summary'), '版本匹配：不匹配')
    cells = panel.locator('.chamber-comparison-table tbody tr').first().locator('td')
    assert((await cells.nth(0).innerText()).includes('沿用整机'))
    assert((await cells.nth(1).innerText()).includes('未安装'))
    for (const width of [1366, 768, 390]) {
      await page.setViewportSize({ width, height: 900 })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `PM comparison must not overflow the page at ${width}px`)
      await page.screenshot({ path: path.join(output, `compare-pm6-${width}.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 1366, height: 900 })
    await setOverride(machines[1])
    await openCompare()
    await selectSide('左侧', '机台', machines[0].id)
    await selectSide('右侧', '机台', machines[1].id)
    await page.locator('.comparison-table tbody tr').first().waitFor()
    await summaryHas(page.locator('.compare-summary').first(), '版本匹配：匹配', '风险：无')
    panel = await openChamber(1)
    await summaryHas(panel.locator('.chamber-comparison-summary'), '版本匹配：匹配', '风险：严重')
    assert.equal(await panel.locator('.chamber-comparison-table tbody tr.changed').count(), 0)
    await page.getByRole('checkbox', { name: '只看差异', exact: true }).check()
    await panel.locator('.chamber-comparison-table tbody tr').waitFor({ state: 'detached' })
    await summaryHas(panel.locator('.chamber-comparison-summary'), '版本匹配：匹配', '风险：严重')
    await page.screenshot({ path: path.join(output, 'compare-matched-critical.png'), fullPage: true })
    await page.getByRole('checkbox', { name: '只看差异', exact: true }).uncheck()

    await selectSide('左侧', '机台', machines[2].id)
    await selectSide('右侧', '基线', baseline.id)
    await assertNoChamberTabs()
    await selectSide('左侧', '基线', baseline.id)
    await selectSide('右侧', '基线', nextBaseline.id)
    await assertNoChamberTabs()
    await summaryHas(page.locator('.compare-summary').first(), '版本匹配：匹配', '风险：此对比不评估风险')
    assert.deepEqual(errors, [])
    console.log('PM comparison UI passed: independent whole-machine/PM results, inherited and explicit sources, both baseline orientations, uninstalled PM, matched-but-critical risk, difference filtering, no-PM/baseline-only views and desktop/tablet/mobile layouts.')
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    if (project) await write(`/api/v1/projects/${project.id}/archive`, { reason: 'PM 比较界面验收结束' }).catch(() => {})
    await browser.close()
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1 })
