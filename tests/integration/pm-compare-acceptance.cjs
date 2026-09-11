const { request } = require('playwright')
const { readFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const baseURL = process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080'
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  const api = await request.newContext({ baseURL })
  const projects = []; const machines = []
  const call = (url, data, method = 'POST', client = api) => client.fetch(url, { method, data, headers: { 'Idempotency-Key': randomUUID() } })
  const write = async (url, data, method = 'POST') => {
    const response = await call(url, data, method)
    assert(response.ok(), `${url}: ${await response.text()}`)
    return response.status() === 204 ? null : response.json()
  }
  const get = async url => {
    const response = await api.get(url)
    assert(response.ok(), `${url}: ${await response.text()}`)
    return response.json()
  }
  const createProject = async name => {
    const project = await write('/api/v1/projects', { code: 'PMCOMPARE-' + randomUUID().slice(0, 8), name, reason: '自动化验收' })
    projects.push(project.id); return project
  }
  const createMachine = async (projectId, name, numbers) => {
    const machine = await write('/api/v1/machines', {
      projectId, serialNumber: randomUUID(), name, owner: '验收工程师', stage: 'Lab',
      chambers: numbers.map(number => ({ number, stage: 'Lab' })), reason: 'PM 比较验收'
    })
    machines.push(machine.id); return machine
  }
  const record = (machineId, items, coverage = 'Partial', operationType = 'Observation') => write(`/api/v1/machines/${machineId}/facts`, {
    operationType, coverage, sourceType: 'Manual', reason: 'PM 继承配置验收',
    items: items.map(([componentId, versionId]) => ({ componentId, versionId, absent: versionId === null, knownInstalledAt: null }))
  })
  const override = (machineId, number, items) => write(`/api/v1/machines/${machineId}/chambers/${number}/configuration`, {
    items: items.map(([componentId, versionId]) => ({ componentId, versionId })), reason: 'PM 特例与恢复沿用验收'
  }, 'PUT')
  const equipment = (machineId, numbers) => write(`/api/v1/machines/${machineId}/equipment`, {
    owner: '验收工程师', stage: 'Lab', chambers: numbers.map(number => ({ number, stage: 'Lab' })), reason: 'PM 拆装验收'
  }, 'PUT')
  const chamber = (comparison, number) => {
    const result = comparison.chambers.find(item => item.number === number)
    assert(result, `Missing PM${number} partition`); return result
  }
  const item = (comparison, number, componentId) => {
    const result = chamber(comparison, number).items.find(value => value.componentId === componentId)
    assert(result, `Missing PM${number} component`); return result
  }
  try {
    await write('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    const project = await createProject('整机与 PM 交叉比较验收')
    const control = await write(`/api/v1/projects/${project.id}/components`, { name: '控制软件原名称', reason: '验收' })
    const driver = await write(`/api/v1/projects/${project.id}/components`, { name: '驱动软件', reason: '验收' })
    const version = (componentId, versionNumber, maturity = 'Released') => write(`/api/v1/components/${componentId}/versions`, { versionNumber, maturity, reason: '验收' })
    const control1 = await version(control.id, 'C1')
    const driver1 = await version(driver.id, 'D1')
    const baseline = await write(`/api/v1/projects/${project.id}/baselines`, { seriesCode: 'PMCOMPARE', baselineCode: 'BL-1', publishImmediately: true, reason: '验收' })
    const control2 = await version(control.id, 'C2-lab', 'Testing')
    const driver2 = await version(driver.id, 'D2-lab', 'Testing')
    const left = await createMachine(project.id, '左侧机台', [1, 6])
    const right = await createMachine(project.id, '右侧机台', [1, 2])
    const unobserved = await createMachine(project.id, '未观察机台', [1])
    const noPm = await createMachine(project.id, '无腔室机台', [])
    const initial = [[control.id, control1.id], [driver.id, driver1.id]]
    await record(left.id, initial, 'Full', 'InitialSnapshot')
    await record(right.id, initial, 'Full', 'InitialSnapshot')
    const compare = () => get(`/api/v1/machines/${left.id}/compare/${right.id}`)
    const toBaseline = () => get(`/api/v1/machines/${left.id}/compare-baseline/${baseline.id}`)

    await override(left.id, 1, [[control.id, control2.id]])
    let result = await compare()
    assert.equal(result.matchStatus, 'Matched', 'PM differences must not modify the whole-machine match.')
    assert.equal(result.riskSeverity, 'None')
    assert.deepEqual(result.chambers.map(value => value.number), [1, 2, 6])
    assert.equal(chamber(result, 1).matchStatus, 'Mismatch')
    assert.equal(item(result, 1, control.id).leftSource, 'Override')
    assert.equal(item(result, 1, driver.id).leftSource, 'Machine')
    assert.equal(item(result, 1, driver.id).leftVersionId, driver1.id)
    assert.equal(chamber(result, 2).leftInstalled, false)
    assert.equal(chamber(result, 2).rightInstalled, true)
    assert.equal(chamber(result, 2).matchStatus, 'Mismatch')
    assert.equal(item(result, 2, control.id).leftState, 'NotInstalled')
    assert.equal(chamber(result, 6).rightInstalled, false)
    result = await toBaseline()
    assert.equal(result.matchStatus, 'Matched')
    assert.deepEqual(result.chambers.map(value => value.number), [1, 6])
    assert.equal(chamber(result, 1).rightInstalled, null, 'A baseline does not declare installed chambers.')
    assert.equal(chamber(result, 1).matchStatus, 'Mismatch')
    assert.equal(chamber(result, 6).matchStatus, 'Matched')
    assert.equal(item(result, 1, control.id).rightSource, 'Baseline')
    assert.equal(item(result, 1, control.id).rightVersionNumber, 'C1')

    const unknown = await get(`/api/v1/machines/${left.id}/compare/${unobserved.id}`)
    assert.equal(chamber(unknown, 1).matchStatus, 'Unknown')
    assert.equal(item(unknown, 1, control.id).status, 'Unknown')
    assert.equal(item(unknown, 1, control.id).rightState, 'Unknown', 'Not observed is not confirmed absent.')
    const emptyPeer = await createMachine(project.id, '同样未观察机台', [1])
    const empty = await get(`/api/v1/machines/${unobserved.id}/compare/${emptyPeer.id}`)
    assert.equal(chamber(empty, 1).matchStatus, 'Unknown', 'Two empty PM configurations must not be reported as matched.')
    const emptyMissingPm = await get(`/api/v1/machines/${unobserved.id}/compare/${noPm.id}`)
    assert.equal(chamber(emptyMissingPm, 1).matchStatus, 'Mismatch', 'An uninstalled PM must not count as empty-matched.')
    assert.deepEqual((await get(`/api/v1/machines/${noPm.id}/compare-baseline/${baseline.id}`)).chambers, [])

    await write(`/api/v1/component-versions/${control2.id}/safety`, { state: 'Blocked', reason: '匹配与风险独立验收' })
    await override(right.id, 1, [[control.id, control2.id]])
    result = await compare()
    assert.equal(result.matchStatus, 'Matched'); assert.equal(result.riskSeverity, 'None')
    assert.equal(chamber(result, 1).matchStatus, 'Matched')
    assert.equal(chamber(result, 1).riskSeverity, 'Critical')
    assert.equal(chamber(await toBaseline(), 1).riskSeverity, 'Critical')

    await record(left.id, [[driver.id, driver2.id]])
    result = await compare()
    assert.equal(item(result, 1, driver.id).leftVersionId, driver2.id)
    assert.equal(item(result, 1, driver.id).leftSource, 'Machine')
    assert.equal(item(result, 1, control.id).leftVersionId, control2.id, 'Partial observation must keep independent PM overrides.')
    await override(left.id, 1, [])
    result = await compare()
    assert.equal(item(result, 1, control.id).leftVersionId, control1.id)
    assert.equal(item(result, 1, control.id).leftSource, 'Machine', 'Latest null fact must restore inheritance.')
    assert.equal(item(result, 1, driver.id).leftVersionId, driver2.id)
    await record(right.id, [[driver.id, driver2.id]])
    await override(right.id, 1, [])
    assert.equal(chamber(await compare(), 1).matchStatus, 'Matched')

    await record(left.id, [[control.id, control1.id]], 'Full')
    result = await compare()
    assert.equal(item(result, 1, driver.id).leftState, 'Absent')
    assert.equal(item(result, 1, driver.id).leftVersionId, null)
    assert.equal(item(result, 1, driver.id).status, 'RightOnly')
    assert.equal(item(await toBaseline(), 1, driver.id).status, 'RightOnly')
    await record(right.id, [[driver.id, null]])
    result = await compare()
    assert.equal(item(result, 1, driver.id).status, 'Matched', 'Two confirmed absences can match.')
    await override(left.id, 1, [[driver.id, driver2.id]])
    assert.equal(item(await compare(), 1, driver.id).leftState, 'Present')
    await override(left.id, 1, [])
    assert.equal(item(await compare(), 1, driver.id).leftState, 'Absent', 'Clearing an override must restore the inherited absence.')

    await override(left.id, 1, [[control.id, control2.id]])
    await equipment(left.id, [6])
    result = await compare()
    assert.equal(chamber(result, 1).leftInstalled, false)
    assert.equal(item(result, 1, control.id).leftVersionId, null, 'Removed PM overrides must not leak into comparison.')
    assert.equal(chamber(result, 1).riskSeverity, 'None')
    assert.deepEqual((await toBaseline()).chambers.map(value => value.number), [6])
    await equipment(left.id, [1, 6])
    result = await compare()
    assert.equal(item(result, 1, control.id).leftVersionId, control1.id, 'Reinstall must not revive the removed override.')
    assert.equal(item(result, 1, control.id).leftSource, 'Machine')
    assert.equal(chamber(result, 1).riskSeverity, 'None')
    const reversed = await get(`/api/v1/machines/${right.id}/compare/${left.id}`)
    assert.equal(chamber(reversed, 2).leftInstalled, true)
    assert.equal(chamber(reversed, 6).leftInstalled, false)
    assert.equal(item(reversed, 1, control.id).rightVersionId, control1.id)

    await write(`/api/v1/components/${control.id}`, { name: '控制软件已更名', reason: '冻结比较名称验收' }, 'PUT')
    assert.equal(item(await toBaseline(), 1, control.id).componentName, '控制软件原名称')
    assert.equal(item(await compare(), 1, control.id).componentName, '控制软件已更名')
    const extra = await write(`/api/v1/projects/${project.id}/components`, { name: '基线外组件', reason: '验收' })
    const extraVersion = await version(extra.id, 'EXTRA')
    await override(left.id, 1, [[extra.id, extraVersion.id]])
    const extraComparison = item(await toBaseline(), 1, extra.id)
    assert.equal(extraComparison.rightState, 'Absent')
    assert.equal(extraComparison.status, 'LeftOnly')

    const otherProject = await createProject('跨项目隔离验收')
    const otherMachine = await createMachine(otherProject.id, '其他项目机台', [1])
    assert.equal((await api.get(`/api/v1/machines/${left.id}/compare/${otherMachine.id}`)).status(), 400)
    assert.equal((await api.get(`/api/v1/machines/${otherMachine.id}/compare-baseline/${baseline.id}`)).status(), 400)
    const draft = await write(`/api/v1/projects/${project.id}/baselines`, { seriesCode: 'PMCOMPARE-DRAFT', baselineCode: 'BL-DRAFT', reason: '草稿比较保护验收' })
    assert.equal((await api.get(`/api/v1/machines/${left.id}/compare-baseline/${draft.id}`)).status(), 400)

    const viewerName = 'pmcompareviewer' + randomUUID().slice(0, 8); const password = randomUUID()
    await write('/api/v1/admin/users', { userName: viewerName, displayName: 'PM 比较只读验收', password, role: 'Viewer', reason: '验收' })
    const viewer = await request.newContext({ baseURL }); const anonymous = await request.newContext({ baseURL })
    try {
      assert.equal((await anonymous.get(`/api/v1/machines/${left.id}/compare/${right.id}`)).status(), 401)
      const login = await call('/api/v1/auth/login', { userName: viewerName, password }, 'POST', viewer)
      assert(login.ok(), await login.text())
      assert.equal((await viewer.get(`/api/v1/machines/${left.id}/compare/${right.id}`)).status(), 200)
      assert.equal((await viewer.get(`/api/v1/machines/${left.id}/compare-baseline/${baseline.id}`)).status(), 200)
      assert.equal((await call(`/api/v1/machines/${left.id}/chambers/1/configuration`, { items: [], reason: '越权验收' }, 'PUT', viewer)).status(), 403)
    } finally { await viewer.dispose(); await anonymous.dispose() }

    await write(`/api/v1/machines/${left.id}`, { reason: '已删除机台比较保护' }, 'DELETE')
    assert.equal((await api.get(`/api/v1/machines/${left.id}/compare/${right.id}`)).status(), 404)
    assert.equal((await api.get(`/api/v1/machines/${left.id}/compare-baseline/${baseline.id}`)).status(), 404)
    console.log('PM compare acceptance passed: separate whole-machine/PM results, baseline snapshots, inheritance/clear/absence/unknown, installation differences, blocked risk, scope and reader permissions.')
  } finally {
    for (const id of machines) await call(`/api/v1/machines/${id}`, { reason: '验收清理' }, 'DELETE').catch(() => {})
    for (const id of projects) await call(`/api/v1/projects/${id}/archive`, { reason: '验收清理' }).catch(() => {})
    await api.dispose()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
