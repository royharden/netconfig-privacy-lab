import { describe, expect, it } from 'vitest';
import { cryptoPan, cryptoPanAddress, cryptoPanFromRaw } from '../../src/strategies/cryptopan';
import { commonPrefixLength, parseIPv4 } from '../../src/core/ipv4';

describe('Crypto-PAn raw-key conformance', () => {
  it('matches the attributed yacryptopan README example without HKDF', async () => {
    const key = await cryptoPanFromRaw(new TextEncoder().encode('32-char-str-for-AES-key-and-pad.'));
    expect(await cryptoPanAddress('192.0.2.1', key)).toBe('192.0.125.244');
  });
  it.skip('Yawning sample 128.11.68.132 -> 135.242.180.132: copy full pinned source key beginning 21,34,23,141 before enabling', () => {
    // Remaining key bytes intentionally absent: they must never be invented.
  });
  it('maps a query-only address with the same primitive and preserves shared prefix lengths', async () => {
    const key = await cryptoPanFromRaw(new Uint8Array(32));
    const a = parseIPv4('10.2.3.1')!, b = parseIPv4('10.2.3.222')!;
    expect(commonPrefixLength(await cryptoPan(a, key), await cryptoPan(b, key))).toBe(commonPrefixLength(a, b));
    expect(await cryptoPanAddress('203.0.113.77', key)).toBe(await cryptoPanAddress('203.0.113.77', key));
  });
});
