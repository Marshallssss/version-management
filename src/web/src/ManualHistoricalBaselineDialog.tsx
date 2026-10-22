import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AutoComplete, Button, Modal, Steps } from 'antd'
import { ArrowLeftOutlined, CheckOutlined, EyeOutlined } from '@ant-design/icons'
import type { ProjectDetail } from './catalog-api'
import { ComparisonTreeTable } from './ComparisonTreeTable'
import { commitManualHistoricalBaseline, previewManualHistoricalBaseline } from './manual-historical-baseline-api'
import './manual-historical-baseline.css'

const maturity: Record<string, string> = { Draft: '草稿', Testing: '测试中', Released: '已发布', Maintenance: '维护中', Deprecated: '已废弃' }
const time = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export function ManualHistoricalBaselineDialog({ detail, onClose, onImported }: { detail: ProjectDetail; onClose: () => void; onImported: (baselineId: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [releasedAt, setReleasedAt] = useState('')
  const [reason, setReason] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [absent, setAbsent] = useState<Set<string>>(new Set())
  const [confirmed, setConfirmed] = useState(false)
  const rows = detail.components.map(component => ({ ...component, componentId: component.id, componentName: component.name, isCategory: !component.versions.length && detail.components.some(child => child.parentComponentId === component.id) }))
  const required = rows.filter(row => !row.isCategory)
  const filled = required.filter(row => absent.has(row.id) || values[row.id]?.trim()).length
  const tree = rows.map(row => ({ id: row.id, parentId: row.parentComponentId, name: row.name, sortOrder: row.sortOrder }))
  const preview = useMutation({ mutationFn: () => previewManualHistoricalBaseline(detail.project.id, {
    baselineName: name.trim(), releasedAt: releasedAt.replace('T', ' '), reason: reason.trim(),
    items: rows.map(row => ({ componentId: row.id, versionNumber: row.isCategory || absent.has(row.id) ? null : (values[row.id] ?? '').trim(), notConfigured: !row.isCategory && absent.has(row.id) })),
  }), onSuccess: () => setConfirmed(false) })
  const commit = useMutation({ mutationFn: () => commitManualHistoricalBaseline(detail.project.id, preview.data!.id, reason.trim()), onSuccess: async result => {
    const id = result.records[0]?.baselineId
    if (id) await onImported(id)
  } })
  const pending = preview.isPending || commit.isPending
  const record = preview.data?.records[0]
  const previewTree = record?.items.map(item => ({ id: item.componentId, parentId: item.parentComponentId, name: item.name, sortOrder: item.sortOrder })) ?? []
  const previous = () => { preview.reset(); commit.reset(); setConfirmed(false) }
  return <Modal open width={1080} title="补录历史基线" footer={null} onCancel={() => !pending && onClose()} maskClosable={!pending} closable={!pending} className="workspace-modal manual-history-dialog">
    <div className="manual-history-context"><strong>{detail.project.name}</strong><span>历史补录 · 不改变项目标准或机台配置</span></div>
    <Steps size="small" current={record ? 1 : 0} items={[{ title: '填写历史配置' }, { title: '预览并确认' }]} />
    {!record ? <form onSubmit={event => { event.preventDefault(); preview.mutate() }}>
      <fieldset disabled={pending} className="manual-history-fields">
        <label>历史基线名称<input value={name} onChange={event => setName(event.target.value)} maxLength={100} required /></label>
        <label>整体发布时间（北京时间）<input type="datetime-local" value={releasedAt} onChange={event => setReleasedAt(event.target.value)} min="2000-01-01T08:00" max={new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16)} required /></label>
        <label className="manual-history-reason">补录原因<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={2} required /></label>
      </fieldset>
      <div className="manual-history-heading"><h3>历史组件版本</h3><span>已填写 {filled} / {required.length}</span></div>
      <ComparisonTreeTable rows={rows} primary={tree} secondary={tree} leftNodes={tree} rightNodes={tree} onlyDifferences={false} isDifferent={() => false} rowClass={() => ''} columnCount={3} className="manual-history-table" emptyText="项目尚无组件，请先建立组件结构。"
        header={<tr><th scope="col">组件</th><th scope="col">历史版本</th><th scope="col">录入处理</th></tr>}
        renderCells={row => {
          if (row.isCategory) return <td colSpan={2}><span className="manual-history-note">结构分类节点</span></td>
          const existing = row.versions.find(version => version.versionNumber.toUpperCase() === (values[row.id] ?? '').trim().toUpperCase())
          return <><td><AutoComplete aria-label={`${row.name} 历史版本`} value={values[row.id] ?? ''} disabled={pending || absent.has(row.id)} onChange={value => setValues(current => ({ ...current, [row.id]: value }))} options={row.versions.map(version => ({ value: version.versionNumber, label: `${version.versionNumber} · ${maturity[version.maturity] ?? version.maturity}${version.safety === 'Blocked' ? ' · 已阻断' : ''}` }))} filterOption={(input, option) => (option?.value ?? '').toUpperCase().includes(input.toUpperCase())} placeholder="选择已有版本或输入旧版本号" maxLength={160} /><label className="manual-history-absent"><input type="checkbox" aria-label={`${row.name} 当时未配置`} checked={absent.has(row.id)} disabled={pending} onChange={event => setAbsent(current => { const next = new Set(current); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next })} />当时未配置</label></td>
            <td>{absent.has(row.id) ? '快照标记未配置' : existing ? <><span>沿用已登记版本</span><small className={existing.safety === 'Blocked' ? 'manual-history-warning' : 'manual-history-note'}>当前{maturity[existing.maturity] ?? existing.maturity}{existing.safety === 'Blocked' ? ' · 已阻断' : ''}，状态不变</small></> : values[row.id]?.trim() ? <><span>补录为已发布</span><small className="manual-history-note">创建时间取整体发布时间</small></> : <span className="manual-history-note">待填写</span>}</td></>
        }} />
      <p className="form-hint">整体发布时间用于这套基线及新增历史版本；已有版本的时间和当前状态保持不变。</p>
      <div className="manual-history-actions"><Button disabled={pending} onClick={onClose}>取消</Button><Button htmlType="submit" type="primary" icon={<EyeOutlined />} disabled={pending || !required.length || filled !== required.length}>{preview.isPending ? '正在校验' : '校验并预览'}</Button></div>
    </form> : <>
      <div className="manual-history-preview-heading"><h3>{record.name}</h3><span>发布时间：{time(record.releasedAt)}（北京时间）</span><p>{record.reason}</p></div>
      <div className="manual-history-heading"><strong>完整历史快照</strong><span>补录 {record.items.filter(item => item.willCreate).length} · 沿用 {record.items.filter(item => item.versionId).length} · 未配置 {record.items.filter(item => item.notConfigured).length}</span></div>
      <ComparisonTreeTable rows={record.items.map(item => ({ ...item, componentName: item.name }))} primary={previewTree} secondary={previewTree} leftNodes={previewTree} rightNodes={previewTree} onlyDifferences={false} isDifferent={() => false} rowClass={() => ''} columnCount={3} className="manual-history-table" emptyText="没有可补录的组件。"
        header={<tr><th scope="col">组件</th><th scope="col">历史版本</th><th scope="col">确认后的记录</th></tr>}
        renderCells={item => <><td>{item.isCategory ? '结构分类节点' : item.notConfigured ? '当时未配置' : item.versionNumber}</td><td>{item.isCategory || item.notConfigured ? '仅保存快照' : item.willCreate ? <><span>新增已发布版本</span><small className="manual-history-note">创建于 {time(record.releasedAt)}</small></> : <><span>历史已发布</span><small className={item.currentSafety === 'Blocked' ? 'manual-history-warning' : 'manual-history-note'}>当前{maturity[item.currentMaturity] ?? '状态未知'}{item.currentSafety === 'Blocked' ? ' · 已阻断' : ''}，保持不变</small></>}</td></>} />
      <form onSubmit={event => { event.preventDefault(); commit.mutate() }}>
        <label className="manual-history-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={pending} required />确认这套配置曾评审发布，实际补录及审计时间记为现在。</label>
        <div className="manual-history-actions"><Button onClick={previous} disabled={pending} icon={<ArrowLeftOutlined />}>返回修改</Button><Button htmlType="submit" type="primary" disabled={!confirmed || pending} icon={<CheckOutlined />}>{commit.isPending ? '正在补录' : '确认补录历史基线'}</Button></div>
      </form>
    </>}
    {(preview.isError || commit.isError) && <p className="error-strip" role="alert">{commit.error?.message ?? preview.error?.message}</p>}
  </Modal>
}
