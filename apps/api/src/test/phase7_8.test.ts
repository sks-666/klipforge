import { describe, it, expect, beforeEach } from 'vitest';
import { buildServer } from '../index';
import { checkOpenApiRateLimit, resetOpenApiRateLimits } from '../routes/open-api.routes';
import { detectVideoTypeFromUrl } from '../services/clipping.pipeline';

describe('Phase 7 & 8: Public Open API, Rate Limiter, Integrations & Security Headers', () => {
  beforeEach(() => {
    resetOpenApiRateLimits();
  });

  it('enforces 3 requests/minute per workspace on Public API create', () => {
    const wsId = 'ws_rate_test';
    expect(checkOpenApiRateLimit(wsId, 1000).allowed).toBe(true);
    expect(checkOpenApiRateLimit(wsId, 2000).allowed).toBe(true);
    expect(checkOpenApiRateLimit(wsId, 3000).allowed).toBe(true);
    const fourth = checkOpenApiRateLimit(wsId, 4000);
    expect(fourth.allowed).toBe(false);
    expect(fourth.reason).toContain('3 requests per minute');
  });

  it('correctly maps source video URLs to documented videoType 1..14', () => {
    expect(detectVideoTypeFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(2);
    expect(detectVideoTypeFromUrl('https://drive.google.com/file/d/123')).toBe(3);
    expect(detectVideoTypeFromUrl('https://vimeo.com/123456')).toBe(4);
    expect(detectVideoTypeFromUrl('https://www.tiktok.com/@user/video/123')).toBe(6);
    expect(detectVideoTypeFromUrl('https://x.com/user/status/123')).toBe(7);
    expect(detectVideoTypeFromUrl('https://www.loom.com/share/123')).toBe(10);
    expect(detectVideoTypeFromUrl('https://cdn.example.com/raw.mp4')).toBe(1);
  });

  it('returns code 4001 when YOURAPP_API_KEY header is missing and sets OWASP security headers', async () => {
    const app = buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/open-api/v1/project/create',
      payload: { videoUrl: 'https://www.youtube.com/watch?v=test' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe(4001);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-request-id']).toBeDefined();
    await app.close();
  });

  it('serves OpenAPI 3.1 spec, n8n workflow JSON, and Agent Skill markdown', async () => {
    const app = buildServer();

    const specRes = await app.inject({ method: 'GET', url: '/open-api/v1/openapi.json' });
    expect(specRes.statusCode).toBe(200);
    expect(specRes.json().openapi).toBe('3.1.0');

    const n8nRes = await app.inject({
      method: 'GET',
      url: '/open-api/v1/integrations/n8n-workflow.json',
    });
    expect(n8nRes.statusCode).toBe(200);
    expect(n8nRes.json().nodes.length).toBeGreaterThanOrEqual(3);

    const skillRes = await app.inject({
      method: 'GET',
      url: '/open-api/v1/integrations/klipforge-skill.md',
    });
    expect(skillRes.statusCode).toBe(200);
    expect(skillRes.body).toContain('name: klipforge-video-repurposing');

    await app.close();
  });
});

