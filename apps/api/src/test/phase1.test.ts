import { describe, it, expect } from 'vitest';
import { can, hasMinimumRole } from '../lib/permissions';

describe('Phase 1 Foundation: Plan Feature Gate & RBAC', () => {
  const freeFeatures = {
    watermark: true,
    maxRes: '720p',
    schedulePosts: false,
    brandKit: false,
    apiAccess: false,
    inviteTeam: false,
  };

  const businessFeatures = {
    watermark: false,
    maxRes: '4k',
    schedulePosts: true,
    brandKit: true,
    apiAccess: true,
    inviteTeam: true,
  };

  it('correctly gates features on Free plan', () => {
    expect(can(freeFeatures, 'watermark')).toBe(false); // cannot remove watermark
    expect(can(freeFeatures, 'brandKit')).toBe(false);
    expect(can(freeFeatures, 'apiAccess')).toBe(false);
    expect(can(freeFeatures, 'inviteTeam')).toBe(false);
  });

  it('unlocks all capabilities on Business plan', () => {
    expect(can(businessFeatures, 'watermark')).toBe(true); // can remove watermark
    expect(can(businessFeatures, 'brandKit')).toBe(true);
    expect(can(businessFeatures, 'apiAccess')).toBe(true);
    expect(can(businessFeatures, 'inviteTeam')).toBe(true);
  });

  it('enforces hierarchical RBAC roles', () => {
    expect(hasMinimumRole('owner', 'admin')).toBe(true);
    expect(hasMinimumRole('editor', 'admin')).toBe(false);
    expect(hasMinimumRole('viewer', 'editor')).toBe(false);
  });
});
