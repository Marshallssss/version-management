import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Modal, Popover } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { getVersionDetail, getMaintenanceCapabilities, maintainVersion, managePatch, type ComponentVersion, type VersionPatch } from './catalog-api'

const maturityNames: Record<string, string> = { Draft: '草稿', Testing: '实验室测试', Released: '已发布', Maintenance: '维护中', Deprecated: '已废弃' }
const patchNames: Record<string, string> = { Draft: '草稿', Released: '已发布', Withdrawn: '已撤回' }
function localTime(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }

export function PatchBadge({ version, onOpen, context = 'version', versionLabel }: { version?: ComponentVersion; onOpen: () => void; context?: 'version' | 'machine' | 'snapshot'; versionLabel?: string }) {
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const dismiss = () => { setDismissed(true); setOpen(false) }
  if (!version?.patchCount) return null
  return <Popover open={open && !dismissed} onOpenChange={setOpen} trigger={['hover', 'focus']} title={<div className="patch-preview-heading"><strong>{versionLabel ?? version.versionNumber}</strong><button type="button" aria-label="收起补丁预览" title="收起补丁预览" onClick={dismiss}><CloseOutlined aria-hidden /></button></div>} content={<div className="patch-hover-content" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss() } }}><p className="patch-record-notice">{context === 'snapshot' ? '当前补丁记录，非当时快照。' : context === 'machine' ? '此版本当前补丁记录，不代表机台已安装。' : '当前补丁记录，不代表已安装。'}</p>{version.patches.map(patch => <p key={patch.patchCode}><strong>{patch.patchCode}</strong> · {patch.title}<small>{patchNames[patch.status] ?? '未知状态'}</small></p>)}{version.patchCount > version.patches.length && <p className="patch-record-notice">共 {version.patchCount} 条，预览最近 {version.patches.length} 条。</p>}<button type="button" onClick={() => { setOpen(false); onOpen() }}>查看全部修复记录</button></div>}><button type="button" className="patch-badge patch-open" onPointerEnter={() => setDismissed(false)} onFocus={() => setDismissed(false)} aria-label={`${versionLabel ?? version.versionNumber} 的补丁记录 ${version.patchCount} 条`} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss() } }} onClick={event => { event.stopPropagation(); setOpen(false); onOpen() }}>补丁记录 {version.patchCount}</button></Popover>
}

export function PatchActions({ patch, isAdmin, onSaved, canWrite = true }: { canWrite?: boolean; patch: VersionPatch; isAdmin: boolean; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const action = patch.status === 'Draft' ? 'delete' : 'withdraw'
  const mutation = useMutation({ mutationFn: () => managePatch(patch.id, action, reason), onSuccess: async () => { setOpen(false); setReason(''); await onSaved() } })
  if (!canWrite || patch.status === 'Withdrawn' || patch.status === 'Draft' && !isAdmin) return null
  return <div className="patch-record-actions"><button type="button" onClick={() => setOpen(value => !value)}>{action === 'delete' ? '删除草稿' : '撤回补丁'}</button>{open && <form onSubmit={event => { event.preventDefault(); Modal.confirm({ title: action === 'delete' ? '确认删除草稿补丁？' : '确认撤回补丁？', content: action === 'delete' ? '草稿将被删除，操作留有审计。' : '保留补丁内容和登记时间，标记为已撤回。', okText: '确认', cancelText: '取消', onOk: () => mutation.mutateAsync().catch(() => {}) }) }}><label>操作原因<input value={reason} maxLength={500} onChange={event => setReason(event.target.value)} required /></label><button type="submit" disabled={mutation.isPending}>继续</button></form>}{mutation.isError && <p className="error-strip">{mutation.error.message}</p>}</div>
}

export function VersionMaintenance({ version, onSaved }: { version: ComponentVersion; onSaved: () => Promise<void> }) {
  const capabilities = useQuery({ queryKey: ['maintenance-capabilities'], queryFn: getMaintenanceCapabilities })
  const [open, setOpen] = useState(false)
  const versionDetail = useQuery({ queryKey: ['project-version-detail', version.id], queryFn: () => getVersionDetail(version.id) })
  const [released, setReleased] = useState('')
  const [number, setNumber] = useState(version.versionNumber)
  const [created, setCreated] = useState(localTime(version.createdAt))
  const [maturity, setMaturity] = useState(version.maturity)
  const [reason, setReason] = useState('')
  const mutation = useMutation({ mutationFn: () => maintainVersion(version.id, { versionNumber: number, createdAt: new Date(created).toISOString(), releasedAt: released ? new Date(released).toISOString() : null, maturity, reason, maintenanceMode: true }), onSuccess: async () => { setOpen(false); setReason(''); await onSaved() } })
  if (!capabilities.data?.enabled) return null
  return <section className="version-maintenance"><button type="button" onClick={() => { setReleased(versionDetail.data?.transitions.filter(item => item.axis === 'Maturity' && item.toState === 'Released').sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]?.occurredAt ? localTime(versionDetail.data!.transitions.filter(item => item.axis === 'Maturity' && item.toState === 'Released').sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0].occurredAt) : ''); setNumber(version.versionNumber); setCreated(localTime(version.createdAt)); setMaturity(version.maturity); setOpen(value => !value) }}>调测维护</button>{open && <form className="workspace-form" onSubmit={event => { event.preventDefault(); mutation.mutate() }}><label>版本号<input value={number} maxLength={160} onChange={event => setNumber(event.target.value)} required /></label><label>登记时间<input type="datetime-local" value={created} onChange={event => setCreated(event.target.value)} required /></label><label>发布时间（可选）<input type="datetime-local" value={released} onChange={event => setReleased(event.target.value)} /></label><label>成熟度<select value={maturity} onChange={event => setMaturity(event.target.value)}>{Object.entries(maturityNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><label>维护原因<input value={reason} maxLength={500} onChange={event => setReason(event.target.value)} required /></label><p className="form-hint wide-field">仅修正版本登记；已冻结基线快照保持不变。维护操作保留真实审计时间。</p><button type="submit" disabled={mutation.isPending}>保存调测修改</button>{mutation.isError && <p className="error-strip">{mutation.error.message}</p>}</form>}</section>
}
