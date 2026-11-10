import type { getBaselineDetail } from './catalog-api'

type Snapshot = Awaited<ReturnType<typeof getBaselineDetail>>
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

export function baselinePrintHtml(projectName: string, snapshot: Snapshot): string {
  const { baseline, items } = snapshot
  const visited = new Set<string>()
  const rows: string[] = []
  const render = (parent: string | null, depth: number) => {
    for (const item of items.filter(item => item.parentItemId === parent).sort((a, b) => a.sortOrder - b.sortOrder || a.componentName.localeCompare(b.componentName, 'zh-CN', { numeric: true }))) {
      if (visited.has(item.id)) continue
      visited.add(item.id)
      rows.push(`<tr class="${depth === 0 ? 'root' : ''}"><td style="padding-left:${10 + Math.min(depth, 8) * 16}px">${depth ? '└ ' : ''}${escape(item.componentName)}</td><td>${escape(item.notConfigured ? '当时未配置' : item.versionNumber ?? '结构分类节点')}</td><td>${item.versionId ? item.requirement === 'Optional' ? '可选' : '必选' : '—'}${item.historicalVersionState ? ' · 历史已发布' : ''}</td></tr>`)
      render(item.id, depth + 1)
    }
  }
  render(null, 0)
  if (visited.size !== items.length) throw new Error('基线组件层级不完整，无法导出，请联系管理员。')
  const date = baseline.releasedAt ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(baseline.releasedAt)) : '尚未发布'
  const state = ({ Released: '已发布', Draft: '草稿', Withdrawn: '已撤回' } as Record<string, string>)[baseline.state] ?? '未知状态'
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escape(projectName)} - ${escape(baseline.code)}</title><style>
@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font:12px/1.6 "Microsoft YaHei","Noto Sans CJK SC",sans-serif;color:#172332;margin:24px auto;max-width:1000px}h1{font-size:24px;margin:8px 0;overflow-wrap:anywhere}header{border-bottom:2px solid #315bb1;padding-bottom:16px}p{white-space:pre-wrap;overflow-wrap:anywhere}.meta{color:#526177}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:20px}th,td{text-align:left;padding:10px;border-bottom:1px solid #d5dce5;overflow-wrap:anywhere;vertical-align:top}th{background:#eaf0f8}.root{background:#f1f4f8;font-weight:600}thead{display:table-header-group}tr{break-inside:avoid}footer{margin-top:24px;color:#64748b;font-size:11px}.actions{display:flex;gap:12px;align-items:center;margin-bottom:20px}button{padding:8px 16px;background:#285bea;color:white;border:0;border-radius:4px;cursor:pointer}@media print{body{margin:0;max-width:none}.actions{display:none}th,.root{print-color-adjust:exact}}
</style></head><body><div class="actions"><button id="save-pdf">保存为 PDF / 打印</button><span>在打印窗口中选择“另存为 PDF”。</span></div><header><div>${escape(projectName)}</div><h1>${escape(baseline.code)}</h1><div class="meta">${state} · 修订 ${baseline.revisionNo}${baseline.isHistorical ? ' · 历史补录' : ''}<br>发布时间：${date}（北京时间）</div>${baseline.description ? `<p>${escape(baseline.description)}</p>` : ''}</header><table><colgroup><col style="width:44%"><col style="width:34%"><col style="width:22%"></colgroup><thead><tr><th>组件层级</th><th>基线版本</th><th>配置属性</th></tr></thead><tbody>${rows.join('')}</tbody></table><footer>ConfigHub · 冻结基线快照；不代表机台当前实际配置。${baseline.state === 'Draft' ? '此记录为草稿，尚未发布。' : ''}</footer></body></html>`
}

export function exportBaselinePdf(projectName: string, snapshot: Snapshot) {
  const html = baselinePrintHtml(projectName, snapshot)
  const popup = window.open('', '_blank')
  if (!popup) throw new Error('浏览器阻止了导出窗口，请允许此网站打开弹窗后重试。')
  popup.opener = null
  popup.document.open()
  popup.document.write(html)
  popup.document.close()
  popup.document.getElementById('save-pdf')!.addEventListener('click', () => popup.print())
}
