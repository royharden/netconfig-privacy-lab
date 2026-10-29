import { hmacBytes } from './pseudonym';

export const ASN_POOLS = [{ start: 1, end: 64495, size: 64494 }, { start: 64496, end: 64511, size: 16 }, { start: 64512, end: 65534, size: 1023 }] as const;

/** Balanced four-round Feistel, then cycle-walk a finite pool. Every walk terminates on its starting cycle. */
export async function feistel(value: number, halfBits: number, key: CryptoKey, domain: string): Promise<number> {
  const radix = 2 ** halfBits;
  let left = Math.floor(value / radix), right = value % radix;
  for (let round = 0; round < 4; round++) {
    const digest = await hmacBytes(key, `${domain}\0${round}\0${right}`);
    const f = ((digest[0] * 256 + digest[1]) % radix);
    [left, right] = [right, left ^ f];
  }
  return left * radix + right;
}

export async function permuteAsn(value: string, key: CryptoKey): Promise<{ value: string; diagnostic?: 'asn-out-of-range' }> {
  const n = Number(value);
  const pool = ASN_POOLS.find((p) => n >= p.start && n <= p.end && n !== 23456);
  if (!pool || !Number.isInteger(n)) return { value, diagnostic: 'asn-out-of-range' };
  const index = n - pool.start - (pool.start === 1 && n > 23456 ? 1 : 0);
  const half = Math.ceil(Math.log2(pool.size) / 2);
  let mapped = index;
  do { mapped = await feistel(mapped, half, key, `asn/${pool.start}`); } while (mapped >= pool.size);
  let result = mapped + pool.start;
  if (pool.start === 1 && result >= 23456) result++;
  return { value: String(result) };
}
