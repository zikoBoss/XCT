import type { CollectionConfig } from 'payload'
import {
  assignEditorAsAuthor,
  canManageContent,
  canSetAuthor,
  readPublishedContent,
} from '../access/roles'
import { lockProjectMediaReferences, lockProjectMediaReferencesBeforeDelete } from '../access/media'

export const Projects: CollectionConfig = {
  slug: 'projects',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'projectStatus', '_status', 'updatedAt'],
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
    beforeChange: [lockProjectMediaReferences, assignEditorAsAuthor],
    beforeDelete: [lockProjectMediaReferencesBeforeDelete],
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
      name: 'projectStatus',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        {
          label: 'In Development',
          value: 'in-development',
        },
        {
          label: 'Active',
          value: 'active',
        },
        {
          label: 'Maintenance',
          value: 'maintenance',
        },
        {
          label: 'Archived',
          value: 'archived',
        },
      ],
    },
    {
      name: 'technologies',
      type: 'array',
      fields: [
        {
          name: 'technology',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'cover',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'gallery',
      type: 'upload',
      relationTo: 'media',
      hasMany: true,
    },
    {
      name: 'links',
      type: 'group',
      fields: [
        {
          name: 'repository',
          type: 'text',
        },
        {
          name: 'documentation',
          type: 'text',
        },
        {
          name: 'demo',
          type: 'text',
        },
      ],
    },
    {
      name: 'hubs',
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
  ],
}
