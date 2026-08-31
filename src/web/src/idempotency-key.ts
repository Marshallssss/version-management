function randomByte(): number {
  return Math.floor(Math.random() * 256)
}

export function createIdempotencyKey(): string {
  const webCrypto = globalThis.crypto
  try {
    if (typeof webCrypto?.randomUUID === 'function') {
      return webCrypto.randomUUID()
    }
  } catch {
    // Older or non-secure browser contexts can expose crypto without randomUUID support.
  }

  const bytes = new Uint8Array(16)
  try {
    if (typeof webCrypto?.getRandomValues === 'function') {
      webCrypto.getRandomValues(bytes)
    } else {
      bytes.forEach((_, index) => { bytes[index] = randomByte() })
    }
  } catch {
    bytes.forEach((_, index) => { bytes[index] = randomByte() })
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
