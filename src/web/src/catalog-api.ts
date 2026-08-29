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
