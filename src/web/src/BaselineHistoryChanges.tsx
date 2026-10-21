import { useQuery } from '@tanstack/react-query'
import { getBaselineDetail } from './catalog-api'
import { ComparisonTreeTable, comparisonPath, hierarchyChanged, snapshotNodes } from './ComparisonTreeTable'

type Snapshot = Awaited<ReturnType<typeof getBaselineDetail>>
type SnapshotItem = Snapshot['items'][number]

function versionLabel(item: SnapshotItem | undefined) {
  return !item ? '未纳入' : item.notConfigured ? '当时未配置' : item.versionNumber ?? '结构分类节点'
}

export function BaselineHistoryChanges({ previousId, previousName, current }: { previousId: string; previousName: string; current: Snapshot }) {
  const previous = useQuery({ queryKey: ['baseline-detail', previousId], queryFn: () => getBaselineDetail(previousId) })
  const before = new Map(previous.data?.items.map(item => [item.componentId, item]) ?? [])
  const after = new Map(current.items.map(item => [item.componentId, item]))
  const leftNodes = snapshotNodes(previous.data?.items ?? [])
  const rightNodes = snapshotNodes(current.items)
  const rows = [...new Set([...after.keys(), ...before.keys()])].map(componentId => {
    const left = before.get(componentId)
    const right = after.get(componentId)
    const changes: string[] = []
    if (!left) changes.push('已新增')
    else if (!right) changes.push('已移除')
    else {
      if (left.versionId !== right.versionId || left.versionNumber !== right.versionNumber || left.notConfigured !== right.notConfigured) changes.push('版本或配置变化')
      if (hierarchyChanged(leftNodes, rightNodes, componentId)) changes.push('层级或名称变化')
      if (left.requirement !== right.requirement) changes.push('必选性变化')
      if (left.sortOrder !== right.sortOrder) changes.push('排序变化')
    }
    return { componentId, componentName: (right ?? left)!.componentName, left, right, changes }
  })
  const changedCount = rows.filter(row => row.changes.length > 0).length
  const cell = (item: SnapshotItem | undefined) => <>{versionLabel(item)}{item?.versionId && <small className="snapshot-requirement">{item.requirement === 'Optional' ? '可选' : '必选'}</small>}</>
  return <section className="baseline-difference">
    <div><span className="section-index">快照变化</span><h4>相对于 {previousName}</h4></div>
    {previous.isPending ? <p role="status">正在比较快照。</p> : previous.isError ? <div role="alert"><p>快照比较暂不可用。</p><button type="button" onClick={() => void previous.refetch()}>重试</button></div> : <>
      <p>{changedCount ? `${changedCount} 个组件发生变化。` : '组件版本与结构没有变化。'}</p>
      {changedCount > 0 && <details key={`${previousId}:${current.baseline.id}`}><summary>展开新旧版本</summary>
        <div><p className="comparison-structure-summary">按新基线冻结层级分组，已移除组件附旧快照归属。</p>
          <ComparisonTreeTable key={`${previousId}:${current.baseline.id}`} rows={rows} primary={rightNodes} secondary={leftNodes} leftNodes={leftNodes} rightNodes={rightNodes} leftLabel="旧基线" rightLabel="新基线" onlyDifferences isDifferent={row => row.changes.length > 0} rowClass={row => row.changes.length ? 'changed' : ''} className="baseline-change-table" emptyText="没有快照变化。"
            header={<tr><th scope="col">组件</th><th scope="col">旧基线</th><th scope="col">新基线</th><th scope="col">变化</th></tr>}
            renderCells={row => <><td>{cell(row.left)}{row.left && !row.right && <small className="comparison-tree-path">旧归属：{comparisonPath(leftNodes, row.componentId).map(node => node.name).join(' / ')}</small>}</td><td>{cell(row.right)}</td><td>{row.changes.length ? row.changes.map(change => <span className="change-label" key={change}>{change}</span>) : <span className="comparison-tree-context-label">未变化</span>}</td></>} />
        </div>
      </details>}
    </>}
  </section>
}
