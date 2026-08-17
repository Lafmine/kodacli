import {describe, expect, it} from 'vitest';
import {resolvePermission} from '../src/core/permissions.js';

describe('resolvePermission', () => {
  it('allows reads in every mode', () => {
    expect(resolvePermission('default', 'read')).toBe('allow');
    expect(resolvePermission('plan', 'read')).toBe('allow');
    expect(resolvePermission('bypass', 'read')).toBe('allow');
  });

  it('asks for risky actions in default mode', () => {
    expect(resolvePermission('default', 'write')).toBe('ask');
    expect(resolvePermission('default', 'shell')).toBe('ask');
  });

  it('denies risky actions in plan and allows them in bypass', () => {
    expect(resolvePermission('plan', 'write')).toBe('deny');
    expect(resolvePermission('plan', 'shell')).toBe('deny');
    expect(resolvePermission('bypass', 'write')).toBe('allow');
  });
});
