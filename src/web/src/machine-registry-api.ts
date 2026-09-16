import { request, type MachineSummary } from './catalog-api'

export type MachineAttention = '' | 'mismatch' | 'critical' | 'unknown' | 'no-target'
export interface RegistryActualVersion { componentId: string; componentName: string; versionId: string; versionNumber: string }
export interface MachineRegistryItem extends MachineSummary {
  targetBaselineId: string | null
  actualVersions: RegistryActualVersion[]
  hasActualConfiguration: boolean
  summaryCalculatedAt: string | null
}
export interface MachineRegistry {
  items: MachineRegistryItem[]
  targetBaselines: Array<{ id: string; code: string }>
  actualVersions: RegistryActualVersion[]
}
export const getMachineRegistry = (projectId: string) => request<MachineRegistry>(`/api/v1/projects/${projectId}/machine-registry`)
