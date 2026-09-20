import { useRef, useState } from 'react'
import { Modal } from 'antd'
import { DownloadOutlined, UploadOutlined, CheckOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImportSteps } from './ImportSteps'
import { workbookBase64 } from './matrix-import-api'
import { createIdempotencyKey } from './idempotency-key'
import { commitMachineImport, downloadMachineTemplate, getMachineImport, getMachineImports, previewMachineImport } from './machine-import-api'
import './machine-import.css'

const statusText: Record<string, string> = { Staged: '资料待修正', Validated: '待确认', Committed: '已导入', Failed: '部分失败' }
export function MachineImportDialog({ projectId, onClose, onOpenMachine }: { projectId: string; onClose: () => void; onOpenMachine: (id: string) => void }) {
  const client = useQueryClient()
  const [downloaded, setDownloaded] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [reason, setReason] = useState('')
  const [batchId, setBatchId] = useState('')
  const key = useRef(createIdempotencyKey())
  const input = useRef<HTMLInputElement>(null)
  const history = useQuery({ queryKey: ['machine-imports', projectId], queryFn: () => getMachineImports(projectId) })
  const batch = useQuery({ queryKey: ['machine-import', projectId, batchId], queryFn: () => getMachineImport(projectId, batchId), enabled: !!batchId })
  const refresh = async () => {
    for (const name of ['machine-import', 'machine-imports', 'machines', 'machine-registry', 'machine-configuration', 'machine-equipment', 'machine-facts', 'machine-drift', 'workspace-overview']) await client.invalidateQueries({ queryKey: [name] })
  }
  const download = useMutation({ mutationFn: () => downloadMachineTemplate(projectId), onSuccess: () => setDownloaded(true) })
  const preview = useMutation({ mutationFn: async () => {
    if (!file) throw new Error('请选择填写后的机台 Excel。')
    return previewMachineImport(projectId, { fileName: file.name, contentBase64: await workbookBase64(file), reason }, key.current)
  }, onSuccess: async result => { setBatchId(result.id); await refresh() } })
  const commit = useMutation({ mutationFn: () => commitMachineImport(projectId, batchId), onSuccess: refresh })
  const busy = preview.isPending || commit.isPending
  const rows = batch.data?.rows ?? []
  const invalid = rows.filter(row => row.validationError).length
  const warnings = rows.filter(row => row.data.warning).length
  const completed = rows.filter(row => row.data.completed).length
  return <Modal title="机台 Excel 导入" open width={1120} footer={null} onCancel={() => !busy && onClose()} maskClosable={!busy} keyboard={!busy} className="machine-import-dialog">
    <ImportSteps machine current={batchId || file ? 2 : downloaded ? 1 : 0} />
    <p className="import-guidance">先下载当前项目模板，每行填写一台机台。PM1～PM6 填入阶段表示已安装，空白表示未安装。当前实际基线只匹配本项目已发布名称，识别失败仍可导入资料，软件版本留空；不会自动设置机台目标，也不会覆盖已有序列号。</p>
    <form className="machine-import-upload" onSubmit={event => { event.preventDefault(); preview.mutate() }}>
      <div className="toolbar-actions"><button type="button" disabled={busy || download.isPending} onClick={() => download.mutate()}><DownloadOutlined aria-hidden />下载机台模板</button><input ref={input} type="file" accept=".xlsx" aria-label="填写后的机台 Excel" disabled={busy} onChange={event => {
        const next = event.target.files?.[0]; if (!next) return
        setFileError(''); setBatchId(''); preview.reset(); commit.reset(); key.current = createIdempotencyKey()
        if (!next.name.toLowerCase().endsWith('.xlsx') || next.size > 10 * 1024 * 1024) { setFile(null); setFileError('请选择不超过 10 MB 的 .xlsx 机台模板。'); return }
        setFile(next)
      }} /><button type="button" disabled={busy} onClick={() => input.current?.click()}><UploadOutlined aria-hidden />选择已填写文件</button><span className="machine-import-filename" title={file?.name}>{file?.name ?? '尚未选择文件'}</span></div>
      <label>本次导入原因<input aria-label="机台导入原因" value={reason} maxLength={500} required disabled={busy} onChange={event => { setReason(event.target.value); key.current = createIdempotencyKey(); setBatchId('') }} /></label>
      <button type="submit" className="primary-action" disabled={busy || !file || !reason.trim()}>{preview.isPending ? '正在检查' : '检查文件并预览'}</button>
    </form>
    {(fileError || download.isError || preview.isError || commit.isError || batch.isError) && <p className="error-strip" role="alert">{fileError || download.error?.message || preview.error?.message || commit.error?.message || batch.error?.message}</p>}
    {batch.isFetching && <p role="status">正在读取导入结果。</p>}
    {batch.data && <section className="machine-import-results" aria-label="机台导入检查结果">
      <div className="machine-import-summary"><strong>{statusText[batch.data.status]} · {rows.length} 台</strong><span>已导入 {completed} 台 · 资料错误 {invalid} 台 · 基线警告 {warnings} 台</span>{batch.data.status !== 'Committed' && <button type="button" className="primary-action" disabled={busy || invalid > 0 || !rows.length || batch.isFetching} onClick={() => commit.mutate()}><CheckOutlined aria-hidden />{commit.isPending ? '正在导入' : completed > 0 || batch.data.status === 'Failed' ? '重试未完成项' : '确认导入机台'}</button>}</div>
      {invalid > 0 && <p className="error-strip">请修正资料错误后重新上传；仅有基线警告的行可以继续导入。</p>}
      {batch.data.status === 'Committed' && <p role="status" className="success-strip">导入已完成，基线警告已保留在本次记录中。</p>}
      <div className="machine-import-table" tabIndex={0} role="region" aria-label="机台逐行检查"><table><thead><tr><th>Excel 行 / 机台</th><th>资料</th><th>阶段 / PM</th><th>软件版本</th><th>检查结果</th></tr></thead><tbody>{rows.map(row => <tr key={row.rowNumber}><td><small>第 {row.rowNumber} 行 · {row.data.values[0]}</small>{row.data.machineId ? <button type="button" className="machine-import-link" onClick={() => { onOpenMachine(row.data.machineId!); onClose() }}>{row.data.values[1]}</button> : <strong>{row.data.values[1] || '未填名称'}</strong>}</td><td><span>{row.data.values[3] || '未填位置'} · {row.data.values[4] || '未填负责人'}</span><small>{row.data.values[5] || '未填工艺'}</small><details><summary>完整资料</summary>{row.data.values.slice(0, 10).map((value, i) => <div key={i}>{['序列号', '名称', '机型', '位置', '负责人', '工艺', '配置', '状态', '预计恢复时间', '整机阶段'][i]}：{value || '未填写'}</div>)}</details></td><td>{row.data.values[9] || 'Lab'}<small>{row.data.values.slice(10, 16).map((stage, i) => stage ? `PM${i + 1} ${stage}` : '').filter(Boolean).join(' · ') || '无已安装腔室'}</small></td><td className={row.data.warning ? 'machine-import-warning' : ''}>{row.data.baselineId ? row.data.values[16] : '版本留空'}{row.data.warning && <small>{row.data.warning}</small>}{row.data.baselineId && <small>初始快照 · {row.data.values[17]}</small>}</td><td className={row.validationError || row.data.error ? 'machine-import-warning' : ''}>{row.validationError || row.data.error || (row.data.completed ? '已导入' : row.data.warning ? '可导入，版本留空' : '检查通过')}</td></tr>)}</tbody></table></div>
    </section>}
    <details className="machine-import-history"><summary>近期导入记录</summary>{history.isError && <p className="error-strip">{history.error.message}</p>}{history.data?.length ? history.data.map(item => <button type="button" key={item.id} disabled={busy} onClick={() => { commit.reset(); setBatchId(item.id) }}><span>{item.sourceFileName}</span><small>{new Date(item.createdAt).toLocaleString('zh-CN')} · {statusText[item.status]}</small></button>) : <p>暂无记录。</p>}</details>
  </Modal>
}
