import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from 'antd'
import { CheckCircleOutlined, ClockCircleOutlined, DownloadOutlined, FileExcelOutlined, HistoryOutlined, ImportOutlined, ReloadOutlined, SettingOutlined, UploadOutlined } from '@ant-design/icons'
import { LegacyImportWorkspace } from './LegacyImportWorkspace'
import { createMatrixTemplate, downloadMatrixTemplate, getMatrixCombination, getMatrixWorkspace, saveMatrixSource, scanMatrixSource, scanMatrixWorkbook, workbookBase64, type MatrixCombination, type MatrixComponent, type MatrixMessage, type MatrixRun, type MatrixSource } from './matrix-import-api'
import './matrix-import.css'

const formatTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚无记录'
const stateText = (value: string | null | undefined) => ({ Succeeded: '扫描完成', Failed: '扫描失败', Running: '扫描中', Pending: '待扫描', Skipped: '无新内容', Completed: '扫描完成', Imported: '已录入' }[value ?? ''] ?? '待扫描')
const hasError = (run: MatrixRun) => run.status === 'Failed' || run.messages.some(item => item.level === 'error')
const actorText = (actor: string) => actor.startsWith('自动扫描:') ? '自动扫描服务' : actor
const combinationSource = (combination: MatrixCombination) => combination.sourceLabel || `第 ${combination.sourceRow} 行`
const changeText = (message: MatrixMessage) => message.componentName ? `${message.componentName} 从 ${message.previousVersionNumber ?? '未指定'} 变为 ${message.versionNumber ?? '未指定'}` : message.message
const componentAnchor = (combinationId: string, componentId: string) => `matrix-combination-${combinationId}-${componentId}`

export function ImportWorkspace({ projectId, projectName, isAdmin = false, canImport = false, onOpenVersion }: { projectId: string; projectName: string; isAdmin?: boolean; canImport?: boolean; onOpenVersion?: (componentId: string, versionId: string) => void }) {
  const client = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [reason, setReason] = useState('')
  const [tab, setTab] = useState<'combinations' | 'runs'>('combinations')
  const [selectedCombinationId, setSelectedCombinationId] = useState('')
  const [focusedComponent, setFocusedComponent] = useState({ id: '', request: 0 })
  const [selectedRunId, setSelectedRunId] = useState('')
  const [latestRun, setLatestRun] = useState<MatrixRun | null>(null)
  const [templateDialog, setTemplateDialog] = useState(false)
  const [templateReason, setTemplateReason] = useState('生成项目组件版本登记模板')
  const [sourceDialog, setSourceDialog] = useState(false)
  const [sourceDraft, setSourceDraft] = useState({ templateId: '', path: '', localTime: '09:00', timeZoneId: 'China Standard Time', enabled: false, reason: '' })
  const [sourceScanDialog, setSourceScanDialog] = useState(false)
  const [sourceScanReason, setSourceScanReason] = useState('')
  const [notice, setNotice] = useState('')
  const workspace = useQuery({ queryKey: ['matrix-import', projectId], queryFn: () => getMatrixWorkspace(projectId), refetchInterval: 30000 })
  const templates = workspace.data?.templates ?? []
  const activeTemplateId = templateId || templates[0]?.id || ''
  const activeTemplate = templates.find(item => item.id === activeTemplateId)
  const source = workspace.data?.sources[0]
  const combinations = workspace.data?.combinations ?? []
  const listedCombination = combinations.find(item => item.id === selectedCombinationId)
  const historicalCombination = useQuery({ queryKey: ['matrix-combination', projectId, selectedCombinationId], queryFn: () => getMatrixCombination(projectId, selectedCombinationId), enabled: !!selectedCombinationId && !!workspace.data && !listedCombination, retry: false })
  const selectedCombination = selectedCombinationId ? listedCombination ?? historicalCombination.data : combinations[0]
  const visibleCombinations = selectedCombination && !combinations.some(item => item.id === selectedCombination.id) ? [selectedCombination, ...combinations] : combinations
  const runs = workspace.data?.runs ?? []
  const selectedRun = runs.find(item => item.id === selectedRunId) ?? (latestRun?.id === selectedRunId ? latestRun : null) ?? runs[0]

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['matrix-import', projectId] })
    await client.invalidateQueries({ queryKey: ['matrix-combination', projectId] })
    await client.invalidateQueries({ queryKey: ['project', projectId] })
    await client.invalidateQueries({ queryKey: ['project-version-detail'] })
    await client.invalidateQueries({ queryKey: ['laboratory-history', projectId] })
    await client.invalidateQueries({ queryKey: ['laboratory-versions', projectId] })
  }
  const onScanned = async (run: MatrixRun) => {
    setLatestRun(run)
    setSelectedRunId(run.id)
    setTab('runs')
    setSourceScanDialog(false)
    setNotice(hasError(run) ? '' : `扫描完成：新增 ${run.importedCount} 套测试组合，跳过 ${run.skippedCount} 条记录。`)
    await refresh()
  }
  const generate = useMutation({
    mutationFn: () => createMatrixTemplate(projectId, templateReason),
    onSuccess: async result => {
      setTemplateId(result.id)
      setTemplateDialog(false)
      setNotice('项目模板已生成。')
      await refresh()
      download.mutate(result.id)
    },
  })
  const download = useMutation({ mutationFn: (id: string) => downloadMatrixTemplate(projectId, id, projectName) })
  const scan = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('请先选择填写后的 Excel 模板。')
      return scanMatrixWorkbook(projectId, { templateId: activeTemplateId, fileName: file.name, contentBase64: await workbookBase64(file), reason })
    },
    onSuccess: onScanned,
  })
  const updateSource = useMutation({ mutationFn: () => saveMatrixSource(projectId, sourceDraft), onSuccess: async () => { setSourceDialog(false); setNotice(sourceDraft.enabled ? '每日扫描已启用。' : '扫描源已保存，每日扫描已暂停。'); await refresh() } })
  const scanSource = useMutation({ mutationFn: () => scanMatrixSource(projectId, sourceScanReason), onSuccess: onScanned })
  const busy = scan.isPending || scanSource.isPending
  const openSource = (current: MatrixSource | undefined) => {
    setSourceDraft({ templateId: current?.templateId ?? activeTemplateId, path: current?.path ?? '', localTime: current?.localTime ?? '09:00', timeZoneId: current?.timeZoneId ?? 'China Standard Time', enabled: current?.enabled ?? false, reason: '' })
    updateSource.reset()
    setSourceDialog(true)
  }
  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    setFileError(''); setNotice(''); scan.reset()
    const next = event.target.files?.[0]
    if (!next) return
    if (!next.name.toLowerCase().endsWith('.xlsx')) { setFile(null); setFileError('请选择从本项目下载并填写的 .xlsx 文件。'); return }
    if (next.size > 10 * 1024 * 1024) { setFile(null); setFileError('文件不能超过 10 MB。'); return }
    setFile(next)
  }
  const openCombination = (combinationId: string, componentId: string) => {
    setSelectedCombinationId(combinationId)
    setFocusedComponent(current => ({ id: componentId, request: current.request + 1 }))
    setTab('combinations')
  }

  return <section className="status-panel catalog-panel import-workspace matrix-import-workspace">
    <div className="panel-heading"><div><span className="section-index">{projectName}</span><h3><FileExcelOutlined aria-hidden />Excel 版本登记</h3></div><div className="toolbar-actions"><button type="button" className="icon-button" aria-label="刷新导入记录" title="刷新导入记录" disabled={workspace.isFetching} onClick={() => { void workspace.refetch() }}><ReloadOutlined spin={workspace.isFetching} /></button>{canImport && <button type="button" onClick={() => { generate.reset(); setTemplateDialog(true) }}><DownloadOutlined aria-hidden />生成项目模板</button>}</div></div>
    {workspace.isLoading && <p className="empty-state" role="status">正在读取项目模板与扫描记录。</p>}
    {workspace.isError && <p className="error-strip" role="alert">{workspace.error.message}</p>}
    {notice && <p className="success-strip" role="status">{notice}</p>}
    {download.isError && <p className="error-strip" role="alert">{download.error.message}</p>}
    {canImport ? <form className="matrix-upload-form" aria-label="Excel 扫描录入" onSubmit={event => { event.preventDefault(); setNotice(''); scan.mutate() }}>
      <div className="matrix-file-row"><label className="matrix-template-field">项目模板<select aria-label="项目模板" value={activeTemplateId} onChange={event => { setTemplateId(event.target.value); scan.reset() }} disabled={busy || !templates.length} required><option value="" disabled>请先生成项目模板</option>{templates.map(item => <option value={item.id} key={item.id}>{formatTime(item.createdAt)} · {item.referenceBaselineCode || '无参考基线'}</option>)}</select></label><button type="button" className="matrix-download" title="下载所选模板" aria-label="下载所选模板" onClick={() => download.mutate(activeTemplateId)} disabled={!activeTemplateId || download.isPending}><DownloadOutlined /></button><div className="matrix-file-picker"><input ref={input} type="file" accept=".xlsx" aria-label="填写后的 Excel 文件" disabled={busy} onChange={chooseFile} /><button type="button" onClick={() => input.current?.click()} disabled={busy || !activeTemplateId}><UploadOutlined aria-hidden />选择 Excel</button><span title={file?.name}>{file?.name ?? '尚未选择文件'}</span></div></div>
      <div className="matrix-upload-bottom"><label>本次录入原因<input aria-label="本次录入原因" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} disabled={busy} required placeholder="例如：本周实验室版本登记" /></label><button type="submit" className="primary-action" disabled={busy || !file || !activeTemplateId || !reason.trim()}><ImportOutlined aria-hidden />{scan.isPending ? '正在扫描并录入' : '扫描并录入'}</button></div>
      {activeTemplate && <div className="matrix-semantic-note"><span>{activeTemplate.componentCount} 个组件</span><span>新版本仅登记为测试中</span><span>空白继承上一套组合</span><span>新版模板无需提交标记；旧版仍需标记“可导入”</span></div>}
      {(fileError || scan.isError) && <p className="error-strip" role="alert">{fileError || scan.error?.message}</p>}
    </form> : <p className="empty-state">模板生成与测试版本录入需要高级工程师权限。你可以查看已有的测试组合和扫描结果。</p>}

    <section className="matrix-source-band" aria-label="每日文件扫描"><div className="matrix-source-label"><ClockCircleOutlined aria-hidden /><div><strong>每日文件扫描 <span className={`matrix-status ${source?.enabled ? 'enabled' : ''}`}>{source?.enabled ? '已启用' : source ? '已暂停' : '未配置'}</span></strong>{source ? <><small title={source.path}>{source.path}</small><small>每天 {source.localTime} · {source.timeZoneId === 'China Standard Time' || source.timeZoneId === 'Asia/Shanghai' ? '北京时间' : source.timeZoneId} · 下次 {source.enabled ? formatTime(source.nextScanAt) : '暂停'}</small><small>最近扫描 {formatTime(source.lastScanAt)}{source.lastStatus ? ` · ${stateText(source.lastStatus)}` : ''}</small></> : <small>部署电脑上的固定 Excel 文件</small>}</div></div>{isAdmin && <div className="toolbar-actions">{source && <button type="button" disabled={busy} onClick={() => { scanSource.reset(); setSourceScanReason(''); setSourceScanDialog(true) }}><ReloadOutlined aria-hidden />立即扫描</button>}<button type="button" onClick={() => openSource(source)} disabled={busy || !templates.length}><SettingOutlined aria-hidden />{source ? '扫描设置' : '配置扫描'}</button></div>}</section>

    <nav className="matrix-tabs" aria-label="Excel 导入记录"><button type="button" aria-current={tab === 'combinations' ? 'page' : undefined} onClick={() => setTab('combinations')}><CheckCircleOutlined aria-hidden />测试组合 <span>{combinations.length}</span></button><button type="button" aria-current={tab === 'runs' ? 'page' : undefined} onClick={() => setTab('runs')}><HistoryOutlined aria-hidden />扫描记录 <span>{runs.length}</span></button></nav>
    {tab === 'combinations' && (visibleCombinations.length || selectedCombinationId ? <div className="matrix-history-layout"><div className="matrix-history-list" aria-label="测试组合列表">{visibleCombinations.map(item => <button type="button" key={item.id} aria-pressed={selectedCombination?.id === item.id} onClick={() => { setSelectedCombinationId(item.id); setFocusedComponent({ id: '', request: 0 }) }}><strong>第 {item.sequenceNo} 套 <span>{item.items.filter(component => component.changed).length} 项变更</span></strong><small>{item.recordDate} · Excel {combinationSource(item)}</small><span>{item.reason}</span></button>)}</div>{selectedCombination ? <CombinationTree combination={selectedCombination} focusedComponent={focusedComponent} onOpenVersion={onOpenVersion} /> : historicalCombination.isError ? <div className="matrix-combination-load-error"><p className="error-strip" role="alert">无法读取所选测试组合：{historicalCombination.error.message}</p><button type="button" onClick={() => { void historicalCombination.refetch() }}>重新读取</button></div> : <p className="empty-state" role="status">正在读取所选测试组合。</p>}</div> : <p className="empty-state">尚无测试组合。填写项目模板并扫描后，组合记录将显示在这里。</p>)}
    {tab === 'runs' && (runs.length || latestRun ? <div className="matrix-history-layout"><div className="matrix-history-list" aria-label="扫描记录列表">{(latestRun && !runs.some(item => item.id === latestRun.id) ? [latestRun, ...runs] : runs).map(run => <button type="button" key={run.id} aria-pressed={selectedRun?.id === run.id} onClick={() => setSelectedRunId(run.id)}><strong>{run.fileName || '固定文件扫描'}<span className={hasError(run) ? 'matrix-error-text' : ''}>{stateText(run.status)}</span></strong><small>{formatTime(run.createdAt)}</small><span>新增 {run.importedCount} 套 · 跳过 {run.skippedCount} 条记录</span></button>)}</div>{selectedRun && <RunResult run={selectedRun} onOpenCombination={openCombination} />}</div> : <p className="empty-state">尚无扫描记录。</p>)}

    {canImport && <details className="matrix-legacy-entry"><summary>粘贴文本导入</summary><LegacyImportWorkspace projectId={projectId} projectName={projectName} /></details>}

    <Modal title="生成项目模板" open={templateDialog} onCancel={() => !generate.isPending && setTemplateDialog(false)} footer={null} destroyOnHidden>
      <form className="catalog-form" onSubmit={event => { event.preventDefault(); generate.mutate() }}><p className="form-hint wide-field">组件按根组件纵向分组，每列一套测试组合。参考版本固定为生成时的项目标准，空白表示保持不变。新模板不再需要提交标记。</p><p className="form-hint wide-field">记录日期：YYYY-MM-DD，例如 2026-09-18。已有横向台账仍按“可导入”标记扫描。</p><label className="wide-field">生成原因<input value={templateReason} maxLength={500} onChange={event => setTemplateReason(event.target.value)} disabled={generate.isPending} required /></label><div className="form-actions wide-field"><button type="button" disabled={generate.isPending} onClick={() => setTemplateDialog(false)}>取消</button><button type="submit" className="primary-action" disabled={generate.isPending || !templateReason.trim()}><DownloadOutlined aria-hidden />{generate.isPending ? '正在生成' : '生成并下载'}</button></div>{generate.isError && <p className="error-strip wide-field" role="alert">{generate.error.message}</p>}</form>
    </Modal>
    <Modal title="每日扫描设置" open={sourceDialog} onCancel={() => !updateSource.isPending && setSourceDialog(false)} footer={null} destroyOnHidden>
      <form className="catalog-form matrix-source-form" onSubmit={event => { event.preventDefault(); updateSource.mutate() }}><label className="wide-field">固定文件对应模板<select value={sourceDraft.templateId} onChange={event => setSourceDraft({ ...sourceDraft, templateId: event.target.value })} required disabled={updateSource.isPending}><option value="">请选择</option>{templates.map(item => <option value={item.id} key={item.id}>{formatTime(item.createdAt)} · {item.referenceBaselineCode || '无参考基线'}</option>)}</select></label><label className="wide-field">部署电脑上的 Excel 路径<input value={sourceDraft.path} placeholder="D:\版本台账\项目版本.xlsx" onChange={event => setSourceDraft({ ...sourceDraft, path: event.target.value })} maxLength={1000} required disabled={updateSource.isPending} /></label><label>每日时间<input type="time" value={sourceDraft.localTime} onChange={event => setSourceDraft({ ...sourceDraft, localTime: event.target.value })} required disabled={updateSource.isPending} /></label><label>时区<select value={sourceDraft.timeZoneId} onChange={event => setSourceDraft({ ...sourceDraft, timeZoneId: event.target.value })} disabled={updateSource.isPending}><option value="China Standard Time">北京时间（UTC+8）</option><option value="UTC">协调世界时（UTC）</option>{!['China Standard Time', 'UTC'].includes(sourceDraft.timeZoneId) && <option value={sourceDraft.timeZoneId}>{sourceDraft.timeZoneId}</option>}</select></label><label className="matrix-checkbox wide-field"><input type="checkbox" checked={sourceDraft.enabled} onChange={event => setSourceDraft({ ...sourceDraft, enabled: event.target.checked })} disabled={updateSource.isPending} />启用每日自动扫描并录入</label><label className="wide-field">设置原因<input value={sourceDraft.reason} maxLength={500} onChange={event => setSourceDraft({ ...sourceDraft, reason: event.target.value })} required disabled={updateSource.isPending} /></label><div className="form-actions wide-field"><button type="button" disabled={updateSource.isPending} onClick={() => setSourceDialog(false)}>取消</button><button type="submit" className="primary-action" disabled={updateSource.isPending || !sourceDraft.reason.trim()}>{updateSource.isPending ? '正在保存' : '保存设置'}</button></div>{updateSource.isError && <p className="error-strip wide-field" role="alert">{updateSource.error.message}</p>}</form>
    </Modal>
    <Modal title="立即扫描固定文件" open={sourceScanDialog} onCancel={() => !scanSource.isPending && setSourceScanDialog(false)} footer={null} destroyOnHidden>
      <form className="catalog-form" onSubmit={event => { event.preventDefault(); scanSource.mutate() }}><p className="form-hint wide-field">{source?.path}</p><label className="wide-field">扫描原因<input value={sourceScanReason} onChange={event => setSourceScanReason(event.target.value)} maxLength={500} disabled={scanSource.isPending} required /></label><div className="form-actions wide-field"><button type="button" disabled={scanSource.isPending} onClick={() => setSourceScanDialog(false)}>取消</button><button type="submit" className="primary-action" disabled={scanSource.isPending || !sourceScanReason.trim()}>{scanSource.isPending ? '正在扫描并录入' : '扫描并录入'}</button></div>{scanSource.isError && <p className="error-strip wide-field" role="alert">{scanSource.error.message}</p>}</form>
    </Modal>
  </section>
}

function CombinationTree({ combination, focusedComponent, onOpenVersion }: { combination: MatrixCombination; focusedComponent: { id: string; request: number }; onOpenVersion?: (componentId: string, versionId: string) => void }) {
  const focusedNode = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusedComponent.id) return
    focusedNode.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
    focusedNode.current?.focus({ preventScroll: true })
  }, [combination.id, focusedComponent.id, focusedComponent.request])
  const items = combination.items
  const children = (parentId: string | null) => items.filter(item => item.parentComponentId === parentId).sort((left, right) => left.sortOrder - right.sortOrder || left.componentName.localeCompare(right.componentName, 'zh-CN'))
  const renderNode = (item: MatrixComponent, depth: number, path: Set<string>): ReactNode => {
    if (path.has(item.componentId)) return null
    const nextPath = new Set(path).add(item.componentId)
    const version = item.versionId && item.versionAvailable !== false && onOpenVersion ? <button className="matrix-version-link" type="button" onClick={() => onOpenVersion(item.componentId, item.versionId!)}>{item.versionNumber}</button> : <strong>{item.isCategory ? '分类' : item.versionNumber || '尚未指定'}</strong>
    return <div key={item.componentId} className="matrix-tree-branch"><div id={componentAnchor(combination.id, item.componentId)} data-component-id={item.componentId} ref={focusedComponent.id === item.componentId ? focusedNode : undefined} tabIndex={-1} aria-label={`${item.componentName}${item.changed ? ' 版本变更' : ''}`} className={`matrix-tree-node${item.changed ? ' changed' : ''}${depth === 0 ? ' root' : ''}${focusedComponent.id === item.componentId ? ' focused' : ''}`}><span className="matrix-component-name">{item.componentName}</span>{item.changed ? <div className="matrix-version-change"><span className="matrix-previous-version" title="变更前">{item.previousVersionNumber === undefined ? '此前版本未记录' : item.previousVersionNumber ?? '未指定'}</span><span className="matrix-change-arrow" aria-label="变更为">→</span><span className="matrix-current-version" title="变更后">{version}</span></div> : <div className="matrix-current-version">{version}</div>}{item.versionAvailable === false && item.versionId && <small className="matrix-deleted-version">版本已删除 · 保留历史快照</small>}</div>{children(item.componentId).map(child => renderNode(child, depth + 1, nextPath))}</div>
  }
  return <section className="matrix-combination" aria-label="测试组合详情"><div className="matrix-detail-heading"><div><h4>第 {combination.sequenceNo} 套测试组合</h4><p>{combination.reason}</p></div><span className="matrix-test-label">测试组合 · 非正式基线</span></div><div className="matrix-tree-grid">{children(null).map(root => <section className="matrix-tree-root" key={root.componentId}>{renderNode(root, 0, new Set())}</section>)}</div><div className="matrix-detail-meta"><span>记录日期 {combination.recordDate}</span><span>录入时间 {formatTime(combination.createdAt)}</span><span>未变更项沿用前一套组合</span></div></section>
}

function RunResult({ run, onOpenCombination }: { run: MatrixRun; onOpenCombination: (combinationId: string, componentId: string) => void }) {
  const errors = run.messages.filter(message => message.level === 'error').length
  return <section className="matrix-run-result" aria-label="扫描结果详情"><div className="matrix-detail-heading"><div><h4 className={hasError(run) ? 'matrix-error-text' : ''}>{stateText(run.status)}</h4><p>{run.fileName}</p></div><small>{formatTime(run.createdAt)}</small></div><div className="matrix-run-counts"><span><b>{run.importedCount}</b> 新增组合</span><span><b>{run.skippedCount}</b> 跳过记录</span><span className={errors ? 'matrix-error-text' : ''}><b>{errors}</b> 问题</span></div>{run.messages.length ? <ul className="matrix-run-messages">{run.messages.map((message, index) => <li key={index} className={message.level === 'error' ? 'error' : ''}><strong>{message.sourceLabel || (message.rowNumber == null ? '文件' : `第 ${message.rowNumber} 行`)}</strong>{message.combinationId && message.componentId ? <a className="matrix-change-link" href={`#${componentAnchor(message.combinationId, message.componentId)}`} onClick={event => { event.preventDefault(); onOpenCombination(message.combinationId!, message.componentId!) }}>{changeText(message)}</a> : <span>{changeText(message)}</span>}</li>)}</ul> : <p className="empty-state">本次没有需要处理的问题。</p>}<div className="matrix-detail-meta">执行人 {actorText(run.actor)}</div></section>
}
