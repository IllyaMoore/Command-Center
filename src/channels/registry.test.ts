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

  it('throws on duplicate registration', () => {
    const factory1 = () => null;
    const factory2 = () => null;
    registerChannel('duplicate-test', factory1);
    expect(() => registerChannel('duplicate-test', factory2)).toThrow('already registered');
  });
});
