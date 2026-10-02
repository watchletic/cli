import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as http from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiRequest } from '../src/client.js'
import { logout } from '../src/auth.js'
import {
  credentialsPath,
  readCredentials,
  storeCredentials,
} from '../src/config.js'

const expiredCredentials = {
  accessToken: 'wla_expired',
  accessTokenExpiresAt: '2020-01-01T00:00:00Z',
  refreshToken: 'wlr_original',
  refreshTokenExpiresAt: '2099-01-01T00:00:00Z',
  accessMode: 'read' as const,
}
const freshCredentials = {
  ...expiredCredentials,
  accessToken: 'wla_fresh',
  accessTokenExpiresAt: '2099-01-01T00:00:00Z',
  refreshToken: 'wlr_rotated',
}

let directory: string
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'watchletic-refresh-'))
  vi.stubEnv('WATCHLETIC_CONFIG_DIR', directory)
  vi.stubEnv('WATCHLETIC_ACCESS_TOKEN', '')
  storeCredentials(expiredCredentials)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fs.rmSync(directory, { recursive: true, force: true })
})

describe('session refresh', () => {
  it('refreshes once across concurrent processes and concurrent requests', async () => {
    let refreshes = 0
    const accessTokens: string[] = []
    const server = http.createServer(async (request, response) => {
      if (request.url === '/v1/auth/token') {
        refreshes++
        // Keep the refresh in flight long enough for other processes to contend.
        await new Promise((resolve) => setTimeout(resolve, 300))
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(freshCredentials))
      } else {
        accessTokens.push(request.headers.authorization ?? '')
        response.end('{}')
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    try {
      const results = await Promise.allSettled(
        Array.from(
          { length: 4 },
          () =>
            new Promise<void>((resolve, reject) => {
              const child = spawn(
                process.execPath,
                ['--import', 'tsx', 'test/fixtures/request.ts'],
                {
                  env: {
                    ...process.env,
                    WATCHLETIC_API_URL: `http://127.0.0.1:${address.port}/v1`,
                  },
                  stdio: ['ignore', 'ignore', 'pipe'],
                },
              )
              let stderr = ''
              child.stderr.on('data', (chunk) => {
                stderr += chunk
              })
              child.on('error', reject)
              child.on('exit', (code) =>
                code === 0 ? resolve() : reject(new Error(stderr)),
              )
            }),
        ),
      )
      for (const result of results) expect(result.status).toBe('fulfilled')
      expect(refreshes).toBe(1)
      expect(accessTokens).toEqual(Array(8).fill('Bearer wla_fresh'))
      expect(readCredentials()?.refreshToken).toBe('wlr_rotated')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 15_000)

  it('preserves credentials and releases the lock after a transient failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(freshCredentials)))
      .mockResolvedValueOnce(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiRequest('/me')).rejects.toThrow('HTTP 503')
    expect(readCredentials()).toEqual(expiredCredentials)
    expect(fs.existsSync(path.join(directory, 'credentials.lock'))).toBe(false)
    await apiRequest('/me')
    expect(readCredentials()).toEqual(freshCredentials)
  })

  it('waits for an in-flight refresh before revoking the latest credentials', async () => {
    let markStarted!: () => void
    let finishRefresh!: (response: Response) => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const refreshResponse = new Promise<Response>((resolve) => {
      finishRefresh = resolve
    })
    let revokedToken: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options: RequestInit) => {
        if (url.endsWith('/auth/token')) {
          markStarted()
          return refreshResponse
        }
        if (url.endsWith('/auth/revoke')) {
          revokedToken = JSON.parse(options.body as string).refreshToken
        }
        return new Response('{}')
      }),
    )
    const request = apiRequest('/me')
    await started
    const logoutRequest = logout()
    finishRefresh(new Response(JSON.stringify(freshCredentials)))
    await Promise.all([request, logoutRequest])
    expect(revokedToken).toBe('wlr_rotated')
    expect(readCredentials()).toBeNull()
  })

  it('recovers a stale lock left by a terminated command', async () => {
    const lockPath = path.join(directory, 'credentials.lock')
    fs.mkdirSync(lockPath)
    fs.utimesSync(lockPath, new Date(0), new Date(0))
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(freshCredentials)))
        .mockResolvedValueOnce(new Response('{}')),
    )
    await apiRequest('/me')
    expect(readCredentials()).toEqual(freshCredentials)
  })

  it('does not refresh an expired session', async () => {
    storeCredentials({
      ...expiredCredentials,
      refreshTokenExpiresAt: '2020-01-01T00:00:00Z',
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiRequest('/me')).rejects.toThrow('session has expired')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses an environment token without modifying stored credentials', async () => {
    vi.stubEnv('WATCHLETIC_ACCESS_TOKEN', 'wla_environment')
    const before = fs.readFileSync(credentialsPath(), 'utf8')
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await apiRequest('/me')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[1].headers.Authorization).toBe(
      'Bearer wla_environment',
    )
    expect(fs.readFileSync(credentialsPath(), 'utf8')).toBe(before)
  })
})
