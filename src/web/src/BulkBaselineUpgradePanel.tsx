import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getBaselines, getMachines, upgradeMachinesToBaseline, type ProjectSummary } from './catalog-api'

function nowForInput() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function BulkBaselineUpgradePanel({ projects }: { projects: ProjectSummary[] }) {
  const queryClient = useQueryClient()
  const [projectId, setProjectId] = useState('')
  const [baselineId, setBaselineId] = useState('')
  const [machineIds, setMachineIds] = useState<string[]>([])
  const [effectiveAt, setEffectiveAt] = useState(nowForInput)
  const [reason, setReason] = useState('')
  const machines = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const baselines = useQuery({ queryKey: ['bulk-upgrade-baselines', projectId], queryFn: () => getBaselines(projectId), enabled: projectId !== '' })
  const selectedMachines = machines.data?.filter(machine => machine.projectId === projectId && machine.status === 'Active') ?? []
  const upgrade = useMutation({
    mutationFn: () => upgradeMachinesToBaseline(projectId, { configurationBaselineId: baselineId, machineIds, effectiveAt: new Date(effectiveAt).toISOString(), reason }),
    onSuccess: async () => {
      setReason('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['machines'] }),
        queryClient.invalidateQueries({ queryKey: ['machine-configuration'] }),
        queryClient.invalidateQueries({ queryKey: ['machine-facts'] }),
        queryClient.invalidateQueries({ queryKey: ['machine-drift'] }),
      ])
    },
  })
  const toggleMachine = (machineId: string) => setMachineIds(current => current.includes(machineId) ? current.filter(id => id !== machineId) : [...current, machineId])

  return <section className="status-panel catalog-panel bulk-upgrade-panel">
    <div className="panel-heading"><div><span className="section-index">批量升级</span><h3>将实际配置升级到已发布基线</h3></div></div>
    <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); upgrade.mutate() }}>
      <label>所属项目<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setBaselineId(''); setMachineIds([]) }} required><option value="">请选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>已发布基线<select value={baselineId} onChange={(event) => setBaselineId(event.target.value)} disabled={!projectId} required><option value="">请选择已发布基线</option>{baselines.data?.filter(baseline => baseline.state === 'Released').map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.code} · Revision {baseline.revisionNo}</option>)}</select></label>
      <label>实际升级时间<input type="datetime-local" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required /></label>
      <label className="wide-field">升级原因<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} required /></label>
      <div className="component-list wide-field">{projectId && (selectedMachines.length ? selectedMachines.map(machine => <label className="component-row" key={machine.id}><span><strong>{machine.name}</strong><small>{machine.serialNumber}{machine.location ? ` · ${machine.location}` : ''}</small></span><input type="checkbox" checked={machineIds.includes(machine.id)} onChange={() => toggleMachine(machine.id)} /></label>) : <p className="empty-state">该项目没有在用机台。</p>)}</div>
      <button className="primary-action" type="submit" disabled={upgrade.isPending || !baselineId || machineIds.length === 0}>{upgrade.isPending ? '正在记录升级' : `升级 ${machineIds.length} 台机台`}</button>
    </form>
    <p className="form-hint">此操作完整写入所选基线的版本快照，并保留每台机台原有实际配置的历史。它不会自动修改机台目标；需要改变目标时，请使用独立的“批量目标”操作。</p>
    {upgrade.data && <p className="success-strip">已记录 {upgrade.data.succeeded} 台升级到 {upgrade.data.baselineCode}；失败 {upgrade.data.failed} 台。</p>}
    {upgrade.isError && <p className="error-strip">{upgrade.error.message}</p>}
  </section>
}
