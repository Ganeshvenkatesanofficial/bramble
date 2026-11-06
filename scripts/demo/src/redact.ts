// Error text from viem, fetch and ssh can carry the request URL, and an RPC URL
// can carry an API key. Every error and every rendered detail goes through scrub().

// Stops only at whitespace, quotes and angle brackets: a credential can sit after
// any URL character, including ')' and ','.
const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi
// A 32-byte private key (with or without 0x) and a Hedera DER-encoded key.
const HEX_KEY_PATTERN = /\b(?:0x)?[0-9a-fA-F]{64}\b/g
const DER_KEY_PATTERN = /\b302[a-eA-E][0-9a-fA-F]{20,}\b/g
// Env names whose value is a secret or may carry one.
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSPHRASE|CREDENTIAL|RPC_URL|_PK$|MNEMONIC|SEED)/i

const MIN_SECRET_LENGTH = 8

/** Replaces URLs, key-shaped hex strings, and any exact occurrence of a secret value, with placeholders. */
export function scrub(text: string, secrets: Array<string | undefined> = []): string {
  let out = text
  // Known values go first, longest first: a value can contain a URL or hex, and a partial match would leave its tail.
  const known = secrets.filter((s): s is string => !!s && s.length >= MIN_SECRET_LENGTH)
  for (const secret of known.sort((a, b) => b.length - a.length)) out = out.split(secret).join('<redacted>')
  return out.replace(URL_PATTERN, '<url>').replace(HEX_KEY_PATTERN, '<redacted>').replace(DER_KEY_PATTERN, '<redacted>')
}

export function errorText(err: unknown, secrets: Array<string | undefined> = []): string {
  return scrub(err instanceof Error ? err.message : String(err), secrets)
}

/** The values of every env entry whose name says it holds a secret. */
export function secretValues(...envs: Array<Record<string, string | undefined> | undefined>): string[] {
  const values: string[] = []
  for (const env of envs) {
    if (!env) continue
    for (const [name, value] of Object.entries(env)) {
      if (value && SECRET_NAME.test(name)) values.push(value.trim())
    }
  }
  return values
}
