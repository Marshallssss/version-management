const { chromium } = require('playwright')
const { readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } = require('node:fs')
const { spawn } = require('node:child_process')
const { createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function reservePort() {
  const listener = createServer()
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve) })
  const port = listener.address().port
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()))
  return port
}

function startChild(dll, cwd, env, args = []) {
  const child = spawn(process.env.CONFIGHUB_DOTNET || 'dotnet', [dll, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] })
  let finished = false
  const exited = new Promise(resolve => {
    child.once('error', () => { finished = true; resolve({ startupError: true }) })
    child.once('close', code => { finished = true; resolve({ code }) })
  })
  return {
    exited,
    get finished() { return finished },
    async stop() {
      if (!finished) child.kill()
      const result = await Promise.race([exited, pause(10000).then(() => null)])
      if (result === null) {
        child.kill('SIGKILL')
        assert(await Promise.race([exited, pause(10000).then(() => null)]), 'Isolated Host did not stop')
      }
    },
  }
}

async function main() {
  const repository = path.resolve(__dirname, '../..')
  const baseURL = process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080'
  const sourceConfigPath = process.env.CONFIGHUB_TEST_CONFIG || path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json')
  const sourceConfigBytes = readFileSync(sourceConfigPath)
  const config = JSON.parse(sourceConfigBytes.toString('utf8').replace(/^\uFEFF/, ''))
  const credentials = { userName: config.ConfigHub.BootstrapAdmin.UserName || config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password }
  const temporaryParent = realpathSync(tmpdir())
  const temporaryDirectory = mkdtempSync(path.join(temporaryParent, 'confighub-maintenance-closed-'))
  const output = path.join(repository, 'artifacts/maintenance-closed')
  const hostDirectory = path.join(repository, 'src/server/Host')
  const hostDll = path.join(hostDirectory, 'bin/Release/net10.0/ConfigHub.Host.dll')
  const workerDirectory = path.join(repository, 'src/server/Worker')
  const workerDll = path.join(workerDirectory, 'bin/Release/net10.0/ConfigHub.Worker.dll')
  const children = []
  let browser, open, closed, page, project
  const errors = []
  const call = async (client, url, data, status = 200, key = randomUUID()) => {
    const response = await client.post(url, { data, headers: { 'Idempotency-Key': key } })
    assert.equal(response.status(), status, `${url}: expected ${status}, received ${response.status()}`)
    const body = await response.text()
    return body ? JSON.parse(body) : null
  }
  const get = async (client, url) => {
    const response = await client.get(url)
    assert(response.ok(), `${url}: received ${response.status()}`)
    return response.json()
  }
  const assertMaintenanceHidden = async target => {
    assert.equal(await target.getByRole('button', { name: '调测维护', exact: true }).count(), 0)
    assert.equal(await target.getByRole('button', { name: '历史维护', exact: true }).count(), 0)
    assert.equal(await target.locator('.version-maintenance form, .maintenance-action form').count(), 0)
    assert.equal(await target.getByLabel('历史录入时间', { exact: true }).count(), 0)
    assert.equal(await target.getByLabel('维护原因', { exact: true }).count(), 0)
  }
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true })
    open = await browser.newContext({ baseURL })
    await call(open.request, '/api/v1/auth/login', credentials, 204)
    assert((await get(open.request, '/api/v1/auth/me')).roles.includes('SuperAdmin'), 'Acceptance requires SuperAdmin fixture owner')
    assert.equal((await get(open.request, '/api/v1/maintenance-capabilities')).enabled, true, 'Main Host maintenance must remain open')

    // An explicit missing override must not silently fall back to the live user configuration.
    const missingEnvironment = { ...process.env, CONFIGHUB_LOCAL_CONFIG_PATH: path.join(temporaryDirectory, 'missing.json') }
    for (const [dll, cwd] of [[hostDll, hostDirectory], [workerDll, workerDirectory]]) {
      const probe = startChild(dll, cwd, missingEnvironment)
      children.push(probe)
      const result = await Promise.race([probe.exited, pause(15000).then(() => null)])
      assert(result && !result.startupError && result.code !== 0, 'Missing explicit local configuration must fail startup')
    }

    const closedURL = `http://127.0.0.1:${await reservePort()}`
    const closedConfig = structuredClone(config)
    closedConfig.ConfigHub.TestDataMaintenanceEnabled = false
    closedConfig.ConfigHub.BootstrapAdmin.ResetPassword = false
    closedConfig.urls = closedURL
    closedConfig.Kestrel = { Endpoints: { AcceptanceHttp: { Url: closedURL } } }
    const isolatedConfigDirectory = path.join(temporaryDirectory, 'ConfigHub')
    mkdirSync(isolatedConfigDirectory)
    const closedConfigPath = path.join(isolatedConfigDirectory, 'appsettings.local.json')
    writeFileSync(closedConfigPath, JSON.stringify(closedConfig), { mode: 0o600 })
    const host = startChild(hostDll, hostDirectory, {
      ...process.env,
      LOCALAPPDATA: temporaryDirectory,
      CONFIGHUB_LOCAL_CONFIG_PATH: closedConfigPath,
      ASPNETCORE_ENVIRONMENT: 'Development',
      DOTNET_ENVIRONMENT: 'Development',
      ASPNETCORE_URLS: closedURL,
      ConfigHub__BootstrapAdmin__ResetPassword: 'false',
    }, ['--urls', closedURL])
    children.push(host)
    closed = await browser.newContext({ baseURL: closedURL, viewport: { width: 1440, height: 1000 } })
    let healthy = false
    for (let attempt = 0; attempt < 120; attempt++) {
      assert(!host.finished, 'Isolated Host exited before becoming ready')
      healthy = await closed.request.get('/health/ready', { timeout: 1500 }).then(response => response.ok()).catch(() => false)
      if (healthy) break
      await pause(250)
    }
    assert(healthy, 'Isolated Host did not become ready')
    await call(closed.request, '/api/v1/auth/login', credentials, 204)
    assert.equal((await get(closed.request, '/api/v1/maintenance-capabilities')).enabled, false)
    assert((await get(closed.request, '/api/v1/auth/me')).roles.includes('SuperAdmin'))

    const token = randomUUID().slice(0, 8)
    project = await call(open.request, '/api/v1/projects', { code: 'CLOSED-' + token, name: '维护关闭验收 ' + token, reason: '真实隔离维护开关验收' }, 201)
    const component = await call(open.request, `/api/v1/projects/${project.id}/components`, { name: '控制程序', reason: '维护关闭验收' }, 201)
    const version = await call(open.request, `/api/v1/components/${component.id}/versions`, { versionNumber: 'V1', maturity: 'Released', reason: '维护关闭验收' }, 201)
    const baseline = await call(open.request, `/api/v1/projects/${project.id}/baselines`, { seriesCode: 'CLOSED', baselineCode: 'HISTORY-V1', publishImmediately: true, reason: '维护关闭验收' }, 201)
    const versionUrl = `/api/v1/component-versions/${version.id}`
    const baselineUrl = `/api/v1/baselines/${baseline.id}`
    const versionMaintenance = { versionNumber: 'V1-historical', maturity: 'Released', createdAt: '2001-01-01T00:00:00Z', releasedAt: '2002-01-01T00:00:00Z', maintenanceMode: true, reason: '开关开放时的历史版本修正' }
    const baselineMaintenance = { releasedAt: '2003-01-01T00:00:00Z', versionSelections: [{ componentId: component.id, versionId: version.id }], maintenanceMode: true, reason: '开关开放时的历史基线修正' }
    const versionKey = randomUUID()
    const baselineKey = randomUUID()
    await call(open.request, versionUrl + '/maintenance', versionMaintenance, 200, versionKey)
    await call(open.request, baselineUrl + '/maintenance', baselineMaintenance, 200, baselineKey)
    const before = { version: await get(open.request, versionUrl), baseline: await get(open.request, baselineUrl) }
    assert.equal(before.version.version.versionNumber, 'V1-historical')
    assert(before.baseline.baseline.releasedAt.startsWith('2003-01-01'))
    for (const [url, data, key] of [[versionUrl, versionMaintenance, versionKey], [baselineUrl, baselineMaintenance, baselineKey]]) {
      const replay = await call(closed.request, url + '/maintenance', data, 409, key)
      assert.equal(replay.message, '调测维护已关闭。', 'Closed switch must take precedence over successful idempotency replay')
      const fresh = await call(closed.request, url + '/maintenance', { ...data, createdAt: '2004-01-01T00:00:00Z', reason: '关闭后不得写入' }, 409)
      assert.equal(fresh.message, '调测维护已关闭。')
    }
    assert.deepEqual(await get(closed.request, versionUrl), before.version, 'Rejected maintenance must not modify version or lifecycle history')
    assert.deepEqual(await get(closed.request, baselineUrl), before.baseline, 'Rejected maintenance must not modify frozen snapshot or recorded time')

    const viewerName = 'closed-viewer-' + token
    const viewerPassword = randomUUID()
    const viewer = await call(open.request, '/api/v1/admin/users', { userName: viewerName, displayName: '维护关闭验收只读用户', password: viewerPassword, role: 'Viewer', reason: '维护关闭权限验收' }, 201)
    await call(open.request, `/api/v1/projects/${project.id}/members`, { userId: viewer.id, role: 'Viewer', reason: '只读项目成员验收' })
    const viewerContext = await browser.newContext({ baseURL: closedURL, viewport: { width: 1440, height: 1000 } })
    await call(viewerContext.request, '/api/v1/auth/login', { userName: viewerName, password: viewerPassword }, 204)
    assert.equal((await get(viewerContext.request, '/api/v1/maintenance-capabilities')).enabled, false)
    assert((await get(viewerContext.request, '/api/v1/auth/me')).roles.includes('Viewer'))
    for (const [url, data, key] of [[versionUrl, versionMaintenance, versionKey], [baselineUrl, baselineMaintenance, baselineKey]]) {
      await call(viewerContext.request, url + '/maintenance', data, 403, key)
    }
    await call(viewerContext.request, `/api/v1/components/${component.id}/versions`, { versionNumber: 'MUST-NOT-EXIST', maturity: 'Testing', reason: '只读拒绝写入' }, 403)
    const anonymous = await browser.newContext({ baseURL: closedURL })
    for (const [url, data] of [[versionUrl, versionMaintenance], [baselineUrl, baselineMaintenance]]) {
      await call(anonymous.request, url + '/maintenance', data, 401)
      assert.equal((await anonymous.request.get(url)).status(), 401)
    }
    await anonymous.close()

    mkdirSync(output, { recursive: true })
    for (const [context, label] of [[closed, 'superadmin'], [viewerContext, 'viewer']]) {
      page = await context.newPage()
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('/')
      await page.evaluate(id => localStorage.setItem('confighub.selected-project-id', id), project.id)
      await page.reload()
      await page.locator('.nav-item').filter({ hasText: /^版本$/ }).click()
      await page.locator('.root-node').filter({ hasText: '控制程序' }).first().click()
      const inspector = page.locator('.component-inspector')
      await inspector.locator('.version-item').filter({ hasText: 'V1-historical' }).click()
      await inspector.locator('.version-history').waitFor()
      await assertMaintenanceHidden(page)
      if (label === 'viewer') assert.equal(await inspector.locator('form:visible').count(), 0)
      await page.locator('.nav-item').filter({ hasText: '基线' }).click()
      await page.locator('.baseline-timeline button').filter({ hasText: 'HISTORY-V1' }).click()
      await page.locator('.baseline-snapshot').getByRole('heading', { name: 'HISTORY-V1', exact: true }).waitFor()
      await assertMaintenanceHidden(page)
      if (label === 'viewer') assert.equal(await page.locator('.baseline-history-detail form:visible').count(), 0)
      await page.screenshot({ path: path.join(output, label + '-desktop.png'), fullPage: true })
      await page.setViewportSize({ width: 390, height: 844 })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Closed-maintenance mobile page must not overflow')
      await assertMaintenanceHidden(page)
      await page.screenshot({ path: path.join(output, label + '-mobile.png'), fullPage: true })
      if (label === 'superadmin') {
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.locator('.nav-item').filter({ hasText: /^版本$/ }).click()
        await page.locator('.root-node').filter({ hasText: '控制程序' }).first().click()
        await inspector.getByRole('button', { name: '版本', exact: true }).click()
        await inspector.getByRole('button', { name: '登记新版本', exact: true }).click()
        await inspector.getByLabel('版本号', { exact: true }).fill('V2-closed-normal')
        await inspector.getByLabel('登记原因', { exact: true }).fill('关闭维护后正常登记不受影响')
        await inspector.getByRole('button', { name: '登记测试中版本', exact: true }).click()
        await page.getByText('测试中版本已登记。', { exact: true }).waitFor()
        await assertMaintenanceHidden(page)
      }
    }
    const projectAfter = await get(closed.request, `/api/v1/projects/${project.id}`)
    const versions = projectAfter.components.find(item => item.id === component.id).versions
    assert(versions.some(item => item.versionNumber === 'V2-closed-normal' && item.maturity === 'Testing'), 'Normal UI registration must still work with maintenance closed')
    assert(!versions.some(item => item.versionNumber === 'MUST-NOT-EXIST'))
    assert.deepEqual(await get(closed.request, versionUrl), before.version)
    assert.deepEqual(await get(closed.request, baselineUrl), before.baseline)
    assert.equal((await get(open.request, '/api/v1/maintenance-capabilities')).enabled, true, 'Live Host maintenance switch must remain unchanged')
    assert.deepEqual(readFileSync(sourceConfigPath), sourceConfigBytes, 'Live local configuration file must remain byte-for-byte unchanged')
    assert.deepEqual(errors, [])
    console.log('Closed maintenance acceptance passed: isolated real Host, SuperAdmin/replay rejection, Viewer/anonymous authorization, immutable records, hidden maintenance UI, normal version registration, fail-fast configuration, unchanged live Host.')
  } catch (error) {
    if (page) {
      mkdirSync(output, { recursive: true })
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {})
    }
    throw error
  } finally {
    if (project && open) await call(open.request, `/api/v1/projects/${project.id}/archive`, { reason: '维护关闭验收结束归档' }).catch(() => {})
    const cleanupErrors = []
    try {
      await browser?.close().catch(error => cleanupErrors.push(error))
      for (const child of children) await child.stop().catch(error => cleanupErrors.push(error))
    } finally {
      const resolved = realpathSync(temporaryDirectory)
      assert.equal(path.dirname(resolved).toLowerCase(), temporaryParent.toLowerCase(), 'Temporary cleanup must stay in the original temp parent')
      assert.equal(resolved.toLowerCase(), path.resolve(temporaryDirectory).toLowerCase(), 'Temporary cleanup must not follow a redirected path')
      assert(path.basename(resolved).startsWith('confighub-maintenance-closed-'), 'Only this test temporary directory may be removed')
      rmSync(resolved, { recursive: true, force: false })
    }
    assert.equal(cleanupErrors.length, 0, 'Acceptance browser and isolated processes must all close successfully')
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
