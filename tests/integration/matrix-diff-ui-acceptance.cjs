const { chromium } = require('playwright')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const baseURL = process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080'
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } })
  const api = context.request
  const token = randomUUID().slice(0, 8)
  const output = path.resolve('artifacts/matrix-diff-ui')
  mkdirSync(output, { recursive: true })
  const workbook = path.join(output, `${token}.xlsx`)
  const fixture = (changes = {}) => JSON.parse(execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/integration/matrix-workbook-fixture.ps1'),
    '-Path', workbook, '-CellsJson', JSON.stringify(changes),
  ], { encoding: 'utf8', windowsHide: true }).replace(/^\uFEFF/, ''))
  const write = async (url, data, method = 'POST') => {
    const response = await api.fetch(url, { method, data, headers: { 'Idempotency-Key': randomUUID() } })
    assert(response.ok(), `${url}: ${await response.text()}`)
    return response.status() === 204 ? null : response.json()
  }
  const get = async url => { const response = await api.get(url); assert(response.ok(), await response.text()); return response.json() }
  const projects = []
  let page
  try {
    await write('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    const project = await write('/api/v1/projects', { code: `DIFF ${token}`, name: `版本变更验收 ${token}`, reason: '自动验收' })
    projects.push(project)
    const other = await write('/api/v1/projects', { code: `DIFF OTHER ${token}`, name: `独立项目 ${token}`, reason: '自动验收' })
    projects.push(other)
    const route = `/api/v1/projects/${project.id}/matrix-import`
    const group = await write(`/api/v1/projects/${project.id}/components`, { name: '控制系统分类', reason: '验收' })
    const main = await write(`/api/v1/projects/${project.id}/components`, { name: '主控', parentComponentId: group.id, reason: '验收' })
    const driver = await write(`/api/v1/projects/${project.id}/components`, { name: '驱动', parentComponentId: group.id, reason: '验收' })
    const ui = await write(`/api/v1/projects/${project.id}/components`, { name: '操作界面', reason: '验收' })
    for (const component of [main, driver, ui]) await write(`/api/v1/components/${component.id}/versions`, { versionNumber: 'V1.0', maturity: 'Released', reason: '原始标准' })
    const baseline = await write(`/api/v1/projects/${project.id}/baselines`, { seriesCode: 'DIFF', baselineCode: `DIFF-${token}`, publishImmediately: true, reason: '原始标准' })
    await write(`/api/v1/projects/${project.id}/standard`, { configurationBaselineId: baseline.id, reason: '原始标准' })
    const template = await write(`${route}/templates`, { reason: '变更导航验收模板' })
    const download = await api.get(template.downloadUrl)
    assert(download.ok(), await download.text())
    writeFileSync(workbook, await download.body())
    const cells = fixture()
    assert.match(cells.A1, /^ConfigHub\.Matrix\.v2:/)
    const row = component => Object.entries(cells).find(([cell, value]) => /^A\d+$/.test(cell) && value === component.id)?.[0].slice(1)
    const mainRow = row(main), driverRow = row(driver)
    assert(mainRow && driverRow, 'The vertical template binds each editable component row')
    fixture({ D5: '2026-09-17', D6: '主控通信修复', [`D${mainRow}`]: 'V2.0', E5: '2026-09-18', E6: '驱动联调', [`E${driverRow}`]: 'V3.0' })
    const run = await write(`${route}/scan`, { templateId: template.id, fileName: path.basename(workbook), contentBase64: readFileSync(workbook).toString('base64'), reason: '扫描链接验收' })
    assert.equal(run.status, 'Succeeded', JSON.stringify(run))
    assert.equal(run.importedCount, 2)
    const workspace = await get(route)
    const [first, second] = workspace.combinations.toSorted((a, b) => a.sequenceNo - b.sequenceNo)
    const changedMain = first.items.find(item => item.componentId === main.id)
    assert.equal(changedMain.previousVersionNumber, 'V1.0')
    assert.equal(changedMain.versionNumber, 'V2.0')
    assert.equal(first.sourceLabel, 'D 列')
    assert(run.messages.some(message => message.combinationId === first.id && message.componentId === main.id), 'Scan response links each change to its combination and component')
    assert.equal((await api.get(`/api/v1/projects/${other.id}/matrix-import/combinations/${first.id}`)).status(), 404, 'Combination detail must enforce project scope')

    page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    // Keep the real older combination in the database but outside the limited list.
    await page.route(`**${route}`, async intercepted => {
      const response = await intercepted.fetch()
      const data = await response.json()
      data.combinations = data.combinations.filter(item => item.id !== first.id)
      await intercepted.fulfill({ response, json: data })
    })
    const enterImport = async () => {
      await page.goto('/')
      await page.evaluate(id => localStorage.setItem('confighub.selected-project-id', id), project.id)
      await page.reload()
      await page.locator('.nav-item').filter({ hasText: /^版本导入$/ }).click()
      await page.locator('.matrix-import-workspace').getByRole('heading', { name: '版本导入', exact: true }).waitFor()
      await page.getByLabel('测试组合详情', { exact: true }).waitFor()
    }
    const openFirstChange = async () => {
      await page.getByRole('button', { name: /^扫描记录/ }).click()
      await page.getByRole('link', { name: '主控 从 V1.0 变为 V2.0', exact: true }).click()
    }
    await enterImport()
    assert.match(await page.getByLabel('测试组合详情', { exact: true }).innerText(), new RegExp(`第 ${second.sequenceNo} 套测试组合`))
    const fetchedDetail = page.waitForResponse(response => response.url().endsWith(`${route}/combinations/${first.id}`))
    await openFirstChange()
    assert((await fetchedDetail).ok(), 'An older scan link fetches its exact combination')
    const node = page.locator(`.matrix-tree-node[data-component-id="${main.id}"]`)
    await node.filter({ hasText: 'V2.0' }).waitFor()
    assert.match(await page.getByLabel('测试组合详情', { exact: true }).innerText(), new RegExp(`第 ${first.sequenceNo} 套测试组合`))
    assert.equal(await node.locator('.matrix-previous-version').innerText(), 'V1.0')
    assert.equal(await node.locator('.matrix-current-version').innerText(), 'V2.0')
    assert.equal(await node.evaluate(element => document.activeElement === element), true, 'Scan navigation focuses the changed component')
    assert.equal(await node.evaluate(element => { const [red, green, blue] = getComputedStyle(element).backgroundColor.match(/\d+/g).map(Number); return red > green && red > blue }), true, 'Changed components have a visible red background')
    assert.equal(await page.locator(`.matrix-tree-node[data-component-id="${driver.id}"]`).locator('.matrix-previous-version').count(), 0, 'Unchanged components are not represented as changes')
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Diff and navigation fit mobile')
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })

    await write(`/api/v1/component-versions/${changedMain.versionId}`, { reason: '管理员删除误导入版本验收' }, 'DELETE')
    await enterImport()
    await openFirstChange()
    await node.getByText('版本已删除 · 保留历史快照', { exact: true }).waitFor()
    assert.equal(await node.getByRole('button').count(), 0, 'Deleted historical versions are not navigable')
    assert.equal(await node.locator('.matrix-current-version').innerText(), 'V2.0', 'Deletion retains the frozen version label')

    const detailPattern = `**${route}/combinations/${first.id}`
    await page.route(detailPattern, intercepted => intercepted.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '验收模拟：历史暂不可读' }) }))
    await enterImport()
    await openFirstChange()
    await page.getByRole('alert').filter({ hasText: '无法读取所选测试组合' }).waitFor()
    assert.equal(await page.getByLabel('测试组合详情', { exact: true }).count(), 0, 'Failed detail fetch cannot silently show another combination')
    await page.unroute(detailPattern)
    await page.getByRole('button', { name: '重新读取', exact: true }).click()
    await page.getByLabel('测试组合详情', { exact: true }).waitFor()
    assert.match(await page.getByLabel('测试组合详情', { exact: true }).innerText(), new RegExp(`第 ${first.sequenceNo} 套测试组合`))
    await page.locator('.project-switch').click()
    await page.getByRole('dialog').getByLabel('项目', { exact: true }).selectOption(other.id)
    await page.getByText('尚无测试组合。填写项目模板并扫描后，组合记录将显示在这里。', { exact: true }).waitFor()
    assert.equal(await page.locator('.matrix-tree-node').count(), 0, 'Changing projects clears previously focused historical details')
    assert.deepEqual(errors, [])
    console.log('Matrix diff UI acceptance passed: vertical XLSX, explicit changes, exact older-combination navigation, focused red before/after nodes, deleted snapshots, failure/retry and project isolation.')
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    for (const project of projects) await write(`/api/v1/projects/${project.id}/archive`, { reason: '变更界面自动验收结束' }).catch(() => {})
    await browser.close()
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1 })
