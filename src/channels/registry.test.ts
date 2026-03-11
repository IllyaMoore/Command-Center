import { describe, it, expect, beforeEach } from 'vitest';

import {
  registerChannel,
  getChannelFactory,
  getRegisteredChannelNames,
  clearRegistry,
} from './registry.js';

describe('channel registry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('getChannelFactory returns undefined for unknown channel', () => {
    expect(getChannelFactory('nonexistent')).toBeUndefined();
  });

  it('registerChannel and getChannelFactory round-trip', () => {
    const factory = () => null;
    registerChannel('test-channel', factory);
    expect(getChannelFactory('test-channel')).toBe(factory);
  });

  it('getRegisteredChannelNames includes registered channels', () => {
    registerChannel('test-channel', () => null);
    registerChannel('another-channel', () => null);
    const names = getRegisteredChannelNames();
    expect(names).toContain('test-channel');
    expect(names).toContain('another-channel');
  });

  it('later registration overwrites earlier one', () => {
    const factory1 = () => null;
    const factory2 = () => null;
    registerChannel('overwrite-test', factory1);
    registerChannel('overwrite-test', factory2);
    expect(getChannelFactory('overwrite-test')).toBe(factory2);
  });
});
