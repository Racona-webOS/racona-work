# Racona Work

An Racona application

## Development

```bash
# 1. Set up environment variables
cp .env.example .env

# 2. Start the dev database (Docker)
bun db:up

# 3. Start the dev server — this also runs migrations (separate terminal)
bun dev:server

# 4. Start the Vite dev server (separate terminal)
bun dev
```

> **Note:** Migrations run automatically when `bun dev:server` starts,
> not when `bun db:up` runs. `db:up` only starts the Docker Postgres container.

One-step startup (dev:server + dev in parallel):
```bash
bun dev:full
```

## Build

```bash
bun run build
```

> The `build` command runs `build-all.js`, which builds the main app and all sidebar components.

## Structure

- `src/App.svelte` — main component
- `src/main.ts` — entry point
- `src/plugin.ts` — IIFE build entry
- `src/components/` — sidebar components
- `server/functions.ts` — server-side functions
- `locales/` — translations (hu, en)
- `migrations/` — SQL migrations
- `docker-compose.dev.yml` — local dev database
- `assets/icon.svg` — app icon
- `manifest.json` — app metadata
- `vite.config.ts` — build configuration

## License

MIT
