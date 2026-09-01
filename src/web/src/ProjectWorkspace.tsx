import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { changeVersionMaturity, changeVersionSafety, createComponent, createComponentVersion, createVersionPatch, deleteComponent, getBaselineDetail, getProjectStandard, getVersionDetail, getVersionImpact, moveComponent, recommendVersion, updateComponent, type ConfigurationComponent, type ProjectDetail } from './catalog-api'

type FormMode = 'idle' | 'create-root' | 'create-child' | 'edit' | 'delete'

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

export function ProjectWorkspace({ detail, focusedVersionId, onSuccess }: { detail: ProjectDetail; focusedVersionId?: string; onSuccess: (message: string) => void }) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(detail.components[0]?.id ?? null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [formMode, setFormMode] = useState<FormMode>('idle')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  const [versionNumber, setVersionNumber] = useState('')
  const [versionReason, setVersionReason] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [lifecycleAction, setLifecycleAction] = useState('Testing')
  const [lifecycleReason, setLifecycleReason] = useState('')
  const [patchCode, setPatchCode] = useState('')
  const [patchTitle, setPatchTitle] = useState('')
  const [patchIssue, setPatchIssue] = useState('')
  const [patchResolution, setPatchResolution] = useState('')
  const [patchStatus, setPatchStatus] = useState('Released')
  const selected = detail.components.find(component => component.id === selectedId) ?? null
  const projectStandard = useQuery({ queryKey: ['workspace-project-standard', detail.project.id], queryFn: () => getProjectStandard(detail.project.id) })
  const standardBaseline = useQuery({ queryKey: ['baseline-detail', projectStandard.data?.baselineId], queryFn: () => getBaselineDetail(projectStandard.data!.baselineId), enabled: projectStandard.data != null })
  const standardVersionByComponent = useMemo(() => new Map((standardBaseline.data?.items ?? []).map(item => [item.componentId, item.versionNumber])), [standardBaseline.data?.items])
  const children = useMemo(() => {
    const map = new Map<string | null, ConfigurationComponent[]>()
    for (const component of detail.components) map.set(component.parentComponentId, [...(map.get(component.parentComponentId) ?? []), component])
    for (const entries of map.values()) entries.sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code))
    return map
  }, [detail.components])
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['project', detail.project.id] })
    await queryClient.invalidateQueries({ queryKey: ['projects'] })
  }
  const reset = () => { setFormMode('idle'); setCode(''); setName(''); setReason('') }
  useEffect(() => {
    setSelectedId(detail.components[0]?.id ?? null)
    setFormMode('idle')
  }, [detail.project.id])
  useEffect(() => {
    if (!focusedVersionId) return
    const component = detail.components.find(candidate => candidate.versions.some(version => version.id === focusedVersionId))
    if (component) {
      setSelectedId(component.id)
      setSelectedVersionId(focusedVersionId)
    }
  }, [detail.components, focusedVersionId])
  const startCreate = (mode: 'create-root' | 'create-child') => { setFormMode(mode); setCode(''); setName(''); setReason('') }
  const startEdit = () => { if (!selected) return; setFormMode('edit'); setCode(selected.code); setName(selected.name); setReason('') }
  const create = useMutation({
    mutationFn: () => createComponent(detail.project.id, { code, name, reason, parentComponentId: formMode === 'create-child' ? selected?.id ?? null : null }),
    onSuccess: async ({ id }) => { setSelectedId(id); reset(); onSuccess('组件已添加。'); await refresh() },
  })
  const update = useMutation({
    mutationFn: () => updateComponent(selected!.id, { code, name, reason }),
    onSuccess: async () => { reset(); onSuccess('组件已更新。'); await refresh() },
  })
  const remove = useMutation({
    mutationFn: () => deleteComponent(selected!.id, reason),
    onSuccess: async () => { setSelectedId(null); reset(); onSuccess('组件已删除。'); await refresh() },
  })
  const move = useMutation({
    mutationFn: async ({ componentId, parentComponentId }: { componentId: string; parentComponentId: string | null }) => {
      return moveComponent(componentId, { parentComponentId, reason: '在组件树中拖拽调整层级' })
    },
    onSuccess: async () => { setDraggingId(null); onSuccess('组件层级已更新。'); await refresh() },
  })
  const addVersion = useMutation({
    mutationFn: () => createComponentVersion(selected!.id, { versionNumber, reason: versionReason }),
    onSuccess: async ({ id }) => { setVersionNumber(''); setVersionReason(''); setSelectedVersionId(id); onSuccess('软件版本已登记。'); await refresh() },
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
  const onDrop = (parentComponentId: string | null) => {
    if (!draggingId || draggingId === parentComponentId) return
    const dragged = detail.components.find(component => component.id === draggingId)
    if (dragged?.parentComponentId === parentComponentId) { setDraggingId(null); return }
    move.mutate({ componentId: draggingId, parentComponentId })
  }
  const standardVersionText = (component: ConfigurationComponent) => standardVersionByComponent.get(component.id) ?? (projectStandard.isLoading || standardBaseline.isLoading ? '正在读取标准' : projectStandard.data ? '标准未包含此组件' : '未设项目标准')
  const renderBranchNode = (component: ConfigurationComponent, depth: number) => <div className="branch-node" key={component.id} style={{ paddingLeft: `${depth * 12}px` }}>
    <button type="button" draggable className={`tree-node ${component.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(component.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; setDraggingId(component.id) }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(component.id) }}>
      <span className="tree-node-level">{depth === 0 ? '子组件' : `第 ${depth + 2} 层组件`}</span>
      <span className="tree-node-copy"><strong>{component.code}</strong><small>{component.name}</small><small className="baseline-version">标准基线：{standardVersionText(component)}</small></span>
      <span className="tree-node-count" title={`${component.versions.length} 个已登记版本`}>{component.versions.length}</span>
    </button>
    {children.get(component.id)?.length ? <div className="branch-children">{children.get(component.id)!.map(child => renderBranchNode(child, depth + 1))}</div> : null}
  </div>

  return <section className="project-workspace">
    <div className="workspace-heading"><div><span className="section-index">{detail.project.code}</span><h2>{detail.project.name}</h2><p>{detail.project.description || '在此查看项目标准下的组件版本情况，并按需选择、拖拽、维护组件或登记版本。'}</p></div></div>
    <div className="workspace-layout">
      <aside className="component-tree-panel">
        <div className="tree-toolbar"><strong>软件版本情况</strong><small>{projectStandard.data ? `项目标准：${projectStandard.data.baselineCode}；拖拽节点到另一节点可改变父级` : '尚未设置项目标准；拖拽节点到另一节点可改变父级'}</small></div>
        <button type="button" className="tree-root-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(null) }}>拖到这里：设为根组件</button>
        {detail.components.length ? <div className="component-columns">{children.get(null)?.map(root => <section className="root-component-column" key={root.id}><button type="button" draggable className={`root-node ${root.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(root.id)} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; setDraggingId(root.id) }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(root.id) }}><span><small>根组件</small><strong>{root.code}</strong><em>{root.name}</em><small className="baseline-version">标准基线：{standardVersionText(root)}</small></span><span className="tree-node-count" title={`${root.versions.length} 个已登记版本`}>{root.versions.length}</span></button><div className="root-column-body">{children.get(root.id)?.length ? children.get(root.id)!.map(child => renderBranchNode(child, 0)) : <p className="empty-state">暂无子组件。</p>}<button type="button" className="add-child-node" onClick={() => { setSelectedId(root.id); startCreate('create-child') }}>新增 {root.code} 子组件</button></div></section>)}<button type="button" className="add-root-column" onClick={() => startCreate('create-root')}>新增根组件</button></div> : <p className="empty-state">尚无组件。先新增根组件，再从树上逐层添加零部件。</p>}
        <section className="component-create-panel"><div className="tree-create-heading"><div><span className="section-index">组件创建</span><h3>新增组件</h3></div><div className="component-create-actions"><button type="button" onClick={() => startCreate('create-root')}>新增根组件</button>{selected && <button type="button" onClick={() => startCreate('create-child')}>新增 {selected.code} 子组件</button>}</div></div>{(formMode === 'create-root' || formMode === 'create-child') && <form className="workspace-form" onSubmit={(event) => { event.preventDefault(); create.mutate() }}><p className="form-hint wide-field">{formMode === 'create-root' ? '将新增一个与现有根组件并列的组件。' : `将新增到 ${selected?.code ?? '当前组件'} 之下。`}</p><label>组件编码<input value={code} maxLength={80} onChange={(event) => setCode(event.target.value)} required /></label><label>组件名称<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} required /></label><label className="wide-field">创建原因<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} required /></label><div className="form-actions"><button type="button" onClick={reset}>取消</button><button className="primary-action" type="submit" disabled={create.isPending}>{create.isPending ? '正在新增' : formMode === 'create-root' ? '新增根组件' : '新增子组件'}</button></div>{create.isError && <p className="error-strip wide-field">{create.error.message}</p>}</form>}</section>
      </aside>
      <section className="component-inspector">
        {selected ? <><div className="inspector-heading"><div><span className="section-index">已选组件</span><h3>{selected.code} · {selected.name}</h3></div><div className="inspector-actions"><button type="button" onClick={startEdit}>编辑</button><button type="button" className="danger-action" onClick={() => { setFormMode('delete'); setReason('') }}>删除</button></div></div>
          <div className="component-meta"><span>版本 {selected.versions.length}</span><span>拖拽可移动层级</span></div>
          {(formMode === 'edit' || formMode === 'delete') && <form className="workspace-form" onSubmit={(event) => { event.preventDefault(); if (formMode === 'edit') update.mutate(); else remove.mutate() }}>
            {formMode !== 'delete' && <><label>组件编码<input value={code} maxLength={80} onChange={(event) => setCode(event.target.value)} required /></label><label>组件名称<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} required /></label></>}
            <label className="wide-field">{formMode === 'delete' ? '删除原因' : formMode === 'edit' ? '修改原因' : '创建原因'}<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} required /></label>
            {formMode === 'delete' && <p className="form-hint">仅允许删除没有子组件且没有版本历史的组件。已有版本、基线和实际配置历史不会被删除。</p>}
            <div className="form-actions"><button type="button" onClick={reset}>取消</button><button className={formMode === 'delete' ? 'danger-action' : 'primary-action'} type="submit" disabled={create.isPending || update.isPending || remove.isPending}>{formMode === 'delete' ? '确认删除' : formMode === 'edit' ? '保存组件' : '新增组件'}</button></div>
            {(create.isError || update.isError || remove.isError) && <p className="error-strip">{create.error?.message ?? update.error?.message ?? remove.error?.message}</p>}
          </form>}
          <section className="version-workbench"><div className="subsection-heading"><div><span className="section-index">软件版本</span><h3>登记与状态</h3></div></div><form className="workspace-form" onSubmit={(event) => { event.preventDefault(); addVersion.mutate() }}><label>版本号<input value={versionNumber} placeholder="例如：2026.09.01" maxLength={160} onChange={(event) => setVersionNumber(event.target.value)} required /></label><label>登记原因<input value={versionReason} maxLength={500} onChange={(event) => setVersionReason(event.target.value)} required /></label><div className="form-actions wide-field"><button className="primary-action" type="submit" disabled={addVersion.isPending}>{addVersion.isPending ? '正在登记' : '登记版本'}</button></div>{addVersion.isError && <p className="error-strip wide-field">{addVersion.error.message}</p>}</form>
            {selected.versions.length ? <div className="version-list">{selected.versions.map(version => <button type="button" key={version.id} className={version.id === selectedVersionId ? 'version-item selected' : 'version-item'} onClick={() => setSelectedVersionId(version.id)}><span><strong>{version.versionNumber}</strong><small>序列 {version.sequenceNo} · {maturityText(version.maturity)} · {safetyText(version.safety)}</small></span></button>)}</div> : <p className="empty-state">尚未登记软件版本。</p>}
            {selectedVersionId && <><form className="workspace-form lifecycle-form" onSubmit={(event) => { event.preventDefault(); lifecycle.mutate() }}><label>状态操作<select value={lifecycleAction} onChange={(event) => setLifecycleAction(event.target.value)}><option value="Testing">提交测试</option><option value="Released">发布</option><option value="Maintenance">进入维护</option><option value="Deprecated">废弃</option><option value="Blocked">阻断</option><option value="Clear">解除阻断</option><option value="Recommended">设为推荐</option></select></label><label>操作原因<input value={lifecycleReason} maxLength={500} onChange={(event) => setLifecycleReason(event.target.value)} required /></label><div className="form-actions wide-field"><button type="submit" disabled={lifecycle.isPending}>{lifecycle.isPending ? '正在更新' : '更新状态'}</button></div>{lifecycle.isError && <p className="error-strip wide-field">{lifecycle.error.message}</p>}</form><dl className="version-impact"><div><dt>已使用基线</dt><dd>{versionImpact.data?.usedBaselineIds.length ?? '—'}</dd></div><div><dt>当前机台</dt><dd>{versionImpact.data?.currentMachineIds.length ?? '—'}</dd></div><div><dt>目标机台</dt><dd>{versionImpact.data?.targetMachineIds.length ?? '—'}</dd></div><div><dt>历史机台</dt><dd>{versionImpact.data?.historicalMachineIds.length ?? '—'}</dd></div></dl><section className="version-patch-workbench"><div className="subsection-heading"><div><span className="section-index">版本补丁</span><h3>问题与修复记录</h3><p className="form-hint">补丁不会改变软件版本号，也不表示机台已经安装；机台补丁实际情况会单独记录。</p></div></div><form className="workspace-form" onSubmit={(event) => { event.preventDefault(); addPatch.mutate() }}><label>补丁编号<input value={patchCode} placeholder="例如：HF-001" maxLength={80} onChange={(event) => setPatchCode(event.target.value)} required /></label><label>补丁状态<select value={patchStatus} onChange={(event) => setPatchStatus(event.target.value)}><option value="Draft">草稿</option><option value="Released">已发布</option><option value="Withdrawn">已撤回</option></select></label><label className="wide-field">补丁标题<input value={patchTitle} maxLength={200} onChange={(event) => setPatchTitle(event.target.value)} required /></label><label>问题说明<textarea value={patchIssue} maxLength={2000} onChange={(event) => setPatchIssue(event.target.value)} required /></label><label>修复说明<textarea value={patchResolution} maxLength={2000} onChange={(event) => setPatchResolution(event.target.value)} required /></label><div className="form-actions wide-field"><button type="submit" disabled={addPatch.isPending}>{addPatch.isPending ? '正在登记' : '登记补丁'}</button></div>{addPatch.isError && <p className="error-strip wide-field">{addPatch.error.message}</p>}</form>{versionDetail.data?.patches.length ? <div className="patch-list">{versionDetail.data.patches.map(patch => <article className="patch-item" key={patch.id}><div><span className={`patch-status ${patch.status.toLowerCase()}`}>{patchStatusText(patch.status)}</span><strong>{patch.patchCode} · {patch.title}</strong><p><b>问题：</b>{patch.issueDescription}</p><p><b>修复：</b>{patch.resolutionDescription}</p></div><small>{patch.recordedBy}<br />{formatTime(patch.recordedAt)}</small></article>)}</div> : <p className="empty-state">尚未登记补丁。</p>}</section></>}
          </section>
        </> : <p className="empty-state">从左侧选择组件，或先创建根组件。</p>}
      </section>
    </div>
  </section>
}
