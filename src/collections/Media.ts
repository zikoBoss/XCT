import type { CollectionConfig } from 'payload'
import { canManageContent, isAdmin } from '../access/roles'
import { preventDeletingReferencedMedia, readMedia } from '../access/media'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    create: canManageContent,
    delete: isAdmin,
    read: readMedia,
    update: canManageContent,
  },
  hooks: {
    beforeDelete: [preventDeletingReferencedMedia],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
  upload: {
    imageSizes: [{ name: 'thumbnail', width: 320, height: 320, fit: 'inside' }],
  },
}
