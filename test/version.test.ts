import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import { expect, it } from 'vitest'

it('reports the package version and exits successfully', () => {
  const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/index.ts', '--version'],
    { encoding: 'utf8' },
  )
  expect(result.status).toBe(0)
  expect(result.stdout.trim()).toBe(version)
  expect(result.stderr).toBe('')
})
