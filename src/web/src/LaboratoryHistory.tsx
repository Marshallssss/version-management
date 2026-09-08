import { useState, useEffect } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Modal } from 'antd'
import { getVersionDetail, type ProjectDetail } from './catalog-api'

const maturity: Record<string, string> = { Draft: '草稿', Testing: '开始测试', Released: '发布', Maintenance: '维护', Deprecated: '废弃' }

export function LaboratoryHistory({ open, onClose, detail }: { open: boolean; onClose: () => void; detail: ProjectDetail }) {
  const [componentId, setComponentId] = useState('')
  useEffect(() => setComponentId(''), [detail.project.id])
  const versions = detail.components.flatMap(component => component.versions.map(version => ({ component, version })))
  const queries = useQueries({ queries: versions.map(({ version }) => ({ queryKey: ['project-version-detail', version.id], queryFn: () => getVersionDetail(version.id), enabled: open, staleTime: 30_000 })) })
  const events = queries.flatMap((query, index) => {
    const transitions = query.data?.transitions ?? []
    if (!transitions.some(item => item.axis === 'Maturity' && (item.fromState === 'Testing' || item.toState === 'Testing'))) return []
    return transitions.filter(item => item.axis === 'Maturity' && ['Testing', 'Released', 'Deprecated'].includes(item.toState)).map(item => ({ ...item, ...versions[index] }))
  }).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
  const filteredEvents = events.filter(item => !componentId || item.component.id === componentId)
  return <Modal title="实验室测试历史" open={open} onCancel={onClose} footer={null} width={860}>
    <label className="history-filter">组件<select aria-label="筛选测试历史组件" value={componentId} onChange={event => setComponentId(event.target.value)}><option value="">全部组件</option>{detail.components.filter(component => component.versions.length > 0).map(component => <option key={component.id} value={component.id}>{component.name}</option>)}</select><small>{filteredEvents.length} 条记录</small></label>
    {queries.some(query => query.isLoading) && <p>正在读取测试记录。</p>}
    {queries.some(query => query.isError) && <p className="error-strip">部分测试记录读取失败，请关闭后重试。</p>}
    <div className="laboratory-history-list">{filteredEvents.map(item => <article key={`${item.version.id}-${item.occurredAt}-${item.toState}`}>
      <time>{new Date(item.occurredAt).toLocaleString('zh-CN', { hour12: false })}</time>
      <div><strong>{item.component.name} <span>{item.version.versionNumber}</span></strong><p>{item.reason}</p><small>{item.actor}</small></div>
      <span className="history-event-state">{maturity[item.toState]}</span>
    </article>)}</div>
    {!queries.some(query => query.isLoading || query.isError) && filteredEvents.length === 0 && <p>暂无实验室测试历史。</p>}
  </Modal>
}
