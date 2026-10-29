import type { StrategyCtx } from './types';
import { cryptoPanFromRaw } from './cryptopan';

/** Caller supplies bytes; this module never reads fixture files or persists keys. */
export function parseEvaluationKeys(text: string): [Uint8Array, Uint8Array] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length !== 2 || lines.some((s) => !/^[a-fA-F0-9]{64}$/.test(s))) throw new Error('invalid-evaluation-keys');
  const decode = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (v) => Number.parseInt(v, 16));
  return [decode(lines[0]), decode(lines[1])];
}

export async function deriveStrategyCtx(master: Uint8Array, operatorList: string[] = []): Promise<StrategyCtx> {
  if (master.length !== 32) throw new Error('invalid-key-length');
  const root = await crypto.subtle.importKey('raw', new Uint8Array(master), 'HKDF', false, ['deriveBits']);
  const derive = async (info: string): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.deriveBits({
    name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(info),
  }, root, 256));
  const hmac = async (info: string): Promise<CryptoKey> => {
    const bytes = await derive(info);
    try { return await crypto.subtle.importKey('raw', new Uint8Array(bytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); }
    finally { bytes.fill(0); }
  };
  const raw = await derive('s43/cryptopan');
  try {
    return { cryptopan: await cryptoPanFromRaw(raw), rcKey: await hmac('s43/random-consistent'),
      nameKey: await hmac('s43/names'), asnKey: await hmac('s43/asn'), secretKey: await hmac('s43/secrets'), operatorList: [...operatorList] };
  } finally { raw.fill(0); }
}

export async function freshStrategyCtx(operatorList: string[] = []): Promise<StrategyCtx> {
  const master = crypto.getRandomValues(new Uint8Array(32));
  try { return await deriveStrategyCtx(master, operatorList); } finally { master.fill(0); }
}
