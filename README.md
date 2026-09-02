# Watchletic CLI

The official Node 20+ command-line client for Watchletic's Premium-only Data API. It reads and changes remotely meaningful Watchletic cloud data, exports activities, and gives AI agents a bounded deterministic context without exposing provider credentials.

The canonical repository will be [watchletic/cli](https://github.com/watchletic/cli), and the npm package will be `@watchletic/cli`. This local checkout is not connected to a remote or published yet.

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

## Safety

Every mutation prints its exact before/after value and asks for confirmation. Non-interactive mutations require `--yes`. Structured-workout batches are always validated and their schedule diff is displayed before commit.

## Exit codes

- `0` success
- `2` usage or validation failure
- `3` authentication failure
- `4` Watchletic Premium required
- `5` conflict or stale revision
- `6` raw data or requested export unavailable
- `7` partial bulk export
- `8` network or server failure
- `130` cancelled by the user
