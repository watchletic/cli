// This client is typed by schema.ts, which is deterministically generated from
// the committed Watchletic OpenAPI contract by `npm run generate`.
import createClient from 'openapi-fetch'
import type { paths } from './schema.js'

export function createWatchleticClient(baseUrl: string, accessToken: string) {
  return createClient<paths>({
    baseUrl,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
