import * as os from 'node:os'
import * as fs from 'node:fs'
import { Command, CommanderError } from 'commander'
import { apiRequest } from './client.js'
import { login, logout } from './auth.js'
import { redactedStatus } from './config.js'
import { CliError, ExitCode } from './errors.js'
import { confirmMutation, output, readJson, writeDownload } from './io.js'
import { buildAgentContext } from './context.js'

const program = new Command()
program.exitOverride()
program
  .name('watchletic')
  .description('Work with your Watchletic data')
  .version('0.1.0')
  .option('--json', 'emit stable JSON output')
  .option('--yes', 'confirm a mutation non-interactively')
  .option(
    '--timezone <iana>',
    'IANA timezone',
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  )

const auth = program
  .command('auth')
  .description('Authorize and manage this CLI session')
auth
  .command('login')
  .option('--full', 'request Full access instead of Read-only')
  .option('--name <name>', 'session name', `${os.hostname()} CLI`)
  .action(async (options) =>
    show(await login(options.full ? 'full' : 'read', options.name)),
  )
auth.command('status').action(() => show(redactedStatus()))
auth.command('logout').action(async () => {
  const current = redactedStatus()
  await approve('Revoke CLI session', current, { loggedIn: false })
  show(await logout())
})

program.command('me').action(async () => show(await apiRequest('/me')))
program
  .command('catalog')
  .action(async () => show(await apiRequest('/catalog')))

const settings = program.command('settings')
settings.command('get').action(async () => show(await apiRequest('/settings')))
settings
  .command('set')
  .requiredOption('--file <json>', 'JSON patch file, or - for stdin')
  .action(async ({ file }) => {
    const current = data(await apiRequest('/settings'))
    const patch = readJson(file)
    await approve('Update settings', current, {
      ...current,
      ...(patch as object),
    })
    show(
      await apiRequest('/settings', {
        method: 'PATCH',
        body: patch,
        revision: revision(current),
        idempotent: true,
      }),
    )
  })

const workouts = program.command('structured-workouts')
workouts
  .command('list')
  .option('--from <date>')
  .option('--to <date>')
  .option('--scheduled <value>', 'true or false')
  .option('--limit <n>', 'page size', '50')
  .option('--cursor <cursor>')
  .action(async (options) =>
    show(await apiRequest(`/structured-workouts${query(options)}`)),
  )
workouts
  .command('get <id>')
  .action(async (id) =>
    show(await apiRequest(`/structured-workouts/${encodeURIComponent(id)}`)),
  )
workouts
  .command('create')
  .requiredOption('--file <json>')
  .action(async ({ file }) => {
    const body = readJson(file)
    await approve('Create structured workout', null, body)
    show(
      await apiRequest('/structured-workouts', {
        method: 'POST',
        body,
        idempotent: true,
      }),
    )
  })
workouts
  .command('update <id>')
  .requiredOption('--file <json>')
  .action(async (id, { file }) => {
    const current = data(
      await apiRequest(`/structured-workouts/${encodeURIComponent(id)}`),
    )
    const patch = readJson(file)
    await approve('Update structured workout', current, {
      ...current,
      ...(patch as object),
    })
    show(
      await apiRequest(`/structured-workouts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: patch,
        revision: revision(current),
        idempotent: true,
      }),
    )
  })
workouts.command('delete <id>').action(async (id) => {
  const current = data(
    await apiRequest(`/structured-workouts/${encodeURIComponent(id)}`),
  )
  await approve('Delete structured workout', current, null)
  show(
    await apiRequest(`/structured-workouts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      revision: revision(current),
      idempotent: true,
    }),
  )
})
workouts
  .command('clone <id>')
  .option('--title <title>')
  .option('--date <date>')
  .action(async (id, options) => {
    const source = data(
      await apiRequest(`/structured-workouts/${encodeURIComponent(id)}`),
    )
    const body = compact({ title: options.title, date: options.date })
    await approve('Clone structured workout', null, {
      ...source,
      ...body,
      id: '(server-generated)',
    })
    show(
      await apiRequest(`/structured-workouts/${encodeURIComponent(id)}/clone`, {
        method: 'POST',
        body,
        idempotent: true,
      }),
    )
  })
workouts
  .command('share-code <id>')
  .action(async (id) =>
    show(
      await apiRequest(
        `/structured-workouts/${encodeURIComponent(id)}/share-code`,
      ),
    ),
  )
workouts.command('import-share-code <code>').action(async (code) => {
  await approve('Import structured workout share code', null, { code })
  show(
    await apiRequest('/structured-workouts/share-code/import', {
      method: 'POST',
      body: { code },
      idempotent: true,
    }),
  )
})
workouts
  .command('validate')
  .requiredOption('--file <json>')
  .action(async ({ file }) => show(await validateBatch(readJson(file))))
workouts
  .command('apply')
  .requiredOption('--file <json>')
  .action(async ({ file }) => {
    const preview = (await validateBatch(readJson(file))) as any
    await approve(
      'Apply structured workout batch',
      preview.diff.map((item: any) => item.before),
      preview.diff.map((item: any) => item.after),
    )
    show(
      await apiRequest('/structured-workouts/batch', {
        method: 'POST',
        body: {
          validationId: preview.validationId,
          operations: preview.operations,
        },
        idempotent: true,
      }),
    )
  })

const activities = program.command('activities')
activities
  .command('list')
  .option('--from <timestamp>')
  .option('--to <timestamp>')
  .option('--activity-type <type>')
  .option('--limit <n>', 'page size', '50')
  .option('--cursor <cursor>')
  .action(async (options) =>
    show(await apiRequest(`/activities${query(options)}`)),
  )
activities
  .command('get <id>')
  .action(async (id) =>
    show(await apiRequest(`/activities/${encodeURIComponent(id)}`)),
  )
activities
  .command('update <id>')
  .requiredOption('--file <json>')
  .action(async (id, { file }) => {
    const current = data(
      await apiRequest(`/activities/${encodeURIComponent(id)}`),
    )
    const patch = readJson(file)
    await approve('Update activity', current, {
      ...current,
      ...(patch as object),
    })
    show(
      await apiRequest(`/activities/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: patch,
        revision: revision(current),
        idempotent: true,
      }),
    )
  })
activities.command('delete <id>').action(async (id) => {
  const current = data(
    await apiRequest(`/activities/${encodeURIComponent(id)}`),
  )
  await approve('Delete activity', current, null)
  show(
    await apiRequest(`/activities/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      revision: revision(current),
      idempotent: true,
    }),
  )
})
activities
  .command('raw <id>')
  .option('--format <format>', 'watchletic, json, ndjson, or csv', 'json')
  .option('--output <path>')
  .action(async (id, options) =>
    downloadOrShow(
      `/activities/${encodeURIComponent(id)}/raw?format=${encodeURIComponent(options.format)}`,
      options.output,
      options.format === 'json',
    ),
  )
activities
  .command('export <id>')
  .requiredOption(
    '--format <format>',
    'fit, gpx, tcx, alpha1Csv, or watchletic',
  )
  .requiredOption('--output <path>')
  .action(async (id, options) =>
    downloadOrShow(
      `/activities/${encodeURIComponent(id)}/export?format=${encodeURIComponent(options.format)}`,
      options.output,
      false,
    ),
  )

for (const resource of ['routes', 'layouts', 'devices'] as const)
  addCrudCommands(resource)
const routes = program.commands.find((command) => command.name() === 'routes')!
routes
  .command('import')
  .requiredOption('--file <gpx>')
  .option('--name <name>')
  .action(async (options) => {
    const body = compact({
      gpx: fs.readFileSync(options.file, 'utf8'),
      name: options.name,
    })
    await createMutation('/routes/import', 'Import GPX route', body)
  })
routes
  .command('export <id>')
  .requiredOption('--output <path>')
  .action(async (id, options) =>
    downloadOrShow(
      `/routes/${encodeURIComponent(id)}/export`,
      options.output,
      false,
    ),
  )

const readiness = program.command('readiness')
readiness
  .command('list')
  .action(async () => show(await apiRequest('/readiness')))
readiness
  .command('create')
  .requiredOption('--file <json>')
  .action(async ({ file }) =>
    createMutation('/readiness', `Create readiness entry`, readJson(file)),
  )
readiness
  .command('update <id>')
  .requiredOption('--file <json>')
  .action(async (id, options) => {
    const current = await readinessEntry(id)
    const patch = readJson(options.file)
    await approve('Update readiness entry', current, {
      ...current,
      ...(patch as object),
    })
    show(
      await apiRequest(`/readiness/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: patch,
        revision: revision(current),
        idempotent: true,
      }),
    )
  })
readiness.command('delete <id>').action(async (id) => {
  const current = await readinessEntry(id)
  await approve('Delete readiness entry', current, null)
  show(
    await apiRequest(`/readiness/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      revision: revision(current),
      idempotent: true,
    }),
  )
})

const analytics = program.command('analytics')
analytics
  .command('get')
  .action(async () => show(await apiRequest('/analytics')))
analytics
  .command('fitness')
  .option('--scope <scope>')
  .option('--range <range>')
  .option('--anchor-date <date>')
  .action(async (options) =>
    show(
      await apiRequest(
        `/analytics/fitness${query({ ...options, timeZone: globalOptions().timezone })}`,
      ),
    ),
  )
analytics
  .command('rebuild')
  .option('--activity-type <type>')
  .action(async (options) =>
    actionMutation(
      '/analytics/rebuild',
      'Rebuild analytics',
      compact({ activityType: options.activityType }),
    ),
  )

const trainingLoad = program.command('training-load')
trainingLoad
  .command('get')
  .action(async () => show(await apiRequest('/training-load')))
trainingLoad.command('initialize <kind>').action(async (kind) => {
  const current = data(await apiRequest('/training-load'))
  const body = { initializationKind: kind }
  await approve('Initialize training load', current, body)
  show(
    await apiRequest('/training-load/initialize', {
      method: 'POST',
      body,
      revision: revision(current),
      idempotent: true,
    }),
  )
})
trainingLoad
  .command('reference')
  .requiredOption('--file <json>')
  .action(async ({ file }) => {
    const current = data(await apiRequest('/training-load'))
    const patch = readJson(file)
    await approve('Update training-load reference', current, patch)
    show(
      await apiRequest('/training-load/references', {
        method: 'PATCH',
        body: patch,
        revision: revision(current),
        idempotent: true,
      }),
    )
  })
trainingLoad
  .command('sport <activityType>')
  .requiredOption('--file <json>')
  .action(async (activityType, { file }) => {
    const current = data(await apiRequest('/training-load'))
    const patch = readJson(file)
    await approve('Update training-load sport', current, patch)
    show(
      await apiRequest(
        `/training-load/sports/${encodeURIComponent(activityType)}`,
        {
          method: 'PATCH',
          body: patch,
          revision: revision(current),
          idempotent: true,
        },
      ),
    )
  })
trainingLoad
  .command('activity <id>')
  .action(async (id) =>
    show(
      await apiRequest(`/training-load/activities/${encodeURIComponent(id)}`),
    ),
  )
trainingLoad
  .command('recalculate <id>')
  .action(async (id) =>
    actionMutation(
      `/training-load/activities/${encodeURIComponent(id)}/recalculate`,
      'Recalculate training load',
      {},
    ),
  )
trainingLoad.command('source <id> <source>').action(async (id, source) => {
  const current = data(
    await apiRequest(`/training-load/activities/${encodeURIComponent(id)}`),
  )
  const body = { source: source === 'auto' ? null : source }
  await approve('Select training-load source', current, {
    ...current,
    sourceOverride: body.source,
  })
  show(
    await apiRequest(
      `/training-load/activities/${encodeURIComponent(id)}/source`,
      {
        method: 'PATCH',
        body,
        revision: revision(current),
        idempotent: true,
      },
    ),
  )
})

const integrations = program.command('integrations')
integrations
  .command('list')
  .action(async () => show(await apiRequest('/integrations')))
integrations
  .command('connect <id>')
  .action(async (id) =>
    actionMutation(
      `/integrations/${encodeURIComponent(id)}/connect`,
      'Connect integration',
      {},
    ),
  )
integrations
  .command('options <id>')
  .requiredOption('--file <json>')
  .action(async (id, { file }) => {
    const current = await integrationStatus(id)
    const patch = readJson(file)
    await approve('Update integration options', current.options, patch)
    show(
      await apiRequest(`/integrations/${encodeURIComponent(id)}/options`, {
        method: 'PATCH',
        body: patch,
        revision: revision(current),
        idempotent: true,
      }),
    )
  })
integrations
  .command('import <id>')
  .action(async (id) =>
    actionMutation(
      `/integrations/${encodeURIComponent(id)}/import`,
      'Import structured workouts',
      {},
    ),
  )
integrations
  .command('export <id> <activityId>')
  .action(async (id, activityId) =>
    actionMutation(
      `/integrations/${encodeURIComponent(id)}/activities/${encodeURIComponent(activityId)}/export`,
      'Export activity to integration',
      {},
    ),
  )
integrations.command('disconnect <id>').action(async (id) => {
  const current = await integrationStatus(id)
  await approve('Disconnect integration', current, {
    ...current,
    connected: false,
  })
  show(
    await apiRequest(`/integrations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      revision: revision(current),
      idempotent: true,
    }),
  )
})

const live = program.command('live')
live
  .command('settings')
  .action(async () => show(await apiRequest('/live/settings')))
live
  .command('sessions')
  .action(async () => show(await apiRequest('/live/sessions')))

const dataCommand = program.command('data')
const dataExport = dataCommand.command('export')
dataExport
  .command('list')
  .action(async () => show(await apiRequest('/data-exports')))
dataExport
  .command('create')
  .requiredOption('--file <json>')
  .action(async ({ file }) =>
    createMutation('/data-exports', 'Create bulk data export', readJson(file)),
  )
dataExport.command('status <id>').action(async (id) => {
  const response = await apiRequest(`/data-exports/${encodeURIComponent(id)}`)
  show(response)
  markPartialExport(response)
})
dataExport
  .command('download <id>')
  .requiredOption('--output <path>')
  .action(async (id, options) => {
    const status = await apiRequest(`/data-exports/${encodeURIComponent(id)}`)
    await downloadOrShow(
      `/data-exports/${encodeURIComponent(id)}/download`,
      options.output,
      false,
    )
    markPartialExport(status)
  })

program
  .command('context')
  .option('--from <date>')
  .option('--to <date>')
  .option('--recent <n>', 'maximum recent activities', '25')
  .action(async (options) => {
    const timeZone = globalOptions().timezone
    const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(
      new Date(),
    )
    const from = options.from ?? addDays(today, -42)
    const to = options.to ?? addDays(today, 14)
    const recentLimit = Math.min(
      Math.max(Math.trunc(Number(options.recent)) || 25, 1),
      100,
    )
    const [
      settingsValue,
      activitiesValue,
      readinessValue,
      analyticsValue,
      trainingValue,
      fitnessValue,
      workoutsValue,
    ] = await Promise.all([
      apiRequest('/settings'),
      apiRequest(
        `/activities${query({ from: `${from}T00:00:00Z`, to: `${today}T23:59:59Z`, limit: recentLimit })}`,
      ),
      apiRequest('/readiness'),
      apiRequest('/analytics'),
      apiRequest('/training-load'),
      apiRequest(
        `/analytics/fitness${query({ scope: 'all', range: '90d', anchorDate: today, timeZone })}`,
      ),
      apiRequest(
        `/structured-workouts${query({ from: today, to, scheduled: true, limit: 21 })}`,
      ),
    ])
    const analyticsResponse = analyticsValue as {
      data?: unknown
      processing?: boolean
      processingStatus?: 'waiting' | 'processing' | 'ready'
    }
    show(
      buildAgentContext({
        generatedAt: new Date().toISOString(),
        from,
        to,
        timeZone,
        requestedRecentActivities: recentLimit,
        settings: data(settingsValue),
        activities: (activitiesValue as any).data ?? [],
        readiness: ((readinessValue as any).data ?? []).filter(
          (entry: any) => entry.date >= from,
        ),
        analytics: {
          data: data(analyticsValue),
          processing: analyticsResponse.processing ?? false,
          processingStatus: analyticsResponse.processingStatus,
        },
        trainingLoad: data(trainingValue),
        fitness: data(fitnessValue),
        structuredWorkouts: (workoutsValue as any).data ?? [],
      }),
      true,
    )
  })

function addCrudCommands(resource: 'routes' | 'layouts' | 'devices') {
  const command = program.command(resource)
  command
    .command('list')
    .action(async () => show(await apiRequest(`/${resource}`)))
  command
    .command('get <id>')
    .action(async (id) =>
      show(await apiRequest(`/${resource}/${encodeURIComponent(id)}`)),
    )
  command
    .command('create')
    .requiredOption('--file <json>')
    .action(async ({ file }) =>
      createMutation(
        `/${resource}`,
        `Create ${resource.slice(0, -1)}`,
        readJson(file),
      ),
    )
  command
    .command('update <id>')
    .requiredOption('--file <json>')
    .action(async (id, { file }) => {
      const current = data(
        await apiRequest(`/${resource}/${encodeURIComponent(id)}`),
      )
      const patch = readJson(file)
      await approve(`Update ${resource.slice(0, -1)}`, current, {
        ...current,
        ...(patch as object),
      })
      show(
        await apiRequest(`/${resource}/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: patch,
          revision: revision(current),
          idempotent: true,
        }),
      )
    })
  command.command('delete <id>').action(async (id) => {
    const current = data(
      await apiRequest(`/${resource}/${encodeURIComponent(id)}`),
    )
    await approve(`Delete ${resource.slice(0, -1)}`, current, null)
    show(
      await apiRequest(`/${resource}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        revision: revision(current),
        idempotent: true,
      }),
    )
  })
}

async function validateBatch(body: unknown) {
  const value = body as any
  return apiRequest('/structured-workouts/validate', {
    method: 'POST',
    body: value.operations ? value : { operations: value },
  })
}

async function createMutation(path: string, label: string, body: unknown) {
  await approve(label, null, body)
  show(await apiRequest(path, { method: 'POST', body, idempotent: true }))
}

async function actionMutation(
  path: string,
  label: string,
  body: unknown,
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST',
) {
  await approve(label, null, body ?? null)
  show(await apiRequest(path, { method, body, idempotent: true }))
}

async function downloadOrShow(
  path: string,
  destination: string | undefined,
  isJson: boolean,
) {
  if (isJson && !destination) return show(await apiRequest(path))
  if (!destination)
    throw new CliError(
      '--output is required for this format.',
      ExitCode.validation,
    )
  const bytes = (await apiRequest(path, { binary: true })) as Buffer
  show(await writeDownload(destination, bytes))
}

function data(value: any) {
  return value?.data ?? value
}

function revision(value: any) {
  if (typeof value?.revision !== 'string')
    throw new CliError('The resource has no revision.', ExitCode.conflict)
  return value.revision
}

async function integrationStatus(id: string) {
  const response = (await apiRequest('/integrations')) as any
  const current = response.data?.find((item: any) => item.id === id)
  if (!current?.connected)
    throw new CliError('The integration is not connected.', ExitCode.validation)
  return current
}

async function readinessEntry(id: string) {
  const response = (await apiRequest('/readiness')) as any
  const current = response.data?.find((item: any) => item.id === id)
  if (!current)
    throw new CliError(
      'The readiness entry was not found.',
      ExitCode.validation,
    )
  return current
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  )
}

function query(options: Record<string, unknown>) {
  const parameters = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === false) continue
    parameters.set(key, String(value))
  }
  const encoded = parameters.toString()
  return encoded ? `?${encoded}` : ''
}

function globalOptions() {
  return program.opts<{ json: boolean; yes: boolean; timezone: string }>()
}

async function approve(label: string, before: unknown, after: unknown) {
  const options = globalOptions()
  await confirmMutation(label, before, after, options.yes, options.json)
}

function show(value: unknown, forceJson = false) {
  output(value, forceJson || globalOptions().json)
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function markPartialExport(value: any) {
  const entries = value?.data?.manifest?.activities
  if (
    Array.isArray(entries) &&
    entries.some((entry) => entry.status !== 'exported')
  ) {
    process.exitCode = ExitCode.partialExport
  }
}

try {
  await program.parseAsync()
} catch (error) {
  if (error instanceof CommanderError) {
    process.exitCode =
      error.code === 'commander.helpDisplayed' ? 0 : ExitCode.validation
    process.exit()
  }
  const cliError =
    error instanceof CliError
      ? error
      : new CliError(
          error instanceof Error ? error.message : String(error),
          ExitCode.network,
        )
  if (globalOptions().json)
    console.error(
      JSON.stringify({
        error: {
          message: cliError.message,
          details: cliError.details,
          exitCode: cliError.exitCode,
        },
      }),
    )
  else console.error(cliError.message)
  process.exitCode = cliError.exitCode
}
