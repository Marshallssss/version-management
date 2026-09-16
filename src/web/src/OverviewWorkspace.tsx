import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightOutlined, DatabaseOutlined, DesktopOutlined, ExperimentOutlined, ReloadOutlined, ToolOutlined, WarningOutlined } from '@ant-design/icons'
import { getBaselines, getProjectStandard, type ProjectDetail } from './catalog-api'
import { getMachineRegistry } from './machine-registry-api'
import { enqueueNoopJob, getSystemStatus, getSystemVersion, type BackgroundJobStatus } from './system-api'
import './overview-workspace.css'

type Attention = '' | 'mismatch' | 'critical' | 'unknown' | 'no-target'
const matchLabels: Record<string, string> = { Matched: '配置匹配', Mismatch: '配置不匹配', Unknown: '信息不足' }
const riskLabels: Record<string, string> = { Critical: '严重风险', High: '高风险', Unknown: '风险未知', None: '无风险' }
const jobLabels: Record<BackgroundJobStatus, string> = { Pending: '等待执行', Running: '执行中', Succeeded: '已完成', Failed: '失败', Retry: '等待重试' }
const formatTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无记录'

export function OverviewWorkspace({ projectId, detail, projectError, isAuthenticated, isAdmin, onSelectProject, onOpenVersions, onOpenBaselines, onOpenMachines, onOpenMachine }: {
  projectId: string; detail?: ProjectDetail; projectError?: Error | null; isAuthenticated: boolean; isAdmin: boolean;
  onSelectProject: () => void; onOpenVersions: () => void; onOpenBaselines: (baselineId?: string) => void;
  onOpenMachines: (attention: Attention) => void; onOpenMachine: (machineId: string) => void;
}) {
  const queryClient = useQueryClient()
  const [operationsOpen, setOperationsOpen] = useState(false)
  const [note, setNote] = useState('')
  const registry = useQuery({ queryKey: ['machines', 'registry', projectId], queryFn: () => getMachineRegistry(projectId), enabled: isAuthenticated && !!projectId, refetchInterval: 30_000 })
  const standard = useQuery({ queryKey: ['project-standard', projectId], queryFn: () => getProjectStandard(projectId), enabled: isAuthenticated && !!projectId })
  const baselines = useQuery({ queryKey: ['project-baseline-history', projectId], queryFn: () => getBaselines(projectId), enabled: isAuthenticated && !!projectId })
  const system = useQuery({ queryKey: ['system-version'], queryFn: getSystemVersion })
  const status = useQuery({ queryKey: ['system-status'], queryFn: getSystemStatus, enabled: isAdmin && operationsOpen, refetchInterval: operationsOpen ? 5_000 : false })
  const enqueue = useMutation({ mutationFn: enqueueNoopJob, onSuccess: async () => { setNote(''); await queryClient.invalidateQueries({ queryKey: ['system-status'] }) } })
  const items = registry.data?.items ?? []
  const counts = registry.data ? {
    all: items.length,
    critical: items.filter(item => item.riskSeverity === 'Critical').length,
    mismatch: items.filter(item => item.matchStatus === 'Mismatch').length,
    unknown: items.filter(item => !item.matchStatus || item.matchStatus === 'Unknown').length,
    noTarget: items.filter(item => !item.targetBaselineId).length,
  } : null
  const attentionItems = items.filter(item => item.riskSeverity === 'Critical' || item.riskSeverity === 'High' || item.matchStatus !== 'Matched' || !item.targetBaselineId)
    .sort((a, b) => Number(b.riskSeverity === 'Critical') - Number(a.riskSeverity === 'Critical') || Number(b.riskSeverity === 'High') - Number(a.riskSeverity === 'High') || Number(b.matchStatus === 'Mismatch') - Number(a.matchStatus === 'Mismatch') || a.name.localeCompare(b.name, 'zh-CN'))
  const recentBaselines = baselines.data?.filter(item => item.state === 'Released').sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 4) ?? []
  const testingCount = detail?.components.reduce((sum, component) => sum + component.versions.filter(version => version.maturity === 'Testing').length, 0)
  const metrics: Array<{ key: Attention; label: string; value: number | undefined; tone?: string }> = [
    { key: '', label: '机台总数', value: counts?.all },
    { key: 'critical', label: '严重风险', value: counts?.critical, tone: 'critical' },
    { key: 'mismatch', label: '配置不匹配', value: counts?.mismatch, tone: 'warning' },
    { key: 'unknown', label: '信息不足', value: counts?.unknown },
    { key: 'no-target', label: '未指派目标', value: counts?.noTarget },
  ]
  return <div className="project-overview">
    <section className="overview-summary">
      <header className="overview-section-heading"><div><span className="section-index">当前项目</span><h2>配置运行总览</h2></div><button type="button" className="icon-button" title="刷新项目总览" aria-label="刷新项目总览" disabled={!isAuthenticated || !projectId || registry.isFetching} onClick={() => { void registry.refetch(); void standard.refetch(); void baselines.refetch(); void queryClient.invalidateQueries({ queryKey: ['project', projectId] }) }}><ReloadOutlined spin={registry.isFetching} /></button></header>
      {!isAuthenticated || !projectId ? <div className="overview-empty"><p>{isAuthenticated ? '尚未选择项目。' : '登录后查看项目配置状态。'}</p><button type="button" onClick={onSelectProject}>{isAuthenticated ? '选择项目' : '登录'}</button></div> : <>
        <p className="overview-data-caption">整机配置记录汇总 · 不代表机台实时在线状态{registry.dataUpdatedAt > 0 && <span>最近读取 {formatTime(new Date(registry.dataUpdatedAt).toISOString())}</span>}</p>
        {registry.isError && <p className="error-strip" role="alert">机台汇总读取失败，不能据此判断运行正常。{registry.error.message}</p>}
        {registry.isPending && <p role="status">正在读取机台配置记录。</p>}
        <div className="overview-metrics">{metrics.map(metric => <button key={metric.label} type="button" data-attention={metric.key} data-tone={metric.tone} onClick={() => onOpenMachines(metric.key)} disabled={!registry.data}><span>{metric.label}</span><strong>{metric.value ?? '—'}</strong><ArrowRightOutlined aria-hidden /></button>)}</div>
        <p className="overview-data-caption">匹配按机台目标判定；风险独立统计，同一台机台可同时属于多项。</p>
      </>}
    </section>
    {isAuthenticated && projectId && <>
      <section className="overview-project-strip" aria-label="项目版本摘要">
        <button type="button" onClick={() => onOpenBaselines(standard.data?.baselineId)}><DatabaseOutlined aria-hidden /><span><small>当前项目标准</small><strong>{standard.isError ? '读取失败' : standard.isPending ? '正在读取' : standard.data?.baselineCode ?? '尚未设定'}</strong></span><ArrowRightOutlined aria-hidden /></button>
        <button type="button" onClick={onOpenVersions}><ExperimentOutlined aria-hidden /><span><small>实验室测试版本</small><strong>{projectError ? '读取失败' : testingCount === undefined ? '正在读取' : `${testingCount} 个`}</strong></span><ArrowRightOutlined aria-hidden /></button>
      </section>
      <section className="overview-attention" aria-label="需要关注的机台">
        <header className="overview-section-heading"><div><h3><WarningOutlined aria-hidden />需要关注的机台</h3></div><button type="button" onClick={() => onOpenMachines('')}><DesktopOutlined aria-hidden />全部机台</button></header>
        {registry.isPending ? <p role="status">正在读取。</p> : registry.isError ? <p className="empty-state">数据暂不可用，请刷新重试。</p> : !items.length ? <p className="empty-state">当前项目尚未登记机台。</p> : !attentionItems.length ? <p className="empty-state">现有记录中，所有机台均有目标且配置匹配，未发现严重或高风险。</p> : <div className="overview-machine-list">{attentionItems.slice(0, 8).map(machine => <button type="button" key={machine.id} className="overview-machine-row" onClick={() => onOpenMachine(machine.id)}><span className="overview-machine-name"><strong>{machine.name}</strong><small>{machine.location || '未填写位置'} · {machine.serialNumber}</small></span><span className="overview-target"><small>目标基线</small>{machine.targetBaselineCode || '未指派'}</span><span data-match={machine.matchStatus}>{matchLabels[machine.matchStatus ?? 'Unknown'] ?? '信息不足'}</span><span data-risk={machine.riskSeverity}>{riskLabels[machine.riskSeverity ?? 'Unknown'] ?? '风险未知'}</span><ArrowRightOutlined aria-hidden /></button>)}{attentionItems.length > 8 && <button className="overview-more" type="button" onClick={() => onOpenMachines('')}>查看全部 {items.length} 台机台 <ArrowRightOutlined aria-hidden /></button>}</div>}
      </section>
      <section className="overview-recent" aria-label="最近基线">
        <header className="overview-section-heading"><h3>最近基线</h3><button type="button" onClick={() => onOpenBaselines()}>全部基线 <ArrowRightOutlined aria-hidden /></button></header>
        {baselines.isPending ? <p role="status">正在读取。</p> : baselines.isError ? <p className="error-strip">基线记录读取失败。</p> : recentBaselines.length ? <div className="overview-baseline-list">{recentBaselines.map(baseline => <button type="button" key={baseline.id} onClick={() => onOpenBaselines(baseline.id)}><span><strong>{baseline.code}</strong>{standard.data?.baselineId === baseline.id && <em className="standard-mark">项目标准</em>}</span><small>{formatTime(baseline.createdAt)} · {baseline.itemCount} 项</small><ArrowRightOutlined aria-hidden /></button>)}</div> : <p className="empty-state">尚无已发布基线。</p>}
      </section>
    </>}
    {isAdmin && <details className="overview-operations" onToggle={event => setOperationsOpen(event.currentTarget.open)}><summary><ToolOutlined aria-hidden /><strong>系统运维</strong><span>服务信息与后台任务</span></summary>{operationsOpen && <div className="overview-operations-content">
      <section aria-label="服务信息"><h3>服务信息</h3>{system.isError ? <p className="error-strip">服务信息读取失败。</p> : <dl className="overview-service-fields"><div><dt>产品</dt><dd>{system.data?.product ?? '—'}</dd></div><div><dt>服务版本</dt><dd>{system.data?.version ?? '—'}</dd></div><div><dt>接口版本</dt><dd>{system.data?.apiVersion ?? '—'}</dd></div><div><dt>服务时间</dt><dd>{formatTime(system.data?.serverTime)}</dd></div></dl>}</section>
      <section className="overview-queue" aria-label="后台任务"><header className="overview-section-heading"><h3>后台任务 <small>全系统</small></h3><button type="button" className="icon-button" aria-label="刷新后台任务" title="刷新后台任务" disabled={status.isFetching} onClick={() => { void status.refetch(); void system.refetch() }}><ReloadOutlined spin={status.isFetching} /></button></header>{status.isPending ? <p role="status">正在读取任务。</p> : status.isError ? <p className="error-strip" role="alert">任务记录读取失败。{status.error.message}</p> : <><dl className="overview-queue-counts">{(Object.keys(jobLabels) as BackgroundJobStatus[]).map(state => <div key={state}><dt>{jobLabels[state]}</dt><dd>{status.data?.queue.find(item => item.status === state)?.count ?? 0}</dd></div>)}</dl><div className="overview-job-list">{status.data?.jobs.length ? status.data.jobs.map(job => <article key={job.id}><div><strong>{job.jobType === 'system.noop' ? '连通性任务' : job.jobType}</strong><small>{formatTime(job.createdAt)} · 尝试 {job.attempts} 次</small></div><span className={`job-state ${job.status.toLowerCase()}`}>{jobLabels[job.status]}</span>{job.lastError && <p className="error-strip">{job.lastError}</p>}</article>) : <p className="empty-state">尚无后台任务记录。</p>}</div></>}
      <form className="overview-diagnostic-form" onSubmit={event => { event.preventDefault(); enqueue.mutate(note) }}><label>诊断原因<input value={note} maxLength={500} required onChange={event => setNote(event.target.value)} /></label><button type="submit" disabled={enqueue.isPending}>{enqueue.isPending ? '正在提交' : '提交连通性任务'}</button>{enqueue.isSuccess && <p className="success-strip" role="status">任务已提交，请查看执行结果。</p>}{enqueue.isError && <p className="error-strip" role="alert">{enqueue.error.message}</p>}</form></section>
    </div>}</details>}
  </div>
}
