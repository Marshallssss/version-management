import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Modal } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { deleteComponentVersion, type ComponentVersion } from './catalog-api'

export function DeleteVersionButton({ version, componentName, onDeleted }: { version: ComponentVersion; componentName: string; onDeleted: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const deletion = useMutation({
    mutationFn: () => deleteComponentVersion(version.id, reason.trim()),
    onSuccess: async () => { setOpen(false); setReason(''); await onDeleted() },
  })
  return <>
    <button type="button" className="version-delete-button" title={`删除版本 ${version.versionNumber}`} aria-label={`删除版本 ${version.versionNumber}`} onClick={() => { deletion.reset(); setReason(''); setOpen(true) }}><DeleteOutlined /></button>
    <Modal centered width={480} className="version-delete-dialog" title="确认删除登记版本" open={open} onCancel={() => { if (!deletion.isPending) setOpen(false) }} onOk={() => deletion.mutate()} okText="确认删除版本" cancelText="取消" confirmLoading={deletion.isPending} okButtonProps={{ danger: true, disabled: !reason.trim() }} cancelButtonProps={{ disabled: deletion.isPending }} closable={!deletion.isPending} maskClosable={!deletion.isPending}>
      <p><strong>{componentName} · {version.versionNumber}</strong></p>
      <p>此操作不可撤销，将删除该版本及其补丁、状态与推荐记录，不会删除组件或其他版本。已被历史记录引用的版本不能删除。</p>
      <form className="version-delete-form" onSubmit={event => { event.preventDefault(); if (reason.trim() && !deletion.isPending) deletion.mutate() }}>
        <label>删除原因<input autoFocus value={reason} maxLength={500} required disabled={deletion.isPending} onChange={event => setReason(event.target.value)} /></label>
      </form>
      {deletion.isError && <p className="error-strip" role="alert">{deletion.error.message}</p>}
    </Modal>
  </>
}
