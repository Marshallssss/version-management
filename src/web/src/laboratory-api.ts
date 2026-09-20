import { request } from './catalog-api'
import { createIdempotencyKey } from './idempotency-key'

export const recordLaboratorySelection = (projectId: string, data: unknown, key: string) => request<{ id: string }>(`/api/v1/projects/${projectId}/laboratory-deployments`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(data),
})

export type LaboratoryTarget = { machineId: string; machineName: string; serialNumber: string; location: string | null; machineStage: string | null; chamberNumber: number | null }
export type LaboratoryUse = LaboratoryTarget & { kind: string; installedAt: string | null }
export type LaboratoryValidation = { id: string; machineId: string; machineName: string; machineDeleted: boolean; chamberNumber: number | null; result: 'InProgress' | 'Passed' | 'Failed'; occurredAt: string; recordedAt: string; reason: string; actor: string }
export type LaboratoryVersion = { versionId: string; componentId: string; componentName: string; versionNumber: string; maturity: string; validationStatus: 'InProgress' | 'Passed' | 'Failed'; currentUses: LaboratoryUse[]; validations: LaboratoryValidation[] }
export type LaboratoryWorkspace = { releaseValidationRequired: boolean; targets: LaboratoryTarget[]; versions: LaboratoryVersion[] }
export const getLaboratoryVersions = (projectId: string) => request<LaboratoryWorkspace>(`/api/v1/projects/${projectId}/laboratory-versions`)
export const recordLaboratory = (versionId: string, action: 'deployments' | 'validations', data: unknown, key = createIdempotencyKey()) => request<{ id: string }>(`/api/v1/component-versions/${versionId}/laboratory-${action}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(data),
})
