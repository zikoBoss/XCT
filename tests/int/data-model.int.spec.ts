import { getPayload } from 'payload'
import config from '@/payload.config'

import { describe, it, beforeAll, expect } from 'vitest'

describe('XCT data model', () => {
  let payload: Awaited<ReturnType<typeof getPayload>>

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  it('registers the phase-one collections and Home global', async () => {
    const payloadConfig = await config
    const collectionSlugs = payloadConfig.collections.map(({ slug }) => slug)
    const globalSlugs = payloadConfig.globals.map(({ slug }) => slug)

    expect(collectionSlugs).toEqual(
      expect.arrayContaining(['users', 'media', 'news', 'projects', 'hubs']),
    )
    expect(globalSlugs).toContain('home')
  })

  it('defines the requested user roles and safe default', async () => {
    const users = (await config).collections.find(({ slug }) => slug === 'users')
    const role = users?.fields.find((field) => 'name' in field && field.name === 'role')

    expect(role).toMatchObject({
      name: 'role',
      type: 'select',
      defaultValue: 'editor',
      required: true,
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Editor', value: 'editor' },
      ],
    })
  })

  it('defines draft publishing and the planned content relationships', async () => {
    const payloadConfig = await config
    const collections = Object.fromEntries(
      payloadConfig.collections.map((collection) => [collection.slug, collection]),
    )
    const newsFields = collections.news?.fields
    const projectFields = collections.projects?.fields
    const home = payloadConfig.globals.find(({ slug }) => slug === 'home')

    expect(collections.news?.versions?.drafts).toBeTruthy()
    expect(collections.projects?.versions?.drafts).toBeTruthy()
    expect(collections.hubs?.versions?.drafts).toBeTruthy()
    expect(newsFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'relatedProjects', relationTo: 'projects' }),
        expect.objectContaining({ name: 'relatedHubs', relationTo: 'hubs' }),
        expect.objectContaining({ name: 'author', relationTo: 'users' }),
      ]),
    )
    expect(projectFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'hubs', relationTo: 'hubs' }),
        expect.objectContaining({ name: 'author', relationTo: 'users' }),
      ]),
    )
    expect(home?.versions?.drafts).toBeTruthy()
    expect(home?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'featuredNews', relationTo: 'news' }),
        expect.objectContaining({ name: 'featuredProjects', relationTo: 'projects' }),
        expect.objectContaining({ name: 'featuredHubs', relationTo: 'hubs' }),
      ]),
    )
  })

  it('denies unauthenticated reads of Users and Media records', async () => {
    for (const collection of ['users', 'media'] as const) {
      await expect(
        payload.find({
          collection,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    }

    for (const collection of ['news', 'projects', 'hubs'] as const) {
      const results = await payload.find({
        collection,
        overrideAccess: false,
      })

      expect(results.docs.every(({ _status }) => _status === 'published')).toBe(true)
    }

    await expect(
      payload.findGlobal({
        slug: 'home',
        overrideAccess: false,
      }),
    ).rejects.toThrow()
  })
})
