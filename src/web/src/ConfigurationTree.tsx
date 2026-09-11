import type { ReactNode } from 'react'
import type { ConfigurationComponent } from './catalog-api'

type ActualItem = { componentId: string; componentName: string; versionId: string | null; versionNumber: string | null; state: string; stateEffectiveAt: string; knownInstalledAt: string | null }

export function ConfigurationTree({ components, items, onOpenVersion }: { components: ConfigurationComponent[]; items: ActualItem[]; onOpenVersion: (versionId: string) => void }) {
  const byId = new Map(items.map(item => [item.componentId, item]))
  const knownIds = new Set(components.map(component => component.id))
  const children = new Map<string | null, ConfigurationComponent[]>()
  for (const component of [...components].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))) {
    const parent = component.parentComponentId && knownIds.has(component.parentComponentId) ? component.parentComponentId : null
    children.set(parent, [...children.get(parent) ?? [], component])
  }
  const versionLabel = (item: ActualItem | undefined, component: ConfigurationComponent) => item?.state === 'Absent' ? '已确认缺失' : item?.versionNumber ?? (component.versions.length ? '尚未观察' : '结构分类')
  const node = (component: ConfigurationComponent, root: boolean): ReactNode => {
    const item = byId.get(component.id)
    return <div key={component.id} className={root ? 'actual-root-column' : 'actual-child-branch'}>
      <button type="button" className={`actual-node${root ? ' actual-root' : ''}${item?.state === 'Absent' ? ' absent' : ''}`} disabled={!item?.versionId} onClick={() => item?.versionId && onOpenVersion(item.versionId)} title={`${component.name}\n${versionLabel(item, component)}${item ? `\n状态生效：${new Date(item.stateEffectiveAt).toLocaleString('zh-CN')}\n已知安装：${item.knownInstalledAt ? new Date(item.knownInstalledAt).toLocaleString('zh-CN') : '未知'}` : ''}`}>
        <strong>{component.name}</strong><span>{versionLabel(item, component)}</span>
      </button>
      {(children.get(component.id) ?? []).length > 0 && <div className="actual-children">{children.get(component.id)!.map(child => node(child, false))}</div>}
    </div>
  }
  return <div className="actual-configuration-tree">{(children.get(null) ?? []).map(component => node(component, true))}{items.filter(item => !knownIds.has(item.componentId)).map(item => <div key={item.componentId} className="actual-root-column"><button type="button" className="actual-node" disabled={!item.versionId} onClick={() => item.versionId && onOpenVersion(item.versionId)}><strong>{item.componentName}</strong><span>{item.versionNumber ?? '已确认缺失'}</span></button></div>)}</div>
}
