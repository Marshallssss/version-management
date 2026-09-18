import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Modal } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { deleteComponentVersion, getVersionOperationImpact, type ComponentVersion } from './catalog-api'
import { OperationImpactPreview, type OpenImpactReference } from './OperationImpactPreview'

export function DeleteVersionButton({ version, componentName, onDeleted, onOpenReference }: { version: ComponentVersion; componentName: string; onDeleted: () => Promise<void>; onOpenReference: OpenImpactReference }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const impact = useQuery({ queryKey: ['version-operation-impact', version.id], queryFn: () => getVersionOperationImpact(version.id), enabled: open, staleTime: 0 })
  const canConfirm = !!reason.trim() && impact.data?.canDelete === true && !impact.isFetching && !impact.isError
  const deletion = useMutation({
    mutationFn: () => deleteComponentVersion(version.id, reason.trim()),
    onSuccess: async () => { setOpen(false); setReason(''); await onDeleted() },
  })
  return <>
    <button type="button" className="version-delete-button" title={`删除版本 ${version.versionNumber}`} aria-label={`删除版本 ${version.versionNumber}`} onClick={() => { deletion.reset(); setReason(''); setOpen(true) }}><DeleteOutlined /></button>
    <Modal centered width={560} className="version-delete-dialog" title="确认删除登记版本" open={open} onCancel={() => { if (!deletion.isPending) setOpen(false) }} onOk={() => { if (canConfirm) deletion.mutate() }} okText="确认删除版本" cancelText="取消" confirmLoading={deletion.isPending} okButtonProps={{ danger: true, disabled: !canConfirm }} cancelButtonProps={{ disabled: deletion.isPending }} closable={!deletion.isPending} maskClosable={!deletion.isPending}>
      <p><strong>{componentName} · {version.versionNumber}</strong></p>
      <p>此操作不可撤销，将删除该版本及其补丁、状态与推荐记录，不会删除组件或其他版本。Excel 导入历史与组合快照保留，原版本会标记为已删除；已被基线、机台、验证或风险记录引用的版本仍不能删除。</p>
      <OperationImpactPreview groups={impact.data?.groups} loading={impact.isFetching} error={impact.error} onRetry={() => void impact.refetch()} onOpenReference={reference => { if (!deletion.isPending) { setOpen(false); onOpenReference(reference) } }} />
      {impact.data && !impact.isFetching && !impact.isError && <p className={impact.data.canDelete ? 'operation-effect' : 'error-strip'}>{impact.data.canDelete ? `将清理 ${impact.data.cleanupCounts.patches} 条补丁、${impact.data.cleanupCounts.lifecycleTransitions} 条状态变更、${impact.data.cleanupCounts.recommendations} 条推荐记录。` : '存在受保护引用，不能删除。可将版本标记为已废弃，保留追溯。'}</p>}
      <form className="version-delete-form" onSubmit={event => { event.preventDefault(); if (canConfirm && !deletion.isPending) deletion.mutate() }}>
        <label>删除原因<input autoFocus value={reason} maxLength={500} required disabled={deletion.isPending} onChange={event => setReason(event.target.value)} /></label>
      </form>
      {deletion.isError && <p className="error-strip" role="alert">{deletion.error.message}</p>}
    </Modal>
  </>
}
