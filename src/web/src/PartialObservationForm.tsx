import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createIdempotencyKey } from './idempotency-key'
import { getMachineEquipment, recordMachineFacts, request, type ConfigurationComponent, type PmObservation } from './catalog-api'
import { RevisionPicker } from './RevisionPicker'
import './pm-observation.css'

type PmConfig = { rootComponentId: string | null; componentIds: string[] }
export function PartialObservationForm({ machineId, projectId, components, isAdmin, onSaved, onBusy }: { machineId: string; projectId: string; components: ConfigurationComponent[]; isAdmin: boolean; onSaved: () => Promise<void>; onBusy: (busy: boolean) => void }) {
  const cache = useQueryClient()
  const [multi, setMulti] = useState(false)
  const [includeWhole, setIncludeWhole] = useState(false)
  const [componentId, setComponentId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [revisionId, setRevisionId] = useState('')
  const [reason, setReason] = useState('')
  const [pm, setPm] = useState<PmObservation[]>([])
  const [rootId, setRootId] = useState('')
  const [mappingReason, setMappingReason] = useState('')
  const equipment = useQuery({ queryKey: ['machine-equipment', machineId], queryFn: () => getMachineEquipment(machineId) })
  const mapping = useQuery({ queryKey: ['pm-configuration', projectId], queryFn: () => request<PmConfig>(`/api/v1/projects/${projectId}/pm-configuration`) })
  useEffect(() => { setRootId(mapping.data?.rootComponentId ?? '') }, [mapping.data?.rootComponentId])
  const component = components.find(c => c.id === componentId)
  const available = components.filter(c => c.versions.length && (!multi || mapping.data?.componentIds.includes(c.id)))
  const setComponent = (id: string) => { setComponentId(id); setVersionId(''); setRevisionId(''); setPm([]) }
  const update = (number: number, changes: Partial<PmObservation>) => setPm(items => items.map(item => item.number === number ? { ...item, ...changes } : item))
  const whole = !multi || includeWhole
  const configure = useMutation({ mutationFn: () => request(`/api/v1/projects/${projectId}/pm-configuration`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify({ rootComponentId: rootId || null, reason: mappingReason }) }), onSuccess: async () => { setComponent(''); setMappingReason(''); await cache.invalidateQueries({ queryKey: ['pm-configuration', projectId] }) } })
  const save = useMutation({
    mutationFn: () => recordMachineFacts(machineId, { operationType: 'Observation', coverage: 'Partial', sourceType: 'manual-ui', reason, multiVersion: multi, pmObservations: multi ? pm : [], items: whole ? [{ componentId, versionId, revisionId: revisionId || null, absent: false, knownInstalledAt: null }] : [] }),
    onMutate: () => onBusy(true),
    onSuccess: async () => { await cache.invalidateQueries({ queryKey: ['machine-equipment', machineId] }); await cache.invalidateQueries({ queryKey: ['configuration-comparison'] }); await onSaved() },
    onSettled: () => onBusy(false),
  })
  const valid = !!componentId && (!whole || !!versionId) && (!multi || !!mapping.data?.rootComponentId && pm.length > 0 && pm.every(i => i.state !== 'Override' || !!i.versionId))
  return <>
    <p className="form-hint">观察记录发现的实际状态，不代表安装或升级；未提交的组件和 PM 保持不变。</p>
    <form className="catalog-form pm-observation-form" onSubmit={event => { event.preventDefault(); save.mutate() }}>
      <label className="wide-field pm-multiversion-toggle"><input type="checkbox" checked={multi} onChange={event => { setMulti(event.target.checked); setComponent(''); setIncludeWhole(false) }} />整机多版本 <small>不同 PM 使用不同组件版本</small></label>
      {multi && <div className="wide-field pm-association">
        <p>PM 组件范围：<strong>{components.find(c => c.id === mapping.data?.rootComponentId)?.name ?? '尚未关联'}</strong>及其子组件</p>
        {isAdmin && <details open={!mapping.data?.rootComponentId}><summary>设置 PM 根组件（本项目共用）</summary><div className="pm-association-fields"><label>PM 根组件<select aria-label="PM 根组件" value={rootId} onChange={e => setRootId(e.target.value)}><option value="">解除关联</option>{components.filter(c => !c.parentComponentId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>关联原因<input value={mappingReason} maxLength={500} onChange={e => setMappingReason(e.target.value)} /></label><button type="button" disabled={!mappingReason.trim() || configure.isPending || save.isPending} onClick={() => configure.mutate()}>保存 PM 关联</button></div></details>}
        {!isAdmin && !mapping.data?.rootComponentId && <p className="form-hint">请管理员先关联项目中的 PM 根组件。</p>}
        {(mapping.isError || configure.isError) && <p role="alert" className="error-strip">{mapping.error?.message ?? configure.error?.message}</p>}
      </div>}
      <label>组件<select aria-label="组件" value={componentId} onChange={e => setComponent(e.target.value)} required><option value="">请选择组件</option>{available.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {multi && <label className="pm-multiversion-toggle"><input type="checkbox" checked={includeWhole} onChange={e => setIncludeWhole(e.target.checked)} />同时更新整机默认版本</label>}
      {whole && <><label>版本<select aria-label="版本" value={versionId} onChange={e => { setVersionId(e.target.value); setRevisionId('') }} required disabled={!component}><option value="">请选择版本</option>{component?.versions.map(v => <option key={v.id} value={v.id}>{v.versionNumber}</option>)}</select></label><RevisionPicker versionId={versionId} value={revisionId} onChange={setRevisionId} /></>}
      {multi && <fieldset className="wide-field pm-observation-grid"><legend>选择本次观察到的 PM</legend>
        {equipment.data?.chambers.filter(c => c.installed).map(chamber => {
          const item = pm.find(i => i.number === chamber.number)
          const prior = chamber.overrides.find(i => i.componentId === componentId)
          return <section key={chamber.number} className={item ? 'pm-observation-card selected' : 'pm-observation-card'}>
            <label className="pm-multiversion-toggle"><input type="checkbox" aria-label={`观察 PM${chamber.number}`} disabled={!component} checked={!!item} onChange={e => setPm(items => e.target.checked ? [...items, { number: chamber.number, componentId, state: 'Override', versionId: null, revisionId: null }] : items.filter(i => i.number !== chamber.number))} /><strong>PM{chamber.number}</strong><small>{chamber.stage}</small></label>
            <p className="form-hint">现记录：{!component ? '先选择组件' : prior ? prior.versionNumber : chamber.unconfirmedComponentIds?.includes(componentId) ? '暂未确认' : '沿用整机（整机无记录时为未知）'}</p>
            {item && <><label>配置方式<select aria-label={`PM${chamber.number} 配置方式`} value={item.state} onChange={e => update(chamber.number, { state: e.target.value as PmObservation['state'], versionId: null, revisionId: null })}><option value="Override">单独版本</option><option value="Inherit">恢复沿用整机</option><option value="Unknown">暂未确认</option></select></label>{item.state === 'Override' && <><label>PM 版本<select aria-label={`PM${chamber.number} 版本`} value={item.versionId ?? ''} required onChange={e => update(chamber.number, { versionId: e.target.value || null, revisionId: null })}><option value="">请选择版本</option>{component?.versions.map(v => <option key={v.id} value={v.id}>{v.versionNumber}</option>)}</select></label><RevisionPicker versionId={item.versionId ?? ''} value={item.revisionId ?? ''} onChange={value => update(chamber.number, { revisionId: value || null })} /></>}{item.state === 'Inherit' && <p className="form-hint">本次保存将明确结束该组件的 PM 特例，并沿用整机。</p>}</>}
          </section>
        })}
        {equipment.isError && <p className="error-strip">腔室读取失败，请重试。</p>}
        {equipment.isSuccess && !equipment.data.chambers.some(c => c.installed) && <p>尚未登记已安装腔室，请先在“阶段与腔室”中添加。</p>}
      </fieldset>}
      <label className="wide-field">观察原因<input value={reason} onChange={e => setReason(e.target.value)} required maxLength={500} /></label>
      <button type="submit" className="primary-action" disabled={!valid || save.isPending || configure.isPending}>{save.isPending ? '正在记录' : multi ? `记录 ${pm.length} 个 PM 的局部观察` : '记录局部观察'}</button>
      {save.isError && <p role="alert" className="error-strip wide-field">{save.error.message}</p>}
    </form>
  </>
}
