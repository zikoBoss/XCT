import { getPayload, type Payload, type TypedUser } from 'payload'
import config from '@/payload.config'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('XCT core access control', () => {
  let payload: Payload
  let admin: TypedUser
  let editor: TypedUser
  let otherEditor: TypedUser
  let publishedNewsID: number

  const suffix = `${Date.now()}`
  const userEmails = [
    `b2-admin-${suffix}@example.test`,
    `b2-editor-${suffix}@example.test`,
    `b2-other-editor-${suffix}@example.test`,
  ]
  const publishedNewsSlug = `b2-published-${suffix}`
  const draftNewsSlug = `b2-draft-${suffix}`
  const draftProjectSlug = `b2-draft-project-${suffix}`
  const publishedProjectSlug = `b2-published-project-${suffix}`
  const draftHubSlug = `b2-draft-hub-${suffix}`
  const publishedHubSlug = `b2-published-hub-${suffix}`
  const editorNewsSlug = `b2-editor-news-${suffix}`
  const adminNewsSlug = `b2-admin-news-${suffix}`

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    admin = await payload.create({
      collection: 'users',
      data: { email: userEmails[0], password: 'test-password', role: 'admin' },
    })
    editor = await payload.create({
      collection: 'users',
      data: { email: userEmails[1], password: 'test-password', role: 'editor' },
    })
    otherEditor = await payload.create({
      collection: 'users',
      data: { email: userEmails[2], password: 'test-password', role: 'editor' },
    })

    const draftProject = await payload.create({
      collection: 'projects',
      data: {
        title: 'Private draft project',
        slug: draftProjectSlug,
        summary: 'This related draft must remain private.',
        author: admin.id,
        _status: 'draft',
      },
      draft: true,
      overrideAccess: true,
    })
    const publishedProject = await payload.create({
      collection: 'projects',
      data: {
        title: 'Public published project',
        slug: publishedProjectSlug,
        summary: 'Public project fixture.',
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
        title: 'Private draft hub',
        slug: draftHubSlug,
        summary: 'This related draft must remain private.',
        author: admin.id,
        _status: 'draft',
      },
      draft: true,
      overrideAccess: true,
    })
    const publishedHub = await payload.create({
      collection: 'hubs',
      data: {
        title: 'Public published hub',
        slug: publishedHubSlug,
        summary: 'Public hub fixture.',
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
        title: 'Public published news',
        slug: publishedNewsSlug,
        summary: 'Public content fixture.',
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
        title: 'Private draft news',
        slug: draftNewsSlug,
        summary: 'This draft must remain private.',
        category: 'update',
        author: admin.id,
        _status: 'draft',
      },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    if (!payload) return

    await payload.delete({
      collection: 'news',
      where: { slug: { in: [publishedNewsSlug, draftNewsSlug, editorNewsSlug, adminNewsSlug] } },
      overrideAccess: true,
    })
    await payload.delete({
      collection: 'projects',
      where: {
        slug: { in: [draftProjectSlug, publishedProjectSlug, `${editorNewsSlug}-project`] },
      },
      overrideAccess: true,
    })
    await payload.delete({
      collection: 'hubs',
      where: { slug: { in: [draftHubSlug, publishedHubSlug, `${editorNewsSlug}-hub`] } },
      overrideAccess: true,
    })
    await payload.delete({
      collection: 'users',
      where: { email: { in: userEmails } },
      overrideAccess: true,
    })
  })

  describe('visitor', () => {
    it('can read published content but cannot see drafts through records or relationships', async () => {
      const news = await payload.find({
        collection: 'news',
        where: { slug: { in: [publishedNewsSlug, draftNewsSlug] } },
        depth: 2,
        overrideAccess: false,
      })

      expect(news.docs.map(({ slug }) => slug)).toEqual([publishedNewsSlug])
      expect(JSON.stringify(news.docs)).not.toContain('Private draft project')
      expect(JSON.stringify(news.docs)).not.toContain('Private draft hub')

      const projects = await payload.find({
        collection: 'projects',
        where: { slug: { in: [draftProjectSlug, publishedProjectSlug] } },
        overrideAccess: false,
      })
      expect(projects.docs.map(({ slug }) => slug)).toEqual([publishedProjectSlug])

      const hubs = await payload.find({
        collection: 'hubs',
        where: { slug: { in: [draftHubSlug, publishedHubSlug] } },
        overrideAccess: false,
      })
      expect(hubs.docs.map(({ slug }) => slug)).toEqual([publishedHubSlug])
    })

    it('cannot create, update, or delete content', async () => {
      await expect(
        payload.create({
          collection: 'news',
          data: {
            title: 'Unauthenticated content',
            slug: `${publishedNewsSlug}-visitor`,
            summary: 'A visitor must not create content.',
            category: 'update',
            author: admin.id,
          },
          overrideAccess: false,
        }),
      ).rejects.toThrow()

      await expect(
        payload.update({
          collection: 'news',
          id: publishedNewsID,
          data: { summary: 'A visitor must not update content.' },
          overrideAccess: false,
        }),
      ).rejects.toThrow()

      await expect(
        payload.delete({
          collection: 'news',
          id: publishedNewsID,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })
  })

  describe('editor', () => {
    it('can read drafts and manage content without impersonating another author', async () => {
      const drafts = await payload.find({
        collection: 'news',
        where: { slug: { equals: draftNewsSlug } },
        user: editor,
        overrideAccess: false,
      })
      expect(drafts.docs).toHaveLength(1)

      const projectDrafts = await payload.find({
        collection: 'projects',
        where: { slug: { equals: draftProjectSlug } },
        user: editor,
        overrideAccess: false,
      })
      expect(projectDrafts.docs).toHaveLength(1)

      const hubDrafts = await payload.find({
        collection: 'hubs',
        where: { slug: { equals: draftHubSlug } },
        user: editor,
        overrideAccess: false,
      })
      expect(hubDrafts.docs).toHaveLength(1)

      const created = await payload.create({
        collection: 'news',
        data: {
          title: 'Editor-created content',
          slug: editorNewsSlug,
          summary: 'The server must set the author.',
          category: 'update',
          author: otherEditor.id,
        },
        user: editor,
        overrideAccess: false,
      })
      expect(created.author).toBe(editor.id)

      const updated = await payload.update({
        collection: 'news',
        id: created.id,
        data: {
          summary: 'The editor may update content.',
          author: otherEditor.id,
        },
        user: editor,
        overrideAccess: false,
      })
      expect(updated.author).toBe(editor.id)
      expect(updated.summary).toBe('The editor may update content.')

      await payload.delete({
        collection: 'news',
        id: created.id,
        user: editor,
        overrideAccess: false,
      })

      const editorProject = await payload.create({
        collection: 'projects',
        data: {
          title: 'Editor-created project',
          slug: `${editorNewsSlug}-project`,
          summary: 'The server must set the author.',
          author: otherEditor.id,
          _status: 'draft',
        },
        draft: true,
        user: editor,
        overrideAccess: false,
      })
      expect(editorProject.author).toBe(editor.id)
      const updatedProject = await payload.update({
        collection: 'projects',
        id: editorProject.id,
        data: { author: otherEditor.id, summary: 'Editor updated project.' },
        user: editor,
        overrideAccess: false,
      })
      expect(updatedProject.author).toBe(editor.id)
      await payload.delete({
        collection: 'projects',
        id: editorProject.id,
        user: editor,
        overrideAccess: false,
      })

      const editorHub = await payload.create({
        collection: 'hubs',
        data: {
          title: 'Editor-created hub',
          slug: `${editorNewsSlug}-hub`,
          summary: 'The server must set the author.',
          author: otherEditor.id,
          _status: 'draft',
        },
        draft: true,
        user: editor,
        overrideAccess: false,
      })
      expect(editorHub.author).toBe(editor.id)
      const updatedHub = await payload.update({
        collection: 'hubs',
        id: editorHub.id,
        data: { author: otherEditor.id, summary: 'Editor updated hub.' },
        user: editor,
        overrideAccess: false,
      })
      expect(updatedHub.author).toBe(editor.id)
      await payload.delete({
        collection: 'hubs',
        id: editorHub.id,
        user: editor,
        overrideAccess: false,
      })
    })

    it('cannot read or manage Users or change its own role', async () => {
      await expect(
        payload.find({
          collection: 'users',
          user: editor,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
      await expect(
        payload.create({
          collection: 'users',
          data: {
            email: `b2-escalation-${suffix}@example.test`,
            password: 'test-password',
            role: 'admin',
          },
          user: editor,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
      await expect(
        payload.update({
          collection: 'users',
          id: editor.id,
          data: { role: 'admin' },
          user: editor,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
      await expect(
        payload.delete({
          collection: 'users',
          id: editor.id,
          user: editor,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })
  })

  describe('admin', () => {
    it('can manage users and editorial content', async () => {
      const users = await payload.find({
        collection: 'users',
        where: { email: { equals: userEmails[1] } },
        user: admin,
        overrideAccess: false,
      })
      expect(users.docs).toHaveLength(1)

      const managedUser = await payload.create({
        collection: 'users',
        data: {
          email: `b2-managed-${suffix}@example.test`,
          password: 'test-password',
          role: 'editor',
        },
        user: admin,
        overrideAccess: false,
      })
      await payload.update({
        collection: 'users',
        id: managedUser.id,
        data: { role: 'admin' },
        user: admin,
        overrideAccess: false,
      })
      await payload.delete({
        collection: 'users',
        id: managedUser.id,
        user: admin,
        overrideAccess: false,
      })

      const managedNews = await payload.create({
        collection: 'news',
        data: {
          title: 'Admin-created content',
          slug: adminNewsSlug,
          summary: 'The admin manages content.',
          category: 'update',
          author: admin.id,
        },
        user: admin,
        overrideAccess: false,
      })
      await payload.update({
        collection: 'news',
        id: managedNews.id,
        data: { summary: 'The admin updated content.' },
        user: admin,
        overrideAccess: false,
      })
      await payload.delete({
        collection: 'news',
        id: managedNews.id,
        user: admin,
        overrideAccess: false,
      })
    })
  })
})
