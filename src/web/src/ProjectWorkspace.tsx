import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { changeVersionMaturity, changeVersionSafety, createComponent, createComponentVersion, createVersionPatch, deleteComponent, exportVersionImpactCsv, getBaselineDetail, getProjectStandard, getVersionDetail, getVersionImpact, moveComponent, recommendVersion, reorderComponent, updateComponent, type ConfigurationComponent, type ProjectDetail } from './catalog-api'
import { Modal } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, HistoryOutlined, PlusOutlined, SortAscendingOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import { PatchBadge, PatchActions, VersionMaintenance } from './VersionRecordTools'
import { DeleteVersionButton } from './DeleteVersionButton'
import { LaboratoryHistory } from './LaboratoryHistory'
import { ProjectBaselineHistory } from './ProjectBaselineHistory'
import { VersionChamberImpact } from './VersionChamberImpact'

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

export function ProjectWorkspace({ canWrite = true, detail, focusedVersionId, focusedBaselineId, focusedComponentId, focusPatch, isAdmin, isSuperAdmin, onOpenMachine, onSuccess }: { canWrite?: boolean; detail: ProjectDetail; focusedVersionId?: string; focusedBaselineId?: string; focusedComponentId?: string; focusPatch?: boolean; onOpenMachine?: (machineId: string) => void; isAdmin: boolean; isSuperAdmin: boolean; onSuccess: (message: string) => void }) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(detail.components[0]?.id ?? null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [formMode, setFormMode] = useState<FormMode>('idle')
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('versions')
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('')
  const [model, setModel] = useState('')
  const [notes, setNotes] = useState('')
  const [reason, setReason] = useState('')
  const [versionNumber, setVersionNumber] = useState('')
  const [versionEntryOpen, setVersionEntryOpen] = useState(false)
  const [versionReason, setVersionReason] = useState('')
  const [initialMaturity, setInitialMaturity] = useState<InitialMaturity>('Testing')
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [lifecycleAction, setLifecycleAction] = useState('Testing')
  const [lifecycleReason, setLifecycleReason] = useState('')
  const [patchCode, setPatchCode] = useState('')
  const [patchEntryOpen, setPatchEntryOpen] = useState(false)
  const [patchTitle, setPatchTitle] = useState('')
  const [patchIssue, setPatchIssue] = useState('')
  const [patchResolution, setPatchResolution] = useState('')
  const [patchStatus, setPatchStatus] = useState('Released')
  const [impactExportReason, setImpactExportReason] = useState('')
  const [rootColumnWidth, setRootColumnWidth] = useState(190)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true)
  const [sorting, setSorting] = useState(false)
  const [laboratoryHistoryOpen, setLaboratoryHistoryOpen] = useState(false)
  const [patchGuide, setPatchGuide] = useState(0)
  useEffect(() => { if (!patchGuide) return; const scroll = window.setTimeout(() => { const inspector = document.getElementById('component-inspector'); inspector?.scrollTo({ top: 0, behavior: 'smooth' }); inspector?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, 50); const timer = window.setTimeout(() => setPatchGuide(0), 4500); return () => { window.clearTimeout(scroll); window.clearTimeout(timer) } }, [patchGuide])
  const [composerRequest, setComposerRequest] = useState(0)
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
    await queryClient.invalidateQueries({ queryKey: ['project-version-detail'] })
  }
  const reset = () => { setFormMode('idle'); setName(''); setReason('') }
  const selectComponent = (componentId: string) => {
    setInspectorCollapsed(false)
    const component = detail.components.find(candidate => candidate.id === componentId)
    setSelectedId(componentId)
    setSelectedVersionId(current => component?.versions.some(version => version.id === current) ? current : component?.versions[0]?.id ?? '')
  }
  useEffect(() => {
    setSelectedId(detail.components[0]?.id ?? null)
    setSelectedVersionId(detail.components[0]?.versions[0]?.id ?? '')
    setFormMode('idle')
    setInspectorTab('versions')
    setInspectorCollapsed(true)
    setSorting(false)
    setComposerRequest(0)
    setLaboratoryHistoryOpen(false)
    setPatchGuide(0)
    const savedWidth = Number(window.localStorage.getItem(`confighub.root-column-width:${detail.project.id}`))
    setRootColumnWidth(Number.isFinite(savedWidth) && savedWidth >= 150 && savedWidth <= 320 ? savedWidth : 190)
  }, [detail.project.id])
  const updateRootColumnWidth = (value: number) => {
    setRootColumnWidth(value)
    window.localStorage.setItem(`confighub.root-column-width:${detail.project.id}`, String(value))
  }
  useEffect(() => {
    if (!focusedComponentId) return
    const component = detail.components.find(candidate => candidate.id === focusedComponentId)
    if (component) {
      setSelectedId(component.id)
      setSelectedVersionId(component.versions[0]?.id ?? '')
      setInspectorTab('versions')
      setInspectorCollapsed(false)
    }
  }, [detail.components, focusedComponentId])
  useEffect(() => {
    if (!focusedVersionId) return
    const component = detail.components.find(candidate => candidate.versions.some(version => version.id === focusedVersionId))
    if (component) {
      setSelectedId(component.id)
      setSelectedVersionId(focusedVersionId)
      setInspectorTab(focusPatch ? 'patches' : 'status')
      if (focusPatch) setPatchGuide(Date.now())
      setInspectorCollapsed(false)
    }
  }, [detail.components, focusedVersionId, focusPatch])
  const startCreate = (mode: 'create-root' | 'create-child') => { setFormMode(mode); setName(''); setOwner(''); setModel(''); setNotes(''); setReason('') }
  const startEdit = () => { if (!selected) return; setFormMode('edit'); setName(selected.name); setOwner(selected.owner ?? ''); setModel(selected.model ?? ''); setNotes(selected.notes ?? ''); setReason('') }
  const create = useMutation({
    mutationFn: () => createComponent(detail.project.id, { name, owner, model, notes, reason, parentComponentId: formMode === 'create-child' ? selected?.id ?? null : null }),
    onSuccess: async ({ id }) => { selectComponent(id); reset(); onSuccess('组件已添加。'); await refresh() },
  })
  const update = useMutation({
    mutationFn: () => updateComponent(selected!.id, { name, owner, model, notes, reason }),
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
  const reorder = useMutation({
    mutationFn: ({ componentId, direction }: { componentId: string; direction: 'Up' | 'Down' }) => reorderComponent(componentId, direction, '调整同级组件显示顺序'),
    onSuccess: async () => { onSuccess('组件顺序已更新。'); await refresh() },
  })
  const addVersion = useMutation({
    mutationFn: () => createComponentVersion(selected!.id, { versionNumber, reason: versionReason, maturity: initialMaturity }),
    onSuccess: async ({ id }) => { setVersionEntryOpen(false); setVersionNumber(''); setVersionReason(''); setInitialMaturity('Testing'); setSelectedVersionId(id); setInspectorTab('status'); onSuccess(`${maturityText(initialMaturity)}版本已登记。`); await refresh() },
  })
  const lifecycle = useMutation({
    mutationFn: async () => {
      if (lifecycleAction === 'Recommended') return recommendVersion(selectedVersionId, lifecycleReason)
      if (lifecycleAction === 'Blocked' || lifecycleAction === 'Clear') return changeVersionSafety(selectedVersionId, lifecycleAction, lifecycleReason)
      return changeVersionMaturity(selectedVersionId, lifecycleAction, lifecycleReason)
    },
    onSuccess: async () => { setLifecycleReason(''); onSuccess('版本状态已更新。'); await refresh() },
  })
  const versionImpact = useQuery({ queryKey: ['project-version-impact', selectedVersionId], queryFn: () => getVersionImpact(selectedVersionId), enabled: selectedVersionId !== '' && inspectorTab === 'impact' })
  const exportImpact = useMutation({
    mutationFn: () => exportVersionImpactCsv(selectedVersionId, impactExportReason),
    onSuccess: ({ blob, filename }) => {
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = filename
      link.click()
      URL.revokeObjectURL(downloadUrl)
      setImpactExportReason('')
      onSuccess('版本影响清单已导出，并已记录导出原因。')
    },
  })
  const versionDetail = useQuery({ queryKey: ['project-version-detail', selectedVersionId], queryFn: () => getVersionDetail(selectedVersionId), enabled: selectedVersionId !== '' })
  const addPatch = useMutation({
    mutationFn: () => createVersionPatch(selectedVersionId, { patchCode, title: patchTitle, issueDescription: patchIssue, resolutionDescription: patchResolution, status: patchStatus }),
    onSuccess: async () => {
      setPatchEntryOpen(false)
      setPatchCode('')
      setPatchTitle('')
      setPatchIssue('')
      setPatchResolution('')
      setPatchStatus('Released')
      onSuccess('版本补丁已登记，软件版本号保持不变。')
      await refresh()
    },
  })
  useEffect(() => {
    setVersionEntryOpen(false)
    setVersionNumber('')
    setVersionReason('')
    setInitialMaturity('Testing')
    addVersion.reset()
  }, [selectedId, detail.project.id])
  useEffect(() => {
    setPatchEntryOpen(false)
    setPatchCode('')
    setPatchTitle('')
    setPatchIssue('')
    setPatchResolution('')
    setPatchStatus('Released')
    addPatch.reset()
  }, [selectedId, selectedVersionId, detail.project.id])
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
  const openPatches = (componentId: string, versionId: string) => { selectComponent(componentId); setSelectedVersionId(versionId); setInspectorTab('patches'); setPatchGuide(Date.now()) }
  const patchPreviewFor = (component: ConfigurationComponent) => component.versions.find(version => version.id === standardVersionIdByComponent.get(component.id)) ?? null
  const renderPatchPreview = (component: ConfigurationComponent) => {
    const version = patchPreviewFor(component)
    return version ? <PatchBadge version={version} onOpen={() => openPatches(component.id, version.id)} /> : null
  }
  const renderBranchNode = (component: ConfigurationComponent, depth: number) => <div className="branch-node" key={component.id} style={{ paddingLeft: `${depth * 12}px` }}>
    <div className="tree-node-row"><button type="button" draggable={canWrite} className={`tree-node ${component.id === selectedId ? 'selected' : ''}`} onClick={() => selectComponent(component.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; setDraggingId(component.id) }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(component.id) }}>
      <span className="tree-node-copy"><strong>{component.name}</strong><small className="baseline-version">{standardVersionText(component)}</small></span>
    </button>{renderPatchPreview(component)}</div>
    {children.get(component.id)?.length ? <div className="branch-children">{children.get(component.id)!.map(child => renderBranchNode(child, depth + 1))}</div> : null}
  </div>
  const renderTestingNode = (component: ConfigurationComponent, depth: number) => <div className="lab-branch-node" key={component.id} style={{ paddingLeft: `${depth * 12}px` }}>
    <button type="button" title={`${component.name} ${testingVersions.get(component.id)?.map(version => version.versionNumber).join('、') ?? ''}`} className={component.id === selectedId ? 'lab-node selected' : 'lab-node'} onClick={() => selectComponent(component.id)}>
      <span><strong>{component.name}</strong><small>{testingVersions.get(component.id)?.length ? testingVersions.get(component.id)!.map(version => version.versionNumber).join('、') : testingBranchIds.has(component.id) ? '' : '暂无测试'}</small></span>
      <span className="testing-count" title={`此分支共 ${testingVersionCounts.get(component.id) ?? 0} 个测试中版本`}><small>测试中</small><b>{testingVersionCounts.get(component.id) ?? 0}</b></span>
    </button>
    {testingVersions.get(component.id)?.map(version => <PatchBadge key={version.id} version={version} onOpen={() => openPatches(component.id, version.id)} />)}
    {children.get(component.id)?.filter(child => testingBranchIds.has(child.id)).map(child => renderTestingNode(child, depth + 1))}
  </div>
  const versionSelection = selectedVersion ? <div className="selected-version-summary"><strong>{selectedVersion.versionNumber}</strong><small>{maturityText(selectedVersion.maturity)} · {safetyText(selectedVersion.safety)}</small>{isSuperAdmin && <DeleteVersionButton version={selectedVersion} componentName={selected?.name ?? ''} onDeleted={async () => { setSelectedVersionId(''); setInspectorTab('versions'); await refresh(); onSuccess('版本已删除。') }} />}</div> : <p className="empty-state">先在“版本”中选择或登记软件版本。</p>

  const metadataFields = <><label>组件负责人<input value={owner} maxLength={160} onChange={event => setOwner(event.target.value)} /></label><label>组件型号<input value={model} maxLength={200} onChange={event => setModel(event.target.value)} /></label><label className="wide-field">组件备注<textarea value={notes} maxLength={2000} onChange={event => setNotes(event.target.value)} /></label></>
  return <section className={canWrite ? 'project-workspace' : 'project-workspace read-only-workspace'}>
    <div className={`workspace-layout ${inspectorCollapsed ? 'inspector-collapsed' : ''}`}>
      <aside className="component-tree-panel">
        <section className="laboratory-tree">
          <div className="tree-toolbar tree-toolbar-line"><div><strong>实验室测试版本</strong><small>测试中的版本与组件层级</small></div><div className="toolbar-actions">
            <button type="button" onClick={() => setLaboratoryHistoryOpen(true)}><HistoryOutlined aria-hidden /> 测试历史</button>
            <button hidden={!canWrite} type="button" onClick={() => setComposerRequest(value => value + 1)} disabled={!detail.components.some(component => testingVersions.get(component.id)?.length)}>从测试版本创建基线</button>
          </div></div>
          <div className="lab-root-grid">{children.get(null)?.map(root => <section className="lab-root-column" key={root.id}>{renderTestingNode(root, 0)}</section>)}</div>
        </section>
        <section className="baseline-tree"><div className={`tree-toolbar root-drop-target ${draggingId ? 'dragging' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); onDrop(null) }}><div className="tree-toolbar-line"><div><strong>当前基线版本</strong><small>{draggingId ? '松开鼠标：恢复为根组件' : projectStandard.data ? `项目标准：${projectStandard.data.baselineCode}；仅已发布版本可进入新基线` : '尚未设置项目标准；仅已发布版本可进入新基线'}</small></div>{detail.components.length > 0 && <label className="component-density-control" title="拖动后会记住此项目的组件列宽"><span>列宽</span><input type="range" min="150" max="320" step="10" value={rootColumnWidth} onChange={event => updateRootColumnWidth(Number(event.target.value))} /></label>}<button hidden={!canWrite} type="button" className="sort-toggle" aria-pressed={sorting} onClick={() => setSorting(value => !value)}><SortAscendingOutlined aria-hidden /> 排序</button></div></div>
          {detail.components.length ? <div className="component-columns" style={{ '--root-column-min': `${rootColumnWidth}px` } as CSSProperties}>{children.get(null)?.map(root => <section className="root-component-column" key={root.id}><div className="root-node-wrap"><button type="button" draggable className={`root-node ${root.id === selectedId ? 'selected' : ''}`} onClick={() => selectComponent(root.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; setDraggingId(root.id) }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(root.id) }}><span><strong>{root.name}</strong><small className="baseline-version">{standardVersionText(root)}</small></span><span className="tree-node-count" title={rootCountTitle(root)}>{rootCount(root)}</span></button>{renderPatchPreview(root)}{sorting && <div className="root-order-actions"><button type="button" title="向左排序" aria-label="向左排序" disabled={reorder.isPending || children.get(null)?.[0]?.id === root.id} onClick={() => reorder.mutate({ componentId: root.id, direction: 'Up' })}><ArrowLeftOutlined /></button><button type="button" title="向右排序" aria-label="向右排序" disabled={reorder.isPending || children.get(null)?.at(-1)?.id === root.id} onClick={() => reorder.mutate({ componentId: root.id, direction: 'Down' })}><ArrowRightOutlined /></button></div>}</div><div className="root-column-body">{children.get(root.id)?.length ? children.get(root.id)!.map(child => renderBranchNode(child, 0)) : <p className="empty-state">暂无子组件。</p>}<button hidden={!canWrite} type="button" className="add-child-node" onClick={() => { selectComponent(root.id); startCreate('create-child') }}>新增 {root.name} 子组件</button></div></section>)}</div> : <p className="empty-state">尚无组件。先新增根组件，再从树上逐层添加零部件。</p>}
        </section>
        <section hidden={!canWrite} className="component-create-panel"><div className="tree-create-heading"><div><span className="section-index">组件创建</span><h3>新增组件</h3></div><div className="component-create-actions"><button hidden={!canWrite} type="button" onClick={() => startCreate('create-root')}>新增根组件</button>{selected && <button type="button" onClick={() => startCreate('create-child')}>新增 {selected.name} 子组件</button>}</div></div>{(formMode === 'create-root' || formMode === 'create-child') && <form hidden={!canWrite} className="workspace-form" onSubmit={(event) => { event.preventDefault(); create.mutate() }}><p className="form-hint wide-field">{formMode === 'create-root' ? '将新增一个与现有根组件并列的组件；没有登记版本时会作为结构分类节点。' : `将新增到 ${selected?.name ?? '当前组件'} 之下；没有登记版本时会作为结构分类节点。`}</p><label className="wide-field">组件名称<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} required /></label>{metadataFields}<label className="wide-field">创建原因<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} required /></label><div className="form-actions"><button type="button" onClick={reset}>取消</button><button className="primary-action" type="submit" disabled={create.isPending}>{create.isPending ? '正在新增' : formMode === 'create-root' ? '新增根组件' : '新增子组件'}</button></div>{create.isError && <p className="error-strip wide-field">{create.error.message}</p>}</form>}</section>
      </aside>
      <section id="component-inspector" className={`component-inspector ${inspectorCollapsed ? 'collapsed' : ''}`}>
        {inspectorCollapsed ? <button type="button" className="inspector-toggle" title="展开已选组件和版本管理" aria-label="展开已选组件和版本管理" onClick={() => setInspectorCollapsed(false)}><MenuUnfoldOutlined /></button> : selected ? <><div className="inspector-heading"><div><span className="section-index">已选组件</span><h3>{selected.name}</h3></div><div className="inspector-actions"><button type="button" className="inspector-toggle" title="收起已选组件面板" aria-label="收起已选组件面板" onClick={() => setInspectorCollapsed(true)}><MenuFoldOutlined /></button><button hidden={!canWrite} type="button" onClick={startEdit}>编辑</button>{isAdmin && <button type="button" className="danger-action" onClick={() => { setFormMode('delete'); setReason('') }}>删除</button>}</div></div>
          <dl className="component-profile"><div><dt>负责人</dt><dd>{selected.owner || '未填写'}</dd></div><div><dt>型号</dt><dd>{selected.model || '未填写'}</dd></div>{selected.notes && <div className="component-profile-notes"><dt>备注</dt><dd>{selected.notes}</dd></div>}</dl>
          {(formMode === 'edit' || formMode === 'delete') && <form hidden={!canWrite} className="workspace-form inspector-form" onSubmit={(event) => { event.preventDefault(); if (formMode === 'edit') update.mutate(); else Modal.confirm({ title: `删除组件「${selected.name}」？`, content: `将同时删除该组件的 ${selected.versions.length} 个版本及补丁记录。操作无法恢复；已被基线或机台历史引用的组件会拒绝删除。`, okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: async () => { try { await remove.mutateAsync() } catch { /* The component form shows the server error after the dialog closes. */ } } }) }}>
            {formMode !== 'delete' && <label className="wide-field">组件名称<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} required /></label>}
            {formMode === 'edit' && metadataFields}<label className="wide-field">{formMode === 'delete' ? '删除原因' : '修改原因'}<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} required /></label>
            {formMode === 'delete' && <p className="form-hint wide-field">管理员可删除组件及其版本、补丁。请先移走子组件；已进入基线或机台历史的组件需保留。</p>}
            <div className="form-actions"><button type="button" onClick={reset}>取消</button><button className={formMode === 'delete' ? 'danger-action' : 'primary-action'} type="submit" disabled={update.isPending || remove.isPending}>{formMode === 'delete' ? '确认删除' : '保存组件'}</button></div>
            {(update.isError || remove.isError) && <p className="error-strip wide-field">{update.error?.message ?? remove.error?.message}</p>}
          </form>}
          <nav className="inspector-tabs" aria-label="版本管理"><button type="button" className={inspectorTab === 'versions' ? 'active' : ''} onClick={() => setInspectorTab('versions')}>版本</button><button type="button" className={inspectorTab === 'status' ? 'active' : ''} onClick={() => setInspectorTab('status')} disabled={!selectedVersion}>状态</button><button type="button" className={inspectorTab === 'patches' ? 'active' : ''} onClick={() => setInspectorTab('patches')} disabled={!selectedVersion}>补丁</button><button type="button" className={inspectorTab === 'impact' ? 'active' : ''} onClick={() => setInspectorTab('impact')} disabled={!selectedVersion}>影响</button></nav>
          <section className="version-workbench">
            {patchGuide > 0 && <p className="patch-location-guide" role="status">已打开 {selected?.name} · {selectedVersion?.versionNumber} 的补丁记录</p>}
            {isSuperAdmin && selectedVersion && <VersionMaintenance key={selectedVersion.id} version={selectedVersion} onSaved={async () => { await refresh(); onSuccess('调测修改已保存，历史快照保持不变。') }} />}
            {inspectorTab === 'versions' && <><div className="subsection-heading"><div><span className="section-index">软件版本</span><h3>已登记版本</h3><p className="form-hint">带修复记录的版本会显示标记；点击即可打开状态或补丁详情。</p></div>{canWrite && !versionEntryOpen && <div className="toolbar-actions"><button type="button" onClick={() => setVersionEntryOpen(true)}><PlusOutlined aria-hidden />登记新版本</button></div>}</div>{selected.versions.length ? <div className="version-list">{selected.versions.map(version => <div className="version-record-row" key={version.id}><button type="button" className={version.id === selectedVersionId ? 'version-item selected' : 'version-item'} onClick={() => { setSelectedVersionId(version.id); setInspectorTab('status') }}><span><strong>{version.versionNumber}</strong><small>序列 {version.sequenceNo} · {maturityText(version.maturity)} · {safetyText(version.safety)}</small></span></button><PatchBadge version={version} onOpen={() => openPatches(selected.id, version.id)} />{isSuperAdmin && <DeleteVersionButton version={version} componentName={selected.name} onDeleted={async () => { if (selectedVersionId === version.id) setSelectedVersionId(selected.versions.find(item => item.id !== version.id)?.id ?? ''); queryClient.removeQueries({ queryKey: ['project-version-detail', version.id] }); await refresh(); onSuccess('版本已删除，组件和其他版本保持不变。') }} />}</div>)}</div> : <p className="empty-state">尚未登记软件版本。</p>}<div hidden={!canWrite || !versionEntryOpen} className="entry-divider" /><div hidden={!canWrite || !versionEntryOpen} className="subsection-heading"><div><span className="section-index">新增记录</span><h3>登记新版本</h3></div></div><form hidden={!canWrite || !versionEntryOpen} className="workspace-form inspector-form" onSubmit={(event) => { event.preventDefault(); addVersion.mutate() }}><label className="wide-field">版本号<input value={versionNumber} placeholder="例如：2026.09.01" maxLength={160} onChange={(event) => setVersionNumber(event.target.value)} required /></label><label>登记成熟度<select value={initialMaturity} onChange={(event) => setInitialMaturity(event.target.value as InitialMaturity)}><option value="Draft">草稿</option><option value="Testing">实验室测试</option><option value="Released">已发布</option><option value="Maintenance">维护中</option><option value="Deprecated">已废弃</option></select></label><label className="wide-field">登记原因<input value={versionReason} maxLength={500} onChange={(event) => setVersionReason(event.target.value)} required /></label><div className="form-actions"><button type="button" onClick={() => setVersionEntryOpen(false)} disabled={addVersion.isPending}>取消登记版本</button><button className="primary-action" type="submit" disabled={addVersion.isPending}>{addVersion.isPending ? '正在登记' : `登记${maturityText(initialMaturity)}版本`}</button></div>{addVersion.isError && <p className="error-strip wide-field">{addVersion.error.message}</p>}</form></>}
            {inspectorTab === 'status' && <><div className="subsection-heading"><div><span className="section-index">版本状态</span><h3>状态与推荐</h3></div></div>{versionSelection}{selectedVersion && <form hidden={!canWrite} className="workspace-form inspector-form lifecycle-form" onSubmit={(event) => { event.preventDefault(); lifecycle.mutate() }}><label>状态操作<select value={lifecycleAction} onChange={(event) => setLifecycleAction(event.target.value)}><option value="Testing">提交测试</option><option value="Released">发布</option><option value="Maintenance">进入维护</option><option value="Deprecated">废弃</option><option value="Blocked">阻断</option><option value="Clear">解除阻断</option><option value="Recommended">设为推荐</option></select></label><label className="wide-field">操作原因<input value={lifecycleReason} maxLength={500} onChange={(event) => setLifecycleReason(event.target.value)} required /></label><div className="form-actions"><button type="submit" disabled={lifecycle.isPending}>{lifecycle.isPending ? '正在更新' : '更新状态'}</button></div>{lifecycle.isError && <p className="error-strip wide-field">{lifecycle.error.message}</p>}</form>}{selectedVersion && <section className="version-history"><div><span className="section-index">生命周期</span><h4>{selectedVersion.maturity === 'Testing' ? '实验室测试时间线' : '版本时间线'}</h4></div>{versionDetail.data?.transitions.length ? <ol>{versionDetail.data.transitions.map(transition => <li key={`${transition.axis}-${transition.occurredAt}-${transition.toState}`}><span>{transition.axis === 'Maturity' ? '成熟度' : '安全'}</span><strong>{transition.axis === 'Maturity' ? `${maturityText(transition.fromState)} → ${maturityText(transition.toState)}` : `${safetyText(transition.fromState)} → ${safetyText(transition.toState)}`}</strong><small>{formatTime(transition.occurredAt)} · {transition.actor}<br />{transition.reason}</small></li>)}</ol> : <p className="empty-state">正在读取版本时间线。</p>}</section>}</>}
            {inspectorTab === 'patches' && <><div className="subsection-heading"><div><span className="section-index">版本补丁</span><h3>问题与修复记录</h3><p className="form-hint">补丁不会改变软件版本号，也不表示机台已经安装。</p></div>{canWrite && selectedVersion && !patchEntryOpen && <div className="toolbar-actions"><button type="button" onClick={() => setPatchEntryOpen(true)}><PlusOutlined aria-hidden />登记补丁</button></div>}</div>{versionSelection}{selectedVersion && <>{versionDetail.data?.patches.length ? <div className="patch-list">{versionDetail.data.patches.slice().sort((a, b) => Number(b.status === 'Released') - Number(a.status === 'Released')).map(patch => <article className="patch-item" key={patch.id}><div><span className={`patch-status ${patch.status.toLowerCase()}`}>{patchStatusText(patch.status)}</span><strong>{patch.patchCode} · {patch.title}</strong><p><b>问题：</b>{patch.issueDescription}</p><p><b>修复：</b>{patch.resolutionDescription}</p></div><small>{patch.recordedBy}<br />{formatTime(patch.recordedAt)}<PatchActions canWrite={canWrite} patch={patch} isAdmin={isAdmin || isSuperAdmin} onSaved={async () => { await refresh(); onSuccess('补丁操作已保存。') }} /></small></article>)}</div> : <p className="empty-state">尚未登记补丁。</p>}<div hidden={!canWrite || !patchEntryOpen} className="entry-divider" /><div hidden={!canWrite || !patchEntryOpen} className="subsection-heading"><div><span className="section-index">新增记录</span><h3>登记修复</h3></div></div><form hidden={!canWrite || !patchEntryOpen} className="workspace-form inspector-form" onSubmit={(event) => { event.preventDefault(); addPatch.mutate() }}><label>补丁编号<input value={patchCode} placeholder="例如：HF-001" maxLength={80} onChange={(event) => setPatchCode(event.target.value)} required /></label><label>补丁状态<select value={patchStatus} onChange={(event) => setPatchStatus(event.target.value)}><option value="Draft">草稿</option><option value="Released">已发布</option><option value="Withdrawn">已撤回</option></select></label><label className="wide-field">补丁标题<input value={patchTitle} maxLength={200} onChange={(event) => setPatchTitle(event.target.value)} required /></label><label className="wide-field">问题说明<textarea value={patchIssue} maxLength={2000} onChange={(event) => setPatchIssue(event.target.value)} required /></label><label className="wide-field">修复说明<textarea value={patchResolution} maxLength={2000} onChange={(event) => setPatchResolution(event.target.value)} required /></label><div className="form-actions"><button type="button" onClick={() => setPatchEntryOpen(false)} disabled={addPatch.isPending}>取消登记补丁</button><button type="submit" disabled={addPatch.isPending}>{addPatch.isPending ? '正在登记' : '登记补丁'}</button></div>{addPatch.isError && <p className="error-strip wide-field">{addPatch.error.message}</p>}</form></>}</>}
            {inspectorTab === 'impact' && <><div className="subsection-heading"><div><span className="section-index">版本影响</span><h3>使用范围</h3></div></div>{versionSelection}{selectedVersion && <><dl className="version-impact"><div><dt>已使用基线</dt><dd>{versionImpact.data?.usedBaselineIds.length ?? '—'}</dd></div><div><dt>当前机台</dt><dd>{versionImpact.data?.currentMachineIds.length ?? '—'}</dd></div><div><dt>目标机台</dt><dd>{versionImpact.data?.targetMachineIds.length ?? '—'}</dd></div><div><dt>历史机台</dt><dd>{versionImpact.data?.historicalMachineIds.length ?? '—'}</dd></div></dl><VersionChamberImpact data={versionImpact.data?.chamberImpact} isLoading={versionImpact.isLoading} error={versionImpact.error} onRetry={() => { void versionImpact.refetch() }} onOpenMachine={onOpenMachine ?? (() => {})} /><form hidden={!canWrite} className="workspace-form inspector-form impact-export-form" onSubmit={event => { event.preventDefault(); exportImpact.mutate() }}><label className="wide-field">导出原因<input value={impactExportReason} maxLength={500} placeholder="例如：安全排查、评审材料" onChange={event => setImpactExportReason(event.target.value)} required /></label><div className="form-actions"><button type="submit" disabled={exportImpact.isPending}>{exportImpact.isPending ? '正在导出' : '导出影响清单'}</button></div>{exportImpact.isError && <p className="error-strip wide-field">{exportImpact.error.message}</p>}</form></>}</>}
          </section>
        </> : <p className="empty-state">从左侧选择组件，或先创建根组件。</p>}
      </section>
    </div>
    <LaboratoryHistory open={laboratoryHistoryOpen} onClose={() => setLaboratoryHistoryOpen(false)} detail={detail} />
    <ProjectBaselineHistory canWrite={canWrite} composerRequest={composerRequest} detail={detail} isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} focusedBaselineId={focusedBaselineId} onOpenPatches={openPatches} onSuccess={onSuccess} />
  </section>
}
