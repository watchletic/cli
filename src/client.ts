import { randomUUID } from 'node:crypto'
import {
  readCredentials,
  storeCredentials,
  withCredentialLock,
  type Credentials,
} from './config.js'
import { CliError, ExitCode, exitCodeForApi } from './errors.js'

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  revision?: string
  idempotent?: boolean
  binary?: boolean
}

export const baseUrl = (
  process.env.WATCHLETIC_API_URL ?? 'https://api.watchletic.com/v1'
).replace(/\/$/, '')

export async function apiRequest(path: string, options: RequestOptions = {}) {
  const token = await accessToken()
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.revision) headers['If-Match'] = `"${options.revision}"`
  if (options.idempotent) headers['Idempotency-Key'] = randomUUID()
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch (error) {
    throw new CliError(
      `Could not reach Watchletic: ${error instanceof Error ? error.message : String(error)}`,
      ExitCode.network,
    )
  }
  if (!response.ok) await throwApiError(response)
  if (response.status === 204) return null
  return options.binary
    ? Buffer.from(await response.arrayBuffer())
    : response.json()
}

export async function unauthenticatedRequest(path: string, body: unknown) {
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    throw new CliError(
      `Could not reach Watchletic: ${error instanceof Error ? error.message : String(error)}`,
      ExitCode.network,
    )
  }
  if (!response.ok) await throwApiError(response)
  return response.json() as Promise<Credentials & { tokenType: string }>
}

async function accessToken() {
  if (process.env.WATCHLETIC_ACCESS_TOKEN)
    return process.env.WATCHLETIC_ACCESS_TOKEN
  return withCredentialLock(async () => {
    const credentials = readCredentials()
    if (!credentials)
      throw new CliError(
        'Run `watchletic auth login` first.',
        ExitCode.authentication,
      )
    if (
      new Date(credentials.accessTokenExpiresAt).getTime() >
      Date.now() + 60_000
    )
      return credentials.accessToken
    if (new Date(credentials.refreshTokenExpiresAt).getTime() <= Date.now()) {
      throw new CliError(
        'The Watchletic session has expired. Sign in again.',
        ExitCode.authentication,
      )
    }
    const refreshed = await unauthenticatedRequest('/auth/token', {
      grantType: 'refresh_token',
      clientId: 'watchletic-cli',
      refreshToken: credentials.refreshToken,
    })
    storeCredentials(refreshed)
    return refreshed.accessToken
  })
}

async function throwApiError(response: Response): Promise<never> {
  let payload: any
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const code = payload?.error?.code ?? `http_${response.status}`
  const message =
    payload?.error?.message ?? `Watchletic returned HTTP ${response.status}.`
  throw new CliError(
    message,
    exitCodeForApi(code, response.status),
    payload?.error,
  )
}
