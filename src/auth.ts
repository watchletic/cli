import * as http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { baseUrl, unauthenticatedRequest } from './client.js'
import {
  clearCredentials,
  readCredentials,
  storeCredentials,
} from './config.js'
import { CliError, ExitCode } from './errors.js'

export async function login(accessMode: 'read' | 'full', sessionName: string) {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(24).toString('base64url')
  let settle: ((value: string) => void) | undefined
  let reject: ((error: Error) => void) | undefined
  const callback = new Promise<string>((resolve, rejectPromise) => {
    settle = resolve
    reject = rejectPromise
  })
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (
      url.pathname !== '/callback' ||
      url.searchParams.get('state') !== state
    ) {
      response.writeHead(400).end('Invalid Watchletic callback.')
      return
    }
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    if (!code || error) {
      response
        .writeHead(400)
        .end(
          'Watchletic authorization was not approved. You can close this window.',
        )
      reject?.(
        new CliError(
          error ?? 'Authorization was not approved.',
          ExitCode.authentication,
        ),
      )
      return
    }
    response
      .writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end('Watchletic CLI is authorized. You can close this window.')
    settle?.(code)
  })
  await new Promise<void>((resolve, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new CliError(
      'Could not start the local authorization callback.',
      ExitCode.network,
    )
  const redirectUri = `http://127.0.0.1:${address.port}/callback`
  const authorize = new URL('https://app.watchletic.com/api-access/authorize')
  authorize.searchParams.set('clientId', 'watchletic-cli')
  authorize.searchParams.set('redirectUri', redirectUri)
  authorize.searchParams.set('codeChallenge', challenge)
  authorize.searchParams.set('codeChallengeMethod', 'S256')
  authorize.searchParams.set('state', state)
  authorize.searchParams.set('accessMode', accessMode)
  authorize.searchParams.set('sessionName', sessionName)
  openBrowser(authorize.toString())
  const timeout = setTimeout(
    () =>
      reject?.(
        new CliError('Authorization timed out.', ExitCode.authentication),
      ),
    5 * 60_000,
  )
  try {
    const code = await callback
    const credentials = await unauthenticatedRequest('/auth/token', {
      grantType: 'authorization_code',
      clientId: 'watchletic-cli',
      code,
      redirectUri,
      codeVerifier: verifier,
    })
    storeCredentials(credentials)
    return { authorized: true, accessMode, sessionName }
  } finally {
    clearTimeout(timeout)
    server.close()
  }
}

export async function logout() {
  const environmentToken = process.env.WATCHLETIC_ACCESS_TOKEN
  try {
    const credentials = environmentToken ? null : readCredentials()
    const accessToken = environmentToken ?? credentials?.accessToken
    if (!accessToken && !credentials?.refreshToken) return { revoked: false }
    const response = await fetch(`${baseUrl}/auth/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(
        credentials?.refreshToken
          ? { refreshToken: credentials.refreshToken }
          : {},
      ),
    })
    if (!response.ok) {
      throw new CliError(
        `Watchletic could not revoke the session (HTTP ${response.status}).`,
        ExitCode.network,
      )
    }
  } finally {
    if (!environmentToken) clearCredentials()
  }
  return { revoked: true }
}

function openBrowser(url: string) {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.unref()
}
