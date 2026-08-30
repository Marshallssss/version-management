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

export interface ConfigurationComponent {
  id: string
  parentComponentId: string | null
  code: string
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
  return response.json() as Promise<T>
}

export const getProjects = () => request<ProjectSummary[]>('/api/v1/projects')
export const getProject = (projectId: string) => request<ProjectDetail>(`/api/v1/projects/${projectId}`)
export const getCurrentUser = () => request<{ name: string; roles: string[] }>('/api/v1/auth/me')
export const login = (input: { email: string; password: string }) => request<void>('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
export const logout = () => request<void>('/api/v1/auth/logout', { method: 'POST' })
export const createProject = (input: { code: string; name: string; description: string; reason: string }) =>
  request<{ id: string }>('/api/v1/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(input) })
export const createComponent = (projectId: string, input: { code: string; name: string; parentComponentId: string | null }) =>
  request<{ id: string }>(`/api/v1/projects/${projectId}/components`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
export const createComponentVersion = (componentId: string, input: { versionNumber: string }) =>
  request<{ id: string; sequenceNo: number }>(`/api/v1/components/${componentId}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
export const changeVersionMaturity = (versionId: string, state: string, reason: string) =>
  request<{ maturity: string; safety: string }>(`/api/v1/component-versions/${versionId}/maturity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, reason }) })
export const changeVersionSafety = (versionId: string, state: string, reason: string) =>
  request<{ maturity: string; safety: string }>(`/api/v1/component-versions/${versionId}/safety`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, reason }) })
export const recommendVersion = (versionId: string, reason: string) =>
  request<{ recommended: boolean }>(`/api/v1/component-versions/${versionId}/recommend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: '', reason }) })
export const previewProjectClone = (projectId: string) => request<{ copiedComponents: number; excludedVersions: number }>(`/api/v1/projects/${projectId}/clone-preview`, { method: 'POST' })
export const cloneProject = (projectId: string, input: { code: string; name: string; reason: string }) =>
  request<{ id: string }>(`/api/v1/projects/${projectId}/clone`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
export const moveComponent = (componentId: string, input: { parentComponentId: string | null; reason: string }) =>
  request<{ id: string; lineageKey: string }>(`/api/v1/components/${componentId}/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
export const getBaselines = (projectId: string) => request<BaselineSummary[]>(`/api/v1/projects/${projectId}/baselines`)
export const createBaseline = (projectId: string, input: { seriesCode: string; baselineCode: string; description: string; reason: string }) =>
  request<{ id: string; revisionNo: number; itemCount: number }>(`/api/v1/projects/${projectId}/baselines`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(input) })
export const releaseBaseline = (baselineId: string, reason: string) =>
  request<{ id: string; state: string }>(`/api/v1/baselines/${baselineId}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ reason }) })
export const getProjectStandard = (projectId: string) => request<{ baselineId: string; baselineCode: string; validFrom: string } | null>(`/api/v1/projects/${projectId}/standard`)
export const assignProjectStandard = (projectId: string, baselineId: string, reason: string) =>
  request<{ id: string; baselineId: string }>(`/api/v1/projects/${projectId}/standard`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ configurationBaselineId: baselineId, reason }) })
export interface MachineSummary { id: string; projectId: string; serialNumber: string; name: string; machineType: string | null; status: string; matchStatus: string | null; riskSeverity: string | null }
export const getMachines = () => request<MachineSummary[]>('/api/v1/machines')
export const createMachine = (input: { projectId: string; serialNumber: string; name: string; machineType: string; reason: string }) => request<{ id: string }>('/api/v1/machines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
export const getMachineConfiguration = (machineId: string) => request<Array<{ componentId: string; versionId: string | null; state: string; stateEffectiveAt: string; knownInstalledAt: string | null }>>(`/api/v1/machines/${machineId}/configuration`)
export const getMachineDrift = (machineId: string) => request<{ matchStatus: string; riskSeverity: string; items: Array<{ componentId: string; status: string; expectedVersionId: string | null; actualVersionId: string | null }> }>(`/api/v1/machines/${machineId}/drift`)
export const getVersionImpact = (versionId: string) => request<{ usedBaselineIds: string[]; currentMachineIds: string[]; targetMachineIds: string[]; historicalMachineIds: string[]; recentFacts: Array<{ machineId: string; operationType: string; effectiveAt: string }> }>(`/api/v1/component-versions/${versionId}/impact`)
export const searchCatalog = (query: string) => request<Array<{ type: string; id: string; label: string }>>(`/api/v1/search?query=${encodeURIComponent(query)}`)
export const stageImport = (input: { projectId: string; sourceFileName: string; reason: string; rows: Array<{ componentCode: string; versionNumber: string }> }) => request<{ id: string; status: string; rowCount: number; errorCount: number }>('/api/v1/imports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
export const getImportPreview = (batchId: string) => request<{ status: string; sourceFileName: string; rows: Array<{ rowNumber: number; payload: { componentCode: string; versionNumber: string }; validationError: string | null }> }>(`/api/v1/imports/${batchId}`)
export const commitImport = (batchId: string) => request<{ id: string; committed: number }>(`/api/v1/imports/${batchId}/commit`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() } })
export const recordMachineFacts = (machineId: string, input: { operationType: string; coverage: string; sourceType: string; reason: string; items: Array<{ componentId: string; versionId: string | null; absent: boolean; knownInstalledAt: string | null }> }) => request<{ id: string }>(`/api/v1/machines/${machineId}/facts`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(input) })
