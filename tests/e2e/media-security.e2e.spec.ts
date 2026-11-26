import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload, type Payload, type TypedUser } from 'payload'
import type { Home, Media } from '../../src/payload-types.js'
import config from '../../src/payload.config.js'

const serverURL = 'http://localhost:3000'
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const suffix = `${Date.now()}`
const password = 'media-test-password'
const adminEmail = `b4-admin-${suffix}@example.test`
const editorEmail = `b4-editor-${suffix}@example.test`
const mediaReferenceLockNamespace = 84172932

const isPostgresAdapter = (database: unknown): database is PostgresAdapter =>
  typeof database === 'object' &&
  database !== null &&
  'sessions' in database &&
  typeof database.sessions === 'object' &&
  database.sessions !== null

const getPostgresPool = () => {
  const database = payload.db
  if (!isPostgresAdapter(database)) {
    throw new Error('Media security concurrency tests require the PostgreSQL adapter.')
  }
  return database.pool
}

const waitForAdvisoryLockWaiters = async (
  pool: PostgresAdapter['pool'],
  mediaID: number,
  expectedWaiters: number,
) => {
  const deadline = Date.now() + 10_000
  let waiters = 0

  while (Date.now() < deadline) {
    const result = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM pg_locks
       WHERE locktype = 'advisory'
         AND classid = $1::oid
         AND objid = $2::oid
         AND granted = false`,
      [mediaReferenceLockNamespace, mediaID],
    )
    waiters = result.rows[0]?.count ?? 0
    if (waiters >= expectedWaiters) return waiters
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  return waiters
}

const deleteWhileMediaLockIsHeld = async (
  mediaID: number,
  deleteContent: () => Promise<unknown>,
) => {
  const pool = getPostgresPool()
  const connection = await pool.connect()
  let deletion: Promise<unknown> | undefined
  let waiters = 0

  try {
    await connection.query('BEGIN')
    await connection.query('SELECT pg_advisory_xact_lock($1::integer, $2::integer)', [
      mediaReferenceLockNamespace,
      mediaID,
    ])
    deletion = deleteContent()
    waiters = await waitForAdvisoryLockWaiters(pool, mediaID, 1)
  } finally {
    try {
      await connection.query('ROLLBACK')
    } finally {
      connection.release()
    }
  }

  if (!deletion) {
    throw new Error('The content deletion did not start.')
  }

  const [result] = await Promise.allSettled([deletion])
  expect(waiters).toBe(1)
  expect(result.status).toBe('fulfilled')
}

let payload: Payload
let admin: TypedUser
let homeSnapshot: Home
let homePublishedSnapshot: Home
let fixtureDirectory: string
let uploadSource: string
let unlinkedMedia: Media
let draftMedia: Media
let publishedMedia: Media
let mixedMedia: Media
let homeMedia: Media
let homeDraftMedia: Media
let projectCoverMedia: Media
let projectGalleryMedia: Media
let hubMedia: Media
let raceMedia: Media | undefined
let editorUploadedMediaID: number | undefined
let draftNewsID: number
let publishedNewsID: number
let mixedPublishedNewsID: number
let mixedDraftNewsID: number
let projectID: number
let hubID: number
const deletedMediaIDs = new Set<number>()

const createMedia = async (label: string) => {
  const filePath = path.join(fixtureDirectory, `${label}.png`)
  await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: { r: 180, g: 40, b: 40 },
    },
  })
    .png()
    .toFile(filePath)

  return payload.create({
    collection: 'media',
    data: { alt: label },
    filePath,
    overrideAccess: true,
  })
}

const createNews = async (slug: string, coverID: number, draft: boolean) => {
  const news = await payload.create({
    collection: 'news',
    data: {
      title: slug,
      slug,
      summary: 'Media access test content.',
      category: 'update',
      author: admin.id,
      cover: coverID,
      _status: draft ? 'draft' : 'published',
    },
    draft: true,
    overrideAccess: true,
  })

  if (!draft) {
    await payload.update({
      collection: 'news',
      id: news.id,
      data: { _status: 'published' },
      draft: true,
      overrideAccess: true,
    })
  }

  return news.id
}

test.describe.serial('Media security', () => {
  test.beforeAll(async () => {
    payload = await getPayload({ config: await config })
    admin = await payload.create({
      collection: 'users',
      data: { email: adminEmail, password, role: 'admin', isActive: true },
    })
    await payload.create({
      collection: 'users',
      data: { email: editorEmail, password, role: 'editor', isActive: true },
    })
    homeSnapshot = await payload.findGlobal({
      slug: 'home',
      depth: 0,
      overrideAccess: true,
    })

    fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), `xct-media-${suffix}-`))
    uploadSource = path.join(fixtureDirectory, 'editor-upload.png')
    await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 40, g: 80, b: 180 },
      },
    })
      .png()
      .toFile(uploadSource)

    unlinkedMedia = await createMedia('unlinked')
    draftMedia = await createMedia('draft-only')
    publishedMedia = await createMedia('published')
    mixedMedia = await createMedia('published-and-draft')
    homeMedia = await createMedia('home-published')
    homeDraftMedia = await createMedia('home-draft')
    projectCoverMedia = await createMedia('project-cover')
    projectGalleryMedia = await createMedia('project-gallery')
    hubMedia = await createMedia('hub-image')

    draftNewsID = await createNews(`b4-draft-${suffix}`, draftMedia.id, true)
    publishedNewsID = await createNews(`b4-published-${suffix}`, publishedMedia.id, false)
    mixedPublishedNewsID = await createNews(`b4-mixed-published-${suffix}`, mixedMedia.id, false)
    mixedDraftNewsID = await createNews(`b4-mixed-draft-${suffix}`, mixedMedia.id, true)

    const project = await payload.create({
      collection: 'projects',
      data: {
        title: `B4 project ${suffix}`,
        slug: `b4-project-${suffix}`,
        summary: 'Published project media references.',
        author: admin.id,
        cover: projectCoverMedia.id,
        gallery: [projectGalleryMedia.id],
        _status: 'draft',
      },
      draft: true,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'projects',
      id: project.id,
      data: { _status: 'published' },
      draft: true,
      overrideAccess: true,
    })
    projectID = project.id

    const hub = await payload.create({
      collection: 'hubs',
      data: {
        title: `B4 hub ${suffix}`,
        slug: `b4-hub-${suffix}`,
        summary: 'Published hub media reference.',
        author: admin.id,
        image: hubMedia.id,
        _status: 'draft',
      },
      draft: true,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'hubs',
      id: hub.id,
      data: { _status: 'published' },
      draft: true,
      overrideAccess: true,
    })
    hubID = hub.id

    homePublishedSnapshot = await payload.updateGlobal({
      slug: 'home',
      data: {
        hero: { title: 'Media test home', summary: 'Published Home media.', image: homeMedia.id },
        _status: 'published',
      },
      user: admin,
      overrideAccess: true,
      draft: false,
    })
    await payload.updateGlobal({
      slug: 'home',
      data: {
        hero: {
          title: 'Media draft home',
          summary: 'Draft Home media.',
          image: homeDraftMedia.id,
        },
      },
      user: admin,
      overrideAccess: true,
      draft: true,
    })
  })

  test.afterAll(async () => {
    if (!payload) return

    await payload.updateGlobal({
      slug: 'home',
      data: homeSnapshot,
      user: admin,
      overrideAccess: true,
      draft: false,
    })
    await payload.delete({
      collection: 'news',
      where: {
        slug: {
          in: [
            `b4-draft-${suffix}`,
            `b4-published-${suffix}`,
            `b4-mixed-published-${suffix}`,
            `b4-mixed-draft-${suffix}`,
            `b4-race-${suffix}`,
          ],
        },
      },
      overrideAccess: true,
    })
    await payload.delete({
      collection: 'projects',
      id: projectID,
      overrideAccess: true,
    })
    await payload.delete({
      collection: 'hubs',
      id: hubID,
      overrideAccess: true,
    })

    if (editorUploadedMediaID) {
      await payload.delete({
        collection: 'media',
        id: editorUploadedMediaID,
        overrideAccess: true,
      })
    }

    for (const media of [
      unlinkedMedia,
      draftMedia,
      publishedMedia,
      mixedMedia,
      homeMedia,
      homeDraftMedia,
      projectCoverMedia,
      projectGalleryMedia,
      hubMedia,
      raceMedia,
    ]) {
      if (media?.id && !deletedMediaIDs.has(media.id)) {
        await payload.delete({
          collection: 'media',
          id: media.id,
          overrideAccess: true,
        })
      }
    }

    await payload.delete({
      collection: 'users',
      where: { email: { in: [adminEmail, editorEmail] } },
      overrideAccess: true,
    })
    if (fixtureDirectory) {
      await rm(fixtureDirectory, { force: true, recursive: true })
    }
  })

  test('visitor can read only media referenced by published content, including Home', async ({
    request,
  }) => {
    const login = await request.post(`${serverURL}/api/users/login`, {
      data: { email: editorEmail, password },
    })
    expect(login.status()).toBe(200)

    const editorUpload = await request.post(`${serverURL}/api/media`, {
      multipart: {
        _payload: JSON.stringify({ alt: 'Editor uploaded media' }),
        file: {
          name: 'editor-upload.png',
          mimeType: 'image/png',
          buffer: await readFile(uploadSource),
        },
      },
    })
    const editorUploadBody = await editorUpload.json()
    expect(editorUpload.status(), JSON.stringify(editorUploadBody)).toBe(201)
    editorUploadedMediaID = editorUploadBody.doc.id

    const editorRead = await request.get(`${serverURL}/api/media/${editorUploadedMediaID}`)
    expect(editorRead.status()).toBe(200)
    const editorUpdate = await request.patch(`${serverURL}/api/media/${editorUploadedMediaID}`, {
      data: { alt: 'Editor updated media' },
    })
    expect(editorUpdate.status()).toBe(200)

    const logout = await request.post(`${serverURL}/api/users/logout`)
    expect(logout.status()).toBe(200)

    for (const media of [unlinkedMedia, draftMedia, homeDraftMedia]) {
      const record = await request.get(`${serverURL}/api/media/${media.id}`)
      expect([403, 404]).toContain(record.status())

      for (const filename of [media.filename, media.sizes?.thumbnail?.filename]) {
        expect(filename).toBeTruthy()

        const apiFile = await request.get(`${serverURL}/api/media/file/${filename}`)
        expect(apiFile.status()).toBe(403)
        expect((await apiFile.body()).subarray(0, 8)).not.toEqual(pngSignature)

        const directFile = await request.get(`${serverURL}/media/${filename}`)
        expect(directFile.status()).not.toBe(200)
        const optimizedFile = await request.get(
          `${serverURL}/_next/image?url=${encodeURIComponent(`/api/media/file/${filename}`)}&w=640&q=75`,
        )
        expect(optimizedFile.status()).not.toBe(200)
      }
    }

    for (const media of [
      publishedMedia,
      mixedMedia,
      homeMedia,
      projectCoverMedia,
      projectGalleryMedia,
      hubMedia,
    ]) {
      const record = await request.get(`${serverURL}/api/media/${media.id}`)
      expect(record.status()).toBe(200)
      const mediaBody = await record.json()
      expect(mediaBody.id, JSON.stringify(mediaBody)).toBe(media.id)

      for (const filename of [media.filename, media.sizes?.thumbnail?.filename]) {
        expect(filename).toBeTruthy()
        const file = await request.get(`${serverURL}/api/media/file/${filename}`)
        expect(file.status()).toBe(200)
        expect((await file.body()).subarray(0, 8)).toEqual(pngSignature)

        const directFile = await request.get(`${serverURL}/media/${filename}`)
        expect(directFile.status()).not.toBe(200)

        const optimizedFile = await request.get(
          `${serverURL}/_next/image?url=${encodeURIComponent(`/api/media/file/${filename}`)}&w=640&q=75`,
        )
        expect(optimizedFile.status()).not.toBe(200)
      }
    }

    const graphQLPrivate = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `query { Media(id: ${draftMedia.id}) { id alt } }`,
      },
    })
    const privateBody = await graphQLPrivate.json()
    expect(privateBody.data?.Media).toBeFalsy()

    const graphQLPublished = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `query { Media(id: ${publishedMedia.id}) { id alt } }`,
      },
    })
    const publishedBody = await graphQLPublished.json()
    expect(publishedBody.errors).toBeUndefined()
    expect(Number(publishedBody.data.Media.id)).toBe(publishedMedia.id)

    const privateDraft = await request.get(
      `${serverURL}/api/news?where[slug][equals]=b4-draft-${suffix}`,
    )
    expect((await privateDraft.json()).docs).toHaveLength(0)
    const mixedPrivateDraft = await request.get(
      `${serverURL}/api/news?where[slug][equals]=b4-mixed-draft-${suffix}`,
    )
    expect((await mixedPrivateDraft.json()).docs).toHaveLength(0)
  })

  test('Home media is private when Home has no published version', async ({ request }) => {
    await payload.updateGlobal({
      slug: 'home',
      data: { _status: 'draft' },
      user: admin,
      overrideAccess: true,
      draft: false,
    })

    try {
      const homeRecord = await request.get(`${serverURL}/api/media/${homeMedia.id}`)
      expect([403, 404]).toContain(homeRecord.status())

      const homeFile = await request.get(`${serverURL}/api/media/file/${homeMedia.filename}`)
      expect(homeFile.status()).toBe(403)
    } finally {
      const restoredHome = await payload.updateGlobal({
        slug: 'home',
        data: homePublishedSnapshot,
        user: admin,
        overrideAccess: true,
        draft: false,
      })
      expect(restoredHome._status).toBe(homePublishedSnapshot._status)
    }

    await payload.updateGlobal({
      slug: 'home',
      data: { hero: { image: homeDraftMedia.id } },
      user: admin,
      overrideAccess: true,
      draft: true,
    })
  })

  test('concurrent media linking and deletion cannot leave a dangling reference', async () => {
    raceMedia = await createMedia('link-delete-race')
    const raceSlug = `b4-race-${suffix}`
    const pool = getPostgresPool()
    const connection = await pool.connect()
    let waiters = 0
    let results: PromiseSettledResult<unknown>[] = []
    let connectionReleased = false

    try {
      await connection.query('BEGIN')
      await connection.query('SELECT pg_advisory_xact_lock($1::integer, $2::integer)', [
        mediaReferenceLockNamespace,
        raceMedia.id,
      ])

      const operations: Promise<unknown>[] = [
        payload.create({
          collection: 'news',
          data: {
            title: raceSlug,
            slug: raceSlug,
            summary: 'Concurrent media link test.',
            category: 'update',
            author: admin.id,
            cover: raceMedia.id,
            _status: 'draft',
          },
          draft: true,
          overrideAccess: true,
        }),
        payload.delete({
          collection: 'media',
          id: raceMedia.id,
          overrideAccess: true,
        }),
      ]

      waiters = await waitForAdvisoryLockWaiters(pool, raceMedia.id, 2)

      await connection.query('ROLLBACK')
      connection.release()
      connectionReleased = true
      results = await Promise.allSettled(operations)
    } finally {
      if (!connectionReleased) {
        try {
          await connection.query('ROLLBACK')
        } finally {
          connection.release()
          connectionReleased = true
        }
      }
    }

    expect(waiters).toBe(2)
    const [createResult, deleteResult] = results

    const remainingMedia = await payload.find({
      collection: 'media',
      limit: 1,
      overrideAccess: true,
      where: { id: { equals: raceMedia.id } },
    })
    const linkedNews = await payload.find({
      collection: 'news',
      draft: true,
      limit: 1,
      overrideAccess: true,
      where: { cover: { equals: raceMedia.id } },
    })

    expect(createResult.status).not.toBe(deleteResult.status)
    if (remainingMedia.docs.length > 0) {
      expect(linkedNews.docs).toHaveLength(1)
      expect(deleteResult.status).toBe('rejected')
    } else {
      expect(linkedNews.docs).toHaveLength(0)
      expect(createResult.status).toBe('rejected')
      deletedMediaIDs.add(raceMedia.id)
    }
  })

  test('content deletion locks media references in published and draft versions', async () => {
    const createCases: Array<
      (publishedMediaID: number, draftMediaID: number) => Promise<() => Promise<unknown>>
    > = [
      async (publishedMediaID, draftMediaID) => {
        const slug = `b4-delete-news-${suffix}`
        const doc = await payload.create({
          collection: 'news',
          data: {
            title: slug,
            slug,
            summary: 'Published and draft media lock test.',
            category: 'update',
            author: admin.id,
            cover: publishedMediaID,
            _status: 'draft',
          },
          draft: true,
          overrideAccess: true,
        })
        await payload.update({
          collection: 'news',
          id: doc.id,
          data: { _status: 'published' },
          draft: true,
          overrideAccess: true,
        })
        await payload.update({
          collection: 'news',
          id: doc.id,
          data: { cover: draftMediaID },
          draft: true,
          overrideAccess: true,
        })
        return () =>
          payload.delete({
            collection: 'news',
            id: doc.id,
            overrideAccess: true,
          })
      },
      async (publishedMediaID, draftMediaID) => {
        const slug = `b4-delete-project-${suffix}`
        const doc = await payload.create({
          collection: 'projects',
          data: {
            title: slug,
            slug,
            summary: 'Published and draft media lock test.',
            author: admin.id,
            cover: publishedMediaID,
            _status: 'draft',
          },
          draft: true,
          overrideAccess: true,
        })
        await payload.update({
          collection: 'projects',
          id: doc.id,
          data: { _status: 'published' },
          draft: true,
          overrideAccess: true,
        })
        await payload.update({
          collection: 'projects',
          id: doc.id,
          data: { cover: draftMediaID },
          draft: true,
          overrideAccess: true,
        })
        return () =>
          payload.delete({
            collection: 'projects',
            id: doc.id,
            overrideAccess: true,
          })
      },
      async (publishedMediaID, draftMediaID) => {
        const slug = `b4-delete-hub-${suffix}`
        const doc = await payload.create({
          collection: 'hubs',
          data: {
            title: slug,
            slug,
            summary: 'Published and draft media lock test.',
            author: admin.id,
            image: publishedMediaID,
            _status: 'draft',
          },
          draft: true,
          overrideAccess: true,
        })
        await payload.update({
          collection: 'hubs',
          id: doc.id,
          data: { _status: 'published' },
          draft: true,
          overrideAccess: true,
        })
        await payload.update({
          collection: 'hubs',
          id: doc.id,
          data: { image: draftMediaID },
          draft: true,
          overrideAccess: true,
        })
        return () =>
          payload.delete({
            collection: 'hubs',
            id: doc.id,
            overrideAccess: true,
          })
      },
    ]

    for (const [index, createCase] of createCases.entries()) {
      const publishedReference = await createMedia(`delete-published-${index}`)
      const draftReference = await createMedia(`delete-draft-${index}`)
      const deleteContent = await createCase(publishedReference.id, draftReference.id)

      await deleteWhileMediaLockIsHeld(draftReference.id, deleteContent)

      await payload.delete({
        collection: 'media',
        id: publishedReference.id,
        overrideAccess: true,
      })
      await payload.delete({
        collection: 'media',
        id: draftReference.id,
        overrideAccess: true,
      })
      deletedMediaIDs.add(publishedReference.id)
      deletedMediaIDs.add(draftReference.id)
    }
  })

  test('protected deletions and media-record deletion enforce role and references', async ({
    request,
  }) => {
    const editorLogin = await request.post(`${serverURL}/api/users/login`, {
      data: { email: editorEmail, password },
    })
    expect(editorLogin.status()).toBe(200)
    const editorDelete = await request.delete(`${serverURL}/api/media/${unlinkedMedia.id}`)
    expect(editorDelete.status()).toBe(403)
    await request.post(`${serverURL}/api/users/logout`)

    const adminLogin = await request.post(`${serverURL}/api/users/login`, {
      data: { email: adminEmail, password },
    })
    expect(adminLogin.status()).toBe(200)

    const linkedDelete = await request.delete(`${serverURL}/api/media/${draftMedia.id}`)
    expect(linkedDelete.status()).toBe(403)
    const linkedHomeDraftDelete = await request.delete(
      `${serverURL}/api/media/${homeDraftMedia.id}`,
    )
    expect(linkedHomeDraftDelete.status()).toBe(403)

    await payload.delete({
      collection: 'news',
      id: publishedNewsID,
      overrideAccess: true,
    })
    await payload.delete({
      collection: 'news',
      id: mixedPublishedNewsID,
      overrideAccess: true,
    })

    await request.post(`${serverURL}/api/users/logout`)
    const mixedOriginal = await request.get(`${serverURL}/api/media/file/${mixedMedia.filename}`)
    expect(mixedOriginal.status()).toBe(403)
    for (const filename of [mixedMedia.filename, mixedMedia.sizes?.thumbnail?.filename]) {
      expect(filename).toBeTruthy()
      const directFile = await request.get(`${serverURL}/media/${filename}`)
      expect(directFile.status()).not.toBe(200)
      const optimizedFile = await request.get(
        `${serverURL}/_next/image?url=${encodeURIComponent(`/api/media/file/${filename}`)}&w=640&q=75`,
      )
      expect(optimizedFile.status()).not.toBe(200)
    }

    const adminRelogin = await request.post(`${serverURL}/api/users/login`, {
      data: { email: adminEmail, password },
    })
    expect(adminRelogin.status()).toBe(200)
    const stillLinkedDelete = await request.delete(`${serverURL}/api/media/${mixedMedia.id}`)
    expect(stillLinkedDelete.status()).toBe(403)

    await payload.delete({
      collection: 'news',
      id: draftNewsID,
      overrideAccess: true,
    })
    await payload.delete({
      collection: 'news',
      id: mixedDraftNewsID,
      overrideAccess: true,
    })

    await request.post(`${serverURL}/api/users/logout`)
    const lastPublishedFile = await request.get(
      `${serverURL}/api/media/file/${publishedMedia.filename}`,
    )
    expect(lastPublishedFile.status()).toBe(403)
    for (const filename of [
      publishedMedia.filename,
      publishedMedia.sizes?.thumbnail?.filename,
    ]) {
      expect(filename).toBeTruthy()
      const apiFile = await request.get(`${serverURL}/api/media/file/${filename}`)
      expect(apiFile.status()).toBe(403)
      const directFile = await request.get(`${serverURL}/media/${filename}`)
      expect(directFile.status()).not.toBe(200)
      const optimizedFile = await request.get(
        `${serverURL}/_next/image?url=${encodeURIComponent(`/api/media/file/${filename}`)}&w=640&q=75`,
      )
      expect(optimizedFile.status()).not.toBe(200)
    }

    const finalAdminLogin = await request.post(`${serverURL}/api/users/login`, {
      data: { email: adminEmail, password },
    })
    expect(finalAdminLogin.status()).toBe(200)
    const publishedRemoval = await request.delete(`${serverURL}/api/media/${publishedMedia.id}`)
    expect(publishedRemoval.status()).toBe(200)
    deletedMediaIDs.add(publishedMedia.id)

    const mixedRemoval = await request.delete(`${serverURL}/api/media/${mixedMedia.id}`)
    expect(mixedRemoval.status()).toBe(200)
    deletedMediaIDs.add(mixedMedia.id)

    const unlinkedRemoval = await request.delete(`${serverURL}/api/media/${unlinkedMedia.id}`)
    expect(unlinkedRemoval.status()).toBe(200)
    deletedMediaIDs.add(unlinkedMedia.id)

    for (const media of [projectCoverMedia, projectGalleryMedia, hubMedia, homeMedia]) {
      const linkedRemoval = await request.delete(`${serverURL}/api/media/${media.id}`)
      expect(linkedRemoval.status(), `unexpected deletion of linked media: ${media.alt}`).toBe(403)
      if (linkedRemoval.status() === 200) deletedMediaIDs.add(media.id)
    }

    await payload.update({
      collection: 'projects',
      id: projectID,
      data: { cover: null, gallery: [], _status: 'published' },
      draft: true,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'hubs',
      id: hubID,
      data: { image: null, _status: 'published' },
      draft: true,
      overrideAccess: true,
    })
    await payload.updateGlobal({
      slug: 'home',
      data: { hero: { image: null }, _status: 'published' },
      user: admin,
      overrideAccess: true,
      draft: false,
    })

    for (const media of [projectCoverMedia, projectGalleryMedia, hubMedia, homeMedia]) {
      const unlinkedRemoval = await request.delete(`${serverURL}/api/media/${media.id}`)
      expect(unlinkedRemoval.status()).toBe(200)
      deletedMediaIDs.add(media.id)
    }

    await payload.updateGlobal({
      slug: 'home',
      data: { hero: { image: null } },
      user: admin,
      overrideAccess: true,
      draft: true,
    })
    const homeDraftRemoval = await request.delete(`${serverURL}/api/media/${homeDraftMedia.id}`)
    expect(homeDraftRemoval.status()).toBe(200)
    deletedMediaIDs.add(homeDraftMedia.id)
  })
})
