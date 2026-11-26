import type { CollectionConfig } from 'payload'
import { isAdmin } from '../access/roles'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: true,
  access: {
    create: isAdmin,
    delete: isAdmin,
    read: isAdmin,
    update: isAdmin,
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      defaultValue: 'editor',
      required: true,
      options: [
        {
          label: 'Admin',
          value: 'admin',
        },
        {
          label: 'Editor',
          value: 'editor',
        },
      ],
      access: {
        create: ({ req }) => req.user?.role === 'admin',
        update: ({ req }) => req.user?.role === 'admin',
      },
      admin: {
        position: 'sidebar',
      },
    },
  ],
}
