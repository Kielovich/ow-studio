# Going live

One container runs the web app and the generation worker (`apps/web/scripts/serve.mjs`). All data (SQLite database, images, daily database backups) lives on a persistent volume mounted at `/data`. Run exactly **one** instance: SQLite and the job leases assume a single host.

## What the container does on start

1. Opens the database and applies the additive migrations.
2. On an empty volume, imports the 6 registered models and their 36 reference images from `apps/web/seed/` (verified against their content hashes).
3. Starts the worker (writes a database snapshot to `/data/backups` once a day, keeps 7) and the web server.
4. If either process stops, the container exits, so the platform restarts both.

`GET /api/health` answers without a session, for the platform's health check.

## Environment variables (set in the platform's secret store, never in the repository)

| Name | Required | Value |
|---|---|---|
| `OW_PASSWORD` | yes | Shared login password, at least 12 characters |
| `OW_SESSION_SECRET` | yes | Random string, at least 32 characters (e.g. `openssl rand -hex 32`). Changing it signs everyone out |
| `GEMINI_API_KEY` | yes | Google AI Studio key with billing enabled |
| `OW_BUDGET_USD` | no | Monthly spend cap, default 25 |

Without `OW_PASSWORD` and `OW_SESSION_SECRET` the production app refuses every request (503) instead of running open.

## Railway (fallback host)

The target is ChatGPT Sites (`docs/handover-codex-sites.md`). Railway is the fallback if the Sites spike fails: it runs the existing container unchanged.

The `Dockerfile` has no `VOLUME` instruction on purpose: Railway rejects it. The volume is attached in step 3.

1. New project, then "Deploy from GitHub repo", and pick `Kielovich/ow-studio`. Railway builds the `Dockerfile` in the repository root.
2. Region: an EU region.
3. Add a volume to the service, mounted at `/data`.
4. Variables: the four from the table above.
5. Settings: health check path `/api/health`; keep the service at one replica.
6. Networking: generate a domain (or attach your own). Open it and sign in.

Every push to `main` deploys again.

**Trap when Railway creates the service itself:** on connecting the repository, Railway detected the npm workspaces and proposed a Railpack build with `npm run build --workspace=web`, start command `npm run start --workspace=web` and watch path `/apps/web/**`. That runs only `next start`: no worker, no prestart (migrations, seed), and changes in `packages/core` would not deploy. The service must build the root `Dockerfile` with no build or start command override and no watch paths.

Live since 2026-11-14: project `genuine-enthusiasm`, service `web`, region EU West (Amsterdam), one replica, volume `web-volume` at `/data`, health check `/api/health`, domain `web-production-21c1e5a1.up.railway.app`. First start: 7 models seeded (Mei was retired later the same day; 6 remain), backup written, worker up with `gemini-3-pro-image`. Note that Railway's `railway.json` config file is deprecated for new services, so these settings live in the dashboard.

## Verified locally (2026-11-13)

- `next build` passes; every API route runs at request time.
- `node scripts/serve.mjs` on an empty data directory: models seeded, backup written, worker and web up, health check OK.
- Login: pages redirect to `/login`, APIs and images answer 401 without a session, logout ends the session, wrong passwords are throttled.
- If the worker dies, the whole process exits (so the platform restarts it).
- **Not verified here:** the Docker image build itself (no Docker daemon in this environment). The first Railway build is the first real image build; check its log.

## Local development

Unchanged: `npm run dev` and `npm run worker` in `apps/web`. Without `OW_PASSWORD` locally there is no login.
