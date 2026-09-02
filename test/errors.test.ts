import { describe, expect, it } from 'vitest'
import { ExitCode, exitCodeForApi } from '../src/errors.js'

describe('API exit codes', () => {
  it('keeps stable codes for automation', () => {
    expect(exitCodeForApi('validation_failed', 400)).toBe(ExitCode.validation)
    expect(exitCodeForApi('invalid_token', 401)).toBe(ExitCode.authentication)
    expect(exitCodeForApi('premium_required', 403)).toBe(ExitCode.premium)
    expect(exitCodeForApi('revision_conflict', 412)).toBe(ExitCode.conflict)
    expect(exitCodeForApi('raw_data_unavailable', 404)).toBe(
      ExitCode.missingData,
    )
  })
})
