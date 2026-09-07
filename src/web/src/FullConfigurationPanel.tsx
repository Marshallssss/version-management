import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getBaselineDetail, getBaselines, getMachineConfiguration, recordMachineFacts, type ConfigurationComponent } from './catalog-api'

const absentValue = '__absent__'

function nowForInput() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function versionLabel(version: ConfigurationComponent['versions'][number]) {
  const maturity = version.maturity === 'Testing' ? '测试中' : version.maturity === 'Released' ? '已发布' : version.maturity === 'Maintenance' ? '维护中' : version.maturity === 'Deprecated' ? '已废弃' : '草稿'
  return `${version.versionNumber} · ${maturity}`
}

export function FullConfigurationPanel({ machineId, projectId, components, onRecorded }: { machineId: string; projectId: string; components: ConfigurationComponent[]; onRecorded: () => void }) {
  const queryClient = useQueryClient()
  const [templateBaselineId, setTemplateBaselineId] = useState('')
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [operationType, setOperationType] = useState('InitialSnapshot')
  const [effectiveAt, setEffectiveAt] = useState(nowForInput)
  const [reason, setReason] = useState('')
  const configurableComponents = useMemo(() => components.filter(component => component.versions.length > 0), [components])
  const configuration = useQuery({ queryKey: ['machine-configuration', machineId], queryFn: () => getMachineConfiguration(machineId) })
  const baselines = useQuery({ queryKey: ['full-configuration-baselines', projectId], queryFn: () => getBaselines(projectId) })
  const baselineDetail = useQuery({ queryKey: ['full-configuration-baseline', templateBaselineId], queryFn: () => getBaselineDetail(templateBaselineId), enabled: templateBaselineId !== '' })

  useEffect(() => {
    setTemplateBaselineId('')
    setSelections({})
    setReason('')
    setEffectiveAt(nowForInput())
  }, [machineId])

  useEffect(() => {
    if (!baselineDetail.data) return
    const selectedByComponent = new Map(baselineDetail.data.items.filter(item => item.versionId !== null).map(item => [item.componentId, item.versionId!]))
    setSelections(Object.fromEntries(configurableComponents.map(component => [component.id, selectedByComponent.get(component.id) ?? absentValue])))
  }, [baselineDetail.data, configurableComponents])

  const loadCurrentConfiguration = () => {
    const currentByComponent = new Map(configuration.data?.map(item => [item.componentId, item.state === 'Present' && item.versionId ? item.versionId : absentValue]))
    setTemplateBaselineId('')
    setSelections(Object.fromEntries(configurableComponents.map(component => [component.id, currentByComponent.get(component.id) ?? absentValue])))
  }

  const saveFullConfiguration = useMutation({
    mutationFn: () => recordMachineFacts(machineId, {
      operationType,
      coverage: 'Full',
      sourceType: 'manual-ui',
      effectiveAt: new Date(effectiveAt).toISOString(),
      reason,
      items: configurableComponents.map(component => ({ componentId: component.id, versionId: selections[component.id] === absentValue ? null : selections[component.id], absent: selections[component.id] === absentValue, knownInstalledAt: null })),
    }),
    onSuccess: async () => {
      setReason('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['machine-configuration', machineId] }),
        queryClient.invalidateQueries({ queryKey: ['machine-facts', machineId] }),
        queryClient.invalidateQueries({ queryKey: ['machine-drift', machineId] }),
        queryClient.invalidateQueries({ queryKey: ['machine-project-standard-comparison'] }),
      ])
      onRecorded()
    },
  })
  const complete = configurableComponents.length > 0 && configurableComponents.every(component => selections[component.id] !== undefined)

  return <section className="status-panel catalog-panel full-configuration-panel">
    <div className="panel-heading"><div><span className="section-index">完整实际配置</span><h3>加载模板后逐组件确认</h3></div><span className="count">{configurableComponents.length}</span></div>
    <details>
      <summary>打开完整配置工作台</summary>
      <div className="full-configuration-actions">
        <label>已发布基线模板<select value={templateBaselineId} onChange={(event) => setTemplateBaselineId(event.target.value)}><option value="">不加载基线模板</option>{baselines.data?.filter(baseline => baseline.state === 'Released').map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.code} · Revision {baseline.revisionNo}</option>)}</select></label>
        <button type="button" onClick={loadCurrentConfiguration} disabled={configuration.isLoading}>加载当前实际配置</button>
      </div>
      <p className="form-hint">基线模板只用于快速填写，随后可逐项改为已发布或测试中版本，也可标记缺失。它不会自动成为升级来源或机台目标。</p>
      <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); saveFullConfiguration.mutate() }}>
        <label>事实类型<select value={operationType} onChange={(event) => setOperationType(event.target.value)}><option value="InitialSnapshot">初始快照</option><option value="Observation">完整观察</option><option value="Upgrade">完整升级记录</option></select></label>
        <label>生效时间<input type="datetime-local" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required /></label>
        <label className="wide-field">记录原因<input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} required /></label>
        <div className="full-configuration-grid wide-field">
          {configurableComponents.map(component => <label className="full-configuration-row" key={component.id}><span>{component.name}</span><select value={selections[component.id] ?? ''} onChange={(event) => setSelections(current => ({ ...current, [component.id]: event.target.value }))} required><option value="">请选择版本或缺失</option><option value={absentValue}>标记为缺失</option>{component.versions.map(version => <option key={version.id} value={version.id}>{versionLabel(version)}</option>)}</select></label>)}
        </div>
        <button className="primary-action" type="submit" disabled={saveFullConfiguration.isPending || !complete}>{saveFullConfiguration.isPending ? '正在记录完整配置' : `记录 ${configurableComponents.length} 个组件`}</button>
      </form>
      <p className="empty-state">完整记录会把未报告的组件明确设为缺失。仅要修改一个组件时，请使用下方的“局部观察”；从已发布基线为多台机台登记升级，请使用“批量升级”，以保留来源基线审计。</p>
      {saveFullConfiguration.isError && <p className="error-strip">{saveFullConfiguration.error.message}</p>}
    </details>
  </section>
}
