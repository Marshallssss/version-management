const assert = require('node:assert/strict')
const fs = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const { chromium } = require('playwright')
const compiled = stripTypeScriptTypes(fs.readFileSync('src/web/src/baseline-pdf.ts', 'utf8')).replaceAll('export function ', 'function ') + '\nexports.baselinePrintHtml = baselinePrintHtml;'
const api = { exports: {} }
new Function('exports', compiled)(api.exports)
async function main() {
  const items = [{ id: 'root', parentItemId: null, componentName: '控制系统', sortOrder: 0, versionNumber: null }]
  for (let i = 0; i < 90; i++) items.push({ id: String(i), parentItemId: 'root', componentName: `子组件 ${i} <安全>`, sortOrder: i, versionNumber: `V1.0.${i}`, versionId: String(i), requirement: 'Required' })
  items[2].notConfigured = true
  const html = api.exports.baselinePrintHtml('中文项目', { baseline: { code: '历史基线 <script>恶意</script>', state: 'Released', revisionNo: 2, releasedAt: '2020-01-01T00:00:00Z', isHistorical: true, description: '历史评审记录' }, items })
  assert(!html.includes('<script>'))
  assert(html.includes('当时未配置'))
  assert(html.includes('北京时间'))
  assert.throws(() => api.exports.baselinePrintHtml('项目', { baseline: {}, items: [{ id: 'a', parentItemId: 'missing' }] }), /层级不完整/)
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    await page.setContent(html)
    assert.equal(await page.locator('tbody tr').count(), 91)
    assert.equal(await page.locator('script').count(), 0)
    await page.emulateMedia({ media: 'print' })
    assert.equal(await page.locator('.actions').isVisible(), false)
    fs.mkdirSync('artifacts/baseline-pdf', { recursive: true })
    const pdf = await page.pdf({ path: 'artifacts/baseline-pdf/baseline.pdf', preferCSSPageSize: true, printBackground: true })
    assert(pdf.length > 10000)
    await page.screenshot({ path: 'artifacts/baseline-pdf/report.png' })
    console.log('Baseline PDF acceptance passed: Chinese, hierarchy, 91 rows, escaping, absence, print-only content and real PDF generation.')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
