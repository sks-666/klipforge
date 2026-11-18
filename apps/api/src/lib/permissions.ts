import { Role } from '@prisma/client';

export type PlanFeatureKey =
  | 'watermark'
  | 'maxRes'
  | 'schedulePosts'
  | 'storageGb'
  | 'brandKit'
  | 'shareProject'
  | 'apiAccess'
  | 'inviteTeam';

export interface PlanFeatures {
  watermark: boolean;
  maxRes: '720p' | '1080p' | '4k';
  schedulePosts: boolean;
  storageGb: number;
  brandKit: boolean;
  shareProject: boolean;
  apiAccess: boolean;
  inviteTeam: boolean;
}

/**
 * Shared helper `can(feature)` driven by `plans.features_json`
 * Used across API guards and UI response payloads.
 */
export function can(featuresJson: unknown, feature: PlanFeatureKey): boolean {
  if (!featuresJson || typeof featuresJson !== 'object') return false;
  const f = featuresJson as Record<string, unknown>;
  if (feature === 'watermark') {
    // Returns true if user CAN export without watermark
    return f.watermark === false;
  }
  if (feature === 'maxRes') {
    return f.maxRes === '4k' || f.maxRes === '1080p';
  }
  return Boolean(f[feature]);
}

const ROLE_WEIGHT: Record<Role, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

export function hasMinimumRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_WEIGHT[userRole] >= ROLE_WEIGHT[requiredRole];
}
