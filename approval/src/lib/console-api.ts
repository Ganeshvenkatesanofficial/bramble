import type { ApprovalService } from './service'

export type RequestView = ReturnType<ApprovalService['get']>

export async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...init })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error?.message ?? 'The approval service is unavailable.')
  return body as T
}

export function transactionUrl(hash: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(hash) ? `https://sepolia.etherscan.io/tx/${hash}` : null
}
