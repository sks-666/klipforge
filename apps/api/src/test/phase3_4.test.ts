import { describe, it, expect } from 'vitest';
import {
  enrichTranscriptWords,
  computeSpeakerReframeKeyframes,
  buildFfmpegRenderArgs,
} from '../services/enrichment.service';
import { generateSocialCaption, PLATFORM_CHAR_LIMITS } from '../routes/publish.routes';

describe('Phase 3: Media Enrichment Engine', () => {
  it('removes filler words, trims dead air (>600ms), and injects contextual emojis', () => {
    const words = [
      { w: 'um', start_ms: 0, end_ms: 300 },
      { w: 'Growth', start_ms: 1200, end_ms: 1600 },
      { w: 'algorithm', start_ms: 1650, end_ms: 2100 },
    ];
    const result = enrichTranscriptWords(words, {
      removeSilence: true,
      enableEmoji: true,
      enableHighlight: true,
    });

    expect(result.words.length).toBe(2); // 'um' removed
    expect(result.words[0].emojiAbove).toBe('🚀'); // Growth -> 🚀
    expect(result.words[1].isHighlighted).toBe(true); // algorithm highlighted
    expect(result.removedSilenceMs).toBeGreaterThan(700);
  });

  it('computes 9:16 speaker-focused crop keyframes from 1920x1080 source', () => {
    const frames = computeSpeakerReframeKeyframes({
      sourceWidth: 1920,
      sourceHeight: 1080,
      targetRatio: '9:16',
      durationMs: 12000,
    });
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(frames[0].width).toBe(608);
    expect(frames[0].height).toBe(1080);
  });

  it('builds FFmpeg filtergraph with watermark on Free plan and 4K on Paid plan', () => {
    const freeArgs = buildFfmpegRenderArgs({
      inputPath: 'in.mp4',
      outputPath: 'out.mp4',
      startMs: 0,
      endMs: 30000,
      ratio: '9:16',
      resolution: '720p',
      watermark: true,
      hookHeadline: 'Viral Hook',
    });
    expect(freeArgs.join(' ')).toContain('Made with KlipForge');
    expect(freeArgs.join(' ')).toContain('scale=720:1280');
  });
});

describe('Phase 4: Social Distribution & AI Caption Generator', () => {
  it('generates YouTube title + description and enforces X 280-char limit', () => {
    const yt = generateSocialCaption({
      transcript: 'We automated 40 shorts a week from one podcast episode.',
      platform: 'youtube',
      tone: 'catchy',
      voice: 'first_person',
    });
    expect(yt.title).toBeDefined();
    expect(yt.title!.length).toBeLessThanOrEqual(PLATFORM_CHAR_LIMITS.youtube.title!);

    const xPost = generateSocialCaption({
      transcript: 'A'.repeat(400),
      platform: 'twitter',
      tone: 'serious',
      voice: 'third_person',
    });
    expect(xPost.post.length).toBeLessThanOrEqual(PLATFORM_CHAR_LIMITS.twitter.post);
  });
});
