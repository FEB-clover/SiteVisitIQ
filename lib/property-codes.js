/**
 * property_id -> workbook code.
 *
 * Single source of truth, imported by both halves of the workbook sync:
 *   /api/todo-queue         (app -> workbook, what to post)
 *   /api/todo-queue/status  (workbook -> app, whose row is whose)
 *
 * Keeping one copy matters: if these two lists ever drifted, the status
 * read-back could attach a manager's note to an issue at a different property.
 * Anything not listed here is not synced in either direction, and the outbound
 * feed reports it under `unmapped_properties` so a new property cannot go
 * missing in silence.
 */
export const CODES = {
  wot: 'WOT',
  wop: 'WOP',
  creekstone: 'CRK',
  foj: 'FOJ',
  fountains: 'FOJ',
  gp: 'GBP',
  gablepoint: 'GBP',
  'gable-point': 'GBP',
  forma: 'FRM',
};

export function codeFor(propertyId) {
  return CODES[String(propertyId || '').toLowerCase()] || null;
}

/**
 * Parse `SV-<CODE>-<items.id>` into its parts, or null if it is not one.
 * The Ref ID is the join key between a workbook row and an issue, so it is
 * parsed strictly rather than leniently.
 */
export function parseRefId(ref) {
  const m = /^SV-([A-Z]{2,4})-(\d+)$/.exec(String(ref || '').trim());
  return m ? { code: m[1], id: Number(m[2]) } : null;
}
