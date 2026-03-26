import { GroupQueue } from '../group-queue.js';
import { RegisteredGroup } from '../types.js';

let _queue: GroupQueue | null = null;

export function setDashboardQueue(q: GroupQueue): void {
  _queue = q;
}

export function getDashboardQueue(): GroupQueue | null {
  return _queue;
}

// Delegation runner — set by index.ts to avoid circular imports
type DelegationRunner = (group: RegisteredGroup, prompt: string, chatJid: string) => Promise<string>;
let _delegationRunner: DelegationRunner | null = null;

export function setDelegationRunner(fn: DelegationRunner): void {
  _delegationRunner = fn;
}

export function getDelegationRunner(): DelegationRunner | null {
  return _delegationRunner;
}
