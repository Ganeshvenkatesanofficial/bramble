// Error text from viem, fetch and ssh can carry the request URL, and an RPC URL
// can carry an API key. Every error the CLIs print goes through scrub().

const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'<>)]+/gi

/** Replaces URLs, and any exact occurrence of a non-empty secret value, with placeholders. */
export function scrub(text: string, secrets: Array<string | undefined> = []): string {
  let out = text.replace(URL_PATTERN, '<url>')
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('<redacted>')
  }
  return out
}

export function errorText(err: unknown, secrets: Array<string | undefined> = []): string {
  return scrub(err instanceof Error ? err.message : String(err), secrets)
}
