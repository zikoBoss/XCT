import type { CollectionConfig } from 'payload'
import {
  assignEditorAsAuthor,
  canManageContent,
  canSetAuthor,
  readPublishedContent,
} from '../access/roles'
import { lockHubMediaReferences, lockHubMediaReferencesBeforeDelete } from '../access/media'

export const Hubs: CollectionConfig = {
  slug: 'hubs',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', '_status', 'updatedAt'],
  },
  access: {
    create: canManageContent,
    delete: canManageContent,
    read: readPublishedContent,
    update: canManageContent,
  },
  versions: {
    drafts: true,
  },
  hooks: {
    beforeChange: [lockHubMediaReferences, assignEditorAsAuthor],
    beforeDelete: [lockHubMediaReferencesBeforeDelete],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
    },
    {
      name: 'summary',
      type: 'textarea',
      required: true,
    },
    {
      name: 'description',
      type: 'richText',
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'links',
      type: 'array',
      fields: [
        {
          name: 'label',
          type: 'text',
          required: true,
        },
        {
          name: 'url',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      access: {
        create: canSetAuthor,
        update: canSetAuthor,
      },
      admin: {
        position: 'sidebar',
      },
    },
  ],
}
