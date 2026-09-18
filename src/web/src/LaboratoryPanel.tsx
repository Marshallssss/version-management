import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Drawer } from 'antd'
import { ExperimentOutlined, LinkOutlined } from '@ant-design/icons'
import { getLaboratoryVersions, recordLaboratory, type LaboratoryVersion } from './laboratory-api'
import './laboratory-panel.css'

const resultLabel = { InProgress: '待验证', Passed: '验证通过', Failed: '验证失败' }
const scopeKey = (item: { machineId: string; chamberNumber: number | null }) => `${item.machineId}:${item.chamberNumber ?? 'machine'}`
const scopeLabel = (item: { machineName: string; chamberNumber: number | null }) => `${item.machineName} · ${item.chamberNumber == null ? '整机' : `PM${item.chamberNumber}`}`
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })

export function LaboratoryBadge({ data, onClick, unavailable = false }: { data?: LaboratoryVersion; onClick: () => void; unavailable?: boolean }) {
  const count = data?.currentUses.filter(item => item.chamberNumber == null).length ?? 0
  const pm = data?.currentUses.filter(item => item.chamberNumber != null).length ?? 0
  return <button type="button" className={`laboratory-badge ${data?.validationStatus ?? ''}`} onClick={onClick} title="查看 Lab 实际使用与验证记录"><ExperimentOutlined aria-hidden /><span>{unavailable ? 'Lab 信息未获取' : !count && !pm ? '未登记 Lab 使用' : `Lab ${count ? `${count} 台` : ''}${count && pm ? ' · ' : ''}${pm ? `${pm} PM` : ''}`}{!unavailable && data && ` · ${resultLabel[data.validationStatus] ?? '待验证'}`}</span></button>
}

export function LaboratoryPanel({ projectId, versionId, versionNumber, componentName, testing, canWrite, onClose, onOpenMachine }: {
  projectId: string; versionId: string; versionNumber: string; componentName: string; testing: boolean; canWrite: boolean; onClose: () => void; onOpenMachine?: (id: string) => void
}) {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['laboratory-versions', projectId], queryFn: () => getLaboratoryVersions(projectId) })
  const entry = query.data?.versions.find(item => item.versionId === versionId)
  const [action, setAction] = useState<'deployments' | 'validations'>('deployments')
  const [targetKey, setTargetKey] = useState('')
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [result, setResult] = useState('Passed')
  const [notice, setNotice] = useState('')
  const targets = action === 'deployments' ? query.data?.targets ?? [] : entry?.currentUses ?? []
  const mutation = useMutation({
    mutationFn: async () => {
      const target = targets.find(item => scopeKey(item) === targetKey)
      if (!target || !time) throw new Error('请选择 Lab 整机或腔室，并填写实际时间。')
      return recordLaboratory(versionId, action, { machineId: target.machineId, chamberNumber: target.chamberNumber, reason,
        ...(action === 'deployments' ? { installedAt: new Date(time).toISOString() } : { occurredAt: new Date(time).toISOString(), result }) })
    },
    onSuccess: async () => {
      setNotice(action === 'deployments' ? '实际升级已记录，其他组件、机台目标与项目标准保持不变。' : '验证结果已保存。')
      setReason('')
      await client.invalidateQueries({ queryKey: ['laboratory-versions', projectId] })
      await client.invalidateQueries({ queryKey: ['machines'] })
      await client.invalidateQueries({ queryKey: ['machine'] })
      await client.invalidateQueries({ queryKey: ['project-version-impact'] })
    },
  })
  return <Drawer title={`${componentName} · ${versionNumber}`} open onClose={() => !mutation.isPending && onClose()} width={640} rootClassName="laboratory-drawer" destroyOnHidden>
    <div className="laboratory-content">
      <div className="laboratory-heading"><h3>Lab 使用与验证</h3><span>{testing ? '测试中' : '历史记录'}</span></div>
      {query.data && <p className="laboratory-policy">发布验证：{query.data.releaseValidationRequired ? '必须通过本轮 Lab 验证' : '未强制'}</p>}
      {query.isError && <p className="error-strip" role="alert">{query.error.message}</p>}
      {query.isLoading && <p role="status">正在读取 Lab 记录。</p>}
      <h4>当前实际配置记录</h4>
      {entry?.currentUses.length ? <ul className="laboratory-record-list">{entry.currentUses.map(use => <li key={scopeKey(use)}><button type="button" disabled={!onOpenMachine} onClick={() => { onClose(); onOpenMachine?.(use.machineId) }}><LinkOutlined />{scopeLabel(use)}</button><small>{use.location || '未登记位置'} · {use.kind === 'ChamberInherited' ? '沿用整机' : use.kind === 'ChamberOverride' ? '腔室特例' : '整机配置'}</small><small>{use.installedAt ? `安装时间 ${formatTime(use.installedAt)}` : '安装时间未知'}</small></li>)}</ul> : !query.isLoading && !query.isError && <p className="empty-state">未发现当前 Lab 实际使用记录。</p>}
      <h4>验证历史</h4>
      {entry?.validations.length ? <ul className="laboratory-record-list">{entry.validations.map(record => <li key={record.id}><div><strong className={`laboratory-result ${record.result}`}>{resultLabel[record.result]}</strong><span>{scopeLabel(record)}</span></div><p>{record.reason}</p><small>{formatTime(record.occurredAt)} · {record.actor}</small></li>)}</ul> : <p className="empty-state">尚未登记验证结果。</p>}
      {notice && <p className="success-strip" role="status">{notice}</p>}
      {canWrite && testing && <form className="catalog-form laboratory-form" onSubmit={event => { event.preventDefault(); mutation.mutate() }}>
        <div className="laboratory-actions wide-field" role="group" aria-label="Lab 记录类型"><button type="button" aria-pressed={action === 'deployments'} onClick={() => { setAction('deployments'); setTargetKey(''); mutation.reset() }}>登记实际升级</button><button type="button" aria-pressed={action === 'validations'} onClick={() => { setAction('validations'); setTargetKey(''); mutation.reset() }}>登记验证结果</button></div>
        <label className="wide-field">Lab 机台／腔室<select value={targetKey} onChange={event => setTargetKey(event.target.value)} required disabled={mutation.isPending}><option value="">请选择</option>{targets.map(target => <option value={scopeKey(target)} key={scopeKey(target)}>{scopeLabel(target)}</option>)}</select></label>
        <label>{action === 'deployments' ? '实际升级时间' : '实际验证时间'}<input type="datetime-local" step="1" value={time} onChange={event => setTime(event.target.value)} required disabled={mutation.isPending} /></label>
        {action === 'validations' && <label>验证结论<select value={result} onChange={event => setResult(event.target.value)} disabled={mutation.isPending}><option value="InProgress">待验证</option><option value="Passed">验证通过</option><option value="Failed">验证失败</option></select></label>}
        <label className="wide-field">{action === 'deployments' ? '升级原因' : '验证说明'}<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required disabled={mutation.isPending} /></label>
        <div className="form-actions wide-field"><button type="submit" className="primary-action" disabled={mutation.isPending || !targetKey || !time || !reason.trim()}>{mutation.isPending ? '正在保存' : action === 'deployments' ? '记录已完成的升级' : '保存验证结果'}</button></div>
        {mutation.isError && <p className="error-strip wide-field" role="alert">{mutation.error.message}</p>}
      </form>}
    </div>
  </Drawer>
}
