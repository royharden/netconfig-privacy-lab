import { feistel } from './asn';
import { makeLabStrategy } from './lab';

/** A permutation over all 2^32 inputs: consistent, with no prefix-preservation promise. */
export const randomConsistentIPv4 = (value: number, key: CryptoKey): Promise<number> => feistel(value >>> 0, 16, key, 'ipv4');
export const randomConsistent = makeLabStrategy('random-consistent');
