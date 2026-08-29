import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createComponent, createComponentVersion, createProject, getProject, getProjects } from './catalog-api'
import { enqueueNoopJob, getSystemStatus, getSystemVersion, type BackgroundJobStatus } from './system-api'

const navigation = [
  { id: 'overview', label: '运行总览', available: true },
  { id: 'jobs', label: '后台任务', available: true },
  { id: 'projects', label: '项目', available: true },
  { id: 'baselines', label: '基线', available: false },
  { id: 'software', label: '软件版本', available: false },
  { id: 'machines', label: '机台', available: false },
  { id: 'deployments', label: '部署记录', available: false },
  { id: 'compare', label: '配置比对', available: false },
  { id: 'imports', label: '导入', available: false },
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
  const [componentCode, setComponentCode] = useState('')
  const [componentName, setComponentName] = useState('')
  const [versionComponentId, setVersionComponentId] = useState('')
  const [versionNumber, setVersionNumber] = useState('')
  const queryClient = useQueryClient()
  const system = useQuery({ queryKey: ['system-version'], queryFn: getSystemVersion })
  const status = useQuery({ queryKey: ['system-status'], queryFn: getSystemStatus, refetchInterval: 5_000 })
  const projects = useQuery({ queryKey: ['projects'], queryFn: getProjects })
  const projectDetail = useQuery({ queryKey: ['project', selectedProjectId], queryFn: () => getProject(selectedProjectId!), enabled: selectedProjectId !== null })
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
      setSelectedProjectId(id)
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
  const addComponent = useMutation({
    mutationFn: ({ projectId, code, name }: { projectId: string; code: string; name: string }) => createComponent(projectId, { code, name, parentComponentId: null }),
    onSuccess: async () => {
      setComponentCode('')
      setComponentName('')
      await queryClient.invalidateQueries({ queryKey: ['project', selectedProjectId] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
  const addVersion = useMutation({
    mutationFn: ({ componentId, number }: { componentId: string; number: string }) => createComponentVersion(componentId, { versionNumber: number }),
    onSuccess: async () => {
      setVersionNumber('')
      await queryClient.invalidateQueries({ queryKey: ['project', selectedProjectId] })
    },
  })

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
          <div className={`connection-state ${connectivity}`}><span>服务状态</span><strong>{connectivityText[connectivity]}</strong></div>
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
              <section className="status-panel catalog-panel">
                <div className="panel-heading"><div><span className="section-index">项目目录</span><h3>创建项目</h3></div></div>
                <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); addProject.mutate({ code: projectCode, name: projectName, description: projectDescription }) }}>
                  <label>项目编码<input value={projectCode} maxLength={50} placeholder="例如：LINE-A" onChange={(event) => setProjectCode(event.target.value)} required /></label>
                  <label>项目名称<input value={projectName} maxLength={200} placeholder="例如：产线 A 配置" onChange={(event) => setProjectName(event.target.value)} required /></label>
                  <label className="wide-field">说明<textarea value={projectDescription} maxLength={2000} onChange={(event) => setProjectDescription(event.target.value)} /></label>
                  <button className="primary-action" type="submit" disabled={addProject.isPending}>{addProject.isPending ? '正在创建' : '创建项目'}</button>
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
                  <form className="inline-form" onSubmit={(event) => { event.preventDefault(); addComponent.mutate({ projectId: projectDetail.data.project.id, code: componentCode, name: componentName }) }}><label>组件编码<input value={componentCode} placeholder="例如：PLC" onChange={(event) => setComponentCode(event.target.value)} required /></label><label>组件名称<input value={componentName} placeholder="例如：主控程序" onChange={(event) => setComponentName(event.target.value)} required /></label><button type="submit" disabled={addComponent.isPending}>{addComponent.isPending ? '正在新增' : '新增组件'}</button></form>
                  <form className="inline-form" onSubmit={(event) => { event.preventDefault(); addVersion.mutate({ componentId: versionComponentId, number: versionNumber }) }}><label>目标组件<select value={versionComponentId} onChange={(event) => setVersionComponentId(event.target.value)} required><option value="">请选择组件</option>{projectDetail.data.components.map((component) => <option key={component.id} value={component.id}>{component.code} · {component.name}</option>)}</select></label><label>版本号<input value={versionNumber} placeholder="例如：2026.08.29" onChange={(event) => setVersionNumber(event.target.value)} required /></label><button type="submit" disabled={addVersion.isPending}>{addVersion.isPending ? '正在登记' : '登记版本'}</button></form>
                </div>
                {(addComponent.isError || addVersion.isError) && <p className="error-strip">{addComponent.error?.message ?? addVersion.error?.message}</p>}
                <div className="component-list">{projectDetail.data.components.map((component) => <article className="component-row" key={component.id}><div><strong>{component.code}</strong><span>{component.name}</span></div><div className="version-tags">{component.versions.length ? component.versions.map((version) => <span key={version.id}>{version.versionNumber}<small>序列 {version.sequenceNo}</small></span>) : <em>尚未登记版本</em>}</div></article>)}</div>
              </section>}
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
