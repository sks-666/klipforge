export type PlanFeatureKey =
  | 'watermark'
  | 'maxRes'
  | 'brandKit'
  | 'apiAccess'
  | 'schedulePosts'
  | 'storageGb'
  | 'shareProject'
  | 'inviteTeam';

export function can(featuresJson: Record<string, unknown> | null | undefined, feature: PlanFeatureKey): boolean {
  if (!featuresJson) return false;
  if (feature === 'watermark') {
    return featuresJson.watermark === false;
  }
  return Boolean(featuresJson[feature]);
}

