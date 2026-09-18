const { request } = require('playwright')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const baseURL = process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080'
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  const api = await request.newContext({ baseURL })
  const clients = [api]
  const projects = []
  const token = randomUUID().slice(0, 8)
  const output = path.resolve('artifacts/import-admin-correction', token)
  mkdirSync(output, { recursive: true })
  const workbook = path.join(output, 'correction.xlsx')
  const call = (url, data, method = 'POST', client = api, key = randomUUID(), correlation = randomUUID()) => client.fetch(url, { method, data, headers: { 'Idempotency-Key': key, 'X-Correlation-ID': correlation } })
  const read = async response => { assert(response.ok(), `${response.url()}: ${await response.text()}`); return response.status() === 204 ? null : response.json() }
  const write = async (url, data, method = 'POST', client = api) => read(await call(url, data, method, client))
  const get = async url => read(await api.get(url))
  const fixture = changes => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/integration/matrix-workbook-fixture.ps1'), '-Path', workbook, '-CellsJson', JSON.stringify(changes || {})], { encoding: 'utf8', windowsHide: true }).replace(/^\uFEFF/, ''))
  try {
    await write('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    const project = await write('/api/v1/projects', { code: `IMPORT-CORRECT ${token}`, name: '导入管理员纠错 ' + token, reason: '自动化纠错验收' })
    projects.push(project.id)
    const component = name => write(`/api/v1/projects/${project.id}/components`, { name, reason: '自动化纠错验收' })
    const a = await component('误录主控')
    const b = await component('联调驱动')
    const route = `/api/v1/projects/${project.id}/matrix-import`
    const template = await write(`${route}/templates`, { reason: '纠错模板' })
    const download = await api.get(template.downloadUrl)
    assert(download.ok(), await download.text())
    writeFileSync(workbook, await download.body())
    const cells = fixture()
    assert.match(cells.A1, /ConfigHub\.Matrix\.v2/)
    const componentRow = value => Object.entries(cells).find(([cell, text]) => /^A\d+$/.test(cell) && text === value.id)?.[0].slice(1)
    const aRow = componentRow(a), bRow = componentRow(b)
    assert(aRow && bRow, 'Both component names retain stable hidden bindings')
    fixture({ D5: '2026-09-17', D6: '主控误录', [`D${aRow}`]: 'A.1', E5: '2026-09-18', E6: '驱动补充', [`E${bRow}`]: 'B.1' })
    const scan = () => write(`${route}/scan`, { templateId: template.id, fileName: 'correction.xlsx', contentBase64: readFileSync(workbook).toString('base64'), reason: '管理员纠错验收扫描' })
    assert.equal((await scan()).importedCount, 2)
    const before = await get(route)
    const combinations = before.combinations.sort((x, y) => x.sequenceNo - y.sequenceNo)
    const importedA = combinations[0].items.find(item => item.componentId === a.id)
    const importedB = combinations[1].items.find(item => item.componentId === b.id)
    assert(importedA.versionId && importedB.versionId)
    const frozen = combinations.map(combo => ({ id: combo.id, rowKey: combo.rowKey, sequenceNo: combo.sequenceNo, reason: combo.reason, items: combo.items.map(item => ({ componentId: item.componentId, versionId: item.versionId, versionNumber: item.versionNumber, changed: item.changed })) }))

    const accounts = {}
    for (const role of ['Admin', 'SeniorEngineer', 'Viewer']) {
      const userName = `import-correct-${role.toLowerCase()}-${token}`
      const password = 'A1!' + randomUUID()
      const user = await write('/api/v1/admin/users', { userName, displayName: '导入纠错 ' + role, password, role, reason: '自动化权限验收' })
      const client = await request.newContext({ baseURL })
      clients.push(client)
      await write('/api/v1/auth/login', { userName, password }, 'POST', client)
      accounts[role] = { ...user, client }
      if (role !== 'Viewer') await write(`/api/v1/projects/${project.id}/members`, { userId: user.id, role: 'SeniorEngineer', reason: '项目权限验收' })
    }
    const deletionUrl = `/api/v1/component-versions/${importedA.versionId}`
    const deletionRequest = { reason: '确认误导入，保留 Excel 原始记录' }
    for (const role of ['SeniorEngineer', 'Viewer']) {
      assert.equal((await call(deletionUrl, deletionRequest, 'DELETE', accounts[role].client)).status(), 403)
      assert.equal((await accounts[role].client.get(deletionUrl + '/operation-impact')).status(), 403)
    }
    const impact = await read(await accounts.Admin.client.get(deletionUrl + '/operation-impact'))
    assert.equal(impact.canDelete, true, 'Excel references are informational, not deletion blockers')
    assert(impact.groups.find(group => group.kind === 'matrix-combinations').total >= 2)
    const deleteKey = randomUUID(), deleteCorrelation = `import-delete-${token}`
    const removed = await read(await call(deletionUrl, deletionRequest, 'DELETE', accounts.Admin.client, deleteKey, deleteCorrelation))
    assert.equal(removed.deleted, true)
    assert.deepEqual(await read(await call(deletionUrl, deletionRequest, 'DELETE', accounts.Admin.client, deleteKey)), removed)
    assert.equal((await api.get(deletionUrl)).status(), 404)
    assert.equal((await scan()).importedCount, 0, 'Rescanning committed columns never recreates a deleted version')
    const after = (await get(route)).combinations.sort((x, y) => x.sequenceNo - y.sequenceNo)
    assert.deepEqual(after.map(combo => ({ id: combo.id, rowKey: combo.rowKey, sequenceNo: combo.sequenceNo, reason: combo.reason, items: combo.items.map(item => ({ componentId: item.componentId, versionId: item.versionId, versionNumber: item.versionNumber, changed: item.changed })) })), frozen)
    assert(after.every(combo => combo.items.find(item => item.componentId === a.id).versionAvailable === false), 'History marks deleted live versions without rewriting frozen IDs')
    assert.equal((await get(`/api/v1/projects/${project.id}`)).components.find(item => item.id === a.id).versions.length, 0)
    const deletionAudit = (await get(`/api/v1/audit?entityId=${importedA.versionId}`)).filter(item => item.action === 'ComponentVersionDeleted' && item.correlationId === deleteCorrelation)
    assert.equal(deletionAudit.length, 1, 'Deletion and replay produce one correlated audit event')

    fixture({ F5: '2026-09-18', F6: '不可隐式继承已删除版本', [`F${bRow}`]: 'B.2' })
    const invalid = await scan()
    assert.equal(invalid.status, 'Failed')
    assert.equal(invalid.importedCount, 0)
    assert.equal((await get(route)).combinations.length, 2)
    fixture({ F6: '显式纠正已删除主控版本', [`F${aRow}`]: 'A.2' })
    assert.equal((await scan()).importedCount, 1)
    const current = await get(`/api/v1/projects/${project.id}`)
    const b2 = current.components.find(item => item.id === b.id).versions.find(item => item.versionNumber === 'B.2')
    const maturityUrl = `/api/v1/component-versions/${importedB.versionId}/maturity`
    const restoreRequest = { state: 'Testing', reason: '管理员恢复原测试版本' }
    assert.equal((await get(`/api/v1/component-versions/${importedB.versionId}`)).version.maturity, 'Deprecated')
    assert.equal((await call(maturityUrl, restoreRequest, 'POST', accounts.SeniorEngineer.client)).status(), 403)
    assert.equal((await call(maturityUrl, { ...restoreRequest, reason: ' ' }, 'POST', accounts.Admin.client)).status(), 400)
    await write(`/api/v1/component-versions/${importedB.versionId}/safety`, { state: 'Blocked', reason: '独立安全状态保护' })
    const restoreKey = randomUUID(), restoreCorrelation = `import-restore-${token}`
    const restored = await read(await call(maturityUrl, restoreRequest, 'POST', accounts.Admin.client, restoreKey, restoreCorrelation))
    assert.deepEqual(restored, { maturity: 'Testing', safety: 'Blocked' })
    assert.deepEqual(await read(await call(maturityUrl, restoreRequest, 'POST', accounts.Admin.client, restoreKey)), restored)
    const restoredVersion = await get(`/api/v1/component-versions/${importedB.versionId}`)
    const replacedVersion = await get(`/api/v1/component-versions/${b2.id}`)
    assert.equal(replacedVersion.version.maturity, 'Deprecated', 'Restoring one testing version retires the previous testing version atomically')
    assert.equal(restoredVersion.transitions.filter(item => item.axis === 'Maturity' && item.fromState === 'Deprecated' && item.toState === 'Testing').length, 1)
    assert.equal(replacedVersion.transitions.filter(item => item.axis === 'Maturity' && item.fromState === 'Testing' && item.toState === 'Deprecated').length, 1)
    assert.equal((await get(`/api/v1/audit?entityId=${importedB.versionId}`)).filter(item => item.action === 'VersionMaturityChanged' && item.correlationId === restoreCorrelation).length, 1)
    assert.equal((await call(`/api/v1/component-versions/${importedB.versionId}`, deletionRequest, 'DELETE', accounts.Admin.client)).status(), 409, 'Risk exposure remains protected')

    await write(`/api/v1/admin/users/${accounts.Admin.id}/role`, { role: 'SeniorEngineer', reason: '即时撤权与幂等重放验收' })
    assert.equal((await call(deletionUrl, deletionRequest, 'DELETE', accounts.Admin.client, deleteKey)).status(), 403, 'Revoked administrators cannot replay a completed deletion with an old session')
    assert.equal((await call(maturityUrl, restoreRequest, 'POST', accounts.Admin.client, restoreKey)).status(), 403, 'Admin restoration replay stays admin-only after demotion')
    assert.equal((await accounts.Admin.client.get(`/api/v1/component-versions/${b2.id}/operation-impact`)).status(), 403)

    const protectedProject = await write('/api/v1/projects', { code: `IMPORT-PROTECTED ${token}`, name: '保留历史保护 ' + token, reason: '自动化保护验收' })
    projects.push(protectedProject.id)
    const protectedComponent = await write(`/api/v1/projects/${protectedProject.id}/components`, { name: '冻结组件', reason: '基线保护' })
    const protectedVersion = await write(`/api/v1/components/${protectedComponent.id}/versions`, { versionNumber: 'Frozen.1', maturity: 'Released', reason: '基线保护' })
    const baseline = await write(`/api/v1/projects/${protectedProject.id}/baselines`, { seriesCode: 'PROTECTED', baselineCode: 'PROTECTED-' + token, publishImmediately: true, reason: '冻结保护' })
    const frozenBaseline = await get(`/api/v1/baselines/${baseline.id}`)
    assert.equal((await call(`/api/v1/component-versions/${protectedVersion.id}`, deletionRequest, 'DELETE')).status(), 409)
    assert.deepEqual(await get(`/api/v1/baselines/${baseline.id}`), frozenBaseline)
    const machineComponent = await write(`/api/v1/projects/${protectedProject.id}/components`, { name: '机台实际组件', reason: '实际配置保护' })
    const machineVersion = await write(`/api/v1/components/${machineComponent.id}/versions`, { versionNumber: 'Actual.1', maturity: 'Testing', reason: '实际配置保护' })
    const machine = await write('/api/v1/machines', { projectId: protectedProject.id, name: '实际机台 ' + token, serialNumber: 'CORRECTION-' + token, reason: '实际配置保护' })
    await write(`/api/v1/machines/${machine.id}/facts`, { operationType: 'InitialSnapshot', coverage: 'Partial', sourceType: 'manual-ui', reason: '实际快照保护', items: [{ componentId: machineComponent.id, versionId: machineVersion.id, absent: false, knownInstalledAt: null }] })
    const actual = await get(`/api/v1/machines/${machine.id}/configuration`)
    assert.equal((await call(`/api/v1/component-versions/${machineVersion.id}`, deletionRequest, 'DELETE')).status(), 409)
    assert.deepEqual(await get(`/api/v1/machines/${machine.id}/configuration`), actual)
    console.log('Import admin correction passed: Admin-only import-linked deletion, immutable history, deleted-version scan guard, explicit correction, Deprecated -> Testing, single testing version, independent safety, authorization before replay, correlated audit, baseline/actual/risk protection.')
  } finally {
    for (const id of projects) await call(`/api/v1/projects/${id}/archive`, { reason: '导入纠错自动化验收完成' }).catch(() => {})
    for (const client of clients) await client.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
