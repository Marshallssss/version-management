import { Modal } from 'antd'
import { PlusOutlined, EditOutlined, ArrowLeftOutlined, HistoryOutlined, SettingOutlined, SwapOutlined, UnorderedListOutlined, EnvironmentOutlined, UserOutlined, DatabaseOutlined, AppstoreOutlined, CloudUploadOutlined, AimOutlined } from '@ant-design/icons'
import { MachineVersionComparison } from './MachineVersionComparison'
import { ConfigurationTree } from './ConfigurationTree'
import { ChamberFields, MachineEquipmentPanel, stages } from './MachineEquipmentPanel'
import { type ChamberInput } from './catalog-api'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BulkTargetPanel } from './BulkTargetPanel'
import { BulkBaselineUpgradePanel } from './BulkBaselineUpgradePanel'
import { FullConfigurationPanel } from './FullConfigurationPanel'
import { HistoricalConfigurationPanel } from './HistoricalConfigurationPanel'
import { RollbackFactPanel } from './RollbackFactPanel'
import { assignMachineTarget, compareMachineToBaseline, createMachine, getBaselines, getMachineConfiguration, getMachineDrift, getMachineEquipment, getMachineFacts, getMachineTarget, getMachineTargetHistory, getMachines, getProject, getProjectStandard, recordMachineFacts, updateMachine } from './catalog-api'

const sourceText: Record<string, string> = { 'manual-ui': '人工录入', Manual: '人工录入', 'bulk-ui': '批量录入', 'agent-automation': '机台代理' }
const machineStatusText: Record<string, string> = { Active: '在用', Archived: '已归档', ShortTermCip: '短期 CIP', LongTermCip: '长期 CIP', NoProduction: '暂未过货' }
const matchText: Record<string, string> = { Matched: '匹配', Mismatch: '不匹配', Unknown: '未知' }
const riskText: Record<string, string> = { None: '无', High: '高', Critical: '严重', Unknown: '未知' }
const operationText: Record<string, string> = { Install: '安装', Upgrade: '升级', InitialSnapshot: '初始快照', Observation: '观察', Rollback: '回退', Correction: '更正' }

function formatTime(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'
}

export function MachineWorkspace({ projectId, canWrite = true, isAdmin = false, selectedMachineId, onSelectMachine, onOpenVersion, onSuccess }: { projectId: string; canWrite?: boolean; isAdmin?: boolean; selectedMachineId: string; onSelectMachine: (machineId: string) => void; onOpenVersion: (projectId: string, versionId: string, patches?: boolean) => void; onSuccess: (message: string) => void }) {
  const queryClient = useQueryClient()
  const [toolTab, setToolTab] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState('configuration')
  const [cloneMachineId, setCloneMachineId] = useState('')
  const [machineProjectId, setMachineProjectId] = useState(projectId)
  const [machineSerial, setMachineSerial] = useState('')
  const [machineName, setMachineName] = useState('')
  const [machineType, setMachineType] = useState('')
  const [machineLocation, setMachineLocation] = useState('')
  const [machineOwner, setMachineOwner] = useState('')
  const [machineStage, setMachineStage] = useState('Lab')
  const [machineChambers, setMachineChambers] = useState<ChamberInput[]>([])
  const [machineReason, setMachineReason] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editSerial, setEditSerial] = useState('')
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState('')
  const [editLocation, setEditLocation] = useState('')
  const [editStatus, setEditStatus] = useState('Active')
  const [expectedResumeAt, setExpectedResumeAt] = useState('')
  const [editReason, setEditReason] = useState('')
  const [factComponentId, setFactComponentId] = useState('')
  const [factVersionId, setFactVersionId] = useState('')
  const [factReason, setFactReason] = useState('')
  const [targetBaselineId, setTargetBaselineId] = useState('')
  const [targetReason, setTargetReason] = useState('')

  const machines = useQuery({ queryKey: ['machines'], queryFn: getMachines, refetchOnMount: 'always' })
  const cloneEquipment = useQuery({ queryKey: ['clone-equipment', cloneMachineId], queryFn: () => getMachineEquipment(cloneMachineId), enabled: !!cloneMachineId })
  useEffect(() => { if (cloneEquipment.data) setMachineChambers(cloneEquipment.data.chambers.filter(c => c.installed).map(c => ({ number: c.number, stage: c.stage }))) }, [cloneEquipment.data])
  const selectedMachine = machines.data?.find(machine => machine.id === selectedMachineId && machine.projectId === projectId)
  const visibleMachines = useMemo(() => machines.data?.filter(machine => machine.projectId === projectId).sort((a, b) => (a.location || '\uffff').localeCompare(b.location || '\uffff', 'zh-CN', { numeric: true }) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true })) ?? [], [machines.data, projectId])
  const machineProject = useQuery({ queryKey: ['project', selectedMachine?.projectId], queryFn: () => getProject(selectedMachine!.projectId), enabled: selectedMachine !== undefined })
  const selectedFactComponent = machineProject.data?.components.find(component => component.id === factComponentId)
  const targetBaselines = useQuery({ queryKey: ['machine-target-baselines', selectedMachine?.projectId], queryFn: () => getBaselines(selectedMachine!.projectId), enabled: selectedMachine !== undefined })
  const machineTarget = useQuery({ queryKey: ['machine-target', selectedMachineId], queryFn: () => getMachineTarget(selectedMachineId), enabled: selectedMachine !== undefined })
  const machineProjectStandard = useQuery({ queryKey: ['machine-project-standard', selectedMachine?.projectId], queryFn: () => getProjectStandard(selectedMachine!.projectId), enabled: selectedMachine !== undefined })
  const projectStandardComparison = useQuery({ queryKey: ['machine-project-standard-comparison', selectedMachineId, machineProjectStandard.data?.baselineId], queryFn: () => compareMachineToBaseline(selectedMachineId, machineProjectStandard.data!.baselineId), enabled: selectedMachine !== undefined && machineProjectStandard.data !== null && machineProjectStandard.data !== undefined })
  const machineTargetHistory = useQuery({ queryKey: ['machine-target-history', selectedMachineId], queryFn: () => getMachineTargetHistory(selectedMachineId), enabled: selectedMachine !== undefined })
  const machineConfiguration = useQuery({ queryKey: ['machine-configuration', selectedMachineId], queryFn: () => getMachineConfiguration(selectedMachineId), enabled: selectedMachine !== undefined })
  const machineFacts = useQuery({ queryKey: ['machine-facts', selectedMachineId], queryFn: () => getMachineFacts(selectedMachineId), enabled: selectedMachine !== undefined })
  const machineDrift = useQuery({ queryKey: ['machine-drift', selectedMachineId], queryFn: () => getMachineDrift(selectedMachineId), enabled: selectedMachine !== undefined })

  useEffect(() => {
    setDetailTab('configuration'); setToolTab(null); setEditOpen(false)
    setFactComponentId(''); setFactVersionId(''); setFactReason(''); setTargetBaselineId(''); setTargetReason('')
  }, [selectedMachineId])

  useEffect(() => {
    if (!selectedMachine) return
    setEditSerial(selectedMachine.serialNumber)
    setEditName(selectedMachine.name)
    setEditType(selectedMachine.machineType ?? '')
    setEditLocation(selectedMachine.location ?? '')
    setEditStatus(selectedMachine.status)
    setExpectedResumeAt(selectedMachine.expectedResumeAt ? new Date(new Date(selectedMachine.expectedResumeAt).getTime() - new Date(selectedMachine.expectedResumeAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
    setEditReason('')
  }, [selectedMachine])

  useEffect(() => {
    if (cloneMachineId === '') return
    const source = machines.data?.find(machine => machine.id === cloneMachineId)
    if (!source || source.projectId !== projectId) return
    setMachineProjectId(source.projectId)
    setMachineName(`${source.name} 副本`)
    setMachineType(source.machineType ?? '')
    setMachineLocation(source.location ?? '')
    setMachineOwner(source.owner ?? '')
    setMachineStage(source.stage ?? 'Lab')
    setMachineChambers((source.chambers ?? []).map(number => ({ number, stage: 'Lab' })))
    setMachineSerial('')
  }, [cloneMachineId, machines.data])

  const invalidateMachineData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['machines'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-equipment'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-target'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-target-history'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-configuration'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-facts'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-configuration-at'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-current-history-compare'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-drift'] }),
      queryClient.invalidateQueries({ queryKey: ['machine-project-standard-comparison'] }),
    ])
  }
  const addMachine = useMutation({
    mutationFn: createMachine,
    onSuccess: async ({ id }) => {
      setMachineSerial(''); setMachineName(''); setMachineType(''); setMachineLocation(''); setMachineReason(''); setMachineOwner(''); setMachineStage('Lab'); setMachineChambers([]); setCloneMachineId(''); setCreateOpen(false)
      onSelectMachine(id); onSuccess('机台已创建，可继续登记目标和实际配置。')
      await invalidateMachineData()
    },
  })
  const update = useMutation({
    mutationFn: () => updateMachine(selectedMachineId, { serialNumber: editSerial, name: editName, machineType: editType, location: editLocation, status: editStatus, expectedResumeAt: ['ShortTermCip', 'LongTermCip'].includes(editStatus) && expectedResumeAt ? new Date(expectedResumeAt).toISOString() : null, reason: editReason }),
    onSuccess: async () => {
      setEditOpen(false); setEditReason(''); onSuccess('机台资料已更新，变更已写入审计记录。')
      await invalidateMachineData()
    },
  })
  const assignTarget = useMutation({
    mutationFn: () => assignMachineTarget(selectedMachineId, targetBaselineId, targetReason),
    onSuccess: async () => {
      setToolTab(null); setTargetBaselineId(''); setTargetReason(''); onSuccess('已为该机台显式指派目标基线。')
      await invalidateMachineData()
    },
  })
  const recordFacts = useMutation({
    mutationFn: () => recordMachineFacts(selectedMachineId, { operationType: 'Observation', coverage: 'Partial', sourceType: 'manual-ui', reason: factReason, items: [{ componentId: factComponentId, versionId: factVersionId, absent: false, knownInstalledAt: null }] }),
    onSuccess: async () => {
      setToolTab(null); setFactReason(''); onSuccess('实际配置已记录为观察事实。')
      await invalidateMachineData()
    },
  })

  return <div className={`machine-workspace${selectedMachine ? ' has-selection' : ' machine-unselected'}`}>
    <section className="machine-registry-panel">
      <div className="panel-heading machine-heading"><strong>机台管理 <span className="workspace-count">{visibleMachines.length} 台</span></strong><div className="toolbar-actions">{canWrite && projectId && <><button type="button" className="primary-action" aria-label="新建机台 / 从已有机台复制资料" onClick={() => setCreateOpen(true)}><PlusOutlined aria-hidden />新建机台</button><button type="button" onClick={() => setToolTab('upgrade')}><CloudUploadOutlined aria-hidden />批量升级</button><button type="button" onClick={() => setToolTab('target')}><AimOutlined aria-hidden />批量目标</button></>}</div></div>
    </section>
    <section className="machine-list-panel">
      <div className="machine-list-controls"><strong>当前项目机台</strong><span>{visibleMachines.length} 台</span></div>
      {machines.isLoading && <p role="status">正在读取机台。</p>}{machines.isError && <p className="error-strip">{machines.error.message}</p>}{!machines.isLoading && visibleMachines.length === 0 && <p className="empty-state">暂无机台记录。</p>}
      <div className="machine-location-groups">{[...new Set(visibleMachines.map(machine => machine.location || '未填写位置'))].map(location => <section className="machine-location-group" key={location}><h4><EnvironmentOutlined aria-hidden />{location}</h4><div className="machine-list">{visibleMachines.filter(machine => (machine.location || '未填写位置') === location).map(machine => <button type="button" className={machine.id === selectedMachineId ? 'machine-list-item selected' : 'machine-list-item'} key={machine.id} onClick={() => { onSelectMachine(machine.id); setFactComponentId(''); setFactVersionId('') }}><strong>{machine.name}<em>{machine.stage || '未登记阶段'}</em></strong><span className="machine-list-identity">{machine.serialNumber}</span><small className="machine-list-state">{machine.machineType || '未填机型'} · {machineStatusText[machine.status] ?? '未知状态'}{machine.expectedResumeAt && ` · 预计恢复 ${formatTime(machine.expectedResumeAt)}`}</small><span className="machine-list-metadata"><span className="machine-list-baseline"><DatabaseOutlined aria-hidden /><span>目标基线 <b>{machine.targetBaselineCode || '未指派'}</b></span></span><span><AppstoreOutlined aria-hidden /><span>{machine.chambers?.length ? machine.chambers.map(n => `PM${n}`).join(' · ') : '未登记腔室'}</span></span><span><UserOutlined aria-hidden /><span>负责人 {machine.owner || '未填写'}</span></span></span></button>)}</div></section>)}</div>
    </section>
    <section hidden={!selectedMachine} className="machine-detail-panel">
      {selectedMachine && <>
        <div className="machine-detail-header"><div><span className="section-index">已选机台</span><h3>{selectedMachine.name}</h3><p>{selectedMachine.serialNumber}{selectedMachine.machineType ? ` · ${selectedMachine.machineType}` : ''}{selectedMachine.location ? ` · ${selectedMachine.location}` : ''}</p></div><div className="toolbar-actions">{canWrite && <button type="button" aria-label="编辑机台资料" onClick={() => setEditOpen(true)}><EditOutlined />编辑资料</button>}<button type="button" onClick={() => onSelectMachine('')}><ArrowLeftOutlined />返回机台列表</button></div></div>
        <div className="machine-statuses"><span>{machineStatusText[selectedMachine.status]}{selectedMachine.expectedResumeAt && ` · 预计恢复 ${formatTime(selectedMachine.expectedResumeAt)}`}</span><span data-match={machineDrift.data?.matchStatus}>匹配 {matchText[machineDrift.data?.matchStatus ?? 'Unknown']}</span><span data-risk={machineDrift.data?.riskSeverity}>风险 {riskText[machineDrift.data?.riskSeverity ?? 'Unknown']}</span><span>阶段 {selectedMachine.stage ?? '未登记'}</span><span>负责人 {selectedMachine.owner || '未填写'}</span></div>
        <nav className="workspace-tabs" aria-label="机台详情">
          {[['configuration', '当前配置', <UnorderedListOutlined aria-hidden />], ['target', '目标与对比', <SwapOutlined aria-hidden />], ['equipment', '阶段与腔室', <SettingOutlined aria-hidden />], ['history', '历史', <HistoryOutlined aria-hidden />]].map(([id, label, icon]) => <button type="button" key={String(id)} aria-pressed={detailTab === id} onClick={() => setDetailTab(String(id))}>{icon}{label}</button>)}
        </nav>
        <div hidden={detailTab !== 'configuration'} className="machine-section">
          <div className="subsection-heading"><h3>当前实际配置</h3>{canWrite && <div className="toolbar-actions"><button type="button" onClick={() => setToolTab('observation')}>记录局部观察</button><button type="button" onClick={() => setToolTab('configuration')}>录入完整配置</button></div>}</div>
          {machineConfiguration.isLoading || machineProject.isLoading ? <p role="status">正在读取配置。</p> : machineConfiguration.isError || machineProject.isError ? <p className="error-strip">配置读取失败，请刷新重试。</p> : <><ConfigurationTree components={machineProject.data?.components ?? []} items={machineConfiguration.data ?? []} onOpenVersion={versionId => onOpenVersion(selectedMachine.projectId, versionId)} onOpenPatches={versionId => onOpenVersion(selectedMachine.projectId, versionId, true)} />{machineConfiguration.data?.length === 0 && <p className="empty-state">尚未记录实际配置。</p>}</>}
        </div>
        <div hidden={detailTab !== 'target'} className="machine-section machine-detail-sections">
          <section className="machine-target-section"><div className="subsection-heading"><h3>机台目标</h3>{canWrite && <button type="button" onClick={() => setToolTab('assign')}>指派目标</button>}</div><p className="empty-state">{machineTarget.data ? `${machineTarget.data.baselineCode} · 自 ${formatTime(machineTarget.data.validFrom)} 起生效` : '尚未显式指派目标基线。项目当前标准不会自动成为本机目标。'}</p>{assignTarget.isError && <p className="error-strip">{assignTarget.error.message}</p>}{machineTarget.data && <details className="machine-drift-preview machine-target-comparison"><summary>比对当前实际与机台目标基线</summary><MachineVersionComparison key={selectedMachine.id} data={machineDrift.data} loading={machineDrift.isLoading} error={machineDrift.error} components={machineProject.data?.components ?? []} beforeLabel="目标版本" onOpenPatches={versionId => onOpenVersion(selectedMachine.projectId, versionId, true)} /></details>}</section>
          <details open className="machine-drift-preview machine-standard-comparison"><summary>与项目当前标准比对</summary>{machineProjectStandard.isLoading ? <p role="status">正在读取项目当前标准。</p> : machineProjectStandard.isError ? <p className="error-strip" role="alert">项目当前标准读取失败，请刷新重试。</p> : !machineProjectStandard.data ? <p className="empty-state">项目尚未设定当前标准，因此暂不能进行此项比对。</p> : <><p className="form-hint">项目当前标准为 {machineProjectStandard.data.baselineCode}，不会自动成为本机目标。</p><MachineVersionComparison key={selectedMachine.id} data={projectStandardComparison.data} loading={projectStandardComparison.isLoading} error={projectStandardComparison.error} components={machineProject.data?.components ?? []} beforeLabel="标准版本" onOpenPatches={versionId => onOpenVersion(selectedMachine.projectId, versionId, true)} /></>}</details>
        </div>
        <div hidden={detailTab !== 'equipment'} className="machine-section">
        <MachineEquipmentPanel key={selectedMachine.id} machineId={selectedMachine.id} name={selectedMachine.name} canWrite={canWrite} isAdmin={isAdmin} project={machineProject.data} onOpenPatches={versionId => onOpenVersion(selectedMachine.projectId, versionId, true)} onDeleted={() => { onSelectMachine(''); onSuccess('机台已删除，历史记录已保留。') }} onSuccess={onSuccess} />
        </div>
        <div hidden={detailTab !== 'history'} className="machine-section machine-detail-sections">
          <div className="subsection-heading"><h3>目标与实际历史</h3>{canWrite && <button type="button" onClick={() => setToolTab('correction')}>回退与更正</button>}</div>
          <details open><summary>目标与实际历史</summary><div className="component-list">{machineTargetHistory.data?.map(assignment => <article className="component-row" key={assignment.id}><div><strong>{assignment.baselineCode}</strong><span>{assignment.reason}</span></div><small>{formatTime(assignment.validFrom)}{assignment.validTo ? ` 至 ${formatTime(assignment.validTo)}` : ' · 当前目标'}</small></article>)}{machineFacts.data?.map(fact => <article className="component-row" key={fact.id}><div><strong>{operationText[fact.operationType] ?? fact.operationType}{fact.sourceBaselineCode ? `至 ${fact.sourceBaselineCode}` : ''} · {fact.coverage === 'Full' ? '完整' : '局部'}</strong><span>{fact.sourceBaselineCode ? `基线升级 · ${fact.itemCount} 个组件` : `${sourceText[fact.sourceType] ?? '外部来源'} · ${fact.itemCount} 个组件`}</span></div><small>生效 {formatTime(fact.effectiveAt)}<br />记录 {formatTime(fact.recordedAt)}</small></article>)}</div></details>
          <HistoricalConfigurationPanel key={selectedMachine.id} machine={selectedMachine} components={machineProject.data?.components ?? []} onOpenPatches={versionId => onOpenVersion(selectedMachine.projectId, versionId, true)} />
        </div>
      </>}
    </section>
    <Modal title="新建机台" open={canWrite && createOpen} onCancel={() => { if (!addMachine.isPending) setCreateOpen(false) }} maskClosable={!addMachine.isPending} width={820} footer={null} className="machine-dialog" destroyOnHidden>
      <div className="machine-create">
        <form hidden={!canWrite} className="catalog-form" onSubmit={(event) => { event.preventDefault(); addMachine.mutate({ projectId: machineProjectId, serialNumber: machineSerial, name: machineName, machineType, location: machineLocation, owner: machineOwner, stage: machineStage, chambers: machineChambers, reason: machineReason }) }}>
          <label>复制已有机台<select value={cloneMachineId} onChange={(event) => setCloneMachineId(event.target.value)}><option value="">不复制，手工录入</option>{visibleMachines.map(machine => <option key={machine.id} value={machine.id}>{machine.name} · {machine.serialNumber}</option>)}</select></label>
          <label>机台序列号<input value={machineSerial} onChange={(event) => setMachineSerial(event.target.value)} required /></label>
          <label>机台名称<input value={machineName} onChange={(event) => setMachineName(event.target.value)} required /></label>
          <label>机型<input value={machineType} onChange={(event) => setMachineType(event.target.value)} /></label>
          <label>位置<input placeholder="例如：一厂装配线 A-03" value={machineLocation} onChange={(event) => setMachineLocation(event.target.value)} /></label>
          <label>机台负责人<input value={machineOwner} onChange={event => setMachineOwner(event.target.value)} maxLength={160} /></label><label>整机阶段<select value={machineStage} onChange={event => setMachineStage(event.target.value)} required>{stages.map(stage => <option key={stage}>{stage}</option>)}</select></label><div className="wide-field"><ChamberFields value={machineChambers} onChange={setMachineChambers} /></div><label className="wide-field">创建原因<input value={machineReason} onChange={(event) => setMachineReason(event.target.value)} required /></label>
          <button className="primary-action" type="submit" disabled={addMachine.isPending || !!cloneMachineId && cloneEquipment.isFetching}>{addMachine.isPending ? '正在创建' : '创建机台'}</button>
        </form>
        {addMachine.isError && <p className="error-strip">{addMachine.error.message}</p>}{cloneEquipment.isError && <p className="error-strip">{cloneEquipment.error.message}</p>}
      </div>
    </Modal>
    <Modal title={`编辑机台资料 · ${selectedMachine?.name ?? ''}`} open={canWrite && editOpen && !!selectedMachine} onCancel={() => { if (!update.isPending) setEditOpen(false) }} maskClosable={!update.isPending} width={760} footer={null} className="machine-dialog" destroyOnHidden><div className="machine-edit">
<form hidden={!canWrite} className="catalog-form" onSubmit={(event) => { event.preventDefault(); update.mutate() }}><label>机台序列号<input value={editSerial} onChange={(event) => setEditSerial(event.target.value)} required /></label><label>机台名称<input value={editName} onChange={(event) => setEditName(event.target.value)} required /></label><label>机型<input value={editType} onChange={(event) => setEditType(event.target.value)} /></label><label>位置<input value={editLocation} onChange={(event) => setEditLocation(event.target.value)} /></label><label>状态<select value={editStatus} onChange={(event) => setEditStatus(event.target.value)}><option value="Active">在用</option><option value="ShortTermCip">短期 CIP</option><option value="LongTermCip">长期 CIP</option><option value="NoProduction">暂未过货</option><option value="Archived">已归档</option></select></label>{['ShortTermCip', 'LongTermCip'].includes(editStatus) && <label>预计恢复时间<input type="datetime-local" value={expectedResumeAt} onChange={event => setExpectedResumeAt(event.target.value)} required /></label>}<label className="wide-field">修改原因<input value={editReason} onChange={(event) => setEditReason(event.target.value)} required /></label><button type="submit" disabled={update.isPending}>{update.isPending ? '正在保存' : '保存资料'}</button></form><p className="form-hint">项目归属创建后固定，不能跨项目移动，以保护既有目标、实际配置和历史事实。</p>{update.isError && <p className="error-strip">{update.error.message}</p>}
    </div></Modal>
    <Modal title={`${({ configuration: '录入完整配置', observation: '记录局部观察', assign: '指派机台目标', correction: '回退与更正', upgrade: '批量升级', target: '批量目标' } as Record<string, string>)[toolTab ?? ''] ?? ''}${selectedMachine && !['upgrade', 'target'].includes(toolTab ?? '') ? ' · ' + selectedMachine.name : ''}`} open={canWrite && !!toolTab} onCancel={() => { if (!assignTarget.isPending && !recordFacts.isPending) setToolTab(null) }} width={1000} footer={null} className="machine-dialog" destroyOnHidden>
      <div className="machine-tools">
        {selectedMachine && toolTab === 'configuration' && <FullConfigurationPanel key={selectedMachine.id} machineId={selectedMachine.id} projectId={projectId} components={machineProject.data?.components ?? []} onRecorded={() => { setToolTab(null); void invalidateMachineData(); onSuccess('完整实际配置已记录为可追溯事实。') }} />}
        {selectedMachine && toolTab === 'observation' && <><p className="form-hint">观察只表示发现的实际状态，不表示安装或升级；局部观察只更新选中的组件。</p><form hidden={!canWrite} className="catalog-form" onSubmit={(event) => { event.preventDefault(); recordFacts.mutate() }}><label>组件<select value={factComponentId} onChange={(event) => { setFactComponentId(event.target.value); setFactVersionId('') }} required><option value="">请选择组件</option>{machineProject.data?.components.filter(component => component.versions.length > 0).map(component => <option key={component.id} value={component.id}>{component.name}</option>)}</select></label><label>版本<select value={factVersionId} onChange={(event) => setFactVersionId(event.target.value)} disabled={!selectedFactComponent} required><option value="">{selectedFactComponent ? '请选择版本' : '请先选择组件'}</option>{selectedFactComponent?.versions.map(version => <option key={version.id} value={version.id}>{version.versionNumber} · {({ Draft: '草稿', Testing: '实验室测试', Released: '已发布', Maintenance: '维护中', Deprecated: '已废弃' } as Record<string, string>)[version.maturity] ?? version.maturity}</option>)}</select></label><label>观察原因<input value={factReason} onChange={(event) => setFactReason(event.target.value)} required /></label><button type="submit" disabled={recordFacts.isPending || machineProject.isLoading}>{recordFacts.isPending ? '正在记录' : '记录局部观察'}</button></form>{recordFacts.isError && <p className="error-strip">{recordFacts.error.message}</p>}</>}
        {selectedMachine && toolTab === 'assign' && <><form hidden={!canWrite} className="catalog-form" onSubmit={(event) => { event.preventDefault(); assignTarget.mutate() }}><label>已发布基线<select value={targetBaselineId} onChange={(event) => setTargetBaselineId(event.target.value)} required><option value="">请选择已发布基线</option>{targetBaselines.data?.filter(baseline => baseline.state === 'Released').map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.code} · 修订 {baseline.revisionNo}</option>)}</select></label><label>指派原因<input value={targetReason} onChange={(event) => setTargetReason(event.target.value)} required /></label><button type="submit" disabled={assignTarget.isPending}>{assignTarget.isPending ? '正在指派' : '设为机台目标'}</button></form>{assignTarget.isError && <p className="error-strip">{assignTarget.error.message}</p>}</>}
        {selectedMachine && toolTab === 'correction' && <RollbackFactPanel key={selectedMachine.id} machineId={selectedMachine.id} components={machineProject.data?.components ?? []} />}
        {toolTab === 'upgrade' && <BulkBaselineUpgradePanel projectId={projectId} />}
        {toolTab === 'target' && <BulkTargetPanel projectId={projectId} />}
      </div>
    </Modal>
  </div>
}
