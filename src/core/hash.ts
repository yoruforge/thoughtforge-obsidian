const textEncoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

/**
 * Deterministic 64-bit hex digest (dual-seed FNV-1a 32-bit) kept synchronous by design for
 * pure-core Markdown parse/patch CAS checks without async crypto or external dependencies.
 */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b1;

  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);

    h2 ^= code + ((i & 0xff) << 1);
    h2 = Math.imul(h2, 0x85ebca6b);
  }

  h1 ^= h1 >>> 16;
  h2 ^= h2 >>> 15;

  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${part1}${part2}`;
}
