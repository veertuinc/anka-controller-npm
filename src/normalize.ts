import type { Instance } from './types'

// The list endpoint sometimes returns { ...fields, vm: { ...fields } }.
// Fields on the outer object win. get returns the instance itself.
export function normalizeInstance(value: unknown): Instance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Instance record is missing')
  }

  const record = value as Record<string, unknown>
  const nested = record.vm
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    return record as Instance
  }

  const outer = { ...record }
  delete outer.vm
  return { ...(nested as Record<string, unknown>), ...outer } as Instance
}
