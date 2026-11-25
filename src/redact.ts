const REDACTED = '[REDACTED]'

const SENSITIVE_FIELD_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'token',
  'password',
  'secret',
  'passphrase',
  'startup_script',
  'gh-pat',
  'gh_pat',
  'controller-auth-cert',
  'controller-auth-cert-key',
  'controller-root-token',
  'root_token',
  'roottoken',
  'cert',
  'key',
  'ca'
])

export function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value
  for (const secret of secrets) {
    if (secret.length >= 4) {
      redacted = redacted.split(secret).join(REDACTED)
    }
  }
  return redacted
}

export function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    return redactString(value, secrets)
  }

  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, secrets))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, fieldValue]) => [
        key,
        SENSITIVE_FIELD_NAMES.has(key.toLowerCase())
          ? REDACTED
          : redactValue(fieldValue, secrets)
      ])
    )
  }

  return value
}
