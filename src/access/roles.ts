import type { Access, CollectionBeforeChangeHook, FieldAccess } from 'payload'

export const isAdmin: Access = ({ req }) => req.user?.role === 'admin'

export const canManageContent: Access = ({ req }) =>
  req.user?.role === 'admin' || req.user?.role === 'editor'

export const canSetAuthor: FieldAccess = ({ req }) => req.user?.role === 'admin'

export const assignEditorAsAuthor: CollectionBeforeChangeHook = ({ data, operation, req }) => {
  if (operation === 'create' && req.user?.role === 'editor') {
    return {
      ...data,
      author: req.user.id,
    }
  }

  return data
}

export const readPublishedContent: Access = ({ req }) => {
  if (req.user?.role === 'admin' || req.user?.role === 'editor') {
    return true
  }

  return {
    _status: {
      equals: 'published',
    },
  }
}
