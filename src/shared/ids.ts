const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export const randomId = (length = 8): string => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
};

export const uid = (prefix: string, length = 8): string => `${prefix}_${randomId(length)}`;
