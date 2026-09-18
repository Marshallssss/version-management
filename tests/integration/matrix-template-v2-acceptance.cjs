const { request } = require('playwright')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const config = JSON.parse(readFileSync(path.join(process.env.LOCALAPPDATA, 'ConfigHub/appsettings.local.json'), 'utf8').replace(/^\uFEFF/, ''))
  const api = await request.newContext({ baseURL: process.env.CONFIGHUB_TEST_URL || 'http://127.0.0.1:5080' })
  const output = path.resolve('artifacts/matrix-template-v2')
  mkdirSync(output, { recursive: true })
  const workbook = path.join(output, 'template.xlsx')
  const fixture = (changes = {}) => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('tests/integration/matrix-workbook-fixture.ps1'), '-Path', workbook, '-CellsJson', JSON.stringify(changes)], { encoding: 'utf8', windowsHide: true }).replace(/^\uFEFF/, ''))
  const write = async (url, data, method = 'POST') => {
    const response = await api.fetch(url, { method, data, headers: { 'Idempotency-Key': randomUUID() } })
    assert(response.ok(), `${url}: ${await response.text()}`)
    return response.status() === 204 ? null : response.json()
  }
  let project, source
  try {
    await write('/api/v1/auth/login', { email: config.ConfigHub.BootstrapAdmin.Email, password: config.ConfigHub.BootstrapAdmin.Password })
    project = await write('/api/v1/projects', { code: `V2 ${randomUUID().slice(0, 8)}`, name: '设备软件版本台账', reason: '新版模板验收' })
    const component = (name, parentComponentId) => write(`/api/v1/projects/${project.id}/components`, { name, parentComponentId, reason: '模板验收' })
    const group = await component('控制系统')
    const main = await component('主控程序', group.id)
    const driver = await component('驱动程序', group.id)
    const ui = await component('操作界面')
    for (const item of [main, driver, ui]) await write(`/api/v1/components/${item.id}/versions`, { versionNumber: 'V1.0', maturity: 'Released', reason: '冻结参考' })
    const baseline = await write(`/api/v1/projects/${project.id}/baselines`, { seriesCode: 'V2', baselineCode: 'V2-REF', publishImmediately: true, reason: '冻结参考' })
    await write(`/api/v1/projects/${project.id}/standard`, { configurationBaselineId: baseline.id, reason: '冻结参考' })
    const route = `/api/v1/projects/${project.id}/matrix-import`
    const template = await write(`${route}/templates`, { reason: '新版模板验收' })
    const download = await api.get(template.downloadUrl)
    assert(download.ok())
    const original = await download.body()
    writeFileSync(workbook, original)
    const cells = fixture()
    const row = item => Number(Object.entries(cells).find(([key, value]) => /^A\d+$/.test(key) && value === item.id)?.[0].slice(1))
    const mainRow = row(main), driverRow = row(driver), uiRow = row(ui)
    assert(mainRow && driverRow && uiRow)
    assert.equal(cells.A1, `ConfigHub.Matrix.v2:${template.id}`)
    assert.equal(cells.__layout.freeze, 'D7')
    assert.equal(cells.__layout.groupRows.length, 2)
    assert.match(cells.__layout.format, /YYYY-MM-DD/)
    assert.match(cells.B5, /2026-09-18/)
    assert(!Object.values(cells).includes('_submit'))
    assert.equal(cells[`C${mainRow}`], 'V1.0')
    assert(cells.B3.includes('无需提交标记'))
    const first = { D5: '2026-09-18', D6: '修复通信超时', [`D${mainRow}`]: '001.02' }
    const scan = () => write(`${route}/scan`, { templateId: template.id, fileName: 'template.xlsx', contentBase64: readFileSync(workbook).toString('base64'), reason: '模板校验' })
    const invalidCases = [
      [{ ...first, D5: '' }, /记录日期/],
      [{ ...first, D5: '2026-02-30' }, /记录日期/],
      [{ ...first, D5: { numeric: 46283 } }, /记录日期/],
      [{ ...first, D6: '' }, /变更说明/],
      [{ ...first, [`D${mainRow}`]: { numeric: 1.02 } }, /文本版本号/],
      [{ ...first, [`D${mainRow}`]: { formula: '1+1' } }, /公式/],
      [{ ...first, E1: cells.D1, E5: '2026-09-18', E6: '重复标识', [`E${driverRow}`]: 'V2' }, /重复/],
      [{ ...first, [`A${driverRow}`]: main.id }, /重复/],
      [{ ...first, [`A${driverRow}`]: '' }, /缺少组件行/],
      [{ ...first, [`C${mainRow}`]: 'tampered' }, /冻结参考/],
      [{ ...first, [`D${cells.__layout.groupRows[0]}`]: 'V2' }, /分类标题行/],
      [{ ...first, D5000: 'V2' }, /模板组件行/],
      [{ ...first, E5: '2026-09-18', E6: '尚未填写版本' }, /没有版本变更/],
      [{ ...first, E5: '', E6: '第二列不完整', [`E${driverRow}`]: 'V2' }, /记录日期/],
    ]
    for (const [changes, error] of invalidCases) {
      writeFileSync(workbook, original)
      fixture(changes)
      const run = await scan()
      assert.equal(run.status, 'Failed', JSON.stringify(run))
      assert.equal(run.importedCount, 0)
      assert.match(JSON.stringify(run.messages), error)
      const detail = await (await api.get(`/api/v1/projects/${project.id}`)).json()
      assert(detail.components.every(item => item.versions.every(version => version.versionNumber === 'V1.0')), 'Invalid workbook must not partially register earlier columns')
    }
    writeFileSync(workbook, original)
    fixture({ ...first, E5: '2026-09-19', E6: '驱动联调', [`E${driverRow}`]: 'V2.1' })
    const imported = await scan()
    assert.equal(imported.status, 'Succeeded', JSON.stringify(imported))
    assert.equal(imported.importedCount, 2)
    const repeated = await scan()
    assert.equal(repeated.importedCount, 0)
    assert.equal(repeated.skippedCount, 2)
    const combinations = (await (await api.get(route)).json()).combinations.toSorted((a, b) => a.sequenceNo - b.sequenceNo)
    assert.equal(combinations[0].items.find(item => item.componentId === main.id).versionNumber, '001.02')
    assert.equal(combinations[1].items.find(item => item.componentId === main.id).versionNumber, '001.02')
    assert.equal(combinations[1].items.find(item => item.componentId === ui.id).versionNumber, 'V1.0')
    assert.equal(combinations[1].sourceLabel, 'E 列')
    fixture({ D6: '修改已录入列' })
    assert.equal((await scan()).status, 'Failed')
    fixture({ D6: first.D6 })
    if (process.env.CONFIGHUB_TEST_SCHEDULE === '1') {
      fixture({ F5: '2026-09-20', F6: '自动扫描录入', [`F${uiRow}`]: 'UI.2' })
      const due = new Date(Date.now() + 65000)
      source = { templateId: template.id, path: workbook, localTime: due.toISOString().slice(11, 16), timeZoneId: 'UTC', enabled: true, reason: '新版无提交标记的真实调度验收' }
      await write(`${route}/source`, source, 'PUT')
      let scheduled = false
      const deadline = Date.now() + 95000
      while (Date.now() < deadline) {
        const workspace = await (await api.get(route)).json()
        if (workspace.combinations.length === 3) {
          const latest = workspace.combinations.find(item => item.sequenceNo === 3)
          assert.equal(latest.items.find(item => item.componentId === ui.id).versionNumber, 'UI.2')
          assert.equal(latest.sourceLabel, 'F 列')
          assert(workspace.runs.some(run => run.actor.startsWith('自动扫描:') && run.importedCount === 1))
          scheduled = true
          break
        }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      assert(scheduled, 'Worker must import v2 without a submit flag or browser action')
    }
    console.log('Matrix v2 template passed: vertical groups/freeze/date prompts, no submit flag, 14 malformed/incomplete workbook guards, atomic import, opaque versions, inheritance, rescan and committed-column protection' + (source ? ', real Worker scheduled v2 import.' : '.'))
  } finally {
    if (source) await write(`/api/v1/projects/${project.id}/matrix-import/source`, { ...source, enabled: false, reason: '验收完成' }, 'PUT').catch(() => {})
    if (project) await write(`/api/v1/projects/${project.id}/archive`, { reason: '验收完成' }).catch(() => {})
    await api.dispose()
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1 })
