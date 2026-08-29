export interface SystemVersion {
  product: string
  version: string
  apiVersion: string
  architecture: string
  serverTime: string
}

export async function getSystemVersion(): Promise<SystemVersion> {
  const response = await fetch('/api/v1/system/version', {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`System endpoint returned HTTP ${response.status}`)
  }

  return response.json() as Promise<SystemVersion>
}
