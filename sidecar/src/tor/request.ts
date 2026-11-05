import type { TorFetchInit } from './transport'

export interface TorRequest {
  url: string
  init: TorFetchInit
}

// Converts standard fetch() arguments into tor-js's narrower FetchInit.
// Callers pass both shapes: viem's http transport calls fetch(url, init) with
// a string body, and @x402/fetch calls fetch(request) with a Request object.
// Normalizing through `new Request()` handles both, plus Headers objects and
// header arrays, which tor-js does not accept.
//
// The body is buffered into memory so a failed attempt can be resent under a
// fresh isolation key; a ReadableStream can be read only once. Every body the
// sidecar sends is a small JSON-RPC call or x402 payload, so buffering costs
// nothing that matters.
export async function toTorRequest(input: string | URL | Request, init?: RequestInit): Promise<TorRequest> {
  const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init)
  const headers: Record<string, string> = {}
  request.headers.forEach((value, name) => {
    headers[name] = value
  })

  const out: TorFetchInit = { method: request.method, headers }
  if (request.body !== null) {
    out.body = new Uint8Array(await request.arrayBuffer())
  }
  // A caller's signal must still cancel the request. Request always carries
  // a signal, but only forward one the caller supplied, so tor-js does not
  // register abort listeners for requests nobody can cancel.
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
  if (signal) out.signal = signal
  return { url: request.url, init: out }
}
