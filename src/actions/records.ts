/**
 * Shared record-API helpers for server actions.
 */

/**
 * True when a tools.create was refused by a collection's `uniqueOn`. The
 * RecordRoom returns `{ success: false, error: 'Duplicate: a record with
 * <field>=<value> already exists in <collection>' }` with no `code` field
 * (deepspace/dist/worker.js, uniqueOn check before INSERT; observed in
 * tests/claims.spec.ts), so the stable 'Duplicate:' prefix is the signal.
 */
export function isDuplicateInsert(res: { success: boolean; error?: string }): boolean {
  return !res.success && typeof res.error === 'string' && res.error.startsWith('Duplicate:')
}
