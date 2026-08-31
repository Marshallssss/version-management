import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { compareMachines, getMachines } from './catalog-api'

export function MachineComparePanel() {
  const [leftMachineId, setLeftMachineId] = useState('')
  const [rightMachineId, setRightMachineId] = useState('')
  const machines = useQuery({ queryKey: ['machines'], queryFn: getMachines })
  const comparison = useQuery({ queryKey: ['machine-compare', leftMachineId, rightMachineId], queryFn: () => compareMachines(leftMachineId, rightMachineId), enabled: leftMachineId !== '' && rightMachineId !== '' && leftMachineId !== rightMachineId })
  return <section className="status-panel catalog-panel"><div className="panel-heading"><div><span className="section-index">机台比对</span><h3>当前实际配置差异</h3></div></div><div className="catalog-form"><label>左侧机台<select value={leftMachineId} onChange={(event) => setLeftMachineId(event.target.value)}><option value="">请选择机台</option>{machines.data?.map(machine => <option key={machine.id} value={machine.id}>{machine.serialNumber} · {machine.name}</option>)}</select></label><label>右侧机台<select value={rightMachineId} onChange={(event) => setRightMachineId(event.target.value)}><option value="">请选择机台</option>{machines.data?.map(machine => <option key={machine.id} value={machine.id} disabled={machine.id === leftMachineId}>{machine.serialNumber} · {machine.name}</option>)}</select></label></div>{comparison.data && <><dl className="runtime-list"><div><dt>版本匹配</dt><dd>{comparison.data.matchStatus === 'Matched' ? '匹配' : '不匹配'}</dd></div><div><dt>风险等级</dt><dd>{comparison.data.riskSeverity === 'Critical' ? '严重' : '无'}</dd></div></dl><div className="component-list">{comparison.data.items.map(item => <article className="component-row" key={item.componentId}><div><strong>{item.status === 'Matched' ? '相同' : item.status === 'LeftOnly' ? '仅左侧' : item.status === 'RightOnly' ? '仅右侧' : '版本不同'}</strong><span>组件 {item.componentId}</span></div><small>{item.leftVersionId ?? '无'} → {item.rightVersionId ?? '无'}</small></article>)}</div></>}{comparison.isError && <p className="error-strip">{comparison.error.message}</p>}</section>
}
