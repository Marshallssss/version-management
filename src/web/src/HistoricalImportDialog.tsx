import { useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Modal } from 'antd'
import { commitHistoricalWorkbook, previewHistoricalWorkbook, workbookBase64, type HistoricalPreviewItem } from './matrix-import-api'

const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })
const maturity: Record<string, string> = { Draft: '草稿', Testing: '测试中', Released: '已发布', Maintenance: '维护中', Deprecated: '已废弃' }

export function HistoricalImportDialog({ projectId, templateId, file, reason, onClose, onImported, onOpenBaseline }: {
  projectId: string; templateId: string; file: File; reason: string; onClose: () => void; onImported: () => Promise<void>; onOpenBaseline?: (id: string) => void
}) {
  const [index, setIndex] = useState(0)
  const [confirmed, setConfirmed] = useState(false)
  const preview = useMutation({ mutationFn: async () => previewHistoricalWorkbook(projectId, { templateId, fileName: file.name, contentBase64: await workbookBase64(file), reason }), onSuccess: () => { setIndex(0); setConfirmed(false) } })
  const commit = useMutation({ mutationFn: () => commitHistoricalWorkbook(projectId, preview.data!.id, reason), onSuccess: onImported })
  const records = commit.data?.records ?? preview.data?.records ?? []
  const record = records[index]
  const pending = preview.isPending || commit.isPending
  const renderNode = (item: HistoricalPreviewItem, depth: number): ReactNode => <div key={item.componentId} className={depth ? 'snapshot-child-branch' : 'snapshot-root-column'}>
    <article className={depth ? 'snapshot-tree-item' : 'snapshot-tree-item snapshot-root'}><div><strong>{item.name}</strong><small>{item.isCategory ? '结构分类节点' : item.notConfigured ? '当时未配置' : item.versionNumber}</small>{!item.isCategory && !item.notConfigured && <small className={item.currentSafety === 'Blocked' ? 'error-strip' : 'form-hint'}>{item.willCreate ? '补录为已发布 · 创建时间取历史发布时间' : `历史已发布 · 当前${maturity[item.currentMaturity] ?? '状态未知'}`}{item.currentSafety === 'Blocked' && ' · 已阻断，风险保留'}</small>}</div></article>
    {record?.items.filter(child => child.parentComponentId === item.componentId).sort((a, b) => a.sortOrder - b.sortOrder).map(child => renderNode(child, depth + 1))}
  </div>
  return <Modal open width={1040} title="历史基线导入" footer={null} onCancel={() => !pending && onClose()} className="workspace-modal historical-import-dialog">
    <p className="form-hint">{file.name} · 本次只补录历史基线，不变更现有测试版本、项目标准或机台配置。</p>
    {!commit.data && <button type="button" disabled={pending} onClick={() => { commit.reset(); preview.mutate() }}>{preview.isPending ? '正在校验完整配置' : preview.data ? '重新校验预览' : '校验并预览历史基线'}</button>}
    {(preview.isError || commit.isError) && <p className="error-strip" role="alert">{commit.error?.message ?? preview.error?.message}</p>}
    {record && <>
      <label className="history-record-picker">选择历史基线<select value={index} onChange={event => setIndex(Number(event.target.value))}>{records.map((row, i) => <option value={i} key={row.rowKey}>{row.name} · {time(row.releasedAt)}{row.imported ? ' · 已录入' : ''}</option>)}</select></label>
      <div className="snapshot-heading"><div><h3>{record.name}</h3><p>发布时间：{time(record.releasedAt)}</p><p>{record.reason}</p></div><span className="standard-mark">历史补录</span></div>
      {record.imported && record.baselineId ? <p className="success-strip">历史已录入。{onOpenBaseline && <button type="button" onClick={() => { onClose(); onOpenBaseline(record.baselineId!) }}>查看基线快照</button>}</p> : <div className="snapshot-tree">{record.items.filter(item => !item.parentComponentId).sort((a, b) => a.sortOrder - b.sortOrder).map(item => renderNode(item, 0))}</div>}
      {!!preview.data?.testingRecordCount && <p className="form-hint">另有 {preview.data.testingRecordCount} 条测试记录；历史确认后可用“扫描并录入”登记测试内容。</p>}
      {!commit.data && records.some(row => !row.imported) && <form className="historical-import-confirm" onSubmit={event => { event.preventDefault(); commit.mutate() }}><label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required />确认这些配置曾评审发布；已有版本当前状态及风险不变，缺失版本按历史时间补录。</label><button className="primary-action" type="submit" disabled={!confirmed || pending}>{commit.isPending ? '正在补录' : `确认导入 ${records.filter(row => !row.imported).length} 条历史基线`}</button></form>}
    </>}
  </Modal>
}
