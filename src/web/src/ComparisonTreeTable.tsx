import { useState, type CSSProperties, type ReactNode } from 'react'
import { DownOutlined, RightOutlined } from '@ant-design/icons'
import './comparison-tree.css'

export type ComparisonNode = { id: string; parentId: string | null; name: string; sortOrder: number }

export function snapshotNodes(items: Array<{ id: string; componentId: string; parentItemId: string | null; componentName: string; sortOrder: number }>): ComparisonNode[] {
  const componentByItem = new Map(items.map(item => [item.id, item.componentId]))
  return items.map(item => ({ id: item.componentId, parentId: item.parentItemId ? componentByItem.get(item.parentItemId) ?? null : null, name: item.componentName, sortOrder: item.sortOrder }))
}

export function comparisonPath(nodes: ComparisonNode[], id: string) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const path: ComparisonNode[] = []
  const visited = new Set<string>()
  let node = byId.get(id)
  while (node && !visited.has(node.id)) {
    visited.add(node.id)
    path.unshift(node)
    node = node.parentId ? byId.get(node.parentId) : undefined
  }
  return path
}

export function hierarchyChanged(left: ComparisonNode[], right: ComparisonNode[], id: string) {
  if (!left.some(node => node.id === id) || !right.some(node => node.id === id)) return false
  return JSON.stringify(comparisonPath(left, id).map(node => [node.id, node.name])) !== JSON.stringify(comparisonPath(right, id).map(node => [node.id, node.name]))
}

type Item = { componentId: string; componentName: string }

export function ComparisonTreeTable<T extends Item>({ rows, primary, secondary, leftNodes, rightNodes, onlyDifferences, isDifferent, rowClass, header, renderCells, className, emptyText, columnCount = 4, leftLabel = '左', rightLabel = '右' }: {
  rows: T[]; primary: ComparisonNode[]; secondary: ComparisonNode[]; leftNodes: ComparisonNode[]; rightNodes: ComparisonNode[]
  onlyDifferences: boolean; isDifferent: (row: T) => boolean; rowClass: (row: T) => string
  header: ReactNode; renderCells: (row: T) => ReactNode; className: string; emptyText: string
  columnCount?: 3 | 4; leftLabel?: string; rightLabel?: string
}) {
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const rowById = new Map(rows.map(row => [row.componentId, row]))
  const nodes = new Map(secondary.map(node => [node.id, node]))
  for (const node of primary) nodes.set(node.id, node)
  for (const row of rows) if (!nodes.has(row.componentId)) nodes.set(row.componentId, { id: row.componentId, name: row.componentName, parentId: null, sortOrder: Number.MAX_SAFE_INTEGER })
  const changedStructure = new Set(rows.filter(row => hierarchyChanged(leftNodes, rightNodes, row.componentId)).map(row => row.componentId))
  const included = new Set<string>()
  for (const row of rows) {
    if (onlyDifferences && !isDifferent(row) && !changedStructure.has(row.componentId)) continue
    let node = nodes.get(row.componentId)
    const visited = new Set<string>()
    while (node && !visited.has(node.id)) {
      visited.add(node.id)
      included.add(node.id)
      node = node.parentId ? nodes.get(node.parentId) : undefined
    }
  }
  const children = new Map<string | null, ComparisonNode[]>()
  for (const id of included) {
    const node = nodes.get(id)!
    const parent = node.parentId && included.has(node.parentId) ? node.parentId : null
    children.set(parent, [...children.get(parent) ?? [], node])
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) || a.id.localeCompare(b.id))
  const visible = new Set<string>()
  const renderNode = (node: ComparisonNode, depth: number): ReactNode => {
    if (visible.has(node.id)) return null
    visible.add(node.id)
    const row = rowById.get(node.id)
    const branches = children.get(node.id) ?? []
    const expanded = !collapsed.has(node.id)
    const changed = changedStructure.has(node.id)
    const path = (side: ComparisonNode[]) => comparisonPath(side, node.id).map(item => item.name).join(' / ')
    return [<tr key={node.id} data-component-id={node.id} data-depth={depth} className={`comparison-tree-row${depth === 0 ? ' comparison-tree-root' : ''}${row ? ` ${rowClass(row)}` : ' comparison-tree-context'}${changed ? ' hierarchy-changed' : ''}`}>
      <th scope="row"><div className="comparison-tree-label" style={{ '--tree-depth': Math.min(depth, 6) } as CSSProperties}>
        {branches.length > 0 ? <button type="button" className="comparison-tree-toggle" aria-label={`${expanded ? '收起' : '展开'}${node.name}`} aria-expanded={expanded} title={`${expanded ? '收起' : '展开'}${node.name}`} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next })}>{expanded ? <DownOutlined /> : <RightOutlined />}</button> : <span className="comparison-tree-leaf" aria-hidden />}
        <div><span>{node.name}</span>{changed && <small className="comparison-tree-path">{leftLabel}：{path(leftNodes)}<br />{rightLabel}：{path(rightNodes)}</small>}</div>
      </div></th>
      {row ? renderCells(row) : <td colSpan={columnCount - 1}><span className="comparison-tree-context-label">父级组件</span></td>}
    </tr>, expanded && branches.map(child => renderNode(child, depth + 1))]
  }
  const body = (children.get(null) ?? []).map(node => renderNode(node, 0))
  // Retain data even if a legacy hierarchy contains an orphan or a cycle.
  for (const id of included) if (!visible.has(id) && !comparisonPath([...nodes.values()], id).some(node => collapsed.has(node.id))) body.push(renderNode(nodes.get(id)!, 0))
  return <div className="comparison-table-wrap"><table className={`${className} comparison-tree-table`}><colgroup><col className="comparison-component-column" /><col /><col />{columnCount === 4 && <col className="comparison-result-column" />}</colgroup><thead>{header}</thead><tbody>{body}</tbody></table>{included.size === 0 && <p className="empty-state">{emptyText}</p>}</div>
}
