import type { CryptoPanKey } from './types';
import { formatIPv4, networkOf, parseIPv4 } from '../core/ipv4';

/** AES-CBC's first block with a zero IV is the required AES block primitive. */
export async function aesBlock(aes: CryptoKey, block: Uint8Array): Promise<Uint8Array> {
  const out = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, aes, new Uint8Array(block));
  return new Uint8Array(out).slice(0, 16);
}

export async function cryptoPanFromRaw(raw: Uint8Array): Promise<CryptoPanKey> {
  if (raw.length !== 32) throw new Error('invalid-key-length');
  const aes = await crypto.subtle.importKey('raw', raw.slice(0, 16), 'AES-CBC', false, ['encrypt']);
  return { aes, pad: await aesBlock(aes, raw.slice(16)) };
}

/** Prefix-preserving permutation, including query-only addresses; no learned address table. */
export async function cryptoPan(value: number, key: CryptoPanKey): Promise<number> {
  let out = 0;
  for (let bit = 0; bit < 32; bit++) {
    const block = new Uint8Array(key.pad);
    for (let j = 0; j < bit; j++) {
      const byte = Math.floor(j / 8), mask = 1 << (7 - j % 8);
      block[byte] = (block[byte] & ~mask) | (((value >>> (31 - j)) & 1) ? mask : 0);
    }
    const encrypted = await aesBlock(key.aes, block);
    out = ((out << 1) | (((value >>> (31 - bit)) & 1) ^ (encrypted[0] >>> 7))) >>> 0;
  }
  return out;
}

export async function cryptoPanAddress(address: string, key: CryptoPanKey, prefixLength?: number): Promise<string> {
  const value = parseIPv4(address);
  if (value === null) throw new Error('invalid-ipv4');
  const transformed = await cryptoPan(value, key);
  return formatIPv4(prefixLength === undefined ? transformed : networkOf(transformed, prefixLength));
}
