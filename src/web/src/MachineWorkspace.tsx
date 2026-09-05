import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BulkTargetPanel } from './BulkTargetPanel'
import { BulkBaselineUpgradePanel } from './BulkBaselineUpgradePanel'
import { HistoricalConfigurationPanel } from './HistoricalConfigurationPanel'
import { RollbackFactPanel } from './RollbackFactPanel'
import { assignMachineTarget, compareMachineToBaseline, createMachine, getBaselines, getMachineConfiguration, getMachineDrift, getMachineFacts, getMachineTarget, getMachineTargetHistory, getMachines, getProject, getProjectStandard, recordMachineFacts, updateMachine, type ProjectSummary } from './catalog-api'

const matchText: Record<string, string> = { Matched: '匹配', Mismatch: '不匹配', Unknown: '未知' }
const riskText: Record<string, string> = { None: '无', Critical: '严重', Unknown: '未知' }
const operationText: Record<string, string> = { Install: '安装', Upgrade: '升级', InitialSnapshot: '初始快照', Observation: '观察', Rollback: '回退', Correction: '更正' }

function formatTime(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'
}

export function MachineWorkspace({ projects, selectedMachineId, onSelectMachine, onSuccess }: { projects: ProjectSummary[]; selectedMachineId: string; onSelectMachine: (machineId: string) => void; onSuccess: (message: string) => void }) {
  const queryClient = useQueryClient()
  const [projectFilterId, setProjectFilterId] = useState('')
  const [cloneMachineId, setCloneMachineId] = useState('')
  const [machineProjectId, setMachineProjectId] = useState('')
  const [machineSerial, setMachineSerial] = useState('')
  const [machineName, setMachineName] = useState('')
  const [machineType, setMachineType] = useState('')
  const [machineLocation, setMachineLocation] = useState('')
  const [machineReason, setMachineReason] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editSerial, setEditSerial] = useState('')
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState('')
  const [editLocation, setEditLocation] = useState('')
  const [editStatus, setEditStatus] = useState('Active')
  const [editReason, setEditReason] = useState('')
  const [factComponentId, setFactComponentId] = useState('')
  const [factVersionId, setFactVersionId] = useState('')
  const [factCoverage, setFactCoverage] = useState('Partial')
  const [factReason, setFactReason] = useState('')
  const [targetBaselineId, setTargetBaselineId] = useState('')
  const [targetReason, setTargetReason] = useState('')

  const machines = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const selectedMachine = machines.data?.find(machine => machine.id === selectedMachineId)
  const visibleMachines = useMemo(() => machines.data?.filter(machine => projectFilterId === '' || machine.projectId === projectFilterId) ?? [], [machines.data, projectFilterId])
  const machineProject = useQuery({ queryKey: ['machine-project', selectedMachine?.projectId], queryFn: () => getProject(selectedMachine!.projectId), enabled: selectedMachine !== undefined })
  const selectedFactComponent = machineProject.data?.components.find(component => component.id === factComponentId)
  const targetBaselines = useQuery({ queryKey: ['machine-target-baselines', selectedMachine?.projectId], queryFn: () => getBaselines(selectedMachine!.projectId), enabled: selectedMachine !== undefined })
  const machineTarget = useQuery({ queryKey: ['machine-target', selectedMachineId], queryFn: () => getMachineTarget(selectedMachineId), enabled: selectedMachineId !== '' })
  const machineProjectStandard = useQuery({ queryKey: ['machine-project-standard', selectedMachine?.projectId], queryFn: () => getProjectStandard(selectedMachine!.projectId), enabled: selectedMachine !== undefined })
  const projectStandardComparison = useQuery({ queryKey: ['machine-project-standard-comparison', selectedMachineId, machineProjectStandard.data?.baselineId], queryFn: () => compareMachineToBaseline(selectedMachineId, machineProjectStandard.data!.baselineId), enabled: selectedMachineId !== '' && machineProjectStandard.data !== null && machineProjectStandard.data !== undefined })
  const machineTargetHistory = useQuery({ queryKey: ['machine-target-history', selectedMachineId], queryFn: () => getMachineTargetHistory(selectedMachineId), enabled: selectedMachineId !== '' })
  const machineConfiguration = useQuery({ queryKey: ['machine-configuration', selectedMachineId], queryFn: () => getMachineConfiguration(selectedMachineId), enabled: selectedMachineId !== '' })
  const machineFacts = useQuery({ queryKey: ['machine-facts', selectedMachineId], queryFn: () => getMachineFacts(selectedMachineId), enabled: selectedMachineId !== '' })
  const machineDrift = useQuery({ queryKey: ['machine-drift', selectedMachineId], queryFn: () => getMachineDrift(selectedMachineId), enabled: selectedMachineId !== '' })

  useEffect(() => {
    if (!selectedMachine) return
    setEditSerial(selectedMachine.serialNumber)
    setEditName(selectedMachine.name)
    setEditType(selectedMachine.machineType ?? '')
    setEditLocation(selectedMachine.location ?? '')
    setEditStatus(selectedMachine.status)
    setEditReason('')
  }, [selectedMachine])

  useEffect(() => {
    if (cloneMachineId === '') return
    const source = machines.data?.find(machine => machine.id === cloneMachineId)
    if (!source) return
    setMachineProjectId(source.projectId)
    setMachineName(`${source.name} 副本`)
    setMachineType(source.machineType ?? '')
    setMachineLocation(source.location ?? '')
    setMachineSerial('')
  }, [cloneMachineId, machines.data])

  const invalidateMachineData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['machines'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-target'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-target-history'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-configuration'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-facts'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-drift'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-project-standard-comparison'] }),
    ])
  }
  const addMachine = useMutation({
    mutationFn: createMachine,
    onSuccess: async ({ id }) => {
      setMachineSerial(''); setMachineName(''); setMachineType(''); setMachineLocation(''); setMachineReason(''); setCloneMachineId(''); setCreateOpen(false)
      onSelectMachine(id); onSuccess('机台已创建，可继续登记目标和实际配置。')
      await invalidateMachineData()
    },
  })
  const update = useMutation({
    mutationFn: () => updateMachine(selectedMachineId, { serialNumber: editSerial, name: editName, machineType: editType, location: editLocation, status: editStatus, reason: editReason }),
    onSuccess: async () => {
      setEditOpen(false); setEditReason(''); onSuccess('机台资料已更新，变更已写入审计记录。')
      await invalidateMachineData()
    },
  })
  const assignTarget = useMutation({
    mutationFn: () => assignMachineTarget(selectedMachineId, targetBaselineId, targetReason),
    onSuccess: async () => {
      setTargetBaselineId(''); setTargetReason(''); onSuccess('已为该机台显式指派目标基线。')
      await invalidateMachineData()
    },
  })
  const recordFacts = useMutation({
    mutationFn: () => recordMachineFacts(selectedMachineId, { operationType: 'Observation', coverage: factCoverage, sourceType: 'manual-ui', reason: factReason, items: [{ componentId: factComponentId, versionId: factVersionId, absent: false, knownInstalledAt: null }] }),
    onSuccess: async () => {
      setFactReason(''); onSuccess('实际配置已记录为观察事实。')
      await invalidateMachineData()
    },
  })

  return <div className="machine-workspace">
    <section className="status-panel catalog-panel machine-registry-panel">
      <div className="panel-heading machine-heading"><div><span className="section-index">机台管理</span><h3>选择机台后查看配置与历史</h3></div><span className="count">{machines.data?.length ?? 0}</span></div>
      <details className="machine-create" open={createOpen} onToggle={(event) => setCreateOpen((event.target as HTMLDetailsElement).open)}>
        <summary>新建机台 / 从已有机台复制资料</summary>
        <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); addMachine.mutate({ projectId: machineProjectId, serialNumber: machineSerial, name: machineName, machineType, location: machineLocation, reason: machineReason }) }}>
          <label>复制已有机台<select value={cloneMachineId} onChange={(event) => setCloneMachineId(event.target.value)}><option value="">不复制，手工录入</option>{machines.data?.map(machine => <option key={machine.id} value={machine.id}>{machine.name} · {machine.serialNumber}</option>)}</select></label>
          <label>所属项目<select value={machineProjectId} onChange={(event) => setMachineProjectId(event.target.value)} required><option value="">请选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label>机台序列号<input value={machineSerial} onChange={(event) => setMachineSerial(event.target.value)} required /></label>
          <label>机台名称<input value={machineName} onChange={(event) => setMachineName(event.target.value)} required /></label>
          <label>机型<input value={machineType} onChange={(event) => setMachineType(event.target.value)} /></label>
          <label>位置<input placeholder="例如：一厂装配线 A-03" value={machineLocation} onChange={(event) => setMachineLocation(event.target.value)} /></label>
          <label className="wide-field">创建原因<input value={machineReason} onChange={(event) => setMachineReason(event.target.value)} required /></label>
          <button className="primary-action" type="submit" disabled={addMachine.isPending}>{addMachine.isPending ? '正在创建' : '创建机台'}</button>
        </form>
        {addMachine.isError && <p className="error-strip">{addMachine.error.message}</p>}
      </details>
    </section>

    <section className="status-panel catalog-panel machine-list-panel">
      <div className="machine-list-controls"><label>项目<select value={projectFilterId} onChange={(event) => setProjectFilterId(event.target.value)}><option value="">全部项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><span>{visibleMachines.length} 台</span></div>
      <div className="machine-list">{visibleMachines.map(machine => <button type="button" className={machine.id === selectedMachineId ? 'machine-list-item selected' : 'machine-list-item'} key={machine.id} onClick={() => { onSelectMachine(machine.id); setFactComponentId(''); setFactVersionId('') }}><strong>{machine.name}</strong><span>{machine.serialNumber}{machine.location ? ` · ${machine.location}` : ''}</span><small>{machine.machineType || '未填机型'} · {machine.status === 'Active' ? '在用' : '已归档'}</small></button>)}</div>
    </section>

    <section className="status-panel catalog-panel machine-detail-panel">
      {!selectedMachine ? <p className="empty-state">从左侧列表选择一台机台后，才会显示其实际配置、目标与历史。</p> : <>
        <div className="machine-detail-header"><div><span className="section-index">已选机台</span><h3>{selectedMachine.name}</h3><p>{selectedMachine.serialNumber}{selectedMachine.machineType ? ` · ${selectedMachine.machineType}` : ''}{selectedMachine.location ? ` · ${selectedMachine.location}` : ''}</p></div><div className="machine-statuses"><span>匹配 {matchText[machineDrift.data?.matchStatus ?? 'Unknown']}</span><span>风险 {riskText[machineDrift.data?.riskSeverity ?? 'Unknown']}</span></div></div>
        <details className="machine-edit" open={editOpen} onToggle={(event) => setEditOpen((event.target as HTMLDetailsElement).open)}><summary>编辑机台资料</summary><form className="catalog-form" onSubmit={(event) => { event.preventDefault(); update.mutate() }}><label>机台序列号<input value={editSerial} onChange={(event) => setEditSerial(event.target.value)} required /></label><label>机台名称<input value={editName} onChange={(event) => setEditName(event.target.value)} required /></label><label>机型<input value={editType} onChange={(event) => setEditType(event.target.value)} /></label><label>位置<input value={editLocation} onChange={(event) => setEditLocation(event.target.value)} /></label><label>状态<select value={editStatus} onChange={(event) => setEditStatus(event.target.value)}><option value="Active">在用</option><option value="Archived">已归档</option></select></label><label className="wide-field">修改原因<input value={editReason} onChange={(event) => setEditReason(event.target.value)} required /></label><button type="submit" disabled={update.isPending}>{update.isPending ? '正在保存' : '保存资料'}</button></form><p className="form-hint">项目归属创建后固定，不能跨项目移动，以保护既有目标、实际配置和历史事实。</p>{update.isError && <p className="error-strip">{update.error.message}</p>}</details>

        <div className="machine-detail-sections">
          <details open><summary>目标基线</summary><p className="empty-state">{machineTarget.data ? `${machineTarget.data.baselineCode} · 自 ${formatTime(machineTarget.data.validFrom)} 起生效` : '尚未显式指派目标基线。项目当前标准不会自动成为本机目标。'}</p><form className="catalog-form" onSubmit={(event) => { event.preventDefault(); assignTarget.mutate() }}><label>已发布基线<select value={targetBaselineId} onChange={(event) => setTargetBaselineId(event.target.value)} required><option value="">请选择已发布基线</option>{targetBaselines.data?.filter(baseline => baseline.state === 'Released').map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.code} · Revision {baseline.revisionNo}</option>)}</select></label><label>指派原因<input value={targetReason} onChange={(event) => setTargetReason(event.target.value)} required /></label><button type="submit" disabled={assignTarget.isPending}>{assignTarget.isPending ? '正在指派' : '设为机台目标'}</button></form>{assignTarget.isError && <p className="error-strip">{assignTarget.error.message}</p>}{machineTarget.data && <details className="machine-drift-preview"><summary>比对当前实际与机台目标基线</summary>{machineDrift.data?.items.every(item => item.status === 'Matched') ? <p className="success-strip">匹配：全部组件一致。风险：{riskText[machineDrift.data?.riskSeverity ?? 'Unknown'] ?? machineDrift.data?.riskSeverity}。</p> : <div className="component-list">{machineDrift.data?.items.filter(item => item.status !== 'Matched').map(item => <article className="component-row" key={item.componentId}><div><strong>{item.componentName}</strong><span>{item.status === 'Missing' ? '实际缺失' : item.status === 'Extra' ? '基线之外' : '版本不同'}</span></div><small>{item.expectedVersionNumber ?? '无'} → {item.actualVersionNumber ?? '无'}</small></article>)}</div>}</details>}</details>
          <details className="machine-drift-preview"><summary>与项目当前标准比对</summary>{machineProjectStandard.isLoading ? <p className="empty-state">正在读取项目当前标准。</p> : !machineProjectStandard.data ? <p className="empty-state">项目尚未设定当前标准，因此暂不能进行此项比对。</p> : <><p className="form-hint">项目当前标准为 {machineProjectStandard.data.baselineCode}，用于展示项目推荐基线下的差异；它不会自动成为本机 Target。</p>{projectStandardComparison.isLoading ? <p className="empty-state">正在计算当前差异。</p> : projectStandardComparison.isError ? <p className="error-strip">{projectStandardComparison.error.message}</p> : projectStandardComparison.data?.items.every(item => item.status === 'Matched') ? <p className="success-strip">匹配：全部组件一致。风险：{riskText[projectStandardComparison.data.riskSeverity] ?? projectStandardComparison.data.riskSeverity}。</p> : <div className="component-list">{projectStandardComparison.data?.items.filter(item => item.status !== 'Matched').map(item => <article className="component-row" key={item.componentId}><div><strong>{item.componentName}</strong><span>{item.status === 'Missing' ? '实际缺失' : item.status === 'Extra' ? '标准之外' : '版本不同'}</span></div><small>{item.expectedVersionNumber ?? '无'} → {item.actualVersionNumber ?? '无'}</small></article>)}</div>}</>}</details>
          <details open><summary>实际配置</summary><form className="catalog-form" onSubmit={(event) => { event.preventDefault(); recordFacts.mutate() }}><label>组件<select value={factComponentId} onChange={(event) => { setFactComponentId(event.target.value); setFactVersionId('') }} required><option value="">请选择组件</option>{machineProject.data?.components.filter(component => component.versions.length > 0).map(component => <option key={component.id} value={component.id}>{component.name}</option>)}</select></label><label>版本<select value={factVersionId} onChange={(event) => setFactVersionId(event.target.value)} disabled={!selectedFactComponent} required><option value="">{selectedFactComponent ? '请选择版本' : '请先选择组件'}</option>{selectedFactComponent?.versions.map(version => <option key={version.id} value={version.id}>{version.versionNumber} · {version.maturity === 'Testing' ? '实验室测试' : version.maturity}</option>)}</select></label><label>覆盖范围<select value={factCoverage} onChange={(event) => setFactCoverage(event.target.value)}><option value="Partial">局部观察</option><option value="Full">完整观察</option></select></label><label>观察原因<input value={factReason} onChange={(event) => setFactReason(event.target.value)} required /></label><button type="submit" disabled={recordFacts.isPending || machineProject.isLoading}>{recordFacts.isPending ? '正在记录' : '记录实际配置'}</button></form><p className="form-hint">观察记录不等于安装或升级。局部观察只更新选择的组件；完整观察会把没有报告的软件组件记为缺失。实验室机台可在这里选择测试中的版本，但它不能成为机台目标基线。</p>{recordFacts.isError && <p className="error-strip">{recordFacts.error.message}</p>}<div className="component-list">{machineConfiguration.data?.map(item => <article className="component-row" key={item.componentId}><div><strong>{item.componentName}</strong><span>{item.state === 'Present' ? '当前存在' : '当前缺失'}</span></div><div className="version-tags"><span>{item.versionNumber ?? '无版本'}<small>状态生效 {formatTime(item.stateEffectiveAt)}<br />已知安装 {formatTime(item.knownInstalledAt)}</small></span></div></article>)}</div></details>
          <details><summary>目标与实际历史</summary><div className="component-list">{machineTargetHistory.data?.map(assignment => <article className="component-row" key={assignment.id}><div><strong>{assignment.baselineCode}</strong><span>{assignment.reason}</span></div><small>{formatTime(assignment.validFrom)}{assignment.validTo ? ` 至 ${formatTime(assignment.validTo)}` : ' · 当前目标'}</small></article>)}{machineFacts.data?.map(fact => <article className="component-row" key={fact.id}><div><strong>{operationText[fact.operationType] ?? fact.operationType}{fact.sourceBaselineCode ? `至 ${fact.sourceBaselineCode}` : ''} · {fact.coverage === 'Full' ? '完整' : '局部'}</strong><span>{fact.sourceBaselineCode ? `基线升级 · ${fact.itemCount} 个组件` : `${fact.sourceType} · ${fact.itemCount} 个组件`}</span></div><small>生效 {formatTime(fact.effectiveAt)}<br />记录 {formatTime(fact.recordedAt)}</small></article>)}</div></details>
        </div>
      </>}
    </section>
    {selectedMachine && <><RollbackFactPanel machineId={selectedMachine.id} components={machineProject.data?.components ?? []} /><HistoricalConfigurationPanel machine={selectedMachine} /></>}
    <BulkBaselineUpgradePanel projects={projects} />
    <BulkTargetPanel projects={projects} />
  </div>
}
