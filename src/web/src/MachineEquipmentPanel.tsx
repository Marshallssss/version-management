import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from 'antd'
import { PatchBadge } from './VersionRecordTools'
import { DeleteOutlined, EditOutlined, HistoryOutlined, PlusOutlined, CloseOutlined } from '@ant-design/icons'
import { changeChamberOverrides, changeMachineEquipment, deleteMachine, getMachineEquipment, type ChamberInput, type ProjectDetail } from './catalog-api'

export const stages = ['Lab', 'MoveIn', 'T0', 'T1', 'T2', 'T3', 'STR', 'HVM']
export function ChamberFields({ value, onChange }: { value: ChamberInput[]; onChange: (value: ChamberInput[]) => void }) {
  return <fieldset className="chamber-fields"><legend>已安装腔室</legend><div className="chamber-options">{[1, 2, 3, 4, 5, 6].map(number => {
    const item = value.find(x => x.number === number)
    return <div key={number}><label><input type="checkbox" checked={!!item} onChange={event => onChange(event.target.checked ? [...value, { number, stage: 'Lab' }].sort((a, b) => a.number - b.number) : value.filter(x => x.number !== number))} />PM{number}</label>{item && <select aria-label={`PM${number} 阶段`} value={item.stage} onChange={event => onChange(value.map(x => x.number === number ? { ...x, stage: event.target.value } : x))}>{stages.map(stage => <option key={stage}>{stage}</option>)}</select>}</div>
  })}</div></fieldset>
}

const eventNames: Record<string, string> = { MachineStageOwnerChanged: '整机阶段 / 负责人变更', ChamberInstalled: '腔室加入', ChamberRemoved: '腔室移除', ChamberStageChanged: '腔室阶段变更', ChamberOverridesChanged: '特例配置变更', MachineDeleted: '机台删除' }
const matches: Record<string, string> = { Matched: '匹配', Mismatch: '版本不同', Extra: '目标之外', Unknown: '未指派目标' }

export function MachineEquipmentPanel({ machineId, name, canWrite, isAdmin, project, onOpenPatches, onDeleted, onSuccess }: { machineId: string; name: string; canWrite: boolean; isAdmin: boolean; project?: ProjectDetail; onOpenPatches: (versionId: string) => void; onDeleted: () => void; onSuccess: (message: string) => void }) {
  const client = useQueryClient()
  const equipment = useQuery({ queryKey: ['machine-equipment', machineId], queryFn: () => getMachineEquipment(machineId) })
  const [dialog, setDialog] = useState<'edit' | 'history' | 'delete' | 'override' | null>(null)
  const [owner, setOwner] = useState('')
  const [stage, setStage] = useState('')
  const [chambers, setChambers] = useState<ChamberInput[]>([])
  const [number, setNumber] = useState(1)
  const [items, setItems] = useState<Array<{ componentId: string; versionId: string }>>([])
  const [componentId, setComponentId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [reason, setReason] = useState('')
  const [historyFilter, setHistoryFilter] = useState('all')
  const changed = async () => {
    await client.invalidateQueries({ queryKey: ['machines'] })
    await client.invalidateQueries({ queryKey: ['machine-equipment', machineId] })
    await client.invalidateQueries({ queryKey: ['configuration-comparison'] })
    setDialog(null); onSuccess('机台配置已保存，历史已记录。')
  }
  const save = useMutation({ mutationFn: () => dialog === 'delete' ? deleteMachine(machineId, reason) : dialog === 'override' ? changeChamberOverrides(machineId, number, items, reason) : changeMachineEquipment(machineId, { owner, stage, chambers, reason }), onSuccess: async () => { const deleted = dialog === 'delete'; await changed(); if (deleted) onDeleted() } })
  const open = (type: typeof dialog) => { save.reset(); setReason(''); setDialog(type) }
  const components = project?.components ?? []
  const component = components.find(x => x.id === componentId)
  const describe = (details: Record<string, unknown>) => {
    const before = details.before
    const after = details.after
    if (typeof before === 'string') return `${before} → ${String(after)}`
    if (after && typeof after === 'object') {
      const a = after as { owner?: string; stage?: string }; const b = (before ?? {}) as { owner?: string; stage?: string }
      return `阶段 ${b.stage || '未登记'} → ${a.stage || '未登记'}；负责人 ${b.owner || '未填写'} → ${a.owner || '未填写'}`
    }
    if (Array.isArray(details.items)) return details.items.length ? details.items.map((item: { componentId: string; versionId: string }) => { const c = components.find(x => x.id === item.componentId); return `${c?.name ?? '历史组件'} ${c?.versions.find(x => x.id === item.versionId)?.versionNumber ?? '历史版本'}` }).join('；') : '全部恢复沿用整机'
    return details.stage ? `阶段 ${String(details.stage)}` : ''
  }
  return <section className="machine-equipment">
    <div className="equipment-heading"><div><strong>阶段与腔室</strong><span>{equipment.data?.stage || '未登记阶段'} · 负责人 {equipment.data?.owner || '未填写'}</span></div><div className="equipment-actions">
      {canWrite && <button type="button" title="编辑阶段与腔室" aria-label="编辑阶段与腔室" onClick={() => { setOwner(equipment.data?.owner ?? ''); setStage(equipment.data?.stage ?? ''); setChambers(equipment.data?.chambers.filter(x => x.installed).map(x => ({ number: x.number, stage: x.stage })) ?? []); open('edit') }} disabled={!equipment.data}><EditOutlined /> 编辑</button>}
      <button type="button" aria-label="设备历史" onClick={() => open('history')}><HistoryOutlined /> 历史</button>
      {isAdmin && <button type="button" className="equipment-delete" title="删除机台" aria-label="删除机台" onClick={() => open('delete')}><DeleteOutlined /></button>}
    </div></div>
    {equipment.isError && <p className="error-strip">{equipment.error.message}</p>}
    <div className="chamber-summary">{equipment.data?.chambers.filter(x => x.installed).map(chamber => <article key={chamber.number}>
      <header><strong>PM{chamber.number}</strong><span>{chamber.stage}</span>{canWrite && <button type="button" onClick={() => { setNumber(chamber.number); setItems(chamber.overrides.map(x => ({ componentId: x.componentId, versionId: x.versionId }))); setComponentId(''); setVersionId(''); open('override') }}>特例{chamber.overrides.length ? ` (${chamber.overrides.length})` : ''}</button>}</header>
      {chamber.overrides.length ? <div className="chamber-overrides">{chamber.overrides.map(item => <div key={item.componentId}><strong>{item.componentName}</strong><span>{item.versionNumber}<PatchBadge context="machine" version={components.find(component => component.id === item.componentId)?.versions.find(version => version.id === item.versionId)} onOpen={() => onOpenPatches(item.versionId)} /></span><small>目标 {item.expectedVersionNumber ?? '无'} · {matches[item.match]}{item.risk === 'Critical' ? ' · 严重风险：已阻止' : ''}</small></div>)}</div> : <p>沿用整机配置</p>}
    </article>)}</div>
    {equipment.data && !equipment.data.chambers.some(x => x.installed) && <p className="empty-state">尚未登记腔室。</p>}
    <Modal className="equipment-dialog" title={dialog === 'edit' ? '阶段、腔室与负责人' : dialog === 'history' ? `${name} · 设备历史` : dialog === 'delete' ? '确认删除机台' : `PM${number} · 特例配置`} open={dialog !== null} onCancel={() => { if (!save.isPending) setDialog(null) }} footer={null} width={720} destroyOnHidden>
      {dialog === 'history' ? <><label>记录范围<select value={historyFilter} onChange={event => setHistoryFilter(event.target.value)}><option value="all">全部</option><option value="machine">整机</option>{[1, 2, 3, 4, 5, 6].map(n => <option value={n} key={n}>PM{n}</option>)}</select></label><div className="equipment-history">{equipment.data?.history.filter(x => historyFilter === 'all' || (historyFilter === 'machine' ? x.chamberNumber === null : x.chamberNumber === Number(historyFilter))).map(item => <article key={item.id}><strong>{item.chamberNumber ? `PM${item.chamberNumber} · ` : ''}{eventNames[item.kind] || '设备变更'}</strong><span>{describe(item.details)}</span><small>{new Date(item.recordedAt).toLocaleString('zh-CN')} · {item.actor}</small><p>{item.reason}</p></article>)}</div></> : <form onSubmit={event => { event.preventDefault(); save.mutate() }}>
        {dialog === 'edit' && <><div className="equipment-form-grid"><label>机台负责人<input value={owner} onChange={event => setOwner(event.target.value)} maxLength={160} /></label><label>整机阶段<select value={stage} onChange={event => setStage(event.target.value)} required><option value="">请选择阶段</option>{stages.map(value => <option key={value}>{value}</option>)}</select></label></div><ChamberFields value={chambers} onChange={setChambers} /></>}
        {dialog === 'delete' && <p>删除 <strong>{name}</strong> 后，不再显示在日常机台列表中。已记录的配置、阶段和审计历史将保留。</p>}
        {dialog === 'override' && <><div className="equipment-override-list">{items.map(item => { const c = components.find(x => x.id === item.componentId); return <div key={item.componentId}><strong>{c?.name}</strong><span>{c?.versions.find(x => x.id === item.versionId)?.versionNumber}</span><button type="button" title="恢复沿用整机" aria-label={`移除 ${c?.name} 特例`} onClick={() => setItems(items.filter(x => x.componentId !== item.componentId))}><CloseOutlined /></button></div> })}</div><div className="equipment-form-grid"><label>特例组件<select value={componentId} onChange={event => { setComponentId(event.target.value); setVersionId('') }}><option value="">请选择组件</option>{components.filter(c => c.versions.length && !items.some(x => x.componentId === c.id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>特例版本<select value={versionId} disabled={!component} onChange={event => setVersionId(event.target.value)}><option value="">请选择版本</option>{component?.versions.map(v => <option key={v.id} value={v.id}>{v.versionNumber}{v.maturity === 'Testing' ? ' · 测试中' : ''}{v.safety === 'Blocked' ? ' · 已阻止' : ''}</option>)}</select></label></div><button type="button" disabled={!componentId || !versionId} onClick={() => { setItems([...items, { componentId, versionId }]); setComponentId(''); setVersionId('') }}><PlusOutlined /> 加入特例</button></>}
        <label className="equipment-reason">{dialog === 'delete' ? '删除原因' : '变更原因'}<input value={reason} onChange={event => setReason(event.target.value)} required maxLength={500} /></label>
        {save.isError && <p className="error-strip">{save.error.message}</p>}
        <div className="equipment-footer"><button type="button" onClick={() => setDialog(null)} disabled={save.isPending}>取消</button><button className="primary-action" type="submit" disabled={save.isPending || !reason.trim() || dialog === 'override' && !!componentId}>{save.isPending ? '正在保存' : dialog === 'delete' ? '确认删除机台' : '保存配置'}</button></div>
      </form>}
    </Modal>
  </section>
}
