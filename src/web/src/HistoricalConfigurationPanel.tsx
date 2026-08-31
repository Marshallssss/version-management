import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { compareMachineCurrentToHistory, getMachineConfigurationAt, type MachineSummary } from './catalog-api'

function formatTime(value: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '—'
}

export function HistoricalConfigurationPanel({ machine }: { machine: MachineSummary }) {
  const [at, setAt] = useState('')
  const historical = useQuery({ queryKey: ['machine-configuration-at', machine.id, at], queryFn: () => getMachineConfigurationAt(machine.id, new Date(at).toISOString()), enabled: at !== '' })
  const comparison = useQuery({ queryKey: ['machine-current-history-compare', machine.id, at], queryFn: () => compareMachineCurrentToHistory(machine.id, new Date(at).toISOString()), enabled: at !== '' })

  return <section className="status-panel catalog-panel">
    <div className="panel-heading"><div><span className="section-index">历史实际</span><h3>{machine.serialNumber} 的时间点配置</h3></div></div>
    <label>查看时间<input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} /></label>
    {historical.data && <><p className="empty-state">按事实生效时间重建，查询时间：{formatTime(historical.data.asOf)}</p><div className="component-list">{historical.data.items.map(item => <article className="component-row" key={item.componentId}><div><strong>{item.componentCode} · {item.componentName}</strong><span>{item.state === 'Present' ? item.versionNumber ?? '存在但未标明版本' : '缺失'}</span></div><small>生效 {formatTime(item.stateEffectiveAt)}<br />记录 {formatTime(item.recordedAt)}<br />已知安装 {formatTime(item.knownInstalledAt)}</small></article>)}</div></>}
    {comparison.data && <><dl className="runtime-list"><div><dt>当前与历史</dt><dd>{comparison.data.matchStatus === 'Matched' ? '匹配' : '不匹配'}</dd></div><div><dt>风险等级</dt><dd>{comparison.data.riskSeverity === 'Critical' ? '严重' : '无'}</dd></div></dl><p className="empty-state">版本差异与阻断风险分别计算；两者可以同时存在。</p><div className="component-list">{comparison.data.items.filter(item => item.status !== 'Matched').map(item => <article className="component-row" key={item.componentId}><div><strong>{item.status === 'CurrentOnly' ? '仅当前存在' : item.status === 'HistoricalOnly' ? '仅历史存在' : '版本不同'}</strong><span>{item.componentCode} · {item.componentName}</span></div><small>{item.historicalVersionNumber ?? '无'} → {item.currentVersionNumber ?? '无'}</small></article>)}</div></>}
    {(historical.isError || comparison.isError) && <p className="error-strip">{historical.error?.message ?? comparison.error?.message}</p>}
  </section>
}
