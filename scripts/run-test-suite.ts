import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload } from 'payload'

type TestSuite = 'bootstrap' | 'integration' | 'e2e'

const suite = process.argv[2] as TestSuite | undefined

if (suite !== 'bootstrap' && suite !== 'integration' && suite !== 'e2e') {
  throw new Error('Specify one test suite: bootstrap, integration, or e2e.')
}

const parseDatabaseURL = (value: string | undefined, variableName: string) => {
  if (!value) {
    throw new Error(`${variableName} must be set to a dedicated PostgreSQL test database URL.`)
  }

  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL connection URL.`)
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`${variableName} must use the postgres or postgresql protocol.`)
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1))

  if (!databaseName) {
    throw new Error(`${variableName} must include a PostgreSQL database name.`)
  }

  if (!databaseName.toLowerCase().endsWith('_test')) {
    throw new Error(`${variableName} must target a dedicated database ending in "_test".`)
  }

  return { databaseName, value }
}

const bootstrapDatabase = parseDatabaseURL(
  process.env.XCT_TEST_DATABASE_URL_BOOTSTRAP,
  'XCT_TEST_DATABASE_URL_BOOTSTRAP',
)
const integrationDatabase = parseDatabaseURL(
  process.env.XCT_TEST_DATABASE_URL_INTEGRATION,
  'XCT_TEST_DATABASE_URL_INTEGRATION',
)

if (bootstrapDatabase.databaseName === integrationDatabase.databaseName) {
  throw new Error('Bootstrap and Integration/E2E must use different PostgreSQL database names.')
}

const selectedDatabase = suite === 'bootstrap' ? bootstrapDatabase : integrationDatabase
process.env.DATABASE_URL = selectedDatabase.value

const config = (await import('../src/payload.config')).default
const payload = await getPayload({ config: await config })

const isPostgresAdapter = (database: unknown): database is PostgresAdapter =>
  typeof database === 'object' &&
  database !== null &&
  'sessions' in database &&
  typeof database.sessions === 'object' &&
  database.sessions !== null

try {
  const database = payload.db

  if (!isPostgresAdapter(database)) {
    throw new Error('Test database verification requires the PostgreSQL adapter.')
  }

  const result = await database.pool.query<{ databaseName: string }>(
    'SELECT current_database() AS "databaseName"',
  )
  const actualDatabaseName = result.rows[0]?.databaseName

  if (actualDatabaseName !== selectedDatabase.databaseName) {
    throw new Error(
      `The ${suite} test connection resolved to an unexpected PostgreSQL database.`,
    )
  }

  console.log(`Verified ${suite} test database: ${actualDatabaseName}`)
} finally {
  await payload.destroy()
}

const vitestCLI = path.resolve('node_modules/vitest/vitest.mjs')
const playwrightCLI = path.resolve('node_modules/playwright/cli.js')
const playwrightArguments = process.argv.slice(3)
const hasPlaywrightConfig = playwrightArguments.some(
  (argument) => argument === '--config' || argument.startsWith('--config='),
)
const args =
  suite === 'bootstrap'
    ? [vitestCLI, 'run', '--config', './vitest.config.mts', 'tests/int/bootstrap-admin.int.spec.ts']
    : suite === 'integration'
      ? [
          vitestCLI,
          'run',
          '--config',
          './vitest.config.mts',
          '--exclude',
          'tests/int/bootstrap-admin.int.spec.ts',
          '--no-file-parallelism',
        ]
      : [
          playwrightCLI,
          'test',
          ...(hasPlaywrightConfig ? [] : ['--config=playwright.config.ts']),
          '--workers=1',
          ...playwrightArguments,
        ]

const child = spawnSync(process.execPath, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
})

if (child.error) {
  throw child.error
}

if (child.signal) {
  console.error(`The ${suite} test process terminated with signal ${child.signal}.`)
}

process.exitCode = child.status ?? 1
