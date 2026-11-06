import type { PeerPath, TestResult } from './contract'

/** Groups a long hex fingerprint in fours so two people can read it aloud and compare. */
export function formatFingerprint(value: string): string {
  const hex = value.replace(/[\s:]/g, '')
  if (hex.length >= 16 && /^[0-9a-f]+$/i.test(hex)) return (hex.match(/.{1,4}/g) ?? []).join(' ')
  return value
}

export function shortKey(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

const nameRule = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/

export function checkDeviceName(raw: string): string | null {
  const value = raw.trim()
  if (value.length < 2) return 'Pick a name with at least 2 characters.'
  if (value.length > 32) return 'Keep the name to 32 characters or fewer.'
  if (!nameRule.test(value)) return 'Use lowercase letters, numbers and hyphens. Start and end with a letter or number.'
  return null
}

const networkRule = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

export function checkNetworkName(raw: string): string | null {
  const value = raw.trim().toLowerCase()
  if (!value) return 'Enter the network name your admin gave you.'
  if (!networkRule.test(value)) return 'A network name has dots in it, like acme.bramble.eth.'
  return null
}

function toMillis(value: string | number | null): number | null {
  if (value === null) return null
  const millis = typeof value === 'number' ? (value < 1e11 ? value * 1000 : value) : Date.parse(value)
  // Go's zero time and a zero unix stamp both mean "never".
  if (!Number.isFinite(millis) || millis <= 0 || new Date(millis).getUTCFullYear() < 2000) return null
  return millis
}

export function relativeTime(value: string | number | null, now = Date.now()): string {
  const millis = toMillis(value)
  if (millis === null) return 'Not yet'
  const seconds = Math.max(0, Math.round((now - millis) / 1000))
  if (seconds < 5) return 'Just now'
  if (seconds < 60) return `${seconds} s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86_400)} d ago`
}

export const pathCopy: Record<PeerPath, { label: string; hint: string }> = {
  direct: { label: 'Direct', hint: 'Traffic goes straight between the two devices.' },
  relay: { label: 'Relayed', hint: 'Traffic goes through a Bramble relay while a direct path is found.' },
  none: { label: 'Not connected', hint: 'No traffic has passed with this device yet.' },
}

export function describeTest(result: TestResult, target: string): { ok: boolean; text: string } {
  if (result.ok) return { ok: true, text: `Reached ${target} in ${Math.round(result.ms)} ms.` }
  if (result.status === 0) return { ok: false, text: `Could not reach ${target}. The device did not answer.` }
  return { ok: false, text: `Could not reach ${target}. It answered with status ${result.status}.` }
}
