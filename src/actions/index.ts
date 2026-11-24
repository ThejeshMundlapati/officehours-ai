import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { questionActions } from './questions'
import { staffActions } from './staff'
import { materialActions } from './materials'
import { claimActions } from './claims'
import { groupActions } from './groups'

export const actions: Record<string, ActionHandler<Env>> = {
  ...questionActions,
  ...staffActions,
  ...materialActions,
  ...claimActions,
  ...groupActions,
}
