import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { compareMachineCurrentToHistory, getMachineConfigurationAt, type ConfigurationComponent, type MachineSummary } from './catalog-api'
import { PatchBadge } from './VersionRecordTools'
import { MachineVersionComparison } from './MachineVersionComparison'

function formatTime(value: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '未知'
}

export function HistoricalConfigurationPanel({ machine, components, onOpenPatches }: { machine: MachineSummary; components: ConfigurationComponent[]; onOpenPatches: (versionId: string) => void }) {
  const [at, setAt] = useState('')
  const historical = useQuery({ queryKey: ['machine-configuration-at', machine.id, at], queryFn: () => getMachineConfigurationAt(machine.id, new Date(at).toISOString()), enabled: at !== '' })
  const comparison = useQuery({ queryKey: ['machine-current-history-compare', machine.id, at], queryFn: () => compareMachineCurrentToHistory(machine.id, new Date(at).toISOString()), enabled: at !== '' })
  const versions = new Map(components.flatMap(component => component.versions.map(version => [version.id, version] as const)))
  const compared = comparison.data && { ...comparison.data, items: comparison.data.items.map(item => ({ ...item, expectedVersionId: item.historicalVersionId, expectedVersionNumber: item.historicalVersionNumber, actualVersionId: item.currentVersionId, actualVersionNumber: item.currentVersionNumber })) }

  return <section className="historical-configuration">
    <div className="subsection-heading"><h3>时间点实际配置</h3><label className="history-time-filter">查看时间<input type="datetime-local" value={at} onChange={event => setAt(event.target.value)} /></label></div>
    {!at ? <p className="empty-state">尚未选择查询时间。</p> : <>
      {historical.isLoading ? <p role="status">正在重建历史配置。</p> : historical.isError ? <p className="error-strip" role="alert">历史配置读取失败，请刷新重试。</p> : historical.data && <>
        <p className="form-hint">按事实生效时间重建：{formatTime(historical.data.asOf)}。补丁为当前记录，不代表当时已安装。</p>
        {historical.data.items.length ? <table className="history-configuration-table"><thead><tr><th scope="col">组件</th><th scope="col">历史版本</th><th scope="col">事实时间</th></tr></thead><tbody>{historical.data.items.map(item => <tr key={item.componentId}><th scope="row">{item.componentName}</th><td><span className="comparison-version-number">{item.state === 'Present' ? item.versionNumber ?? '存在但未标明版本' : '已确认缺失'}</span>{item.state === 'Present' && item.versionId && <PatchBadge context="history" versionLabel={item.versionNumber ?? undefined} version={versions.get(item.versionId)} onOpen={() => onOpenPatches(item.versionId!)} />}</td><td className="historical-fact-times"><span>生效 {formatTime(item.stateEffectiveAt)}</span><span>记录 {formatTime(item.recordedAt)}</span><span>已知安装 {formatTime(item.knownInstalledAt)}</span></td></tr>)}</tbody></table> : <p className="empty-state">此时间点尚无已记录的配置事实。</p>}
      </>}
      <div className="history-comparison"><h4>与当前实际对比</h4><MachineVersionComparison key={machine.id} data={compared} loading={comparison.isLoading} error={comparison.error} components={components} beforeLabel="历史版本" beforeContext="history" onOpenPatches={onOpenPatches} /></div>
    </>}
  </section>
}
