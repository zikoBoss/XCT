import type { CollectionConfig } from 'payload'
import { Forbidden } from 'payload'
import { protectLastAdminDelete, protectLastAdminUpdate } from '../access/adminProtection'
import { isAdmin, isAdminField } from '../access/roles'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: true,
  forceSelect: {
    isActive: true,
    role: true,
  },
  access: {
    create: isAdmin,
    delete: isAdmin,
    read: isAdmin,
    update: isAdmin,
  },
  hooks: {
    beforeChange: [protectLastAdminUpdate],
    beforeDelete: [protectLastAdminDelete],
    beforeLogin: [
      ({ user, req }) => {
        if (user.isActive === false) {
          throw new Forbidden(req.t)
        }
      },
    ],
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
        create: isAdminField,
        update: isAdminField,
      },
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      required: true,
      access: {
        create: isAdminField,
        update: isAdminField,
      },
      admin: {
        position: 'sidebar',
      },
    },
  ],
}
