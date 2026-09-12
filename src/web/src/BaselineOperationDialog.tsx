import { useQuery } from '@tanstack/react-query'
import { Modal } from 'antd'
import { getBaselineOperationImpact } from './catalog-api'
import { OperationImpactPreview, type OpenImpactReference } from './OperationImpactPreview'

export function BaselineOperationDialog({ action, baseline, changes, timeChange, reason, pending, error, onCancel, onConfirm, onOpenReference }: {
  action: 'withdraw' | 'maintenance' | null
  baseline: { id: string; code: string }
  changes: Array<{ componentName: string; before: string; after: string }>
  timeChange: { before: string; after: string } | null
  reason: string; pending: boolean; error?: Error | null
  onCancel: () => void; onConfirm: () => void; onOpenReference: OpenImpactReference
}) {
  const impact = useQuery({ queryKey: ['baseline-operation-impact', baseline.id], queryFn: () => getBaselineOperationImpact(baseline.id), enabled: action !== null, staleTime: 0 })
  const allowed = !!reason.trim() && !impact.isFetching && !impact.isError && (action === 'withdraw' ? impact.data?.canWithdraw : impact.data?.maintenanceEnabled)
  return <Modal open={action !== null} title={action === 'withdraw' ? '确认撤回已发布基线' : '确认修正历史基线'} width={680} centered className="baseline-operation-dialog" onCancel={() => { if (!pending) onCancel() }} onOk={() => { if (allowed) onConfirm() }} okText={action === 'withdraw' ? '确认撤回基线' : '确认维护基线'} cancelText="取消" confirmLoading={pending} okButtonProps={{ danger: true, disabled: !allowed }} cancelButtonProps={{ disabled: pending }} maskClosable={!pending} closable={!pending}>
    <p><strong>{baseline.code}</strong></p>
    <p className="operation-effect">{action === 'withdraw' ? '撤回后标记为已撤回，保留冻结快照和发布记录，不删除组件版本。' : '将直接修正这份历史快照。引用它的项目标准、机台目标及历史展示可能随之改变；机台实际事实不会被改写。'}</p>
    <OperationImpactPreview groups={impact.data?.groups} loading={impact.isFetching} error={impact.error} onRetry={() => void impact.refetch()} onOpenReference={reference => { if (!pending) { onCancel(); onOpenReference(reference) } }} />
    {action === 'withdraw' && impact.data && !impact.isFetching && <>{impact.data.blockedReasons.map(reason => <p key={reason} className="error-strip">{reason}</p>)}{impact.data.withdrawUntil && <p className="impact-footnote">撤回期限：{new Date(impact.data.withdrawUntil).toLocaleString('zh-CN')}</p>}</>}
    {action === 'maintenance' && <>
      {impact.data && !impact.data.maintenanceEnabled && <p className="error-strip">调测维护已关闭。</p>}
      {timeChange && <p className="operation-time-change">录入时间：{timeChange.before} → {timeChange.after}</p>}
      {changes.length > 0 ? <div className="operation-changes"><table><thead><tr><th>组件</th><th>原版本</th><th>修正为</th></tr></thead><tbody>{changes.map((change, index) => <tr key={index}><th>{change.componentName}</th><td>{change.before}</td><td>{change.after}</td></tr>)}</tbody></table></div> : <p className="impact-footnote">组件版本保持不变。</p>}
    </>}
    <p className="operation-reason">原因：{reason}</p>
    {error && <p className="error-strip" role="alert">{error.message}</p>}
  </Modal>
}
