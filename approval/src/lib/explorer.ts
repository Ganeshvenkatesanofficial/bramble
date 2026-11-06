export function transactionUrl(hash: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(hash) ? `https://sepolia.etherscan.io/tx/${hash}` : null
}
