import { expect, test } from '@playwright/test'
import { getPayload, type Payload, type TypedUser } from 'payload'
import config from '../../src/payload.config.js'

const serverURL = 'http://localhost:3000'
const suffix = `${Date.now()}`
const password = 'test-password'
const publishedSlug = `b2-e2e-published-${suffix}`
const draftSlug = `b2-e2e-draft-${suffix}`
const draftProjectSlug = `b2-e2e-draft-project-${suffix}`
const publishedProjectSlug = `b2-e2e-published-project-${suffix}`
const draftHubSlug = `b2-e2e-draft-hub-${suffix}`
const publishedHubSlug = `b2-e2e-published-hub-${suffix}`
const editorRestSlug = `b2-e2e-editor-rest-${suffix}`
const editorGraphQLSlug = `b2-e2e-editor-graphql-${suffix}`
const editorProjectSlug = `b2-e2e-editor-project-${suffix}`
const editorHubSlug = `b2-e2e-editor-hub-${suffix}`
const adminNewsSlug = `b2-e2e-admin-${suffix}`
const adminManagedEmail = `b2-e2e-managed-${suffix}@example.test`
const userEmails = [
  `b2-e2e-admin-${suffix}@example.test`,
  `b2-e2e-editor-${suffix}@example.test`,
  `b2-e2e-other-editor-${suffix}@example.test`,
  adminManagedEmail,
]

let payload: Payload
let admin: TypedUser
let editor: TypedUser
let otherEditor: TypedUser
let publishedNewsID: number

test.describe.serial('REST and GraphQL access control', () => {
  test.beforeAll(async () => {
    payload = await getPayload({ config: await config })
    admin = await payload.create({
      collection: 'users',
      data: { email: userEmails[0], password, role: 'admin' },
    })
    editor = await payload.create({
      collection: 'users',
      data: { email: userEmails[1], password, role: 'editor' },
    })
    otherEditor = await payload.create({
      collection: 'users',
      data: { email: userEmails[2], password, role: 'editor' },
    })

    const draftProject = await payload.create({
      collection: 'projects',
      data: {
        title: 'Private relationship draft',
        slug: draftProjectSlug,
        summary: 'This project must not be disclosed to visitors.',
        author: admin.id,
        _status: 'draft',
      },
      draft: true,
      overrideAccess: true,
    })
    const publishedProject = await payload.create({
      collection: 'projects',
      data: {
        title: 'Public B2 project fixture',
        slug: publishedProjectSlug,
        summary: 'Published project for API tests.',
        author: admin.id,
      },
      draft: true,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'projects',
      id: publishedProject.id,
      data: { _status: 'published' },
      draft: true,
      overrideAccess: true,
    })
    const draftHub = await payload.create({
      collection: 'hubs',
      data: {
        title: 'Private relationship hub draft',
        slug: draftHubSlug,
        summary: 'This hub must not be disclosed to visitors.',
        author: admin.id,
        _status: 'draft',
      },
      draft: true,
      overrideAccess: true,
    })
    const publishedHub = await payload.create({
      collection: 'hubs',
      data: {
        title: 'Public B2 hub fixture',
        slug: publishedHubSlug,
        summary: 'Published hub for API tests.',
        author: admin.id,
      },
      draft: true,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'hubs',
      id: publishedHub.id,
      data: { _status: 'published' },
      draft: true,
      overrideAccess: true,
    })

    const publishedNews = await payload.create({
      collection: 'news',
      data: {
        title: 'Public B2 published fixture',
        slug: publishedSlug,
        summary: 'Published content for API tests.',
        category: 'update',
        author: admin.id,
        relatedProjects: [draftProject.id],
        relatedHubs: [draftHub.id],
        _status: 'published',
      },
      overrideAccess: true,
    })
    publishedNewsID = publishedNews.id

    await payload.create({
      collection: 'news',
      data: {
        title: 'Private B2 draft fixture',
        slug: draftSlug,
        summary: 'Draft content for API tests.',
        category: 'update',
        author: admin.id,
        _status: 'draft',
      },
      overrideAccess: true,
    })
  })

  test.afterAll(async () => {
    if (!payload) return

    await payload.delete({
      collection: 'news',
      where: {
        slug: {
          in: [publishedSlug, draftSlug, editorRestSlug, editorGraphQLSlug, adminNewsSlug],
        },
      },
      overrideAccess: true,
    })
    await payload.delete({
      collection: 'projects',
      where: { slug: { in: [draftProjectSlug, publishedProjectSlug, editorProjectSlug] } },
      overrideAccess: true,
    })
    await payload.delete({
      collection: 'hubs',
      where: { slug: { in: [draftHubSlug, publishedHubSlug, editorHubSlug] } },
      overrideAccess: true,
    })
    await payload.delete({
      collection: 'users',
      where: { email: { in: userEmails } },
      overrideAccess: true,
    })
  })

  test('visitor can read published content only and cannot write through REST or GraphQL', async ({
    request,
  }) => {
    const usersResponse = await request.get(`${serverURL}/api/users?limit=1`)
    expect(usersResponse.status()).toBe(403)

    const publishedResponse = await request.get(
      `${serverURL}/api/news?draft=true&depth=2&where%5Bslug%5D%5Bequals%5D=${publishedSlug}`,
    )
    expect(publishedResponse.status()).toBe(200)
    const publishedBody = await publishedResponse.json()
    expect(publishedBody.docs).toHaveLength(1)
    expect(JSON.stringify(publishedBody.docs)).not.toContain('Private relationship draft')

    const draftResponse = await request.get(
      `${serverURL}/api/news?draft=true&where%5Bslug%5D%5Bequals%5D=${draftSlug}`,
    )
    expect(draftResponse.status()).toBe(200)
    expect((await draftResponse.json()).docs).toHaveLength(0)

    for (const [collection, publishedContentSlug, draftContentSlug] of [
      ['projects', publishedProjectSlug, draftProjectSlug],
      ['hubs', publishedHubSlug, draftHubSlug],
    ]) {
      const publishedContent = await request.get(
        `${serverURL}/api/${collection}?draft=true&where%5Bslug%5D%5Bequals%5D=${publishedContentSlug}`,
      )
      expect((await publishedContent.json()).docs).toHaveLength(1)

      const draftContent = await request.get(
        `${serverURL}/api/${collection}?draft=true&where%5Bslug%5D%5Bequals%5D=${draftContentSlug}`,
      )
      expect((await draftContent.json()).docs).toHaveLength(0)
    }

    const createResponse = await request.post(`${serverURL}/api/news`, {
      data: {
        title: 'Visitor-created content',
        slug: `b2-e2e-visitor-${suffix}`,
        summary: 'This request must be denied.',
        category: 'update',
        author: admin.id,
      },
    })
    expect(createResponse.status()).toBe(403)

    for (const [method, response] of [
      [
        'PATCH',
        await request.patch(`${serverURL}/api/news/${publishedNewsID}`, {
          data: { summary: 'Visitor update attempt.' },
        }),
      ],
      ['DELETE', await request.delete(`${serverURL}/api/news/${publishedNewsID}`)],
    ] as const) {
      expect(response.status(), `${method} must be denied`).toBe(403)
    }

    const graphqlRead = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `query { allNews { docs { title } } Projects { docs { title } } Hubs { docs { title } } }`,
      },
    })
    expect(graphqlRead.status()).toBe(200)
    const graphqlReadBody = await graphqlRead.json()
    expect(graphqlReadBody.errors).toBeUndefined()
    const visibleTitles = graphqlReadBody.data.allNews.docs.map(
      ({ title }: { title: string }) => title,
    )
    expect(visibleTitles).toContain('Public B2 published fixture')
    expect(visibleTitles).not.toContain('Private B2 draft fixture')
    const visibleProjectTitles = graphqlReadBody.data.Projects.docs.map(
      ({ title }: { title: string }) => title,
    )
    expect(visibleProjectTitles).toContain('Public B2 project fixture')
    expect(visibleProjectTitles).not.toContain('Private relationship draft')
    const visibleHubTitles = graphqlReadBody.data.Hubs.docs.map(
      ({ title }: { title: string }) => title,
    )
    expect(visibleHubTitles).toContain('Public B2 hub fixture')
    expect(visibleHubTitles).not.toContain('Private relationship hub draft')

    const graphqlRelatedRead = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `query { allNews(where: { slug: { equals: "${publishedSlug}" } }) { docs { title relatedProjects { id title } relatedHubs { id title } } } }`,
      },
    })
    const graphqlRelatedBody = await graphqlRelatedRead.json()
    expect(graphqlRelatedBody.errors).toBeUndefined()
    expect(JSON.stringify(graphqlRelatedBody.data)).not.toContain('Private relationship draft')
    expect(JSON.stringify(graphqlRelatedBody.data)).not.toContain('Private relationship hub draft')

    const graphqlWrite = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `mutation { createNews(data: { title: "Visitor GraphQL content", slug: "b2-e2e-visitor-graphql-${suffix}", summary: "Denied", category: update, author: ${admin.id} }) { id } }`,
      },
    })
    expect((await graphqlWrite.json()).errors[0].extensions.statusCode).toBe(403)

    const graphqlUpdate = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `mutation { updateNews(id: ${publishedNewsID}, data: { summary: "Visitor update attempt." }) { id } }`,
      },
    })
    expect((await graphqlUpdate.json()).errors[0].extensions.statusCode).toBe(403)

    const graphqlDelete = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `mutation { deleteNews(id: ${publishedNewsID}) { id } }`,
      },
    })
    expect((await graphqlDelete.json()).errors[0].extensions.statusCode).toBe(403)
  })

  test('editor manages content but cannot manage Users or impersonate an author', async ({
    request,
  }) => {
    const login = await request.post(`${serverURL}/api/users/login`, {
      data: { email: userEmails[1], password },
    })
    expect(login.status()).toBe(200)

    const draftResponse = await request.get(
      `${serverURL}/api/news?draft=true&where%5Bslug%5D%5Bequals%5D=${draftSlug}`,
    )
    expect((await draftResponse.json()).docs).toHaveLength(1)

    for (const [collection, draftContentSlug] of [
      ['projects', draftProjectSlug],
      ['hubs', draftHubSlug],
    ]) {
      const draftContent = await request.get(
        `${serverURL}/api/${collection}?draft=true&where%5Bslug%5D%5Bequals%5D=${draftContentSlug}`,
      )
      expect((await draftContent.json()).docs).toHaveLength(1)
    }

    const createResponse = await request.post(`${serverURL}/api/news`, {
      data: {
        title: 'Editor REST content',
        slug: editorRestSlug,
        summary: 'The server must set the author.',
        category: 'update',
        author: otherEditor.id,
        _status: 'draft',
      },
    })
    expect(createResponse.status()).toBe(201)
    const created = (await createResponse.json()).doc
    expect(created.author).toBe(editor.id)

    const updateResponse = await request.patch(`${serverURL}/api/news/${created.id}`, {
      data: {
        summary: 'Editor updated content.',
        author: otherEditor.id,
      },
    })
    expect(updateResponse.status()).toBe(200)
    expect((await updateResponse.json()).doc.author).toBe(editor.id)

    const graphqlCreate = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `mutation { createNews(data: { title: "Editor GraphQL content", slug: "${editorGraphQLSlug}", summary: "The server must set the author.", category: update, author: ${otherEditor.id} }) { id } }`,
      },
    })
    expect(graphqlCreate.status()).toBe(200)
    const graphqlCreateBody = await graphqlCreate.json()
    expect(graphqlCreateBody.errors).toBeUndefined()
    const graphqlNewsID = graphqlCreateBody.data.createNews.id

    const graphqlNews = await request.get(
      `${serverURL}/api/news?draft=true&where%5Bslug%5D%5Bequals%5D=${editorGraphQLSlug}`,
    )
    expect((await graphqlNews.json()).docs[0].author).toBe(editor.id)

    const graphqlAuthorUpdate = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `mutation { updateNews(id: ${graphqlNewsID}, data: { author: ${otherEditor.id} }) { id } }`,
      },
    })
    expect((await graphqlAuthorUpdate.json()).errors).toBeUndefined()
    const afterGraphQLAuthorUpdate = await request.get(
      `${serverURL}/api/news?draft=true&where%5Bslug%5D%5Bequals%5D=${editorGraphQLSlug}`,
    )
    expect((await afterGraphQLAuthorUpdate.json()).docs[0].author).toBe(editor.id)

    const createProject = await request.post(`${serverURL}/api/projects`, {
      data: {
        title: 'Editor REST project',
        slug: editorProjectSlug,
        summary: 'The server must set the author.',
        author: otherEditor.id,
        _status: 'draft',
      },
    })
    expect(createProject.status()).toBe(201)
    const projectDoc = (await createProject.json()).doc
    expect(projectDoc.author).toBe(editor.id)
    const updateProject = await request.patch(`${serverURL}/api/projects/${projectDoc.id}`, {
      data: { author: otherEditor.id },
    })
    expect((await updateProject.json()).doc.author).toBe(editor.id)

    const createHub = await request.post(`${serverURL}/api/hubs`, {
      data: {
        title: 'Editor REST hub',
        slug: editorHubSlug,
        summary: 'The server must set the author.',
        author: otherEditor.id,
        _status: 'draft',
      },
    })
    expect(createHub.status()).toBe(201)
    const hubDoc = (await createHub.json()).doc
    expect(hubDoc.author).toBe(editor.id)
    const updateHub = await request.patch(`${serverURL}/api/hubs/${hubDoc.id}`, {
      data: { author: otherEditor.id },
    })
    expect((await updateHub.json()).doc.author).toBe(editor.id)

    expect((await request.delete(`${serverURL}/api/news/${created.id}`)).status()).toBe(200)
    expect((await request.delete(`${serverURL}/api/news/${graphqlNewsID}`)).status()).toBe(200)
    expect((await request.delete(`${serverURL}/api/projects/${projectDoc.id}`)).status()).toBe(200)
    expect((await request.delete(`${serverURL}/api/hubs/${hubDoc.id}`)).status()).toBe(200)

    expect((await request.get(`${serverURL}/api/users?limit=1`)).status()).toBe(403)
    expect(
      (
        await request.post(`${serverURL}/api/users`, {
          data: {
            email: `b2-e2e-escalation-${suffix}@example.test`,
            password,
            role: 'admin',
          },
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await request.patch(`${serverURL}/api/users/${editor.id}`, { data: { role: 'admin' } })
      ).status(),
    ).toBe(403)

    const graphqlRoleUpdate = await request.post(`${serverURL}/api/graphql`, {
      data: {
        query: `mutation { updateUser(id: ${editor.id}, data: { role: admin }) { id } }`,
      },
    })
    expect((await graphqlRoleUpdate.json()).errors[0].extensions.statusCode).toBe(403)
  })

  test('admin can manage content and user roles through REST', async ({ request }) => {
    const login = await request.post(`${serverURL}/api/users/login`, {
      data: { email: userEmails[0], password },
    })
    expect(login.status()).toBe(200)

    const createNews = await request.post(`${serverURL}/api/news`, {
      data: {
        title: 'Admin REST content',
        slug: adminNewsSlug,
        summary: 'Admin content management.',
        category: 'update',
        author: admin.id,
        _status: 'draft',
      },
    })
    expect(createNews.status()).toBe(201)
    const newsID = (await createNews.json()).doc.id
    expect(
      (
        await request.get(
          `${serverURL}/api/news?draft=true&where%5Bslug%5D%5Bequals%5D=${adminNewsSlug}`,
        )
      ).status(),
    ).toBe(200)
    expect(
      (
        await request.patch(`${serverURL}/api/news/${newsID}`, {
          data: { summary: 'Updated by admin.' },
        })
      ).status(),
    ).toBe(200)
    expect((await request.delete(`${serverURL}/api/news/${newsID}`)).status()).toBe(200)

    expect((await request.get(`${serverURL}/api/users?limit=1`)).status()).toBe(200)
    const createUser = await request.post(`${serverURL}/api/users`, {
      data: { email: adminManagedEmail, password, role: 'editor' },
    })
    expect(createUser.status()).toBe(201)
    const userID = (await createUser.json()).doc.id
    expect(
      (
        await request.patch(`${serverURL}/api/users/${userID}`, { data: { role: 'admin' } })
      ).status(),
    ).toBe(200)
    expect((await request.delete(`${serverURL}/api/users/${userID}`)).status()).toBe(200)
  })
})
