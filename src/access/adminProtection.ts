import { sql } from '@payloadcms/db-postgres'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import {
  Forbidden,
  type CollectionBeforeChangeHook,
  type CollectionBeforeDeleteHook,
} from 'payload'

const LAST_ADMIN_LOCK = 84172931

const isPostgresAdapter = (database: unknown): database is PostgresAdapter =>
  typeof database === 'object' &&
  database !== null &&
  'sessions' in database &&
  typeof database.sessions === 'object' &&
  database.sessions !== null

const lockLastAdminInvariant = async (req: Parameters<CollectionBeforeChangeHook>[0]['req']) => {
  const transactionID = await req.transactionID
  if (!isPostgresAdapter(req.payload.db)) {
    throw new Error('Last-admin protection requires the PostgreSQL database adapter.')
  }

  const transaction = transactionID ? req.payload.db.sessions[transactionID]?.db : undefined

  if (!transaction) {
    throw new Error('Last-admin protection requires an active PostgreSQL transaction.')
  }

  await transaction.execute(sql`SELECT pg_advisory_xact_lock(${LAST_ADMIN_LOCK}, 1)`)

  const activeAdmins = await req.payload.find({
    collection: 'users',
    depth: 0,
    limit: 2,
    overrideAccess: true,
    pagination: false,
    req,
    where: {
      and: [{ role: { equals: 'admin' } }, { isActive: { equals: true } }],
    },
  })

  if (activeAdmins.docs.length <= 1) {
    throw new Forbidden(req.t)
  }
}

export const protectLastAdminUpdate: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  if (
    operation !== 'update' ||
    originalDoc?.role !== 'admin' ||
    originalDoc?.isActive === false
  ) {
    return data
  }

  const nextRole = data.role ?? originalDoc.role
  const nextIsActive = data.isActive ?? originalDoc.isActive ?? true

  if (nextRole !== 'admin' || nextIsActive !== true) {
    await lockLastAdminInvariant(req)
  }

  return data
}

export const protectLastAdminDelete: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const doc = await req.payload.findByID({
    collection: 'users',
    depth: 0,
    id,
    overrideAccess: true,
    req,
  })

  if (doc.role === 'admin' && doc.isActive !== false) {
    await lockLastAdminInvariant(req)
  }
}
