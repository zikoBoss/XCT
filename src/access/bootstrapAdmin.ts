import { createLocalReq, type Payload } from 'payload'
import { acquireLastAdminLock } from './adminProtection'

export class AdminBootstrapAlreadyCompleteError extends Error {
  constructor() {
    super('Bootstrap refused: an active administrator already exists.')
    this.name = 'AdminBootstrapAlreadyCompleteError'
  }
}

export const createFirstAdmin = async (
  payload: Payload,
  email: string,
  password: string,
): Promise<void> => {
  const req = await createLocalReq({}, payload)
  const transactionID = await payload.db.beginTransaction()

  if (!transactionID) {
    throw new Error('Bootstrap requires a PostgreSQL transaction.')
  }

  req.transactionID = transactionID

  try {
    await acquireLastAdminLock(req)

    const activeAdmins = await payload.find({
      collection: 'users',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
      where: {
        and: [{ role: { equals: 'admin' } }, { isActive: { equals: true } }],
      },
    })

    if (activeAdmins.docs.length > 0) {
      throw new AdminBootstrapAlreadyCompleteError()
    }

    await payload.create({
      collection: 'users',
      data: { email, password, role: 'admin', isActive: true },
      overrideAccess: true,
      req,
    })

    await payload.db.commitTransaction(transactionID)
  } catch (error) {
    try {
      await payload.db.rollbackTransaction(transactionID)
    } catch {
      throw new Error('Bootstrap failed and its transaction could not be rolled back.')
    }

    throw error
  }
}
