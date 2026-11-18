import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { MediaRef } from './timeline.service';

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg';
const FFPROBE_BIN = fs.existsSync('/usr/local/bin/ffprobe') ? '/usr/local/bin/ffprobe' : 'ffprobe';
const PYTHON_BIN = fs.existsSync('/usr/local/bin/python3') ? '/usr/local/bin/python3' : 'python3';

export const VAULT_ROOT = path.resolve(__dirname, '../../storage/vault');
export const VAULT_CATEGORIES = ['Reactions', 'Green Screens', 'Rage', 'Sound Effects', 'Anime/Gaming', 'Clips'] as const;
export type VaultCategory = (typeof VAULT_CATEGORIES)[number];

/** A meme / SFX in a workspace's vault (storage/vault/<workspaceId>/index.json). */
export interface VaultItem {
  id: string;
  name: string;
  file: string;
  kind: 'video' | 'image' | 'gif' | 'audio';
  mime: string;
  category: VaultCategory;
  tags: string[];
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasAlpha: boolean;
  /** peak level in dBFS (for -3 dB normalisation) */
  peakDb: number;
  /** 1..9 hotkey, if assigned */
  hotkey: number | null;
  favorite: boolean;
  starter: boolean;
  createdAt: string;
}

const safeWs = (workspaceId: string) => workspaceId.replace(/[^a-zA-Z0-9_-]/g, '');
export const vaultDir = (workspaceId: string) => path.join(VAULT_ROOT, safeWs(workspaceId));
const indexPath = (workspaceId: string) => path.join(vaultDir(workspaceId), 'index.json');

export function readVault(workspaceId: string): VaultItem[] {
  try {
    return JSON.parse(fs.readFileSync(indexPath(workspaceId), 'utf8'));
  } catch {
    return [];
  }
}

function writeVault(workspaceId: string, items: VaultItem[]) {
  fs.mkdirSync(vaultDir(workspaceId), { recursive: true });
  const tmp = `${indexPath(workspaceId)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2));
  fs.renameSync(tmp, indexPath(workspaceId));
}

export function vaultFilePath(workspaceId: string, item: Pick<VaultItem, 'file'>) {
  return path.join(vaultDir(workspaceId), path.basename(item.file));
}

export function vaultMediaRefs(workspaceId: string, ids: string[]): Record<string, MediaRef> {
  const items = readVault(workspaceId);
  const out: Record<string, MediaRef> = {};
  for (const id of ids) {
    const it = items.find((x) => x.id === id);
    if (!it) continue;
    out[id] = {
      path: vaultFilePath(workspaceId, it),
      kind: it.kind,
      width: it.width,
      height: it.height,
      durationSec: it.durationSec,
      hasAudio: it.hasAudio,
      hasAlpha: it.hasAlpha,
      peakDb: it.peakDb,
    };
  }
  return out;
}

// ---- probing ----------------------------------------------------------------------------------
export async function probeVaultFile(filePath: string) {
  const { stdout } = await execFileAsync(
    FFPROBE_BIN,
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', filePath],
    { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }
  );
  const j = JSON.parse(stdout);
  const v = (j.streams || []).find((s: any) => s.codec_type === 'video');
  const a = (j.streams || []).find((s: any) => s.codec_type === 'audio');
  const ext = path.extname(filePath).toLowerCase();
  const kind: VaultItem['kind'] = !v
    ? 'audio'
    : ext === '.gif'
    ? 'gif'
    : ['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif'].includes(ext) && !(Number(j.format?.duration) > 0.5)
    ? 'image'
    : 'video';
  const hasAlpha =
    kind === 'gif' ||
    /a$|rgba|yuva|argb|bgra|pal8/.test(String(v?.pix_fmt || '')) ||
    String(v?.tags?.alpha_mode || v?.tags?.ALPHA_MODE || '') === '1';
  let peakDb = -3;
  if (a) {
    try {
      const { stderr } = await execFileAsync(
        FFMPEG_BIN,
        ['-hide_banner', '-i', filePath, '-vn', '-af', 'volumedetect', '-f', 'null', '-'],
        { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }
      );
      const m = stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
      if (m) peakDb = Number(m[1]);
    } catch {}
  }
  return {
    kind,
    width: Number(v?.width || 0),
    height: Number(v?.height || 0),
    durationSec: kind === 'image' ? 3 : Math.max(0.1, Number(j.format?.duration || v?.duration || a?.duration || 1)),
    hasAudio: Boolean(a),
    hasAlpha,
    peakDb,
    codec: String(v?.codec_name || a?.codec_name || ''),
  };
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
};

const BROWSER_VIDEO = { ext: ['.mp4', '.webm'], codecs: ['h264', 'vp8', 'vp9', 'av1'] };
const BROWSER_AUDIO_EXT = ['.mp3', '.m4a', '.wav', '.ogg'];
const MAX_VIDEO_SIDE = 1920;
const MAX_IMAGE_SIDE = 2048;

/**
 * Converts an upload into something the browser preview and the export both handle:
 *   transparent video -> VP9 WebM with alpha · other video -> H.264 MP4 (<= 1920 px)
 *   HEIC/HEIF -> PNG · huge images -> scaled · AAC/FLAC -> M4A
 * Returns the (possibly new) file path; the original is removed when converted.
 */
async function normalizeUpload(full: string, probe: Awaited<ReturnType<typeof probeVaultFile>>): Promise<string> {
  const ext = path.extname(full).toLowerCase();
  const stem = full.slice(0, -ext.length);
  const run = (args: string[], out: string, timeoutMs = 900000) =>
    execFileAsync(FFMPEG_BIN, ['-y', '-hide_banner', '-loglevel', 'error', ...args, out], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    }).then(() => {
      fs.unlinkSync(full);
      return out;
    });
  const fit = (maxSide: number) =>
    `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))',scale=trunc(iw/2)*2:trunc(ih/2)*2`;

  if (ext === '.heic' || ext === '.heif') {
    const out = `${stem}.png`;
    if (process.platform !== 'darwin') {
      throw Object.assign(new Error('HEIC photos can only be converted on macOS — export as PNG or JPG'), { status: 400 });
    }
    await execFileAsync('sips', ['-s', 'format', 'png', full, '--out', out], { timeout: 60000 });
    fs.unlinkSync(full);
    return out;
  }
  if (probe.kind === 'image' && Math.max(probe.width, probe.height) > MAX_IMAGE_SIDE) {
    const out = `${stem}.scaled${ext === '.jpg' || ext === '.jpeg' ? '.jpg' : '.png'}`;
    return run(['-i', full, '-vf', fit(MAX_IMAGE_SIDE).split(',')[0], '-frames:v', '1'], out, 60000);
  }
  if (probe.kind === 'video') {
    const tooBig = Math.max(probe.width, probe.height) > MAX_VIDEO_SIDE;
    if (probe.hasAlpha) {
      const browserAlpha = ext === '.webm' && ['vp8', 'vp9'].includes(probe.codec);
      if (browserAlpha && !tooBig) return full;
      const out = `${stem}.alpha.webm`;
      const decoder = ext === '.webm' ? ['-c:v', 'libvpx-vp9'] : [];
      return run(
        [...decoder, '-i', full, '-vf', `${fit(MAX_VIDEO_SIDE)},format=yuva420p`, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
          '-b:v', '0', '-crf', '30', '-auto-alt-ref', '0', '-row-mt', '1', '-an'],
        out
      );
    }
    const browserSafe = BROWSER_VIDEO.ext.includes(ext) && BROWSER_VIDEO.codecs.includes(probe.codec);
    if (browserSafe && !tooBig) return full;
    const out = `${stem}.h264.mp4`;
    return run(
      ['-i', full, '-vf', fit(MAX_VIDEO_SIDE), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        ...(probe.hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']), '-movflags', '+faststart'],
      out
    );
  }
  if (probe.kind === 'audio' && !BROWSER_AUDIO_EXT.includes(ext)) {
    return run(['-i', full, '-vn', '-c:a', 'aac', '-b:a', '192k'], `${stem}.m4a`, 300000);
  }
  return full;
}
export const ALLOWED_VAULT_EXT = Object.keys(MIME);
export const mimeFor = (file: string) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

export async function addVaultFile(params: {
  workspaceId: string;
  data: Buffer;
  filename: string;
  name?: string;
  category?: VaultCategory;
  tags?: string[];
  starter?: boolean;
}): Promise<VaultItem> {
  const ext = path.extname(params.filename).toLowerCase();
  if (!ALLOWED_VAULT_EXT.includes(ext)) throw Object.assign(new Error(`Unsupported file type ${ext}`), { status: 400 });
  const id = `va_${crypto.randomBytes(6).toString('hex')}`;
  const dir = vaultDir(params.workspaceId);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${id}${ext}`;
  const full = path.join(dir, file);
  fs.writeFileSync(full, params.data);
  let probe;
  let finalPath = full;
  try {
    const raw = await probeVaultFile(full);
    finalPath = await normalizeUpload(full, raw);
    probe = finalPath === full ? raw : await probeVaultFile(finalPath);
  } catch (err: any) {
    for (const f of [full, finalPath]) if (fs.existsSync(f)) fs.unlinkSync(f);
    if (err?.status) throw err;
    throw Object.assign(new Error('Could not read or convert that media file'), { status: 400 });
  }
  const { codec: _codec, ...media } = probe;
  void _codec;
  const storedFile = path.basename(finalPath);
  const item: VaultItem = {
    id,
    name: (params.name || path.basename(params.filename, ext)).slice(0, 80),
    file: storedFile,
    mime: mimeFor(storedFile),
    category:
      params.category ||
      (probe.kind === 'audio' ? 'Sound Effects' : 'Reactions'),
    tags: (params.tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12),
    hotkey: null,
    favorite: false,
    starter: Boolean(params.starter),
    createdAt: new Date().toISOString(),
    ...media,
  };
  writeVault(params.workspaceId, [...readVault(params.workspaceId), item]);
  return item;
}

export function updateVaultItem(
  workspaceId: string,
  id: string,
  patch: Partial<Pick<VaultItem, 'name' | 'category' | 'tags' | 'hotkey' | 'favorite'>>
): VaultItem | null {
  const items = readVault(workspaceId);
  const idx = items.findIndex((x) => x.id === id);
  if (idx === -1) return null;
  if (patch.hotkey) {
    // a hotkey belongs to one item at a time
    items.forEach((x) => {
      if (x.hotkey === patch.hotkey) x.hotkey = null;
    });
  }
  items[idx] = { ...items[idx], ...patch, tags: patch.tags ?? items[idx].tags };
  writeVault(workspaceId, items);
  return items[idx];
}

export function deleteVaultItem(workspaceId: string, id: string): boolean {
  const items = readVault(workspaceId);
  const it = items.find((x) => x.id === id);
  if (!it) return false;
  const full = vaultFilePath(workspaceId, it);
  if (fs.existsSync(full)) fs.unlinkSync(full);
  writeVault(
    workspaceId,
    items.filter((x) => x.id !== id)
  );
  return true;
}

/**
 * AI cutout: merges a browser-generated segmentation mask video (white = keep) into the
 * asset's alpha channel and stores a new VP9 WebM with transparency.
 */
export async function createCutout(workspaceId: string, id: string, maskData: Buffer): Promise<VaultItem> {
  const items = readVault(workspaceId);
  const src = items.find((x) => x.id === id);
  if (!src || src.kind !== 'video') throw Object.assign(new Error('Cutouts need a video asset'), { status: 400 });
  const dir = vaultDir(workspaceId);
  const maskPath = path.join(dir, `${id}.mask.${process.pid}.webm`);
  fs.writeFileSync(maskPath, maskData);
  const newId = `va_${crypto.randomBytes(6).toString('hex')}`;
  const outFile = `${newId}.webm`;
  try {
    await execFileAsync(
      FFMPEG_BIN,
      [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', vaultFilePath(workspaceId, src),
        '-i', maskPath,
        '-filter_complex',
        `[1:v]scale=${src.width}:${src.height},format=gray,setpts=PTS-STARTPTS[m];[0:v]setpts=PTS-STARTPTS,format=yuva420p[v];[v][m]alphamerge,format=yuva420p[out]`,
        '-map', '[out]',
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-auto-alt-ref', '0',
        '-shortest', '-an',
        path.join(dir, outFile),
      ],
      { timeout: 600000, maxBuffer: 10 * 1024 * 1024 }
    );
  } finally {
    if (fs.existsSync(maskPath)) fs.unlinkSync(maskPath);
  }
  const { codec: _c, ...probe } = await probeVaultFile(path.join(dir, outFile));
  void _c;
  const item: VaultItem = {
    ...src,
    ...probe,
    id: newId,
    file: outFile,
    mime: 'video/webm',
    name: `${src.name} (cutout)`.slice(0, 80),
    hasAlpha: true,
    hasAudio: false,
    hotkey: null,
    favorite: false,
    starter: false,
    tags: Array.from(new Set([...src.tags, 'cutout'])),
    createdAt: new Date().toISOString(),
  };
  writeVault(workspaceId, [...readVault(workspaceId), item]);
  return item;
}

// ---- starter pack: synthesized SFX + emoji cutouts + a green-screen clip -----------------------
const STARTER_SFX: Array<{ name: string; tags: string[]; filter: string; dur: number; category: VaultCategory }> = [
  {
    name: 'Bass Boom',
    tags: ['boom', 'impact', 'vine'],
    dur: 1.8,
    category: 'Sound Effects',
    filter: "aevalsrc='0.95*sin(2*PI*(48+140*exp(-9*t))*t)*exp(-2.6*t)':s=48000:d=1.8,volume=2,alimiter=limit=0.9",
  },
  {
    name: 'Whoosh',
    tags: ['whoosh', 'transition', 'swipe'],
    dur: 0.9,
    category: 'Sound Effects',
    filter: 'anoisesrc=d=0.9:c=pink:a=0.8:r=48000,highpass=f=350,lowpass=f=3200,afade=t=in:d=0.35,afade=t=out:st=0.4:d=0.5',
  },
  {
    name: 'Cartoon Bounce',
    tags: ['bounce', 'boing', 'funny'],
    dur: 0.9,
    category: 'Sound Effects',
    filter: "aevalsrc='0.6*sin(2*PI*(260+700*exp(-7*mod(t,0.3)))*t)*exp(-6*mod(t,0.3))':s=48000:d=0.9",
  },
  {
    name: 'Ding',
    tags: ['ding', 'correct', 'notification'],
    dur: 1.5,
    category: 'Sound Effects',
    filter: "aevalsrc='0.55*sin(2*PI*1320*t)*exp(-4*t)+0.25*sin(2*PI*2640*t)*exp(-6*t)':s=48000:d=1.5",
  },
  {
    name: 'Riser',
    tags: ['riser', 'build-up', 'tension'],
    dur: 2.2,
    category: 'Sound Effects',
    filter: "aevalsrc='0.4*sin(2*PI*(180+520*t*t)*t)':s=48000:d=2.2,afade=t=in:d=1.8,afade=t=out:st=2:d=0.2",
  },
  {
    name: 'Record Scratch',
    tags: ['scratch', 'stop', 'wait what'],
    dur: 0.7,
    category: 'Sound Effects',
    filter: 'anoisesrc=d=0.7:c=white:a=0.7:r=48000,bandpass=f=1400:w=900,vibrato=f=14:d=1,afade=t=out:st=0.4:d=0.3',
  },
  {
    name: 'Air Horn',
    tags: ['airhorn', 'hype', 'mlg'],
    dur: 1.4,
    category: 'Rage',
    filter:
      "aevalsrc='0.22*(sgn(sin(2*PI*440*t))+sgn(sin(2*PI*554*t))+sgn(sin(2*PI*659*t)))':s=48000:d=1.4,lowpass=f=3600,tremolo=f=7:d=0.25,afade=t=out:st=1.1:d=0.3",
  },
  {
    name: 'Crowd Roar',
    tags: ['crowd', 'cheer', 'stadium'],
    dur: 3,
    category: 'Sound Effects',
    filter: 'anoisesrc=d=3:c=pink:a=0.8:r=48000,highpass=f=140,lowpass=f=1900,afade=t=in:d=0.8,afade=t=out:st=2:d=1',
  },
];

const STARTER_VISUALS_PY = `
import sys, subprocess
from PIL import Image, ImageDraw, ImageFont
out_dir, ffmpeg = sys.argv[1], sys.argv[2]
EMOJI = "/System/Library/Fonts/Apple Color Emoji.ttc"
font = ImageFont.truetype(EMOJI, 160)
def emoji(ch, size):
    g = Image.new("RGBA", (220, 220), (0, 0, 0, 0))
    ImageDraw.Draw(g).text((30, 20), ch, font=font, embedded_color=True)
    g = g.crop(g.getbbox())
    return g.resize((size, size), Image.LANCZOS)
for ch, name in (("\\U0001F480", "skull"), ("\\U0001F525", "fire"), ("\\U0001F602", "laugh"), ("\\U0001F921", "clown"), ("\\U0001F410", "goat")):
    emoji(ch, 512).save(f"{out_dir}/{name}.png")
# green-screen reaction: bouncing laughing face on #00FF00, 3 s @ 30 fps
W, H, FPS, N = 720, 720, 30, 90
proc = subprocess.Popen([ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", f"{out_dir}/greenscreen_laugh.mp4"], stdin=subprocess.PIPE)
import math
base = emoji("\\U0001F602", 420)
for i in range(N):
    t = i / FPS
    s = 1.0 + 0.12 * math.sin(t * 9)
    face = base.resize((int(420 * s), int(420 * s)), Image.LANCZOS).rotate(12 * math.sin(t * 6), expand=True)
    frame = Image.new("RGB", (W, H), (0, 255, 0))
    y = int(H / 2 - face.height / 2 + 60 * abs(math.sin(t * 4)) - 30)
    frame.paste(face, (W // 2 - face.width // 2, y), face)
    proc.stdin.write(frame.tobytes())
proc.stdin.close()
proc.wait()
print("ok")
`;

const starterLocks = new Map<string, Promise<void>>();

/** Creates the starter pack once per workspace (idempotent). */
export function ensureStarterPack(workspaceId: string): Promise<void> {
  if (readVault(workspaceId).some((x) => x.starter)) return Promise.resolve();
  const running = starterLocks.get(workspaceId);
  if (running) return running;
  const job = (async () => {
    fs.mkdirSync(vaultDir(workspaceId), { recursive: true });
    const tmp = fs.mkdtempSync(vaultDir(workspaceId) + '-starter-');
    try {
      for (const sfx of STARTER_SFX) {
        const out = path.join(tmp, `${sfx.name.replace(/\s+/g, '_').toLowerCase()}.m4a`);
        await execFileAsync(
          FFMPEG_BIN,
          ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', sfx.filter, '-t', String(sfx.dur), '-ac', '2', '-c:a', 'aac', '-b:a', '160k', out],
          { timeout: 60000 }
        );
        await addVaultFile({
          workspaceId,
          data: fs.readFileSync(out),
          filename: path.basename(out),
          name: sfx.name,
          category: sfx.category,
          tags: sfx.tags,
          starter: true,
        });
      }
      try {
        await execFileAsync(PYTHON_BIN, ['-c', STARTER_VISUALS_PY, tmp, FFMPEG_BIN], { timeout: 120000 });
        const visuals: Array<[string, string, VaultCategory, string[]]> = [
          ['greenscreen_laugh.mp4', 'Laughing (green screen)', 'Green Screens', ['laugh', 'lol', 'green screen']],
          ['skull.png', 'Skull 💀', 'Reactions', ['skull', 'dead', 'cutout']],
          ['fire.png', 'Fire 🔥', 'Reactions', ['fire', 'lit', 'cutout']],
          ['laugh.png', 'Crying laughing 😂', 'Reactions', ['laugh', 'lol', 'cutout']],
          ['clown.png', 'Clown 🤡', 'Rage', ['clown', 'fail', 'cutout']],
          ['goat.png', 'GOAT 🐐', 'Anime/Gaming', ['goat', 'legend', 'cutout']],
        ];
        for (const [file, name, category, tags] of visuals) {
          const p = path.join(tmp, file);
          if (fs.existsSync(p)) {
            await addVaultFile({ workspaceId, data: fs.readFileSync(p), filename: file, name, category, tags, starter: true });
          }
        }
      } catch (err) {
        console.warn('Starter visuals notice:', (err as Error).message);
      }
      // default hotkeys 1-9 on the starter pack
      const items = readVault(workspaceId).filter((x) => x.starter);
      const order = ['Bass Boom', 'Air Horn', 'Record Scratch', 'Whoosh', 'Cartoon Bounce', 'Skull 💀', 'Laughing (green screen)', 'Fire 🔥', 'Crowd Roar'];
      order.forEach((name, i) => {
        const it = items.find((x) => x.name === name);
        if (it) updateVaultItem(workspaceId, it.id, { hotkey: i + 1, favorite: true });
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      starterLocks.delete(workspaceId);
    }
  })();
  starterLocks.set(workspaceId, job);
  return job;
}
