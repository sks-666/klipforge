export const CONFIG = {
  port: Number(process.env.PORT || 4000),
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'super-secret-jwt-key-change-in-production',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'super-secret-refresh-key-change-in-production',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  cdnBaseUrl: process.env.CDN_BASE_URL || 'http://localhost:9000/klipforge-media',
  agentGeoBlocked: process.env.AGENT_GEO_BLOCKED === 'true',
};

