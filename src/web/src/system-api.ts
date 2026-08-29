export interface SystemVersion {
  product: string
  version: string
  apiVersion: string
  architecture: string
  serverTime: string
}

export type BackgroundJobStatus = 'Pending' | 'Processing' | 'Completed' | 'Failed'

export interface BackgroundJobSummary {
  id: string
  jobType: string
  status: BackgroundJobStatus
  attempts: number
  createdAt: string
  completedAt: string | null
  lastError: string | null
}

export interface SystemStatus {
  queue: Array<{ status: BackgroundJobStatus; count: number }>
  jobs: BackgroundJobSummary[]
  serverTime: string
}

export async function getSystemVersion(): Promise<SystemVersion> {
  const response = await fetch('/api/v1/system/version', {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`系统信息接口返回 HTTP ${response.status}`)
  }

  return response.json() as Promise<SystemVersion>
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const response = await fetch('/api/v1/system/status', {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`运行状态接口返回 HTTP ${response.status}`)
  }

  return response.json() as Promise<SystemStatus>
}

export async function enqueueNoopJob(note: string): Promise<{ id: string }> {
  const response = await fetch('/api/v1/system/jobs/noop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ note }),
  })

  if (!response.ok) {
    throw new Error(`任务提交失败，HTTP ${response.status}`)
  }

  return response.json() as Promise<{ id: string }>
}
