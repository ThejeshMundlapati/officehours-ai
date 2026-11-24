/**
 * Course-material input validation — pure, no runtime imports, so the
 * instructor page (instant feedback) and the `uploadMaterial` server action
 * (the actual gate) share one implementation.
 *
 * Limits (see docs.deep.space/bindings/knowledge.md, "Limits and validation"):
 * - Folder + filename must fit the provider's 128-character item key. The SDK
 *   normalizes folder 'course' to 'course/' (7 chars), so filename <= 121.
 * - A provider upload part may be at most 4 MiB.
 * - The server-action JSON body limit is NOT documented, so the text cap is a
 *   conservative 200 KB of UTF-8 — far under 4 MiB, so an upload is never split
 *   into multiple knowledge items.
 */

export const MATERIALS_FOLDER = 'course'
/** Normalized folder as the SDK sends it ('course/'). */
const NORMALIZED_FOLDER_LENGTH = MATERIALS_FOLDER.length + 1
export const KNOWLEDGE_KEY_MAX = 128
export const MATERIAL_FILENAME_MAX = KNOWLEDGE_KEY_MAX - NORMALIZED_FOLDER_LENGTH // 121
export const MATERIAL_TEXT_MAX_BYTES = 200_000
export const MATERIAL_ALLOWED_EXTENSIONS = ['.md', '.txt'] as const
export const MATERIAL_SEARCH_QUERY_MAX = 500

export type MaterialValidation =
  | { ok: true; filename: string; sizeBytes: number; mimeType: string }
  | { ok: false; error: string }

/**
 * Reduce a user-supplied name to a safe base name: strip any path, keep only
 * [A-Za-z0-9._-], collapse runs, lower-case the extension. Returns '' when
 * nothing usable remains.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : ''
  const cleanStem = stem
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  if (!cleanStem) return ''
  return `${cleanStem}${ext.replace(/[^a-z0-9.]/g, '')}`
}

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

export function validateMaterialInput(rawFilename: unknown, rawText: unknown): MaterialValidation {
  if (typeof rawFilename !== 'string' || typeof rawText !== 'string') {
    return { ok: false, error: 'filename and text are required.' }
  }
  const filename = sanitizeFilename(rawFilename.trim())
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  if (!filename || filename.lastIndexOf('.') <= 0 || !MATERIAL_ALLOWED_EXTENSIONS.includes(ext as '.md')) {
    return { ok: false, error: 'Only .md and .txt files are accepted.' }
  }
  if (filename.length > MATERIAL_FILENAME_MAX) {
    return { ok: false, error: `Filename must be at most ${MATERIAL_FILENAME_MAX} characters.` }
  }
  if (rawText.trim().length === 0) {
    return { ok: false, error: 'The file is empty.' }
  }
  const sizeBytes = utf8ByteLength(rawText)
  if (sizeBytes > MATERIAL_TEXT_MAX_BYTES) {
    return { ok: false, error: `File is too large (max ${Math.floor(MATERIAL_TEXT_MAX_BYTES / 1000)} KB).` }
  }
  return { ok: true, filename, sizeBytes, mimeType: ext === '.md' ? 'text/markdown' : 'text/plain' }
}
