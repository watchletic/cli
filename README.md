# Watchletic CLI

The official Node 20+ command-line client for the Watchletic Data API. It reads and changes remotely meaningful Watchletic cloud data for Watchletic Club members, exports activities, and gives AI agents a bounded deterministic context without exposing provider credentials.

The canonical repository is [watchletic/cli](https://github.com/watchletic/cli), and the npm package is `@watchletic/cli`.

## Installation

```sh
npm install --global @watchletic/cli
watchletic auth login
```

## Local development

```sh
npm install
npm run generate
npm test
npm run build
node dist/index.js --help
```

The generator reads `../watchletic-api/openapi/watchletic-v1.yaml`. Generated types are committed, so package installation will not depend on a sibling repository.

`npm pack` and package publication use the committed generated types and do not require the sibling API repository. Run `npm run generate` explicitly when updating the contract during local development.

Use `WATCHLETIC_API_URL` to point at a local server and `WATCHLETIC_ACCESS_TOKEN` for an ephemeral access-token override. The environment token is never written to disk.

## Agent context

`watchletic context` uses the canonical `/v1/context` endpoint and returns compact, deterministic schema-version-2 JSON for training analysis and structured-workout planning. It includes recent activity metadata, readiness values and seven-day trends, summarized 90-day analytics, current fitness/fatigue/form, training-load configuration, and upcoming structured-workout summaries.

Full analytics curves, raw samples, live-tracking recipients, and complete structured-workout steps are intentionally excluded. Use the returned activity and structured-workout IDs with the focused `activities get`, `activities raw`, `analytics get`, or `structured-workouts get` commands when a specific question needs more detail.

## Safety

Every mutation prints its exact before/after value and asks for confirmation. Non-interactive mutations require `--yes`. Structured-workout batches are always validated and their schedule diff is displayed before commit.

## Exit codes

- `0` success
- `2` usage or validation failure
- `3` authentication failure
- `4` Watchletic Club membership required for data access
- `5` conflict or stale revision
- `6` raw data or requested export unavailable
- `7` partial bulk export
- `8` network or server failure
- `130` cancelled by the user

### Session lifetime and concurrent commands

Access tokens last one hour. The CLI refreshes saved credentials automatically;
each successful refresh renews the connection for 180 days. Connections can be
revoked in Watchletic's API access settings or with `watchletic auth logout`.
Existing connections receive the longer lifetime on their next successful refresh.

Commands share a credential lock, re-read the latest saved tokens under that lock,
and save rotated tokens before releasing it. Login and logout use the same lock.
A terminated process's abandoned lock can be recovered after 30 seconds.
Update all CLI installations sharing a configuration directory to get this protection.
`WATCHLETIC_ACCESS_TOKEN` overrides saved credentials and cannot refresh itself.

If the server rotates a token but its response is lost, signing in again may still
be necessary: the server rejects reuse of an already rotated refresh token.
