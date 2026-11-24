import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { questionActions } from './questions'

export const actions: Record<string, ActionHandler<Env>> = {
  ...questionActions,
}
