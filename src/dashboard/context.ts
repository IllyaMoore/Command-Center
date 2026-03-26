import { GroupQueue } from '../group-queue.js';

let _queue: GroupQueue | null = null;

export function setDashboardQueue(q: GroupQueue): void {
  _queue = q;
}

export function getDashboardQueue(): GroupQueue | null {
  return _queue;
}
