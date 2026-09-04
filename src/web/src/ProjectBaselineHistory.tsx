import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { assignProjectStandard, createBaseline, decideBaselineReview, getBaselineDetail, getBaselines, getProjectStandard, releaseBaseline, requestBaselineReview, setBaselineItemRequirement, type ProjectDetail } from './catalog-api'

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
}

export function ProjectBaselineHistory({ detail, isAdmin, focusedBaselineId, onSuccess }: { detail: ProjectDetail; isAdmin: boolean; focusedBaselineId?: string; onSuccess: (message: string) => void }) {
  const queryClient = useQueryClient()
  const [selectedBaselineId, setSelectedBaselineId] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [seriesCode, setSeriesCode] = useState(detail.project.code)
  const [baselineCode, setBaselineCode] = useState('')
  const [description, setDescription] = useState('')
  const [reason, setReason] = useState('')
  const [reviewReason, setReviewReason] = useState('')
  const [releaseReason, setReleaseReason] = useState('')
  const [standardReason, setStandardReason] = useState('')
  const [requirementItemId, setRequirementItemId] = useState('')
  const [requirement, setRequirement] = useState('Required')
  const [requirementReason, setRequirementReason] = useState('')
  const [selections, setSelections] = useState<Record<string, string>>({})
  const releasedComponents = useMemo(() => detail.components
    .map(component => ({ ...component, releasedVersions: component.versions.filter(version => version.maturity === 'Released').sort((left, right) => right.sequenceNo - left.sequenceNo) }))
    .filter(component => component.releasedVersions.length > 0), [detail.components])
  const baselines = useQuery({ queryKey: ['project-baseline-history', detail.project.id], queryFn: () => getBaselines(detail.project.id) })
  const currentStandard = useQuery({ queryKey: ['project-standard', detail.project.id], queryFn: () => getProjectStandard(detail.project.id) })
  const baselineDetail = useQuery({ queryKey: ['baseline-detail', selectedBaselineId], queryFn: () => getBaselineDetail(selectedBaselineId), enabled: selectedBaselineId !== '' })

  useEffect(() => {
    setSelectedBaselineId('')
    setComposerOpen(false)
    setSeriesCode(detail.project.code)
    setBaselineCode('')
    setDescription('')
    setReason('')
    setSelections(Object.fromEntries(releasedComponents.map(component => [component.id, component.releasedVersions[0].id])))
  }, [detail.project.id])

  useEffect(() => {
    if (focusedBaselineId) setSelectedBaselineId(focusedBaselineId)
  }, [focusedBaselineId])

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['project-baseline-history', detail.project.id] })
    await queryClient.invalidateQueries({ queryKey: ['project-standard', detail.project.id] })
  }
  const create = useMutation({
    mutationFn: () => createBaseline(detail.project.id, {
      seriesCode,
      baselineCode,
      description,
      reason,
      versionSelections: releasedComponents.map(component => ({ componentId: component.id, versionId: selections[component.id] })),
    }),
    onSuccess: async ({ id }) => {
      setSelectedBaselineId(id)
      setComposerOpen(false)
      setBaselineCode('')
      setDescription('')
      setReason('')
      onSuccess('已按所选已发布版本创建基线草稿。')
      await refresh()
    },
  })
  const requestReview = useMutation({ mutationFn: () => requestBaselineReview(selectedBaselineId, reviewReason), onSuccess: async () => { setReviewReason(''); onSuccess('基线已提交评审。'); await queryClient.invalidateQueries({ queryKey: ['baseline-detail', selectedBaselineId] }); await refresh() } })
  const decideReview = useMutation({ mutationFn: (decision: 'approve' | 'reject') => decideBaselineReview(selectedBaselineId, decision, reviewReason), onSuccess: async () => { setReviewReason(''); onSuccess('评审结果已记录。'); await queryClient.invalidateQueries({ queryKey: ['baseline-detail', selectedBaselineId] }); await refresh() } })
  const release = useMutation({ mutationFn: () => releaseBaseline(selectedBaselineId, releaseReason), onSuccess: async () => { setReleaseReason(''); onSuccess('基线已发布并冻结。'); await queryClient.invalidateQueries({ queryKey: ['baseline-detail', selectedBaselineId] }); await refresh() } })
  const assignStandard = useMutation({ mutationFn: () => assignProjectStandard(detail.project.id, selectedBaselineId, standardReason), onSuccess: async () => { setStandardReason(''); onSuccess('已设为项目当前标准，不会改变任何机台目标。'); await refresh() } })
  const updateRequirement = useMutation({ mutationFn: () => setBaselineItemRequirement(selectedBaselineId, requirementItemId, { requirement, reason: requirementReason }), onSuccess: async () => { setRequirementReason(''); onSuccess('草稿基线的必需性已更新。'); await queryClient.invalidateQueries({ queryKey: ['baseline-detail', selectedBaselineId] }) } })
  const selectedBaseline = baselineDetail.data?.baseline
  const selectedIsStandard = currentStandard.data?.baselineId === selectedBaselineId

  return <section className="project-baseline-history">
    <div className="baseline-history-heading"><div><span className="section-index">整体版本</span><h2>基线历史</h2><p>先发布组件版本，再选择组成版本冻结为整体基线。基线发布后不可修改；项目标准只是推荐，不会自动改写机台目标。</p></div><button className="primary-action" type="button" onClick={() => setComposerOpen(open => !open)}>{composerOpen ? '收起新基线' : '创建新基线'}</button></div>
    <div className="baseline-flow" aria-label="基线工作流"><span>组件测试</span><b>→</b><span>发布组件版本</span><b>→</b><span>选择版本并冻结草稿</span><b>→</b><span>评审、发布、设为项目标准</span></div>
    <div className="baseline-history-layout">
      <aside className="baseline-timeline"><div className="timeline-heading"><strong>历史快照</strong><small>{baselines.data?.length ?? 0} 条</small></div>{baselines.data?.length ? baselines.data.map(baseline => <button key={baseline.id} type="button" className={baseline.id === selectedBaselineId ? 'timeline-item selected' : 'timeline-item'} onClick={() => { setSelectedBaselineId(baseline.id); setComposerOpen(false) }}><span className={`baseline-state ${baseline.state.toLowerCase()}`}>{baseline.state === 'Released' ? '已发布' : '草稿'}</span><strong>{baseline.code}</strong><small>{baseline.seriesCode} · 修订 {baseline.revisionNo}</small><small>{formatTime(baseline.createdAt)} · {baseline.itemCount} 项</small></button>) : <p className="empty-state">尚无基线。先发布至少一个组件版本，再创建整体快照。</p>}</aside>
      <div className="baseline-history-detail">
        {selectedBaseline && <section className="baseline-snapshot"><div className="snapshot-heading"><div><span className="section-index">已选快照</span><h3>{selectedBaseline.code}</h3><p>{selectedBaseline.seriesCode} · 修订 {selectedBaseline.revisionNo} · {selectedBaseline.state === 'Released' ? '已发布且不可修改' : '草稿，可在评审前调整必需性'}</p></div>{selectedIsStandard && <span className="standard-mark">当前项目标准</span>}</div>{selectedBaseline.description && <p className="snapshot-description">{selectedBaseline.description}</p>}<div className="snapshot-items">{baselineDetail.data?.items.map(item => <article key={item.id} className="snapshot-item"><div><strong>{item.componentName}</strong><small>{item.versionNumber ?? '结构分类节点'}</small></div><span>{item.versionId === null ? '不参与必需性' : item.requirement === 'Optional' ? '可选' : '必需'}</span></article>)}</div>{selectedBaseline.state === 'Draft' && <><section className="baseline-action-block"><h4>草稿调整</h4><form className="compact-form" onSubmit={event => { event.preventDefault(); updateRequirement.mutate() }}><label>组件<select value={requirementItemId} onChange={event => { const item = baselineDetail.data?.items.find(candidate => candidate.id === event.target.value); setRequirementItemId(event.target.value); setRequirement(item?.requirement ?? 'Required') }}><option value="">请选择可配置组件</option>{baselineDetail.data?.items.filter(item => item.versionId !== null).map(item => <option key={item.id} value={item.id}>{item.componentName} · {item.versionNumber}</option>)}</select></label><label>必需性<select value={requirement} onChange={event => setRequirement(event.target.value)}><option value="Required">必需</option><option value="Optional">可选</option></select></label><label className="wide-field">调整原因<input value={requirementReason} maxLength={500} onChange={event => setRequirementReason(event.target.value)} required /></label><button type="submit" disabled={updateRequirement.isPending || requirementItemId === ''}>{updateRequirement.isPending ? '正在更新' : '更新必需性'}</button></form></section><section className="baseline-action-block"><h4>评审与发布</h4>{baselineDetail.data?.review ? <p className="form-hint">评审：{baselineDetail.data.review.status === 'Approved' ? '已通过' : baselineDetail.data.review.status === 'Pending' ? '等待批准' : '已驳回'} · {baselineDetail.data.review.requestedBy}</p> : <p className="form-hint">草稿必须通过评审才可发布。</p>}<form className="compact-form" onSubmit={event => { event.preventDefault(); if (baselineDetail.data?.review?.status === 'Pending' && isAdmin) decideReview.mutate('approve'); else requestReview.mutate() }}><label className="wide-field">评审原因<input value={reviewReason} maxLength={500} onChange={event => setReviewReason(event.target.value)} required /></label>{baselineDetail.data?.review?.status === 'Pending' && isAdmin ? <><button type="submit" disabled={decideReview.isPending}>{decideReview.isPending ? '正在处理' : '通过评审'}</button><button type="button" className="danger-action" onClick={() => decideReview.mutate('reject')} disabled={decideReview.isPending}>驳回</button></> : baselineDetail.data?.review?.status !== 'Approved' && <button type="submit" disabled={requestReview.isPending}>{requestReview.isPending ? '正在提交' : '提交评审'}</button>}</form>{baselineDetail.data?.review?.status === 'Approved' && <form className="compact-form" onSubmit={event => { event.preventDefault(); release.mutate() }}><label className="wide-field">发布原因<input value={releaseReason} maxLength={500} onChange={event => setReleaseReason(event.target.value)} required /></label><button className="primary-action" type="submit" disabled={release.isPending}>{release.isPending ? '正在发布' : '发布并冻结基线'}</button></form>}</section></>}</section>}
        {selectedBaseline?.state === 'Released' && <section className="baseline-action-block standard-action"><h4>项目标准</h4><p className="form-hint">项目标准用于推荐和默认选择；各机台实际 Target 只会通过机台页面的显式指派改变。</p>{selectedIsStandard ? <p className="success-strip">此基线是当前项目标准。</p> : <form className="compact-form" onSubmit={event => { event.preventDefault(); assignStandard.mutate() }}><label className="wide-field">设定原因<input value={standardReason} maxLength={500} onChange={event => setStandardReason(event.target.value)} required /></label><button type="submit" disabled={assignStandard.isPending}>{assignStandard.isPending ? '正在设定' : '设为项目当前标准'}</button></form>}</section>}
        {composerOpen && <section className="baseline-composer"><div className="snapshot-heading"><div><span className="section-index">新基线</span><h3>选择已发布组件版本</h3><p>每个有已发布版本的组件必须选择一项。默认选最新序列，你可以改选此前已经发布的版本。</p></div></div><form className="baseline-compose-form" onSubmit={event => { event.preventDefault(); create.mutate() }}><label>基线系列<input value={seriesCode} maxLength={80} onChange={event => setSeriesCode(event.target.value)} required /></label><label>基线名称<input value={baselineCode} maxLength={100} placeholder="例如：BL-108" onChange={event => setBaselineCode(event.target.value)} required /></label><label className="wide-field">说明<input value={description} maxLength={2000} onChange={event => setDescription(event.target.value)} /></label><div className="baseline-selection-list wide-field">{releasedComponents.map(component => <label key={component.id}><span><strong>{component.name}</strong><small>已发布版本</small></span><select value={selections[component.id] ?? ''} onChange={event => setSelections(current => ({ ...current, [component.id]: event.target.value }))} required>{component.releasedVersions.map(version => <option key={version.id} value={version.id}>{version.versionNumber} · 序列 {version.sequenceNo}</option>)}</select></label>)}</div><label className="wide-field">创建原因<input value={reason} maxLength={500} onChange={event => setReason(event.target.value)} required /></label><div className="form-actions"><button type="button" onClick={() => setComposerOpen(false)}>取消</button><button className="primary-action" type="submit" disabled={create.isPending || releasedComponents.length === 0}>{create.isPending ? '正在创建' : '按所选版本创建草稿'}</button></div>{create.isError && <p className="error-strip wide-field">{create.error.message}</p>}</form></section>}
        {!selectedBaseline && !composerOpen && <p className="empty-state">从左侧选择历史快照，或创建新的整体基线。</p>}
      </div>
    </div>
  </section>
}
