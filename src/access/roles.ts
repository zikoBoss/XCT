import type { Access, CollectionBeforeChangeHook, FieldAccess } from 'payload'

export const isAdmin: Access = ({ req }) =>
  req.user?.role === 'admin' && req.user?.isActive !== false

export const isAdminField: FieldAccess = ({ req }) =>
  req.user?.role === 'admin' && req.user?.isActive !== false

export const canManageContent: Access = ({ req }) =>
  req.user?.isActive !== false && (req.user?.role === 'admin' || req.user?.role === 'editor')

export const canManageContentField: FieldAccess = ({ req }) =>
  req.user?.isActive !== false && (req.user?.role === 'admin' || req.user?.role === 'editor')

export const canSetAuthor: FieldAccess = ({ req }) =>
  req.user?.role === 'admin' && req.user?.isActive !== false

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
  if (
    req.user?.isActive !== false &&
    (req.user?.role === 'admin' || req.user?.role === 'editor')
  ) {
    return true
  }

  return {
    _status: {
      equals: 'published',
    },
  }
}
