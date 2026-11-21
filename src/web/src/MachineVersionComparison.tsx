import { useState } from 'react'
import { RevisionIdentity, revisionResult } from './RevisionIdentity'
import { getBaselineDetail, type ChamberComparison, type ConfigurationComponent } from './catalog-api'
import { useQuery } from '@tanstack/react-query'
import { ComparisonTreeTable, hierarchyChanged, snapshotNodes } from './ComparisonTreeTable'
import { PatchBadge } from './VersionRecordTools'

type ComparisonData = {
  matchStatus: string
  riskSeverity: string
  chambers?: ChamberComparison[]
  items: Array<{
    componentId: string; componentName: string; status: string; revisionStatus?: string; expectedRevisionId?: string | null; actualRevisionId?: string | null
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
      <div className="comparison-summary"><div><span>补丁修订：{rows.filter(row => row.revisionStatus === 'Mismatch').length} 项不同 · {rows.filter(row => row.revisionStatus === 'Unknown').length} 项待确认</span><span>{baselineId ? '配置匹配' : '版本匹配'}：{matchNames[data.matchStatus] ?? '信息不足'}</span><span className={data.riskSeverity === 'Critical' ? 'compare-critical' : ''}>风险：{riskNames[data.riskSeverity] ?? '未知'}</span></div><label><input type="checkbox" checked={onlyDifferences} onChange={event => setOnlyDifferences(event.target.checked)} />只看差异</label></div>
      <ComparisonTreeTable key={`${baselineId ?? 'history'}:${onlyDifferences}`} rows={rows} primary={beforeTree} secondary={currentTree} leftNodes={beforeTree} rightNodes={currentTree} leftLabel="基线" rightLabel="当前目录" onlyDifferences={onlyDifferences} isDifferent={item => item.status !== 'Matched' || item.revisionStatus === 'Mismatch'} rowClass={item => item.status === 'Matched' ? '' : 'changed'} className="machine-version-table" emptyText={data.items.length === 0 ? '暂无可对比的版本记录。' : '没有配置差异。'}
        header={<tr><th scope="col">组件</th><th scope="col">{beforeLabel}</th><th scope="col">当前实际</th><th scope="col">结果</th></tr>}
        renderCells={item => <><td>{value(item.expectedVersionId, item.expectedVersionNumber, beforeContext)}<RevisionIdentity versionId={item.expectedVersionId} revisionId={item.expectedRevisionId} /></td><td>{value(item.actualVersionId, item.actualVersionNumber, 'machine')}<RevisionIdentity versionId={item.actualVersionId} revisionId={item.actualRevisionId} /></td><td>{statusNames[item.status] ?? '信息不足'}<small className="compare-source">{revisionResult(item.revisionStatus)}</small>{hierarchyChanged(beforeTree, currentTree, item.componentId) && <small className="compare-source">层级或名称不同</small>}</td></>} />
      {data.chambers?.map(chamber => <details key={chamber.number} className="machine-pm-target" open={chamber.matchStatus !== 'Matched' || chamber.items.some(item => item.revisionStatus === 'Mismatch')}>
        <summary>PM{chamber.number} · 版本{matchNames[chamber.matchStatus] ?? '信息不足'} · {chamber.items.filter(item => item.revisionStatus === 'Mismatch').length} 项补丁差异 · {chamber.items.filter(item => item.revisionStatus === 'Unknown').length} 项补丁待确认</summary>
        <p className={chamber.riskSeverity === 'Critical' ? 'compare-critical' : 'form-hint'}>风险：{riskNames[chamber.riskSeverity] ?? '未知'}；单独版本不会被整机升级覆盖。</p>
        <ComparisonTreeTable rows={chamber.items} primary={beforeTree} secondary={currentTree} leftNodes={beforeTree} rightNodes={currentTree} onlyDifferences={onlyDifferences} isDifferent={item => item.status !== 'Matched' || item.revisionStatus === 'Mismatch'} rowClass={item => item.status !== 'Matched' || item.revisionStatus === 'Mismatch' ? 'changed' : ''} className="machine-pm-target-table" emptyText="没有已确认的配置差异；补丁待确认项请取消只看差异查看。"
          header={<tr><th scope="col">组件</th><th scope="col">{beforeLabel}</th><th scope="col">PM{chamber.number} 实际</th><th scope="col">结果</th></tr>}
          renderCells={item => <><td>{item.rightVersionNumber ?? (item.rightState === 'Absent' ? '未配置' : '未知')}<RevisionIdentity versionId={item.rightVersionId} revisionId={item.rightRevisionId} /></td><td>{item.leftVersionNumber ?? (item.leftState === 'Unknown' ? '暂未确认' : '未配置')}<small className="compare-source">{item.leftSource === 'Override' ? 'PM 单独配置' : '沿用整机'}</small><RevisionIdentity versionId={item.leftVersionId} revisionId={item.leftRevisionId} /></td><td>{statusNames[item.status] ?? '信息不足'}<small className="compare-source">{revisionResult(item.revisionStatus)}</small></td></>} />
      </details>)}
    </>}
  </section>
}
