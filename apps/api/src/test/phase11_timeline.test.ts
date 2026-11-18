import { describe, it, expect } from 'vitest';
import {
  Timeline,
  MediaRef,
  buildTimelineRender,
  defaultTimeline,
  expandEasing,
  memeItTimeline,
  piecewise,
  segmentDuration,
  timelineDuration,
  timelineSchema,
} from '../services/timeline.service';

const kf = (t: number, over: Partial<{ x: number; y: number; scale: number; rotation: number; opacity: number }> = {}) => ({
  t, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, ...over,
});

const assets: Record<string, MediaRef> = {
  green: { path: '/tmp/green.mp4', kind: 'video', width: 720, height: 720, durationSec: 3, hasAudio: false, hasAlpha: false, peakDb: -3 },
  skull: { path: '/tmp/skull.png', kind: 'image', width: 512, height: 512, durationSec: 3, hasAudio: false, hasAlpha: true, peakDb: -3 },
  boom: { path: '/tmp/boom.m4a', kind: 'audio', width: 0, height: 0, durationSec: 1.8, hasAudio: true, hasAlpha: false, peakDb: -9 },
};
const source = { path: '/tmp/source.mp4', width: 1280, height: 720, hasAudio: true };

function sample(): Timeline {
  const tl = defaultTimeline({ srcIn: 100, srcOut: 110, captions: [] });
  tl.base = [
    { id: 'a', kind: 'source', srcIn: 100, srcOut: 104, speed: 1, preservePitch: true },
    { id: 'f', kind: 'freeze', freezeOf: 'source', srcIn: 104, srcOut: 104, freezeDur: 1.5, speed: 1, preservePitch: true },
    { id: 'c', kind: 'asset', assetId: 'green', srcIn: 0, srcOut: 2, speed: 1, preservePitch: true },
    { id: 'b', kind: 'source', srcIn: 104, srcOut: 106, speed: 0.5, preservePitch: false },
  ];
  tl.overlays = [
    { id: 'o1', track: 2, assetId: 'skull', start: 4, end: 5.5, assetIn: 0, blend: 'normal', keyframes: [kf(0, { scale: 0.3 }), kf(0.2, { scale: 1.2, rotation: 10, opacity: 0.6 })] },
    { id: 'o2', track: 3, assetId: 'green', start: 8, end: 10, assetIn: 0, blend: 'normal', chroma: { enabled: true, color: '#00FF00', similarity: 0.4, smoothness: 0.2, spill: 0.5 }, keyframes: [kf(0)] },
    { id: 'o3', track: 4, assetId: 'skull', start: 10, end: 11, assetIn: 0, blend: 'screen', fullFrame: true, keyframes: [kf(0, { opacity: 0.35 })] },
  ];
  tl.audio = [{ id: 's1', track: 2, assetId: 'boom', start: 4, end: 5.8, assetIn: 0, gainDb: 0 }];
  tl.camera = [
    { t: 3.9, scale: 1, x: 0.5, y: 0.5, shake: 0 },
    { t: 3.96, scale: 2.5, x: 0.4, y: 0.45, shake: 25 },
    { t: 5, scale: 2.5, x: 0.4, y: 0.45, shake: 0 },
    { t: 5.1, scale: 1, x: 0.5, y: 0.5, shake: 0 },
  ];
  return tl;
}

describe('Phase 11: timeline engine', () => {
  it('computes segment and total durations (speed, freeze, cutaway)', () => {
    const tl = sample();
    expect(tl.base.map(segmentDuration)).toEqual([4, 1.5, 2, 4]);
    expect(timelineDuration(tl)).toBeCloseTo(11.5, 5);
  });

  it('builds balanced piecewise expressions (shallow nesting)', () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({ t: i * 0.1, v: Math.sin(i) }));
    const expr = piecewise(pts);
    let depth = 0;
    let max = 0;
    for (const ch of expr) {
      if (ch === '(') max = Math.max(max, ++depth);
      if (ch === ')') depth--;
    }
    expect(max).toBeLessThan(25);
    expect(piecewise([{ t: 0, v: 2 }, { t: 1, v: 2 }])).toBe('2.0000');
  });

  it('validates timelines with the API schema', () => {
    expect(timelineSchema.safeParse(sample()).success).toBe(true);
    const bad = { ...sample(), width: 720 };
    expect(timelineSchema.safeParse(bad).success).toBe(false);
  });

  it('compiles every module into one ffmpeg graph', () => {
    const plan = buildTimelineRender({ timeline: sample(), source, assets, outPath: '/tmp/out.mp4', cleanOutPath: '/tmp/clean.mp4' });
    const args = plan.build(['-c:v', 'libx264']);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(plan.durationSec).toBeCloseTo(11.5, 5);
    // pillarbox: low-res blurred cover background + fitted foreground
    expect(graph).toContain('gblur');
    expect(graph).toMatch(/colorchannelmixer=rr=0\.800/);
    // freeze frame + slow-mo without pitch preservation
    expect(graph).toContain('tpad=stop_mode=clone');
    expect(graph).toMatch(/asetrate=24000/);
    // ripple concat of 4 base segments
    expect(graph).toContain('concat=n=4:v=1:a=1');
    // punch zoom only inside its window
    expect(graph).toContain('zoompan');
    expect(graph).toMatch(/split=3\[w0p\]\[w0m\]\[w0n\]/);
    // chroma key + spill, keyframed scale/rotation/opacity, screen blend
    expect(graph).toContain('chromakey=color=0x00FF00');
    expect(graph).toContain('despill=type=green');
    expect(graph).toContain('rotate=');
    expect(graph).toContain("geq=");
    expect(graph).toContain('blend=all_mode=screen');
    // audio: normalised SFX (-3 dBFS from a -9 dB peak = +6 dB), ducking, mix
    expect(graph).toMatch(/volume=6\.00dB/);
    expect(graph).toMatch(/volume=volume='1\.0000\*\(1-0\.7488\*/);
    expect(graph).toContain('amix=inputs=2');
    // two outputs: final + caption-free clean copy
    expect(args.filter((a) => a === '-map').length).toBe(4);
    expect(args).toContain('/tmp/clean.mp4');
    expect(args.slice(-1)[0]).toBe('/tmp/clean.mp4');
    // 60 fps output
    expect(graph).toContain('fps=60');
  });

  it('rejects timelines that reference the source when it is missing', () => {
    expect(() => buildTimelineRender({ timeline: sample(), source: null, assets, outPath: '/tmp/x.mp4' })).toThrow(/source video/);
  });

  it('bakes easing curves into extra keyframes', () => {
    const keys = expandEasing([
      { t: 0, x: 0, y: 0, scale: 0, rotation: 0, opacity: 0, ease: 'easeOut' },
      { t: 1, x: 1, y: 1, scale: 1, rotation: 0, opacity: 1 },
    ]);
    expect(keys.length).toBe(11);
    // ease-out is ahead of linear at the midpoint
    expect(keys[5].x).toBeGreaterThan(0.8);
    expect(keys[10].x).toBe(1);
  });

  it('renders transitions only around their cut', () => {
    const tl = sample();
    tl.base[2] = { ...tl.base[2], transitionIn: 'flash' };
    tl.base[3] = { ...tl.base[3], transitionIn: 'glitch' };
    const args = buildTimelineRender({ timeline: tl, source, assets, outPath: '/tmp/o.mp4' }).build([]);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain("eq=brightness='0.85*");
    expect(graph).toContain('rgbashift=');
    expect(graph).toMatch(/trim=start=5\.3800:end=5\.7800/); // flash window at the 5.5 s cut
  });

  it('builds a Meme-it edit: punch zoom, freeze, sticker, replay, SFX', () => {
    const base = defaultTimeline({ srcIn: 100, srcOut: 120, captions: [] });
    const names: Record<string, string> = { 'Bass Boom': 'boom', Whoosh: 'whoosh', 'Crowd Roar': 'roar', Fire: 'fire', 'Air Horn': 'horn', 'Crying laughing': 'laugh' };
    const find = (n: string) => (names[n] ? { id: names[n], durationSec: 1.5 } : null);
    const tl = memeItTimeline(base, { offsetSec: 13, situation: 'opener', late: true }, find);
    const kinds = tl.base.map((s) => `${s.kind}${s.speed !== 1 ? '@' + s.speed : ''}${s.transitionIn ? ':' + s.transitionIn : ''}`);
    expect(kinds).toEqual(['source', 'freeze:flash', 'source@0.5:whip', 'source:zoom']);
    expect(timelineDuration(tl)).toBeCloseTo(20 + 1.2 + 5.6, 3);
    expect(tl.camera.some((k) => k.scale > 1.5)).toBe(true);
    expect(tl.overlays.map((o) => o.assetId)).toContain('laugh'); // late goal -> crying-laughing sticker
    expect(tl.audio.map((a) => a.assetId).sort()).toEqual(['boom', 'horn', 'roar', 'whoosh']);
    expect(tl.captions.some((c) => c.text.includes('INSTANT REPLAY'))).toBe(true);
    expect(timelineSchema.safeParse(tl).success).toBe(true);
  });
});
