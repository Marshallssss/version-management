const { chromium } = require('playwright')
const { readFileSync, mkdirSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const baseURL = process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080'
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' })
  const api = context.request
  const call = (url, data, method = 'POST', client = api, key = randomUUID()) => client.fetch(url, { method, data, headers: { 'Idempotency-Key': key } })
  const write = async (url, data, method = 'POST', client = api) => { const r = await call(url, data, method, client); assert(r.ok(), `${url}: ${await r.text()}`); return r.status() === 204 ? null : r.json() }
  const get = async url => { const r = await api.get(url); assert(r.ok(), await r.text()); return r.json() }
  const token = randomUUID().slice(0, 8)
  const projects = []
  const output = path.resolve('artifacts/metadata-lab')
  mkdirSync(output, { recursive: true })
  const fixture = (...args) => execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/integration/baseline-metadata-fixture.ps1'), ...args], { windowsHide: true })
  const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19)
  let page
  try {
    await write('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    const project = await write('/api/v1/projects', { code: `META-${token}`, name: '元数据与批量上机验收', description: '原项目说明', reason: '验收' })
    projects.push(project.id)
    const component = name => write(`/api/v1/projects/${project.id}/components`, { name, reason: '验收' })
    const a = await component('主控'), b = await component('驱动'), c = await component('界面')
    const version = (component, number, maturity = 'Released') => write(`/api/v1/components/${component.id}/versions`, { versionNumber: number, maturity, reason: '验收' })
    const a0 = await version(a, 'A.0'), b0 = await version(b, 'B.0'), c0 = await version(c, 'C.0')
    const cloned = await write(`/api/v1/projects/${project.id}/clone`, { code: `META-CLONE-${token}`, name: '克隆项目', description: '独立的新说明', reason: '克隆验收' })
    projects.push(cloned.id)
    const cloneBefore = await get(`/api/v1/projects/${cloned.id}`)
    assert.equal(cloneBefore.project.description, '独立的新说明')
    await write(`/api/v1/projects/${cloned.id}`, { code: `META EDIT ${token}`, name: '克隆后的新名称', description: '已编辑的项目说明', reason: '资料修改' }, 'PUT')
    const cloneAfter = await get(`/api/v1/projects/${cloned.id}`)
    assert.equal(cloneAfter.project.description, '已编辑的项目说明')
    assert.deepEqual(cloneAfter.components, cloneBefore.components)
    assert.equal((await get(`/api/v1/projects/${project.id}`)).project.description, '原项目说明')
    assert.equal((await call(`/api/v1/projects/${cloned.id}`, { code: `META-${token}`, name: '重复编码', reason: '验收' }, 'PUT')).status(), 409)

    const template = await write(`/api/v1/projects/${project.id}/matrix-import/templates`, { reason: '项目校验' })
    const otherTemplate = await write(`/api/v1/projects/${cloned.id}/matrix-import/templates`, { reason: '项目校验' })
    const download = await api.get(template.downloadUrl)
    const importData = { templateId: template.id, fileName: 'wrong-project.xlsx', contentBase64: (await download.body()).toString('base64'), reason: '禁止跨项目' }
    assert.equal((await call(`/api/v1/projects/${cloned.id}/matrix-import/scan`, importData)).status(), 404)
    const wrongFile = await write(`/api/v1/projects/${cloned.id}/matrix-import/scan`, { ...importData, templateId: otherTemplate.id })
    assert.equal(wrongFile.status, 'Failed')
    assert.match(JSON.stringify(wrongFile.messages), /当前项目/)
    assert((await get(`/api/v1/projects/${cloned.id}`)).components.every(item => item.versions.length === 0))

    const baseline = await write(`/api/v1/projects/${project.id}/baselines`, { seriesCode: 'META', baselineCode: '原基线名称', publishImmediately: true, reason: '验收' })
    fixture('-BaselineId', baseline.id, '-ReleasedAt', '2020-01-15T23:59:59+08:00')
    const frozen = await get(`/api/v1/baselines/${baseline.id}`)
    const users = {}
    for (const role of ['Admin', 'SeniorEngineer', 'Viewer']) {
      const userName = `meta-${role}-${token}`, password = randomUUID()
      await write('/api/v1/admin/users', { userName, displayName: '权限验收', password, role, reason: '验收' })
      const userContext = await browser.newContext({ baseURL })
      await write('/api/v1/auth/login', { userName, password }, 'POST', userContext.request)
      users[role] = userContext
    }

    for (const role of ['SeniorEngineer', 'Viewer']) assert.equal((await call(`/api/v1/baselines/${baseline.id}/name`, { name: '不能修改', reason: '验收' }, 'PUT', users[role].request)).status(), 403)
    const key = randomUUID(), rename = { name: '管理员更名基线', reason: '名称纠错' }
    for (let i = 0; i < 2; i++) assert.equal((await call(`/api/v1/baselines/${baseline.id}/name`, rename, 'PUT', users.Admin.request, key)).status(), 200)
    const renamed = await get(`/api/v1/baselines/${baseline.id}`)
    assert.deepEqual(renamed.items, frozen.items)
    assert.equal(renamed.baseline.releasedAt, frozen.baseline.releasedAt)
    assert.equal(renamed.baseline.createdAt, frozen.baseline.createdAt)
    assert.equal((await get(`/api/v1/audit?entityId=${baseline.id}`)).filter(item => item.action === 'BaselineRenamed').length, 1)
    fixture('-BaselineId', baseline.id, '-VerifyRenameGuard')
    assert.equal((await call(`/api/v1/projects/${project.id}`, { code: 'NO', name: 'NO', reason: '验收' }, 'PUT', users.Viewer.request)).status(), 403)

    const av = await version(a, 'A.TEST', 'Testing'), bv = await version(b, 'B.TEST', 'Testing')
    const machineData = { projectId: project.id, name: 'Lab 一号机', serialNumber: `META-A-${token}`, stage: 'Lab', process: '刻蚀工艺', equipmentConfiguration: '六腔室配置', chambers: [{ number: 1, stage: 'Lab' }], reason: '验收' }
    const m1 = await write('/api/v1/machines', machineData)
    const m2 = await write('/api/v1/machines', { ...machineData, name: 'Lab 二号机', serialNumber: `META-B-${token}`, process: null, equipmentConfiguration: null })
    const nonLab = await write('/api/v1/machines', { ...machineData, name: '生产机台', serialNumber: `META-HVM-${token}`, stage: 'HVM', chambers: [] })
    const foreign = await write('/api/v1/machines', { ...machineData, projectId: cloned.id, serialNumber: `META-FOREIGN-${token}` })
    const machine = (await get('/api/v1/machines')).find(item => item.id === m1.id)
    assert.equal(machine.process, '刻蚀工艺')
    await write(`/api/v1/machines/${m1.id}`, { ...machineData, status: 'Active', process: '沉积工艺', equipmentConfiguration: 'PM1 + PM6', reason: '更新资料' }, 'PUT')
    assert.equal((await get(`/api/v1/projects/${project.id}/machine-registry`)).items.find(item => item.id === m1.id).equipmentConfiguration, 'PM1 + PM6')
    assert.equal((await call('/api/v1/machines', { ...machineData, serialNumber: `META-LONG-${token}`, process: 'x'.repeat(201) })).status(), 400)
    await write(`/api/v1/machines/${m1.id}/target`, { configurationBaselineId: baseline.id, reason: '目标不能被上机改变' })
    for (const m of [m1, m2]) await write(`/api/v1/machines/${m.id}/facts`, { operationType: 'InitialSnapshot', coverage: 'Full', sourceType: 'acceptance', effectiveAt: new Date(Date.now() - 600000).toISOString(), reason: '保留未选组件', items: [{ componentId: a.id, versionId: a0.id, absent: false }, { componentId: b.id, versionId: b0.id, absent: false }, { componentId: c.id, versionId: c0.id, absent: false }] })
    const deployment = { machineId: m1.id, chamberNumber: null, versionIds: [av.id, bv.id], installedAt: new Date(Date.now() - 60000).toISOString(), reason: '多版本单范围' }
    const endpoint = `/api/v1/projects/${project.id}/laboratory-deployments`
    assert.equal((await call(endpoint, { ...deployment, machineId: foreign.id })).status(), 400)
    assert.equal((await call(endpoint, { ...deployment, machineId: nonLab.id })).status(), 400)
    assert.equal((await call(endpoint, { ...deployment, versionIds: [av.id, a0.id] })).status(), 400)
    assert.equal((await call(endpoint, { ...deployment, versionIds: [av.id, b0.id] })).status(), 409)
    assert.equal((await call(endpoint, deployment, 'POST', users.Viewer.request)).status(), 403)
    await write(endpoint, deployment)
    await write(endpoint, { ...deployment, chamberNumber: 1 })
    assert.equal((await get(`/api/v1/machines/${m1.id}/equipment`)).chambers[0].overrides.length, 2)

    page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    await page.evaluate(id => localStorage.setItem('confighub.selected-project-id', id), project.id)
    await page.reload()
    await page.locator('.project-switch').click()
    await page.getByRole('button', { name: '编辑项目资料', exact: true }).click()
    await page.getByLabel('项目说明', { exact: true }).fill('界面保存说明')
    await page.getByLabel('修改原因', { exact: true }).fill('界面验收')
    await page.getByRole('button', { name: '保存项目资料', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    assert.equal((await get(`/api/v1/projects/${project.id}`)).project.description, '界面保存说明')
    await page.locator('.nav-item').filter({ hasText: /^基线$/ }).click()
    await page.getByLabel('基线开始日期').fill('2020-01-15')
    await page.getByLabel('基线结束日期').fill('2020-01-15')
    await page.locator('.timeline-item').filter({ hasText: '管理员更名基线' }).click()
    await page.locator('.snapshot-heading').getByText(/发布时间：2020/).waitFor()
    await page.getByRole('button', { name: '编辑基线名称', exact: true }).click()
    await page.getByRole('dialog').getByLabel('基线名称').fill('界面更名基线')
    await page.getByRole('dialog').getByLabel('修改原因').fill('名称更新')
    await page.getByRole('button', { name: '保存名称', exact: true }).click()
    await page.locator('.snapshot-heading h3').filter({ hasText: '界面更名基线' }).waitFor()
    await page.screenshot({ path: path.join(output, 'baseline-desktop.png'), fullPage: true })
    await page.locator('.nav-item').filter({ hasText: /^版本$/ }).click()
    await page.locator('.lab-node-shell').filter({ hasText: '主控' }).getByRole('button', { name: '已上机', exact: true }).click()
    await page.getByRole('checkbox', { name: '驱动 B.TEST', exact: true }).check()
    await page.getByRole('checkbox', { name: /Lab 一号机 · 整机/ }).check()
    await page.getByRole('checkbox', { name: /Lab 二号机 · 整机/ }).check()
    await page.getByLabel('实际升级时间').fill(localNow())
    await page.getByLabel('升级原因', { exact: true }).fill('批量真实上机验收')
    let failSecond = true
    await page.route(`**${endpoint}`, async route => {
      if (failSecond && route.request().postDataJSON().machineId === m2.id) { await route.fulfill({ status: 503, json: { message: '验收：机台暂时不可写入' } }); return }
      await route.continue()
    })
    await page.getByRole('button', { name: '记录已完成的升级', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '1 项失败' }).waitFor()
    const factsAfterPartial = (await get(`/api/v1/machines/${m1.id}/facts`)).length
    failSecond = false
    await page.getByRole('button', { name: '重试失败项', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '全部 2 项已保存' }).waitFor()
    assert.equal((await get(`/api/v1/machines/${m1.id}/facts`)).length, factsAfterPartial)
    for (const m of [m1, m2]) {
      const actual = await get(`/api/v1/machines/${m.id}/configuration`)
      for (const v of [av, bv, c0]) assert(actual.some(item => item.versionId === v.id))
    }
    assert.equal((await get(`/api/v1/machines/${m1.id}/target`)).baselineId, baseline.id)
    await page.getByRole('button', { name: '登记验证结果', exact: true }).click()
    await page.getByRole('checkbox', { name: /Lab 一号机 · 整机/ }).check()
    await page.getByRole('checkbox', { name: /Lab 二号机 · 整机/ }).check()
    await page.getByLabel('实际验证时间').fill(localNow())
    await page.getByLabel('验证说明', { exact: true }).fill('两台机台两个版本均验证通过')
    await page.getByRole('button', { name: '保存验证结果', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '全部 4 项已保存' }).waitFor()
    const lab = await get(`/api/v1/projects/${project.id}/laboratory-versions`)
    for (const v of [av, bv]) assert.equal(lab.versions.find(item => item.versionId === v.id).validations.length, 2)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.getByRole('group', { name: '测试版本（可多选）' }).scrollIntoViewIfNeeded()
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: path.join(output, `lab-${width}.png`), animations: 'disabled' })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.locator('.laboratory-drawer .ant-drawer-close').click()
    await page.locator('.nav-item').filter({ hasText: /^机台$/ }).click()
    await page.getByRole('button', { name: '新建机台 / 从已有机台复制资料', exact: true }).click()
    const machineDialog = page.getByRole('dialog')
    await machineDialog.getByLabel('复制已有机台').selectOption(m1.id)
    await machineDialog.getByLabel('工艺（非必填）').fill('界面工艺')
    await machineDialog.getByLabel('配置（非必填）', { exact: true }).fill('界面克隆配置')
    await machineDialog.getByLabel('机台序列号').fill('META-UI-' + token)
    await machineDialog.getByLabel('机台名称').fill('界面克隆机台')
    await machineDialog.getByLabel('创建原因').fill('机台资料验收')
    await machineDialog.getByRole('button', { name: '创建机台', exact: true }).click()
    await machineDialog.waitFor({ state: 'hidden' })
    const savedMachine = (await get('/api/v1/machines')).find(item => item.serialNumber === 'META-UI-' + token)
    assert.equal(savedMachine.process, '界面工艺')
    assert.equal(savedMachine.equipmentConfiguration, '界面克隆配置')
    await page.screenshot({ path: path.join(output, 'machine-desktop.png'), fullPage: true })
    assert.deepEqual(errors, [])
    console.log('Metadata/Lab passed: project/template isolation, clone description/edit, Admin-only name changes, frozen DB guard, actual release dates, optional machine metadata, multiple versions/whole/PM scopes, Viewer denial, partial-result retry without duplicates and responsive UI.')
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
    throw error
  } finally {
    for (const id of projects) await write(`/api/v1/projects/${id}/archive`, { reason: '验收结束' }).catch(() => {})
    await browser.close()
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1 })
