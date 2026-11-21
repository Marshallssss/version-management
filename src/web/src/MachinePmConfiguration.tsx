import { useQuery } from '@tanstack/react-query'
import { getMachineEquipment, type ConfigurationComponent } from './catalog-api'
import { RevisionIdentity } from './RevisionIdentity'

export function MachinePmConfiguration({ machineId, components }: { machineId: string; components: ConfigurationComponent[] }) {
  const equipment = useQuery({ queryKey: ['machine-equipment', machineId], queryFn: () => getMachineEquipment(machineId) })
  const chambers = equipment.data?.chambers.filter(c => c.installed) ?? []
  if (!chambers.length) return null
  const names = new Map(components.map(c => [c.id, c.name]))
  return <details className="pm-current-summary" open={chambers.some(c => c.overrides.length || c.unconfirmedComponentIds?.length)}>
    <summary>PM 实际配置 · {chambers.length} 个腔室</summary>
    <p className="form-hint">特例独立于整机版本；沿用整机时，以整机已记录的状态为准，未观察到的组件仍为未知。</p>
    <div className="pm-observation-grid">{chambers.map(c => <section key={c.number} className="pm-observation-card"><strong>PM{c.number} · {c.stage}</strong>
      {c.overrides.map(i => <div key={i.componentId}><strong>{i.componentName}</strong><span> · {i.versionNumber}</span><RevisionIdentity versionId={i.versionId} revisionId={i.revisionId} /></div>)}
      {c.unconfirmedComponentIds?.map(id => <p key={id}>{names.get(id) ?? '组件'} · 暂未确认</p>)}
      <small className="form-hint">{c.overrides.length || c.unconfirmedComponentIds?.length ? '其余组件沿用整机' : '沿用整机配置'}</small>
    </section>)}</div>
  </details>
}
