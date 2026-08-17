# Local Build, Deploy & Testing Cheat Sheet

Quick reference for pulling the latest code, building it, running it locally, and
the things that are easy to forget between sessions. See `docs/DEVELOPMENT.md` for
the full development guide — this file is the condensed, day-to-day version.

## 1. Pull the latest code

```bash
git checkout dev
git pull origin dev
```

- `dev` is the integration branch — all day-to-day work happens here.
- `main` is the stable release branch; only merges from `dev` land there (triggers a
  production release). Don't develop directly on `main`.
- If you're picking up someone else's feature branch instead: `git fetch origin && git checkout <branch>`.

## 2. Build the local dev image

```bash
# First time on a clean clone, or after dependency changes (package.json/package-lock changed)
./scripts/build-dev.sh --install-deps

# Normal rebuild after backend/frontend code changes
./scripts/build-dev.sh
```

Flags:
- `--install-deps` — runs `npm ci --ignore-scripts` (root + `client/`) and wires up Husky. Needed on a clean clone or after a dependency bump.
- `--no-cache` — force a full rebuild (e.g. to pick up a newer yt-dlp).

Requires **Node.js 20.19+ / npm 11.10+** on the host (used to build the client before
the Docker image is created) and Docker installed. If npm is older, upgrade with
`npm install -g npm@11.15.0 --ignore-scripts`.

Note: npm installs are gated by a 5-day cooldown on newly-published package versions
(supply-chain protection). This doesn't affect `npm ci` against the committed
lockfile, only fresh `npm install`/`npm update`.

## 3. Run it locally

```bash
./scripts/start-dev.sh
```

Starts:
- **Backend** — http://localhost:3011 (Express, `node --watch`, auto-restarts on backend file changes)
- **Frontend (static build)** — http://localhost:3087
- **MariaDB** — internal Docker network only

Flags:
- `--no-auth` — disable authentication (local-only use)
- `--debug` — set log level to debug

Stop everything:

```bash
./stop.sh
```

### Faster frontend iteration (optional)

If you're actively changing React code, run the Vite dev server alongside the Docker backend instead of rebuilding every time:

```bash
# Terminal 1
./scripts/start-dev.sh

# Terminal 2
cd client && npm run dev
```

Then use **http://localhost:3000** — Vite proxies API/WebSocket calls to the backend and gives you instant HMR. The static build at :3087 will NOT reflect frontend changes until you rebuild.

## 4. What requires a rebuild vs. what doesn't

| Change | Action |
|---|---|
| `server/*.js`, `modules/`, `routes/` | Nothing — `node --watch` auto-restarts. Check logs to confirm. |
| New migration file | No rebuild, but **restart the container** (`./stop.sh && ./scripts/start-dev.sh`) so it runs. |
| `client/src/**` (using static build workflow) | `./scripts/build-dev.sh` then `./scripts/start-dev.sh` |
| `client/src/**` (using Vite dev server) | Nothing — HMR picks it up instantly |
| New npm dependency | `./scripts/build-dev.sh --install-deps` |
| Dockerfile / system deps (yt-dlp, ffmpeg) | `./scripts/build-dev.sh --no-cache` |

## 5. Everyday commands

```bash
# Container status / logs
docker compose ps
docker compose logs -f youtarr
docker compose logs -f youtarr-db

# Shell into a container
docker compose exec youtarr bash

# MySQL shell
docker compose exec youtarr-db mysql -u root -p123qweasd youtarr

# Restart just the app container
docker compose restart youtarr
```

## 6. Testing & linting (run before pushing / opening a PR)

```bash
npm run test:backend
npm run test:frontend
npm run lint          # frontend + backend
npm run lint:ts       # TypeScript typecheck
```

Run a single test file:

```bash
npm run test:backend -- server/modules/__tests__/foo.test.js
npm run test:frontend -- client/src/hooks/__tests__/foo.ts
```

Husky runs lint/typecheck/tests automatically on commit. Don't bypass with
`--no-verify` unless there's a good reason — and mention it if you do.

## 7. Full reset (nuke local DB/config, keep downloaded videos)

```bash
./scripts/reset-server-data.sh
```

**Destructive** — wipes the database and `config/config.json`, no backup. Useful for
testing the first-run setup flow from scratch. Downloaded video files are untouched.

## 8. Testing against a dev-branch Docker image (no local build)

To test the published bleeding-edge image instead of building locally:

```bash
./start.sh --dev --pull-latest
```

This pulls `dialmaster/youtarr:dev-latest` (rebuilt on every merge to `dev`). Drop
`--pull-latest` on later runs to reuse what's already local. To go back to the
stable release image, restart without `--dev` (and remove any `YOUTARR_IMAGE`
override left in `.env`).

## 9. Building & deploying from source on a production server

If you're self-hosting from your own build (instead of pulling the published
`dialmaster/youtarr:latest` image), the underlying build commands are the same ones
`./scripts/build-dev.sh` runs — just tagged and run against the **production** compose
setup instead of the dev one.

```bash
# 1. Pull latest code
git checkout main
git pull origin main          # or `dev` if you intentionally track pre-release

# 2. Install exact locked dependencies (root + client), skipping lifecycle scripts
npm ci --ignore-scripts
cd client && npm ci --ignore-scripts && cd ..

# 3. Build the production React bundle
cd client && npm run build && cd ..

# 4. Build the Docker image (tag it whatever you reference below)
docker build -t youtarr-local:latest .
```

Then point the production compose file at that locally built image instead of Docker
Hub. `docker-compose.yml` reads the image from `${YOUTARR_IMAGE:-dialmaster/youtarr:latest}`,
so set it in `.env`:

```bash
# .env
YOUTARR_IMAGE=youtarr-local:latest
```

```bash
./stop.sh
./start.sh
# or directly: docker compose up -d
```

Notes:
- `npm ci` (not `npm install`) is required here — the production build should always
  match the committed lockfile exactly, no resolution surprises.
- Skip `--install-deps`-equivalent steps (2–3 above) if nothing in `package.json`/`package-lock.json`
  changed since your last build — a plain `docker build` reusing cached layers is enough after a code-only pull, since the Dockerfile copies the already-built `client/build` output in.
- If you forget to `cd client && npm run build` before `docker build`, the image will
  bake in a **stale** frontend bundle — the Dockerfile does not build the client itself,
  it copies the pre-built output.
- Remove or comment out `YOUTARR_IMAGE` in `.env` if you ever want to switch back to
  the officially published image.
- For a first-time production install (not upgrading an existing one), see
  `docs/INSTALLATION.md` and `docs/DOCKER.md` for volume/`.env` setup you only need to
  do once (e.g. `YOUTUBE_OUTPUT_DIR`, named-volume DB override for NAS/ARM hosts).

## 10. Access points once running

- App: http://localhost:3087 (or http://localhost:3000 if using Vite HMR)
- Swagger / API docs: http://localhost:3087/swagger
- OpenAPI JSON: http://localhost:3087/swagger.json

First run: create your admin account through the UI (or set `AUTH_PRESET_USERNAME`
/ `AUTH_PRESET_PASSWORD` in `.env` for headless bootstrap).

## 11. Things worth remembering

- **Always test inside the Docker dev containers**, not by running the server directly on the host — this repo's dev workflow assumes Docker for backend/DB parity with production.
- **PRs target `dev`, never `main`.** `main` only receives merges from `dev`.
- Commit prefixes drive semantic versioning on release: `feat:` (minor), `fix:` (patch), `BREAKING CHANGE:` (major).
- `.env` changes require a full container restart (`./stop.sh` then `./start.sh` / `./scripts/start-dev.sh`), not just a code reload.
- Default DB credentials for local dev: `root` / `123qweasd` (internal container only, not exposed to host).
- If ports are already in use: `docker compose down` or check what's bound with `lsof -i :3011` / `:3087`.
- Full architecture, module map, and coding standards live in the repo's `CLAUDE.md` — check there before making structural changes.
- **Production builds always use `npm ci`, never `npm install`** — production should exactly match the committed lockfile.
- After building a fresh production image, double check `.env`'s `YOUTARR_IMAGE` actually points at it, or `docker compose up -d` will silently pull/reuse `dialmaster/youtarr:latest` instead.
