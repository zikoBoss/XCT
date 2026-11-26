import * as migration_20261126_220429_initial from './20261126_220429_initial'

export const migrations = [
  {
    up: migration_20261126_220429_initial.up,
    down: migration_20261126_220429_initial.down,
    name: '20261126_220429_initial',
  },
]
