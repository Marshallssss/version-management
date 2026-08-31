import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getMachineConfiguration, recordMachineFacts } from './catalog-api'

type ComponentOption = { id: string; code: string; name: string; versions: Array<{ id: string; versionNumber: string; sequenceNo: number }> }

export function RollbackFactPanel({ machineId, components }: { machineId: string; components: ComponentOption[] }) {
  const [componentId, setComponentId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [reason, setReason] = useState('')
  const queryClient = useQueryClient()
  const configuration = useQuery({ queryKey: ['machine-configuration', machineId], queryFn: () => getMachineConfiguration(machineId) })
  const selectedComponent = useMemo(() => components.find(component => component.id === componentId), [components, componentId])
  const current = configuration.data?.find(item => item.componentId === componentId)
  const rollback = useMutation({
    mutationFn: () => recordMachineFacts(machineId, { operationType: 'Rollback', coverage: 'Partial', sourceType: 'manual-ui', reason, items: [{ componentId, versionId, absent: false, knownInstalledAt: null }] }),
    onSuccess: async () => { setReason(''); await queryClient.invalidateQueries({ queryKey: ['machine-configuration', machineId] }); await queryClient.invalidateQueries({ queryKey: ['machine-facts', machineId] }); await queryClient.invalidateQueries({ queryKey: ['machine-drift', machineId] }) },
  })

  return <section className="status-panel catalog-panel">
    <div className="panel-heading"><div><span className="section-index">V1.1 事实回退</span><h3>记录组件回退</h3></div></div>
    <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); rollback.mutate() }}>
      <label>组件<select value={componentId} onChange={(event) => { setComponentId(event.target.value); setVersionId('') }} required><option value="">请选择组件</option>{components.map(component => <option key={component.id} value={component.id}>{component.code} · {component.name}</option>)}</select></label>
      <label>恢复版本<select value={versionId} onChange={(event) => setVersionId(event.target.value)} disabled={!selectedComponent} required><option value="">请选择已知版本</option>{selectedComponent?.versions.filter(version => version.id !== current?.versionId).map(version => <option key={version.id} value={version.id}>{version.versionNumber} · 序列 {version.sequenceNo}</option>)}</select></label>
      <label className="wide-field">回退原因<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} required /></label>
      <button className="primary-action" type="submit" disabled={rollback.isPending || !componentId || !versionId}>{rollback.isPending ? '正在记录' : '记录回退事实'}</button>
    </form>
    <p className="empty-state">回退会追加一条局部事实记录，不会改写既有部署或观察历史。</p>
    {rollback.isError && <p className="error-strip">{rollback.error.message}</p>}
  </section>
}
