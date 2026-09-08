const assert = require('node:assert/strict')

async function main() {
  const { parseImportRows } = await import('../../src/web/src/import-parser.ts')
  const expected = [{ componentName: 'Main Control', versionNumber: 'V 1.0' }, { componentName: 'Driver', versionNumber: '2.0' }]
  for (const delimiter of [',', '\t', '  ', '    ', '\u3000']) {
    assert.deepEqual(parseImportRows(`\uFEFFMain Control${delimiter}V 1.0\r\n\r\nDriver${delimiter}2.0\r\n`), expected)
  }
  assert.deepEqual(parseImportRows('"Control, A"\tV1'), [{ componentName: 'Control, A', versionNumber: 'V1' }])
  assert.deepEqual(parseImportRows('"Control\tA",V1'), [{ componentName: 'Control\tA', versionNumber: 'V1' }])
  assert.deepEqual(parseImportRows('"Control, A","V""1"'), [{ componentName: 'Control, A', versionNumber: 'V"1' }])
  for (const invalid of ['', 'Control V1', 'Control,', 'Control\t', 'Control,V1,extra', 'Control\tV1\textra', '"Control,V1']) {
    assert.throws(() => parseImportRows(invalid), /请|两列/)
  }
  console.log('Import parser acceptance passed: CSV, TAB, repeated/full-width spaces, quotes, BOM, CRLF and invalid columns.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
