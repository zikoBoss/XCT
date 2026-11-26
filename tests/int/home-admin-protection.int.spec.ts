import { getPayload, type Payload, type TypedUser } from 'payload'
import config from '@/payload.config'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('XCT Home and last-admin protection', () => {
  let payload: Payload
  let admin: TypedUser
  let editor: TypedUser
  let secondAdmin: TypedUser
  let baselineAdmins: TypedUser[] = []

  const suffix = `${Date.now()}`
  const adminEmail = `b3-admin-${suffix}@example.test`
  const editorEmail = `b3-editor-${suffix}@example.test`
  const secondAdminEmail = `b3-second-admin-${suffix}@example.test`

  beforeAll(async () => {
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
      data: { email: adminEmail, password: 'test-password', role: 'admin', isActive: true },
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
      data: { email: editorEmail, password: 'test-password', role: 'editor', isActive: true },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
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
      where: { email: { in: [editorEmail, secondAdminEmail] } },
      overrideAccess: true,
    })
  })

  it('lets editors change editorial Home fields but rejects protected fields and publishing', async () => {
    const updated = await payload.updateGlobal({
      slug: 'home',
      data: {
        hero: { title: 'XCT home', summary: 'Editorial summary' },
        featuredNews: [],
        featuredProjects: [],
        featuredHubs: [],
        quickLinks: [{ label: 'Projects', url: '/projects' }],
        sectionOrder: [{ section: 'projects' }, { section: 'news' }],
      },
      draft: true,
      user: editor,
      overrideAccess: false,
    })

    expect(updated.hero.title).toBe('XCT home')
    expect(updated.sectionOrder?.map(({ section }) => section)).toEqual(['projects', 'news'])

    await expect(
      payload.updateGlobal({
        slug: 'home',
        data: { seo: { title: 'Editor cannot set SEO' } },
        draft: true,
        user: editor,
        overrideAccess: false,
      }),
    ).rejects.toThrow()

    await expect(
      payload.updateGlobal({
        slug: 'home',
        data: { displaySettings: { layout: 'compact' } },
        draft: true,
        user: editor,
        overrideAccess: false,
      }),
    ).rejects.toThrow()

    await expect(
      payload.updateGlobal({
        slug: 'home',
        data: { _status: 'published' },
        draft: true,
        user: editor,
        overrideAccess: false,
      }),
    ).rejects.toThrow()

    await expect(
      payload.updateGlobal({
        slug: 'home',
        data: { hero: { title: 'Direct publish attempt', summary: 'Denied' } },
        user: editor,
        overrideAccess: false,
      }),
    ).rejects.toThrow()

    await expect(
      payload.findGlobal({
        slug: 'home',
        draft: true,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })

  it('lets admins edit protected Home fields and publish', async () => {
    const updated = await payload.updateGlobal({
      slug: 'home',
      data: {
        hero: { title: 'Admin home', summary: 'Admin summary' },
        seo: { title: 'XCT SEO', description: 'Metadata for XCT' },
        displaySettings: { layout: 'compact', showNews: false },
        _status: 'published',
      },
      user: admin,
      overrideAccess: false,
    })

    expect(updated.seo?.title).toBe('XCT SEO')
    expect(updated.displaySettings?.layout).toBe('compact')
    expect(updated._status).toBe('published')

    const publicHome = await payload.findGlobal({
      slug: 'home',
      overrideAccess: false,
    })
    expect(publicHome._status).toBe('published')
  })

  it('blocks last-admin deletion, deactivation, and role downgrade, including self-demotion', async () => {
    await expect(
      payload.delete({
        collection: 'users',
        id: admin.id,
        user: admin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()

    await expect(
      payload.update({
        collection: 'users',
        id: admin.id,
        data: { isActive: false },
        user: admin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()

    await expect(
      payload.update({
        collection: 'users',
        id: admin.id,
        data: { role: 'editor' },
        user: admin,
        overrideAccess: false,
      }),
    ).rejects.toThrow()

  })

  it('allows removal of an admin while another valid admin remains', async () => {
    secondAdmin = await payload.create({
      collection: 'users',
      data: {
        email: secondAdminEmail,
        password: 'test-password',
        role: 'admin',
        isActive: true,
      },
      overrideAccess: true,
    })

    const downgraded = await payload.update({
      collection: 'users',
      id: admin.id,
      data: { role: 'editor' },
      user: secondAdmin,
      overrideAccess: false,
    })
    expect(downgraded.role).toBe('editor')

    await payload.update({
      collection: 'users',
      id: admin.id,
      data: { role: 'admin' },
      user: secondAdmin,
      overrideAccess: false,
    })

    const disabled = await payload.update({
      collection: 'users',
      id: secondAdmin.id,
      data: { isActive: false },
      user: admin,
      overrideAccess: false,
    })
    expect(disabled.isActive).toBe(false)

    await expect(
      payload.login({
        collection: 'users',
        data: { email: secondAdminEmail, password: 'test-password' },
      }),
    ).rejects.toThrow()

    await payload.update({
      collection: 'users',
      id: secondAdmin.id,
      data: { isActive: true },
      user: admin,
      overrideAccess: false,
    })

    await payload.delete({
      collection: 'users',
      id: secondAdmin.id,
      user: admin,
      overrideAccess: false,
    })
  })

  it('serializes concurrent admin removals with a PostgreSQL transaction advisory lock', async () => {
    const concurrentAdmin = await payload.create({
      collection: 'users',
      data: {
        email: `b3-concurrent-${suffix}@example.test`,
        password: 'test-password',
        role: 'admin',
        isActive: true,
      },
      overrideAccess: true,
    })

    const allOtherAdmins = await payload.find({
      collection: 'users',
      depth: 0,
      limit: 100,
      overrideAccess: true,
      where: {
        and: [{ role: { equals: 'admin' } }, { isActive: { equals: true } }],
      },
    })

    const baselineToRestore = allOtherAdmins.docs.filter(
      ({ id }) => id !== admin.id && id !== concurrentAdmin.id,
    )
    for (const existingAdmin of baselineToRestore) {
      await payload.update({
        collection: 'users',
        id: existingAdmin.id,
        data: { role: 'editor' },
        overrideAccess: true,
      })
    }

    const attempts = await Promise.allSettled([
      payload.update({
        collection: 'users',
        id: admin.id,
        data: { role: 'editor' },
        overrideAccess: true,
      }),
      payload.update({
        collection: 'users',
        id: concurrentAdmin.id,
        data: { isActive: false },
        overrideAccess: true,
      }),
    ])

    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1)

    const activeAdmins = await payload.find({
      collection: 'users',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      where: {
        and: [{ role: { equals: 'admin' } }, { isActive: { equals: true } }],
      },
    })
    expect(activeAdmins.docs).toHaveLength(1)

    await payload.update({
      collection: 'users',
      id: admin.id,
      data: { role: 'admin', isActive: true },
      overrideAccess: true,
    })
    for (const existingAdmin of baselineToRestore) {
      await payload.update({
        collection: 'users',
        id: existingAdmin.id,
        data: { role: 'admin', isActive: true },
        overrideAccess: true,
      })
    }
    await payload.delete({
      collection: 'users',
      id: concurrentAdmin.id,
      overrideAccess: true,
    })
  })
})
