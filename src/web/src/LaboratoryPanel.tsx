import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Drawer } from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import { createIdempotencyKey } from './idempotency-key'
import { getLaboratoryVersions, recordLaboratorySelection, recordLaboratory, type LaboratoryVersion } from './laboratory-api'
import './laboratory-panel.css'

const resultLabel = { InProgress: '待验证', Passed: '验证通过', Failed: '验证失败' }
const scopeKey = (item: { machineId: string; chamberNumber: number | null }) => `${item.machineId}:${item.chamberNumber ?? 'machine'}`
const scopeLabel = (item: { machineName: string; chamberNumber: number | null }) => `${item.machineName} · ${item.chamberNumber == null ? '整机' : `PM${item.chamberNumber}`}`
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })

export function LaboratoryBadge({ data, onClick, unavailable = false }: { data?: LaboratoryVersion; onClick: () => void; unavailable?: boolean }) {
  const count = data?.currentUses.filter(item => item.chamberNumber == null).length ?? 0
  const pm = data?.currentUses.filter(item => item.chamberNumber != null).length ?? 0
  const label = unavailable ? '未获取' : count || pm ? '已上机' : '未上机'
  const title = unavailable ? '暂未获取 Lab 使用情况' : `${label} · Lab 整机 ${count} 台 / PM ${pm} 个 · ${data ? resultLabel[data.validationStatus] : '待验证'}，点击查看记录`
  return <button type="button" className={`laboratory-badge machine-state ${count || pm ? 'deployed' : ''}`} onClick={onClick} title={title} aria-label={label}><span>{label}</span></button>
}

export function LaboratoryPanel({ projectId, versionId, versionNumber, componentName, testing, canWrite, onClose, onOpenMachine }: {
  projectId: string; versionId: string; versionNumber: string; componentName: string; testing: boolean; canWrite: boolean; onClose: () => void; onOpenMachine?: (id: string) => void
}) {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['laboratory-versions', projectId], queryFn: () => getLaboratoryVersions(projectId) })
  const entry = query.data?.versions.find(item => item.versionId === versionId)
  const [action, setAction] = useState<'deployments' | 'validations'>('deployments')
  const [targetKeys, setTargetKeys] = useState<string[]>([])
  const [versionIds, setVersionIds] = useState<string[]>([versionId])
  const [outcomes, setOutcomes] = useState<Array<{ label: string; error?: string }>>([])
  const attempts = useRef(new Map<string, { key: string; done: boolean }>())
  const [time, setTime] = useState('')
  const [reason, setReason] = useState('')
  const [result, setResult] = useState('Passed')
  const [notice, setNotice] = useState('')
  const selectedEntries = query.data?.versions.filter(item => versionIds.includes(item.versionId)) ?? []
  const targets = action === 'deployments' ? query.data?.targets ?? [] : (query.data?.targets ?? []).filter(target => selectedEntries.length === versionIds.length && selectedEntries.every(item => item.currentUses.some(use => scopeKey(use) === scopeKey(target))))
  const signature = JSON.stringify({ action, versionIds, targetKeys, time, reason, result })
  useEffect(() => { setOutcomes([]); setNotice('') }, [signature])
  const toggle = (values: string[], id: string, checked: boolean) => checked ? [...values, id] : values.filter(value => value !== id)
  const mutation = useMutation({
    mutationFn: async () => {
      const selectedTargets = targets.filter(item => targetKeys.includes(scopeKey(item)))
      if (!versionIds.length || !selectedTargets.length || selectedTargets.length !== targetKeys.length || !time) throw new Error('请选择测试版本和有效的 Lab 整机或腔室，并填写实际时间。')
      const results: Array<{ label: string; error?: string }> = []
      for (const target of selectedTargets) {
        const items = action === 'deployments' ? [null] : selectedEntries
        for (const item of items) {
          const label = scopeLabel(target) + (item ? ' · ' + item.componentName + ' ' + item.versionNumber : ' · ' + versionIds.length + ' 个版本')
          const attemptId = signature + ':' + scopeKey(target) + ':' + (item?.versionId ?? 'all')
          const attempt = attempts.current.get(attemptId) ?? { key: createIdempotencyKey(), done: false }
          attempts.current.set(attemptId, attempt)
          try {
            if (!attempt.done) {
              const scope = { machineId: target.machineId, chamberNumber: target.chamberNumber, reason }
              if (item) await recordLaboratory(item.versionId, 'validations', { ...scope, occurredAt: new Date(time).toISOString(), result }, attempt.key)
              else await recordLaboratorySelection(projectId, { ...scope, versionIds, installedAt: new Date(time).toISOString() }, attempt.key)
              attempt.done = true
            }
            results.push({ label })
          } catch (error) { results.push({ label, error: error instanceof Error ? error.message : '保存失败，请重试。' }) }
          setOutcomes([...results])
        }
      }
      return results
    },
    onSuccess: async results => {
      const failed = results.filter(item => item.error).length
      setNotice(failed ? `已完成 ${results.length - failed} 项，${failed} 项失败。可重试失败项，已成功项不会重复登记。` : `全部 ${results.length} 项已保存。其他组件、机台目标与项目标准保持不变。`)
      await client.invalidateQueries({ queryKey: ['laboratory-versions', projectId] })
      await client.invalidateQueries({ queryKey: ['machines'] })
      await client.invalidateQueries({ queryKey: ['machine'] })
      for (const key of ['machine-registry', 'machine-configuration', 'machine-equipment', 'machine-facts', 'machine-drift']) await client.invalidateQueries({ queryKey: [key] })
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
        <div className="laboratory-actions wide-field" role="group" aria-label="Lab 记录类型"><button type="button" disabled={mutation.isPending} aria-pressed={action === 'deployments'} onClick={() => { setAction('deployments'); setTargetKeys([]); mutation.reset() }}>登记实际升级</button><button type="button" disabled={mutation.isPending} aria-pressed={action === 'validations'} onClick={() => { setAction('validations'); setTargetKeys([]); mutation.reset() }}>登记验证结果</button></div>
        <fieldset className="laboratory-selection wide-field" disabled={mutation.isPending}><legend>测试版本（可多选）</legend>{query.data?.versions.filter(item => item.maturity === 'Testing').map(item => <label key={item.versionId}><input type="checkbox" aria-label={`${item.componentName} ${item.versionNumber}`} checked={versionIds.includes(item.versionId)} onChange={event => { setVersionIds(toggle(versionIds, item.versionId, event.target.checked)); setTargetKeys([]) }} /><span>{item.componentName}<strong>{item.versionNumber}</strong></span></label>)}</fieldset>
        <fieldset className="laboratory-selection wide-field" disabled={mutation.isPending}><legend>Lab 机台／腔室（可多选）</legend>{targets.map(target => <label key={scopeKey(target)}><input type="checkbox" checked={targetKeys.includes(scopeKey(target))} onChange={event => setTargetKeys(toggle(targetKeys, scopeKey(target), event.target.checked))} /><span>{scopeLabel(target)}<small>{target.serialNumber} · {target.location || '未登记位置'}</small></span></label>)}{targets.length === 0 && <p className="empty-state">{action === 'validations' ? '没有同时使用全部所选版本的 Lab 范围，请先登记实际升级。' : '暂无可选的 Lab 机台或腔室。'}</p>}</fieldset>
        <label>{action === 'deployments' ? '实际升级时间' : '实际验证时间'}<input type="datetime-local" step="1" value={time} onChange={event => setTime(event.target.value)} required disabled={mutation.isPending} /></label>
        {action === 'validations' && <label>验证结论<select value={result} onChange={event => setResult(event.target.value)} disabled={mutation.isPending}><option value="InProgress">待验证</option><option value="Passed">验证通过</option><option value="Failed">验证失败</option></select></label>}
        <label className="wide-field">{action === 'deployments' ? '升级原因' : '验证说明'}<textarea aria-label={action === 'deployments' ? '升级原因' : '验证说明'} value={reason} onChange={event => setReason(event.target.value)} maxLength={500} required disabled={mutation.isPending} /></label>
        <div className="form-actions wide-field"><button type="submit" className="primary-action" disabled={mutation.isPending || !targetKeys.length || !versionIds.length || !time || !reason.trim() || outcomes.length > 0 && outcomes.every(item => !item.error)}>{mutation.isPending ? '正在保存' : outcomes.some(item => item.error) ? '重试失败项' : action === 'deployments' ? '记录已完成的升级' : '保存验证结果'}</button></div>
        {outcomes.length > 0 && <ul className="laboratory-batch-results wide-field" aria-label="批量登记结果">{outcomes.map(item => <li key={item.label} className={item.error ? 'error-strip' : 'success-strip'}><strong>{item.label}</strong><span>{item.error || '已保存'}</span></li>)}</ul>}
        {mutation.isError && <p className="error-strip wide-field" role="alert">{mutation.error.message}</p>}
      </form>}
    </div>
  </Drawer>
}
