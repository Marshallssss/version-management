import { request } from './catalog-api'
import { createIdempotencyKey } from './idempotency-key'
import type { HistoricalPreview } from './matrix-import-api'

export interface ManualHistoricalBaselineInput {
  baselineName: string
  releasedAt: string
  reason: string
  items: Array<{ componentId: string; versionNumber: string | null; notConfigured: boolean }>
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(body) })
export const previewManualHistoricalBaseline = (projectId: string, input: ManualHistoricalBaselineInput) => request<HistoricalPreview>(`/api/v1/projects/${projectId}/historical-baselines/preview`, post(input))
export const commitManualHistoricalBaseline = (projectId: string, batchId: string, reason: string) => request<HistoricalPreview>(`/api/v1/projects/${projectId}/historical-baselines/${batchId}/commit`, post({ reason }))
