const { request } = require('playwright')
const { readFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const baseURL = process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080'
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  const api = await request.newContext({ baseURL })
  const call = (url, data, method = 'POST', key = randomUUID(), client = api) => client.fetch(url, { method, data, headers: { 'Idempotency-Key': key } })
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
  let projectId; let machineId
  try {
    await write('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    assert.equal((await get('/api/v1/maintenance-capabilities')).enabled, true, 'This acceptance needs test-data maintenance enabled to verify frozen labels.')
    const project = await write('/api/v1/projects', { code: 'PMTRACE-' + randomUUID().slice(0, 8), name: 'PM 追溯验收', reason: '自动化验收' }); projectId = project.id
    const component = await write(`/api/v1/projects/${project.id}/components`, { name: '控制程序原名称', reason: '验收' })
    const v1 = await write(`/api/v1/components/${component.id}/versions`, { versionNumber: 'V1-frozen', maturity: 'Released', reason: '验收' })
    const baseline = await write(`/api/v1/projects/${project.id}/baselines`, { seriesCode: 'PMTRACE', baselineCode: 'BL-FROZEN', publishImmediately: true, reason: '验收' })
    const snapshot = await get(`/api/v1/baselines/${baseline.id}`)
    const v2 = await write(`/api/v1/components/${component.id}/versions`, { versionNumber: 'V2-lab', maturity: 'Testing', reason: '验收' })
    const machine = await write('/api/v1/machines', {
      projectId, serialNumber: randomUUID(), name: '=PM,"特殊名称"', stage: 'Lab', owner: '测试工程师',
      chambers: [{ number: 1, stage: 'Lab' }, { number: 2, stage: 'Lab' }], reason: '验收'
    }); machineId = machine.id
    await write(`/api/v1/machines/${machine.id}/target`, { configurationBaselineId: baseline.id, reason: '显式设定目标' })
    await write(`/api/v1/machines/${machine.id}/facts`, {
      operationType: 'InitialSnapshot', coverage: 'Full', sourceType: 'Manual', reason: '整机配置不包含 PM 特例',
      items: [{ componentId: component.id, versionId: v1.id, absent: false, knownInstalledAt: null }]
    })
    const override = (number, versionId) => write(`/api/v1/machines/${machine.id}/chambers/${number}/configuration`, {
      items: versionId ? [{ componentId: component.id, versionId }] : [], reason: versionId ? 'PM 独立配置' : '恢复沿用整机'
    }, 'PUT')
    const equipment = numbers => write(`/api/v1/machines/${machine.id}/equipment`, {
      owner: '测试工程师', stage: 'Lab', chambers: numbers.map(number => ({ number, stage: 'Lab' })), reason: '变更腔室组合'
    }, 'PUT')
    const impact = () => get(`/api/v1/component-versions/${v2.id}/impact`)
    await override(1, v2.id); await override(2, v2.id)
    let data = await impact()
    assert.deepEqual(data.currentMachineIds, [], 'PM-only use must not be reported as whole-machine actual.')
    assert.deepEqual(data.historicalMachineIds, [])
    assert.deepEqual(data.chamberImpact.currentUsages.map(item => item.chamberNumber), [1, 2])
    assert.equal(data.chamberImpact.historicalUsages.length, 2)
    assert.equal(data.chamberImpact.historicalFactCount, 2)
    assert(data.chamberImpact.recentFacts.every(item => item.isCurrent && item.historyId && item.actor && item.reason && item.recordedAt))
    const whole = await get(`/api/v1/machines/${machine.id}/compare-baseline/${baseline.id}`)
    assert.equal(whole.matchStatus, 'Matched', 'Separate PM overrides must not change the whole-machine match.')

    const exportUrl = `/api/v1/component-versions/${v2.id}/impact/export`
    const exportKey = randomUUID(); const exportInput = { reason: '追溯导出验收' }
    const exported = await call(exportUrl, exportInput, 'POST', exportKey)
    assert(exported.ok(), await exported.text())
    const csv = await exported.text()
    assert(csv.includes('当前 PM 特例,2\r\n'))
    assert(csv.includes('历史 PM 引用,2\r\n'))
    assert(csv.includes('当前机台,0\r\n'))
    assert(csv.includes('"\'=PM,""特殊名称"""'), 'CSV names must be quoted and cannot execute spreadsheet formulas.')
    assert(csv.includes('"PM1"') && csv.includes('"PM2"'))
    const replay = await call(exportUrl, exportInput, 'POST', exportKey)
    assert.equal(await replay.text(), csv)
    assert.equal((await call(exportUrl, { reason: '不同请求' }, 'POST', exportKey)).status(), 409)

    const viewerName = 'pmviewer' + randomUUID().slice(0, 8); const password = randomUUID()
    await write('/api/v1/admin/users', { userName: viewerName, displayName: 'PM 追溯权限验收', password, role: 'Viewer', reason: '验收' })
    const viewer = await request.newContext({ baseURL })
    try {
      const login = await call('/api/v1/auth/login', { userName: viewerName, password }, 'POST', randomUUID(), viewer)
      assert(login.ok(), await login.text())
      assert.equal((await viewer.get(`/api/v1/component-versions/${v2.id}/impact`)).status(), 200)
      assert.equal((await call(exportUrl, exportInput, 'POST', exportKey, viewer)).status(), 403)
    } finally { await viewer.dispose() }

    await override(1, v1.id)
    assert.deepEqual((await impact()).chamberImpact.currentUsages.map(item => item.chamberNumber), [2])
    await override(2, null)
    data = await impact()
    assert.equal(data.chamberImpact.currentUsages.length, 0, 'A later null fact must clear old version exposure.')
    assert.equal(data.chamberImpact.historicalUsages.length, 2)
    assert(data.chamberImpact.recentFacts.every(item => !item.isCurrent))

    await write(`/api/v1/components/${component.id}`, { name: '控制程序新名称', reason: '名称维护验收' }, 'PUT')
    const versionDetail = await get(`/api/v1/component-versions/${v1.id}`)
    await write(`/api/v1/component-versions/${v1.id}/maintenance`, {
      versionNumber: 'V1-renamed', maturity: 'Released', createdAt: versionDetail.version.createdAt,
      maintenanceMode: true, reason: '冻结快照名称验收'
    })
    await write(`/api/v1/component-versions/${v1.id}/safety`, { state: 'Blocked', reason: '动态风险验收' })
    const comparison = await get(`/api/v1/machines/${machine.id}/compare-baseline/${baseline.id}`)
    assert.equal(comparison.matchStatus, 'Matched'); assert.equal(comparison.riskSeverity, 'Critical')
    assert.equal(comparison.items[0].expectedVersionNumber, 'V1-frozen')
    assert.equal(comparison.items[0].componentName, '控制程序原名称')
    assert.equal(comparison.items[0].actualVersionNumber, 'V1-renamed')
    const special = (await get(`/api/v1/machines/${machine.id}/equipment`)).chambers.find(item => item.number === 1).overrides[0]
    assert.equal(special.expectedVersionNumber, 'V1-frozen'); assert.equal(special.versionNumber, 'V1-renamed')
    assert.equal(special.match, 'Matched'); assert.equal(special.risk, 'Critical')
    assert.deepEqual((await get(`/api/v1/baselines/${baseline.id}`)).items, snapshot.items)

    await override(1, v2.id)
    await equipment([2])
    data = await impact()
    assert.equal(data.chamberImpact.currentUsages.length, 0)
    assert.equal(data.chamberImpact.historicalUsages.find(item => item.chamberNumber === 1).chamberInstalled, false)
    await equipment([1, 2])
    assert.equal((await impact()).chamberImpact.currentUsages.length, 0, 'Reinstalling a chamber must not revive a removed override.')
    await override(1, v2.id)
    assert.equal((await impact()).chamberImpact.currentUsages.length, 1)
    assert.equal((await call(`/api/v1/component-versions/${v2.id}`, { reason: '历史引用保护' }, 'DELETE')).status(), 409)
    await write(`/api/v1/machines/${machine.id}`, { reason: '删除机台保留 PM 追溯' }, 'DELETE')
    data = await impact()
    assert.equal(data.chamberImpact.currentUsages.length, 0)
    assert(data.chamberImpact.historicalUsages.every(item => item.machineDeleted))
    assert.equal(data.chamberImpact.historicalFactCount, 4)
    const historicalExport = await call(exportUrl, exportInput)
    assert(historicalExport.ok(), await historicalExport.text())
    assert((await historicalExport.text()).includes('"已删除"'))
    const audit = await get(`/api/v1/audit?entityId=${v2.id}`)
    assert.equal(audit.filter(item => item.action === 'VersionImpactCsvExported').length, 2, 'Export replays must not duplicate audit records.')
    assert(audit.every(item => item.actor && item.correlationId))
    console.log('PM trace acceptance passed: separate current/history impact, replacement/clear/removal/reinstall/delete semantics, CSV safety/replay/permissions and frozen baseline labels with live risk.')
  } finally {
    if (machineId) await call(`/api/v1/machines/${machineId}`, { reason: '验收清理' }, 'DELETE').catch(() => {})
    if (projectId) await call(`/api/v1/projects/${projectId}/archive`, { reason: '验收清理' }).catch(() => {})
    await api.dispose()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
