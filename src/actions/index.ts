import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { questionActions } from './questions'
import { staffActions } from './staff'

export const actions: Record<string, ActionHandler<Env>> = {
  ...questionActions,
  ...staffActions,
}
