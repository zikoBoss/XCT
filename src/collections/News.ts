import type { CollectionConfig } from 'payload'
import {
  assignEditorAsAuthor,
  canManageContent,
  canSetAuthor,
  readPublishedContent,
} from '../access/roles'

export const News: CollectionConfig = {
  slug: 'news',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'category', '_status', 'publishedAt'],
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
    beforeChange: [assignEditorAsAuthor],
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
      name: 'content',
      type: 'richText',
    },
    {
      name: 'category',
      type: 'select',
      required: true,
      options: [
        {
          label: 'Announcement',
          value: 'announcement',
        },
        {
          label: 'Update',
          value: 'update',
        },
        {
          label: 'Event',
          value: 'event',
        },
      ],
    },
    {
      name: 'cover',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'relatedProjects',
      type: 'relationship',
      relationTo: 'projects',
      hasMany: true,
    },
    {
      name: 'relatedHubs',
      type: 'relationship',
      relationTo: 'hubs',
      hasMany: true,
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
    {
      name: 'publishedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
      },
    },
  ],
}
