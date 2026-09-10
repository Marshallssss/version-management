import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SwapOutlined } from '@ant-design/icons'
import { compareBaselines, compareMachines, compareMachineToBaseline, getBaselines, getMachines } from './catalog-api'

type Side = { kind: 'Machine' | 'Baseline'; id: string }
type Row = { componentId: string; componentName: string; left: string | null; right: string | null; matched: boolean }
const riskNames: Record<string, string> = { None: '无', High: '高', Critical: '严重', Unknown: '未知' }

export function ConfigurationCompare({ projectId }: { projectId: string }) {
  const [left, setLeft] = useState<Side>({ kind: 'Machine', id: '' })
  const [right, setRight] = useState<Side>({ kind: 'Baseline', id: '' })
  const [onlyDifferences, setOnlyDifferences] = useState(false)
  const machines = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const baselines = useQuery({ queryKey: ['compare-project-baselines', projectId], queryFn: () => getBaselines(projectId), enabled: !!projectId })
  const projectMachines = machines.data?.filter(machine => machine.projectId === projectId) ?? []
  const same = left.kind === right.kind && left.id === right.id
  const comparison = useQuery({
    queryKey: ['configuration-comparison', projectId, left, right],
    enabled: !!projectId && !!left.id && !!right.id && !same,
    queryFn: async (): Promise<{ rows: Row[]; risk: string | null }> => {
      if (left.kind === 'Machine' && right.kind === 'Machine') {
        const data = await compareMachines(left.id, right.id)
        return { risk: data.riskSeverity, rows: data.items.map(item => ({ ...item, left: item.leftVersionNumber, right: item.rightVersionNumber, matched: item.status === 'Matched' })) }
      }
      if (left.kind === 'Baseline' && right.kind === 'Baseline') {
        const data = await compareBaselines(left.id, right.id)
        return { risk: null, rows: data.items.map(item => ({ ...item, left: item.leftVersionNumber ?? (item.status === 'Added' ? null : '结构分类节点'), right: item.rightVersionNumber ?? (item.status === 'Removed' ? null : '结构分类节点'), matched: item.status === 'Same' })) }
      }
      const machineOnLeft = left.kind === 'Machine'
      const data = await compareMachineToBaseline(machineOnLeft ? left.id : right.id, machineOnLeft ? right.id : left.id)
      return { risk: data.riskSeverity, rows: data.items.map(item => ({ ...item, left: machineOnLeft ? item.actualVersionNumber : item.expectedVersionNumber, right: machineOnLeft ? item.expectedVersionNumber : item.actualVersionNumber, matched: item.status === 'Matched' })) }
    },
  })
  const selectSide = (side: Side, setSide: (side: Side) => void, label: string) => <div className="compare-side"><div className="compare-side-heading"><strong>{label}</strong><div className="compare-kind" role="group" aria-label={label + '类型'}>{(['Machine', 'Baseline'] as const).map(kind => <button type="button" aria-pressed={side.kind === kind} key={kind} onClick={() => { if (kind === side.kind) return; setSide({ kind, id: '' }); const other = label === '左侧' ? right : left; if (kind === 'Machine' && other.kind === 'Baseline' && other.id && !baselines.data?.some(baseline => baseline.id === other.id && baseline.state === 'Released')) (label === '左侧' ? setRight : setLeft)({ ...other, id: '' }) }}>{kind === 'Machine' ? '机台' : '基线'}</button>)}</div></div><select aria-label={label + '配置'} value={side.id} onChange={event => setSide({ ...side, id: event.target.value })}><option value="">选择{side.kind === 'Machine' ? '机台' : '基线'}</option>{side.kind === 'Machine' ? projectMachines.map(machine => <option key={machine.id} value={machine.id}>{machine.name} · {machine.serialNumber}</option>) : baselines.data?.filter(baseline => left.kind === 'Machine' || right.kind === 'Machine' ? baseline.state === 'Released' : true).map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.code} · 修订 {baseline.revisionNo}{baseline.state === 'Draft' ? ' · 草稿' : baseline.state === 'Deprecated' ? ' · 已撤回' : ''}</option>)}</select></div>
  const rows = comparison.data?.rows.filter(row => !onlyDifferences || !row.matched) ?? []
  if (!projectId) return <section className="configuration-compare"><p className="empty-state">请先在顶部选择项目。</p></section>
  return <section className="configuration-compare">
    <div className="compare-selectors">{selectSide(left, setLeft, '左侧')}<button className="compare-swap" type="button" title="交换左右配置" aria-label="交换左右配置" onClick={() => { setLeft(right); setRight(left) }}><SwapOutlined /></button>{selectSide(right, setRight, '右侧')}</div>
    <div className="compare-results-heading"><div><strong>配置差异</strong>{comparison.data && <span>{comparison.data.rows.length} 个组件 · {comparison.data.rows.filter(row => !row.matched).length} 项差异</span>}</div><label><input type="checkbox" checked={onlyDifferences} onChange={event => setOnlyDifferences(event.target.checked)} />只看差异</label></div>
    {comparison.data && <div className="compare-summary"><span>版本匹配：{comparison.data.rows.length === 0 ? '无可比配置' : comparison.data.rows.every(row => row.matched) ? '匹配' : '不匹配'}</span><span>风险：{comparison.data.risk === null ? '此对比不评估风险' : riskNames[comparison.data.risk] ?? '未知'}</span></div>}
    {!left.id || !right.id ? <p className="empty-state">选择左右配置后显示对比结果。</p> : same ? <p className="empty-state">请选择两个不同的配置。</p> : comparison.isLoading ? <p className="empty-state">正在对比配置。</p> : comparison.isError ? <p className="error-strip">{comparison.error.message}</p> : <div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th>组件</th><th>左侧版本</th><th>右侧版本</th><th>结果</th></tr></thead><tbody>{rows.map(row => <tr key={row.componentId} className={row.matched ? '' : 'changed'}><th>{row.componentName}</th><td>{row.left ?? '未配置'}</td><td>{row.right ?? '未配置'}</td><td>{row.matched ? '相同' : row.left === null ? '仅右侧' : row.right === null ? '仅左侧' : '版本不同'}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="empty-state">{onlyDifferences ? '没有配置差异。' : '暂无可对比的组件配置。'}</p>}</div>}
    {(machines.isError || baselines.isError) && <p className="error-strip">配置列表读取失败，请刷新重试。</p>}
  </section>
}
