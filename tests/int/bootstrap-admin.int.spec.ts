import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AdminBootstrapAlreadyCompleteError, createFirstAdmin } from '@/access/bootstrapAdmin'

describe('first administrator bootstrap', () => {
  let payload: Payload

  const suffix = `${Date.now()}`
  const candidates = [
    `b5-bootstrap-a-${suffix}@example.test`,
    `b5-bootstrap-b-${suffix}@example.test`,
  ]

  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    const admins = await payload.find({
      collection: 'users',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: {
        and: [{ role: { equals: 'admin' } }, { isActive: { equals: true } }],
      },
    })

    if (admins.docs.length > 0) {
      throw new Error('Bootstrap integration tests require a database with no active admins.')
    }
  })

  afterAll(async () => {
    await payload?.destroy()
  })

  it('creates exactly one first admin when independent attempts race', async () => {
    const results = await Promise.allSettled(
      candidates.map((email) => createFirstAdmin(payload, email, 'B5-test-password-2026')),
    )

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)

    const admins = await payload.find({
      collection: 'users',
      depth: 0,
      limit: 2,
      overrideAccess: true,
      where: {
        and: [{ role: { equals: 'admin' } }, { isActive: { equals: true } }],
      },
    })

    expect(admins.docs).toHaveLength(1)
    expect(candidates).toContain(admins.docs[0]?.email)
  })

  it('refuses to initialize again once an active admin exists', async () => {
    await expect(
      createFirstAdmin(
        payload,
        `b5-bootstrap-repeat-${suffix}@example.test`,
        'B5-test-password-2026',
      ),
    ).rejects.toBeInstanceOf(AdminBootstrapAlreadyCompleteError)

    const repeatUser = await payload.find({
      collection: 'users',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      where: {
        email: { equals: `b5-bootstrap-repeat-${suffix}@example.test` },
      },
    })

    expect(repeatUser.docs).toHaveLength(0)
  })
})
