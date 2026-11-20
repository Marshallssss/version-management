import { useQuery } from '@tanstack/react-query'
import { request } from './catalog-api'
import { revisionLabel } from './revision-label'

export function RevisionIdentity({ versionId, revisionId }: { versionId: string | null; revisionId?: string | null }) {
  const revisions = useQuery({ queryKey: ['version-revisions', versionId], queryFn: () => request<Array<{ id: string; revisionNo: number; patches: Array<{ Id: string; PatchCode: string; Title: string; ResolutionDescription: string }> }>>(`/api/v1/component-versions/${versionId}/revisions`), enabled: !!versionId && !!revisionId })
  if (!versionId) return null
  if (!revisionId) return <small className="compare-source">补丁状态未确认</small>
  const selected = revisions.data?.find(r => r.id === revisionId)
  if (!selected) return <small className="compare-source">{revisions.isError ? '修订读取失败' : '正在读取修订'}</small>
  return <details className="revision-identity"><summary>{revisionLabel(selected.revisionNo)} · 冻结补丁 {selected.patches.length}</summary>{selected.patches.length ? selected.patches.map(p => <p key={p.Id}><strong>{p.PatchCode} · {p.Title}</strong><br />{p.ResolutionDescription}</p>) : <p>原始版，不含补丁。</p>}</details>
}

export function revisionResult(status?: string) {
  return status === 'Mismatch' ? '补丁修订不同' : status === 'Unknown' ? '补丁状态待确认' : status === 'Matched' ? '补丁修订相同' : ''
}
