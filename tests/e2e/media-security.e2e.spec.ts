import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { getPayload, type Payload, type TypedUser } from 'payload'
import type { Home, Media } from '../../src/payload-types.js'
import config from '../../src/payload.config.js'

const serverURL = 'http://localhost:3000'
const suffix = `${Date.now()}`
const password = 'media-test-password'
const adminEmail = `b4-admin-${suffix}@example.test`
const editorEmail = `b4-editor-${suffix}@example.test`

let payload: Payload
let admin: TypedUser
let homeSnapshot: Home
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
    mixedPublishedNewsID = await createNews(
      `b4-mixed-published-${suffix}`,
      mixedMedia.id,
      false,
    )
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

    await payload.updateGlobal({
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

      const original = await request.get(`${serverURL}/api/media/file/${media.filename}`)
      expect(original.status()).toBe(403)
      expect((await original.body()).subarray(0, 8)).not.toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      )

      const thumbnail = media.sizes?.thumbnail?.filename
      expect(thumbnail).toBeTruthy()
      const thumbnailResponse = await request.get(`${serverURL}/api/media/file/${thumbnail}`)
      expect(thumbnailResponse.status()).toBe(403)
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
        expect((await file.body()).subarray(0, 8)).toEqual(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        )
      }

      const directFile = await request.get(`${serverURL}/media/${media.filename}`)
      expect(directFile.status()).not.toBe(200)
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
    const mixedOriginal = await request.get(
      `${serverURL}/api/media/file/${mixedMedia.filename}`,
    )
    expect(mixedOriginal.status()).toBe(403)

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
  })
})
