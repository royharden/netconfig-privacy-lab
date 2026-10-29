import { describe, expect, it } from 'vitest';
import { cfg, kindAt, nodeAt, parseText, spanText } from './helpers';
import { parseIPv4 } from '../../src/core/ipv4';

const acl = (...entries: string[]) => parseText(cfg('ip access-list extended T', ...entries));

describe('construct: ACL entry inside a named ACL', () => {
  it('parses host/host with a destination port', () => {
    const f = acl(' permit tcp host 10.11.1.1 host 192.0.2.1 eq 443');
    const n = nodeAt(f, 2, 'acl-entry');
    expect(n.aclName).toBe('T');
    expect(n.numberTok).toBeNull();
    expect(n.action).toBe('permit');
    expect(n.protocol).toBe('tcp');
    expect(n.src.type).toBe('host');
    if (n.src.type === 'host') expect(n.src.address).toEqual({ text: '10.11.1.1', start: 17, end: 26 });
    if (n.dst.type === 'host') expect(spanText(f, 2, n.dst.address)).toBe('192.0.2.1');
    expect(n.portValue).toBe(443);
    expect(f.device.acls[0]?.entries[0]?.dst).toEqual({ type: 'host', address: parseIPv4('192.0.2.1') });
  });

  it('parses any and contiguous wildcard address/wildcard pairs for every protocol', () => {
    const f = acl(' deny ip 10.0.0.0 0.255.255.255 any', ' permit udp any 172.41.3.0 0.0.0.255 eq 53', ' permit icmp any any');
    const first = nodeAt(f, 2, 'acl-entry');
    expect(first.protocol).toBe('ip');
    expect(first.src.type).toBe('wildcard');
    if (first.src.type === 'wildcard') {
      expect(first.src.prefixLength).toBe(8);
      expect(spanText(f, 2, first.src.wildcard)).toBe('0.255.255.255');
    }
    expect(nodeAt(f, 3, 'acl-entry').dst).toMatchObject({ type: 'wildcard', prefixLength: 24 });
    expect(nodeAt(f, 4, 'acl-entry').protocol).toBe('icmp');
    expect(f.device.acls[0]?.entries.map((e) => e.ordinal)).toEqual([1, 2, 3]);
  });

  it('rejects ports on ip/icmp, port ranges, source ports, non-contiguous wildcards and host bits inside the wildcard', () => {
    const bad = [
      ' permit ip any any eq 80',
      ' permit icmp any any eq 8',
      ' permit tcp any any range 1 2',
      ' permit tcp any eq 80 any',
      ' permit tcp any any gt 1023',
      ' permit tcp any 10.0.0.0 0.255.0.255',
      ' permit tcp any 10.0.0.1 0.0.0.255',
      ' permit tcp any any eq 70000',
      ' permit gre any any',
      ' permit tcp any',
    ];
    for (const line of bad) {
      const f = acl(line);
      expect(kindAt(f, 2)).toBe('unknown');
      // every unknown line inside an ACL block is forwarding-affecting
      expect(f.device.unknownLines[0]?.forwardingAffecting).toBe(true);
    }
  });
});
