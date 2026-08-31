import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { assignBulkMachineTargets, getBaselines, getMachines, type ProjectSummary } from './catalog-api'

export function BulkTargetPanel({ projects }: { projects: ProjectSummary[] }) {
  const [projectId, setProjectId] = useState('')
  const [baselineId, setBaselineId] = useState('')
  const [machineIds, setMachineIds] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const queryClient = useQueryClient()
  const machines = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const baselines = useQuery({ queryKey: ['bulk-target-baselines', projectId], queryFn: () => getBaselines(projectId), enabled: projectId !== '' })
  const selectedMachines = machines.data?.filter(machine => machine.projectId === projectId) ?? []
  const assign = useMutation({ mutationFn: () => assignBulkMachineTargets(projectId, baselineId, machineIds, reason), onSuccess: async () => { setReason(''); await queryClient.invalidateQueries({ queryKey: ['machines'] }); await queryClient.invalidateQueries({ queryKey: ['machine-target'] }); await queryClient.invalidateQueries({ queryKey: ['machine-target-history'] }) } })
  const toggle = (machineId: string) => setMachineIds(current => current.includes(machineId) ? current.filter(id => id !== machineId) : [...current, machineId])

  return <section className="status-panel catalog-panel">
    <div className="panel-heading"><div><span className="section-index">V1.1 批量目标</span><h3>显式批量指派机台目标</h3></div></div>
    <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); assign.mutate() }}>
      <label>所属项目<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setBaselineId(''); setMachineIds([]) }} required><option value="">请选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label>
      <label>已发布基线<select value={baselineId} onChange={(event) => setBaselineId(event.target.value)} disabled={!projectId} required><option value="">请选择基线</option>{baselines.data?.filter(baseline => baseline.state === 'Released').map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.code} · Revision {baseline.revisionNo}</option>)}</select></label>
      <label className="wide-field">指派原因<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} required /></label>
      <div className="component-list wide-field">{projectId && (selectedMachines.length ? selectedMachines.map(machine => <label className="component-row" key={machine.id}><span><strong>{machine.serialNumber}</strong><small>{machine.name}</small></span><input type="checkbox" checked={machineIds.includes(machine.id)} onChange={() => toggle(machine.id)} /></label>) : <p className="empty-state">该项目没有可选机台。</p>)}</div>
      <button className="primary-action" type="submit" disabled={assign.isPending || !baselineId || machineIds.length === 0}>{assign.isPending ? '正在指派' : `指派 ${machineIds.length} 台机台`}</button>
    </form>
    {assign.data && <p className="empty-state">已指派 {assign.data.succeeded} 台；已是该目标而跳过 {assign.data.skipped} 台。</p>}
    {assign.isError && <p className="error-strip">{assign.error.message}</p>}
  </section>
}
