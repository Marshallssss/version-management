import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request, getVersionDetail } from './catalog-api'
import { createIdempotencyKey } from './idempotency-key'

type FrozenPatch = { Id: string; PatchCode: string; Title: string; IssueDescription: string; ResolutionDescription: string }
type Revision = { id: string; revisionNo: number; patches: FrozenPatch[]; createdAt: string; reason: string }
export function VersionRevisionsPanel({ versionId, canPublish }: { versionId: string; canPublish: boolean }) {
  const cache = useQueryClient()
  const [selected, setSelected] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const route = `/api/v1/component-versions/${versionId}/revisions`
  const revisions = useQuery({ queryKey: ['version-revisions', versionId], queryFn: () => request<Revision[]>(route) })
  const detail = useQuery({ queryKey: ['project-version-detail', versionId], queryFn: () => getVersionDetail(versionId) })
  const inherited = revisions.data?.at(-1)?.patches ?? []
  const additions = detail.data?.patches.filter(p => p.status === 'Released' && !inherited.some(x => x.Id === p.id)) ?? []
  const publish = useMutation({
    mutationFn: () => request(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify({ patchIds: [...inherited.map(x => x.Id), ...selected], reason }) }),
    onSuccess: async () => { setSelected([]); setReason(''); await cache.invalidateQueries({ queryKey: ['version-revisions', versionId] }) },
  })
  return <section className="version-history">
    <div className="subsection-heading"><h4>累计补丁修订</h4></div>
    <p className="form-hint">原始版不含补丁。发布修订冻结补丁内容，后续修改修复记录不会改变此快照，也不代表机台已经安装。</p>
    {revisions.isLoading && <p role="status">正在读取修订。</p>}
    {revisions.isError && <p className="error-strip">{revisions.error.message}</p>}
    {revisions.data?.map(r => <details key={r.id}><summary>{r.revisionNo === 0 ? '原始版' : `修订 ${r.revisionNo}`} · {r.patches.length} 个补丁</summary><p className="form-hint">{r.reason} · {new Date(r.createdAt).toLocaleString('zh-CN')}</p>{r.patches.map(p => <article key={p.Id}><strong>{p.PatchCode} · {p.Title}</strong><p>{p.ResolutionDescription}</p></article>)}</details>)}
    {revisions.data?.length === 0 && <p className="empty-state">尚未建立修订。历史机台的补丁状态保持未确认。</p>}
    {canPublish && <form className="workspace-form" onSubmit={e => { e.preventDefault(); publish.mutate() }}>
      <p className="form-hint wide-field">已有 {inherited.length} 个补丁自动保留。勾选新增补丁，发布一个累计修订。</p>
      {additions.map(p => <label className="wide-field historical-registration-toggle" key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))} />{p.patchCode} · {p.title}</label>)}
      <label className="wide-field">修订发布原因<input value={reason} maxLength={500} required onChange={e => setReason(e.target.value)} /></label>
      <button type="submit" disabled={publish.isPending || revisions.isLoading || revisions.isError || (!!revisions.data?.length && !selected.length)}>{publish.isPending ? '正在发布' : selected.length ? '发布累计修订' : '建立原始版'}</button>
      {publish.isError && <p className="error-strip wide-field">{publish.error.message}</p>}
      {publish.isSuccess && <p role="status" className="form-hint wide-field">修订已保存，现有机台和基线未改变。</p>}
    </form>}
  </section>
}
