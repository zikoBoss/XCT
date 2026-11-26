import type { GlobalConfig } from 'payload'

export const Home: GlobalConfig = {
  slug: 'home',
  access: {
    read: () => false,
    update: () => false,
  },
  versions: {
    drafts: true,
  },
  fields: [
    {
      name: 'hero',
      type: 'group',
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
    },
    {
      name: 'featuredProjects',
      type: 'relationship',
      relationTo: 'projects',
      hasMany: true,
    },
    {
      name: 'featuredHubs',
      type: 'relationship',
      relationTo: 'hubs',
      hasMany: true,
    },
    {
      name: 'quickLinks',
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
  ],
}
