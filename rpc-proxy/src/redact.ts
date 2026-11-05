/** Strings from the upstream URL that must never reach a client: the URL, its path, query values and credentials. */
export function secretsFromUrl(upstreamUrl: string): string[] {
  const needles = new Set<string>([upstreamUrl])
  try {
    const url = new URL(upstreamUrl)
    needles.add(url.href)
    if (url.pathname.length > 1) needles.add(url.pathname)
    if (url.search.length > 1) needles.add(url.search.slice(1))
    for (const value of url.searchParams.values()) if (value) needles.add(value)
    if (url.username) needles.add(decodeURIComponent(url.username))
    if (url.password) needles.add(decodeURIComponent(url.password))
  } catch {
    // An unparseable URL is only redacted as a whole.
  }
  const variants = new Set<string>()
  for (const needle of needles) {
    variants.add(needle)
    variants.add(JSON.stringify(needle).slice(1, -1))
    variants.add(encodeURIComponent(needle))
  }
  return [...variants].filter((v) => v.length > 0).sort((a, b) => b.length - a.length)
}

export function redact(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of secrets) out = out.split(secret).join('[redacted]')
  return out
}
