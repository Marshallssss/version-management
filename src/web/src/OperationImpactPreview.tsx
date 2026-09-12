import { ReloadOutlined, RightOutlined } from '@ant-design/icons'
import type { OperationImpactGroup, OperationImpactReference } from './catalog-api'

export type OpenImpactReference = (reference: OperationImpactReference) => void

export function OperationImpactPreview({ groups, loading, error, onRetry, onOpenReference }: { groups?: OperationImpactGroup[]; loading: boolean; error?: Error | null; onRetry: () => void; onOpenReference: OpenImpactReference }) {
  return <section className="operation-impact-preview" aria-label="关联影响预览" aria-busy={loading}>
    <header><strong>关联记录</strong><button type="button" title="刷新影响预览" aria-label="刷新影响预览" disabled={loading} onClick={onRetry}><ReloadOutlined aria-hidden /></button></header>
    {loading ? <p role="status">正在检查引用。</p> : error ? <p className="error-strip" role="alert">{error.message || '影响预览读取失败，请重试。'}</p> : groups && <>
      {groups.some(group => group.total > 0) ? groups.filter(group => group.total > 0).map(group => <details key={group.kind} open={groups.filter(item => item.total > 0).length === 1}>
        <summary>{group.label}<span>{group.total} 条</span></summary>
        <ul>{group.items.map((item, index) => <li key={`${item.id}-${index}`}>
          {(!item.deleted && (item.machineId || item.baselineId)) ? <button type="button" className="impact-reference-link" onClick={() => onOpenReference(item)}><span>{item.label}</span><RightOutlined aria-hidden /></button> : <strong>{item.label}{item.deleted && <small> · 已删除</small>}</strong>}
          {item.detail && <small>{item.detail}</small>}
        </li>)}</ul>
        {group.total > group.items.length && <p className="impact-truncated">显示前 {group.items.length} 条，共 {group.total} 条。</p>}
      </details>) : <p className="impact-empty">暂无受保护引用。</p>}
      <p className="impact-footnote">预览不会修改记录，提交时会重新检查。</p>
    </>}
  </section>
}
