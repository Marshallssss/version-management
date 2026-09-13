import { useState } from 'react'
import type { ConfigurationComponent } from './catalog-api'
import { PatchBadge } from './VersionRecordTools'

type ComparisonData = {
  matchStatus: string
  riskSeverity: string
  items: Array<{
    componentId: string; componentName: string; status: string
    expectedVersionId: string | null; expectedVersionNumber: string | null
    actualVersionId: string | null; actualVersionNumber: string | null
  }>
}

const matchNames: Record<string, string> = { Matched: '匹配', Mismatch: '不匹配', Unknown: '信息不足' }
const riskNames: Record<string, string> = { None: '无', High: '高', Critical: '严重', Unknown: '未知' }
const statusNames: Record<string, string> = { Matched: '相同', Mismatch: '版本不同', Missing: '未达到预期', Extra: '预期之外', CurrentOnly: '仅当前有版本', HistoricalOnly: '仅历史有版本' }

export function MachineVersionComparison({ data, loading, error, components, beforeLabel = '预期版本', beforeContext = 'snapshot', onOpenPatches }: {
  data?: ComparisonData; loading: boolean; error?: Error | null
  components: ConfigurationComponent[]
  beforeLabel?: string; beforeContext?: 'snapshot' | 'history'
  onOpenPatches: (versionId: string) => void
}) {
  const [onlyDifferences, setOnlyDifferences] = useState(true)
  const versions = new Map(components.flatMap(component => component.versions.map(version => [version.id, version] as const)))
  const rows = data?.items.filter(item => !onlyDifferences || item.status !== 'Matched') ?? []
  const value = (id: string | null, label: string | null, context: 'snapshot' | 'history' | 'machine') => <>
    <span className="comparison-version-number">{label ?? '无版本记录'}</span>
    {id && <PatchBadge version={versions.get(id)} versionLabel={label ?? undefined} context={context} onOpen={() => onOpenPatches(id)} />}
  </>
  return <section className="machine-version-comparison">
    {loading ? <p role="status">正在读取对比结果。</p> : error ? <p className="error-strip" role="alert">对比读取失败，请刷新重试。</p> : data && <>
      <div className="comparison-summary"><div><span>版本匹配：{matchNames[data.matchStatus] ?? '信息不足'}</span><span className={data.riskSeverity === 'Critical' ? 'compare-critical' : ''}>风险：{riskNames[data.riskSeverity] ?? '未知'}</span></div><label><input type="checkbox" checked={onlyDifferences} onChange={event => setOnlyDifferences(event.target.checked)} />只看差异</label></div>
      {rows.length > 0 ? <table className="machine-version-table"><thead><tr><th scope="col">组件</th><th scope="col">{beforeLabel}</th><th scope="col">当前实际</th><th scope="col">结果</th></tr></thead><tbody>{rows.map(item => <tr key={item.componentId} className={item.status === 'Matched' ? '' : 'changed'}><th scope="row">{item.componentName}</th><td>{value(item.expectedVersionId, item.expectedVersionNumber, beforeContext)}</td><td>{value(item.actualVersionId, item.actualVersionNumber, 'machine')}</td><td>{statusNames[item.status] ?? '信息不足'}</td></tr>)}</tbody></table> : <p className="empty-state">{data.items.length === 0 ? '暂无可对比的版本记录。' : '没有版本差异。'}</p>}
    </>}
  </section>
}
