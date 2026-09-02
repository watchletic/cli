import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export type Credentials = {
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
  refreshTokenExpiresAt: string
  accessMode: 'read' | 'full'
}

export function configurationDirectory() {
  if (process.env.WATCHLETIC_CONFIG_DIR)
    return path.resolve(process.env.WATCHLETIC_CONFIG_DIR)
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA ?? os.homedir(), 'Watchletic')
  if (process.platform === 'darwin')
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'watchletic',
    )
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
    'watchletic',
  )
}

export function credentialsPath() {
  return path.join(configurationDirectory(), 'credentials.json')
}

export function readCredentials(): Credentials | null {
  try {
    return JSON.parse(fs.readFileSync(credentialsPath(), 'utf8')) as Credentials
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function storeCredentials(credentials: Credentials) {
  const directory = configurationDirectory()
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
  const temporary = `${credentialsPath()}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  })
  fs.chmodSync(temporary, 0o600)
  fs.renameSync(temporary, credentialsPath())
  fs.chmodSync(credentialsPath(), 0o600)
}

export function clearCredentials() {
  try {
    fs.unlinkSync(credentialsPath())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export function redactedStatus() {
  const environment = process.env.WATCHLETIC_ACCESS_TOKEN
  const stored = readCredentials()
  if (environment)
    return {
      loggedIn: true,
      source: 'environment',
      accessToken: redact(environment),
      refreshAvailable: false,
    }
  if (!stored) return { loggedIn: false }
  return {
    loggedIn: true,
    source: 'configuration',
    accessToken: redact(stored.accessToken),
    accessMode: stored.accessMode,
    accessTokenExpiresAt: stored.accessTokenExpiresAt,
    refreshTokenExpiresAt: stored.refreshTokenExpiresAt,
    refreshAvailable: true,
  }
}

function redact(value: string) {
  return value.length < 12
    ? '[redacted]'
    : `${value.slice(0, 6)}…${value.slice(-4)}`
}
