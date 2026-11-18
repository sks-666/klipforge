import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg';
const PYTHON_BIN = fs.existsSync('/usr/local/bin/python3') ? '/usr/local/bin/python3' : 'python3';
export const CAPTION_CARD_SCRIPT = path.resolve(__dirname, '../../scripts/render_caption_cards.py');

export type CaptionStyle = 'impact' | 'pill' | 'meme' | 'score' | 'neon' | 'outline' | 'sticker';
export const CAPTION_STYLES: CaptionStyle[] = ['impact', 'pill', 'meme', 'score', 'neon', 'outline', 'sticker'];
export type CaptionAnim = 'pop' | 'shake' | 'slide' | 'none';
export const CAPTION_ANIMS: CaptionAnim[] = ['pop', 'shake', 'slide', 'none'];

/** One animated caption on a clip. Times are seconds from the start of the clip. */
export interface CaptionCue {
  id: string;
  text: string;
  style: CaptionStyle;
  color?: string;
  /** font size as a fraction of the frame width */
  size: number;
  startSec: number;
  endSec: number;
  /** vertical centre as a fraction of the frame height */
  yFrac: number;
  /** horizontal centre as a fraction of the frame width (default 0.5) */
  xFrac?: number;
  anim: CaptionAnim;
  left?: { text: string; color: string };
  right?: { text: string; color: string };
}

/** Goal context produced by scripts/detect_football_goals.py */
export interface GoalContext {
  number: number;
  total: number;
  offsetSec: number;
  team: number;
  scoreBefore: [number, number];
  scoreAfter: [number, number];
  situation: 'opener' | 'equaliser' | 'go_ahead' | 'extends_lead' | 'pulls_back';
  late: boolean;
  teams: Array<{ kit: string; color: string }>;
}

const pick = <T,>(list: T[], seed: number): T => list[Math.abs(seed) % list.length];

const KIT_DEFAULT_NAME: Record<string, string> = {
  red: 'THE REDS',
  orange: 'THE ORANGES',
  yellow: 'THE YELLOWS',
  blue: 'THE BLUES',
  sky: 'THE SKY BLUES',
  purple: 'THE PURPLES',
  pink: 'THE PINKS',
  white: 'THE WHITES',
  black: 'THE BLACKS',
  opponent: 'THE OPPONENTS',
};

/**
 * Team display names: project option `teams` maps kit colour -> name
 * (e.g. {"red": "AC Milan", "white": "Lecce"}); otherwise "THE REDS" / "THE WHITES".
 */
export function resolveTeamNames(
  goal: GoalContext,
  teamNames?: Record<string, string> | null
): [string, string] {
  const name = (i: number) => {
    const kit = goal.teams?.[i]?.kit || (i === 0 ? 'red' : 'opponent');
    return (teamNames?.[kit] || KIT_DEFAULT_NAME[kit] || kit).toUpperCase();
  };
  return [name(0), name(1)];
}

const teamColor = (goal: GoalContext, i: number) =>
  goal.teams?.[i]?.color || (i === 0 ? '#d7262e' : '#f4f4f4');

/**
 * Caption plan for a goal clip: hook -> live score chip -> "GOOOAL!" burst -> situation headline
 * + meme line during the celebration. Every line uses the real teams, score and situation.
 */
export function buildGoalCaptions(params: {
  goal: GoalContext;
  clipDurSec: number;
  teamNames?: Record<string, string> | null;
  emoji?: boolean;
}): CaptionCue[] {
  const { goal, clipDurSec } = params;
  const [nameA, nameB] = resolveTeamNames(goal, params.teamNames);
  const names = [nameA, nameB];
  const scorer = names[goal.team] || nameA;
  const opponent = names[1 - goal.team] || nameB;
  const [a0, b0] = goal.scoreBefore;
  const [a1, b1] = goal.scoreAfter;
  const g = Math.max(3, Math.min(clipDurSec - 3, goal.offsetSec));
  const end = clipDurSec;
  const seed = goal.number * 7 + goal.total;
  const isFinalGoal = goal.number === goal.total;
  const usScore = goal.scoreAfter[goal.team];
  const themScore = goal.scoreAfter[1 - goal.team];

  const hookBySituation: Record<GoalContext['situation'], string[]> = {
    opener: ['WAIT FOR IT… 👀', `${scorer} ARE ABOUT TO STRIKE 👀`, 'WATCH THE FINISH 🎯'],
    equaliser: [`${scorer} REFUSE TO LOSE 😤`, `${a0}-${b0}… NOT FOR LONG 😏`, `${scorer} AREN'T DONE 👀`],
    go_ahead: [`${a0}-${b0}… SOMEBODY HAS TO BREAK IT 👀`, `${scorer} SMELL BLOOD 🦈`, 'WATCH THIS RUN 👀'],
    extends_lead: [`${scorer} WANT MORE 😈`, `${opponent} HANGING ON 😬`, 'IT GETS WORSE… 💀'],
    pulls_back: [`${scorer} AREN'T DONE YET 👀`, 'COMEBACK LOADING ⏳', `${opponent} GOT COMFY… 😴`],
  };
  const headlineBySituation: Record<GoalContext['situation'], string[]> = {
    opener: [`${scorer} DRAW FIRST BLOOD 🩸`, `${scorer} BREAK THE DEADLOCK 🔓`],
    equaliser: [`${scorer} LEVEL IT ${a1}-${b1} 😤`, `ALL SQUARE ${a1}-${b1} ⚖️`],
    go_ahead: [`${scorer} TAKE THE LEAD 🔥`, `${scorer} IN FRONT ${a1}-${b1} 🔥`],
    extends_lead: [`${scorer} RUNNING RIOT 💨`, `${usScore}-${themScore}. COOKED 🍳`],
    pulls_back: [`GAME ON ${a1}-${b1} 👀`, `${scorer} PULL ONE BACK 💪`],
  };
  const memeBySituation: Record<GoalContext['situation'], string[]> = {
    opener: [`${opponent} defence: 🧍🧍🧍`, 'Keeper didn’t even move 💀', 'Cold. Absolutely cold 🥶'],
    equaliser: [`${opponent} fans rn: 😐`, 'Bro said "not today" 😤', 'Momentum? Stolen 🥷'],
    go_ahead: [`${opponent} keeper: I'm not even mad 💀`, 'Ice in his veins 🧊', 'Somebody call security, that was theft 🚨'],
    extends_lead: [`${opponent} defence on holiday 🏖`, 'Stop, they’re already dead 💀', 'Cheat codes enabled 🎮'],
    pulls_back: ['Comeback szn loading ⏳', 'Plot twist incoming 🍿', `${opponent}: wait, it's not over? 😳`],
  };

  let hook = pick(hookBySituation[goal.situation], seed);
  let headline = pick(headlineBySituation[goal.situation], seed + 1);
  let meme = pick(memeBySituation[goal.situation], seed + 2);
  if (goal.late && isFinalGoal) {
    hook = 'LATE DRAMA INCOMING ⏰';
    headline =
      goal.situation === 'equaliser' ? `LAST-GASP EQUALISER ⏰ ${a1}-${b1}` : `LATE, LATE WINNER ⏰ ${a1}-${b1}`;
    meme = a1 + b1 >= 6 ? `${a1}-${b1}?! Somebody check on the keepers 😭` : 'Nobody is leaving early 🍿';
  }

  const cues: CaptionCue[] = [
    {
      id: 'hook',
      text: hook,
      style: 'pill',
      color: '#7c3aed',
      size: 0.058,
      startSec: 0.2,
      endSec: Math.min(3.4, g - 1),
      yFrac: 0.16,
      anim: 'pop',
    },
    {
      id: 'score_before',
      text: `${a0} - ${b0}`,
      style: 'score',
      size: 0.045,
      startSec: Math.min(3.5, g - 0.8),
      endSec: g + 0.35,
      yFrac: 0.09,
      anim: 'slide',
      left: { text: nameA, color: teamColor(goal, 0) },
      right: { text: nameB, color: teamColor(goal, 1) },
    },
    {
      id: 'score_after',
      text: `${a1} - ${b1}`,
      style: 'score',
      size: 0.045,
      startSec: g + 0.35,
      endSec: end,
      yFrac: 0.09,
      anim: 'pop',
      left: { text: nameA, color: teamColor(goal, 0) },
      right: { text: nameB, color: teamColor(goal, 1) },
    },
    {
      id: 'goal',
      text: pick(['GOOOAL! ⚽', 'GOOOOOAL! ⚽🔥', 'WHAT A GOAL! ⚽'], seed),
      style: 'impact',
      color: '#ffd60a',
      size: 0.135,
      startSec: g - 0.1,
      endSec: g + 2.3,
      yFrac: 0.42,
      anim: 'shake',
    },
    {
      id: 'headline',
      text: headline,
      style: 'impact',
      color: '#ffffff',
      size: 0.085,
      startSec: g + 2.35,
      endSec: end,
      yFrac: 0.4,
      anim: 'pop',
    },
    {
      id: 'meme',
      text: meme,
      style: 'meme',
      size: 0.056,
      startSec: g + 3.1,
      endSec: end,
      yFrac: 0.74,
      anim: 'slide',
    },
  ];

  const strip = (t: string) =>
    t
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{231A}-\u{23FF}️‍]/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

  return cues
    .filter((c) => c.endSec - c.startSec >= 0.4 && c.startSec < clipDurSec)
    .map((c) => ({
      ...c,
      startSec: Math.max(0, Math.round(c.startSec * 100) / 100),
      endSec: Math.min(clipDurSec, Math.round(c.endSec * 100) / 100),
      text: params.emoji === false ? strip(c.text) : c.text,
    }));
}

/** ffmpeg expression for a cue's scale factor over its local time u = t - start. */
function scaleExpr(cue: CaptionCue): string {
  const u = `(t-${cue.startSec})`;
  if (cue.anim === 'pop' || cue.anim === 'shake') {
    // 0.35 -> 1.15 overshoot in 140 ms, settle to 1.0 by 260 ms
    return `if(lt(${u},0.14),0.35+0.8*${u}/0.14,if(lt(${u},0.26),1.15-0.15*(${u}-0.14)/0.12,1))`;
  }
  return '1';
}

function xExpr(cue: CaptionCue): string {
  const x = Math.min(1, Math.max(0, cue.xFrac ?? 0.5)).toFixed(4);
  const base = `min(max(0,W*${x}-w/2),W-w)`;
  if (cue.anim === 'shake') {
    const u = `(t-${cue.startSec})`;
    return `${base}+16*sin(${u}*75)*max(0,1-${u}/0.8)`;
  }
  return base;
}

function yExpr(cue: CaptionCue): string {
  const base = `H*${cue.yFrac.toFixed(4)}-h/2`;
  if (cue.anim === 'slide') {
    const u = `(t-${cue.startSec})`;
    return `${base}+70*max(0,1-${u}/0.22)`;
  }
  return base;
}

/**
 * Composites animated captions onto an already-rendered clip (in place).
 * Cards are drawn by scripts/render_caption_cards.py; ffmpeg animates them with pop / shake /
 * slide-in and fades them out.
 */
/**
 * H.264 output args: the Mac's hardware encoder (VideoToolbox) when available — several times
 * faster at 1080x1920/60 fps — otherwise x264. runFfmpegEncode retries with x264 on failure.
 */
export function h264Args(kind: 'hw' | 'sw', fps?: number): string[] {
  const rate = fps ? ['-r', String(fps)] : [];
  if (kind === 'hw') {
    return [...rate, '-c:v', 'h264_videotoolbox', '-b:v', fps && fps > 30 ? '16M' : '10M', '-profile:v', 'high', '-pix_fmt', 'yuv420p'];
  }
  return [...rate, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
}

let hwEncoderBroken = process.platform !== 'darwin';

/** Runs ffmpeg with `build(encoderArgs)`, preferring the hardware encoder. */
export async function runFfmpegEncode(build: (encoderArgs: string[]) => string[], opts: { fps?: number; timeoutMs: number }) {
  if (!hwEncoderBroken) {
    try {
      return await execFileAsync(FFMPEG_BIN, build(h264Args('hw', opts.fps)), {
        timeout: opts.timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      });
    } catch (err: any) {
      if (err?.killed) throw err; // a timeout is not an encoder problem
      if (/videotoolbox|Unknown encoder|Error while opening encoder/i.test(String(err?.stderr || err?.message))) {
        hwEncoderBroken = true;
      } else {
        throw err;
      }
    }
  }
  return execFileAsync(FFMPEG_BIN, build(h264Args('sw', opts.fps)), {
    timeout: opts.timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
}

/** Draws caption cards (transparent PNGs) into workDir; returns their paths in cue order. */
export async function renderCaptionCards(cues: CaptionCue[], width: number, workDir: string): Promise<string[] | null> {
  if (cues.length === 0) return [];
  if (!fs.existsSync(CAPTION_CARD_SCRIPT)) return null;
  const specPath = path.join(workDir, 'spec.json');
  fs.writeFileSync(
    specPath,
    JSON.stringify({
      width,
      cards: cues.map((c, i) => ({
        id: `c${i}`,
        text: c.text,
        style: c.style,
        color: c.color,
        size: c.size,
        maxWidth: 0.9,
        left: c.left,
        right: c.right,
      })),
    })
  );
  const { stdout } = await execFileAsync(PYTHON_BIN, [CAPTION_CARD_SCRIPT, specPath, workDir], { timeout: 60000 });
  const cards: Array<{ id: string; path: string }> = JSON.parse(stdout).cards || [];
  return cards.length === cues.length ? cards.map((c) => c.path) : null;
}

/** ffmpeg input args for caption cards: each card is only fed for its own window. */
export function captionInputArgs(cues: CaptionCue[], cardPaths: string[], fps = 30): string[] {
  return cues.flatMap((cue, i) => [
    '-loop', '1', '-framerate', String(fps),
    '-t', Math.max(0.1, cue.endSec - cue.startSec + 0.05).toFixed(2),
    '-i', cardPaths[i],
  ]);
}

/**
 * Filter chains that animate caption cards (pop / shake / slide, fades) over `baseLabel`.
 * `inputIndex(i)` is the ffmpeg input index of card i. Ends in `[outLabel]`.
 */
export function captionChains(cues: CaptionCue[], inputIndex: (i: number) => number, baseLabel: string, outLabel: string): string[] {
  const chains: string[] = [];
  let base = baseLabel;
  cues.forEach((cue, i) => {
    const fadeOut = Math.max(cue.startSec, cue.endSec - 0.25).toFixed(2);
    const s = scaleExpr(cue);
    chains.push(
      `[${inputIndex(i)}:v]format=rgba,setpts=PTS+${cue.startSec}/TB,` +
        (s === '1' ? '' : `scale=w='max(2,trunc(iw*${s}/2)*2)':h='max(2,trunc(ih*${s}/2)*2)':eval=frame,`) +
        `fade=t=in:st=${cue.startSec}:d=0.12:alpha=1,fade=t=out:st=${fadeOut}:d=0.25:alpha=1[cap${i}]`
    );
    const out = i === cues.length - 1 ? outLabel : `capb${i}`;
    chains.push(
      `[${base}][cap${i}]overlay=x='${xExpr(cue)}':y='${yExpr(cue)}':eval=frame:eof_action=pass:` +
        `enable='between(t,${cue.startSec},${cue.endSec})'[${out}]`
    );
    base = out;
  });
  return chains;
}

/**
 * Composites animated captions onto an already-rendered clip (in place).
 * Cards are drawn by scripts/render_caption_cards.py; ffmpeg animates them with pop / shake /
 * slide-in and fades them out.
 */
export async function applyCaptionOverlays(params: {
  mp4Path: string;
  cues: CaptionCue[];
  width: number;
  height: number;
  durationSec: number;
}): Promise<boolean> {
  const cues = params.cues.filter((c) => c.text && c.endSec > c.startSec);
  if (cues.length === 0 || !fs.existsSync(params.mp4Path) || !fs.existsSync(CAPTION_CARD_SCRIPT)) {
    return false;
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-captions-'));
  const tmpOut = params.mp4Path.replace(/\.mp4$/, `.captions.${process.pid}.mp4`);
  try {
    const cards = await renderCaptionCards(cues, params.width, workDir);
    if (!cards) return false;
    const dur = params.durationSec.toFixed(2);
    const chains = captionChains(cues, (i) => i + 1, '0:v', 'vout');
    await runFfmpegEncode(
      (enc) => [
        '-y', '-i', params.mp4Path,
        ...captionInputArgs(cues, cards),
        '-filter_complex', chains.join(';'),
        '-map', '[vout]', '-map', '0:a?',
        ...enc,
        '-c:a', 'copy', '-t', dur, '-movflags', '+faststart', tmpOut,
      ],
      { timeoutMs: 420000 }
    );
    if (fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 8192) {
      fs.renameSync(tmpOut, params.mp4Path);
      return true;
    }
    return false;
  } catch (err) {
    console.warn('Caption overlay notice:', (err as Error).message);
    return false;
  } finally {
    if (fs.existsSync(tmpOut)) {
      try {
        fs.unlinkSync(tmpOut);
      } catch {}
    }
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** Big emoji stickers offered in the editor's meme library. */
export const MEME_STICKERS = ['💀', '😭', '🔥', '🐐', '🤯', '😤', '⚽', '🍿', '🧊', '🚨', '👀', '😱', '🥶', '😈', '🫡', '🤡', '💯', '🏆'];

/** Caption / meme lines for the editor library, written for this clip's goal when known. */
export function captionSuggestions(
  goal?: GoalContext | null,
  teamNames?: Record<string, string> | null
): { hooks: string[]; headlines: string[]; memes: string[]; stickers: string[] } {
  const generic = {
    hooks: ['WAIT FOR IT… 👀', 'WATCH THE FINISH 🎯', 'YOU NEED TO SEE THIS 😳', 'NO WAY THIS WORKED 😱'],
    headlines: ['WHAT A GOAL! ⚽', 'ABSOLUTE SCENES 🔥', 'UNREAL 🤯', 'TOP BINS 🎯'],
    memes: [
      'Defenders: 🧍🧍🧍',
      'Keeper didn\u2019t even move 💀',
      'Cold. Absolutely cold 🥶',
      'Ice in his veins 🧊',
      'Cheat codes enabled 🎮',
      'Somebody call security, that was theft 🚨',
      'Plot twist incoming 🍿',
      'Nobody is leaving early 🍿',
    ],
  };
  if (!goal) return { ...generic, stickers: MEME_STICKERS };

  const situations: GoalContext['situation'][] = ['opener', 'equaliser', 'go_ahead', 'extends_lead', 'pulls_back'];
  const hooks = new Set<string>();
  const headlines = new Set<string>();
  const memes = new Set<string>();
  // Same goal, every situation's wording: the situation-specific lines come first.
  for (const situation of [goal.situation, ...situations.filter((x) => x !== goal.situation)]) {
    for (let i = 0; i < 3; i++) {
      const cues = buildGoalCaptions({
        goal: { ...goal, situation, number: goal.number + i * 3, late: false },
        clipDurSec: 20,
        teamNames,
      });
      for (const c of cues) {
        // Other situations' wording only when it doesn't state a score ("ALL SQUARE 1-0" is wrong
        // for an opener); this goal's own situation keeps its real scoreline.
        if (situation !== goal.situation && /\d/.test(c.text)) continue;
        if (c.id === 'hook') hooks.add(c.text);
        if (c.id === 'headline') headlines.add(c.text);
        if (c.id === 'meme') memes.add(c.text);
      }
    }
  }
  if (goal.late) {
    const late = buildGoalCaptions({ goal, clipDurSec: 20, teamNames });
    for (const c of late) {
      if (c.id === 'hook') hooks.add(c.text);
      if (c.id === 'headline') headlines.add(c.text);
      if (c.id === 'meme') memes.add(c.text);
    }
  }
  generic.headlines.forEach((h) => headlines.add(h));
  generic.memes.forEach((m) => memes.add(m));
  return {
    hooks: [...hooks].slice(0, 12),
    headlines: [...headlines].slice(0, 14),
    memes: [...memes].slice(0, 18),
    stickers: MEME_STICKERS,
  };
}
