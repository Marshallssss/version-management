import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SwapOutlined } from '@ant-design/icons'
import { compareBaselines, compareMachines, compareMachineToBaseline, getBaselines, getMachines, type ChamberComparison, type ChamberComparisonItem, type ChamberComparisonState, type ChamberComparisonSource } from './catalog-api'

type Side = { kind: 'Machine' | 'Baseline'; id: string }
type Row = { componentId: string; componentName: string; left: string | null; right: string | null; matched: boolean }
type Chamber = Omit<ChamberComparison, 'leftInstalled'> & { leftInstalled: boolean | null }
type Comparison = { rows: Row[]; risk: string | null; chambers: Chamber[] }
const riskNames: Record<string, string> = { None: '无', High: '高', Critical: '严重', Unknown: '未知' }
const matchNames = { Matched: '匹配', Mismatch: '不匹配', Unknown: '信息不足' }
const sourceNames = { Machine: '沿用整机', Override: 'PM 特例', Baseline: '基线快照', NotInstalled: '' }

function orientChambers(chambers: ChamberComparison[], reverse = false): Chamber[] {
  return chambers.map(chamber => !reverse ? chamber : {
    ...chamber, leftInstalled: chamber.rightInstalled, rightInstalled: chamber.leftInstalled,
    items: chamber.items.map(item => ({
      ...item,
      status: item.status === 'LeftOnly' ? 'RightOnly' : item.status === 'RightOnly' ? 'LeftOnly' : item.status,
      leftVersionId: item.rightVersionId, leftVersionNumber: item.rightVersionNumber, leftState: item.rightState, leftSource: item.rightSource,
      rightVersionId: item.leftVersionId, rightVersionNumber: item.leftVersionNumber, rightState: item.leftState, rightSource: item.leftSource,
    })),
  })
}

function ChamberValue({ version, state, source }: { version: string | null; state: ChamberComparisonState; source: ChamberComparisonSource }) {
  const value = state === 'NotInstalled' ? '未安装' : state === 'Unknown' ? '尚未观察' : state === 'Absent' ? source === 'Baseline' ? '快照未包含' : '已确认缺失' : version ?? '未知版本'
  return <><span>{value}</span>{sourceNames[source] && <small className={source === 'Override' ? 'compare-source is-override' : 'compare-source'}>{sourceNames[source]}</small>}</>
}

function chamberResult(item: ChamberComparisonItem) {
  if (item.leftState === 'NotInstalled' || item.rightState === 'NotInstalled') return '安装情况不同'
  if (item.status === 'Unknown') return '信息不足'
  if (item.status === 'Matched') return '相同'
  if (item.status === 'LeftOnly') return '仅左侧'
  if (item.status === 'RightOnly') return '仅右侧'
  return '版本不同'
}

export function ConfigurationCompare({ projectId }: { projectId: string }) {
  const [left, setLeft] = useState<Side>({ kind: 'Machine', id: '' })
  const [right, setRight] = useState<Side>({ kind: 'Baseline', id: '' })
  const [onlyDifferences, setOnlyDifferences] = useState(false)
  const [scope, setScope] = useState<number | null>(null)
  const machines = useQuery({ queryKey: ['machines'], queryFn: getMachines, refetchOnMount: 'always' })
  const baselines = useQuery({ queryKey: ['compare-project-baselines', projectId], queryFn: () => getBaselines(projectId), enabled: !!projectId })
  const projectMachines = machines.data?.filter(machine => machine.projectId === projectId) ?? []
  const same = left.kind === right.kind && left.id === right.id
  const comparison = useQuery({
    queryKey: ['configuration-comparison', projectId, left, right],
    enabled: !!projectId && !!left.id && !!right.id && !same,
    refetchOnMount: 'always',
    queryFn: async (): Promise<Comparison> => {
      if (left.kind === 'Machine' && right.kind === 'Machine') {
        const data = await compareMachines(left.id, right.id)
        return { risk: data.riskSeverity, chambers: orientChambers(data.chambers), rows: data.items.map(item => ({ ...item, left: item.leftVersionNumber, right: item.rightVersionNumber, matched: item.status === 'Matched' })) }
      }
      if (left.kind === 'Baseline' && right.kind === 'Baseline') {
        const data = await compareBaselines(left.id, right.id)
        return { risk: null, chambers: [], rows: data.items.map(item => ({ ...item, left: item.leftVersionNumber ?? (item.status === 'Added' ? null : '结构分类节点'), right: item.rightVersionNumber ?? (item.status === 'Removed' ? null : '结构分类节点'), matched: item.status === 'Same' })) }
      }
      const machineOnLeft = left.kind === 'Machine'
      const data = await compareMachineToBaseline(machineOnLeft ? left.id : right.id, machineOnLeft ? right.id : left.id)
      return { risk: data.riskSeverity, chambers: orientChambers(data.chambers, !machineOnLeft), rows: data.items.map(item => ({ ...item, left: machineOnLeft ? item.actualVersionNumber : item.expectedVersionNumber, right: machineOnLeft ? item.expectedVersionNumber : item.actualVersionNumber, matched: item.status === 'Matched' })) }
    },
  })
  const selectSide = (side: Side, setSide: (side: Side) => void, label: string) => <div className="compare-side"><div className="compare-side-heading"><strong>{label}</strong><div className="compare-kind" role="group" aria-label={label + '类型'}>{(['Machine', 'Baseline'] as const).map(kind => <button type="button" aria-pressed={side.kind === kind} key={kind} onClick={() => { if (kind === side.kind) return; setSide({ kind, id: '' }); const other = label === '左侧' ? right : left; if (kind === 'Machine' && other.kind === 'Baseline' && other.id && !baselines.data?.some(baseline => baseline.id === other.id && baseline.state === 'Released')) (label === '左侧' ? setRight : setLeft)({ ...other, id: '' }) }}>{kind === 'Machine' ? '机台' : '基线'}</button>)}</div></div><select aria-label={label + '配置'} value={side.id} onChange={event => setSide({ ...side, id: event.target.value })}><option value="">选择{side.kind === 'Machine' ? '机台' : '基线'}</option>{side.kind === 'Machine' ? projectMachines.map(machine => <option key={machine.id} value={machine.id}>{machine.name} · {machine.serialNumber}</option>) : baselines.data?.filter(baseline => left.kind === 'Machine' || right.kind === 'Machine' ? baseline.state === 'Released' : true).map(baseline => <option key={baseline.id} value={baseline.id}>{baseline.code} · 修订 {baseline.revisionNo}{baseline.state === 'Draft' ? ' · 草稿' : baseline.state === 'Deprecated' ? ' · 已撤回' : ''}</option>)}</select></div>
  const rows = comparison.data?.rows.filter(row => !onlyDifferences || !row.matched) ?? []
  const chamber = comparison.data?.chambers.find(item => item.number === scope)
  const chamberRows = chamber?.items.filter(item => !onlyDifferences || item.status !== 'Matched') ?? []
  const scopeLabel = left.kind === 'Baseline' && right.kind === 'Baseline' ? '基线' : '整机'
  const nameOf = (side: Side) => side.kind === 'Machine' ? projectMachines.find(machine => machine.id === side.id)?.name : baselines.data?.find(baseline => baseline.id === side.id)?.code
  const leftName = nameOf(left); const rightName = nameOf(right)
  const ready = !!comparison.data && !!left.id && !!right.id && !same && !comparison.isError
  if (!projectId) return <section className="configuration-compare"><p className="empty-state">请先在顶部选择项目。</p></section>
  return <section className="configuration-compare">
    <div className="compare-selectors">{selectSide(left, setLeft, '左侧')}<button className="compare-swap" type="button" title="交换左右配置" aria-label="交换左右配置" onClick={() => { setLeft(right); setRight(left) }}><SwapOutlined /></button>{selectSide(right, setRight, '右侧')}</div>
    <div className="compare-results-heading"><div><strong>配置差异</strong>{ready && <span>{chamber ? `${chamber.items.length} 个组件 · ${chamber.items.filter(item => item.status !== 'Matched' && item.status !== 'Unknown').length} 项差异 · ${chamber.items.filter(item => item.status === 'Unknown').length} 项待确认` : `${comparison.data!.rows.length} 个组件 · ${comparison.data!.rows.filter(row => !row.matched).length} 项差异`}</span>}</div><label><input type="checkbox" checked={onlyDifferences} onChange={event => setOnlyDifferences(event.target.checked)} />只看差异</label></div>
    {ready && <>
      <div className="compare-scope-tabs" role="tablist" aria-label="配置范围" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
        const index = tabs.indexOf(event.target as HTMLButtonElement)
        if (index < 0) return
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
        tabs[next].focus(); tabs[next].click()
      }}>
        <button type="button" role="tab" id="compare-scope-whole" aria-controls="compare-whole-panel" aria-label={scopeLabel} aria-selected={!chamber} tabIndex={chamber ? -1 : 0} onClick={() => setScope(null)}>{scopeLabel}</button>
        {comparison.data!.chambers.map(item => <button type="button" role="tab" id={`compare-scope-${item.number}`} aria-controls={`compare-pm-${item.number}`} aria-label={`PM${item.number}`} aria-selected={item.number === chamber?.number} tabIndex={item.number === chamber?.number ? 0 : -1} key={item.number} onClick={() => setScope(item.number)}><strong>PM{item.number}</strong><span className={item.matchStatus === 'Matched' ? '' : 'compare-attention'}>{matchNames[item.matchStatus]}</span>{item.riskSeverity === 'Critical' && <span className="compare-critical">严重风险</span>}</button>)}
      </div>
      {!chamber ? <div role="tabpanel" id="compare-whole-panel" aria-label={`${scopeLabel}配置对比`}>
        <div className="compare-summary"><span>版本匹配：{comparison.data!.rows.length === 0 ? '无可比配置' : comparison.data!.rows.every(row => row.matched) ? '匹配' : '不匹配'}</span><span className={comparison.data!.risk === 'Critical' ? 'compare-critical' : ''}>风险：{comparison.data!.risk === null ? '此对比不评估风险' : riskNames[comparison.data!.risk] ?? '未知'}</span></div>
        <div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th scope="col">组件</th><th scope="col">左侧版本<small>{leftName}</small></th><th scope="col">右侧版本<small>{rightName}</small></th><th scope="col">结果</th></tr></thead><tbody>{rows.map(row => <tr key={row.componentId} className={row.matched ? '' : 'changed'}><th scope="row">{row.componentName}</th><td>{row.left ?? '未配置'}</td><td>{row.right ?? '未配置'}</td><td>{row.matched ? '相同' : row.left === null ? '仅右侧' : row.right === null ? '仅左侧' : '版本不同'}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="empty-state">{onlyDifferences ? '没有配置差异。' : '暂无可对比的组件配置。'}</p>}</div>
      </div> : <div role="tabpanel" id={`compare-pm-${chamber.number}`} aria-label={`PM${chamber.number} 配置对比`}>
        <div className="chamber-comparison-summary"><strong>PM{chamber.number}</strong><span>版本匹配：{matchNames[chamber.matchStatus]}</span><span className={chamber.riskSeverity === 'Critical' ? 'compare-critical' : ''}>风险：{riskNames[chamber.riskSeverity] ?? '未知'}</span></div>
        <table className="chamber-comparison-table"><thead><tr><th scope="col">组件</th><th scope="col">左侧版本<small>{leftName} · {chamber.leftInstalled === null ? '基线快照' : chamber.leftInstalled ? `PM${chamber.number} 已安装` : '未安装'}</small></th><th scope="col">右侧版本<small>{rightName} · {chamber.rightInstalled === null ? '基线快照' : chamber.rightInstalled ? `PM${chamber.number} 已安装` : '未安装'}</small></th><th scope="col">结果</th></tr></thead><tbody>{chamberRows.map(item => <tr key={item.componentId} className={item.status === 'Matched' ? '' : item.status === 'Unknown' ? 'unconfirmed' : 'changed'}><th scope="row">{item.componentName}</th><td><ChamberValue version={item.leftVersionNumber} state={item.leftState} source={item.leftSource} /></td><td><ChamberValue version={item.rightVersionNumber} state={item.rightState} source={item.rightSource} /></td><td>{chamberResult(item)}</td></tr>)}</tbody></table>
        {chamberRows.length === 0 && <p className="empty-state">{chamber.items.length ? '此腔室没有配置差异。' : chamber.leftInstalled === false || chamber.rightInstalled === false ? '两侧腔室安装情况不同，暂无组件配置记录。' : '尚无组件配置记录，无法确认版本是否匹配。'}</p>}
      </div>}
    </>}
    {!left.id || !right.id ? <p className="empty-state">选择左右配置后显示对比结果。</p> : same ? <p className="empty-state">请选择两个不同的配置。</p> : comparison.isLoading ? <p className="empty-state">正在对比配置。</p> : comparison.isError ? <p className="error-strip" role="alert">{comparison.error.message}</p> : null}
    {(machines.isError || baselines.isError) && <p className="error-strip">配置列表读取失败，请刷新重试。</p>}
  </section>
}
