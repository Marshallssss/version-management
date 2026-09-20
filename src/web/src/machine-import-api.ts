import { request } from './catalog-api'
import { createIdempotencyKey } from './idempotency-key'

export interface MachineImportBatch {
  id: string; sourceFileName: string; status: string
  rows: Array<{ rowNumber: number; validationError: string | null; data: { values: string[]; machineId: string | null; completed: boolean; warning: string | null; error: string | null; baselineId: string | null } }>
}
export interface MachineImportHistory { id: string; sourceFileName: string; createdAt: string; status: string }
const endpoint = (projectId: string) => `/api/v1/projects/${projectId}/machine-import`
const post = (data: unknown, key: string): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(data) })
export const previewMachineImport = (projectId: string, data: { fileName: string; contentBase64: string; reason: string }, key: string) => request<{ id: string }>(`${endpoint(projectId)}/preview`, post(data, key))
export const getMachineImport = (projectId: string, batchId: string) => request<MachineImportBatch>(`${endpoint(projectId)}/batches/${batchId}`)
export const getMachineImports = (projectId: string) => request<MachineImportHistory[]>(`${endpoint(projectId)}/batches`)
export const commitMachineImport = (projectId: string, batchId: string) => request<{ id: string }>(`${endpoint(projectId)}/batches/${batchId}/commit`, post({}, createIdempotencyKey()))
export async function downloadMachineTemplate(projectId: string) {
  const response = await fetch(`${endpoint(projectId)}/template`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('模板下载失败，请检查当前项目和导入权限。')
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url; link.download = '机台登记模板.xlsx'; document.body.appendChild(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
