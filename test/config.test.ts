import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearCredentials,
  credentialsPath,
  readCredentials,
  storeCredentials,
} from '../src/config.js'

describe('credential storage', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'watchletic-cli-'))
  process.env.WATCHLETIC_CONFIG_DIR = directory

  afterEach(() => clearCredentials())

  it('stores credentials with owner-only permissions', () => {
    storeCredentials({
      accessToken: 'wla_test',
      accessTokenExpiresAt: '2030-01-01T00:00:00Z',
      refreshToken: 'wlr_test',
      refreshTokenExpiresAt: '2030-04-01T00:00:00Z',
      accessMode: 'read',
    })
    expect(readCredentials()?.accessMode).toBe('read')
    if (process.platform !== 'win32')
      expect(fs.statSync(credentialsPath()).mode & 0o777).toBe(0o600)
  })
})
