import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { commitImport, getImportPreview, stageImport } from './catalog-api'
import { parseImportRows } from './import-parser'

export function ImportWorkspace({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [rows, setRows] = useState('')
  const [reason, setReason] = useState('')
  const [batchId, setBatchId] = useState('')
  const queryClient = useQueryClient()
  const preview = useQuery({ queryKey: ['import-preview', batchId], queryFn: () => getImportPreview(batchId), enabled: !!batchId })
  const stage = useMutation({
    mutationFn: () => stageImport({ projectId, sourceFileName: '手工预览.csv', reason, rows: parseImportRows(rows) }),
    onSuccess: ({ id }) => setBatchId(id),
  })
  const commit = useMutation({
    mutationFn: () => commitImport(batchId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['import-preview', batchId] })
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })
  const busy = stage.isPending || commit.isPending
  const invalidatePreview = () => { setBatchId(''); stage.reset(); commit.reset() }

  return <section className="status-panel catalog-panel import-workspace">
    <div className="panel-heading"><div><span className="section-index">{projectName}</span><h3>导入预览</h3></div></div>
    <form className="catalog-form" onSubmit={event => { event.preventDefault(); setBatchId(''); commit.reset(); stage.mutate() }}>
      <label className="wide-field">表格内容（组件名称、版本号）<textarea value={rows} onChange={event => { invalidatePreview(); setRows(event.target.value) }} disabled={busy} required /></label>
      <label className="wide-field">导入原因<input value={reason} onChange={event => { invalidatePreview(); setReason(event.target.value) }} disabled={busy} required /></label>
      <div className="form-actions wide-field"><button className="primary-action" type="submit" disabled={busy}>{stage.isPending ? '正在校验' : '生成预览'}</button></div>
    </form>
    {batchId && preview.isLoading && <p role="status">正在读取导入预览。</p>}
    {preview.data && <div className="component-list">{preview.data.rows.map(row => <article className="component-row" key={row.rowNumber}><div><strong>第 {row.rowNumber} 行</strong><span>{row.payload.componentName} · {row.payload.versionNumber}</span></div><small>{row.validationError ?? (preview.data.status === 'Committed' ? '已导入' : '校验通过，尚未提交')}</small></article>)}</div>}
    {preview.data?.status === 'Validated' && !preview.data.rows.some(row => row.validationError) && !commit.isSuccess && <button type="button" className="primary-action" disabled={busy} onClick={() => commit.mutate()}>{commit.isPending ? '正在提交' : '提交导入'}</button>}
    {commit.data && <p className="success-strip" role="status">已向 {projectName} 导入 {commit.data.committed} 个版本。</p>}
    {(stage.isError || preview.isError || commit.isError) && <p className="error-strip" role="alert">{stage.error?.message ?? preview.error?.message ?? commit.error?.message}</p>}
  </section>
}
