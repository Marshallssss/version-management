import { useQuery } from '@tanstack/react-query'
import { request } from './catalog-api'

export function RevisionPicker({ versionId, value, onChange }: { versionId: string; value: string; onChange: (value: string) => void }) {
  const revisions = useQuery({ queryKey: ['version-revisions', versionId], queryFn: () => request<Array<{ id: string; revisionNo: number }>>(`/api/v1/component-versions/${versionId}/revisions`), enabled: !!versionId })
  return <label>实际补丁修订<select aria-label="实际补丁修订" value={value} onChange={e => onChange(e.target.value)} disabled={!versionId || revisions.isLoading || revisions.isError}>
    <option value="">补丁状态未确认</option>
    {revisions.data?.map(r => <option key={r.id} value={r.id}>{r.revisionNo === 0 ? '原始版（未打补丁）' : `修订 ${r.revisionNo}`}</option>)}
  </select>{revisions.isError && <span role="alert">修订读取失败，请重试。</span>}</label>
}
