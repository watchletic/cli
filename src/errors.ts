export const ExitCode = {
  validation: 2,
  authentication: 3,
  premium: 4,
  conflict: 5,
  missingData: 6,
  partialExport: 7,
  network: 8,
  cancelled: 130,
} as const

export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly details?: unknown,
  ) {
    super(message)
  }
}

export function exitCodeForApi(code: string, status: number) {
  if (code === 'premium_required') return ExitCode.premium
  if (code === 'raw_data_unavailable' || code === 'export_format_unavailable')
    return ExitCode.missingData
  if (
    code.includes('conflict') ||
    status === 409 ||
    status === 412 ||
    status === 428
  )
    return ExitCode.conflict
  if (
    status === 401 ||
    code === 'invalid_token' ||
    code === 'authentication_required'
  )
    return ExitCode.authentication
  if (status >= 500) return ExitCode.network
  return ExitCode.validation
}
