import Papa from 'papaparse'

export function parseImportRows(text: string) {
  const source = text.replace(/^\uFEFF/, '')
  if (!source.trim()) throw new Error('请填写需要导入的组件名称和版本号。')
  // Prefer spreadsheet TABs; spaces inside a name or opaque version remain intact.
  const parsed = Papa.parse<string[]>(source, {
    delimitersToGuess: ['\t', ',', '\u3000', '  '],
    skipEmptyLines: 'greedy',
  })
  if (parsed.errors.some(error => error.code !== 'UndetectableDelimiter')) throw new Error('表格内容的引号格式不完整，请检查后重新导入。')
  return parsed.data.map((record, index) => {
    const cells = parsed.meta.delimiter === '  ' ? record.filter(cell => cell.trim()) : record
    if (cells.length !== 2 || cells.some(cell => !cell.trim())) {
      throw new Error(`第 ${index + 1} 行需要两列：组件名称和版本号；支持逗号、制表符或连续空格分隔。`)
    }
    return { componentName: cells[0].trim(), versionNumber: cells[1].trim() }
  })
}
