const { chromium } = require('playwright')
const { readFileSync, mkdirSync } = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')

async function main() {
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const baseURL = process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080'
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } })
  const api = context.request
  const call = (url, data, key = randomUUID(), client = api, correlationId = randomUUID()) => client.post(url, { data, headers: { 'Idempotency-Key': key, 'X-Correlation-ID': correlationId } })
  const read = async response => { assert(response.ok(), response.url() + ': ' + await response.text()); return response.status() === 204 ? null : response.json() }
  const write = async (url, data) => read(await call(url, data))
  const get = async url => read(await api.get(url))
  const detail = id => get(`/api/v1/component-versions/${id}`)
  const maturityUrl = id => `/api/v1/component-versions/${id}/maturity`
  const artifacts = 'artifacts/version-deprecation'
  const projects = []
  let page
  try {
    await write('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    const suffix = randomUUID().slice(0, 8)
    const project = await write('/api/v1/projects', { code: `DEPRECATION-${suffix}`, name: '版本废弃验收 ' + suffix, reason: '自动化废弃规则验收' })
    projects.push(project.id)
    const component = name => write(`/api/v1/projects/${project.id}/components`, { name, parentComponentId: root.id, reason: '自动化验收' })
    const version = (componentId, versionNumber, maturity) => write(`/api/v1/components/${componentId}/versions`, { versionNumber, maturity, reason: '自动化验收' })
    const root = await write(`/api/v1/projects/${project.id}/components`, { name: '废弃规则分类', reason: '自动化验收' })
    const referencedComponent = await component('历史引用组件')
    const referencedVersion = await version(referencedComponent.id, 'opaque-release-' + suffix, 'Released')
    const baseline = await write(`/api/v1/projects/${project.id}/baselines`, { seriesCode: 'HISTORY', baselineCode: 'FROZEN-' + suffix, publishImmediately: true, reason: '废弃前冻结快照' })
    await write(`/api/v1/projects/${project.id}/standard`, { configurationBaselineId: baseline.id, reason: '显式指定标准' })
    const machine = await write('/api/v1/machines', { projectId: project.id, name: '历史引用机台 ' + suffix, serialNumber: 'DEPRECATION-' + suffix, reason: '自动化验收' })
    await write(`/api/v1/machines/${machine.id}/target`, { configurationBaselineId: baseline.id, reason: '固定历史目标' })
    await write(`/api/v1/machines/${machine.id}/facts`, {
      operationType: 'InitialSnapshot', coverage: 'Full', sourceType: 'manual-ui', reason: '废弃前实际快照',
      items: [{ componentId: referencedComponent.id, versionId: referencedVersion.id, absent: false, knownInstalledAt: null }],
    })
    const frozen = await get(`/api/v1/baselines/${baseline.id}`)
    const target = await get(`/api/v1/machines/${machine.id}/target`)
    const standard = await get(`/api/v1/projects/${project.id}/standard`)
    const facts = await get(`/api/v1/machines/${machine.id}/facts`)
    const actual = await get(`/api/v1/machines/${machine.id}/configuration`)

    // Every supported source maturity must retire without changing its independent safety axis.
    for (const maturity of ['Draft', 'Testing', 'Released', 'Maintenance']) {
      for (const safety of ['Clear', 'Blocked']) {
        const c = maturity === 'Released' && safety === 'Clear' ? referencedComponent : await component(`${maturity}-${safety}`)
        const v = c.id === referencedComponent.id ? referencedVersion : await version(c.id, `opaque-${maturity}-${safety}`, maturity)
        if (safety === 'Blocked') await write(`/api/v1/component-versions/${v.id}/safety`, { state: 'Blocked', reason: '独立安全状态验收' })
        if (safety === 'Clear' && ['Released', 'Maintenance'].includes(maturity)) {
          await write(`/api/v1/component-versions/${v.id}/recommend`, { reason: '废弃前设为推荐' })
          assert.equal((await detail(v.id)).recommended, true)
        }
        const before = await detail(v.id)
        const key = randomUUID()
        const correlationId = `deprecate-${suffix}-${maturity}-${safety}`
        const request = { state: 'Deprecated', reason: `发现致命缺陷，停止使用 ${maturity}/${safety}` }
        assert.equal((await call(maturityUrl(v.id), { ...request, reason: '   ' })).status(), 400, 'A reason is mandatory')
        assert.equal((await api.post(maturityUrl(v.id), { data: request })).status(), 400, 'An idempotency key is mandatory')
        assert.deepEqual(await detail(v.id), before, 'Rejected writes must preserve the version and timeline')
        const changed = await read(await call(maturityUrl(v.id), request, key, api, correlationId))
        assert.deepEqual(changed, { maturity: 'Deprecated', safety })
        assert.deepEqual(await read(await call(maturityUrl(v.id), request, key)), changed, 'Same-key retries must replay the result')
        assert.equal((await call(maturityUrl(v.id), { ...request, reason: '不同的请求内容' }, key)).status(), 409)
        assert.equal((await call(maturityUrl(v.id), request)).status(), 409, 'Already deprecated must not create another transition')
        assert.equal((await call(maturityUrl(v.id), { state: 'Released', reason: '不可意外恢复发布' })).status(), 409)
        const after = await detail(v.id)
        assert.equal(after.version.maturity, 'Deprecated')
        assert.equal(after.version.safety, safety)
        assert.equal(after.version.versionNumber, before.version.versionNumber, 'Version numbers remain opaque and unchanged')
        assert.equal(after.version.sequenceNo, before.version.sequenceNo)
        assert.equal(after.version.createdAt, before.version.createdAt)
        assert.equal(after.recommended, false)
        assert.equal(after.transitions.length, before.transitions.length + 1)
        const retired = after.transitions.filter(item => item.axis === 'Maturity' && item.toState === 'Deprecated')
        assert.equal(retired.length, 1)
        assert.equal(retired[0].fromState, maturity)
        assert.equal(retired[0].reason, request.reason)
        assert(retired[0].actor && Number.isFinite(Date.parse(retired[0].occurredAt)))
        const audit = (await get(`/api/v1/audit?entityId=${v.id}`)).filter(item => item.action === 'VersionMaturityChanged' && item.correlationId === correlationId)
        assert.equal(audit.length, 1, 'The command and its replay produce exactly one correlated audit event')
        assert.equal(audit[0].actor, retired[0].actor)
      }
    }
    assert.deepEqual(await get(`/api/v1/baselines/${baseline.id}`), frozen, 'Released baseline snapshots remain unchanged')
    assert.deepEqual(await get(`/api/v1/machines/${machine.id}/target`), target, 'Targets must not move when a version is deprecated')
    assert.deepEqual(await get(`/api/v1/projects/${project.id}/standard`), standard)
    assert.deepEqual(await get(`/api/v1/machines/${machine.id}/facts`), facts, 'Deprecation is not an installation or observation')
    assert.deepEqual(await get(`/api/v1/machines/${machine.id}/configuration`), actual)

    const permissionComponent = await component('权限校验组件')
    const permissionVersion = await version(permissionComponent.id, 'permission-testing', 'Testing')
    const permissionRequest = { state: 'Deprecated', reason: '高级工程师确认致命缺陷' }
    const anonymous = await browser.newContext({ baseURL })
    assert.equal((await call(maturityUrl(permissionVersion.id), permissionRequest, randomUUID(), anonymous.request)).status(), 401)
    await anonymous.close()
    for (const role of ['Viewer', 'SeniorEngineer']) {
      const userName = `deprecation-${role.toLowerCase()}-${suffix}`
      const password = 'Test!' + randomUUID() + 'aA1'
      const user = await write('/api/v1/admin/users', { userName, displayName: `废弃验收 ${role}`, password, role, reason: '自动化权限验收' })
      const userContext = await browser.newContext({ baseURL })
      try {
        await read(await userContext.request.post('/api/v1/auth/login', { data: { userName, password } }))
        const before = await detail(permissionVersion.id)
        assert.equal((await call(maturityUrl(permissionVersion.id), permissionRequest, randomUUID(), userContext.request)).status(), 403, `${role} without project permission must be denied`)
        assert.deepEqual(await detail(permissionVersion.id), before)
        if (role === 'SeniorEngineer') {
          await write(`/api/v1/projects/${project.id}/members`, { userId: user.id, role: 'SeniorEngineer', reason: '显式项目高级工程师授权' })
          const response = await read(await call(maturityUrl(permissionVersion.id), permissionRequest, randomUUID(), userContext.request))
          assert.equal(response.maturity, 'Deprecated', 'An explicitly authorized SeniorEngineer can retire a testing version')
        }
      } finally { await userContext.close() }
    }

    const uiComponent = await component('界面致命缺陷组件')
    const uiVersion = await version(uiComponent.id, 'UI-FATAL-' + suffix, 'Testing')
    page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    await page.evaluate(id => localStorage.setItem('confighub.selected-project-id', id), project.id)
    await page.reload()
    await page.locator('.nav-item').filter({ hasText: '项目' }).click()
    const laboratory = page.locator('.laboratory-tree')
    const laboratoryNode = laboratory.locator('.lab-node').filter({ hasText: '界面致命缺陷组件' })
    await laboratoryNode.click()
    const inspector = page.locator('#component-inspector')
    await inspector.locator('.version-item').filter({ hasText: uiVersion.versionNumber || 'UI-FATAL-' + suffix }).click()
    const form = inspector.locator('.lifecycle-form')
    await form.getByLabel('状态操作').selectOption('Deprecated')
    await form.getByLabel('操作原因').fill('界面确认致命缺陷，立即废弃测试版本')
    const pending = page.waitForResponse(response => response.url().endsWith(maturityUrl(uiVersion.id)) && response.request().method() === 'POST')
    await form.getByRole('button', { name: '更新状态', exact: true }).click()
    await read(await pending)
    await laboratoryNode.waitFor({ state: 'detached' })
    assert.equal(await laboratory.getByText('UI-FATAL-' + suffix, { exact: true }).count(), 0)
    await inspector.locator('.selected-version-summary').filter({ hasText: '已废弃' }).waitFor()
    await inspector.locator('.version-history').getByText('测试中 → 已废弃', { exact: true }).waitFor()
    mkdirSync(artifacts, { recursive: true })
    await page.screenshot({ path: path.join(artifacts, 'deprecated-testing-version.png'), fullPage: true })
    await laboratory.getByRole('button', { name: '测试历史', exact: true }).click()
    const history = page.getByRole('dialog', { name: '实验室测试历史', exact: true })
    await history.getByLabel('筛选测试历史组件').selectOption(uiComponent.id)
    const retiredEvent = history.locator('article').filter({ hasText: '界面确认致命缺陷，立即废弃测试版本' })
    await retiredEvent.getByText('废弃', { exact: true }).waitFor()
    await history.locator('article').filter({ hasText: '开始测试' }).waitFor()
    assert.equal(await history.locator('article').count(), 2, 'Testing start and retirement remain available in laboratory history')
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].filter(element => element.getBoundingClientRect().width).every(element => getComputedStyle(element).opacity === '1' && !/ant-zoom-(appear|enter)/.test(element.className)))
    await page.screenshot({ path: path.join(artifacts, 'laboratory-retirement-history.png'), fullPage: true })
    assert.equal((await detail(uiVersion.id)).version.maturity, 'Deprecated')
    assert.deepEqual(errors, [])
    console.log('Version deprecation passed: all four source maturities, independent Clear/Blocked safety, recommendation revocation, reason/idempotency/audit, project authorization, immutable baseline/target/facts, real UI retirement and laboratory history.')
  } catch (error) {
    if (page) { mkdirSync(artifacts, { recursive: true }); await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {}) }
    throw error
  } finally {
    for (const id of projects) {
      try { await read(await call(`/api/v1/projects/${id}/archive`, { reason: '废弃规则自动化验收结束' })) }
      catch (error) { console.error('Acceptance fixture archive failed:', error.message); process.exitCode = 1 }
    }
    await browser.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
