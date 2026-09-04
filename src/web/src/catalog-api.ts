import { createIdempotencyKey } from './idempotency-key'

export interface ProjectSummary {
  id: string
  code: string
  name: string
  description: string | null
  status: string
  updatedAt: string
  componentCount: number
}

export interface ComponentVersion {
  id: string
  versionNumber: string
  sequenceNo: number
  maturity: string
  safety: string
  createdAt: string
}

export interface VersionPatch {
  id: string
  patchCode: string
  title: string
  issueDescription: string
  resolutionDescription: string
  status: string
  recordedBy: string
  recordedAt: string
}

export interface ConfigurationComponent {
  id: string
  parentComponentId: string | null
  name: string
  sortOrder: number
  versions: ComponentVersion[]
}

export interface ProjectDetail {
  project: Omit<ProjectSummary, 'componentCount'> & { createdAt: string }
  components: ConfigurationComponent[]
}

export interface BaselineSummary {
  id: string
  code: string
  seriesCode: string
  revisionNo: number
  state: string
  itemCount: number
  createdAt: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; errors?: Record<string, string[]> } | null
    const detail = body?.message ?? Object.values(body?.errors ?? {}).flat().join(' ') ?? `HTTP ${response.status}`
    throw new Error(detail)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return response.json() as Promise<T>
}

export const getProjects = () => request<ProjectSummary[]>('/api/v1/projects')
export const getProject = (projectId: string) => request<ProjectDetail>(`/api/v1/projects/${projectId}`)
export const getProjectMembers = (projectId: string) => request<Array<{ id: string; userId: string; userName?: string | null; email: string | null; displayName: string; role: string; assignedBy: string; assignedAt: string }>>(`/api/v1/projects/${projectId}/members`)
export const getCurrentUser = () => request<{ name: string; roles: string[] }>('/api/v1/auth/me')
export const getUsers = () => request<Array<{ id: string; userName: string | null; email: string | null; displayName: string; roles: string[] }>>('/api/v1/admin/users')
export const createUser = (input: { userName: string; displayName: string; password: string; role: string; reason: string }) => request<{ id: string }>('/api/v1/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const changeUserRole = (userId: string, input: { role: string; reason: string }) => request<{ id: string; role: string }>(`/api/v1/admin/users/${userId}/role`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const login = (input: { userName: string; password: string }) => request<void>('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
export const logout = () => request<void>('/api/v1/auth/logout', { method: 'POST' })
export const createProject = (input: { code: string; name: string; description: string; reason: string }) =>
  request<{ id: string }>('/api/v1/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const createComponent = (projectId: string, input: { name: string; parentComponentId: string | null; reason: string }) =>
  request<{ id: string }>(`/api/v1/projects/${projectId}/components`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const updateComponent = (componentId: string, input: { name: string; reason: string }) =>
  request<{ id: string; lineageKey: string }>(`/api/v1/components/${componentId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const deleteComponent = (componentId: string, reason: string) =>
  request<{ id: string; deleted: boolean }>(`/api/v1/components/${componentId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify({ reason }) })
export const assignProjectMember = (projectId: string, input: { userId: string; role: string; reason: string }) => request<{ id: string }>(`/api/v1/projects/${projectId}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const createComponentVersion = (componentId: string, input: { versionNumber: string; reason: string; maturity?: 'Draft' | 'Testing' | 'Released' | 'Maintenance' | 'Deprecated' }) =>
  request<{ id: string; sequenceNo: number }>(`/api/v1/components/${componentId}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const createVersionPatch = (versionId: string, input: { patchCode: string; title: string; issueDescription: string; resolutionDescription: string; status: string }) =>
  request<{ id: string; status: string; recordedAt: string }>(`/api/v1/component-versions/${versionId}/patches`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const changeVersionMaturity = (versionId: string, state: string, reason: string) =>
  request<{ maturity: string; safety: string }>(`/api/v1/component-versions/${versionId}/maturity`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify({ state, reason }) })
export const changeVersionSafety = (versionId: string, state: string, reason: string) =>
  request<{ maturity: string; safety: string }>(`/api/v1/component-versions/${versionId}/safety`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify({ state, reason }) })
export const recommendVersion = (versionId: string, reason: string) =>
  request<{ recommended: boolean }>(`/api/v1/component-versions/${versionId}/recommend`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify({ state: '', reason }) })
export const cloneProject = (projectId: string, input: { code: string; name: string; reason: string }) =>
  request<{ id: string }>(`/api/v1/projects/${projectId}/clone`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const moveComponent = (componentId: string, input: { parentComponentId: string | null; reason: string }) =>
  request<{ id: string; lineageKey: string }>(`/api/v1/components/${componentId}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const getBaselines = (projectId: string) => request<BaselineSummary[]>(`/api/v1/projects/${projectId}/baselines`)
export const getBaselineDetail = (baselineId: string) => request<{ baseline: { id: string; projectId: string; code: string; seriesCode: string; revisionNo: number; state: string; description: string | null; createdBy: string; createdAt: string; releasedBy: string | null; releasedAt: string | null; approvedBy: string | null }; review: { id: string; status: string; requestedBy: string; requestedAt: string; requestReason: string; decidedBy: string | null; decidedAt: string | null; decisionReason: string | null } | null; items: Array<{ id: string; parentItemId: string | null; componentId: string; versionId: string | null; versionNumber: string | null; componentName: string; lineageKey: string; requirement: string; sortOrder: number }> }>(`/api/v1/baselines/${baselineId}`)
export const setBaselineItemRequirement = (baselineId: string, itemId: string, input: { requirement: string; reason: string }) => request<{ id: string; requirement: string }>(`/api/v1/baselines/${baselineId}/items/${itemId}/requirement`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const compareBaselines = (leftBaselineId: string, rightBaselineId: string) => request<{ items: Array<{ componentId: string; status: string; componentName: string; leftVersionId: string | null; leftVersionNumber: string | null; rightVersionId: string | null; rightVersionNumber: string | null }> }>(`/api/v1/baselines/${leftBaselineId}/compare/${rightBaselineId}`)
export const createBaseline = (projectId: string, input: { seriesCode: string; baselineCode: string; description: string; reason: string; versionSelections?: Array<{ componentId: string; versionId: string }> }) =>
  request<{ id: string; revisionNo: number; itemCount: number }>(`/api/v1/projects/${projectId}/baselines`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const releaseBaseline = (baselineId: string, reason: string) =>
  request<{ id: string; state: string }>(`/api/v1/baselines/${baselineId}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify({ reason }) })
export const requestBaselineReview = (baselineId: string, reason: string) =>
  request<{ id: string; status: string }>(`/api/v1/baselines/${baselineId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify({ reason }) })
export const decideBaselineReview = (baselineId: string, decision: 'approve' | 'reject', reason: string) =>
  request<{ id: string; status: string }>(`/api/v1/baselines/${baselineId}/review/${decision}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify({ reason }) })
export const getProjectStandard = (projectId: string) => request<{ baselineId: string; baselineCode: string; validFrom: string } | null>(`/api/v1/projects/${projectId}/standard`)
export const assignProjectStandard = (projectId: string, baselineId: string, reason: string) =>
  request<{ id: string; baselineId: string }>(`/api/v1/projects/${projectId}/standard`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify({ configurationBaselineId: baselineId, reason }) })
export interface MachineSummary { id: string; projectId: string; serialNumber: string; name: string; machineType: string | null; status: string; matchStatus: string | null; riskSeverity: string | null }
export const getMachines = () => request<MachineSummary[]>('/api/v1/machines')
export const createMachine = (input: { projectId: string; serialNumber: string; name: string; machineType: string; reason: string }) => request<{ id: string }>('/api/v1/machines', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const getMachineConfiguration = (machineId: string) => request<Array<{ componentId: string; componentName: string; versionId: string | null; versionNumber: string | null; state: string; stateEffectiveAt: string; knownInstalledAt: string | null }>>(`/api/v1/machines/${machineId}/configuration`)
export const getMachineConfigurationAt = (machineId: string, at: string) => request<{ asOf: string; items: Array<{ componentId: string; componentName: string; versionId: string | null; versionNumber: string | null; state: string; stateEffectiveAt: string; recordedAt: string; knownInstalledAt: string | null }> }>(`/api/v1/machines/${machineId}/configuration-at?at=${encodeURIComponent(at)}`)
export const getMachineFacts = (machineId: string) => request<Array<{ id: string; operationType: string; coverage: string; sourceType: string; correctsDeploymentBatchId: string | null; recordedAt: string; effectiveAt: string; itemCount: number }>>(`/api/v1/machines/${machineId}/facts`)
export const getMachineDrift = (machineId: string) => request<{ matchStatus: string; riskSeverity: string; items: Array<{ componentId: string; componentName: string; status: string; expectedVersionId: string | null; expectedVersionNumber: string | null; actualVersionId: string | null; actualVersionNumber: string | null }> }>(`/api/v1/machines/${machineId}/drift`)
export const compareMachines = (leftMachineId: string, rightMachineId: string) => request<{ matchStatus: string; riskSeverity: string; items: Array<{ componentId: string; componentName: string; status: string; leftVersionId: string | null; leftVersionNumber: string | null; rightVersionId: string | null; rightVersionNumber: string | null }> }>(`/api/v1/machines/${leftMachineId}/compare/${rightMachineId}`)
export const compareMachineCurrentToHistory = (machineId: string, at: string) => request<{ matchStatus: string; riskSeverity: string; items: Array<{ componentId: string; componentName: string; status: string; currentVersionId: string | null; currentVersionNumber: string | null; historicalVersionId: string | null; historicalVersionNumber: string | null }> }>(`/api/v1/machines/${machineId}/compare-history?at=${encodeURIComponent(at)}`)
export const getVersionImpact = (versionId: string) => request<{ usedBaselineIds: string[]; currentMachineIds: string[]; targetMachineIds: string[]; historicalMachineIds: string[]; recentFacts: Array<{ machineId: string; operationType: string; effectiveAt: string }> }>(`/api/v1/component-versions/${versionId}/impact`)
export const getVersionExposureSnapshots = (versionId: string) => request<Array<{ id: string; blockedAt: string; blockedBy: string; reason: string; currentMachineCount: number; targetMachineCount: number; historicalMachineCount: number; baselineCount: number }>>(`/api/v1/component-versions/${versionId}/exposures`)
export const getVersionDetail = (versionId: string) => request<{ version: { componentName: string; versionNumber: string; sequenceNo: number; maturity: string; safety: string; createdAt: string }; recommended: boolean; transitions: Array<{ axis: string; fromState: string; toState: string; reason: string; actor: string; occurredAt: string }>; patches: VersionPatch[] }>(`/api/v1/component-versions/${versionId}`)
export const searchCatalog = (query: string) => request<Array<{ type: string; id: string; projectId: string; versionId?: string; label: string }>>(`/api/v1/search?query=${encodeURIComponent(query)}`)
export const getDashboard = () => request<{ machineCount: number; matchedCount: number; mismatchCount: number; unknownCount: number; criticalRiskCount: number }>('/api/v1/dashboard')
export const stageImport = (input: { projectId: string; sourceFileName: string; reason: string; rows: Array<{ componentName: string; versionNumber: string }> }) => request<{ id: string; status: string; rowCount: number; errorCount: number }>('/api/v1/imports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const getImportPreview = (batchId: string) => request<{ status: string; sourceFileName: string; rows: Array<{ rowNumber: number; payload: { componentName: string; versionNumber: string }; validationError: string | null }> }>(`/api/v1/imports/${batchId}`)
export const commitImport = (batchId: string) => request<{ id: string; committed: number }>(`/api/v1/imports/${batchId}/commit`, { method: 'POST', headers: { 'Idempotency-Key': createIdempotencyKey() } })
export const recordMachineFacts = (machineId: string, input: { operationType: string; coverage: string; sourceType: string; reason: string; correctsDeploymentBatchId?: string; items: Array<{ componentId: string; versionId: string | null; absent: boolean; knownInstalledAt: string | null }> }) => request<{ id: string }>(`/api/v1/machines/${machineId}/facts`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const assignMachineTarget = (machineId: string, baselineId: string, reason: string) => request<{ id: string; baselineId: string }>(`/api/v1/machines/${machineId}/target`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify({ configurationBaselineId: baselineId, reason }) })
export const assignBulkMachineTargets = (projectId: string, baselineId: string, machineIds: string[], reason: string) => request<{ id: string; succeeded: number; skipped: number }>(`/api/v1/projects/${projectId}/bulk-machine-targets`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify({ configurationBaselineId: baselineId, machineIds, reason }) })
export const recordBulkMachineFacts = (projectId: string, input: { machineIds: string[]; operationType: string; coverage: 'Partial'; reason: string; items: Array<{ componentId: string; versionId: string; absent: false; knownInstalledAt: null }> }) => request<{ id: string; succeeded: number; failed: number }>(`/api/v1/projects/${projectId}/bulk-facts`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey() }, body: JSON.stringify(input) })
export const getMachineTarget = (machineId: string) => request<{ baselineId: string; baselineCode: string; validFrom: string } | null>(`/api/v1/machines/${machineId}/target`)
export const getMachineTargetHistory = (machineId: string) => request<Array<{ id: string; baselineId: string; baselineCode: string; validFrom: string; validTo: string | null; assignedBy: string; reason: string }>>(`/api/v1/machines/${machineId}/target-history`)
