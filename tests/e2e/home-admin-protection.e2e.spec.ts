import { expect, test } from '@playwright/test'
import { getPayload, type Payload, type TypedUser } from 'payload'
import config from '../../src/payload.config.js'

const serverURL = 'http://localhost:3000'
const suffix = `${Date.now()}`
const password = 'test-password'
const adminEmail = `b3-e2e-admin-${suffix}@example.test`
const editorEmail = `b3-e2e-editor-${suffix}@example.test`

let payload: Payload
let admin: TypedUser
let editor: TypedUser
let baselineAdmins: TypedUser[] = []

test.describe.serial('Home and last-admin protection', () => {
  test.beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const existingAdmins = await payload.find({
      collection: 'users',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      where: {
        and: [{ role: { equals: 'admin' } }, { isActive: { equals: true } }],
      },
    })
    baselineAdmins = existingAdmins.docs as TypedUser[]

    admin = await payload.create({
      collection: 'users',
      data: { email: adminEmail, password, role: 'admin', isActive: true },
      overrideAccess: true,
    })

    for (const existingAdmin of baselineAdmins) {
      await payload.update({
        collection: 'users',
        id: existingAdmin.id,
        data: { role: 'editor' },
        overrideAccess: true,
      })
    }

    editor = await payload.create({
      collection: 'users',
      data: { email: editorEmail, password, role: 'editor', isActive: true },
      overrideAccess: true,
    })
  })

  test.afterAll(async () => {
    if (!payload) return

    for (const existingAdmin of baselineAdmins) {
      await payload.update({
        collection: 'users',
        id: existingAdmin.id,
        data: { role: 'admin', isActive: true },
        overrideAccess: true,
      })
    }

    const currentAdmins = await payload.find({
      collection: 'users',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      where: {
        and: [{ role: { equals: 'admin' } }, { isActive: { equals: true } }],
      },
    })

    if (currentAdmins.docs.length > 1) {
      await payload.delete({
        collection: 'users',
        id: admin.id,
        overrideAccess: true,
      })
    }

    await payload.delete({
      collection: 'users',
      where: { email: { equals: editorEmail } },
      overrideAccess: true,
    })
  })

  test('editor can save Home drafts but cannot alter protected fields or publish via REST/GraphQL', async ({
    request,
  }) => {
    const anonymousDraft = await request.get(`${serverURL}/api/globals/home?draft=true`)
    expect(anonymousDraft.status()).toBe(403)

    const login = await request.post(`${serverURL}/api/users/login`, {
      data: { email: editorEmail, password },
    })
    expect(login.status()).toBe(200)

    const restUpdate = await request.post(`${serverURL}/api/globals/home?draft=true`, {
      data: {
        hero: { title: 'Editor Home', summary: 'Updated editorial content.' },
        sectionOrder: [{ section: 'projects' }, { section: 'news' }],
        quickLinks: [{ label: 'Projects', url: '/projects' }],
      },
    })
    const restBody = await restUpdate.json()
    expect(restUpdate.status(), JSON.stringify(restBody)).toBe(200)
    expect(restBody.result.hero.title).toBe('Editor Home')

    for (const forbiddenData of [
      { seo: { title: 'Editor SEO attempt' } },
      { displaySettings: { layout: 'compact' } },
      { _status: 'published' },
    ]) {
      const forbidden = await request.post(`${serverURL}/api/globals/home?draft=true`, {
        data: forbiddenData,
      })
      expect(forbidden.status()).toBe(403)
    }

    const publishAttempt = await request.post(`${serverURL}/api/globals/home`, {
      data: { hero: { title: 'Published by editor', summary: 'Denied.' } },
    })
    expect(publishAttempt.status()).toBe(403)

    const graphQLUpdate = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `mutation { updateHome(data: { hero: { title: "GraphQL editor", summary: "Draft" }, sectionOrder: [{ section: projects }] }, draft: true) { hero { title } } }`,
      },
    })
    const graphQLBody = await graphQLUpdate.json()
    expect(graphQLBody.errors).toBeUndefined()
    expect(graphQLBody.data.updateHome.hero.title).toBe('GraphQL editor')

    const graphQLProtectedUpdate = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `mutation { updateHome(data: { hero: { title: "Protected test", summary: "Attempt" }, seo: { title: "GraphQL SEO attempt" } }, draft: true) { seo { title } } }`,
      },
    })
    const protectedBody = await graphQLProtectedUpdate.json()
    expect(protectedBody.errors?.[0]?.extensions?.statusCode, JSON.stringify(protectedBody)).toBe(403)

    const graphQLPublishAttempt = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `mutation { updateHome(data: { hero: { title: "Publish attempt", summary: "Denied" }, _status: published }) { hero { title } } }`,
      },
    })
    const publishBody = await graphQLPublishAttempt.json()
    expect(publishBody.errors?.[0]?.extensions?.statusCode).toBe(403)
  })

  test('admin can update protected Home fields and last-admin changes fail through REST and GraphQL', async ({
    request,
  }) => {
    const login = await request.post(`${serverURL}/api/users/login`, {
      data: { email: adminEmail, password },
    })
    expect(login.status()).toBe(200)

    const restUpdate = await request.post(`${serverURL}/api/globals/home`, {
      data: {
        hero: { title: 'Admin Home', summary: 'Administrator update.' },
        seo: { title: 'Admin SEO', description: 'Managed by admin.' },
        displaySettings: { layout: 'compact', showNews: false },
        _status: 'published',
      },
    })
    expect(restUpdate.status()).toBe(200)
    const restBody = await restUpdate.json()
    expect(restBody.result.seo.title).toBe('Admin SEO')
    expect(restBody.result.displaySettings.layout).toBe('compact')
    expect(restBody.result._status).toBe('published')

    const graphQLUpdate = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `mutation { updateHome(data: { hero: { title: "GraphQL Admin", summary: "Administrator" }, seo: { title: "GraphQL Admin SEO" }, displaySettings: { layout: standard } }) { seo { title } displaySettings { layout } } }`,
      },
    })
    const graphQLBody = await graphQLUpdate.json()
    expect(graphQLBody.errors).toBeUndefined()
    expect(graphQLBody.data.updateHome.seo.title).toBe('GraphQL Admin SEO')

    const deactivateLastAdmin = await request.patch(`${serverURL}/api/users/${admin.id}`, {
      data: { isActive: false },
    })
    expect(deactivateLastAdmin.status()).toBe(403)

    const deleteLastAdmin = await request.delete(`${serverURL}/api/users/${admin.id}`)
    expect(deleteLastAdmin.status()).toBe(403)

    const graphQLDemoteLastAdmin = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `mutation { updateUser(id: ${admin.id}, data: { role: editor }) { id } }`,
      },
    })
    expect((await graphQLDemoteLastAdmin.json()).errors?.[0]?.extensions?.statusCode).toBe(403)

    const otherAdmin = await payload.create({
      collection: 'users',
      data: {
        email: `b3-e2e-second-admin-${suffix}@example.test`,
        password,
        role: 'admin',
        isActive: true,
      },
      overrideAccess: true,
    })
    const allowedDemotion = await request.patch(`${serverURL}/api/users/${admin.id}`, {
      data: { role: 'editor' },
    })
    expect(allowedDemotion.status()).toBe(200)
    await payload.update({
      collection: 'users',
      id: admin.id,
      data: { role: 'admin' },
      overrideAccess: true,
    })
    await payload.delete({
      collection: 'users',
      id: otherAdmin.id,
      overrideAccess: true,
    })
  })
})
