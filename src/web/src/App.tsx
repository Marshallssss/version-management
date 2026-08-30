import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { assignMachineTarget, assignProjectMember, assignProjectStandard, changeUserRole, changeVersionMaturity, changeVersionSafety, cloneProject, commitImport, compareBaselines, createBaseline, createComponent, createComponentVersion, createMachine, createProject, createUser, getBaselines, getCurrentUser, getDashboard, getImportPreview, getMachineConfiguration, getMachineDrift, getMachineFacts, getMachines, getProject, getProjectMembers, getProjectStandard, getProjects, getUsers, getVersionDetail, getVersionImpact, login, logout, moveComponent, recommendVersion, recordMachineFacts, releaseBaseline, searchCatalog, stageImport } from './catalog-api'
import { enqueueNoopJob, getSystemStatus, getSystemVersion, type BackgroundJobStatus } from './system-api'

const navigation = [
  { id: 'overview', label: '运行总览', available: true },
  { id: 'jobs', label: '后台任务', available: true },
  { id: 'projects', label: '项目', available: true },
  { id: 'baselines', label: '基线', available: true },
  { id: 'software', label: '软件版本', available: true },
  { id: 'machines', label: '机台', available: true },
  { id: 'deployments', label: '部署记录', available: true },
  { id: 'compare', label: '配置比对', available: true },
  { id: 'search', label: '搜索', available: true },
  { id: 'imports', label: '导入', available: true },
  { id: 'users', label: '用户与角色', available: true },
]

const statusText: Record<BackgroundJobStatus, string> = {
  Pending: '等待执行',
  Processing: '执行中',
  Completed: '已完成',
  Failed: '失败',
}

const connectivityText = { online: '已连接', offline: '未连接', checking: '检测中' }
const jobTypeText: Record<string, string> = {
  'system.noop': '连通性任务',
}

function formatTime(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '—'
}

function App() {
  const [activePage, setActivePage] = useState('overview')
  const [note, setNote] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectCode, setProjectCode] = useState('')
  const [projectName, setProjectName] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [projectReason, setProjectReason] = useState('')
  const [email, setEmail] = useState('')
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
  const status = useQuery({ queryKey: ['system-status'], queryFn: getSystemStatus, refetchInterval: 5_000 })
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard, refetchInterval: 5_000 })
  const projects = useQuery({ queryKey: ['projects'], queryFn: getProjects })
  const currentUser = useQuery({ queryKey: ['current-user'], queryFn: getCurrentUser, retry: false })
  const users = useQuery({ queryKey: ['users'], queryFn: getUsers, enabled: currentUser.data?.roles.includes('Admin') === true })
  const addUser = useMutation({ mutationFn: createUser, onSuccess: async () => { setNewUserEmail(''); setNewUserName(''); setNewUserPassword(''); setNewUserReason(''); await queryClient.invalidateQueries({ queryKey: ['users'] }) } })
  const updateUserRole = useMutation({ mutationFn: () => changeUserRole(roleUserId, { role: roleValue, reason: roleReason }), onSuccess: async () => { setRoleReason(''); await queryClient.invalidateQueries({ queryKey: ['users'] }) } })
  const projectDetail = useQuery({ queryKey: ['project', selectedProjectId], queryFn: () => getProject(selectedProjectId!), enabled: selectedProjectId !== null })
  const projectMembers = useQuery({ queryKey: ['project-members', selectedProjectId], queryFn: () => getProjectMembers(selectedProjectId!), enabled: selectedProjectId !== null && currentUser.data?.roles.includes('Admin') === true })
  const baselines = useQuery({ queryKey: ['baselines', baselineProjectId], queryFn: () => getBaselines(baselineProjectId), enabled: baselineProjectId !== '' })
  const standard = useQuery({ queryKey: ['project-standard', baselineProjectId], queryFn: () => getProjectStandard(baselineProjectId), enabled: baselineProjectId !== '' })
  const machines = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const selectedMachine = machines.data?.find(machine => machine.id === selectedMachineId)
  const targetBaselines = useQuery({ queryKey: ['machine-target-baselines', selectedMachine?.projectId], queryFn: () => getBaselines(selectedMachine!.projectId), enabled: selectedMachine !== undefined })
  const machineConfiguration = useQuery({ queryKey: ['machine-configuration', selectedMachineId], queryFn: () => getMachineConfiguration(selectedMachineId), enabled: selectedMachineId !== '' })
  const machineFacts = useQuery({ queryKey: ['machine-facts', selectedMachineId], queryFn: () => getMachineFacts(selectedMachineId), enabled: selectedMachineId !== '' })
  const machineDrift = useQuery({ queryKey: ['machine-drift', selectedMachineId], queryFn: () => getMachineDrift(selectedMachineId), enabled: selectedMachineId !== '' })
  const versionImpact = useQuery({ queryKey: ['version-impact', impactVersionId], queryFn: () => getVersionImpact(impactVersionId), enabled: impactVersionId !== '' })
  const versionDetail = useQuery({ queryKey: ['version-detail', impactVersionId], queryFn: () => getVersionDetail(impactVersionId), enabled: impactVersionId !== '' })
  const catalogSearch = useQuery({ queryKey: ['catalog-search', searchTerm], queryFn: () => searchCatalog(searchTerm), enabled: searchTerm.trim().length >= 2 })
  const compareProjectBaselines = useQuery({ queryKey: ['compare-baselines', compareProjectId], queryFn: () => getBaselines(compareProjectId), enabled: compareProjectId !== '' })
  const baselineComparison = useQuery({ queryKey: ['baseline-comparison', leftBaselineId, rightBaselineId], queryFn: () => compareBaselines(leftBaselineId, rightBaselineId), enabled: leftBaselineId !== '' && rightBaselineId !== '' && leftBaselineId !== rightBaselineId })
  const importPreview = useQuery({ queryKey: ['import-preview', importBatchId], queryFn: () => getImportPreview(importBatchId), enabled: importBatchId !== '' })
  const enqueue = useMutation({
    mutationFn: enqueueNoopJob,
    onSuccess: async () => {
      setNote('')
      await queryClient.invalidateQueries({ queryKey: ['system-status'] })
    },
  })
  const addProject = useMutation({
    mutationFn: createProject,
    onSuccess: async ({ id }) => {
      setProjectCode('')
      setProjectName('')
      setProjectDescription('')
      setProjectReason('')
      setSelectedProjectId(id)
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
  const stageImportMutation = useMutation({ mutationFn: () => stageImport({ projectId: importProjectId, sourceFileName: '手工预览.csv', reason: importReason, rows: importRows.split(/\r?\n/).filter(Boolean).map(line => { const [componentCode = '', versionNumber = ''] = line.split(','); return { componentCode: componentCode.trim(), versionNumber: versionNumber.trim() } }) }), onSuccess: ({ id }) => setImportBatchId(id) })
  const assignTarget = useMutation({ mutationFn: () => assignMachineTarget(selectedMachineId, targetBaselineId, targetReason), onSuccess: async () => { setTargetBaselineId(''); setTargetReason(''); await queryClient.invalidateQueries({ queryKey: ['machines'] }); await queryClient.invalidateQueries({ queryKey: ['machine-drift', selectedMachineId] }) } })
  const commitImportMutation = useMutation({ mutationFn: () => commitImport(importBatchId), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['import-preview', importBatchId] }); await queryClient.invalidateQueries({ queryKey: ['project', selectedProjectId] }) } })
  const signIn = useMutation({ mutationFn: login, onSuccess: async () => { setPassword(''); await queryClient.invalidateQueries({ queryKey: ['current-user'] }) } })
  const signOut = useMutation({ mutationFn: logout, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['current-user'] }); setSelectedProjectId(null) } })
  const addComponent = useMutation({
    mutationFn: ({ projectId, code, name, reason, parentComponentId }: { projectId: string; code: string; name: string; reason: string; parentComponentId: string | null }) => createComponent(projectId, { code, name, parentComponentId, reason }),
    onSuccess: async () => {
      setComponentCode('')
      setComponentName('')
      setComponentReason('')
      setComponentParentId('')
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
  const assignStandard = useMutation({ mutationFn: ({ projectId, baselineId, reason }: { projectId: string; baselineId: string; reason: string }) => assignProjectStandard(projectId, baselineId, reason), onSuccess: async () => { setStandardReason(''); await queryClient.invalidateQueries({ queryKey: ['project-standard', baselineProjectId] }) } })
  const addMachine = useMutation({ mutationFn: createMachine, onSuccess: async () => { setMachineSerial(''); setMachineName(''); setMachineType(''); setMachineReason(''); await queryClient.invalidateQueries({ queryKey: ['machines'] }) } })
  const recordFacts = useMutation({ mutationFn: ({ machineId, componentId, versionId, coverage, reason }: { machineId: string; componentId: string; versionId: string; coverage: string; reason: string }) => recordMachineFacts(machineId, { operationType: 'Observation', coverage, sourceType: 'manual-ui', reason, items: [{ componentId, versionId, absent: false, knownInstalledAt: null }] }), onSuccess: async () => { setFactReason(''); await queryClient.invalidateQueries({ queryKey: ['machine-configuration', selectedMachineId] }) } })

  const connectivity = system.isSuccess ? 'online' : system.isError ? 'offline' : 'checking'
  const selectedNavigation = navigation.find((item) => item.id === activePage) ?? navigation[0]
  const queueCount = (jobStatus: BackgroundJobStatus) => status.data?.queue.find((item) => item.status === jobStatus)?.count ?? 0

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand-block">
          <span className="brand-mark">CH</span>
          <div><strong>ConfigHub</strong><small>工程配置管理</small></div>
        </div>
        <nav aria-label="主导航">
          {navigation.map((item, index) => (
            <button className={item.id === activePage ? 'nav-item active' : 'nav-item'} key={item.id} type="button" onClick={() => setActivePage(item.id)}>
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

        {selectedNavigation.available ? (
          <div className="content-grid">
            {activePage === 'overview' && <>
              <section className="hero-panel">
                <div className="hero-copy">
                  <span className="section-index">本机基础设施</span>
                  <h2>系统已经就绪</h2>
                  <p>Host、PostgreSQL 和后台 Worker 正在运行。你可以提交连通性任务，确认任务会进入真实队列并由 Worker 完成处理。</p>
                  <button className="primary-action" type="button" onClick={() => setActivePage('jobs')}>打开后台任务</button>
                </div>
                <div className="topology" aria-label="当前运行拓扑">
                  <div className="topology-node primary">ConfigHub 服务端</div><div className="topology-line" />
                  <div className="topology-row"><div className="topology-node">React 界面</div><div className="topology-node">API v1</div></div><div className="topology-line" />
                  <div className="topology-row"><div className="topology-node">PostgreSQL</div><div className="topology-node">后台 Worker</div></div>
                </div>
              </section>
              <section className="status-panel">
                <div className="panel-heading"><div><span className="section-index">实时运行信息</span><h3>服务身份</h3></div><button type="button" onClick={() => void system.refetch()} disabled={system.isFetching}>{system.isFetching ? '正在刷新' : '刷新'}</button></div>
                <dl className="runtime-list"><div><dt>产品</dt><dd>{system.data?.product ?? '—'}</dd></div><div><dt>版本</dt><dd>{system.data?.version ?? '—'}</dd></div><div><dt>接口版本</dt><dd>{system.data?.apiVersion ?? '—'}</dd></div><div><dt>服务时间</dt><dd>{formatTime(status.data?.serverTime)}</dd></div></dl>
              </section>
              <section className="status-panel">
                <div className="panel-heading"><div><span className="section-index">配置总览</span><h3>机台配置状态</h3></div><span className="count">{dashboard.data?.machineCount ?? 0}</span></div>
                <dl className="runtime-list"><div><dt>机台总数</dt><dd>{dashboard.data?.machineCount ?? '—'}</dd></div><div><dt>配置匹配</dt><dd>{dashboard.data?.matchedCount ?? '—'}</dd></div><div><dt>配置不匹配</dt><dd>{dashboard.data?.mismatchCount ?? '—'}</dd></div><div><dt>状态未知</dt><dd>{dashboard.data?.unknownCount ?? '—'}</dd></div><div><dt>严重风险</dt><dd>{dashboard.data?.criticalRiskCount ?? '—'}</dd></div></dl>
              </section>
              <section className="telemetry-panel queue-panel">
                <div className="panel-heading"><div><span className="section-index">队列概览</span><h3>后台任务</h3></div><span className="count">{status.data?.jobs.length ?? 0}</span></div>
                <div className="queue-summary"><div><span>等待执行</span><b>{queueCount('Pending')}</b></div><div><span>执行中</span><b>{queueCount('Processing')}</b></div><div><span>已完成</span><b>{queueCount('Completed')}</b></div><div><span>失败</span><b>{queueCount('Failed')}</b></div></div>
              </section>
            </>}

            {activePage === 'jobs' && <>
              <section className="hero-panel job-submit-panel">
                <div className="hero-copy"><span className="section-index">真实队列操作</span><h2>提交连通性任务</h2><p>任务会写入 PostgreSQL，由正在运行的 Worker 领取并完成。可用于验证后台处理链路。</p></div>
                <div className="job-form">
                  <label htmlFor="job-note">任务说明</label>
                  <textarea id="job-note" value={note} maxLength={500} placeholder="例如：验证本机 Worker 连通性" onChange={(event) => setNote(event.target.value)} />
                  <button className="primary-action" type="button" onClick={() => enqueue.mutate(note)} disabled={enqueue.isPending}>{enqueue.isPending ? '正在提交' : '提交任务'}</button>
                  {enqueue.isSuccess && <p className="success-strip">任务已提交，Worker 通常会在几秒内完成。</p>}
                  {enqueue.isError && <p className="error-strip">{enqueue.error.message}</p>}
                </div>
              </section>
              <section className="status-panel jobs-panel">
                <div className="panel-heading"><div><span className="section-index">最近任务</span><h3>执行记录</h3></div><button type="button" onClick={() => void status.refetch()} disabled={status.isFetching}>{status.isFetching ? '正在刷新' : '刷新'}</button></div>
                {status.data?.jobs.length ? <div className="job-list">{status.data.jobs.map((job) => <article className="job-row" key={job.id}><div><strong>{jobTypeText[job.jobType] ?? job.jobType}</strong><span>{formatTime(job.createdAt)}</span></div><span className={`job-state ${job.status.toLowerCase()}`}>{statusText[job.status]}</span><small>第 {job.attempts} 次</small>{job.lastError && <p>{job.lastError}</p>}</article>)}</div> : <p className="empty-state">还没有任务记录。提交一条连通性任务即可开始验证。</p>}
              </section>
            </>}

            {activePage === 'projects' && <>
              {!currentUser.data && <section className="status-panel catalog-detail"><div className="panel-heading"><div><span className="section-index">身份验证</span><h3>登录后管理项目</h3></div></div><form className="catalog-form" onSubmit={(event) => { event.preventDefault(); signIn.mutate({ email, password }) }}><label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="primary-action" type="submit" disabled={signIn.isPending}>{signIn.isPending ? '正在登录' : '登录'}</button></form>{signIn.isError && <p className="error-strip">登录失败，请检查凭据。</p>}</section>}
              {currentUser.data && <section className="status-panel catalog-detail"><div className="panel-heading"><div><span className="section-index">当前身份</span><h3>{currentUser.data.name}</h3></div><button type="button" onClick={() => signOut.mutate()} disabled={signOut.isPending}>退出登录</button></div></section>}
              <section className="status-panel catalog-panel">
                <div className="panel-heading"><div><span className="section-index">项目目录</span><h3>创建项目</h3></div></div>
                <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); addProject.mutate({ code: projectCode, name: projectName, description: projectDescription, reason: projectReason }) }}>
                  <label>项目编码<input value={projectCode} maxLength={50} placeholder="例如：LINE-A" onChange={(event) => setProjectCode(event.target.value)} required /></label>
                  <label>项目名称<input value={projectName} maxLength={200} placeholder="例如：产线 A 配置" onChange={(event) => setProjectName(event.target.value)} required /></label>
                  <label className="wide-field">说明<textarea value={projectDescription} maxLength={2000} onChange={(event) => setProjectDescription(event.target.value)} /></label>
                  <label className="wide-field">创建原因<input value={projectReason} maxLength={500} onChange={(event) => setProjectReason(event.target.value)} required /></label>
                  <button className="primary-action" type="submit" disabled={addProject.isPending || !currentUser.data}>{addProject.isPending ? '正在创建' : '创建项目'}</button>
                </form>
                {addProject.isError && <p className="error-strip">{addProject.error.message}</p>}
              </section>
              <section className="status-panel catalog-panel">
                <div className="panel-heading"><div><span className="section-index">已建项目</span><h3>项目列表</h3></div><span className="count">{projects.data?.length ?? 0}</span></div>
                <div className="catalog-list">{projects.data?.map((project) => <button key={project.id} type="button" className={project.id === selectedProjectId ? 'project-row selected' : 'project-row'} onClick={() => { setSelectedProjectId(project.id); setVersionComponentId('') }}><span><strong>{project.code}</strong><small>{project.name}</small></span><em>{project.componentCount} 个组件</em></button>) ?? <p className="empty-state">正在读取项目。</p>}</div>
              </section>
              {projectDetail.data && <section className="status-panel catalog-detail">
                <div className="panel-heading"><div><span className="section-index">{projectDetail.data.project.code}</span><h3>{projectDetail.data.project.name}</h3></div></div>
                <div className="catalog-actions">
                  <form className="inline-form" onSubmit={(event) => { event.preventDefault(); addComponent.mutate({ projectId: projectDetail.data.project.id, code: componentCode, name: componentName, reason: componentReason, parentComponentId: componentParentId || null }) }}><label>组件编码<input value={componentCode} placeholder="例如：PLC" onChange={(event) => setComponentCode(event.target.value)} required /></label><label>组件名称<input value={componentName} placeholder="例如：主控程序" onChange={(event) => setComponentName(event.target.value)} required /></label><label>父组件<select value={componentParentId} onChange={(event) => setComponentParentId(event.target.value)}><option value="">根组件</option>{projectDetail.data.components.map(component => <option key={component.id} value={component.id}>{component.code} · {component.name}</option>)}</select></label><label>创建原因<input value={componentReason} onChange={(event) => setComponentReason(event.target.value)} required /></label><button type="submit" disabled={addComponent.isPending}>{addComponent.isPending ? '正在新增' : '新增组件'}</button></form>
                  <form className="inline-form" onSubmit={(event) => { event.preventDefault(); addVersion.mutate({ componentId: versionComponentId, number: versionNumber, reason: versionReason }) }}><label>目标组件<select value={versionComponentId} onChange={(event) => setVersionComponentId(event.target.value)} required><option value="">请选择组件</option>{projectDetail.data.components.map((component) => <option key={component.id} value={component.id}>{component.code} · {component.name}</option>)}</select></label><label>版本号<input value={versionNumber} placeholder="例如：2026.08.29" onChange={(event) => setVersionNumber(event.target.value)} required /></label><label>创建原因<input value={versionReason} onChange={(event) => setVersionReason(event.target.value)} required /></label><button type="submit" disabled={addVersion.isPending}>{addVersion.isPending ? '正在登记' : '登记版本'}</button></form>
                  <form className="inline-form" onSubmit={(event) => { event.preventDefault(); lifecycle.mutate({ versionId: lifecycleVersionId, action: lifecycleAction, reason: lifecycleReason }) }}><label>目标版本<select value={lifecycleVersionId} onChange={(event) => setLifecycleVersionId(event.target.value)} required><option value="">请选择版本</option>{projectDetail.data.components.flatMap((component) => component.versions.map((version) => <option key={version.id} value={version.id}>{component.code} · {version.versionNumber}</option>))}</select></label><label>生命周期动作<select value={lifecycleAction} onChange={(event) => setLifecycleAction(event.target.value)}><option value="Testing">提交测试</option><option value="Released">发布</option><option value="Maintenance">进入维护</option><option value="Deprecated">废弃</option><option value="Blocked">阻断</option><option value="Clear">解除阻断</option><option value="Recommended">设为推荐</option></select></label><label>原因<input value={lifecycleReason} onChange={(event) => setLifecycleReason(event.target.value)} required /></label><button type="submit" disabled={lifecycle.isPending}>{lifecycle.isPending ? '正在更新' : '更新状态'}</button></form>
                  <form className="inline-form" onSubmit={(event) => { event.preventDefault(); clone.mutate({ projectId: projectDetail.data.project.id, code: cloneCode, name: cloneName, reason: cloneReason }) }}><label>新项目编码<input value={cloneCode} onChange={(event) => setCloneCode(event.target.value)} required /></label><label>新项目名称<input value={cloneName} onChange={(event) => setCloneName(event.target.value)} required /></label><label>克隆原因<input value={cloneReason} onChange={(event) => setCloneReason(event.target.value)} required /></label><button type="button" onClick={() => setClonePreview({ copiedComponents: projectDetail.data.components.length, excludedVersions: projectDetail.data.components.reduce((count, component) => count + component.versions.length, 0) })}>预览克隆</button>{clonePreview && <small>复制 {clonePreview.copiedComponents} 个组件；排除 {clonePreview.excludedVersions} 个版本</small>}<button type="submit" disabled={clone.isPending}>{clone.isPending ? '正在克隆' : '创建克隆'}</button></form>
                  <form className="inline-form" onSubmit={(event) => { event.preventDefault(); move.mutate({ componentId: moveComponentId, parentComponentId: moveParentId || null, reason: moveReason }) }}><label>移动组件<select value={moveComponentId} onChange={(event) => setMoveComponentId(event.target.value)} required><option value="">请选择组件</option>{projectDetail.data.components.map((component) => <option key={component.id} value={component.id}>{component.code}</option>)}</select></label><label>新父组件<select value={moveParentId} onChange={(event) => setMoveParentId(event.target.value)}><option value="">设为根组件</option>{projectDetail.data.components.filter((component) => component.id !== moveComponentId).map((component) => <option key={component.id} value={component.id}>{component.code}</option>)}</select></label><label>移动原因<input value={moveReason} onChange={(event) => setMoveReason(event.target.value)} required /></label><button type="submit" disabled={move.isPending}>{move.isPending ? '正在移动' : '移动组件'}</button></form>
                  {currentUser.data?.roles.includes('Admin') && <form className="inline-form" onSubmit={(event) => { event.preventDefault(); assignMember.mutate() }}><label>项目成员<select value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)} required><option value="">请选择用户</option>{users.data?.map(user => <option key={user.id} value={user.id}>{user.displayName} · {user.email}</option>)}</select></label><label>项目角色<select value={memberRole} onChange={(event) => setMemberRole(event.target.value)}><option>Viewer</option><option>Engineer</option><option>SeniorEngineer</option></select></label><label>指派原因<input value={memberReason} onChange={(event) => setMemberReason(event.target.value)} required /></label><button type="submit" disabled={assignMember.isPending}>{assignMember.isPending ? '正在指派' : '指派项目成员'}</button></form>}
                </div>
                {(addComponent.isError || addVersion.isError || lifecycle.isError) && <p className="error-strip">{addComponent.error?.message ?? addVersion.error?.message ?? lifecycle.error?.message}</p>}
                {assignMember.isError && <p className="error-strip">{assignMember.error.message}</p>}
                {currentUser.data?.roles.includes('Admin') && <div className="component-list">{projectMembers.data?.map(member => <article className="component-row" key={member.id}><div><strong>{member.displayName}</strong><span>{member.email}</span></div><small>{member.role} · {formatTime(member.assignedAt)}</small></article>)}</div>}
                <div className="component-list">{projectDetail.data.components.map((component) => <article className="component-row" key={component.id}><div><strong>{component.code}</strong><span>{component.name}</span></div><div className="version-tags">{component.versions.length ? component.versions.map((version) => <span key={version.id}>{version.versionNumber}<small>序列 {version.sequenceNo} · {version.maturity} · {version.safety}</small></span>) : <em>尚未登记版本</em>}</div></article>)}</div>
              </section>}
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
                <div className="panel-heading"><div><span className="section-index">项目标准</span><h3>当前推荐基线</h3></div></div>
                <p className="empty-state">{standard.data ? `当前标准：${standard.data.baselineCode}` : '尚未设置项目标准。'}</p>
                <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); assignStandard.mutate({ projectId: baselineProjectId, baselineId: standardBaselineId, reason: standardReason }) }}>
                  <label>已发布基线<select value={standardBaselineId} onChange={(event) => setStandardBaselineId(event.target.value)} required><option value="">请选择基线</option>{baselines.data?.filter((baseline) => baseline.state === 'Released').map((baseline) => <option key={baseline.id} value={baseline.id}>{baseline.code} · Revision {baseline.revisionNo}</option>)}</select></label>
                  <label>设置原因<input value={standardReason} maxLength={500} onChange={(event) => setStandardReason(event.target.value)} required /></label>
                  <button type="submit" disabled={assignStandard.isPending || baselineProjectId === ''}>{assignStandard.isPending ? '正在设置' : '设为项目标准'}</button>
                </form>
                {assignStandard.isError && <p className="error-strip">{assignStandard.error.message}</p>}
              </section>
            </>}

            {activePage === 'software' && <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">版本影响</span><h3>追溯版本使用范围</h3></div></div><label>项目版本<select value={impactVersionId} onChange={(event) => setImpactVersionId(event.target.value)}><option value="">请选择项目页面中的版本</option>{projectDetail.data?.components.flatMap((component) => component.versions.map((version) => <option key={version.id} value={version.id}>{component.code} · {version.versionNumber}</option>))}</select></label>{impactVersionId && <><dl className="runtime-list"><div><dt>组件</dt><dd>{versionDetail.data?.version.componentCode ?? '—'}</dd></div><div><dt>序列</dt><dd>{versionDetail.data?.version.sequenceNo ?? '—'}</dd></div><div><dt>成熟度</dt><dd>{versionDetail.data?.version.maturity ?? '—'}</dd></div><div><dt>安全状态</dt><dd>{versionDetail.data?.version.safety ?? '—'}</dd></div><div><dt>推荐</dt><dd>{versionDetail.data?.recommended ? '是' : '否'}</dd></div></dl><dl className="runtime-list"><div><dt>已使用基线</dt><dd>{versionImpact.data?.usedBaselineIds.length ?? 0}</dd></div><div><dt>当前机台</dt><dd>{versionImpact.data?.currentMachineIds.length ?? 0}</dd></div><div><dt>目标机台</dt><dd>{versionImpact.data?.targetMachineIds.length ?? 0}</dd></div><div><dt>历史机台</dt><dd>{versionImpact.data?.historicalMachineIds.length ?? 0}</dd></div></dl><div className="component-list">{versionDetail.data?.transitions.map((item, index) => <article className="component-row" key={`${item.occurredAt}-${index}`}><div><strong>{item.axis}</strong><span>{item.fromState} → {item.toState} · {item.reason}</span></div><small>{item.actor} · {formatTime(item.occurredAt)}</small></article>)}{versionImpact.data?.recentFacts.map((fact, index) => <article className="component-row" key={`${fact.machineId}-${index}`}><div><strong>{fact.operationType}</strong><span>机台 {fact.machineId}</span></div><small>{formatTime(fact.effectiveAt)}</small></article>)}</div></>}</section>}

            {activePage === 'search' && <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">全局搜索</span><h3>项目、组件、版本、基线和机台</h3></div></div><label>搜索词<input value={searchTerm} minLength={2} onChange={(event) => setSearchTerm(event.target.value)} placeholder="至少输入两个字符" /></label>{searchTerm.trim().length >= 2 && <div className="catalog-list">{catalogSearch.data?.map((item) => <article className="component-row" key={`${item.type}-${item.id}`}><div><strong>{item.label}</strong><span>{item.type === 'Project' ? '项目' : item.type === 'Component' ? '组件' : item.type === 'Version' ? '版本' : item.type === 'Baseline' ? '基线' : '机台'}</span></div></article>)}</div>}{catalogSearch.isError && <p className="error-strip">{catalogSearch.error.message}</p>}</section>}

            {activePage === 'compare' && <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">基线比对</span><h3>快照差异</h3></div></div><div className="catalog-form"><label>所属项目<select value={compareProjectId} onChange={(event) => { setCompareProjectId(event.target.value); setLeftBaselineId(''); setRightBaselineId('') }}><option value="">请选择项目</option>{projects.data?.map(project => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label><label>左侧基线<select value={leftBaselineId} onChange={(event) => setLeftBaselineId(event.target.value)}><option value="">请选择基线</option>{compareProjectBaselines.data?.map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.code} · Rev {baseline.revisionNo}</option>)}</select></label><label>右侧基线<select value={rightBaselineId} onChange={(event) => setRightBaselineId(event.target.value)}><option value="">请选择基线</option>{compareProjectBaselines.data?.map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.code} · Rev {baseline.revisionNo}</option>)}</select></label></div>{baselineComparison.data && <div className="component-list">{baselineComparison.data.items.map(item => <article className="component-row" key={item.componentId}><div><strong>{item.status === 'Same' ? '相同' : item.status === 'Changed' ? '已变化' : item.status === 'Added' ? '新增' : '已移除'}</strong><span>组件 {item.componentId}</span></div><small>{item.leftVersionId ?? '无'} → {item.rightVersionId ?? '无'}</small></article>)}</div>}{baselineComparison.isError && <p className="error-strip">{baselineComparison.error.message}</p>}</section>}

            {activePage === 'deployments' && <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">事实历史</span><h3>部署与观察记录</h3></div></div><label>机台<select value={selectedMachineId} onChange={(event) => setSelectedMachineId(event.target.value)}><option value="">请选择机台</option>{machines.data?.map(machine => <option key={machine.id} value={machine.id}>{machine.serialNumber} · {machine.name}</option>)}</select></label>{selectedMachineId && <div className="component-list">{machineFacts.data?.map(fact => <article className="component-row" key={fact.id}><div><strong>{fact.operationType === 'Observation' ? '观察' : fact.operationType}</strong><span>{fact.coverage === 'Full' ? '完整覆盖' : '局部覆盖'} · {fact.sourceType} · {fact.itemCount} 项</span></div><small>记录 {formatTime(fact.recordedAt)}<br />生效 {formatTime(fact.effectiveAt)}</small></article>)}</div>}</section>}

            {activePage === 'imports' && <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">导入预览</span><h3>先校验，再提交</h3></div></div><form className="catalog-form" onSubmit={(event) => { event.preventDefault(); stageImportMutation.mutate() }}><label>所属项目<select value={importProjectId} onChange={(event) => setImportProjectId(event.target.value)} required><option value="">请选择项目</option>{projects.data?.map(project => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label><label className="wide-field">每行：组件编码,版本号<textarea value={importRows} onChange={(event) => setImportRows(event.target.value)} required /></label><label className="wide-field">导入原因<input value={importReason} onChange={(event) => setImportReason(event.target.value)} required /></label><button type="submit" disabled={stageImportMutation.isPending}>{stageImportMutation.isPending ? '正在校验' : '生成预览'}</button></form>{stageImportMutation.isError && <p className="error-strip">{stageImportMutation.error.message}</p>}{importPreview.data && <div className="component-list">{importPreview.data.rows.map(row => <article className="component-row" key={row.rowNumber}><div><strong>第 {row.rowNumber} 行</strong><span>{row.payload.componentCode} · {row.payload.versionNumber}</span></div><small>{row.validationError ?? '校验通过，尚未提交'}</small></article>)}</div>}{importPreview.data?.status === 'Validated' && !importPreview.data.rows.some(row => row.validationError) && <button type="button" className="primary-action" onClick={() => commitImportMutation.mutate()} disabled={commitImportMutation.isPending}>{commitImportMutation.isPending ? '正在提交' : '提交导入'}</button>}{commitImportMutation.isError && <p className="error-strip">{commitImportMutation.error.message}</p>}</section>}

            {activePage === 'users' && <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">身份管理</span><h3>用户与角色</h3></div><span className="count">{users.data?.length ?? 0}</span></div>{currentUser.data?.roles.includes('Admin') ? <><form className="catalog-form" onSubmit={(event) => { event.preventDefault(); addUser.mutate({ email: newUserEmail, displayName: newUserName, password: newUserPassword, role: newUserRole, reason: newUserReason }) }}><label>邮箱<input type="email" value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} required /></label><label>显示名<input value={newUserName} onChange={(event) => setNewUserName(event.target.value)} required /></label><label>初始密码<input type="password" value={newUserPassword} onChange={(event) => setNewUserPassword(event.target.value)} required /></label><label>角色<select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value)}><option>Viewer</option><option>Engineer</option><option>SeniorEngineer</option><option>Admin</option></select></label><label className="wide-field">创建原因<input value={newUserReason} onChange={(event) => setNewUserReason(event.target.value)} required /></label><button type="submit" disabled={addUser.isPending}>{addUser.isPending ? '正在创建' : '创建用户'}</button></form><form className="catalog-form" onSubmit={(event) => { event.preventDefault(); updateUserRole.mutate() }}><label>用户<select value={roleUserId} onChange={(event) => setRoleUserId(event.target.value)} required><option value="">请选择用户</option>{users.data?.map(user => <option key={user.id} value={user.id}>{user.displayName} · {user.email}</option>)}</select></label><label>新角色<select value={roleValue} onChange={(event) => setRoleValue(event.target.value)}><option>Viewer</option><option>Engineer</option><option>SeniorEngineer</option><option>Admin</option></select></label><label>变更原因<input value={roleReason} onChange={(event) => setRoleReason(event.target.value)} required /></label><button type="submit" disabled={updateUserRole.isPending}>{updateUserRole.isPending ? '正在变更' : '变更角色'}</button></form>{(addUser.isError || updateUserRole.isError) && <p className="error-strip">{addUser.error?.message ?? updateUserRole.error?.message}</p>}<div className="catalog-list">{users.data?.map(user => <article className="component-row" key={user.id}><div><strong>{user.displayName}</strong><span>{user.email}</span></div><small>{user.roles.join('、') || '未分配角色'}</small></article>)}</div></> : <p className="empty-state">仅管理员可查看用户与角色。</p>}{users.isError && <p className="error-strip">{users.error.message}</p>}</section>}

            {activePage === 'machines' && <>
              <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">机台登记</span><h3>创建机台</h3></div></div><form className="catalog-form" onSubmit={(event) => { event.preventDefault(); addMachine.mutate({ projectId: machineProjectId, serialNumber: machineSerial, name: machineName, machineType, reason: machineReason }) }}><label>所属项目<select value={machineProjectId} onChange={(event) => setMachineProjectId(event.target.value)} required><option value="">请选择项目</option>{projects.data?.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label><label>序列号<input value={machineSerial} onChange={(event) => setMachineSerial(event.target.value)} required /></label><label>机台名称<input value={machineName} onChange={(event) => setMachineName(event.target.value)} required /></label><label>机型<input value={machineType} onChange={(event) => setMachineType(event.target.value)} /></label><label className="wide-field">创建原因<input value={machineReason} onChange={(event) => setMachineReason(event.target.value)} required /></label><button className="primary-action" type="submit" disabled={addMachine.isPending}>{addMachine.isPending ? '正在创建' : '创建机台'}</button></form>{addMachine.isError && <p className="error-strip">{addMachine.error.message}</p>}</section>
              <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">机台列表</span><h3>当前实际配置</h3></div><span className="count">{machines.data?.length ?? 0}</span></div><div className="catalog-list">{machines.data?.map((machine) => <button type="button" className={machine.id === selectedMachineId ? 'project-row selected' : 'project-row'} key={machine.id} onClick={() => setSelectedMachineId(machine.id)}><span><strong>{machine.serialNumber}</strong><small>{machine.name}{machine.machineType ? ` · ${machine.machineType}` : ''} · 匹配 {machine.matchStatus ?? '待计算'} · 风险 {machine.riskSeverity ?? '待计算'}</small></span><em>{machine.status === 'Active' ? '在用' : '归档'}</em></button>)}</div>{selectedMachineId && <><dl className="runtime-list"><div><dt>配置匹配</dt><dd>{machineDrift.data?.matchStatus ?? '正在计算'}</dd></div><div><dt>风险等级</dt><dd>{machineDrift.data?.riskSeverity ?? '正在计算'}</dd></div></dl><form className="catalog-form" onSubmit={(event) => { event.preventDefault(); assignTarget.mutate() }}><label>目标基线<select value={targetBaselineId} onChange={(event) => setTargetBaselineId(event.target.value)} required><option value="">请选择已发布基线</option>{targetBaselines.data?.filter(baseline => baseline.state === 'Released').map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.code} · Revision {baseline.revisionNo}</option>)}</select></label><label>指派原因<input value={targetReason} onChange={(event) => setTargetReason(event.target.value)} required /></label><button type="submit" disabled={assignTarget.isPending}>{assignTarget.isPending ? '正在指派' : '设为该机台目标'}</button></form>{assignTarget.isError && <p className="error-strip">{assignTarget.error.message}</p>}<form className="catalog-form" onSubmit={(event) => { event.preventDefault(); recordFacts.mutate({ machineId: selectedMachineId, componentId: factComponentId, versionId: factVersionId, coverage: factCoverage, reason: factReason }) }}><label>组件 ID<input value={factComponentId} onChange={(event) => setFactComponentId(event.target.value)} required /></label><label>版本 ID<input value={factVersionId} onChange={(event) => setFactVersionId(event.target.value)} required /></label><label>覆盖范围<select value={factCoverage} onChange={(event) => setFactCoverage(event.target.value)}><option value="Partial">局部观察</option><option value="Full">完整观察</option></select></label><label>观察原因<input value={factReason} onChange={(event) => setFactReason(event.target.value)} required /></label><button type="submit" disabled={recordFacts.isPending}>{recordFacts.isPending ? '正在记录' : '记录实际配置'}</button></form>{recordFacts.isError && <p className="error-strip">{recordFacts.error.message}</p>}<div className="component-list">{machineConfiguration.data?.map((item) => <article className="component-row" key={item.componentId}><div><strong>{item.state === 'Present' ? '存在' : '缺失'}</strong><span>组件 {item.componentId}</span></div><div className="version-tags"><span>{item.versionId ?? '无版本'}<small>状态时间 {formatTime(item.stateEffectiveAt)}</small></span></div></article>)}</div></>}</section>
            </>}
          </div>
        ) : (
          <section className="pending-page"><span className="section-index">后续垂直切片</span><h2>{selectedNavigation.label}尚未实现</h2><p>当前版本只完成了运行基础设施和后台任务链路。{selectedNavigation.label}将在核心领域模型与对应 API 落地后开放，现阶段不会提供无法保存或追溯的占位操作。</p><button className="primary-action" type="button" onClick={() => setActivePage('overview')}>返回运行总览</button></section>
        )}
      </main>
    </div>
  )
}

export default App
