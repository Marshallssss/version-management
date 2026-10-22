const { chromium } = require('playwright')
const { readFileSync, mkdirSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  const baseURL = process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080'
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' })
  const api = context.request
  const reason = '界面直接补录历史基线自动验收'
  const startedAt = Date.now()
  const output = path.resolve('artifacts/manual-historical-baseline')
  mkdirSync(output, { recursive: true })
  const call = (url, data, key = randomUUID(), request = api) => request.post(url, { data, headers: { 'Idempotency-Key': key } })
  const read = async response => { assert(response.ok(), `${response.url()}: ${await response.text()}`); return response.status() === 204 ? null : response.json() }
  const write = async (url, data, key, request) => read(await call(url, data, key, request))
  const get = async url => read(await api.get(url))
  const denied = async (response, status, description) => assert.equal(response.status(), status, `${description}: ${await response.text()}`)
  const allProjects = []
  const pageErrors = []
  const openBaselines = async (page, projectId) => {
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto('/')
    await page.evaluate(id => localStorage.setItem('confighub.selected-project-id', id), projectId)
    await page.reload()
    await page.locator('.nav-item').filter({ hasText: /^基线$/ }).click()
  }
  const screenshot = async (page, name, width) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
    await page.evaluate(() => document.fonts.ready)
    const title = page.locator('.manual-history-dialog .ant-modal-title')
    if (await title.isVisible()) await title.click()
    await page.locator('.manual-history-dialog .ant-modal-body').evaluateAll(elements => elements.forEach(element => { element.scrollTop = 0 }))
    const hasDialog = await title.isVisible()
    await page.screenshot({ path: path.join(output, `${name}-${width}.png`), animations: 'disabled', fullPage: !hasDialog })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: page overflow at ${width}px`)
    const dialog = page.getByRole('dialog', { name: '补录历史基线', exact: true })
    if (await dialog.isVisible()) assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 2), `${name}: dialog overflow at ${width}px`)
    if (hasDialog) {
      await dialog.locator('.manual-history-table').scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(output, `${name}-components-${width}.png`), animations: 'disabled' })
      await dialog.locator('.manual-history-actions').scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(output, `${name}-actions-${width}.png`), animations: 'disabled' })
    }
  }
  try {
    await write('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    const token = randomUUID().slice(0, 8)
    const project = await write('/api/v1/projects', { code: `MANUAL-HISTORY-${token}`, name: '界面历史基线补录验收', reason })
    allProjects.push(project)
    const component = async (name, parent) => ({ ...await write(`/api/v1/projects/${project.id}/components`, { name, parentComponentId: parent?.id, reason }), name })
    const root = await component('控制系统')
    const middle = await component('运动控制', root)
    const motor = await component('伺服驱动', middle)
    const driver = await component('设备驱动', root)
    const sensor = await component('采集软件', root)
    const optional = await component('选配模块', root)
    const ui = await component('操作界面')
    const version = async (item, versionNumber, maturity = 'Released') => ({ ...await write(`/api/v1/components/${item.id}/versions`, { versionNumber, maturity, reason }), versionNumber })
    const live = []
    for (const item of [motor, driver, sensor, optional, ui]) live.push({ component: item, version: await version(item, `${item.name}.LIVE`) })
    const standard = await write(`/api/v1/projects/${project.id}/baselines`, { seriesCode: 'LIVE', baselineCode: '当前正式配置', publishImmediately: true, reason })
    await write(`/api/v1/projects/${project.id}/standard`, { configurationBaselineId: standard.id, reason })
    const motorTest = await version(motor, 'SERVO.TEST', 'Testing')
    const sensorTest = await version(sensor, 'SENSOR.TEST', 'Testing')
    const deprecated = await version(driver, 'DRIVER.OLD', 'Deprecated')
    await write(`/api/v1/component-versions/${deprecated.id}/safety`, { state: 'Blocked', reason })
    const existingBefore = new Map()
    for (const item of [motorTest, sensorTest, deprecated, live[4].version]) existingBefore.set(item.id, (await get(`/api/v1/component-versions/${item.id}`)).version)
    const machine = await write('/api/v1/machines', { projectId: project.id, name: '历史补录隔离机台', serialNumber: `MH-${token}`, stage: 'Lab', reason })
    await write(`/api/v1/machines/${machine.id}/target`, { configurationBaselineId: standard.id, reason })
    await write(`/api/v1/machines/${machine.id}/facts`, {
      operationType: 'InitialSnapshot', coverage: 'Full', sourceType: 'acceptance', effectiveAt: new Date().toISOString(), reason,
      items: live.map(item => ({ componentId: item.component.id, versionId: item.version.id }))
    })
    const configurationBefore = await get(`/api/v1/machines/${machine.id}/configuration`)
    const laboratoryBefore = await get(`/api/v1/projects/${project.id}/laboratory-versions`)
    const projectBefore = await get(`/api/v1/projects/${project.id}`)
    const route = `/api/v1/projects/${project.id}/historical-baselines`
    const input = {
      baselineName: '历史评审配置 2020', releasedAt: '2020-05-06 09:30', reason,
      items: [
        { componentId: root.id, versionNumber: null, notConfigured: false },
        { componentId: middle.id, versionNumber: null, notConfigured: false },
        { componentId: motor.id, versionNumber: '001.02.OLD', notConfigured: false },
        { componentId: driver.id, versionNumber: 'DRIVER.OLD', notConfigured: false },
        { componentId: sensor.id, versionNumber: 'SENSOR.TEST', notConfigured: false },
        { componentId: optional.id, versionNumber: null, notConfigured: true },
        { componentId: ui.id, versionNumber: live[4].version.versionNumber, notConfigured: false }
      ]
    }
    const foreign = await write('/api/v1/projects', { code: `MH-OTHER-${token}`, name: '跨项目隔离验收', reason })
    allProjects.push(foreign)
    const foreignComponent = await write(`/api/v1/projects/${foreign.id}/components`, { name: '外部组件', reason })
    const invalid = [
      ['missing component', { ...input, items: input.items.filter(item => item.componentId !== optional.id) }],
      ['missing category', { ...input, items: input.items.filter(item => item.componentId !== root.id) }],
      ['foreign component', { ...input, items: [...input.items.slice(0, -1), { componentId: foreignComponent.id, versionNumber: 'BAD', notConfigured: false }] }],
      ['duplicate component', { ...input, items: [...input.items, input.items[2]] }],
      ['future release', { ...input, releasedAt: '2100-01-01 00:00' }],
      ['ambiguous time format', { ...input, releasedAt: '05/06/2020' }],
      ['duplicate name', { ...input, baselineName: '当前正式配置' }],
      ['blank name', { ...input, baselineName: ' ' }],
      ['blank reason', { ...input, reason: ' ' }],
      ['category version', { ...input, items: input.items.map(item => item.componentId === root.id ? { ...item, versionNumber: 'CATEGORY.VERSION' } : item) }],
      ['category absent', { ...input, items: input.items.map(item => item.componentId === root.id ? { ...item, notConfigured: true } : item) }],
      ['missing version', { ...input, items: input.items.map(item => item.componentId === motor.id ? { ...item, versionNumber: null } : item) }],
      ['absent and version', { ...input, items: input.items.map(item => item.componentId === motor.id ? { ...item, notConfigured: true } : item) }],
      ['all unconfigured', { ...input, items: input.items.map(item => [root.id, middle.id].includes(item.componentId) ? item : { ...item, versionNumber: null, notConfigured: true }) }]
    ]
    for (const [description, body] of invalid) await denied(await call(`${route}/preview`, body), 400, description)
    assert.deepEqual((await get(`/api/v1/projects/${project.id}`)).components, projectBefore.components, 'Invalid input cannot create versions')
    assert.equal((await get(`/api/v1/projects/${project.id}/baselines`)).length, 1)
    const previewKey = randomUUID()
    const preview = await write(`${route}/preview`, input, previewKey)
    assert.deepEqual(await write(`${route}/preview`, input, previewKey), preview, 'Preview replays the same batch')
    await denied(await call(`${route}/preview`, { ...input, baselineName: 'changed' }, previewKey), 409, 'Preview idempotency payload conflict')
    assert.equal(preview.records.length, 1)
    const record = preview.records[0]
    assert.equal(new Date(record.releasedAt).toISOString(), '2020-05-06T01:30:00.000Z')
    assert.equal(record.items.length, input.items.length)
    assert(record.items.find(item => item.componentId === motor.id).willCreate)
    assert.equal(record.items.find(item => item.componentId === driver.id).currentMaturity, 'Deprecated')
    assert.equal(record.items.find(item => item.componentId === driver.id).currentSafety, 'Blocked')
    assert.equal(record.items.find(item => item.componentId === sensor.id).currentMaturity, 'Testing')
    assert.equal(record.items.find(item => item.componentId === motor.id).parentComponentId, middle.id)
    assert(record.items.find(item => item.componentId === root.id).isCategory)
    assert.equal((await get(`/api/v1/projects/${project.id}/baselines`)).length, 1, 'Preview does not create a baseline')
    assert.deepEqual((await get(`/api/v1/projects/${project.id}`)).components, projectBefore.components, 'Preview does not create versions')
    await denied(await call(`/api/v1/projects/${foreign.id}/historical-baselines/${preview.id}/commit`, { reason }), 404, 'Batch belongs to its project')
    await denied(await call(`/api/v1/imports/${preview.id}/commit`, { reason }), 409, 'Legacy import cannot bypass historical confirmation')

    for (const role of ['Viewer', 'SeniorEngineer']) {
      const userName = `mh-${role.toLowerCase()}-${token}`, password = randomUUID()
      await write('/api/v1/admin/users', { userName, password, displayName: `补录权限验收 ${role}`, role, reason })
      const limited = await browser.newContext({ baseURL })
      await read(await limited.request.post('/api/v1/auth/login', { data: { userName, password } }))
      await denied(await call(`${route}/preview`, input, randomUUID(), limited.request), 403, `${role} cannot preview`)
      await denied(await call(`${route}/${preview.id}/commit`, { reason }, randomUUID(), limited.request), 403, `${role} cannot commit`)
      const limitedPage = await limited.newPage()
      await openBaselines(limitedPage, project.id)
      await limitedPage.getByText('历史快照', { exact: true }).first().waitFor()
      assert.equal(await limitedPage.getByRole('button', { name: '补录历史基线', exact: true }).count(), 0, `${role} cannot see entry action`)
      await limited.close()
    }

    const adminName = `mh-admin-${token}`, adminPassword = randomUUID()
    const adminUser = await write('/api/v1/admin/users', { userName: adminName, password: adminPassword, displayName: '历史补录管理员', role: 'Admin', reason })
    const adminContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' })
    await read(await adminContext.request.post('/api/v1/auth/login', { data: { userName: adminName, password: adminPassword } }))
    const commitKey = randomUUID()
    const committed = await write(`${route}/${preview.id}/commit`, { reason }, commitKey, adminContext.request)
    assert.deepEqual(await write(`${route}/${preview.id}/commit`, { reason }, commitKey), committed, 'Commit is idempotent')
    await denied(await call(`${route}/${preview.id}/commit`, { reason: 'changed confirmation' }, commitKey), 409, 'Commit idempotency payload conflict')
    const retried = await write(`${route}/${preview.id}/commit`, { reason })
    assert.equal(retried.records[0].baselineId, committed.records[0].baselineId, 'A new key cannot duplicate a committed batch')
    await write(`/api/v1/admin/users/${adminUser.id}/role`, { role: 'SeniorEngineer', reason })
    await denied(await call(`${route}/${preview.id}/commit`, { reason }, commitKey, adminContext.request), 403, 'Revoked admin permission is checked before replay')
    await write(`/api/v1/admin/users/${adminUser.id}/role`, { role: 'Admin', reason })
    const detail = await get(`/api/v1/baselines/${committed.records[0].baselineId}`)
    assert(detail.baseline.isHistorical)
    assert.equal(detail.baseline.state, 'Released')
    assert.equal(new Date(detail.baseline.releasedAt).toISOString(), '2020-05-06T01:30:00.000Z')
    assert(new Date(detail.baseline.createdAt).getTime() >= startedAt - 1000, 'Baseline creation is real recording time')
    assert.equal(detail.baseline.releaseRecordedAt, null, 'Historical import does not masquerade as a current release')
    const motorSnapshot = detail.items.find(item => item.componentId === motor.id)
    const motorVersion = (await get(`/api/v1/component-versions/${motorSnapshot.versionId}`)).version
    assert.equal(motorVersion.maturity, 'Released')
    assert.equal(new Date(motorVersion.createdAt).toISOString(), '2020-05-06T01:30:00.000Z')
    assert.equal(motorVersion.versionNumber, '001.02.OLD', 'Opaque versions preserve leading zeroes and dots')
    assert.equal(motorSnapshot.parentItemId, detail.items.find(item => item.componentId === middle.id).id)
    assert.equal(detail.items.find(item => item.componentId === driver.id).historicalVersionState, 'HistoricalReleased')
    assert.equal(detail.items.find(item => item.componentId === optional.id).notConfigured, true)
    assert.equal(detail.items.find(item => item.componentId === optional.id).versionId, null)
    for (const [id, before] of existingBefore) assert.deepEqual((await get(`/api/v1/component-versions/${id}`)).version, before, 'Existing version lifecycle and timestamps stay unchanged')
    assert.deepEqual(await get(`/api/v1/machines/${machine.id}/configuration`), configurationBefore)
    const laboratoryAfter = await get(`/api/v1/projects/${project.id}/laboratory-versions`)
    assert.deepEqual(laboratoryAfter.targets, laboratoryBefore.targets)
    for (const before of laboratoryBefore.versions) assert.deepEqual(laboratoryAfter.versions.find(item => item.versionId === before.versionId), before, 'Existing laboratory use and validation remain unchanged')
    const historicalLabEntry = laboratoryAfter.versions.find(item => item.versionId === motorVersion.id)
    assert.deepEqual(historicalLabEntry.currentUses, [], 'No fabricated laboratory use')
    assert.deepEqual(historicalLabEntry.validations, [], 'No fabricated laboratory validation')
    assert.equal((await get(`/api/v1/projects/${project.id}/standard`)).baselineId, standard.id)
    const audit = await get(`/api/v1/audit?entityId=${motorVersion.id}`)
    const registered = audit.find(item => item.action === 'HistoricalComponentVersionRegistered')
    assert(registered && new Date(registered.occurredAt).getTime() >= startedAt - 1000, 'Audit retains the true recording time')
    assert.equal((await get(`/api/v1/projects/${project.id}/baselines`)).length, 2)
    await denied(await call(`${route}/preview`, input), 400, 'Already imported baseline names cannot duplicate history')

    // Confirmation revalidates current lifecycle, newly registered versions and the component tree.
    const stale = await write(`${route}/preview`, { ...input, baselineName: '过期状态预览' })
    await write(`/api/v1/component-versions/${deprecated.id}/safety`, { state: 'Clear', reason })
    await denied(await call(`${route}/${stale.id}/commit`, { reason }), 409, 'Safety changed after preview')
    await write(`/api/v1/component-versions/${deprecated.id}/safety`, { state: 'Blocked', reason })
    const missingInput = { ...input, baselineName: '过期新增版本预览', items: input.items.map(item => item.componentId === motor.id ? { ...item, versionNumber: 'RACE.OLD' } : item) }
    const missingPreview = await write(`${route}/preview`, missingInput)
    await version(motor, 'RACE.OLD')
    await denied(await call(`${route}/${missingPreview.id}/commit`, { reason }), 409, 'Missing version was independently created after preview')
    assert.equal((await get(`/api/v1/projects/${project.id}/baselines`)).length, 2, 'Stale previews have no baseline side effects')

    const concurrent = await write(`${route}/preview`, { ...input, baselineName: '双击提交历史' })
    const doubled = await Promise.all([write(`${route}/${concurrent.id}/commit`, { reason }), write(`${route}/${concurrent.id}/commit`, { reason })])
    assert.equal(doubled[0].records[0].baselineId, doubled[1].records[0].baselineId, 'Concurrent confirmation creates exactly one baseline')
    assert.equal((await get(`/api/v1/projects/${project.id}/baselines`)).length, 3)

    const page = await adminContext.newPage()
    await openBaselines(page, project.id)
    await page.getByRole('button', { name: '补录历史基线', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '补录历史基线', exact: true })
    await dialog.getByLabel('历史基线名称', { exact: true }).fill('界面补录历史 2019')
    const time = dialog.getByLabel('整体发布时间（北京时间）', { exact: true })
    await time.fill(await time.getAttribute('type') === 'datetime-local' ? '2019-03-04T10:20' : '2019-03-04 10:20')
    await dialog.getByLabel('补录原因', { exact: true }).fill('补录已评审的真实历史版本关系')
    for (const item of [motor, driver, sensor, ui]) {
      const value = item.id === motor.id ? 'UI.OLD.01' : input.items.find(row => row.componentId === item.id).versionNumber
      await dialog.getByLabel(`${item.name} 历史版本`, { exact: true }).fill(value)
    }
    await dialog.getByLabel(`${optional.name} 当时未配置`, { exact: true }).check()
    const versionInputStyle = await dialog.getByLabel(`${motor.name} 历史版本`, { exact: true }).evaluate(element => ({ border: getComputedStyle(element).borderLeftWidth, minHeight: getComputedStyle(element).minHeight }))
    assert.deepEqual(versionInputStyle, { border: '0px', minHeight: '0px' }, 'Autocomplete does not inherit a second native input border')
    assert.equal(await dialog.getByLabel(`${root.name} 历史版本`, { exact: true }).count(), 0, 'Category nodes cannot accept versions')
    assert.equal(await dialog.getByLabel(`${middle.name} 历史版本`, { exact: true }).count(), 0)
    for (const width of [1440, 390]) await screenshot(page, 'input', width)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await dialog.getByRole('button', { name: /校验并预览$/ }).click()
    await dialog.getByRole('checkbox', { name: /确认这套配置曾评审发布/ }).waitFor()
    assert(await dialog.getByRole('button', { name: /确认补录历史基线$/ }).isDisabled(), 'Explicit historical confirmation is required')
    await dialog.getByRole('checkbox', { name: /确认这套配置曾评审发布/ }).check()
    await dialog.getByRole('button', { name: /返回修改$/ }).click()
    await dialog.getByLabel(`${motor.name} 历史版本`, { exact: true }).fill('UI.OLD.02')
    assert.equal(await dialog.getByRole('button', { name: /确认补录历史基线$/ }).count(), 0, 'Edited input cannot reuse its old confirmation')
    await dialog.getByRole('button', { name: /校验并预览$/ }).click()
    await dialog.getByRole('checkbox', { name: /确认这套配置曾评审发布/ }).waitFor()
    assert(await dialog.getByRole('button', { name: /确认补录历史基线$/ }).isDisabled(), 'New preview resets the acknowledgement')
    await dialog.getByText('UI.OLD.02', { exact: true }).waitFor()
    for (const width of [1440, 390]) await screenshot(page, 'preview', width)
    await dialog.getByRole('checkbox', { name: /确认这套配置曾评审发布/ }).check()
    await dialog.getByRole('button', { name: /确认补录历史基线$/ }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByText('历史补录快照', { exact: true }).waitFor()
    await page.getByText('UI.OLD.02', { exact: true }).first().waitFor()
    const blockedSnapshotVersion = page.locator('.baseline-snapshot .snapshot-tree-item').filter({ has: page.getByText(driver.name, { exact: true }) }).locator('small').first()
    assert.equal(await blockedSnapshotVersion.textContent(), 'DRIVER.OLD')
    assert((await blockedSnapshotVersion.boundingBox()).height >= 14, 'Blocked historical versions remain readable beside risk warnings')
    for (const width of [1440, 390]) await screenshot(page, 'completed', width)
    const uiBaseline = (await get(`/api/v1/projects/${project.id}/baselines`)).find(item => item.code === '界面补录历史 2019')
    assert(uiBaseline, 'UI save selects the newly created historical snapshot')
    assert.equal(new Date((await get(`/api/v1/baselines/${uiBaseline.id}`)).baseline.releasedAt).toISOString(), '2019-03-04T02:20:00.000Z')
    const afterUi = await get(`/api/v1/projects/${project.id}`)
    const motorAfterUi = afterUi.components.find(item => item.id === motor.id)
    assert(!motorAfterUi.versions.some(item => item.versionNumber === 'UI.OLD.01'), 'Discarded preview cannot create versions')
    const uiVersion = motorAfterUi.versions.find(item => item.versionNumber === 'UI.OLD.02')
    assert.equal(new Date(uiVersion.createdAt).toISOString(), '2019-03-04T02:20:00.000Z')
    const staleTree = await write(`${route}/preview`, { ...input, baselineName: '过期组件树预览' })
    await component('新加入组件')
    const treeResponse = await call(`${route}/${staleTree.id}/commit`, { reason })
    assert([400, 409].includes(treeResponse.status()), `Stale component tree must fail: ${await treeResponse.text()}`)
    assert.equal((await get(`/api/v1/projects/${project.id}/baselines`)).length, 4)
    assert.deepEqual(pageErrors, [])
    console.log('Manual historical baseline passed: complete hierarchical input, Beijing release time, historical missing-version backfill, preserved existing lifecycle/risk/time, unchanged Lab/machine/standard, real-time audit, admin-only API/UI, validation failures, stale-preview rejection, idempotent and concurrent confirmation, editable re-preview, desktop/mobile screenshots and selected snapshot.')
  } finally {
    for (const project of allProjects) await call(`/api/v1/projects/${project.id}/archive`, { reason: '历史基线补录验收结束' }).catch(() => {})
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
