import { Forbidden, type Access, type CollectionBeforeDeleteHook, type PayloadRequest } from 'payload'

type MediaID = number | string

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

    if (home) {
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
    return [...relationIDs(versionData.hero?.image), ...relationIDs(versionData.seo?.image)].includes(
      id,
    )
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

  return [...relationIDs(homeData.hero?.image), ...relationIDs(homeData.seo?.image)].includes(id)
}

const isPublishedMediaReference = async (req: PayloadRequest, id: MediaID) => {
  if (await hasCollectionReference(req, 'news', 'cover', id, false, true)) return true
  if (await hasCollectionReference(req, 'projects', 'cover', id, false, true)) return true
  if (await hasCollectionReference(req, 'projects', 'gallery', id, false, true)) return true
  if (await hasCollectionReference(req, 'hubs', 'image', id, false, true)) return true
  return hasHomeReference(req, id, false, true)
}

export const readMedia: Access = async ({ data, id, req }) => {
  if (
    req.user?.isActive !== false &&
    (req.user?.role === 'admin' || req.user?.role === 'editor')
  ) {
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
