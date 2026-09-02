import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { CliError, ExitCode } from './errors.js'

export function readJson(file: string) {
  const contents =
    file === '-'
      ? fs.readFileSync(0, 'utf8')
      : fs.readFileSync(path.resolve(file), 'utf8')
  try {
    return JSON.parse(contents) as unknown
  } catch (error) {
    throw new CliError(
      `Invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`,
      ExitCode.validation,
    )
  }
}

export function output(value: unknown, json: boolean) {
  if (json || typeof value !== 'object' || value === null) {
    console.log(
      typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    )
    return
  }
  console.log(JSON.stringify(value, null, 2))
}

export async function confirmMutation(
  label: string,
  before: unknown,
  after: unknown,
  yes: boolean,
  json: boolean,
) {
  if (!yes) {
    if (json || !stdin.isTTY || !stdout.isTTY) {
      throw new CliError(
        'Non-interactive mutations require --yes.',
        ExitCode.validation,
      )
    }
    console.log(JSON.stringify({ mutation: label, before, after }, null, 2))
    const prompt = readline.createInterface({ input: stdin, output: stdout })
    const answer = await prompt.question('Apply this mutation? [y/N] ')
    prompt.close()
    if (!/^y(?:es)?$/i.test(answer.trim()))
      throw new CliError('Cancelled.', ExitCode.cancelled)
  } else if (json) {
    console.error(JSON.stringify({ mutation: label, before, after }))
  } else {
    console.log(JSON.stringify({ mutation: label, before, after }, null, 2))
  }
}

export async function writeDownload(target: string, data: Buffer) {
  const destination = path.resolve(target)
  const temporary = `${destination}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  try {
    fs.writeFileSync(temporary, data, { mode: 0o600 })
    fs.renameSync(temporary, destination)
  } catch (error) {
    try {
      fs.unlinkSync(temporary)
    } catch {
      // Nothing to clean up.
    }
    throw error
  }
  return { path: destination, bytes: data.byteLength }
}
