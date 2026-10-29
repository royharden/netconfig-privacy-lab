export async function hmacBytes(key: CryptoKey, text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

export type NameDomain = 'hostname' | 'domain' | 'username' | 'acl-name' | 'text';
/** Local collision registry is private to one invocation and is never returned in an Outcome. */
export function createPseudonymizer(key: CryptoKey): (domain: NameDomain, value: string) => Promise<string> {
  const owners = new Map<string, string>();
  return async (domain, value) => {
    const normalized = domain === 'hostname' || domain === 'domain' ? value.toLowerCase() : value;
    const identity = `${domain}\0${normalized}`;
    const bytes = await hmacBytes(key, identity);
    const length = value.length <= 8 ? 8 : value.length <= 16 ? 16 : value.length <= 32 ? 32 : 48;
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let output = 'p';
    for (let i = 1; i < length; i++) output += alphabet[bytes[(i - 1) % bytes.length] % alphabet.length];
    const slot = `${domain}\0${output}`;
    const owner = owners.get(slot);
    if (owner !== undefined && owner !== identity) throw new Error('pseudonym-collision');
    owners.set(slot, identity);
    return output;
  };
}

/** Each secret occurrence has its own nonce, so repeated secrets are never mapped consistently. */
export async function replaceSecret(key: CryptoKey, family: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const bytes = await hmacBytes(key, `${family}\0${Array.from(nonce).join(',')}`);
  nonce.fill(0);
  const body = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return family === 'community' ? `c${body.slice(0, 23)}` : family === '5' ? `$1$${body.slice(0, 8)}$${body.slice(8, 30)}` : `$9$${body.slice(0, 14)}$${body.slice(14, 57)}`;
}
