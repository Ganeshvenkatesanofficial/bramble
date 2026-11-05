// The seam between the sidecar and tor-js. Production code gets a real
// TorClient; unit tests pass a fake that implements the same three methods
// (see test/tor.test.ts). Keeping the seam this narrow means tests never load
// the 1.9 MB Arti WASM binary or touch the network.

// Mirrors tor-js 0.4.4's FetchInit (dist/types.d.ts). Declared here, not
// imported, so the fake transport in tests does not depend on tor-js types.
export interface TorFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array | ArrayBuffer | ReadableStream<Uint8Array>
  signal?: AbortSignal
  anonOptions?: { isolationKey?: string }
}

export interface TorTransport {
  /** Resolves once a guard is connected and the consensus is usable. */
  ready(): Promise<void>
  fetch(url: string, init?: TorFetchInit): Promise<Response>
  close(): void
}

export type TorTransportFactory = () => TorTransport | Promise<TorTransport>

// tor-js ships three entry points that differ only in how the WASM loads.
// The default (`tor-js`) downloads it from jsDelivr, unpkg or GitHub in the
// clear and caches it under ~/.local/share/tor-js-wasm, which would leak
// "this host runs tor-js" to a CDN and write local state. `tor-js/wasm-file`
// reads tor_js_bg.wasm from node_modules instead: no network, no writes.
//
// Storage is MemoryStorage for the same reason. The Node default is a
// filesystem store under ~/.local/share/tor-js; MemoryStorage keeps the
// consensus and microdescriptors in this process only, so a restart
// bootstraps from scratch (measured 51 s under Bun, 5 Nov 2026) and the
// node runtime path writes nothing to disk (pnpm check:no-local-state).
export const createTorJsTransport: TorTransportFactory = async () => {
  const { TorClient, storage } = await import('tor-js/wasm-file')
  return new TorClient({ storage: new storage.MemoryStorage() })
}
