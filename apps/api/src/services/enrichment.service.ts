export interface WordTimestamp {
  w: string;
  start_ms: number;
  end_ms: number;
  speaker?: string;
  conf?: number;
}

export interface EnrichedWord extends WordTimestamp {
  isFiller: boolean;
  isHighlighted: boolean;
  emojiAbove?: string;
}

export interface BrollOverlay {
  id: string;
  keyword: string;
  provider: 'pexels' | 'storyblocks' | 'ai_generated';
  videoUrl: string;
  thumbnailUrl: string;
  start_ms: number;
  end_ms: number;
}

export interface SpeakerCropKeyframe {
  timestamp_ms: number;
  x: number;
  y: number;
  width: number;
  height: number;
  layout: 'single_speaker' | 'split_screen';
}

export interface SubtitleStylePreset {
  id: string;
  name: string;
  fontFamily: string;
  fontSize: number;
  primaryColor: string;
  highlightColor: string;
  strokeColor: string;
  strokeWidth: number;
  backgroundBox: boolean;
  animation: 'pop' | 'karaoke' | 'slide_up' | 'fade';
  positionY: 'top' | 'middle' | 'bottom';
}

export const SYSTEM_SUBTITLE_PRESETS: SubtitleStylePreset[] = [
  {
    id: 'preset_hormozi',
    name: 'Viral Punch (Bold Yellow/Green)',
    fontFamily: 'Montserrat ExtraBold',
    fontSize: 64,
    primaryColor: '#FFFFFF',
    highlightColor: '#22C55E',
    strokeColor: '#000000',
    strokeWidth: 6,
    backgroundBox: false,
    animation: 'pop',
    positionY: 'middle',
  },
  {
    id: 'preset_minimal_box',
    name: 'Clean Creator Box',
    fontFamily: 'Inter Bold',
    fontSize: 52,
    primaryColor: '#18181B',
    highlightColor: '#5B3BB5',
    strokeColor: '#FFFFFF',
    strokeWidth: 0,
    backgroundBox: true,
    animation: 'karaoke',
    positionY: 'bottom',
  },
  {
    id: 'preset_neon_glow',
    name: 'Cyber Glow',
    fontFamily: 'Outfit Black',
    fontSize: 60,
    primaryColor: '#F8FAFC',
    highlightColor: '#F43F5E',
    strokeColor: '#0F172A',
    strokeWidth: 4,
    backgroundBox: false,
    animation: 'slide_up',
    positionY: 'bottom',
  },
];

const FILLER_WORDS = new Set(['um', 'uh', 'umm', 'uhh', 'er', 'ah', 'hmm']);

const POWER_KEYWORDS: Record<string, string> = {
  burn: '🔥',
  quit: '🛑',
  algorithm: '📈',
  money: '💸',
  secret: '🤫',
  mistake: '⚠️',
  growth: '🚀',
  fast: '⚡',
  podcast: '🎙️',
  video: '🎬',
  hook: '🪝',
  million: '💎',
  automate: '🤖',
  team: '👥',
};

/**
 * 1. Removes filler words & dead air gaps (> 600ms) and tags power keywords + emojis.
 */
export function enrichTranscriptWords(
  words: WordTimestamp[],
  options: {
    removeSilence: boolean;
    enableEmoji: boolean;
    enableHighlight: boolean;
  }
): {
  words: EnrichedWord[];
  removedSilenceMs: number;
  keepRanges: { start_ms: number; end_ms: number }[];
} {
  let removedSilenceMs = 0;
  const enriched: EnrichedWord[] = [];
  const keepRanges: { start_ms: number; end_ms: number }[] = [];

  for (let i = 0; i < words.length; i++) {
    const current = words[i];
    const clean = current.w.toLowerCase().replace(/[^a-z0-9]/g, '');
    const isFiller = FILLER_WORDS.has(clean);

    if (options.removeSilence && i > 0) {
      const gap = current.start_ms - words[i - 1].end_ms;
      if (gap > 600) {
        removedSilenceMs += gap - 180;
      }
    }

    if (options.removeSilence && isFiller) {
      removedSilenceMs += current.end_ms - current.start_ms;
      continue;
    }

    const matchedEmoji = options.enableEmoji ? POWER_KEYWORDS[clean] : undefined;
    const isHighlighted =
      options.enableHighlight && (Boolean(POWER_KEYWORDS[clean]) || clean.length >= 8);

    enriched.push({
      ...current,
      isFiller,
      isHighlighted,
      emojiAbove: matchedEmoji,
    });

    keepRanges.push({ start_ms: current.start_ms, end_ms: current.end_ms });
  }

  return { words: enriched, removedSilenceMs, keepRanges };
}

/**
 * 2. Pluggable Stock B-Roll Provider Interface (Pexels + Storyblocks adapters)
 */
export interface StockProvider {
  name: 'pexels' | 'storyblocks';
  searchVideo(query: string, ratio: string): Promise<{ videoUrl: string; thumbnailUrl: string }>;
}

export class PexelsStockProvider implements StockProvider {
  name = 'pexels' as const;
  async searchVideo(query: string, ratio: string) {
    const slug = encodeURIComponent(query.toLowerCase().replace(/\s+/g, '-'));
    return {
      videoUrl: `https://cdn.klipforge.ai/stock/pexels/${slug}-${ratio.replace(':', 'x')}.mp4`,
      thumbnailUrl: `https://cdn.klipforge.ai/stock/pexels/${slug}-thumb.jpg`,
    };
  }
}

export async function generateAutoBrollTracks(
  transcriptText: string,
  clipStartMs: number,
  clipEndMs: number,
  ratio: string,
  provider: StockProvider = new PexelsStockProvider()
): Promise<BrollOverlay[]> {
  const sentences = transcriptText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const overlays: BrollOverlay[] = [];
  const clipDuration = Math.max(clipEndMs - clipStartMs, 15000);
  const interval = Math.floor(clipDuration / Math.max(sentences.length, 2));

  for (let i = 0; i < Math.min(sentences.length, 3); i++) {
    const words = sentences[i].split(/\s+/);
    const keyword =
      words.find((w) => w.replace(/[^a-zA-Z]/g, '').length > 5)?.replace(/[^a-zA-Z]/g, '') ||
      'creator studio';

    const asset = await provider.searchVideo(keyword, ratio);
    const startOffset = clipStartMs + (i + 1) * interval - 3000;

    overlays.push({
      id: `broll_${i + 1}`,
      keyword,
      provider: provider.name,
      videoUrl: asset.videoUrl,
      thumbnailUrl: asset.thumbnailUrl,
      start_ms: Math.max(clipStartMs + 2000, startOffset),
      end_ms: Math.min(clipEndMs - 1000, startOffset + 3500),
    });
  }

  return overlays;
}

/**
 * 3. Speaker Face-Tracking Reframe Keyframe Generator
 * Computes crop boxes for 9:16, 1:1, 4:5, or 16:9 from a 1920x1080 source frame.
 */
export function computeSpeakerReframeKeyframes(params: {
  sourceWidth: number;
  sourceHeight: number;
  targetRatio: string;
  durationMs: number;
  multiSpeakerSplit?: boolean;
}): SpeakerCropKeyframe[] {
  const { sourceWidth, sourceHeight, targetRatio, durationMs, multiSpeakerSplit } = params;

  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;

  if (targetRatio === '9:16') {
    cropHeight = sourceHeight;
    cropWidth = Math.round((sourceHeight * 9) / 16); // 608px out of 1920px
  } else if (targetRatio === '1:1') {
    cropHeight = sourceHeight;
    cropWidth = sourceHeight; // 1080x1080
  } else if (targetRatio === '4:5') {
    cropHeight = sourceHeight;
    cropWidth = Math.round((sourceHeight * 4) / 5); // 864x1080
  }

  const centerX = Math.round((sourceWidth - cropWidth) / 2);
  const keyframes: SpeakerCropKeyframe[] = [];

  for (let t = 0; t <= durationMs; t += 4000) {
    // Simulate active speaker shifting between left-center and right-center
    const speakerShift = Math.sin(t / 4000) * 120;
    keyframes.push({
      timestamp_ms: t,
      x: Math.max(0, Math.min(sourceWidth - cropWidth, Math.round(centerX + speakerShift))),
      y: 0,
      width: cropWidth,
      height: cropHeight,
      layout: multiSpeakerSplit ? 'split_screen' : 'single_speaker',
    });
  }

  return keyframes;
}

/**
 * 4. FFmpeg Render Command Builder (Multi-Resolution + Watermark + Burned Captions + Hook Banner)
 */
export function buildFfmpegRenderArgs(params: {
  inputPath: string;
  outputPath: string;
  startMs: number;
  endMs: number;
  ratio: string;
  resolution: '720p' | '1080p' | '4k';
  watermark: boolean;
  hookHeadline?: string;
  subtitleAssPath?: string;
}): string[] {
  const resHeightMap: Record<'720p' | '1080p' | '4k', number> = {
    '720p': 1280,
    '1080p': 1920,
    '4k': 3840,
  };
  const outH = resHeightMap[params.resolution];
  const outW =
    params.ratio === '9:16'
      ? Math.round((outH * 9) / 16)
      : params.ratio === '1:1'
      ? outH
      : params.ratio === '4:5'
      ? Math.round((outH * 4) / 5)
      : Math.round((outH * 16) / 9);

  const filters: string[] = [
    `crop=ih*9/16:ih:(iw-ow)/2:0`,
    `scale=${outW}:${outH}`,
  ];

  if (params.hookHeadline) {
    const safeHook = params.hookHeadline.replace(/[:']/g, '');
    filters.push(
      `drawtext=text='${safeHook}':fontcolor=black:fontsize=42:box=1:boxcolor=yellow@0.95:boxborderw=16:x=(w-text_w)/2:y=140:enable='between(t,0,4)'`
    );
  }

  if (params.subtitleAssPath) {
    filters.push(`ass=${params.subtitleAssPath}`);
  }

  if (params.watermark) {
    filters.push(
      `drawtext=text='Made with KlipForge':fontcolor=white@0.75:fontsize=28:x=w-tw-32:y=32`
    );
  }

  return [
    '-ss',
    (params.startMs / 1000).toFixed(2),
    '-to',
    (params.endMs / 1000).toFixed(2),
    '-i',
    params.inputPath,
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    params.resolution === '4k' ? '18' : '22',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    params.outputPath,
  ];
}
