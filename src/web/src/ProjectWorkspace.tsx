import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { changeVersionMaturity, changeVersionSafety, createBaseline, createComponent, createComponentVersion, createVersionPatch, deleteComponent, getBaselineDetail, getProjectStandard, getVersionDetail, getVersionImpact, moveComponent, recommendVersion, updateComponent, type ConfigurationComponent, type ProjectDetail } from './catalog-api'
import { ProjectBaselineHistory } from './ProjectBaselineHistory'

type FormMode = 'idle' | 'create-root' | 'create-child' | 'edit' | 'delete'
type InitialMaturity = 'Draft' | 'Testing' | 'Released' | 'Maintenance' | 'Deprecated'
type InspectorTab = 'versions' | 'status' | 'patches' | 'impact'

function maturityText(value: string) {
  return ({ Draft: '草稿', Testing: '测试中', Released: '已发布', Maintenance: '维护中', Deprecated: '已废弃' } as Record<string, string>)[value] ?? value
}

function safetyText(value: string) {
  return ({ Clear: '正常', Blocked: '已阻断' } as Record<string, string>)[value] ?? value
}

function patchStatusText(value: string) {
  return ({ Draft: '草稿', Released: '已发布', Withdrawn: '已撤回' } as Record<string, string>)[value] ?? value
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export function ProjectWorkspace({ detail, focusedVersionId, focusedBaselineId, isAdmin, onSuccess }: { detail: ProjectDetail; focusedVersionId?: string; focusedBaselineId?: string; isAdmin: boolean; onSuccess: (message: string) => void }) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(detail.components[0]?.id ?? null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [formMode, setFormMode] = useState<FormMode>('idle')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('versions')
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [versionNumber, setVersionNumber] = useState('')
  const [versionReason, setVersionReason] = useState('')
  const [initialMaturity, setInitialMaturity] = useState<InitialMaturity>('Testing')
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [lifecycleAction, setLifecycleAction] = useState('Testing')
  const [lifecycleReason, setLifecycleReason] = useState('')
  const [patchCode, setPatchCode] = useState('')
  const [patchTitle, setPatchTitle] = useState('')
  const [patchIssue, setPatchIssue] = useState('')
  const [patchResolution, setPatchResolution] = useState('')
  const [patchStatus, setPatchStatus] = useState('Released')
  const [selectedTestingVersionIds, setSelectedTestingVersionIds] = useState<string[]>([])
  const [labVersionOverrides, setLabVersionOverrides] = useState<Record<string, string>>({})
  const [labBaselineCode, setLabBaselineCode] = useState('')
  const [labBaselineReason, setLabBaselineReason] = useState('')
  const selected = detail.components.find(component => component.id === selectedId) ?? null
  const selectedVersion = selected?.versions.find(version => version.id === selectedVersionId) ?? null
  const projectStandard = useQuery({ queryKey: ['workspace-project-standard', detail.project.id], queryFn: () => getProjectStandard(detail.project.id) })
  const standardBaseline = useQuery({ queryKey: ['baseline-detail', projectStandard.data?.baselineId], queryFn: () => getBaselineDetail(projectStandard.data!.baselineId), enabled: projectStandard.data != null })
  const standardVersionByComponent = useMemo(() => new Map((standardBaseline.data?.items ?? []).map(item => [item.componentId, item.versionNumber])), [standardBaseline.data?.items])
  const standardVersionIdByComponent = useMemo(() => new Map((standardBaseline.data?.items ?? []).flatMap(item => item.versionId ? [[item.componentId, item.versionId] as const] : [])), [standardBaseline.data?.items])
  const children = useMemo(() => {
    const map = new Map<string | null, ConfigurationComponent[]>()
    for (const component of detail.components) map.set(component.parentComponentId, [...(map.get(component.parentComponentId) ?? []), component])
    for (const entries of map.values()) entries.sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, 'zh-CN'))
    return map
  }, [detail.components])
  const testingVersions = useMemo(() => new Map(detail.components.map(component => [component.id, component.versions.filter(version => version.maturity === 'Testing')])), [detail.components])
  const descendantComponentCounts = useMemo(() => {
    const counts = new Map<string, number>()
    const countDescendants = (component: ConfigurationComponent): number => {
      const count = (children.get(component.id) ?? []).reduce((total, child) => total + 1 + countDescendants(child), 0)
      counts.set(component.id, count)
      return count
    }
    for (const root of children.get(null) ?? []) countDescendants(root)
    return counts
  }, [children])
  const { testingBranchIds, testingVersionCounts } = useMemo(() => {
    const branchIds = new Set<string>()
    const versionCounts = new Map<string, number>()
    const countTestingVersions = (component: ConfigurationComponent): number => {
      const count = (testingVersions.get(component.id)?.length ?? 0) + (children.get(component.id) ?? []).reduce((total, child) => total + countTestingVersions(child), 0)
      versionCounts.set(component.id, count)
      if (count > 0) branchIds.add(component.id)
      return count
    }
    for (const root of children.get(null) ?? []) countTestingVersions(root)
    return { testingBranchIds: branchIds, testingVersionCounts: versionCounts }
  }, [children, testingVersions])
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['project', detail.project.id] })
    await queryClient.invalidateQueries({ queryKey: ['projects'] })
  }
  const reset = () => { setFormMode('idle'); setName(''); setReason('') }
  const selectComponent = (componentId: string) => {
    const component = detail.components.find(candidate => candidate.id === componentId)
    setSelectedId(componentId)
    setSelectedVersionId(current => component?.versions.some(version => version.id === current) ? current : component?.versions[0]?.id ?? '')
  }
  useEffect(() => {
    setSelectedId(detail.components[0]?.id ?? null)
    setSelectedVersionId(detail.components[0]?.versions[0]?.id ?? '')
    setFormMode('idle')
    setInspectorTab('versions')
  }, [detail.project.id])
  useEffect(() => {
    if (!focusedVersionId) return
    const component = detail.components.find(candidate => candidate.versions.some(version => version.id === focusedVersionId))
    if (component) {
      setSelectedId(component.id)
      setSelectedVersionId(focusedVersionId)
      setInspectorTab('status')
    }
  }, [detail.components, focusedVersionId])
  const startCreate = (mode: 'create-root' | 'create-child') => { setFormMode(mode); setName(''); setReason('') }
  const startEdit = () => { if (!selected) return; setFormMode('edit'); setName(selected.name); setReason('') }
  const create = useMutation({
    mutationFn: () => createComponent(detail.project.id, { name, reason, parentComponentId: formMode === 'create-child' ? selected?.id ?? null : null }),
    onSuccess: async ({ id }) => { selectComponent(id); reset(); onSuccess('组件已添加。'); await refresh() },
  })
  const update = useMutation({
    mutationFn: () => updateComponent(selected!.id, { name, reason }),
    onSuccess: async () => { reset(); onSuccess('组件已更新。'); await refresh() },
  })
  const remove = useMutation({
    mutationFn: () => deleteComponent(selected!.id, reason),
    onSuccess: async () => { setSelectedId(null); setSelectedVersionId(''); reset(); onSuccess('组件已删除。'); await refresh() },
  })
  const move = useMutation({
    mutationFn: ({ componentId, parentComponentId }: { componentId: string; parentComponentId: string | null }) => moveComponent(componentId, { parentComponentId, reason: '在组件树中拖拽调整层级' }),
    onSuccess: async () => { setDraggingId(null); onSuccess('组件层级已更新。'); await refresh() },
  })
  const addVersion = useMutation({
    mutationFn: () => createComponentVersion(selected!.id, { versionNumber, reason: versionReason, maturity: initialMaturity }),
    onSuccess: async ({ id }) => { setVersionNumber(''); setVersionReason(''); setInitialMaturity('Testing'); setSelectedVersionId(id); setInspectorTab('status'); onSuccess(`${maturityText(initialMaturity)}版本已登记。`); await refresh() },
  })
  const lifecycle = useMutation({
    mutationFn: async () => {
      if (lifecycleAction === 'Recommended') return recommendVersion(selectedVersionId, lifecycleReason)
      if (lifecycleAction === 'Blocked' || lifecycleAction === 'Clear') return changeVersionSafety(selectedVersionId, lifecycleAction, lifecycleReason)
      return changeVersionMaturity(selectedVersionId, lifecycleAction, lifecycleReason)
    },
    onSuccess: async () => { setLifecycleReason(''); onSuccess('版本状态已更新。'); await refresh() },
  })
  const versionImpact = useQuery({ queryKey: ['project-version-impact', selectedVersionId], queryFn: () => getVersionImpact(selectedVersionId), enabled: selectedVersionId !== '' })
  const versionDetail = useQuery({ queryKey: ['project-version-detail', selectedVersionId], queryFn: () => getVersionDetail(selectedVersionId), enabled: selectedVersionId !== '' })
  const addPatch = useMutation({
    mutationFn: () => createVersionPatch(selectedVersionId, { patchCode, title: patchTitle, issueDescription: patchIssue, resolutionDescription: patchResolution, status: patchStatus }),
    onSuccess: async () => {
      setPatchCode('')
      setPatchTitle('')
      setPatchIssue('')
      setPatchResolution('')
      setPatchStatus('Released')
      onSuccess('版本补丁已登记，软件版本号保持不变。')
      await queryClient.invalidateQueries({ queryKey: ['project-version-detail', selectedVersionId] })
    },
  })
  const createBaselineFromLab = useMutation({
    mutationFn: () => {
      const selectedTestingVersions = detail.components.flatMap(component => component.versions.filter(version => selectedTestingVersionIds.includes(version.id)).map(version => ({ componentId: component.id, versionId: version.id })))
      const selectedTestingByComponent = new Map(selectedTestingVersions.map(item => [item.componentId, item.versionId]))
      const versionSelections = detail.components.flatMap(component => {
        const versionId = selectedTestingByComponent.get(component.id) ?? labVersionOverrides[component.id] ?? standardVersionIdByComponent.get(component.id) ?? component.versions.filter(version => version.maturity === 'Released').sort((left, right) => right.sequenceNo - left.sequenceNo)[0]?.id
        return versionId ? [{ componentId: component.id, versionId }] : []
      })
      return createBaseline(detail.project.id, { seriesCode: detail.project.code, baselineCode: labBaselineCode, description: '由实验室测试版本生成', reason: labBaselineReason, versionSelections, testingVersionIds: selectedTestingVersionIds })
    },
    onSuccess: async () => { setSelectedTestingVersionIds([]); setLabVersionOverrides({}); setLabBaselineCode(''); setLabBaselineReason(''); onSuccess('测试版本已发布，并按当前标准的其余版本创建基线草稿。'); await refresh(); await queryClient.invalidateQueries({ queryKey: ['project-baseline-history', detail.project.id] }) },
  })
  const onDrop = (parentComponentId: string | null) => {
    if (!draggingId || draggingId === parentComponentId) return
    const dragged = detail.components.find(component => component.id === draggingId)
    if (dragged?.parentComponentId === parentComponentId) { setDraggingId(null); return }
    move.mutate({ componentId: draggingId, parentComponentId })
  }
  const standardVersionText = (component: ConfigurationComponent) => standardVersionByComponent.has(component.id)
    ? standardVersionByComponent.get(component.id) ?? '结构分类节点'
    : (projectStandard.isLoading || standardBaseline.isLoading ? '正在读取标准' : projectStandard.data ? '标准未包含此组件' : '未设项目标准')
  const rootCount = (component: ConfigurationComponent) => component.versions.length || (descendantComponentCounts.get(component.id) ?? 0)
  const rootCountTitle = (component: ConfigurationComponent) => component.versions.length ? `${component.versions.length} 个已登记版本` : `${descendantComponentCounts.get(component.id) ?? 0} 个后代组件`
  const renderBranchNode = (component: ConfigurationComponent, depth: number) => <div className="branch-node" key={component.id} style={{ paddingLeft: `${depth * 12}px` }}>
    <button type="button" draggable className={`tree-node ${component.id === selectedId ? 'selected' : ''}`} onClick={() => selectComponent(component.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; setDraggingId(component.id) }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(component.id) }}>
      <span className="tree-node-copy"><strong>{component.name}</strong><small className="baseline-version">{standardVersionText(component)}</small></span>
      <span className="tree-node-count" title={`${component.versions.length} 个已登记版本`}>{component.versions.length}</span>
    </button>
    {children.get(component.id)?.length ? <div className="branch-children">{children.get(component.id)!.map(child => renderBranchNode(child, depth + 1))}</div> : null}
  </div>
  const renderTestingNode = (component: ConfigurationComponent, depth: number) => <div className="lab-branch-node" key={component.id} style={{ paddingLeft: `${depth * 12}px` }}>
    <button type="button" className={component.id === selectedId ? 'lab-node selected' : 'lab-node'} onClick={() => selectComponent(component.id)}>
      <span><strong>{component.name}</strong><small>{testingVersions.get(component.id)?.length ? testingVersions.get(component.id)!.map(version => version.versionNumber).join('、') : testingBranchIds.has(component.id) ? '包含测试中的子组件' : '暂无实验室测试版本'}</small></span>
      <span className="testing-count" title={`此分支共 ${testingVersionCounts.get(component.id) ?? 0} 个测试中版本`}><small>测试中</small><b>{testingVersionCounts.get(component.id) ?? 0}</b></span>
    </button>
    {children.get(component.id)?.filter(child => testingBranchIds.has(child.id)).map(child => renderTestingNode(child, depth + 1))}
  </div>
  const versionSelection = selectedVersion ? <div className="selected-version-summary"><strong>{selectedVersion.versionNumber}</strong><small>{maturityText(selectedVersion.maturity)} · {safetyText(selectedVersion.safety)}</small></div> : <p className="empty-state">先在“版本”中选择或登记软件版本。</p>

  return <section className="project-workspace">
    <div className="workspace-heading"><div><span className="section-index">{detail.project.code}</span><h2>{detail.project.name}</h2><p>{detail.project.description || '在此查看项目标准下的组件版本情况，并按需选择、拖拽、维护组件或登记版本。'}</p></div></div>
    <div className="workspace-layout">
      <aside className="component-tree-panel">
        <section className="laboratory-tree"><div className="tree-toolbar"><strong>实验室测试版本</strong><small>根组件完整展示；子组件只在自身或后代存在“测试中”版本时显示。选择测试版本后生成新基线：所选版本会原子发布，其余组件默认保留当前项目标准。</small></div><div className="lab-root-grid">{children.get(null)?.map(root => <section className="lab-root-column" key={root.id}>{renderTestingNode(root, 0)}</section>)}</div>{detail.components.some(component => testingVersions.get(component.id)?.length) && <form className="lab-baseline-form" onSubmit={event => { event.preventDefault(); createBaselineFromLab.mutate() }}><div className="lab-baseline-options">{detail.components.flatMap(component => testingVersions.get(component.id)?.map(version => <label key={version.id}><input type="checkbox" checked={selectedTestingVersionIds.includes(version.id)} onChange={event => setSelectedTestingVersionIds(current => event.target.checked ? [...current, version.id] : current.filter(id => id !== version.id))} /><span>{component.name} · {version.versionNumber}</span></label>) ?? [])}</div><details className="lab-version-overrides"><summary>手动修正其余组件版本</summary><p>默认沿用当前项目标准；没有标准时采用该组件最新已发布版本。</p><div>{detail.components.map(component => { const released = component.versions.filter(version => version.maturity === 'Released').sort((left, right) => right.sequenceNo - left.sequenceNo); const defaultVersionId = standardVersionIdByComponent.get(component.id) ?? released[0]?.id; return released.length && !selectedTestingVersionIds.some(versionId => testingVersions.get(component.id)?.some(version => version.id === versionId)) ? <label key={component.id}>{component.name}<select value={labVersionOverrides[component.id] ?? defaultVersionId ?? ''} onChange={event => setLabVersionOverrides(current => ({ ...current, [component.id]: event.target.value }))}>{released.map(version => <option key={version.id} value={version.id}>{version.versionNumber}</option>)}</select></label> : null })}</div></details><label>新基线名称<input value={labBaselineCode} maxLength={100} placeholder="例如：BL-108" onChange={event => setLabBaselineCode(event.target.value)} required /></label><label>创建原因<input value={labBaselineReason} maxLength={500} onChange={event => setLabBaselineReason(event.target.value)} required /></label><button className="primary-action" type="submit" disabled={selectedTestingVersionIds.length === 0 || createBaselineFromLab.isPending}>{createBaselineFromLab.isPending ? '正在生成' : `将 ${selectedTestingVersionIds.length} 个测试版本发布并生成基线`}</button>{createBaselineFromLab.isError && <p className="error-strip">{createBaselineFromLab.error.message}</p>}</form>}</section>
        <section className="baseline-tree"><div className="tree-toolbar"><strong>当前基线版本</strong><small>{projectStandard.data ? `项目标准：${projectStandard.data.baselineCode}；仅已发布版本可进入新基线` : '尚未设置项目标准；仅已发布版本可进入新基线'}</small></div>
          {detail.components.length ? <div className="component-columns">{children.get(null)?.map(root => <section className="root-component-column" key={root.id}><button type="button" draggable className={`root-node ${root.id === selectedId ? 'selected' : ''}`} onClick={() => selectComponent(root.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; setDraggingId(root.id) }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(root.id) }}><span><strong>{root.name}</strong><small className="baseline-version">{standardVersionText(root)}</small></span><span className="tree-node-count" title={rootCountTitle(root)}>{rootCount(root)}</span></button><div className="root-column-body">{children.get(root.id)?.length ? children.get(root.id)!.map(child => renderBranchNode(child, 0)) : <p className="empty-state">暂无子组件。</p>}<button type="button" className="add-child-node" onClick={() => { selectComponent(root.id); startCreate('create-child') }}>新增 {root.name} 子组件</button></div></section>)}</div> : <p className="empty-state">尚无组件。先新增根组件，再从树上逐层添加零部件。</p>}
        </section>
        <section className="component-create-panel"><div className="tree-create-heading"><div><span className="section-index">组件创建</span><h3>新增组件</h3></div><div className="component-create-actions"><button type="button" onClick={() => startCreate('create-root')}>新增根组件</button>{selected && <button type="button" onClick={() => startCreate('create-child')}>新增 {selected.name} 子组件</button>}</div></div>{(formMode === 'create-root' || formMode === 'create-child') && <form className="workspace-form" onSubmit={(event) => { event.preventDefault(); create.mutate() }}><p className="form-hint wide-field">{formMode === 'create-root' ? '将新增一个与现有根组件并列的组件；没有登记版本时会作为结构分类节点。' : `将新增到 ${selected?.name ?? '当前组件'} 之下；没有登记版本时会作为结构分类节点。`}</p><label className="wide-field">组件名称<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} required /></label><label className="wide-field">创建原因<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} required /></label><div className="form-actions"><button type="button" onClick={reset}>取消</button><button className="primary-action" type="submit" disabled={create.isPending}>{create.isPending ? '正在新增' : formMode === 'create-root' ? '新增根组件' : '新增子组件'}</button></div>{create.isError && <p className="error-strip wide-field">{create.error.message}</p>}</form>}</section>
      </aside>
      <section className="component-inspector">
        {selected ? <><div className="inspector-heading"><div><span className="section-index">已选组件</span><h3>{selected.name}</h3></div><div className="inspector-actions"><button type="button" onClick={startEdit}>编辑</button><button type="button" className="danger-action" onClick={() => { setFormMode('delete'); setReason('') }}>删除</button></div></div>
          <div className="component-meta"><span>版本 {selected.versions.length}</span><span>拖拽可移动层级</span></div>
          {(formMode === 'edit' || formMode === 'delete') && <form className="workspace-form inspector-form" onSubmit={(event) => { event.preventDefault(); if (formMode === 'edit') update.mutate(); else remove.mutate() }}>
            {formMode !== 'delete' && <label className="wide-field">组件名称<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} required /></label>}
            <label className="wide-field">{formMode === 'delete' ? '删除原因' : '修改原因'}<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} required /></label>
            {formMode === 'delete' && <p className="form-hint wide-field">仅允许删除没有子组件且没有版本历史的组件。已有版本、基线和实际配置历史不会被删除。</p>}
            <div className="form-actions"><button type="button" onClick={reset}>取消</button><button className={formMode === 'delete' ? 'danger-action' : 'primary-action'} type="submit" disabled={update.isPending || remove.isPending}>{formMode === 'delete' ? '确认删除' : '保存组件'}</button></div>
            {(update.isError || remove.isError) && <p className="error-strip wide-field">{update.error?.message ?? remove.error?.message}</p>}
          </form>}
          <nav className="inspector-tabs" aria-label="版本管理"><button type="button" className={inspectorTab === 'versions' ? 'active' : ''} onClick={() => setInspectorTab('versions')}>版本</button><button type="button" className={inspectorTab === 'status' ? 'active' : ''} onClick={() => setInspectorTab('status')} disabled={!selectedVersion}>状态</button><button type="button" className={inspectorTab === 'patches' ? 'active' : ''} onClick={() => setInspectorTab('patches')} disabled={!selectedVersion}>补丁</button><button type="button" className={inspectorTab === 'impact' ? 'active' : ''} onClick={() => setInspectorTab('impact')} disabled={!selectedVersion}>影响</button></nav>
          <section className="version-workbench">
            {inspectorTab === 'versions' && <><div className="subsection-heading"><div><span className="section-index">软件版本</span><h3>已登记版本</h3><p className="form-hint">带修复记录的版本会显示标记；点击即可打开状态或补丁详情。</p></div></div>{selected.versions.length ? <div className="version-list">{selected.versions.map(version => <button type="button" key={version.id} className={version.id === selectedVersionId ? 'version-item selected' : 'version-item'} onClick={() => { setSelectedVersionId(version.id); setInspectorTab(version.patchCount > 0 ? 'patches' : 'status') }}><span><strong>{version.versionNumber}{version.patchCount > 0 && <em className="patch-badge">{version.patchCount} 条修复</em>}</strong><small>序列 {version.sequenceNo} · {maturityText(version.maturity)} · {safetyText(version.safety)}</small></span></button>)}</div> : <p className="empty-state">尚未登记软件版本。</p>}<div className="entry-divider" /><div className="subsection-heading"><div><span className="section-index">新增记录</span><h3>登记新版本</h3></div></div><form className="workspace-form inspector-form" onSubmit={(event) => { event.preventDefault(); addVersion.mutate() }}><label className="wide-field">版本号<input value={versionNumber} placeholder="例如：2026.09.01" maxLength={160} onChange={(event) => setVersionNumber(event.target.value)} required /></label><label>登记成熟度<select value={initialMaturity} onChange={(event) => setInitialMaturity(event.target.value as InitialMaturity)}><option value="Draft">草稿</option><option value="Testing">实验室测试</option><option value="Released">已发布</option><option value="Maintenance">维护中</option><option value="Deprecated">已废弃</option></select></label><label className="wide-field">登记原因<input value={versionReason} maxLength={500} onChange={(event) => setVersionReason(event.target.value)} required /></label><div className="form-actions"><button className="primary-action" type="submit" disabled={addVersion.isPending}>{addVersion.isPending ? '正在登记' : `登记${maturityText(initialMaturity)}版本`}</button></div>{addVersion.isError && <p className="error-strip wide-field">{addVersion.error.message}</p>}</form></>}
            {inspectorTab === 'status' && <><div className="subsection-heading"><div><span className="section-index">版本状态</span><h3>状态与推荐</h3></div></div>{versionSelection}{selectedVersion && <form className="workspace-form inspector-form lifecycle-form" onSubmit={(event) => { event.preventDefault(); lifecycle.mutate() }}><label>状态操作<select value={lifecycleAction} onChange={(event) => setLifecycleAction(event.target.value)}><option value="Testing">提交测试</option><option value="Released">发布</option><option value="Maintenance">进入维护</option><option value="Deprecated">废弃</option><option value="Blocked">阻断</option><option value="Clear">解除阻断</option><option value="Recommended">设为推荐</option></select></label><label className="wide-field">操作原因<input value={lifecycleReason} maxLength={500} onChange={(event) => setLifecycleReason(event.target.value)} required /></label><div className="form-actions"><button type="submit" disabled={lifecycle.isPending}>{lifecycle.isPending ? '正在更新' : '更新状态'}</button></div>{lifecycle.isError && <p className="error-strip wide-field">{lifecycle.error.message}</p>}</form>}</>}
            {inspectorTab === 'patches' && <><div className="subsection-heading"><div><span className="section-index">版本补丁</span><h3>问题与修复记录</h3><p className="form-hint">补丁不会改变软件版本号，也不表示机台已经安装。</p></div></div>{versionSelection}{selectedVersion && <>{versionDetail.data?.patches.length ? <div className="patch-list">{versionDetail.data.patches.map(patch => <article className="patch-item" key={patch.id}><div><span className={`patch-status ${patch.status.toLowerCase()}`}>{patchStatusText(patch.status)}</span><strong>{patch.patchCode} · {patch.title}</strong><p><b>问题：</b>{patch.issueDescription}</p><p><b>修复：</b>{patch.resolutionDescription}</p></div><small>{patch.recordedBy}<br />{formatTime(patch.recordedAt)}</small></article>)}</div> : <p className="empty-state">尚未登记补丁。</p>}<div className="entry-divider" /><div className="subsection-heading"><div><span className="section-index">新增记录</span><h3>登记修复</h3></div></div><form className="workspace-form inspector-form" onSubmit={(event) => { event.preventDefault(); addPatch.mutate() }}><label>补丁编号<input value={patchCode} placeholder="例如：HF-001" maxLength={80} onChange={(event) => setPatchCode(event.target.value)} required /></label><label>补丁状态<select value={patchStatus} onChange={(event) => setPatchStatus(event.target.value)}><option value="Draft">草稿</option><option value="Released">已发布</option><option value="Withdrawn">已撤回</option></select></label><label className="wide-field">补丁标题<input value={patchTitle} maxLength={200} onChange={(event) => setPatchTitle(event.target.value)} required /></label><label className="wide-field">问题说明<textarea value={patchIssue} maxLength={2000} onChange={(event) => setPatchIssue(event.target.value)} required /></label><label className="wide-field">修复说明<textarea value={patchResolution} maxLength={2000} onChange={(event) => setPatchResolution(event.target.value)} required /></label><div className="form-actions"><button type="submit" disabled={addPatch.isPending}>{addPatch.isPending ? '正在登记' : '登记补丁'}</button></div>{addPatch.isError && <p className="error-strip wide-field">{addPatch.error.message}</p>}</form></>}</>}
            {inspectorTab === 'impact' && <><div className="subsection-heading"><div><span className="section-index">版本影响</span><h3>使用范围</h3></div></div>{versionSelection}{selectedVersion && <dl className="version-impact"><div><dt>已使用基线</dt><dd>{versionImpact.data?.usedBaselineIds.length ?? '—'}</dd></div><div><dt>当前机台</dt><dd>{versionImpact.data?.currentMachineIds.length ?? '—'}</dd></div><div><dt>目标机台</dt><dd>{versionImpact.data?.targetMachineIds.length ?? '—'}</dd></div><div><dt>历史机台</dt><dd>{versionImpact.data?.historicalMachineIds.length ?? '—'}</dd></div></dl>}</>}
          </section>
        </> : <p className="empty-state">从左侧选择组件，或先创建根组件。</p>}
      </section>
    </div>
    <ProjectBaselineHistory detail={detail} isAdmin={isAdmin} focusedBaselineId={focusedBaselineId} onSuccess={onSuccess} />
  </section>
}
