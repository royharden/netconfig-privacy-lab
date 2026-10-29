import { identity } from './identity';
import { naiveMask } from './naiveMask';
import { labDrop, labScrub, labScrubKey2 } from './lab';
import { randomConsistent } from './randomConsistent';
import type { Arm, Strategy } from './types';

export const LOCAL_ARMS = ['identity', 'naive-mask', 'random-consistent', 'lab-scrub', 'lab-drop', 'lab-scrub@key2'] as const;
export const strategies: Readonly<Partial<Record<Arm, Strategy>>> = {
  identity, 'naive-mask': naiveMask, 'random-consistent': randomConsistent,
  'lab-scrub': labScrub, 'lab-drop': labDrop, 'lab-scrub@key2': labScrubKey2,
};
export function getStrategy(arm: Arm): Strategy | undefined { return strategies[arm]; }
