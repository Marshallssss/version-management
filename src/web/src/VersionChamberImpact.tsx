import { Button } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ChamberVersionUsage, VersionChamberImpactData } from './catalog-api'

type Props = {
  data?: VersionChamberImpactData
  isLoading?: boolean
  error?: Error | null
  onRetry?: () => void
  onOpenMachine: (machineId: string) => void
}

function formatTime(value: string) {
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? '时间未知' : time.toLocaleString('zh-CN', { hour12: false })
}

export function VersionChamberImpact({ data, isLoading = false, error, onRetry, onOpenMachine }: Props) {
  const machineName = (usage: ChamberVersionUsage) => usage.machineDeleted
    ? <strong>{usage.machineName}</strong>
    : <Button type="link" size="small" onClick={() => onOpenMachine(usage.machineId)} aria-label={`查看机台 ${usage.machineName}`}>{usage.machineName}</Button>

  const usageRows = (usages: ChamberVersionUsage[]) => <div className="component-list">
    {usages.map(usage => <article className="component-row" key={`${usage.machineId}-${usage.chamberNumber}-${usage.componentId}`}>
      <div>{machineName(usage)}<span>序列号：{usage.serialNumber}</span></div>
      <div><strong>PM{usage.chamberNumber} · {usage.componentName}</strong>
        <span>{usage.machineDeleted ? '机台已删除' : '机台在用'} · {usage.chamberInstalled ? '腔室已安装' : '腔室已移除'}</span>
      </div>
    </article>)}
  </div>

  return <section className="version-chamber-impact" aria-label="PM 特例影响">
    <div className="subsection-heading"><div><h4>PM 特例影响</h4></div></div>
    {isLoading && <p role="status">正在读取 PM 引用。</p>}
    {error && <div className="error-strip" role="alert"><p>PM 影响读取失败，请重试。</p>
      {onRetry && <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>重试</Button>}
    </div>}
    {!isLoading && !error && !data && <p className="empty-state">当前服务端尚未提供 PM 影响数据，请确认已完成升级。</p>}
    {!isLoading && !error && data && <>
      <h4>当前 PM 使用 · {data.currentUsages.length} 项</h4>
      {data.currentUsages.length > 0 ? usageRows(data.currentUsages) : <p className="empty-state">此版本当前没有独立的 PM 特例引用。</p>}
      <details>
        <summary>历史 PM 引用 · {data.historicalUsages.length} 项</summary>
        {data.historicalUsages.length > 0 ? usageRows(data.historicalUsages) : <p className="empty-state">此版本尚无 PM 特例历史。</p>}
      </details>
      <details>
        <summary>最近 PM 记录 · {data.recentFacts.length} / {data.historicalFactCount} 条</summary>
        {data.recentFacts.length > 0 ? <div className="component-list">
          {data.recentFacts.map(fact => <article className="component-row" key={fact.id}>
            <div>{machineName(fact.usage)}<span>PM{fact.usage.chamberNumber} · {fact.usage.componentName}</span>
              <span>{fact.isCurrent ? '当前特例' : '历史引用'}{fact.usage.machineDeleted ? ' · 机台已删除' : ''}{!fact.usage.chamberInstalled ? ' · 腔室已移除' : ''}</span>
            </div>
            <div><span>{fact.reason}</span><small>{fact.actor} · <time dateTime={fact.recordedAt}>{formatTime(fact.recordedAt)}</time></small></div>
          </article>)}
        </div> : <p className="empty-state">此版本尚无 PM 特例记录。</p>}
      </details>
    </>}
  </section>
}
