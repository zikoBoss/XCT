# XCT

XCT is currently based on Payload CMS 3.94.2, Next.js, and PostgreSQL. This repository is a development foundation; the application still contains the Payload starter content.

## Requirements

- Node.js 22.23.5 (see `.nvmrc`)
- npm
- Docker Engine and the Docker Compose plugin for the local PostgreSQL service

The project uses `package-lock.json`; use npm commands rather than pnpm or Yarn.

## Local development

1. Copy `.env.example` to `.env`.
2. Replace the local-only PostgreSQL password and `PAYLOAD_SECRET` values. Do not commit `.env` or use these development settings in production.
3. Install exactly from the lockfile:

   ```sh
   npm ci
   ```

4. Start PostgreSQL:

   ```sh
   docker compose up -d postgres
   ```

5. Start the application on the host:

   ```sh
   npm run dev
   ```

Open <http://localhost:3000>. The Compose file starts PostgreSQL only; the application uses the host's Node.js and npm installation.

In this setup, `DATABASE_URL` uses `localhost` because the app runs on the host. If the application is later run as a container on the same Compose network, use the PostgreSQL service name (`postgres`) as the database hostname instead. Do not use `localhost` from inside the application container to reach the database container.

The Compose service binds PostgreSQL to `127.0.0.1` and stores its data in a named local-development volume. It is not a production database configuration.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string used by Payload. |
| `PAYLOAD_SECRET` | Secret used by Payload. Supply a private, randomly generated value outside source control. |
| `POSTGRES_USER` | Local PostgreSQL user used by the Compose service. |
| `POSTGRES_PASSWORD` | Local PostgreSQL password used by the Compose service. |
| `POSTGRES_DB` | Local PostgreSQL database name used by the Compose service. |

The values in `.env.example` are placeholders for local development only. Replace them before use; never reuse them in production.

## Tests and checks

```sh
npm run lint
npm run test:int
npm run test:e2e
npm test
npm run build
```

Integration tests require a reachable PostgreSQL database configured by `DATABASE_URL`. Playwright tests start the app with `npm run dev` and require the Playwright browser to be installed.

## Docker image

The `Dockerfile` builds a Next.js standalone image using Node.js 22.23.5 and `npm ci`. Provide `DATABASE_URL` and `PAYLOAD_SECRET` at container runtime; the image does not include credentials. Build with:

```sh
docker build -t xct:local .
```

The build context excludes local environment files, dependencies, and generated build output. There is currently no `public/` directory, so the Dockerfile does not copy one.
