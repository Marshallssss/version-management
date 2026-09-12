const { request } = require('playwright')
const { readFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const baseURL = process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080'
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  const api = await request.newContext({ baseURL })
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
  const group = (preview, kind) => {
    const result = preview.groups.find(item => item.kind === kind)
    assert(result, `Missing impact group: ${kind}`)
    assert.equal(result.items.length, Math.min(result.total, 10))
    assert(result.items.every(item => item.label && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(item.label)), 'Preview labels must be names, not identifiers.')
    return result
  }
  let projectId
  try {
    await write('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    const capabilities = await get('/api/v1/maintenance-capabilities')
    const project = await write('/api/v1/projects', { code: 'OP IMPACT ' + randomUUID().slice(0, 8), name: '操作影响验收', reason: '自动化验收' })
    projectId = project.id
    const component = await write(`/api/v1/projects/${projectId}/components`, { name: '控制程序', reason: '验收' })
    const version = (number, maturity = 'Released') => write(`/api/v1/components/${component.id}/versions`, { versionNumber: number, maturity, reason: '验收' })
    const versionImpact = id => get(`/api/v1/component-versions/${id}/operation-impact`)
    const baselineImpact = id => get(`/api/v1/baselines/${id}/operation-impact`)
    const removeVersion = id => call(`/api/v1/component-versions/${id}`, { reason: '删除预览一致性验收' }, 'DELETE')
    const withdraw = id => call(`/api/v1/baselines/${id}/withdraw-release`, { reason: '撤回预览一致性验收' })
    const audit = id => get(`/api/v1/audit?entityId=${id}`)

    const clean = await version('V-delete')
    await write(`/api/v1/component-versions/${clean.id}/patches`, { patchCode: 'HF.1', title: '清理补丁', issueDescription: '测试问题', resolutionDescription: '测试修复', status: 'Released' })
    await write(`/api/v1/component-versions/${clean.id}/recommend`, { state: '', reason: '清理数量验收' })
    const cleanBefore = await get(`/api/v1/component-versions/${clean.id}`)
    const auditBefore = await audit(clean.id)
    const cleanPreview = await versionImpact(clean.id)
    assert.equal(cleanPreview.canDelete, true)
    assert.equal(cleanPreview.maintenanceEnabled, capabilities.enabled)
    assert.equal(cleanPreview.componentName, '控制程序')
    assert.equal(cleanPreview.cleanupCounts.patches, 1)
    assert.equal(cleanPreview.cleanupCounts.recommendations, 1)
    assert(cleanPreview.cleanupCounts.lifecycleTransitions >= 1)
    assert(cleanPreview.groups.every(item => item.total === 0))
    assert.deepEqual(await versionImpact(clean.id), cleanPreview)
    assert.deepEqual(await get(`/api/v1/component-versions/${clean.id}`), cleanBefore, 'Preview must not modify the version.')
    assert.deepEqual(await audit(clean.id), auditBefore, 'GET preview must not emit mutation audit events.')
    assert.equal((await removeVersion(clean.id)).status(), 200)

    const released = await version('V-baseline')
    assert.equal((await versionImpact(released.id)).canDelete, true, 'An earlier preview is advisory, not a deletion reservation.')
    if (process.argv.includes('--expiry')) {
      const baseline = await write(`/api/v1/projects/${projectId}/baselines`, {
        seriesCode: 'EXPIRY', baselineCode: 'BL-EXPIRY', publishImmediately: true, reason: '真实三分钟撤回期限验收'
      })
      const before = await baselineImpact(baseline.id)
      assert.equal(before.canWithdraw, true)
      assert(before.groups.every(item => item.total === 0), 'Expiry fixture must not have references.')
      const snapshot = await get(`/api/v1/baselines/${baseline.id}`)
      assert.equal(new Date(before.withdrawUntil) - new Date(snapshot.baseline.releasedAt), 180000)
      const auditBeforeExpiry = await audit(baseline.id)
      const remainingMs = Math.max(0, new Date(before.withdrawUntil).getTime() - Date.now()) + 1200
      console.log(`Waiting ${Math.ceil(remainingMs / 1000)} seconds for the real baseline withdrawal deadline.`)
      await new Promise(resolve => setTimeout(resolve, remainingMs))
      const after = await baselineImpact(baseline.id)
      assert.equal(after.canWithdraw, false)
      assert(after.blockedReasons.some(reason => reason.includes('3 分钟')))
      assert.equal(after.withdrawUntil, before.withdrawUntil)
      assert(after.groups.every(item => item.total === 0))
      const result = await withdraw(baseline.id)
      assert.equal(result.status(), 409, await result.text())
      assert((await result.json()).message.includes('3 分钟'))
      assert.deepEqual(await get(`/api/v1/baselines/${baseline.id}`), snapshot, 'Expired withdrawal must not modify the released snapshot.')
      assert.deepEqual(await audit(baseline.id), auditBeforeExpiry, 'Expired withdrawal and preview must not emit mutation audit events.')
      console.log('Operation impact real-expiry acceptance passed: before/after 180 seconds, preview matches command rejection, released snapshot and audit remain unchanged.')
      return
    }
    const baselines = []
    for (let index = 0; index < 12; index++) baselines.push(await write(`/api/v1/projects/${projectId}/baselines`, {
      seriesCode: 'SERIES', baselineCode: `BL-${index + 1}`, publishImmediately: true, reason: '预览数量上限验收'
    }))
    const referencedPreview = await versionImpact(released.id)
    assert.equal(referencedPreview.canDelete, false)
    assert.equal(group(referencedPreview, 'baselines').total, 12)
    assert.equal(new Set(group(referencedPreview, 'baselines').items.map(item => item.id)).size, 10)
    assert.equal((await removeVersion(released.id)).status(), 409)
    const freeBaseline = baselines[11]
    const freePreview = await baselineImpact(freeBaseline.id)
    assert.equal(freePreview.canWithdraw, true)
    assert.equal(freePreview.maintenanceEnabled, capabilities.enabled)
    assert.deepEqual(freePreview.blockedReasons, [])
    assert(new Date(freePreview.withdrawUntil) > new Date())
    assert(group(freePreview, 'successors').total === 0)
    const baselineAudit = await audit(freeBaseline.id)
    const baselineBefore = await get(`/api/v1/baselines/${freeBaseline.id}`)
    await baselineImpact(freeBaseline.id)
    assert.deepEqual(await audit(freeBaseline.id), baselineAudit)
    assert.deepEqual(await get(`/api/v1/baselines/${freeBaseline.id}`), baselineBefore, 'Preview must not modify released snapshots.')
    const withdrawn = await withdraw(freeBaseline.id)
    assert.equal(withdrawn.status(), 200, await withdrawn.text())
    const withdrawnPreview = await baselineImpact(freeBaseline.id)
    assert.equal(withdrawnPreview.canWithdraw, false)
    assert(withdrawnPreview.blockedReasons.some(reason => reason.includes('正式发布')))
    const draft = await write(`/api/v1/projects/${projectId}/baselines`, { seriesCode: 'DRAFT', baselineCode: 'BL-DRAFT', reason: '草稿预览验收' })
    assert.equal((await baselineImpact(draft.id)).canWithdraw, false)
    assert.equal((await baselineImpact(draft.id)).withdrawUntil, null)

    const machineName = '保留名称的历史机台'
    const machine = await write('/api/v1/machines', {
      projectId, serialNumber: randomUUID(), name: machineName, owner: '验收负责人', stage: 'Lab',
      chambers: [{ number: 1, stage: 'Lab' }], reason: '验收'
    })
    assert.equal((await baselineImpact(baselines[0].id)).canWithdraw, true, 'An earlier preview must not bypass later assignment checks.')
    for (const baseline of baselines.slice(0, 2)) {
      await write(`/api/v1/projects/${projectId}/standard`, { configurationBaselineId: baseline.id, reason: '标准历史引用验收' })
      await write(`/api/v1/machines/${machine.id}/target`, { configurationBaselineId: baseline.id, reason: '目标历史引用验收' })
    }
    await write(`/api/v1/machines/${machine.id}/facts`, {
      operationType: 'Upgrade', coverage: 'Full', sourceType: 'baseline-upgrade', sourceConfigurationBaselineId: baselines[1].id,
      reason: '基线来源引用验收', items: [{ componentId: component.id, versionId: released.id, absent: false, knownInstalledAt: null }]
    })
    const historicalBaseline = await baselineImpact(baselines[0].id)
    assert.equal(historicalBaseline.canWithdraw, false)
    assert.equal(group(historicalBaseline, 'project-standards').total, 1)
    assert.equal(group(historicalBaseline, 'project-standards').items[0].detail, '历史项目标准')
    assert.equal(group(historicalBaseline, 'machine-targets').total, 1)
    assert.equal(group(historicalBaseline, 'machine-targets').items[0].detail, '历史目标基线')
    assert.equal((await withdraw(baselines[0].id)).status(), 409, 'Historical assignments still prevent withdrawal.')
    const currentBaseline = await baselineImpact(baselines[1].id)
    assert.equal(group(currentBaseline, 'deployment-history').total, 1)
    assert.equal((await withdraw(baselines[1].id)).status(), 409)
    const actualPreview = await versionImpact(released.id)
    assert.equal(group(actualPreview, 'current-machines').total, 1)
    assert.equal(group(actualPreview, 'machine-history').total, 1)

    const pmOnly = await version('V-PM-only', 'Testing')
    await write(`/api/v1/machines/${machine.id}/chambers/1/configuration`, { items: [{ componentId: component.id, versionId: pmOnly.id }], reason: 'PM 历史引用验收' }, 'PUT')
    await write(`/api/v1/machines/${machine.id}/equipment`, { owner: '验收负责人', stage: 'Lab', chambers: [], reason: '移除 PM 仍保留历史' }, 'PUT')
    await write(`/api/v1/machines/${machine.id}`, { reason: '删除机台仍保留引用名称' }, 'DELETE')
    const pmPreview = await versionImpact(pmOnly.id)
    assert.equal(pmPreview.canDelete, false)
    assert.equal(group(pmPreview, 'current-machines').total, 0)
    const pmGroup = group(pmPreview, 'chamber-history')
    assert.equal(pmGroup.total, 1)
    assert.equal(pmGroup.items[0].label, machineName)
    assert.equal(pmGroup.items[0].deleted, true)
    assert(pmGroup.items[0].detail.includes('PM1') && pmGroup.items[0].detail.includes('已移除'))
    assert.equal((await removeVersion(pmOnly.id)).status(), 409)
    assert.equal(group(await baselineImpact(baselines[0].id), 'machine-targets').items[0].deleted, true)
    assert.equal(group(await baselineImpact(baselines[1].id), 'deployment-history').items[0].label, machineName)
    assert.equal(group(await versionImpact(released.id), 'current-machines').items[0].deleted, true)

    const exposure = await version('V-risk-snapshot')
    await write(`/api/v1/component-versions/${exposure.id}/safety`, { state: 'Blocked', reason: '影响快照引用验收' })
    const exposurePreview = await versionImpact(exposure.id)
    assert.equal(exposurePreview.canDelete, false)
    assert.equal(group(exposurePreview, 'exposure-snapshots').total, 1)
    assert.equal((await removeVersion(exposure.id)).status(), 409)

    for (const role of ['Viewer', 'Engineer', 'SeniorEngineer']) {
      const userName = 'op-' + role.toLowerCase() + '-' + randomUUID().slice(0, 8)
      const password = randomUUID()
      const user = await write('/api/v1/admin/users', { userName, displayName: '操作预览权限验收', password, role, reason: '验收' })
      const other = await request.newContext({ baseURL })
      try {
        const login = await call('/api/v1/auth/login', { userName, password }, 'POST', other)
        assert(login.ok(), await login.text())
        assert.equal((await other.get(`/api/v1/component-versions/${released.id}/operation-impact`)).status(), 403)
        assert.equal((await other.get(`/api/v1/baselines/${baselines[0].id}/operation-impact`)).status(), 403)
        if (role === 'SeniorEngineer') {
          await write(`/api/v1/projects/${projectId}/members`, { userId: user.id, role: 'Engineer', reason: '普通成员不可预览撤回' })
          assert.equal((await other.get(`/api/v1/baselines/${baselines[0].id}/operation-impact`)).status(), 403)
          await write(`/api/v1/projects/${projectId}/members`, { userId: user.id, role: 'SeniorEngineer', reason: '高级项目成员可以预览撤回' })
          assert.equal((await other.get(`/api/v1/baselines/${baselines[0].id}/operation-impact`)).status(), 200)
        }
      } finally { await other.dispose() }
    }
    const missingId = randomUUID()
    assert.equal((await api.get(`/api/v1/component-versions/${missingId}/operation-impact`)).status(), 404)
    assert.equal((await api.get(`/api/v1/baselines/${missingId}/operation-impact`)).status(), 404)
    console.log('Operation impact acceptance passed: read-only previews, cleanup counts, reference caps, deleted-machine/removed-PM history, risk snapshots, withdrawal eligibility, historical standard/target/source references and role/project authorization.')
  } finally {
    if (projectId) await call(`/api/v1/projects/${projectId}/archive`, { reason: '验收清理' }).catch(() => {})
    await api.dispose()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
