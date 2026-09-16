import { FilterOutlined, PlusOutlined, CloseOutlined, HistoryOutlined } from '@ant-design/icons'
import { getBaselineHistoryIndex, snapshotVersionKey } from './baseline-history-api'
import './baseline-history.css'
import { BaselineOperationDialog } from './BaselineOperationDialog'
import type { OpenImpactReference } from './OperationImpactPreview'
import { PatchBadge } from './VersionRecordTools'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getMaintenanceCapabilities, assignProjectStandard, compareBaselines, createBaseline, decideBaselineReview, getBaselineDetail, getProjectStandard, maintainBaselineDraft, releaseBaseline, requestBaselineReview, undoBaselineCreation, withdrawBaselineRelease, type ProjectDetail } from './catalog-api'

function localTime(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }

function formatTime(value: string | null | undefined) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—' }

export function ProjectBaselineHistory({ canWrite = true, detail, isAdmin, isSuperAdmin, focusedBaselineId, composerRequest = 0, requestedBaseline, onOpenReference, onOpenPatches, onSuccess }: { canWrite?: boolean; detail: ProjectDetail; isAdmin: boolean; isSuperAdmin: boolean; focusedBaselineId?: string; composerRequest?: number; requestedBaseline: { id: string } | null; onOpenReference: OpenImpactReference; onOpenPatches: (componentId: string, versionId: string) => void; onSuccess: (message: string) => void }) {
  const queryClient = useQueryClient()
  const maintenanceCapabilities = useQuery({ queryKey: ['maintenance-capabilities'], queryFn: getMaintenanceCapabilities })
  const [selectedBaselineId, setSelectedBaselineId] = useState('')
  const [reviewReason, setReviewReason] = useState('')
  const [releaseReason, setReleaseReason] = useState('')
  const [standardReason, setStandardReason] = useState('')
  const [operationAction, setOperationAction] = useState<'withdraw' | 'maintenance' | null>(null)
  const [maintenanceOpen, setMaintenanceOpen] = useState(false)
  const [maintenanceTime, setMaintenanceTime] = useState('')
  const [maintenanceReason, setMaintenanceReason] = useState('')
  const [maintenanceSelections, setMaintenanceSelections] = useState<Record<string, string>>({})
  const [composerOpen, setComposerOpen] = useState(false)
  const [testingSelection, setTestingSelection] = useState<string[]>([])
  const [composerOverrides, setComposerOverrides] = useState<Record<string, string>>({})
  const [baselineCode, setBaselineCode] = useState('')
  const [baselineReason, setBaselineReason] = useState('')
  const [undoReason, setUndoReason] = useState('')
  const [now, setNow] = useState(Date.now())
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortDirection, setSortDirection] = useState<'newest' | 'oldest'>('newest')
  const [versionFilters, setVersionFilters] = useState<Array<{ componentId: string; versionKey: string }>>([])
  const baselines = useQuery({ queryKey: ['project-baseline-history', detail.project.id, 'index'], queryFn: () => getBaselineHistoryIndex(detail.project.id) })
  const chronologicalBaselines = useMemo(() => [...(baselines.data ?? [])].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() || left.id.localeCompare(right.id)), [baselines.data])
  const historicalComponents = useMemo(() => {
    const components = new Map<string, { id: string; names: string[]; versions: Map<string, string> }>()
    for (const baseline of chronologicalBaselines) for (const item of baseline.items) {
      if (item.versionNumber === null) continue
      const component = components.get(item.componentId) ?? { id: item.componentId, names: [], versions: new Map<string, string>() }
      if (!component.names.includes(item.componentName)) component.names.push(item.componentName)
      component.versions.set(snapshotVersionKey(item), item.versionNumber)
      components.set(item.componentId, component)
    }
    return [...components.values()].sort((left, right) => left.names[0].localeCompare(right.names[0], 'zh-CN'))
  }, [chronologicalBaselines])
  const invalidDateRange = !!dateFrom && !!dateTo && dateFrom > dateTo
  const visibleBaselines = useMemo(() => {
    if (invalidDateRange) return []
    const from = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : -Infinity
    const end = dateTo ? new Date(dateTo + 'T00:00:00') : null
    if (end) end.setDate(end.getDate() + 1)
    const result = chronologicalBaselines.filter(baseline => {
      const time = new Date(baseline.createdAt).getTime()
      return time >= from && time < (end?.getTime() ?? Infinity)
        && versionFilters.every(filter => !filter.componentId || baseline.items.some(item =>
          item.componentId === filter.componentId && item.versionNumber !== null
          && (!filter.versionKey || snapshotVersionKey(item) === filter.versionKey)))
    })
    return sortDirection === 'oldest' ? result.reverse() : result
  }, [chronologicalBaselines, dateFrom, dateTo, sortDirection, versionFilters, invalidDateRange])
  const resetFilters = () => { setDateFrom(''); setDateTo(''); setVersionFilters([]) }
  const updateVersionFilter = (index: number, value: { componentId: string; versionKey: string }) => {
    setVersionFilters(current => current.map((filter, position) => position === index ? value : filter))
    setSelectedBaselineId('')
  }
  useEffect(() => { if (!selectedBaselineId && visibleBaselines.length) setSelectedBaselineId(visibleBaselines[0].id) }, [selectedBaselineId, visibleBaselines])
  useEffect(() => { resetFilters(); setSortDirection('newest') }, [detail.project.id])
  const currentStandard = useQuery({ queryKey: ['project-standard', detail.project.id], queryFn: () => getProjectStandard(detail.project.id) })
  const baselineDetail = useQuery({ queryKey: ['baseline-detail', selectedBaselineId], queryFn: () => getBaselineDetail(selectedBaselineId), enabled: selectedBaselineId !== '' })
  const standardDetail = useQuery({ queryKey: ['baseline-detail', currentStandard.data?.baselineId], queryFn: () => getBaselineDetail(currentStandard.data!.baselineId), enabled: currentStandard.data != null })
  useEffect(() => { if (requestedBaseline) { resetFilters(); setSelectedBaselineId(requestedBaseline.id); document.getElementById('project-baseline-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) } }, [requestedBaseline])
  useEffect(() => { setOperationAction(null); setMaintenanceOpen(false); setMaintenanceReason(''); setUndoReason('') }, [selectedBaselineId])
  useEffect(() => { resetFilters(); setSelectedBaselineId(focusedBaselineId ?? ''); setMaintenanceOpen(false) }, [detail.project.id, focusedBaselineId])
  useEffect(() => { setComposerOpen(false); setTestingSelection([]); setComposerOverrides({}); setBaselineCode(''); setBaselineReason(''); setUndoReason('') }, [detail.project.id])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ['project-baseline-history', detail.project.id] }); await queryClient.invalidateQueries({ queryKey: ['project-standard', detail.project.id] }); await queryClient.invalidateQueries({ queryKey: ['project', detail.project.id] }); await queryClient.invalidateQueries({ queryKey: ['baseline-detail'] }); await queryClient.invalidateQueries({ queryKey: ['workspace-project-standard', detail.project.id] }) }
  const requestReview = useMutation({ mutationFn: () => requestBaselineReview(selectedBaselineId, reviewReason), onSuccess: async () => { setReviewReason(''); onSuccess('基线已提交评审。'); await refresh() } })
  const decideReview = useMutation({ mutationFn: (decision: 'approve' | 'reject') => decideBaselineReview(selectedBaselineId, decision, reviewReason), onSuccess: async () => { setReviewReason(''); onSuccess('评审结果已记录。'); await refresh() } })
  const release = useMutation({ mutationFn: () => releaseBaseline(selectedBaselineId, releaseReason), onSuccess: async () => { setReleaseReason(''); onSuccess('基线已发布并冻结。'); await refresh() } })
  const assignStandard = useMutation({ mutationFn: () => assignProjectStandard(detail.project.id, selectedBaselineId, standardReason), onSuccess: async () => { setStandardReason(''); onSuccess('已设为项目当前标准，不会改变机台目标。'); await refresh() } })
  const createFromTesting = useMutation({
    mutationFn: () => {
      const testingByComponent = new Map(detail.components.flatMap(component => component.versions.filter(version => testingSelection.includes(version.id)).map(version => [component.id, version.id] as const)))
      const standardByComponent = new Map((standardDetail.data?.items ?? []).flatMap(item => item.versionId ? [[item.componentId, item.versionId] as const] : []))
      const versionSelections = detail.components.flatMap(component => {
        const latestReleased = component.versions.filter(version => version.maturity === 'Released').sort((left, right) => right.sequenceNo - left.sequenceNo)[0]?.id
        const versionId = testingByComponent.get(component.id) ?? composerOverrides[component.id] ?? standardByComponent.get(component.id) ?? latestReleased
        return versionId ? [{ componentId: component.id, versionId }] : []
      })
      return createBaseline(detail.project.id, { seriesCode: detail.project.code, baselineCode, description: '由实验室测试版本生成', reason: baselineReason, versionSelections, testingVersionIds: testingSelection, publishImmediately: true })
    },
    onSuccess: async (created) => { resetFilters(); setComposerOpen(false); setTestingSelection([]); setComposerOverrides({}); setBaselineCode(''); setBaselineReason(''); setSelectedBaselineId(created.id); onSuccess('测试版本已发布，完整基线已冻结并记入历史快照。'); await refresh() },
  })
  const originalCreatedAt = baselineDetail.data?.baseline.createdAt
  const savedMaintenanceTime = originalCreatedAt && (!maintenanceTime || maintenanceTime === localTime(originalCreatedAt)) ? originalCreatedAt : maintenanceTime ? new Date(maintenanceTime).toISOString() : undefined
  const maintain = useMutation({ mutationFn: () => maintainBaselineDraft(selectedBaselineId, { createdAt: savedMaintenanceTime, versionSelections: Object.entries(maintenanceSelections).filter(([, versionId]) => versionId).map(([componentId, versionId]) => ({ componentId, versionId })), reason: maintenanceReason, maintenanceMode: true }), onSuccess: async () => { await refresh(); setOperationAction(null); setMaintenanceOpen(false); setMaintenanceReason(''); onSuccess('历史维护已更新基线版本和录入时间，并已写入审计。') } })
  const undoCreation = useMutation({ mutationFn: () => undoBaselineCreation(selectedBaselineId, undoReason), onSuccess: async () => { setUndoReason(''); setSelectedBaselineId(''); onSuccess('基线创建已撤回，关联测试版本已恢复为测试中。'); await refresh() } })
  const withdrawRelease = useMutation({ mutationFn: () => withdrawBaselineRelease(selectedBaselineId, undoReason), onSuccess: async () => { await refresh(); setOperationAction(null); setUndoReason(''); onSuccess('基线已撤回，冻结快照和发布记录已保留。') } })
  const selected = baselineDetail.data?.baseline
  const selectedIndex = chronologicalBaselines.findIndex(baseline => baseline.id === selectedBaselineId)
  const previousBaseline = selectedIndex >= 0 ? chronologicalBaselines[selectedIndex + 1] : undefined
  const baselineComparison = useQuery({ queryKey: ['baseline-history-comparison', previousBaseline?.id, selectedBaselineId], queryFn: () => compareBaselines(previousBaseline!.id, selectedBaselineId), enabled: previousBaseline != null && selectedBaselineId !== '' })
  const changedBaselineItems = baselineComparison.data?.items.filter(item => item.status !== 'Same') ?? []
  const itemsByParent = useMemo(() => {
    const map = new Map<string | null, NonNullable<typeof baselineDetail.data>['items']>()
    for (const item of baselineDetail.data?.items ?? []) map.set(item.parentItemId, [...(map.get(item.parentItemId) ?? []), item])
    const currentOrder = new Map(detail.components.map(component => [component.id, component.sortOrder]))
    for (const [parentId, entries] of map) entries.sort((left, right) => (parentId === null ? (currentOrder.get(left.componentId) ?? left.sortOrder) - (currentOrder.get(right.componentId) ?? right.sortOrder) : left.sortOrder - right.sortOrder) || left.componentName.localeCompare(right.componentName, 'zh-CN'))
    return map
  }, [baselineDetail.data?.items, detail.components])
  const renderItems = (parentId: string | null, depth = 0): ReactNode[] => (itemsByParent.get(parentId) ?? []).map(item => <section className={depth === 0 ? 'snapshot-root-column' : 'snapshot-child-branch'} key={item.id}><article className={depth === 0 ? 'snapshot-tree-item snapshot-root' : 'snapshot-tree-item'}><div><strong>{item.componentName}</strong><small>{item.versionNumber ?? '结构分类节点'}{item.versionId && item.requirement === 'Optional' && ' · 可选'}</small>{item.versionId && <PatchBadge context="snapshot" versionLabel={item.versionNumber ?? undefined} version={detail.components.find(component => component.id === item.componentId)?.versions.find(version => version.id === item.versionId)} onOpen={() => onOpenPatches(item.componentId, item.versionId!)} />}</div></article>{(itemsByParent.get(item.id)?.length ?? 0) > 0 && <div className="snapshot-children">{renderItems(item.id, depth + 1)}</div>}</section>)
  const selectedIsStandard = currentStandard.data?.baselineId === selectedBaselineId
  const undoSecondsRemaining = selected ? Math.max(0, 180 - Math.floor((now - new Date(selected.releasedAt ?? selected.createdAt).getTime()) / 1000)) : 0
  const canUndoCreation = selected?.state === 'Draft'
  const openComposer = () => {
    const firstRoot = detail.components.filter(component => component.parentComponentId === null).sort((left, right) => left.sortOrder - right.sortOrder)[0]
    const defaultVersion = firstRoot?.versions.filter(version => version.maturity === 'Testing' || version.maturity === 'Released').sort((left, right) => right.sequenceNo - left.sequenceNo)[0]
    setBaselineCode(defaultVersion?.versionNumber ?? '')
    setComposerOpen(true)
  }
  useEffect(() => {
    if (!composerRequest) return
    openComposer()
    document.getElementById('project-baseline-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [composerRequest])
  const componentChildren = (parentId: string | null) => detail.components.filter(component => component.parentComponentId === parentId).sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'zh-CN'))
  const hasTesting = (id: string): boolean => detail.components.find(component => component.id === id)?.versions.some(version => version.maturity === 'Testing') === true || componentChildren(id).some(child => hasTesting(child.id))
  const branchVersions = (id: string): string[] => [...(detail.components.find(c => c.id === id)?.versions.filter(v => v.maturity === 'Testing').map(v => v.id) ?? []), ...componentChildren(id).flatMap(c => branchVersions(c.id))]
  const toggleBranch = (ids: string[], checked: boolean) => setTestingSelection(current => checked ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id)))
  const renderTestingBranch = (parentId: string | null, depth = 0): ReactNode => componentChildren(parentId).filter(component => parentId === null || hasTesting(component.id)).map(component => <div key={component.id} className={depth === 0 ? 'lab-root-column' : 'composer-child'}>
    <div className="composer-node">{componentChildren(component.id).length > 0 ? <label className="composer-parent"><input type="checkbox" aria-label={`选择 ${component.name} 整个分支`} disabled={!branchVersions(component.id).length} checked={branchVersions(component.id).length > 0 && branchVersions(component.id).every(id => testingSelection.includes(id))} ref={node => { if (node) { const ids = branchVersions(component.id); node.indeterminate = ids.some(id => testingSelection.includes(id)) && !ids.every(id => testingSelection.includes(id)) } }} onChange={event => toggleBranch(branchVersions(component.id), event.target.checked)} /><strong>{component.name}</strong></label> : <strong>{component.name}</strong>}{component.versions.filter(version => version.maturity === 'Testing').map(version => <label className="composer-version-choice" key={version.id}><input type="checkbox" aria-label={`选择版本 ${component.name} ${version.versionNumber}`} checked={testingSelection.includes(version.id)} onChange={event => setTestingSelection(current => event.target.checked ? [...current, version.id] : current.filter(id => id !== version.id))} /><span>{version.versionNumber}<small>测试中</small></span></label>)}</div>
    {renderTestingBranch(component.id, depth + 1)}
  </div>)
  return <section className="project-baseline-history" id="project-baseline-history">
    <div className="baseline-history-heading"><div><span className="section-index">整体版本</span><h2><HistoryOutlined aria-hidden /> 基线历史</h2></div>{canWrite && <button className="primary-action" type="button" onClick={openComposer}><PlusOutlined aria-hidden /> 从测试版本创建基线</button>}</div>
    {canWrite && composerOpen && <section className="baseline-composer" id="baseline-composer"><div><span className="section-index">基线选项</span><h3>选择测试版本</h3><p>其余组件默认沿用当前项目标准；可在下方手动修正。</p></div><div className="lab-root-grid composer-tree">{renderTestingBranch(null)}</div><details className="composer-overrides"><summary>手动修正其他组件版本</summary><div>{detail.components.map(component => { const released = component.versions.filter(version => version.maturity === 'Released').sort((left, right) => right.sequenceNo - left.sequenceNo); return released.length && !testingSelection.some(id => component.versions.some(version => version.id === id)) ? <label key={component.id}>{component.name}<select value={composerOverrides[component.id] ?? standardDetail.data?.items.find(item => item.componentId === component.id)?.versionId ?? released[0].id} onChange={event => setComposerOverrides(current => ({ ...current, [component.id]: event.target.value }))}>{released.map(version => <option key={version.id} value={version.id}>{version.versionNumber}</option>)}</select></label> : null })}</div></details><form hidden={!canWrite} className="compact-form" onSubmit={event => { event.preventDefault(); createFromTesting.mutate() }}><label>基线名称<input value={baselineCode} maxLength={100} onChange={event => setBaselineCode(event.target.value)} required /></label><label className="wide-field">创建原因<input value={baselineReason} maxLength={500} onChange={event => setBaselineReason(event.target.value)} required /></label><div className="form-actions"><button type="button" onClick={() => setComposerOpen(false)}>取消</button><button className="primary-action" type="submit" disabled={testingSelection.length === 0 || createFromTesting.isPending || currentStandard.isPending || currentStandard.isError || !!currentStandard.data && (standardDetail.isPending || standardDetail.isError)}>{createFromTesting.isPending ? '正在生成' : `发布 ${testingSelection.length} 个测试版本并创建基线`}</button></div>{createFromTesting.isError && <p className="error-strip wide-field">{createFromTesting.error.message}</p>}</form></section>}
    <section className="baseline-history-filters" aria-label="基线筛选">
      <div className="baseline-filter-toolbar">
        <span className="filter-caption"><FilterOutlined aria-hidden /> 筛选</span>
        <label>开始日期<input type="date" aria-label="基线开始日期" value={dateFrom} onChange={event => { setDateFrom(event.target.value); setSelectedBaselineId('') }} /></label>
        <label>结束日期<input type="date" aria-label="基线结束日期" value={dateTo} min={dateFrom || undefined} onChange={event => { setDateTo(event.target.value); setSelectedBaselineId('') }} /></label>
        <label>录入时间<select aria-label="基线时间排序" value={sortDirection} onChange={event => setSortDirection(event.target.value as 'newest' | 'oldest')}><option value="newest">新到旧</option><option value="oldest">旧到新</option></select></label>
        <button type="button" onClick={() => setVersionFilters(current => [...current, { componentId: '', versionKey: '' }])}><PlusOutlined aria-hidden /> 组件版本</button>
        {(dateFrom || dateTo || versionFilters.length > 0) && <button type="button" onClick={() => { resetFilters(); setSelectedBaselineId('') }}>清除筛选</button>}
      </div>
      {versionFilters.map((filter, index) => <div className="baseline-version-filter" key={index}>
        <span>{index === 0 ? '包含' : '并且'}</span>
        <label><select aria-label={`筛选组件 ${index + 1}`} value={filter.componentId} onChange={event => updateVersionFilter(index, { componentId: event.target.value, versionKey: '' })}><option value="">选择组件</option>{historicalComponents.map(component => <option value={component.id} key={component.id}>{component.names.join(' / ')}</option>)}</select></label>
        <label><select aria-label={`筛选版本 ${index + 1}`} value={filter.versionKey} disabled={!filter.componentId} onChange={event => updateVersionFilter(index, { ...filter, versionKey: event.target.value })}><option value="">全部版本</option>{[...(historicalComponents.find(component => component.id === filter.componentId)?.versions ?? [])].map(([key, number]) => <option value={key} key={key}>{number}</option>)}</select></label>
        <button className="history-filter-remove" type="button" title="移除此条件" aria-label={`移除组件条件 ${index + 1}`} onClick={() => { setVersionFilters(current => current.filter((_, position) => position !== index)); setSelectedBaselineId('') }}><CloseOutlined aria-hidden /></button>
      </div>)}
      {invalidDateRange && <p className="error-strip" role="alert">开始日期不能晚于结束日期。</p>}
    </section>
    <div className="baseline-history-layout"><aside className="baseline-timeline">
      <div className="timeline-heading"><strong>历史快照</strong><small aria-live="polite">{visibleBaselines.length} / {baselines.data?.length ?? 0} 条</small></div>
      {baselines.isPending && <p className="history-list-state" role="status">正在加载基线历史…</p>}
      {baselines.isError && <div className="history-list-state" role="alert"><p>基线历史加载失败：{baselines.error.message}</p><button type="button" onClick={() => void baselines.refetch()}>重试</button></div>}
      {baselines.isSuccess && visibleBaselines.length === 0 && <p className="history-list-state">{baselines.data.length === 0 ? canWrite ? '暂无基线，可从测试版本创建。' : '暂无已登记的基线。' : '没有符合筛选条件的基线。'}</p>}
      {visibleBaselines.map(baseline => <button key={baseline.id} type="button" aria-pressed={baseline.id === selectedBaselineId} className={baseline.id === selectedBaselineId ? 'timeline-item selected' : 'timeline-item'} onClick={() => setSelectedBaselineId(baseline.id)}>
        <span className="timeline-badges"><span className={`baseline-state ${baseline.state.toLowerCase()}`}>{baseline.state === 'Released' ? '已发布' : baseline.state === 'Draft' ? '草稿' : '已撤回'}</span>{currentStandard.data?.baselineId === baseline.id && <span className="standard-mark">项目标准</span>}</span>
        <strong>{baseline.code}</strong><small>{baseline.seriesCode} · 修订 {baseline.revisionNo}</small><small>{formatTime(baseline.createdAt)} · {baseline.itemCount} 项</small>
      </button>)}</aside><div className="baseline-history-detail">{baselineDetail.isFetching && selectedBaselineId && <p className="history-list-state" role="status">正在加载快照…</p>}{baselineDetail.isError && <div className="history-list-state" role="alert"><p>快照加载失败：{baselineDetail.error.message}</p><button type="button" onClick={() => void baselineDetail.refetch()}>重试</button></div>}{selected ? <><section className="baseline-snapshot"><div className="snapshot-heading"><div><span className="section-index">已选快照</span><h3>{selected.code}</h3><p>{selected.seriesCode} · 修订 {selected.revisionNo} · {selected.state === 'Released' ? '已发布且不可修改' : selected.state === 'Draft' ? '草稿，等待评审或发布' : '已撤回，保留冻结快照'}</p></div>{selectedIsStandard && <span className="standard-mark">当前项目标准</span>}</div>{selected.description && <p className="snapshot-description">{selected.description}</p>}<div className="snapshot-tree">{renderItems(null)}</div></section>{previousBaseline && <section className="baseline-difference"><div><span className="section-index">版本变化</span><h4>相对于 {previousBaseline.code}</h4><p>{baselineComparison.isError ? '快照比较暂不可用，请重试。' : baselineComparison.isLoading ? '正在比较快照。' : changedBaselineItems.length ? `${changedBaselineItems.length} 个组件发生变化。` : '组件版本没有变化。'}</p></div>{changedBaselineItems.length > 0 && <details><summary>展开新旧版本</summary><div>{changedBaselineItems.map(item => <article key={item.componentId} className={`baseline-difference-item ${item.status.toLowerCase()}`}><span>{item.status === 'Changed' ? '已更新' : item.status === 'Added' ? '已新增' : '已移除'}</span><strong>{item.componentName}</strong><small>{item.leftVersionNumber ?? '未纳入'} <b>→</b> {item.rightVersionNumber ?? '未纳入'}</small></article>)}</div></details>}</section>}{selected.state === 'Draft' && <section className="baseline-action-block"><h4>评审与发布</h4>{canUndoCreation && <form hidden={!canWrite} className="compact-form baseline-undo" onSubmit={event => { event.preventDefault(); undoCreation.mutate() }}><p className="form-hint wide-field">未发布的草稿可随时取消；可恢复的关联版本将回到测试中。</p><label className="wide-field">撤回原因<input value={undoReason} maxLength={500} onChange={event => setUndoReason(event.target.value)} required /></label><button type="submit" className="danger-action" disabled={undoCreation.isPending}>{undoCreation.isPending ? '正在撤回' : '取消草稿'}</button>{undoCreation.isError && <p className="error-strip wide-field">{undoCreation.error.message}</p>}</form>}<form hidden={!canWrite} className="compact-form" onSubmit={event => { event.preventDefault(); if (baselineDetail.data?.review?.status === 'Pending' && isAdmin) decideReview.mutate('approve'); else requestReview.mutate() }}><label className="wide-field">评审原因<input value={reviewReason} maxLength={500} onChange={event => setReviewReason(event.target.value)} required /></label>{baselineDetail.data?.review?.status === 'Pending' && isAdmin ? <><button type="submit">通过评审</button><button type="button" className="danger-action" onClick={() => decideReview.mutate('reject')}>驳回</button></> : baselineDetail.data?.review?.status !== 'Approved' && <button type="submit">提交评审</button>}</form>{baselineDetail.data?.review?.status === 'Approved' && <form hidden={!canWrite} className="compact-form" onSubmit={event => { event.preventDefault(); release.mutate() }}><label className="wide-field">发布原因<input value={releaseReason} maxLength={500} onChange={event => setReleaseReason(event.target.value)} required /></label><button className="primary-action" type="submit">发布并冻结</button></form>}</section>}{selected.state === 'Released' && undoSecondsRemaining > 0 && <form hidden={!canWrite} className="compact-form baseline-undo" onSubmit={event => { event.preventDefault(); withdrawRelease.reset(); setOperationAction('withdraw') }}><p className="form-hint wide-field">发布后 3 分钟内可撤回，剩余 {undoSecondsRemaining} 秒。</p><label>撤回原因<input value={undoReason} maxLength={500} onChange={event => setUndoReason(event.target.value)} required /></label><button type="submit" disabled={withdrawRelease.isPending}>撤回已发布基线</button>{withdrawRelease.isError && <p className="error-strip wide-field">{withdrawRelease.error.message}</p>}</form>}{selected.state === 'Released' && <section className="baseline-action-block"><h4>项目标准</h4>{selectedIsStandard ? <p className="success-strip">此基线是当前项目标准。</p> : <form hidden={!canWrite} className="compact-form" onSubmit={event => { event.preventDefault(); assignStandard.mutate() }}><label className="wide-field">设定原因<input value={standardReason} maxLength={500} onChange={event => setStandardReason(event.target.value)} required /></label><button type="submit">设为项目当前标准</button></form>}</section>}{isSuperAdmin && maintenanceCapabilities.data?.enabled && <section className="baseline-action-block maintenance-action"><button title="仅超级管理员可维护历史录入" type="button" onClick={() => { setMaintenanceOpen(open => !open); setMaintenanceTime(localTime(selected.createdAt)); setMaintenanceSelections(Object.fromEntries((baselineDetail.data?.items ?? []).filter(item => item.versionId).map(item => [item.componentId, item.versionId!]))) }}>历史维护</button>{maintenanceOpen && <form hidden={!canWrite} className="compact-form" onSubmit={event => { event.preventDefault(); maintain.reset(); setOperationAction('maintenance') }}><p className="form-hint wide-field">仅用于补录过去已评审或已发布的历史；保存会保留基线状态并写入审计。</p><label>历史录入时间<input type="datetime-local" value={maintenanceTime} onChange={event => setMaintenanceTime(event.target.value)} required /></label><div className="baseline-selection-list wide-field">{detail.components.filter(component => component.versions.some(version => version.maturity === 'Released')).map(component => <label key={component.id}><span><strong>{component.name}</strong><small>维护选择已发布版本</small></span><select value={maintenanceSelections[component.id] ?? ''} onChange={event => setMaintenanceSelections(current => ({ ...current, [component.id]: event.target.value }))}><option value="">保持现有版本</option>{component.versions.filter(version => version.maturity === 'Released').map(version => <option key={version.id} value={version.id}>{version.versionNumber}</option>)}</select></label>)}</div><label className="wide-field">维护原因<input value={maintenanceReason} maxLength={500} onChange={event => setMaintenanceReason(event.target.value)} required /></label><button type="submit">保存历史维护数据</button>{maintain.isError && <p className="error-strip wide-field">{maintain.error.message}</p>}</form>}</section>}</> : <p className="empty-state">{baselines.isSuccess && visibleBaselines.length === 0 ? '暂无可展示的快照。' : '选择一条基线，查看完整版本快照。'}</p>}</div></div>
    {selected && <BaselineOperationDialog action={operationAction} baseline={selected} reason={operationAction === 'withdraw' ? undoReason : maintenanceReason} pending={operationAction === 'withdraw' ? withdrawRelease.isPending : maintain.isPending} error={operationAction === 'withdraw' ? withdrawRelease.error : maintain.error} onCancel={() => setOperationAction(null)} onConfirm={() => { if (operationAction === 'withdraw') withdrawRelease.mutate(); else maintain.mutate() }} onOpenReference={onOpenReference} timeChange={savedMaintenanceTime && savedMaintenanceTime !== selected.createdAt ? { before: formatTime(selected.createdAt), after: formatTime(savedMaintenanceTime) } : null} changes={(baselineDetail.data?.items ?? []).flatMap(item => {
      const nextId = maintenanceSelections[item.componentId]
      if (!nextId || nextId === item.versionId) return []
      const version = detail.components.find(component => component.id === item.componentId)?.versions.find(candidate => candidate.id === nextId)
      return [{ componentName: item.componentName, before: item.versionNumber ?? '结构分类节点', after: version?.versionNumber ?? '未知版本' }]
    })} />}
  </section>
}
