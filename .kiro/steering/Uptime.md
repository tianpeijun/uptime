---
inclusion: always
---

# Uptime Kuma

Self-hosted uptime monitoring tool. Vue 3 + Vite single-page frontend, Express + Socket.IO backend. Both share one `package.json`. Node.js >= 20.4.0.

## Architecture

- Frontend and backend communicate primarily over **Socket.IO**, not a REST API. Most server logic lives in `socket.io` handlers.
- `express.js` serves the built frontend (`dist/`), status-page entry points, and a few internal status-page APIs.
- Frontend is an SPA. Routes are in `src/router.js`; most shared state and socket logic is in `src/mixins/socket.js`.
- For production, the frontend is built into `dist/` via `npm run build`. In dev, Vite runs on port `3000` and the backend on port `3001`.

## Key Directories

- `server/` — backend source
  - `model/` — object models, auto-mapped to DB tables (redbean-node)
  - `monitor-types/` — monitor type implementations
  - `notification-providers/` — individual notification logic
  - `socket-handler/` — Socket.IO handlers
  - `routers/` — Express routers
  - `jobs/` — background jobs (separate process)
  - `uptime-kuma-server.js` — main `UptimeKumaServer` class; most core logic belongs here
- `src/` — frontend source (`pages/`, `components/`, `lang/`, `mixins/`)
- `db/knex_migrations/` — database migrations
- `test/` — backend tests and Playwright e2e tests
- `extra/` — utility scripts

## Code Style

- 4-space indentation; follow `.editorconfig` and ESLint.
- Document methods and functions with JSDoc.
- Naming: JavaScript/TypeScript `camelCase`, SQLite columns `snake_case`, CSS/SCSS `kebab-case`.
- Run `npm run lint` (ESLint + Stylelint) and `npm run fmt` (Prettier) before considering a change done.

## Common Tasks

- **New monitor type**: add `server/monitor-types/<TYPE>.js` (implement `async check(...)`), register it in `server/uptime-kuma-server.js`, and add UI to `src/pages/EditMonitor.vue`. In `check()`, set `heartbeat.msg` + `heartbeat.status = UP` on success and `throw` an actionable `Error` on failure. Never set `heartbeat.status = DOWN` directly unless intentionally bypassing retries.
- **New notification provider**: add `server/notification-providers/<NAME>.js`, register in `server/notification.js`, add `src/components/notifications/<NAME>.vue`, and register it in `src/components/notifications/index.js` and `src/components/NotificationDialog.vue`. Wrap axios calls in try/catch using `this.throwGeneralAxiosError(error)`. Use `HiddenInput` for secrets.
- **i18n**: add every user-facing string to `src/lang/en.json` only. Do not edit other language files (Weblate handles translations). Use `{{ $t("key") }}` or `<i18n-t keypath="key">`.

## Conventions

- Keep changes small and scoped to one concern; avoid out-of-scope features and unnecessary config.
- Prefer frontend settings over environment variables (env vars only for startup concerns like `DATA_DIR`).
- `dependencies` = backend (runtime); `devDependencies` = frontend + dev tooling (baked into `dist`).
- When updating dependencies, prefer patch releases; vet breaking changes manually.
- Base feature branches on `master` (v2). Bug fixes targeting v1 and v2 base on `1.23.X`.
- Add or update tests when adding features or fixing bugs. Run `npm run build && npm test` (backend tests + Playwright e2e). Use single-run test flags rather than watch mode.
