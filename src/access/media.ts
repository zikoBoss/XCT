import { sql } from '@payloadcms/db-postgres'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import {
  Forbidden,
  type Access,
  type CollectionBeforeChangeHook,
  type CollectionBeforeDeleteHook,
  type GlobalBeforeChangeHook,
  type PayloadRequest,
} from 'payload'

type MediaID = number | string
type MediaReferenceCollection = 'news' | 'projects' | 'hubs'

const MEDIA_REFERENCE_LOCK_NAMESPACE = 84172932

const relationIDs = (value: unknown): MediaID[] => {
  if (Array.isArray(value)) {
    return value.flatMap(relationIDs)
  }

  if (typeof value === 'number' || typeof value === 'string') {
    return [value]
  }

  if (typeof value === 'object' && value !== null && 'id' in value) {
    return relationIDs(value.id)
  }

  return []
}

const hasMediaID = (values: unknown[], id: MediaID) =>
  values.flatMap(relationIDs).some((referenceID) => String(referenceID) === String(id))

const isPostgresAdapter = (database: unknown): database is PostgresAdapter =>
  typeof database === 'object' &&
  database !== null &&
  'sessions' in database &&
  typeof database.sessions === 'object' &&
  database.sessions !== null

const normalizedMediaIDs = (values: unknown[]) =>
  [...new Set(values.flatMap(relationIDs))].map((id) => {
    const numericID = typeof id === 'number' ? id : /^\d+$/.test(id) ? Number(id) : Number.NaN
    if (!Number.isSafeInteger(numericID) || numericID < 1 || numericID > 2_147_483_647) {
      throw new Error(`Invalid PostgreSQL Media ID: ${id}`)
    }
    return numericID
  })

const lockMediaIDs = async (req: PayloadRequest, values: unknown[]) => {
  const ids = normalizedMediaIDs(values).sort((a, b) => a - b)
  if (ids.length === 0) return

  const transactionID = await req.transactionID
  if (!isPostgresAdapter(req.payload.db)) {
    throw new Error('Media reference protection requires the PostgreSQL database adapter.')
  }

  const transaction = transactionID ? req.payload.db.sessions[transactionID]?.db : undefined
  if (!transaction) {
    throw new Error('Media reference protection requires an active PostgreSQL transaction.')
  }

  for (const id of ids) {
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(${MEDIA_REFERENCE_LOCK_NAMESPACE}, ${id})`,
    )
  }
}

const getPath = (value: unknown, path: string) =>
  path.split('.').reduce<unknown>((current, key) => {
    if (typeof current !== 'object' || current === null || !(key in current)) return undefined
    return (current as Record<string, unknown>)[key]
  }, value)

const hasPath = (value: unknown, path: string) => {
  let current = value
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null || !(key in current)) return false
    current = (current as Record<string, unknown>)[key]
  }
  return true
}

const mediaReferenceChangeHook =
  (paths: string[]): CollectionBeforeChangeHook =>
  async ({ data, operation, originalDoc, req }) => {
    const values: unknown[] = []
    for (const path of paths) {
      if (operation === 'create' || hasPath(data, path)) {
        values.push(getPath(originalDoc, path), getPath(data, path))
      }
    }
    await lockMediaIDs(req, values)
    return data
  }

const mediaReferenceDeleteHook =
  (collection: MediaReferenceCollection, paths: string[]): CollectionBeforeDeleteHook =>
  async ({ id, req }) => {
    const values: unknown[] = []
    for (const draft of [false, true]) {
      const doc = await req.payload.findByID({
        collection,
        depth: 0,
        disableErrors: true,
        draft,
        id,
        overrideAccess: true,
        req,
      })
      if (doc) {
        values.push(...paths.map((path) => getPath(doc, path)))
      }
    }
    await lockMediaIDs(req, values)
  }

export const lockNewsMediaReferences = mediaReferenceChangeHook(['cover'])
export const lockProjectMediaReferences = mediaReferenceChangeHook(['cover', 'gallery'])
export const lockHubMediaReferences = mediaReferenceChangeHook(['image'])

export const lockNewsMediaReferencesBeforeDelete = mediaReferenceDeleteHook('news', ['cover'])
export const lockProjectMediaReferencesBeforeDelete = mediaReferenceDeleteHook('projects', [
  'cover',
  'gallery',
])
export const lockHubMediaReferencesBeforeDelete = mediaReferenceDeleteHook('hubs', ['image'])

export const lockHomeMediaReferences: GlobalBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  await lockMediaIDs(req, [
    getPath(originalDoc, 'hero.image'),
    getPath(data, 'hero.image'),
    getPath(originalDoc, 'seo.image'),
    getPath(data, 'seo.image'),
  ])
  return data
}

const collectMediaIDs = async (req: PayloadRequest) => {
  const ids = new Set<MediaID>()
  let page = 1
  let hasNextPage = true

  while (hasNextPage) {
    const news = await req.payload.find({
      collection: 'news',
      depth: 0,
      limit: 1000,
      overrideAccess: true,
      page,
      req,
      select: { cover: true },
      where: { _status: { equals: 'published' } },
    })
    const projects = await req.payload.find({
      collection: 'projects',
      depth: 0,
      limit: 1000,
      overrideAccess: true,
      page,
      req,
      select: { cover: true, gallery: true },
      where: { _status: { equals: 'published' } },
    })
    const hubs = await req.payload.find({
      collection: 'hubs',
      depth: 0,
      limit: 1000,
      overrideAccess: true,
      page,
      req,
      select: { image: true },
      where: { _status: { equals: 'published' } },
    })
    const home =
      page === 1
        ? await req.payload.findGlobal({
            slug: 'home',
            depth: 0,
            overrideAccess: true,
            req,
          })
        : null

    for (const doc of news.docs) {
      relationIDs(doc.cover).forEach((id) => ids.add(id))
    }
    for (const doc of projects.docs) {
      relationIDs(doc.cover).forEach((id) => ids.add(id))
      relationIDs(doc.gallery).forEach((id) => ids.add(id))
    }
    for (const doc of hubs.docs) {
      relationIDs(doc.image).forEach((id) => ids.add(id))
    }

    if (home?._status === 'published') {
      const homeData = home as unknown as {
        hero?: { image?: unknown }
        seo?: { image?: unknown }
      }
      relationIDs(homeData.hero?.image).forEach((id) => ids.add(id))
      relationIDs(homeData.seo?.image).forEach((id) => ids.add(id))
    }

    hasNextPage = news.hasNextPage || projects.hasNextPage || hubs.hasNextPage
    page += 1
  }

  return [...ids]
}

const hasCollectionReference = async (
  req: PayloadRequest,
  collection: 'news' | 'projects' | 'hubs',
  field: 'cover' | 'gallery' | 'image',
  id: MediaID,
  draft: boolean,
  publishedOnly = false,
) => {
  const where = {
    and: [
      ...(publishedOnly ? [{ _status: { equals: 'published' as const } }] : []),
      { [field]: { equals: id } },
    ],
  }
  const options = {
    depth: 0 as const,
    draft,
    limit: 1,
    overrideAccess: true,
    req,
    where,
  }

  if (collection === 'news') {
    return (await req.payload.find({ ...options, collection })).docs.length > 0
  }
  if (collection === 'projects') {
    return (await req.payload.find({ ...options, collection })).docs.length > 0
  }
  return (await req.payload.find({ ...options, collection })).docs.length > 0
}

const hasHomeReference = async (
  req: PayloadRequest,
  id: MediaID,
  draft: boolean,
  publishedOnly = false,
) => {
  if (draft) {
    const versions = await req.payload.findGlobalVersions({
      slug: 'home',
      limit: 1,
      overrideAccess: true,
      pagination: false,
      req,
      sort: '-updatedAt',
    })
    const latestVersion = versions.docs[0]?.version
    if (latestVersion?._status !== 'draft') {
      return false
    }

    const versionData = latestVersion as unknown as {
      hero?: { image?: unknown }
      seo?: { image?: unknown }
    }
    return hasMediaID([versionData.hero?.image, versionData.seo?.image], id)
  }

  const home = await req.payload.findGlobal({
    slug: 'home',
    depth: 0,
    draft: false,
    overrideAccess: true,
    req,
  })
  if (publishedOnly && home._status !== 'published') {
    return false
  }

  const homeData = home as unknown as {
    hero?: { image?: unknown }
    seo?: { image?: unknown }
  }

  return hasMediaID([homeData.hero?.image, homeData.seo?.image], id)
}

const isPublishedMediaReference = async (req: PayloadRequest, id: MediaID) => {
  if (await hasCollectionReference(req, 'news', 'cover', id, false, true)) return true
  if (await hasCollectionReference(req, 'projects', 'cover', id, false, true)) return true
  if (await hasCollectionReference(req, 'projects', 'gallery', id, false, true)) return true
  if (await hasCollectionReference(req, 'hubs', 'image', id, false, true)) return true
  return hasHomeReference(req, id, false, true)
}

export const readMedia: Access = async ({ data, id, req }) => {
  if (req.user?.isActive !== false && (req.user?.role === 'admin' || req.user?.role === 'editor')) {
    return true
  }

  if (id !== undefined) {
    return isPublishedMediaReference(req, id)
  }

  const filename =
    typeof data === 'object' && data !== null && 'filename' in data ? data.filename : undefined
  if (typeof filename === 'string') {
    const imageSizes = req.payload.collections.media.config.upload?.imageSizes ?? []
    const media = await req.payload.db.findOne({
      collection: 'media',
      req,
      where: {
        or: [
          { filename: { equals: filename } },
          ...imageSizes.map(({ name }) => ({
            [`sizes.${name}.filename`]: { equals: filename },
          })),
        ],
      },
    })
    return media ? isPublishedMediaReference(req, media.id) : false
  }

  const ids = new Set<MediaID>(await collectMediaIDs(req))
  return ids.size > 0 ? { id: { in: [...ids] } } : false
}

const hasAnyCollectionReference = async (
  req: PayloadRequest,
  collection: 'news' | 'projects' | 'hubs',
  field: 'cover' | 'gallery' | 'image',
  id: MediaID,
  draft: boolean,
) => {
  const options = {
    depth: 0 as const,
    draft,
    limit: 1,
    overrideAccess: true,
    req,
    where: { [field]: { equals: id } },
  }

  if (collection === 'news') {
    return (await req.payload.find({ ...options, collection })).docs.length > 0
  }
  if (collection === 'projects') {
    return (await req.payload.find({ ...options, collection })).docs.length > 0
  }
  return (await req.payload.find({ ...options, collection })).docs.length > 0
}

export const preventDeletingReferencedMedia: CollectionBeforeDeleteHook = async ({ id, req }) => {
  await lockMediaIDs(req, [id])

  for (const draft of [false, true]) {
    if (
      (await hasAnyCollectionReference(req, 'news', 'cover', id, draft)) ||
      (await hasAnyCollectionReference(req, 'projects', 'cover', id, draft)) ||
      (await hasAnyCollectionReference(req, 'projects', 'gallery', id, draft)) ||
      (await hasAnyCollectionReference(req, 'hubs', 'image', id, draft)) ||
      (await hasHomeReference(req, id, draft))
    ) {
      throw new Forbidden(req.t)
    }
  }
}
