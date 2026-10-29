import type { Family } from '../core/types';
import type { Prng } from './prng';
export interface Link { a: number; b: number; shutdown: boolean }
export interface Topology { family: Family; count: number; links: Link[] }
export function ring(count: number): Link[] {
  return Array.from({ length: count }, (_, i) => ({ a: i, b: (i + 1) % count, shutdown: i === count - 1 }));
}
export function hubAndSpoke(count: number): Link[] {
  return Array.from({ length: count - 1 }, (_, i) => ({ a: 0, b: i + 1, shutdown: false }));
}
export function campusTree(count: number): Link[] {
  return Array.from({ length: count - 1 }, (_, i) => ({ a: Math.floor(i / 2), b: i + 1, shutdown: false }));
}
export function dualIspEdge(count: number): Link[] {
  return Array.from({ length: count - 1 }, (_, i) => ({ a: i === 0 ? 0 : 1, b: i + 1, shutdown: false }));
}
export function buildTopology(family: Family, count: number, random: Prng): Topology {
  if (!Number.isInteger(count) || count < 3 || count > 8) throw new Error('device count must be 3–8');
  const links = ({ ring, 'hub-and-spoke': hubAndSpoke, 'campus-tree': campusTree, 'dual-isp-edge': dualIspEdge })[family](count);
  // Vary node assignment without changing the family. Edge/hub/root remains node zero.
  const permutation = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 1; i--) {
    const j = random.int(1, i); [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
  }
  return { family, count, links: links.map((l) => ({ ...l, a: permutation[l.a], b: permutation[l.b] })) };
}
/** First adjacent node on the unique active path (ring's disabled edge is excluded). */
export function firstHop(topology: Topology, source: number, destination: number): number {
  const queue: { node: number; first: number }[] = [{ node: source, first: -1 }];
  const seen = new Set([source]);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current.node === destination) return current.first;
    for (const l of topology.links) {
      if (l.shutdown) continue;
      const next = l.a === current.node ? l.b : l.b === current.node ? l.a : -1;
      if (next < 0 || seen.has(next)) continue;
      seen.add(next); queue.push({ node: next, first: current.first < 0 ? next : current.first });
    }
  }
  throw new Error('disconnected active topology');
}
