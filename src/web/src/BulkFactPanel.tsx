import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getMachines, getProject, recordBulkMachineFacts, type ProjectSummary } from './catalog-api'

export function BulkFactPanel({ projects }: { projects: ProjectSummary[] }) {
  const [projectId, setProjectId] = useState('')
  const [machineIds, setMachineIds] = useState<string[]>([])
  const [componentId, setComponentId] = useState('')
  const [versionId, setVersionId] = useState('')
  const [operationType, setOperationType] = useState('Observation')
  const [reason, setReason] = useState('')
  const queryClient = useQueryClient()
  const machines = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const project = useQuery({ queryKey: ['bulk-fact-project', projectId], queryFn: () => getProject(projectId), enabled: projectId !== '' })
  const components = project.data?.components ?? []
  const selectedComponent = components.find(component => component.id === componentId)
  const selectedMachines = machines.data?.filter(machine => machine.projectId === projectId) ?? []
  const record = useMutation({
    mutationFn: () => recordBulkMachineFacts(projectId, { machineIds, operationType, coverage: 'Partial', reason, items: [{ componentId, versionId, absent: false, knownInstalledAt: null }] }),
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
  const toggle = (machineId: string) => setMachineIds(current => current.includes(machineId) ? current.filter(id => id !== machineId) : [...current, machineId])

  return <section className="status-panel catalog-panel">
    <div className="panel-heading"><div><span className="section-index">V1.1 批量事实</span><h3>批量记录局部部署或观察</h3></div></div>
    <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); record.mutate() }}>
      <label>所属项目<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setMachineIds([]); setComponentId(''); setVersionId('') }} required><option value="">请选择项目</option>{projects.map(projectItem => <option key={projectItem.id} value={projectItem.id}>{projectItem.code} · {projectItem.name}</option>)}</select></label>
      <label>事实类型<select value={operationType} onChange={(event) => setOperationType(event.target.value)}><option value="Observation">观察</option><option value="Install">安装</option><option value="Upgrade">升级</option><option value="InitialSnapshot">初始快照</option></select></label>
      <label>组件<select value={componentId} onChange={(event) => { setComponentId(event.target.value); setVersionId('') }} disabled={!projectId} required><option value="">请选择组件</option>{components.map(component => <option key={component.id} value={component.id}>{component.code} · {component.name}</option>)}</select></label>
      <label>版本<select value={versionId} onChange={(event) => setVersionId(event.target.value)} disabled={!componentId} required><option value="">请选择版本</option>{selectedComponent?.versions.map(version => <option key={version.id} value={version.id}>{version.versionNumber}</option>)}</select></label>
      <label className="wide-field">记录原因<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} required /></label>
      <div className="component-list wide-field">{projectId && (selectedMachines.length ? selectedMachines.map(machine => <label className="component-row" key={machine.id}><span><strong>{machine.serialNumber}</strong><small>{machine.name}</small></span><input type="checkbox" checked={machineIds.includes(machine.id)} onChange={() => toggle(machine.id)} /></label>) : <p className="empty-state">该项目没有可选机台。</p>)}</div>
      <button className="primary-action" type="submit" disabled={record.isPending || !versionId || machineIds.length === 0}>{record.isPending ? '正在记录' : `记录 ${machineIds.length} 台机台`}</button>
    </form>
    <p className="empty-state">批量入口固定为局部事实，只更新所选组件，不会清除未列出的组件。完整扫描、回退与更正仍需使用单机记录，以保留各机台的完整语义。</p>
    {record.data && <p className="empty-state">已记录 {record.data.succeeded} 台；失败 {record.data.failed} 台。</p>}
    {record.isError && <p className="error-strip">{record.error.message}</p>}
  </section>
}
