import { request, type BaselineSummary } from './catalog-api'

export type BaselineHistoryItem = {
  componentId: string
  componentName: string
  versionId: string | null
  versionNumber: string | null
}

export type BaselineHistoryEntry = BaselineSummary & { items: BaselineHistoryItem[] }

export const getBaselineHistoryIndex = (projectId: string) =>
  request<BaselineHistoryEntry[]>(`/api/v1/projects/${projectId}/baseline-history-index`)

export const snapshotVersionKey = (item: BaselineHistoryItem) => JSON.stringify([item.versionId, item.versionNumber])
