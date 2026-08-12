export function createClientId(
  cryptoSource: Crypto | null = typeof globalThis.crypto === "undefined" ? null : globalThis.crypto,
) {
  if (typeof cryptoSource?.randomUUID === "function") {
    try {
      return cryptoSource.randomUUID();
    } catch {
      // Some browsers expose randomUUID outside a secure context but throw when it is called.
    }
  }

  const bytes = new Uint8Array(16);
  let hasSecureRandomBytes = false;
  if (typeof cryptoSource?.getRandomValues === "function") {
    try {
      cryptoSource.getRandomValues(bytes);
      hasSecureRandomBytes = true;
    } catch {
      hasSecureRandomBytes = false;
    }
  }

  if (!hasSecureRandomBytes) {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  // Mark the fallback as an RFC 4122 version 4 UUID.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
