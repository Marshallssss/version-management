import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { assignMachineTarget, assignProjectMember, assignProjectStandard, changeUserRole, changeVersionMaturity, changeVersionSafety, cloneProject, commitImport, compareBaselines, createBaseline, createComponent, createComponentVersion, createMachine, createProject, createUser, decideBaselineReview, getBaselineDetail, getBaselines, getCurrentUser, getDashboard, getImportPreview, getMachineConfiguration, getMachineDrift, getMachineFacts, getMachineTarget, getMachineTargetHistory, getMachines, getProject, getProjectMembers, getProjectStandard, getProjects, getUsers, getVersionDetail, getVersionExposureSnapshots, getVersionImpact, login, logout, moveComponent, recommendVersion, recordMachineFacts, releaseBaseline, requestBaselineReview, searchCatalog, setBaselineItemRequirement, stageImport } from './catalog-api'
import { enqueueNoopJob, getSystemStatus, getSystemVersion, type BackgroundJobStatus } from './system-api'
import { RollbackFactPanel } from './RollbackFactPanel'
import { BulkTargetPanel } from './BulkTargetPanel'
import { BulkFactPanel } from './BulkFactPanel'
import { HistoricalConfigurationPanel } from './HistoricalConfigurationPanel'
import { MachineComparePanel } from './MachineComparePanel'
import { ProjectWorkspace } from './ProjectWorkspace'

const navigation = [
  { id: 'overview', label: '运行总览', available: true },
  { id: 'operations', label: '系统运维', available: true, adminOnly: true },
  { id: 'projects', label: '项目', available: true },
  { id: 'baselines', label: '基线', available: true },
  { id: 'machines', label: '机台', available: true },
  { id: 'deployments', label: '部署记录', available: true },
  { id: 'compare', label: '配置比对', available: true },
  { id: 'search', label: '搜索', available: true },
  { id: 'imports', label: '导入', available: true },
  { id: 'users', label: '用户与角色', available: true },
]

const statusText: Record<BackgroundJobStatus, string> = {
  Pending: '等待执行',
  Running: '执行中',
  Succeeded: '已完成',
  Failed: '失败',
  Retry: '等待重试',
}

const connectivityText = { online: '已连接', offline: '未连接', checking: '检测中' }
const jobTypeText: Record<string, string> = {
  'system.noop': '连通性任务',
}
const matchText: Record<string, string> = { Matched: '匹配', Mismatch: '不匹配', Unknown: '待计算' }
const riskText: Record<string, string> = { None: '无', High: '高', Critical: '严重', Unknown: '待计算' }
const operationText: Record<string, string> = { Observation: '观察', Install: '安装', Upgrade: '升级', InitialSnapshot: '初始快照', Rollback: '回退', Correction: '更正' }
const sourceText: Record<string, string> = { 'manual-ui': '人工录入', 'bulk-ui': '批量录入', 'agent-automation': '机台代理' }
const maturityText: Record<string, string> = { Draft: '草稿', Testing: '测试中', Released: '已发布', Maintenance: '维护中', Deprecated: '已废弃' }
const safetyText: Record<string, string> = { Clear: '正常', Blocked: '已阻断' }
const lifecycleAxisText: Record<string, string> = { Maturity: '成熟度', Safety: '安全状态', Recommendation: '推荐状态' }

function formatTime(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '—'
}

function App() {
  const [activePage, setActivePage] = useState('overview')
  const [successMessage, setSuccessMessage] = useState('')
  const [note, setNote] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectCode, setProjectCode] = useState('')
  const [projectName, setProjectName] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [projectReason, setProjectReason] = useState('')
  const [cloneSourceProjectId, setCloneSourceProjectId] = useState('')
  const [projectCatalogCollapsed, setProjectCatalogCollapsed] = useState(false)
  const [userName, setUserName] = useState('')
  const [password, setPassword] = useState('')
  const [componentCode, setComponentCode] = useState('')
  const [componentName, setComponentName] = useState('')
  const [componentReason, setComponentReason] = useState('')
  const [componentParentId, setComponentParentId] = useState('')
  const [memberUserId, setMemberUserId] = useState('')
  const [memberRole, setMemberRole] = useState('Viewer')
  const [memberReason, setMemberReason] = useState('')
  const [versionComponentId, setVersionComponentId] = useState('')
  const [versionNumber, setVersionNumber] = useState('')
  const [versionReason, setVersionReason] = useState('')
  const [lifecycleVersionId, setLifecycleVersionId] = useState('')
  const [lifecycleAction, setLifecycleAction] = useState('Testing')
  const [lifecycleReason, setLifecycleReason] = useState('')
  const [cloneCode, setCloneCode] = useState('')
  const [cloneName, setCloneName] = useState('')
  const [cloneReason, setCloneReason] = useState('')
  const [clonePreview, setClonePreview] = useState<{ copiedComponents: number; excludedVersions: number } | null>(null)
  const [moveComponentId, setMoveComponentId] = useState('')
  const [moveParentId, setMoveParentId] = useState('')
  const [moveReason, setMoveReason] = useState('')
  const [baselineProjectId, setBaselineProjectId] = useState('')
  const [baselineSeriesCode, setBaselineSeriesCode] = useState('')
  const [baselineCode, setBaselineCode] = useState('')
  const [baselineDescription, setBaselineDescription] = useState('')
  const [baselineReason, setBaselineReason] = useState('')
  const [releaseReason, setReleaseReason] = useState('')
  const [reviewReason, setReviewReason] = useState('')
  const [selectedBaselineId, setSelectedBaselineId] = useState('')
  const [baselineRequirementItemId, setBaselineRequirementItemId] = useState('')
  const [baselineRequirement, setBaselineRequirement] = useState('Required')
  const [baselineRequirementReason, setBaselineRequirementReason] = useState('')
  const [standardBaselineId, setStandardBaselineId] = useState('')
  const [standardReason, setStandardReason] = useState('')
  const [machineProjectId, setMachineProjectId] = useState('')
  const [machineSerial, setMachineSerial] = useState('')
  const [machineName, setMachineName] = useState('')
  const [machineType, setMachineType] = useState('')
  const [machineReason, setMachineReason] = useState('')
  const [selectedMachineId, setSelectedMachineId] = useState('')
  const [factComponentId, setFactComponentId] = useState('')
  const [factVersionId, setFactVersionId] = useState('')
  const [factCoverage, setFactCoverage] = useState('Partial')
  const [factReason, setFactReason] = useState('')
  const [targetBaselineId, setTargetBaselineId] = useState('')
  const [targetReason, setTargetReason] = useState('')
  const [impactVersionId, setImpactVersionId] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [compareProjectId, setCompareProjectId] = useState('')
  const [leftBaselineId, setLeftBaselineId] = useState('')
  const [rightBaselineId, setRightBaselineId] = useState('')
  const [importProjectId, setImportProjectId] = useState('')
  const [importRows, setImportRows] = useState('')
  const [importReason, setImportReason] = useState('')
  const [importBatchId, setImportBatchId] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserName, setNewUserName] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserRole, setNewUserRole] = useState('Viewer')
  const [newUserReason, setNewUserReason] = useState('')
  const [roleUserId, setRoleUserId] = useState('')
  const [roleValue, setRoleValue] = useState('Viewer')
  const [roleReason, setRoleReason] = useState('')
  const queryClient = useQueryClient()
  const system = useQuery({ queryKey: ['system-version'], queryFn: getSystemVersion })
  const currentUser = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false })
  const isAuthenticated = currentUser.data !== undefined
  const isAdmin = currentUser.data?.roles.includes('Admin') === true
  const status = useQuery({ queryKey: ['system-status'], queryFn: getSystemStatus, refetchInterval: 5_000, enabled: isAdmin })
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard, refetchInterval: 5_000, enabled: isAuthenticated })
  const projects = useQuery({ queryKey: ['projects'], queryFn: getProjects, enabled: isAuthenticated })
  const users = useQuery({ queryKey: ['users'], queryFn: getUsers, enabled: currentUser.data?.roles.includes('Admin') === true })
  const addUser = useMutation({ mutationFn: createUser, onSuccess: async () => { setNewUserEmail(''); setNewUserName(''); setNewUserPassword(''); setNewUserReason(''); await queryClient.invalidateQueries({ queryKey: ['users'] }) } })
  const updateUserRole = useMutation({ mutationFn: () => changeUserRole(roleUserId, { role: roleValue, reason: roleReason }), onSuccess: async () => { setRoleReason(''); await queryClient.invalidateQueries({ queryKey: ['users'] }) } })
  const projectDetail = useQuery({ queryKey: ['project', selectedProjectId], queryFn: () => getProject(selectedProjectId!), enabled: isAuthenticated && selectedProjectId !== null })
  const projectMembers = useQuery({ queryKey: ['project-members', selectedProjectId], queryFn: () => getProjectMembers(selectedProjectId!), enabled: isAuthenticated && selectedProjectId !== null && currentUser.data?.roles.includes('Admin') === true })
  const baselines = useQuery({ queryKey: ['baselines', baselineProjectId], queryFn: () => getBaselines(baselineProjectId), enabled: isAuthenticated && baselineProjectId !== '' })
  const baselineDetail = useQuery({ queryKey: ['baseline-detail', selectedBaselineId], queryFn: () => getBaselineDetail(selectedBaselineId), enabled: isAuthenticated && selectedBaselineId !== '' })
  const standard = useQuery({ queryKey: ['project-standard', baselineProjectId], queryFn: () => getProjectStandard(baselineProjectId), enabled: isAuthenticated && baselineProjectId !== '' })
  const machines = useQuery({ queryKey: ['machines'], queryFn: getMachines, enabled: isAuthenticated })
  const selectedMachine = machines.data?.find(machine => machine.id === selectedMachineId)
  const machineProjectDetail = useQuery({ queryKey: ['machine-project', selectedMachine?.projectId], queryFn: () => getProject(selectedMachine!.projectId), enabled: isAuthenticated && selectedMachine !== undefined })
  const selectedFactComponent = machineProjectDetail.data?.components.find(component => component.id === factComponentId)
  const targetBaselines = useQuery({ queryKey: ['machine-target-baselines', selectedMachine?.projectId], queryFn: () => getBaselines(selectedMachine!.projectId), enabled: isAuthenticated && selectedMachine !== undefined })
  const machineTarget = useQuery({ queryKey: ['machine-target', selectedMachineId], queryFn: () => getMachineTarget(selectedMachineId), enabled: isAuthenticated && selectedMachineId !== '' })
  const machineTargetHistory = useQuery({ queryKey: ['machine-target-history', selectedMachineId], queryFn: () => getMachineTargetHistory(selectedMachineId), enabled: isAuthenticated && selectedMachineId !== '' })
  const machineConfiguration = useQuery({ queryKey: ['machine-configuration', selectedMachineId], queryFn: () => getMachineConfiguration(selectedMachineId), enabled: isAuthenticated && selectedMachineId !== '' })
  const machineFacts = useQuery({ queryKey: ['machine-facts', selectedMachineId], queryFn: () => getMachineFacts(selectedMachineId), enabled: isAuthenticated && selectedMachineId !== '' })
  const machineDrift = useQuery({ queryKey: ['machine-drift', selectedMachineId], queryFn: () => getMachineDrift(selectedMachineId), enabled: isAuthenticated && selectedMachineId !== '' })
  const versionImpact = useQuery({ queryKey: ['version-impact', impactVersionId], queryFn: () => getVersionImpact(impactVersionId), enabled: isAuthenticated && impactVersionId !== '' })
  const versionExposure = useQuery({ queryKey: ['version-exposure', impactVersionId], queryFn: () => getVersionExposureSnapshots(impactVersionId), enabled: isAuthenticated && impactVersionId !== '' })
  const versionDetail = useQuery({ queryKey: ['version-detail', impactVersionId], queryFn: () => getVersionDetail(impactVersionId), enabled: isAuthenticated && impactVersionId !== '' })
  const catalogSearch = useQuery({ queryKey: ['catalog-search', searchTerm], queryFn: () => searchCatalog(searchTerm), enabled: isAuthenticated && searchTerm.trim().length >= 2 })
  const compareProjectBaselines = useQuery({ queryKey: ['compare-baselines', compareProjectId], queryFn: () => getBaselines(compareProjectId), enabled: isAuthenticated && compareProjectId !== '' })
  const baselineComparison = useQuery({ queryKey: ['baseline-comparison', leftBaselineId, rightBaselineId], queryFn: () => compareBaselines(leftBaselineId, rightBaselineId), enabled: isAuthenticated && leftBaselineId !== '' && rightBaselineId !== '' && leftBaselineId !== rightBaselineId })
  const importPreview = useQuery({ queryKey: ['import-preview', importBatchId], queryFn: () => getImportPreview(importBatchId), enabled: isAuthenticated && importBatchId !== '' })
  const enqueue = useMutation({
    mutationFn: enqueueNoopJob,
    onSuccess: async () => {
      setNote('')
      await queryClient.invalidateQueries({ queryKey: ['system-status'] })
    },
  })
  const addProject = useMutation({
    mutationFn: (input: { code: string; name: string; description: string; reason: string }) => cloneSourceProjectId ? cloneProject(cloneSourceProjectId, { code: input.code, name: input.name, reason: input.reason }) : createProject(input),
    onSuccess: async ({ id }) => {
      setProjectCode('')
      setProjectName('')
      setProjectDescription('')
      setProjectReason('')
      setCloneSourceProjectId('')
      setSelectedProjectId(id)
      setProjectCatalogCollapsed(true)
      setSuccessMessage('项目已创建。')
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
  const stageImportMutation = useMutation({ mutationFn: () => stageImport({ projectId: importProjectId, sourceFileName: '手工预览.csv', reason: importReason, rows: importRows.split(/\r?\n/).filter(Boolean).map(line => { const [componentCode = '', versionNumber = ''] = line.split(','); return { componentCode: componentCode.trim(), versionNumber: versionNumber.trim() } }) }), onSuccess: ({ id }) => setImportBatchId(id) })
  const assignTarget = useMutation({ mutationFn: () => assignMachineTarget(selectedMachineId, targetBaselineId, targetReason), onSuccess: async () => { setTargetBaselineId(''); setTargetReason(''); setSuccessMessage('已为该机台显式指派目标基线。'); await queryClient.invalidateQueries({ queryKey: ['machines'] }); await queryClient.invalidateQueries({ queryKey: ['machine-target', selectedMachineId] }); await queryClient.invalidateQueries({ queryKey: ['machine-drift', selectedMachineId] }) } })
  const commitImportMutation = useMutation({ mutationFn: () => commitImport(importBatchId), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['import-preview', importBatchId] }); await queryClient.invalidateQueries({ queryKey: ['project', selectedProjectId] }) } })
  const signIn = useMutation({ mutationFn: login, onSuccess: async () => { setPassword(''); await queryClient.invalidateQueries({ queryKey: ['current-user'] }) } })
  const signOut = useMutation({ mutationFn: logout, onSuccess: () => { queryClient.clear(); setSelectedProjectId(null); setActivePage('overview') } })
  const addComponent = useMutation({
    mutationFn: ({ projectId, code, name, reason, parentComponentId }: { projectId: string; code: string; name: string; reason: string; parentComponentId: string | null }) => createComponent(projectId, { code, name, parentComponentId, reason }),
    onSuccess: async () => {
      setComponentCode('')
      setComponentName('')
      setComponentReason('')
      setComponentParentId('')
      setSuccessMessage('组件已创建。')
      await queryClient.invalidateQueries({ queryKey: ['project', selectedProjectId] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
  const assignMember = useMutation({ mutationFn: () => assignProjectMember(selectedProjectId!, { userId: memberUserId, role: memberRole, reason: memberReason }), onSuccess: async () => { setMemberUserId(''); setMemberReason(''); await queryClient.invalidateQueries({ queryKey: ['project-members', selectedProjectId] }) } })
  const addVersion = useMutation({
    mutationFn: ({ componentId, number, reason }: { componentId: string; number: string; reason: string }) => createComponentVersion(componentId, { versionNumber: number, reason }),
    onSuccess: async () => {
      setVersionNumber('')
      setVersionReason('')
      setSuccessMessage('软件版本已登记。')
      await queryClient.invalidateQueries({ queryKey: ['project', selectedProjectId] })
    },
  })
  const lifecycle = useMutation({
    mutationFn: async ({ versionId, action, reason }: { versionId: string; action: string; reason: string }) => {
      if (action === 'Recommended') {
        await recommendVersion(versionId, reason)
        return
      }
      if (action === 'Blocked' || action === 'Clear') {
        await changeVersionSafety(versionId, action, reason)
        return
      }
      await changeVersionMaturity(versionId, action, reason)
    },
    onSuccess: async () => { setLifecycleReason(''); await queryClient.invalidateQueries({ queryKey: ['project', selectedProjectId] }) },
  })
  const clone = useMutation({ mutationFn: ({ projectId, code, name, reason }: { projectId: string; code: string; name: string; reason: string }) => cloneProject(projectId, { code, name, reason }), onSuccess: async ({ id }) => { setSelectedProjectId(id); setCloneCode(''); setCloneName(''); setCloneReason(''); await queryClient.invalidateQueries({ queryKey: ['projects'] }) } })
  const move = useMutation({ mutationFn: ({ componentId, parentComponentId, reason }: { componentId: string; parentComponentId: string | null; reason: string }) => moveComponent(componentId, { parentComponentId, reason }), onSuccess: async () => { setMoveReason(''); await queryClient.invalidateQueries({ queryKey: ['project', selectedProjectId] }) } })
  const addBaseline = useMutation({ mutationFn: ({ projectId, seriesCode, code, description, reason }: { projectId: string; seriesCode: string; code: string; description: string; reason: string }) => createBaseline(projectId, { seriesCode, baselineCode: code, description, reason }), onSuccess: async () => { setBaselineCode(''); setBaselineDescription(''); setBaselineReason(''); await queryClient.invalidateQueries({ queryKey: ['baselines', baselineProjectId] }) } })
  const release = useMutation({ mutationFn: ({ baselineId, reason }: { baselineId: string; reason: string }) => releaseBaseline(baselineId, reason), onSuccess: async () => { setReleaseReason(''); await queryClient.invalidateQueries({ queryKey: ['baselines', baselineProjectId] }) } })
  const requestReview = useMutation({ mutationFn: () => requestBaselineReview(selectedBaselineId, reviewReason), onSuccess: async () => { setReviewReason(''); await queryClient.invalidateQueries({ queryKey: ['baseline-detail', selectedBaselineId] }) } })
  const decideReview = useMutation({ mutationFn: (decision: 'approve' | 'reject') => decideBaselineReview(selectedBaselineId, decision, reviewReason), onSuccess: async () => { setReviewReason(''); await queryClient.invalidateQueries({ queryKey: ['baseline-detail', selectedBaselineId] }); await queryClient.invalidateQueries({ queryKey: ['baselines', baselineProjectId] }) } })
  const setRequirement = useMutation({ mutationFn: () => setBaselineItemRequirement(selectedBaselineId, baselineRequirementItemId, { requirement: baselineRequirement, reason: baselineRequirementReason }), onSuccess: async () => { setBaselineRequirementReason(''); await queryClient.invalidateQueries({ queryKey: ['baseline-detail', selectedBaselineId] }) } })
  const assignStandard = useMutation({ mutationFn: ({ projectId, baselineId, reason }: { projectId: string; baselineId: string; reason: string }) => assignProjectStandard(projectId, baselineId, reason), onSuccess: async () => { setStandardReason(''); await queryClient.invalidateQueries({ queryKey: ['project-standard', baselineProjectId] }) } })
  const addMachine = useMutation({ mutationFn: createMachine, onSuccess: async () => { setMachineSerial(''); setMachineName(''); setMachineType(''); setMachineReason(''); await queryClient.invalidateQueries({ queryKey: ['machines'] }) } })
  const recordFacts = useMutation({ mutationFn: ({ machineId, componentId, versionId, operationType, coverage, reason }: { machineId: string; componentId: string; versionId: string; operationType?: string; coverage: string; reason: string }) => recordMachineFacts(machineId, { operationType: operationType ?? 'Observation', coverage, sourceType: 'manual-ui', reason, items: [{ componentId, versionId, absent: false, knownInstalledAt: null }] }), onSuccess: async () => { setFactReason(''); setSuccessMessage('实际配置观察已记录。'); await queryClient.invalidateQueries({ queryKey: ['machine-configuration', selectedMachineId] }); await queryClient.invalidateQueries({ queryKey: ['machine-facts', selectedMachineId] }); await queryClient.invalidateQueries({ queryKey: ['machine-drift', selectedMachineId] }) } })

  const connectivity = system.isSuccess ? 'online' : system.isError ? 'offline' : 'checking'
  const visibleNavigation = navigation.filter((item) => !item.adminOnly || isAdmin)
  const selectedNavigation = visibleNavigation.find((item) => item.id === activePage) ?? navigation[0]
  const queueCount = (jobStatus: BackgroundJobStatus) => status.data?.queue.find((item) => item.status === jobStatus)?.count ?? 0

  useEffect(() => {
    if (selectedProjectId) setProjectCatalogCollapsed(true)
  }, [selectedProjectId])

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand-block">
          <span className="brand-mark">CH</span>
          <div><strong>ConfigHub</strong><small>工程配置管理</small></div>
        </div>
        <nav aria-label="主导航">
          {visibleNavigation.map((item, index) => (
            <button className={item.id === activePage ? 'nav-item active' : 'nav-item'} key={item.id} type="button" onClick={() => setActivePage(!isAuthenticated && item.id !== 'projects' ? 'projects' : item.id)}>
              <span>{String(index + 1).padStart(2, '0')}</span>{item.label}{!item.available && <em>待实现</em>}
            </button>
          ))}
        </nav>
        <div className="rail-footer"><span className="signal-dot" />本机运行环境</div>
      </aside>

      <main>
        <header className="topbar">
          <div><span className="eyebrow">工程运行 / 基础设施</span><h1>{selectedNavigation.label}</h1></div>
          <div className={`connection-state ${connectivity}`}><span>{currentUser.data?.name ?? '未登录'}</span><strong>{connectivityText[connectivity]}</strong></div>
        </header>

        {successMessage && <p className="success-strip">{successMessage}</p>}

        {selectedNavigation.available ? (
          <div className="content-grid">
            {activePage === 'overview' && <>
              <section className="hero-panel">
                <div className="hero-copy">
                  <span className="section-index">本机基础设施</span>
                  <h2>系统已经就绪</h2>
                  <p>此处用于查看服务身份、配置状态与运行拓扑。后台队列仅在系统运维中供管理员诊断和验收。</p>
                  {isAdmin && <button className="primary-action" type="button" onClick={() => setActivePage('operations')}>打开系统运维</button>}
                </div>
                <div className="topology" aria-label="当前运行拓扑">
                  <div className="topology-node primary">ConfigHub 服务端</div><div className="topology-line" />
                  <div className="topology-row"><div className="topology-node">React 界面</div><div className="topology-node">API v1</div></div><div className="topology-line" />
                  <div className="topology-row"><div className="topology-node">PostgreSQL</div><div className="topology-node">后台 Worker</div></div>
                </div>
              </section>
              <section className="status-panel">
                <div className="panel-heading"><div><span className="section-index">实时运行信息</span><h3>服务身份</h3></div><button type="button" onClick={() => void system.refetch()} disabled={system.isFetching}>{system.isFetching ? '正在刷新' : '刷新'}</button></div>
                <dl className="runtime-list"><div><dt>产品</dt><dd>{system.data?.product ?? '—'}</dd></div><div><dt>版本</dt><dd>{system.data?.version ?? '—'}</dd></div><div><dt>接口版本</dt><dd>{system.data?.apiVersion ?? '—'}</dd></div><div><dt>服务时间</dt><dd>{formatTime(system.data?.serverTime)}</dd></div></dl>
              </section>
              <section className="status-panel">
                <div className="panel-heading"><div><span className="section-index">配置总览</span><h3>机台配置状态</h3></div><span className="count">{dashboard.data?.machineCount ?? '—'}</span></div>
                <dl className="runtime-list"><div><dt>机台总数</dt><dd>{dashboard.data?.machineCount ?? '—'}</dd></div><div><dt>配置匹配</dt><dd>{dashboard.data?.matchedCount ?? '—'}</dd></div><div><dt>配置不匹配</dt><dd>{dashboard.data?.mismatchCount ?? '—'}</dd></div><div><dt>状态未知</dt><dd>{dashboard.data?.unknownCount ?? '—'}</dd></div><div><dt>严重风险</dt><dd>{dashboard.data?.criticalRiskCount ?? '—'}</dd></div></dl>
              </section>
              {isAdmin && <section className="telemetry-panel queue-panel">
                <div className="panel-heading"><div><span className="section-index">队列概览</span><h3>后台任务</h3></div><span className="count">{status.data?.jobs.length ?? 0}</span></div>
                <div className="queue-summary"><div><span>等待执行</span><b>{queueCount('Pending')}</b></div><div><span>执行中</span><b>{queueCount('Running')}</b></div><div><span>等待重试</span><b>{queueCount('Retry')}</b></div><div><span>已完成</span><b>{queueCount('Succeeded')}</b></div><div><span>失败</span><b>{queueCount('Failed')}</b></div></div>
              </section>}
            </>}

            {activePage === 'operations' && isAdmin && <>
              <section className="hero-panel job-submit-panel">
                <div className="hero-copy"><span className="section-index">管理员诊断</span><h2>后台队列运维</h2><p>连通性任务会写入 PostgreSQL 并由 Worker 领取完成，用于部署验收、故障定位和队列重试观察。</p></div>
                <div className="job-form">
                  <label htmlFor="job-note">任务说明</label>
                  <textarea id="job-note" value={note} maxLength={500} placeholder="例如：部署后 Worker 连通性验收" onChange={(event) => setNote(event.target.value)} />
                  <button className="primary-action" type="button" onClick={() => enqueue.mutate(note)} disabled={enqueue.isPending}>{enqueue.isPending ? '正在提交' : '提交连通性任务'}</button>
                  {enqueue.isSuccess && <p className="success-strip">任务已提交，Worker 通常会在几秒内完成。</p>}
                  {enqueue.isError && <p className="error-strip">{enqueue.error.message}</p>}
                </div>
              </section>
              <section className="status-panel jobs-panel">
                <div className="panel-heading"><div><span className="section-index">最近任务</span><h3>执行记录</h3></div><button type="button" onClick={() => void status.refetch()} disabled={status.isFetching}>{status.isFetching ? '正在刷新' : '刷新'}</button></div>
                {status.data?.jobs.length ? <div className="job-list">{status.data.jobs.map((job) => <article className="job-row" key={job.id}><div><strong>{jobTypeText[job.jobType] ?? job.jobType}</strong><span>{formatTime(job.createdAt)}{job.lastAttemptAt && `；上次尝试 ${formatTime(job.lastAttemptAt)}`}</span></div><span className={`job-state ${job.status.toLowerCase()}`}>{statusText[job.status]}</span><small>第 {job.attempts} 次</small>{job.lastError && <p>{job.lastError}</p>}</article>)}</div> : <p className="empty-state">还没有任务记录。提交一条连通性任务即可开始验证。</p>}
              </section>
            </>}

            {activePage === 'projects' && <>
              {!currentUser.data && <section className="status-panel catalog-detail"><div className="panel-heading"><div><span className="section-index">身份验证</span><h3>登录后管理项目</h3></div></div><form className="catalog-form" onSubmit={(event) => { event.preventDefault(); signIn.mutate({ userName, password }) }}><label>用户名<input value={userName} onChange={(event) => setUserName(event.target.value)} required /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="primary-action" type="submit" disabled={signIn.isPending}>{signIn.isPending ? '正在登录' : '登录'}</button></form>{signIn.isError && <p className="error-strip">登录失败，请检查凭据。</p>}</section>}
              {currentUser.data && <section className="status-panel catalog-detail"><div className="panel-heading"><div><span className="section-index">当前身份</span><h3>{currentUser.data.name}</h3></div><button type="button" onClick={() => signOut.mutate()} disabled={signOut.isPending}>退出登录</button></div></section>}
              <section className="status-panel project-catalog-summary">
                <div className="panel-heading"><div><span className="section-index">项目目录</span><h3>{projectCatalogCollapsed ? '当前项目工作台' : '项目管理'}</h3></div><button type="button" onClick={() => setProjectCatalogCollapsed(!projectCatalogCollapsed)}>{projectCatalogCollapsed ? '展开目录' : '收起目录'}</button></div>
                {projectCatalogCollapsed && <p className="form-hint">{projectDetail.data ? `${projectDetail.data.project.code} · ${projectDetail.data.project.name}` : '已收起项目目录；展开后可切换、新建或克隆项目。'}</p>}
              </section>
              {!projectCatalogCollapsed && <>
              <section className="status-panel catalog-panel">
                <div className="panel-heading"><div><span className="section-index">项目目录</span><h3>创建项目</h3></div></div>
                <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); addProject.mutate({ code: projectCode, name: projectName, description: projectDescription, reason: projectReason }) }}>
                  <label>项目编码<input value={projectCode} maxLength={50} placeholder="例如：LINE-A" onChange={(event) => setProjectCode(event.target.value)} required /></label>
                  <label>项目名称<input value={projectName} maxLength={200} placeholder="例如：产线 A 配置" onChange={(event) => setProjectName(event.target.value)} required /></label>
                  <label className="wide-field">创建方式<select value={cloneSourceProjectId} onChange={(event) => setCloneSourceProjectId(event.target.value)}><option value="">创建空白项目</option>{projects.data?.map((project) => <option key={project.id} value={project.id}>从 {project.code} · {project.name} 复制组件树</option>)}</select></label>
                  {cloneSourceProjectId ? <p className="form-hint wide-field">将复制组件树，不复制软件版本、基线、机台或历史记录；说明沿用源项目。</p> : <label className="wide-field">说明<textarea value={projectDescription} maxLength={2000} onChange={(event) => setProjectDescription(event.target.value)} /></label>}
                  <label className="wide-field">创建原因<input value={projectReason} maxLength={500} onChange={(event) => setProjectReason(event.target.value)} required /></label>
                  <button className="primary-action" type="submit" disabled={addProject.isPending || !currentUser.data}>{addProject.isPending ? '正在创建' : cloneSourceProjectId ? '创建克隆项目' : '创建项目'}</button>
                </form>
                {addProject.isError && <p className="error-strip">{addProject.error.message}</p>}
              </section>
              <section className="status-panel catalog-panel">
                <div className="panel-heading"><div><span className="section-index">已建项目</span><h3>项目列表</h3></div><span className="count">{projects.data?.length ?? 0}</span></div>
                <div className="catalog-list">{projects.data?.map((project) => <button key={project.id} type="button" className={project.id === selectedProjectId ? 'project-row selected' : 'project-row'} onClick={() => { setSelectedProjectId(project.id); setVersionComponentId(''); setProjectCatalogCollapsed(true) }}><span><strong>{project.code}</strong><small>{project.name}</small></span><em>{project.componentCount} 个组件</em></button>) ?? <p className="empty-state">正在读取项目。</p>}</div>
              </section>
              </>}
              {projectDetail.data && <div hidden><section className="status-panel catalog-detail">
                <div className="panel-heading"><div><span className="section-index">{projectDetail.data.project.code}</span><h3>{projectDetail.data.project.name}</h3></div></div>
                <div className="catalog-actions">
                  <form className="inline-form" onSubmit={(event) => { event.preventDefault(); addComponent.mutate({ projectId: projectDetail.data.project.id, code: componentCode, name: componentName, reason: componentReason, parentComponentId: componentParentId || null }) }}><label>组件编码<input value={componentCode} placeholder="例如：PLC" onChange={(event) => setComponentCode(event.target.value)} required /></label><label>组件名称<input value={componentName} placeholder="例如：主控程序" onChange={(event) => setComponentName(event.target.value)} required /></label><label>父组件<select value={componentParentId} onChange={(event) => setComponentParentId(event.target.value)}><option value="">根组件</option>{projectDetail.data.components.map(component => <option key={component.id} value={component.id}>{component.code} · {component.name}</option>)}</select></label><label>创建原因<input value={componentReason} onChange={(event) => setComponentReason(event.target.value)} required /></label><button type="submit" disabled={addComponent.isPending}>{addComponent.isPending ? '正在新增' : '新增组件'}</button></form>
                  <form className="inline-form" onSubmit={(event) => { event.preventDefault(); addVersion.mutate({ componentId: versionComponentId, number: versionNumber, reason: versionReason }) }}><label>目标组件<select value={versionComponentId} onChange={(event) => setVersionComponentId(event.target.value)} required><option value="">请选择组件</option>{projectDetail.data.components.map((component) => <option key={component.id} value={component.id}>{component.code} · {component.name}</option>)}</select></label><label>版本号<input value={versionNumber} placeholder="例如：2026.08.29" onChange={(event) => setVersionNumber(event.target.value)} required /></label><label>创建原因<input value={versionReason} onChange={(event) => setVersionReason(event.target.value)} required /></label><button type="submit" disabled={addVersion.isPending}>{addVersion.isPending ? '正在登记' : '登记版本'}</button></form>
                  <form className="inline-form" onSubmit={(event) => { event.preventDefault(); lifecycle.mutate({ versionId: lifecycleVersionId, action: lifecycleAction, reason: lifecycleReason }) }}><label>目标版本<select value={lifecycleVersionId} onChange={(event) => setLifecycleVersionId(event.target.value)} required><option value="">请选择版本</option>{projectDetail.data.components.flatMap((component) => component.versions.map((version) => <option key={version.id} value={version.id}>{component.code} · {version.versionNumber}</option>))}</select></label><label>生命周期动作<select value={lifecycleAction} onChange={(event) => setLifecycleAction(event.target.value)}><option value="Testing">提交测试</option><option value="Released">发布</option><option value="Maintenance">进入维护</option><option value="Deprecated">废弃</option><option value="Blocked">阻断</option><option value="Clear">解除阻断</option><option value="Recommended">设为推荐</option></select></label><label>原因<input value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value)} required /></label><button type="submit" disabled={lifecycle.isPending}>{lifecycle.isPending ? '正在更新' : '更新状态'}</button></form>
                  <form className="inline-form" onSubmit={(event) => { event.preventDefault(); clone.mutate({ projectId: projectDetail.data.project.id, code: cloneCode, name: cloneName, reason: cloneReason }) }}><label>新项目编码<input value={cloneCode} onChange={(event) => setCloneCode(event.target.value)} required /></label><label>新项目名称<input value={cloneName} onChange={(event) => setCloneName(event.target.value)} required /></label><label>克隆原因<input value={cloneReason} onChange={(event) => setCloneReason(event.target.value)} required /></label><button type="button" onClick={() => setClonePreview({ copiedComponents: projectDetail.data.components.length, excludedVersions: projectDetail.data.components.reduce((count, component) => count + component.versions.length, 0) })}>预览克隆</button>{clonePreview && <small>复制 {clonePreview.copiedComponents} 个组件；排除 {clonePreview.excludedVersions} 个版本</small>}<button type="submit" disabled={clone.isPending}>{clone.isPending ? '正在克隆' : '创建克隆'}</button></form>
                  <form className="inline-form" onSubmit={(event) => { event.preventDefault(); move.mutate({ componentId: moveComponentId, parentComponentId: moveParentId || null, reason: moveReason }) }}><label>移动组件<select value={moveComponentId} onChange={(event) => setMoveComponentId(event.target.value)} required><option value="">请选择组件</option>{projectDetail.data.components.map((component) => <option key={component.id} value={component.id}>{component.code}</option>)}</select></label><label>新父组件<select value={moveParentId} onChange={(event) => setMoveParentId(event.target.value)}><option value="">设为根组件</option>{projectDetail.data.components.filter((component) => component.id !== moveComponentId).map((component) => <option key={component.id} value={component.id}>{component.code}</option>)}</select></label><label>移动原因<input value={moveReason} onChange={(event) => setMoveReason(event.target.value)} required /></label><button type="submit" disabled={move.isPending}>{move.isPending ? '正在移动' : '移动组件'}</button></form>
                  {currentUser.data?.roles.includes('Admin') && <form className="inline-form" onSubmit={(event) => { event.preventDefault(); assignMember.mutate() }}><label>项目成员<select value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)} required><option value="">请选择用户</option>{users.data?.map(user => <option key={user.id} value={user.id}>{user.displayName} · {user.userName ?? user.email ?? ''}</option>)}</select></label><label>项目角色<select value={memberRole} onChange={(event) => setMemberRole(event.target.value)}><option>Viewer</option><option>Engineer</option><option>SeniorEngineer</option></select></label><label>指派原因<input value={memberReason} onChange={(event) => setMemberReason(event.target.value)} required /></label><button type="submit" disabled={assignMember.isPending}>{assignMember.isPending ? '正在指派' : '指派项目成员'}</button></form>}
                </div>
                {(addComponent.isError || addVersion.isError || lifecycle.isError) && <p className="error-strip">{addComponent.error?.message ?? addVersion.error?.message ?? lifecycle.error?.message}</p>}
                {assignMember.isError && <p className="error-strip">{assignMember.error?.message}</p>}
                {currentUser.data?.roles.includes('Admin') && <div className="component-list">{projectMembers.data?.map(member => <article className="component-row" key={member.id}><div><strong>{member.displayName}</strong><span>{member.email}</span></div><small>{member.role} · {formatTime(member.assignedAt)}</small></article>)}</div>}
                <div className="component-list">{projectDetail.data.components.map((component) => <article className="component-row" key={component.id}><div><strong>{component.code}</strong><span>{component.name}</span></div><div className="version-tags">{component.versions.length ? component.versions.map((version) => <span key={version.id}>{version.versionNumber}<small>序列 {version.sequenceNo} · {version.maturity} · {version.safety}</small></span>) : <em>尚未登记版本</em>}</div></article>)}</div>
              </section></div>}
              {projectDetail.data && <ProjectWorkspace detail={projectDetail.data} onSuccess={setSuccessMessage} />}
              {projectDetail.data && currentUser.data?.roles.includes('Admin') && <section className="status-panel catalog-panel project-members-panel"><div className="panel-heading"><div><span className="section-index">项目权限</span><h3>项目成员</h3></div></div><form className="inline-form" onSubmit={(event) => { event.preventDefault(); assignMember.mutate() }}><label>项目成员<select value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)} required><option value="">请选择用户</option>{users.data?.map(user => <option key={user.id} value={user.id}>{user.displayName} · {user.userName ?? user.email ?? ''}</option>)}</select></label><label>项目角色<select value={memberRole} onChange={(event) => setMemberRole(event.target.value)}><option>Viewer</option><option>Engineer</option><option>SeniorEngineer</option></select></label><label>指派原因<input value={memberReason} onChange={(event) => setMemberReason(event.target.value)} required /></label><button type="submit" disabled={assignMember.isPending}>{assignMember.isPending ? '正在指派' : '指派项目成员'}</button></form>{assignMember.isError && <p className="error-strip">{assignMember.error?.message}</p>}<div className="component-list">{projectMembers.data?.map(member => <article className="component-row" key={member.id}><div><strong>{member.displayName}</strong><span>{member.email}</span></div><small>{member.role} · {formatTime(member.assignedAt)}</small></article>)}</div></section>}
            </>}

            {activePage === 'baselines' && <>
              {!currentUser.data && <section className="status-panel catalog-detail"><div className="panel-heading"><div><span className="section-index">身份验证</span><h3>登录后管理基线</h3></div></div><p className="empty-state">请先在“项目”页面登录。</p></section>}
              <section className="status-panel catalog-panel">
                <div className="panel-heading"><div><span className="section-index">Step 4A</span><h3>创建基线草稿</h3></div></div>
                <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); addBaseline.mutate({ projectId: baselineProjectId, seriesCode: baselineSeriesCode, code: baselineCode, description: baselineDescription, reason: baselineReason }) }}>
                  <label>所属项目<select value={baselineProjectId} onChange={(event) => setBaselineProjectId(event.target.value)} required><option value="">请选择项目</option>{projects.data?.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label>
                  <label>系列编码<input value={baselineSeriesCode} maxLength={80} placeholder="例如：LINE-A" onChange={(event) => setBaselineSeriesCode(event.target.value)} required /></label>
                  <label>基线编码<input value={baselineCode} maxLength={100} placeholder="例如：BL-001" onChange={(event) => setBaselineCode(event.target.value)} required /></label>
                  <label>说明<input value={baselineDescription} maxLength={2000} onChange={(event) => setBaselineDescription(event.target.value)} /></label>
                  <label className="wide-field">创建原因<input value={baselineReason} maxLength={500} onChange={(event) => setBaselineReason(event.target.value)} required /></label>
                  <button className="primary-action" type="submit" disabled={addBaseline.isPending || !currentUser.data}>{addBaseline.isPending ? '正在创建' : '创建草稿快照'}</button>
                </form>
                {addBaseline.isError && <p className="error-strip">{addBaseline.error.message}</p>}
              </section>
              <section className="status-panel catalog-panel">
                <div className="panel-heading"><div><span className="section-index">独立 Revision</span><h3>项目基线</h3></div><span className="count">{baselines.data?.length ?? 0}</span></div>
                {baselineProjectId === '' ? <p className="empty-state">选择项目后显示其基线草稿与发布版本。</p> : baselines.data?.length ? <div className="catalog-list">{baselines.data.map((baseline) => <article className="project-row" key={baseline.id}><span><strong>{baseline.code}</strong><small>{baseline.seriesCode} · Revision {baseline.revisionNo} · {baseline.itemCount} 个快照项</small></span>{baseline.state === 'Draft' ? <form className="inline-form" onSubmit={(event) => { event.preventDefault(); release.mutate({ baselineId: baseline.id, reason: releaseReason }) }}><label>发布原因<input value={releaseReason} maxLength={500} onChange={(event) => setReleaseReason(event.target.value)} required /></label><button type="submit" disabled={release.isPending}>{release.isPending ? '正在发布' : '发布基线'}</button></form> : <em>{baseline.state === 'Released' ? '已发布' : baseline.state}</em>}</article>)}</div> : <p className="empty-state">该项目尚未创建基线。</p>}
                {release.isError && <p className="error-strip">{release.error.message}</p>}
              </section>
              <section className="status-panel catalog-panel">
                <div className="panel-heading"><div><span className="section-index">冻结快照</span><h3>查看基线组件树</h3></div></div>
                <label>基线<select value={selectedBaselineId} onChange={(event) => { setSelectedBaselineId(event.target.value); setBaselineRequirementItemId('') }}><option value="">请选择基线</option>{baselines.data?.map((baseline) => <option key={baseline.id} value={baseline.id}>{baseline.code} · Revision {baseline.revisionNo}</option>)}</select></label>
                {baselineDetail.data?.baseline.state === 'Draft' && <form className="inline-form" onSubmit={(event) => { event.preventDefault(); baselineDetail.data?.review?.status === 'Pending' ? decideReview.mutate('approve') : requestReview.mutate() }}><label>评审原因<input value={reviewReason} maxLength={500} onChange={(event) => setReviewReason(event.target.value)} required /></label>{baselineDetail.data.review?.status === 'Pending' && currentUser.data?.roles.includes('Admin') ? <><button type="submit" disabled={decideReview.isPending}>{decideReview.isPending ? '正在处理' : '通过评审'}</button><button type="button" onClick={() => decideReview.mutate('reject')} disabled={decideReview.isPending}>驳回评审</button></> : baselineDetail.data.review?.status !== 'Approved' && <button type="submit" disabled={requestReview.isPending}>{requestReview.isPending ? '正在送审' : '提交评审'}</button>}</form>}
                {baselineDetail.data && <><p className="empty-state">{baselineDetail.data.baseline.seriesCode} · Revision {baselineDetail.data.baseline.revisionNo} · {baselineDetail.data.baseline.state === 'Released' ? '已发布且不可修改' : '草稿快照'}</p>{baselineDetail.data.baseline.state === 'Draft' && <form className="inline-form" onSubmit={(event) => { event.preventDefault(); setRequirement.mutate() }}><label>快照组件<select value={baselineRequirementItemId} onChange={(event) => { const item = baselineDetail.data?.items.find(candidate => candidate.id === event.target.value); setBaselineRequirementItemId(event.target.value); setBaselineRequirement(item?.requirement ?? 'Required') }} required><option value="">请选择组件</option>{baselineDetail.data.items.map((item) => <option key={item.id} value={item.id}>{item.componentCode} · {item.componentName}</option>)}</select></label><label>必需性<select value={baselineRequirement} onChange={(event) => setBaselineRequirement(event.target.value)}><option value="Required">必需</option><option value="Optional">可选</option></select></label><label>修改原因<input value={baselineRequirementReason} maxLength={500} onChange={(event) => setBaselineRequirementReason(event.target.value)} required /></label><button type="submit" disabled={setRequirement.isPending || baselineRequirementItemId === ''}>{setRequirement.isPending ? '正在更新' : '更新必需性'}</button></form>}<div className="component-list">{baselineDetail.data.items.map((item) => <article className="component-row" key={item.id}><div><strong>{item.componentCode}</strong><span>{item.componentName} · {item.lineageKey}</span></div><small>版本 {item.versionNumber} · {item.requirement === 'Optional' ? '可选' : '必需'}</small></article>)}</div></>}
                {baselineDetail.isError && <p className="error-strip">{baselineDetail.error.message}</p>}
                {setRequirement.isError && <p className="error-strip">{setRequirement.error.message}</p>}
              </section>
              <section className="status-panel catalog-panel">
                <div className="panel-heading"><div><span className="section-index">项目标准</span><h3>当前推荐基线</h3></div></div>
                <p className="empty-state">{standard.data ? `当前标准：${standard.data.baselineCode}。它只提供项目级推荐，不会自动改写任何机台的实际目标。` : '尚未设置项目标准。设置后仅作为项目级推荐，不会自动修改机台目标。'}</p>
                <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); assignStandard.mutate({ projectId: baselineProjectId, baselineId: standardBaselineId, reason: standardReason }) }}>
                  <label>已发布基线<select value={standardBaselineId} onChange={(event) => setStandardBaselineId(event.target.value)} required><option value="">请选择基线</option>{baselines.data?.filter((baseline) => baseline.state === 'Released').map((baseline) => <option key={baseline.id} value={baseline.id}>{baseline.code} · Revision {baseline.revisionNo}</option>)}</select></label>
                  <label>设置原因<input value={standardReason} maxLength={500} onChange={(event) => setStandardReason(event.target.value)} required /></label>
                  <button type="submit" disabled={assignStandard.isPending || baselineProjectId === ''}>{assignStandard.isPending ? '正在设置' : '设为项目标准'}</button>
                </form>
                {assignStandard.isError && <p className="error-strip">{assignStandard.error.message}</p>}
              </section>
            </>}

            {activePage === 'software' && <section className="status-panel catalog-panel">
              <div className="panel-heading"><div><span className="section-index">软件版本</span><h3>登记与影响追溯</h3></div></div>
              <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); addVersion.mutate({ componentId: versionComponentId, number: versionNumber, reason: versionReason }) }}><label>所属项目<select value={selectedProjectId ?? ''} onChange={(event) => { setSelectedProjectId(event.target.value || null); setVersionComponentId(''); setImpactVersionId('') }} required><option value="">请选择项目</option>{projects.data?.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label><label>目标组件<select value={versionComponentId} onChange={(event) => setVersionComponentId(event.target.value)} disabled={!selectedProjectId || projectDetail.isLoading} required><option value="">{selectedProjectId ? '请选择组件' : '请先选择项目'}</option>{projectDetail.data?.components.map((component) => <option key={component.id} value={component.id}>{component.code} · {component.name}</option>)}</select></label><label>版本号<input value={versionNumber} placeholder="例如：2026.08.29" onChange={(event) => setVersionNumber(event.target.value)} required /></label><label>创建原因<input value={versionReason} onChange={(event) => setVersionReason(event.target.value)} required /></label><button className="primary-action" type="submit" disabled={addVersion.isPending || versionComponentId === ''}>{addVersion.isPending ? '正在登记' : '登记版本'}</button></form>
              {!selectedProjectId && <p className="empty-state">请选择项目后登记或查看软件版本。</p>}{addVersion.isError && <p className="error-strip">{addVersion.error.message}</p>}
              <div className="panel-heading"><div><span className="section-index">版本影响</span><h3>追溯版本使用范围</h3></div></div>
              <label>项目版本<select value={impactVersionId} onChange={(event) => setImpactVersionId(event.target.value)} disabled={!selectedProjectId || projectDetail.isLoading}><option value="">{selectedProjectId ? '请选择版本' : '请先选择项目'}</option>{projectDetail.data?.components.flatMap((component) => component.versions.map((version) => <option key={version.id} value={version.id}>{component.code} · {version.versionNumber}</option>))}</select></label>
              {impactVersionId && <><dl className="runtime-list"><div><dt>组件</dt><dd>{versionDetail.data?.version.componentCode ?? '—'}</dd></div><div><dt>序列</dt><dd>{versionDetail.data?.version.sequenceNo ?? '—'}</dd></div><div><dt>成熟度</dt><dd>{maturityText[versionDetail.data?.version.maturity ?? ''] ?? '—'}</dd></div><div><dt>安全状态</dt><dd>{safetyText[versionDetail.data?.version.safety ?? ''] ?? '—'}</dd></div><div><dt>推荐</dt><dd>{versionDetail.data?.recommended ? '是' : '否'}</dd></div></dl><dl className="runtime-list"><div><dt>已使用基线</dt><dd>{versionImpact.data?.usedBaselineIds.length ?? 0}</dd></div><div><dt>当前机台</dt><dd>{versionImpact.data?.currentMachineIds.length ?? 0}</dd></div><div><dt>目标机台</dt><dd>{versionImpact.data?.targetMachineIds.length ?? 0}</dd></div><div><dt>历史机台</dt><dd>{versionImpact.data?.historicalMachineIds.length ?? 0}</dd></div></dl><div className="component-list">{versionExposure.data?.map(snapshot => <article className="component-row" key={snapshot.id}><div><strong>阻断时影响快照</strong><span>当前 {snapshot.currentMachineCount} · 目标 {snapshot.targetMachineCount} · 历史 {snapshot.historicalMachineCount} · 基线 {snapshot.baselineCount}</span></div><small>{formatTime(snapshot.blockedAt)}<br />{snapshot.blockedBy} · {snapshot.reason}</small></article>)}{versionDetail.data?.transitions.map((item, index) => <article className="component-row" key={`${item.occurredAt}-${index}`}><div><strong>{lifecycleAxisText[item.axis] ?? item.axis}</strong><span>{maturityText[item.fromState] ?? safetyText[item.fromState] ?? item.fromState} → {maturityText[item.toState] ?? safetyText[item.toState] ?? item.toState} · {item.reason}</span></div><small>{item.actor} · {formatTime(item.occurredAt)}</small></article>)}{versionImpact.data?.recentFacts.map((fact, index) => <article className="component-row" key={`${fact.machineId}-${index}`}><div><strong>{operationText[fact.operationType] ?? fact.operationType}</strong><span>已有一条关联机台事实</span></div><small>{formatTime(fact.effectiveAt)}</small></article>)}</div></>}</section>}

            {activePage === 'search' && <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">全局搜索</span><h3>项目、组件、版本、基线和机台</h3></div></div><label>搜索词<input value={searchTerm} minLength={2} onChange={(event) => setSearchTerm(event.target.value)} placeholder="至少输入两个字符" /></label>{searchTerm.trim().length >= 2 && <div className="catalog-list">{catalogSearch.data?.map((item) => <button type="button" className="component-row" key={`${item.type}-${item.id}`} onClick={() => { if (item.type === 'Project' || item.type === 'Component' || item.type === 'Version') { setSelectedProjectId(item.projectId); setActivePage('projects') } else if (item.type === 'Baseline') { setBaselineProjectId(item.projectId); setSelectedBaselineId(item.id); setActivePage('baselines') } else { setSelectedMachineId(item.id); setActivePage('machines') } }}><div><strong>{item.label}</strong><span>{item.type === 'Project' ? '项目' : item.type === 'Component' ? '组件' : item.type === 'Version' ? '版本' : item.type === 'Baseline' ? '基线' : '机台'}</span></div><small>打开</small></button>)}</div>}{catalogSearch.isError && <p className="error-strip">{catalogSearch.error.message}</p>}</section>}

            {activePage === 'compare' && <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">基线比对</span><h3>快照差异</h3></div></div><div className="catalog-form"><label>所属项目<select value={compareProjectId} onChange={(event) => { setCompareProjectId(event.target.value); setLeftBaselineId(''); setRightBaselineId('') }}><option value="">请选择项目</option>{projects.data?.map(project => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label><label>左侧基线<select value={leftBaselineId} onChange={(event) => setLeftBaselineId(event.target.value)}><option value="">请选择基线</option>{compareProjectBaselines.data?.map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.code} · Rev {baseline.revisionNo}</option>)}</select></label><label>右侧基线<select value={rightBaselineId} onChange={(event) => setRightBaselineId(event.target.value)}><option value="">请选择基线</option>{compareProjectBaselines.data?.map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.code} · Rev {baseline.revisionNo}</option>)}</select></label></div>{baselineComparison.data && <div className="component-list">{baselineComparison.data.items.map(item => <article className="component-row" key={item.componentId}><div><strong>{item.status === 'Same' ? '相同' : item.status === 'Changed' ? '已变化' : item.status === 'Added' ? '新增' : '已移除'}</strong><span>{item.componentCode} · {item.componentName}</span></div><small>{item.leftVersionNumber ?? '无'} → {item.rightVersionNumber ?? '无'}</small></article>)}</div>}{baselineComparison.isError && <p className="error-strip">{baselineComparison.error.message}</p>}</section>}
            {activePage === 'compare' && <MachineComparePanel />}

            {activePage === 'deployments' && <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">事实历史</span><h3>部署与观察记录</h3></div></div><label>机台<select value={selectedMachineId} onChange={(event) => setSelectedMachineId(event.target.value)}><option value="">请选择机台</option>{machines.data?.map(machine => <option key={machine.id} value={machine.id}>{machine.serialNumber} · {machine.name}</option>)}</select></label>{selectedMachineId && <><p className="empty-state">观察表示在该时间发现的实际状态，并不表示发生了软件安装或升级。</p><div className="component-list">{machineFacts.data?.map(fact => <article className="component-row" key={fact.id}><div><strong>{operationText[fact.operationType] ?? fact.operationType}</strong><span>{fact.coverage === 'Full' ? '完整覆盖（未列组件会标记为缺失）' : '局部覆盖（仅更新列出的组件）'} · {sourceText[fact.sourceType] ?? '外部来源'} · {fact.itemCount} 项</span></div><small>记录 {formatTime(fact.recordedAt)}<br />生效 {formatTime(fact.effectiveAt)}</small></article>)}</div></>}</section>}

            {activePage === 'imports' && <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">导入预览</span><h3>先校验，再提交</h3></div></div><form className="catalog-form" onSubmit={(event) => { event.preventDefault(); stageImportMutation.mutate() }}><label>所属项目<select value={importProjectId} onChange={(event) => setImportProjectId(event.target.value)} required><option value="">请选择项目</option>{projects.data?.map(project => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label><label className="wide-field">每行：组件编码,版本号<textarea value={importRows} onChange={(event) => setImportRows(event.target.value)} required /></label><label className="wide-field">导入原因<input value={importReason} onChange={(event) => setImportReason(event.target.value)} required /></label><button type="submit" disabled={stageImportMutation.isPending}>{stageImportMutation.isPending ? '正在校验' : '生成预览'}</button></form>{stageImportMutation.isError && <p className="error-strip">{stageImportMutation.error.message}</p>}{importPreview.data && <div className="component-list">{importPreview.data.rows.map(row => <article className="component-row" key={row.rowNumber}><div><strong>第 {row.rowNumber} 行</strong><span>{row.payload.componentCode} · {row.payload.versionNumber}</span></div><small>{row.validationError ?? '校验通过，尚未提交'}</small></article>)}</div>}{importPreview.data?.status === 'Validated' && !importPreview.data.rows.some(row => row.validationError) && <button type="button" className="primary-action" onClick={() => commitImportMutation.mutate()} disabled={commitImportMutation.isPending}>{commitImportMutation.isPending ? '正在提交' : '提交导入'}</button>}{commitImportMutation.isError && <p className="error-strip">{commitImportMutation.error.message}</p>}</section>}

            {activePage === 'users' && <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">身份管理</span><h3>用户与角色</h3></div><span className="count">{users.data?.length ?? 0}</span></div>{currentUser.data?.roles.includes('Admin') ? <><form className="catalog-form" onSubmit={(event) => { event.preventDefault(); addUser.mutate({ userName: newUserEmail, displayName: newUserName, password: newUserPassword, role: newUserRole, reason: newUserReason }) }}><label>用户名<input value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} required /></label><label>显示名<input value={newUserName} onChange={(event) => setNewUserName(event.target.value)} required /></label><label>初始密码<input type="password" minLength={6} value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} required /></label><label>角色<select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value)}><option>Viewer</option><option>Engineer</option><option>SeniorEngineer</option><option>Admin</option></select></label><label className="wide-field">创建原因<input value={newUserReason} onChange={(event) => setNewUserReason(event.target.value)} required /></label><button type="submit" disabled={addUser.isPending}>{addUser.isPending ? '正在创建' : '创建用户'}</button></form><form className="catalog-form" onSubmit={(event) => { event.preventDefault(); updateUserRole.mutate() }}><label>用户<select value={roleUserId} onChange={(event) => setRoleUserId(event.target.value)} required><option value="">请选择用户</option>{users.data?.map(user => <option key={user.id} value={user.id}>{user.displayName} · {user.userName ?? user.email ?? ''}</option>)}</select></label><label>新角色<select value={roleValue} onChange={(event) => setRoleValue(event.target.value)}><option>Viewer</option><option>Engineer</option><option>SeniorEngineer</option><option>Admin</option></select></label><label>变更原因<input value={roleReason} onChange={(event) => setRoleReason(event.target.value)} required /></label><button type="submit" disabled={updateUserRole.isPending}>{updateUserRole.isPending ? '正在变更' : '变更角色'}</button></form>{(addUser.isError || updateUserRole.isError) && <p className="error-strip">{addUser.error?.message ?? updateUserRole.error?.message}</p>}<div className="catalog-list">{users.data?.map(user => <article className="component-row" key={user.id}><div><strong>{user.displayName}</strong><span>{user.userName ?? user.email ?? ''}</span></div><small>{user.roles.join('、') || '未分配角色'}</small></article>)}</div></> : <p className="empty-state">仅管理员可查看用户与角色。</p>}{users.isError && <p className="error-strip">{users.error.message}</p>}</section>}

            {activePage === 'machines' && <>
              {selectedMachine && <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">目标基线</span><h3>{selectedMachine.serialNumber} 的当前目标</h3></div></div><p className="empty-state">{machineTarget.data ? `${machineTarget.data.baselineCode} · 自 ${formatTime(machineTarget.data.validFrom)} 起生效` : '尚未显式指派目标基线。'}</p>{machineTargetHistory.data?.length ? <div className="component-list">{machineTargetHistory.data.map((assignment) => <article className="component-row" key={assignment.id}><div><strong>{assignment.baselineCode}</strong><span>{assignment.reason}</span></div><small>{formatTime(assignment.validFrom)}<br />{assignment.validTo ? `结束 ${formatTime(assignment.validTo)}` : '当前目标'}</small></article>)}</div> : null}</section>}
              <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">机台登记</span><h3>创建机台</h3></div></div><form className="catalog-form" onSubmit={(event) => { event.preventDefault(); addMachine.mutate({ projectId: machineProjectId, serialNumber: machineSerial, name: machineName, machineType, reason: machineReason }) }}><label>所属项目<select value={machineProjectId} onChange={(event) => setMachineProjectId(event.target.value)} required><option value="">请选择项目</option>{projects.data?.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label><label>序列号<input value={machineSerial} onChange={(event) => setMachineSerial(event.target.value)} required /></label><label>机台名称<input value={machineName} onChange={(event) => setMachineName(event.target.value)} required /></label><label>机型<input value={machineType} onChange={(event) => setMachineType(event.target.value)} /></label><label className="wide-field">创建原因<input value={machineReason} onChange={(event) => setMachineReason(event.target.value)} required /></label><button className="primary-action" type="submit" disabled={addMachine.isPending}>{addMachine.isPending ? '正在创建' : '创建机台'}</button></form>{addMachine.isError && <p className="error-strip">{addMachine.error.message}</p>}</section>
              <section className="status-panel catalog-panel">
                <div className="panel-heading"><div><span className="section-index">机台列表</span><h3>当前实际配置</h3></div><span className="count">{machines.data?.length ?? 0}</span></div>
                <div className="catalog-list">{machines.data?.map((machine) => <button type="button" className={machine.id === selectedMachineId ? 'project-row selected' : 'project-row'} key={machine.id} onClick={() => { setSelectedMachineId(machine.id); setFactComponentId(''); setFactVersionId('') }}><span><strong>{machine.serialNumber}</strong><small>{machine.name}{machine.machineType ? ` · ${machine.machineType}` : ''} · 匹配 {matchText[machine.matchStatus ?? 'Unknown']} · 风险 {riskText[machine.riskSeverity ?? 'Unknown']}</small></span><em>{machine.status === 'Active' ? '在用' : '归档'}</em></button>)}</div>
                {selectedMachineId && <>
                  <dl className="runtime-list"><div><dt>配置匹配</dt><dd>{matchText[machineDrift.data?.matchStatus ?? 'Unknown']}</dd></div><div><dt>风险等级</dt><dd>{riskText[machineDrift.data?.riskSeverity ?? 'Unknown']}</dd></div></dl>
                  <p className="empty-state">配置匹配只判断版本是否一致；风险等级独立反映已阻断版本，因此“匹配 + 严重风险”是可能且需要处理的组合。</p>
                  <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); assignTarget.mutate() }}><label>机台目标基线<select value={targetBaselineId} onChange={(event) => setTargetBaselineId(event.target.value)} required><option value="">请选择已发布基线</option>{targetBaselines.data?.filter(baseline => baseline.state === 'Released').map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.code} · Revision {baseline.revisionNo}</option>)}</select></label><label>指派原因<input value={targetReason} onChange={(event) => setTargetReason(event.target.value)} required /></label><button type="submit" disabled={assignTarget.isPending}>{assignTarget.isPending ? '正在指派' : '设为该机台目标'}</button></form>
                  <p className="empty-state">这是该机台的实际目标，不会随项目当前标准自动改变；项目标准仅用于推荐和默认选择。</p>
                  {assignTarget.isError && <p className="error-strip">{assignTarget.error.message}</p>}
                  <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); recordFacts.mutate({ machineId: selectedMachineId, componentId: factComponentId, versionId: factVersionId, coverage: factCoverage, reason: factReason }) }}><label>组件<select value={factComponentId} onChange={(event) => { setFactComponentId(event.target.value); setFactVersionId('') }} required><option value="">请选择组件</option>{machineProjectDetail.data?.components.map(component => <option key={component.id} value={component.id}>{component.code} · {component.name}</option>)}</select></label><label>版本<select value={factVersionId} onChange={(event) => setFactVersionId(event.target.value)} disabled={!selectedFactComponent} required><option value="">{selectedFactComponent ? '请选择版本' : '请先选择组件'}</option>{selectedFactComponent?.versions.map(version => <option key={version.id} value={version.id}>{version.versionNumber} · 序列 {version.sequenceNo}</option>)}</select></label><label>覆盖范围<select value={factCoverage} onChange={(event) => setFactCoverage(event.target.value)}><option value="Partial">局部观察</option><option value="Full">完整观察</option></select></label><label>观察原因<input value={factReason} onChange={(event) => setFactReason(event.target.value)} required /></label><button type="submit" disabled={recordFacts.isPending || machineProjectDetail.isLoading}>{recordFacts.isPending ? '正在记录' : '记录实际配置'}</button></form>
                  <p className="empty-state">观察只记录发现的实际状态，不代表软件安装或升级。局部观察只更新所选组件；完整观察会将未列出的项目组件标记为缺失。</p>
                  {recordFacts.isError && <p className="error-strip">{recordFacts.error.message}</p>}
                  <div className="component-list">{machineConfiguration.data?.map((item) => <article className="component-row" key={item.componentId}><div><strong>{item.state === 'Present' ? '存在' : '缺失'}</strong><span>{item.componentCode} · {item.componentName}</span></div><div className="version-tags"><span>{item.versionNumber ?? '无版本'}<small>状态生效 {formatTime(item.stateEffectiveAt)}<br />已知安装 {formatTime(item.knownInstalledAt)}</small></span></div></article>)}</div>
                </>}
              </section>
            </>}
          </div>
        ) : (
          <section className="pending-page"><span className="section-index">后续垂直切片</span><h2>{selectedNavigation.label}尚未实现</h2><p>当前版本只完成了运行基础设施和后台任务链路。{selectedNavigation.label}将在核心领域模型与对应 API 落地后开放，现阶段不会提供无法保存或追溯的占位操作。</p><button className="primary-action" type="button" onClick={() => setActivePage('overview')}>返回运行总览</button></section>
        )}
        {activePage === 'machines' && selectedMachine && <RollbackFactPanel machineId={selectedMachine.id} components={machineProjectDetail.data?.components ?? []} />}
        {activePage === 'machines' && selectedMachine && <HistoricalConfigurationPanel machine={selectedMachine} />}
        {activePage === 'machines' && projects.data && <BulkTargetPanel projects={projects.data} />}
        {activePage === 'deployments' && projects.data && <BulkFactPanel projects={projects.data} />}
      </main>
    </div>
  )
}

export default App
