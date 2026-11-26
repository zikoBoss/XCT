import type { GlobalConfig } from 'payload'
import { Forbidden } from 'payload'
import { canManageContent, canManageContentField, isAdminField } from '../access/roles'

export const Home: GlobalConfig = {
  slug: 'home',
  access: {
    read: () => true,
    readVersions: canManageContent,
    update: canManageContent,
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc, req }) => {
        if (req.user?.role !== 'editor' || req.user.isActive === false) {
          return data
        }

        if (data._status === 'published') {
          throw new Forbidden(req.t)
        }

        if (
          data._status !== undefined &&
          data._status !== 'draft' &&
          data._status !== originalDoc?._status
        ) {
          throw new Forbidden(req.t)
        }

        return data
      },
    ],
    beforeOperation: [
      ({ args, operation, req }) => {
        if (
          operation === 'read' &&
          args?.draft === true &&
          (req.user?.isActive === false ||
            (req.user?.role !== 'admin' && req.user?.role !== 'editor'))
        ) {
          throw new Forbidden(req.t)
        }

        if (operation === 'update' && req.user?.role === 'editor') {
          if (args?.draft !== true) {
            throw new Forbidden(req.t)
          }

          if (
            args?.data &&
            ('seo' in args.data ||
              'displaySettings' in args.data ||
              args.data._status === 'published')
          ) {
            throw new Forbidden(req.t)
          }
        }
      },
    ],
  },
  versions: {
    drafts: true,
  },
  fields: [
    {
      name: 'hero',
      type: 'group',
      access: {
        update: canManageContentField,
      },
      fields: [
        {
          name: 'title',
          type: 'text',
          required: true,
        },
        {
          name: 'summary',
          type: 'textarea',
          required: true,
        },
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
        },
      ],
    },
    {
      name: 'featuredNews',
      type: 'relationship',
      relationTo: 'news',
      hasMany: true,
      access: {
        update: canManageContentField,
      },
    },
    {
      name: 'featuredProjects',
      type: 'relationship',
      relationTo: 'projects',
      hasMany: true,
      access: {
        update: canManageContentField,
      },
    },
    {
      name: 'featuredHubs',
      type: 'relationship',
      relationTo: 'hubs',
      hasMany: true,
      access: {
        update: canManageContentField,
      },
    },
    {
      name: 'quickLinks',
      type: 'array',
      access: {
        update: canManageContentField,
      },
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
      name: 'sectionOrder',
      type: 'array',
      access: {
        update: canManageContentField,
      },
      fields: [
        {
          name: 'section',
          type: 'select',
          required: true,
          options: [
            { label: 'News', value: 'news' },
            { label: 'Projects', value: 'projects' },
            { label: 'Hubs', value: 'hubs' },
          ],
        },
      ],
    },
    {
      name: 'seo',
      type: 'group',
      access: {
        update: isAdminField,
      },
      fields: [
        {
          name: 'title',
          type: 'text',
        },
        {
          name: 'description',
          type: 'textarea',
        },
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
        },
      ],
    },
    {
      name: 'displaySettings',
      type: 'group',
      access: {
        update: isAdminField,
      },
      fields: [
        {
          name: 'layout',
          type: 'select',
          defaultValue: 'standard',
          options: [
            { label: 'Standard', value: 'standard' },
            { label: 'Compact', value: 'compact' },
          ],
        },
        {
          name: 'showNews',
          type: 'checkbox',
          defaultValue: true,
        },
        {
          name: 'showProjects',
          type: 'checkbox',
          defaultValue: true,
        },
        {
          name: 'showHubs',
          type: 'checkbox',
          defaultValue: true,
        },
      ],
    },
  ],
}
