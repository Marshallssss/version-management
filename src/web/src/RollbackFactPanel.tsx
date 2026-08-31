import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getMachineConfiguration, getMachineFacts, recordMachineFacts } from './catalog-api'

type ComponentOption = { id: string; code: string; name: string; versions: Array<{ id: string; versionNumber: string; sequenceNo: number }> }

export function RollbackFactPanel({ machineId, components }: { machineId: string; components: ComponentOption[] }) {
  const [componentId, setComponentId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [correctsDeploymentBatchId, setCorrectsDeploymentBatchId] = useState('')
  const [reason, setReason] = useState('')
  const queryClient = useQueryClient()
  const configuration = useQuery({ queryKey: ['machine-configuration', machineId], queryFn: () => getMachineConfiguration(machineId) })
  const facts = useQuery({ queryKey: ['machine-facts', machineId], queryFn: () => getMachineFacts(machineId) })
  const selectedComponent = useMemo(() => components.find(component => component.id === componentId), [components, componentId])
  const current = configuration.data?.find(item => item.componentId === componentId)
  const rollback = useMutation({
    mutationFn: () => recordMachineFacts(machineId, { operationType: correctsDeploymentBatchId ? 'Correction' : 'Rollback', coverage: 'Partial', sourceType: 'manual-ui', reason, correctsDeploymentBatchId: correctsDeploymentBatchId || undefined, items: [{ componentId, versionId, absent: false, knownInstalledAt: null }] }),
    onSuccess: async () => { setReason(''); await queryClient.invalidateQueries({ queryKey: ['machine-configuration', machineId] }); await queryClient.invalidateQueries({ queryKey: ['machine-facts', machineId] }); await queryClient.invalidateQueries({ queryKey: ['machine-drift', machineId] }) },
  })

  return <section className="status-panel catalog-panel">
    <div className="panel-heading"><div><span className="section-index">V1.1 事实回退与更正</span><h3>记录组件回退或更正</h3></div></div>
    <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); rollback.mutate() }}>
      <label>组件<select value={componentId} onChange={(event) => { setComponentId(event.target.value); setVersionId('') }} required><option value="">请选择组件</option>{components.map(component => <option key={component.id} value={component.id}>{component.code} · {component.name}</option>)}</select></label>
      <label>恢复版本<select value={versionId} onChange={(event) => setVersionId(event.target.value)} disabled={!selectedComponent} required><option value="">请选择已知版本</option>{selectedComponent?.versions.filter(version => version.id !== current?.versionId).map(version => <option key={version.id} value={version.id}>{version.versionNumber} · 序列 {version.sequenceNo}</option>)}</select></label>
      <label>更正原事实<select value={correctsDeploymentBatchId} onChange={(event) => setCorrectsDeploymentBatchId(event.target.value)}><option value="">不关联：记录回退</option>{facts.data?.filter(fact => fact.operationType !== 'Correction').map(fact => <option key={fact.id} value={fact.id}>{fact.operationType === 'Observation' ? '观察' : fact.operationType === 'Install' ? '安装' : fact.operationType === 'Upgrade' ? '升级' : fact.operationType === 'InitialSnapshot' ? '初始快照' : fact.operationType === 'Rollback' ? '回退' : fact.operationType} · {new Date(fact.effectiveAt).toLocaleString('zh-CN')}</option>)}</select></label>
      <label className="wide-field">回退原因<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} required /></label>
      <button className="primary-action" type="submit" disabled={rollback.isPending || !componentId || !versionId}>{rollback.isPending ? '正在记录' : correctsDeploymentBatchId ? '记录更正事实' : '记录回退事实'}</button>
    </form>
    <p className="empty-state">回退与更正都会追加局部事实记录；选择原事实后会继承其生效时间，不会改写既有部署或观察历史。</p>
    {rollback.isError && <p className="error-strip">{rollback.error.message}</p>}
  </section>
}
