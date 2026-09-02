import { describe, expect, it, vi } from 'vitest'
import { confirmMutation } from '../src/io.js'
import { CliError, ExitCode } from '../src/errors.js'

describe('mutation confirmation', () => {
  it('rejects non-interactive mutations without --yes', async () => {
    await expect(
      confirmMutation(
        'Delete activity',
        { id: 'activity-1' },
        null,
        false,
        true,
      ),
    ).rejects.toMatchObject({
      exitCode: ExitCode.validation,
    } satisfies Partial<CliError>)
  })

  it('prints the exact mutation diff when --yes is supplied', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await confirmMutation(
      'Update settings',
      { isMetric: true },
      { isMetric: false },
      true,
      true,
    )
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({
        mutation: 'Update settings',
        before: { isMetric: true },
        after: { isMetric: false },
      }),
    )
    error.mockRestore()
  })
})
