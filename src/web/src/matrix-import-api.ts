import { request } from './catalog-api'
import { createIdempotencyKey } from './idempotency-key'

export interface MatrixComponent {
  componentId: string
  parentComponentId: string | null
  componentName: string
  sortOrder: number
  isCategory: boolean
  versionId: string | null
  versionNumber: string | null
  changed: boolean
  previousVersionId?: string | null
  previousVersionNumber?: string | null
  versionAvailable?: boolean
}

export interface MatrixTemplate {
  id: string
  createdAt: string
  referenceBaselineCode: string | null
  componentCount: number
  components: MatrixComponent[]
}

export interface MatrixSource {
  id: string
  templateId: string
  path: string
  localTime: string
  timeZoneId: string
  enabled: boolean
  nextScanAt: string | null
  lastScanAt: string | null
  lastStatus: string | null
}

export interface MatrixMessage {
  rowNumber: number | null
  level: 'error' | 'info'
  message: string
  combinationId?: string | null
  componentId?: string | null
  componentName?: string | null
  previousVersionNumber?: string | null
  versionNumber?: string | null
  sourceLabel?: string | null
}

export interface MatrixRun {
  id: string
  fileName: string
  templateId: string
  sourceId: string | null
  createdAt: string
  actor: string
  status: string
  importedCount: number
  skippedCount: number
  messages: MatrixMessage[]
}

export interface MatrixCombination {
  id: string
  templateId: string
  runId: string
  sequenceNo: number
  sourceRow: number
  sourceLabel?: string | null
  recordDate: string
  createdAt: string
  reason: string
  items: MatrixComponent[]
}

export interface MatrixWorkspace {
  templates: MatrixTemplate[]
  sources: MatrixSource[]
  runs: MatrixRun[]
  combinations: MatrixCombination[]
}

const endpoint = (projectId: string) => `/api/v1/projects/${projectId}/matrix-import`
const json = (method: string, input: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() },
  body: JSON.stringify(input),
})

export const getMatrixWorkspace = (projectId: string) => request<MatrixWorkspace>(endpoint(projectId))
export const getMatrixCombination = (projectId: string, combinationId: string) => request<MatrixCombination>(`${endpoint(projectId)}/combinations/${combinationId}`)
export const createMatrixTemplate = (projectId: string, reason: string) => request<{ id: string; downloadUrl: string }>(`${endpoint(projectId)}/templates`, json('POST', { reason }))
export const scanMatrixWorkbook = (projectId: string, input: { templateId: string; contentBase64: string; fileName: string; reason: string }) => request<MatrixRun>(`${endpoint(projectId)}/scan`, json('POST', input))
export const saveMatrixSource = (projectId: string, input: { templateId: string; path: string; localTime: string; timeZoneId: string; enabled: boolean; reason: string }) => request<MatrixSource>(`${endpoint(projectId)}/source`, json('PUT', input))
export const scanMatrixSource = (projectId: string, reason: string) => request<MatrixRun>(`${endpoint(projectId)}/source/scan`, json('POST', { reason }))

export async function downloadMatrixTemplate(projectId: string, templateId: string, projectName: string) {
  const response = await fetch(`${endpoint(projectId)}/templates/${templateId}/download`, { credentials: 'same-origin' })
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(error?.message || '模板下载失败，请重试。')
  }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = `${projectName.replace(/[<>:"/\\|?*]/g, '_')}-版本登记模板.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function workbookBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('无法读取文件，请确认文件没有被移动或删除。'))
    reader.onload = () => {
      const value = String(reader.result ?? '')
      const separator = value.indexOf(',')
      if (separator < 0) reject(new Error('无法读取 Excel 文件。'))
      else resolve(value.slice(separator + 1))
    }
    reader.readAsDataURL(file)
  })
}
