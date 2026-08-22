import type { NormalizedActivity, SupportedFileFormat } from '@/types/activity'
import { SUPPORTED_FORMATS } from '@/types/activity'
import { parseFit } from './fit'
import { parseGpx } from './gpx'
import { parseTcx } from './tcx'
import { computeExternalId } from './helpers'

export { computeExternalId } from './helpers'

/** Extract the lowercased extension (with dot) from a filename. */
export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx >= 0 ? filename.slice(idx).toLowerCase() : ''
}

export function isSupportedFormat(filename: string): boolean {
  return SUPPORTED_FORMATS.includes(getExtension(filename) as SupportedFileFormat)
}

/**
 * Parse an uploaded activity file into a NormalizedActivity, routing by extension.
 * Also fills the deterministic externalId used for dedup.
 */
export async function parseActivityFile(
  filename: string,
  buffer: Buffer
): Promise<NormalizedActivity> {
  const ext = getExtension(filename)
  let activity: NormalizedActivity

  switch (ext) {
    case '.fit':
      activity = await parseFit(buffer)
      break
    case '.gpx':
      activity = parseGpx(buffer.toString('utf-8'))
      break
    case '.tcx':
      activity = parseTcx(buffer.toString('utf-8'))
      break
    default:
      throw new Error(`Unsupported file type: ${ext || '(none)'}. Supported: .fit, .gpx, .tcx`)
  }

  activity.externalId = computeExternalId(activity)
  return activity
}
