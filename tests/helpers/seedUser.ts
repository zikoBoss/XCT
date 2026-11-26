import { getPayload } from 'payload'
import config from '../../src/payload.config.js'

export const testUser = {
  email: 'dev@payloadcms.com',
  password: 'test',
  role: 'admin' as const,
}

/**
 * Seeds a test user for e2e admin tests.
 */
export async function seedTestUser(): Promise<void> {
  const payload = await getPayload({ config })

  const existing = await payload.find({
    collection: 'users',
    limit: 1,
    overrideAccess: true,
    where: {
      email: {
        equals: testUser.email,
      },
    },
  })

  if (existing.docs[0]) {
    await payload.update({
      collection: 'users',
      id: existing.docs[0].id,
      data: { ...testUser, isActive: true },
      overrideAccess: true,
    })
  } else {
    await payload.create({
      collection: 'users',
      data: { ...testUser, isActive: true },
      overrideAccess: true,
    })
  }
}

/**
 * Cleans up test user after tests
 */
export async function cleanupTestUser(): Promise<void> {
  const payload = await getPayload({ config })

  const otherAdmins = await payload.find({
    collection: 'users',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: {
      and: [
        { role: { equals: 'admin' } },
        { isActive: { equals: true } },
        { email: { not_equals: testUser.email } },
      ],
    },
  })

  if (otherAdmins.docs.length > 0) {
    await payload.delete({
      collection: 'users',
      where: {
        email: {
          equals: testUser.email,
        },
      },
      overrideAccess: true,
    })
  }
}
