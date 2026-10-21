import { useState } from 'react'
import { getBaselineDetail, type ConfigurationComponent } from './catalog-api'
import { useQuery } from '@tanstack/react-query'
import { ComparisonTreeTable, hierarchyChanged, snapshotNodes } from './ComparisonTreeTable'
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

export function MachineVersionComparison({ data, loading, error, components, baselineId, beforeLabel = '预期版本', beforeContext = 'snapshot', onOpenPatches }: {
  data?: ComparisonData; loading: boolean; error?: Error | null
  components: ConfigurationComponent[]
  baselineId?: string
  beforeLabel?: string; beforeContext?: 'snapshot' | 'history'
  onOpenPatches: (versionId: string) => void
}) {
  const [onlyDifferences, setOnlyDifferences] = useState(true)
  const versions = new Map(components.flatMap(component => component.versions.map(version => [version.id, version] as const)))
  const snapshot = useQuery({ queryKey: ['baseline-detail', baselineId], queryFn: () => getBaselineDetail(baselineId!), enabled: !!baselineId })
  const currentTree = components.map(component => ({ id: component.id, parentId: component.parentComponentId, name: component.name, sortOrder: component.sortOrder }))
  const beforeTree = snapshot.data ? snapshotNodes(snapshot.data.items) : currentTree
  const rows = data?.items ?? []
  const value = (id: string | null, label: string | null, context: 'snapshot' | 'history' | 'machine') => <>
    <span className="comparison-version-number">{label ?? '无版本记录'}</span>
    {id && <PatchBadge version={versions.get(id)} versionLabel={label ?? undefined} context={context} onOpen={() => onOpenPatches(id)} />}
  </>
  return <section className="machine-version-comparison">
    {loading || baselineId && snapshot.isPending ? <p role="status">正在读取对比结果。</p> : error || baselineId && snapshot.isError ? <p className="error-strip" role="alert">对比读取失败，请刷新重试。</p> : data && <>
      <p className="comparison-structure-summary">{baselineId ? '按基线冻结层级分组；当前目录归属不同时单独标明。' : '按当前组件目录分组，不代表当时的组件层级。'}</p>
      <div className="comparison-summary"><div><span>版本匹配：{matchNames[data.matchStatus] ?? '信息不足'}</span><span className={data.riskSeverity === 'Critical' ? 'compare-critical' : ''}>风险：{riskNames[data.riskSeverity] ?? '未知'}</span></div><label><input type="checkbox" checked={onlyDifferences} onChange={event => setOnlyDifferences(event.target.checked)} />只看差异</label></div>
      <ComparisonTreeTable key={`${baselineId ?? 'history'}:${onlyDifferences}`} rows={rows} primary={beforeTree} secondary={currentTree} leftNodes={beforeTree} rightNodes={currentTree} leftLabel="基线" rightLabel="当前目录" onlyDifferences={onlyDifferences} isDifferent={item => item.status !== 'Matched'} rowClass={item => item.status === 'Matched' ? '' : 'changed'} className="machine-version-table" emptyText={data.items.length === 0 ? '暂无可对比的版本记录。' : '没有配置差异。'}
        header={<tr><th scope="col">组件</th><th scope="col">{beforeLabel}</th><th scope="col">当前实际</th><th scope="col">结果</th></tr>}
        renderCells={item => <><td>{value(item.expectedVersionId, item.expectedVersionNumber, beforeContext)}</td><td>{value(item.actualVersionId, item.actualVersionNumber, 'machine')}</td><td>{statusNames[item.status] ?? '信息不足'}{hierarchyChanged(beforeTree, currentTree, item.componentId) && <small className="compare-source">层级或名称不同</small>}</td></>} />
    </>}
  </section>
}
