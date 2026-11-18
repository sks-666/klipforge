#!/usr/bin/env python3
"""
Action-following crop path for vertical (9:16) clips cut from landscape video.

For each sampled moment it finds where the action is:
  * Pitch shots (football): the densest cluster of players, i.e. non-grass pixels with grass
    above and below them. The camera already follows the ball, and players gather around it.
  * Other shots (celebrations, close-ups, non-sports video): where the picture is moving.
Pixels that never change during the clip (stream overlays, scoreboards, black bars) are ignored.

The raw positions are smoothed into a steady pan with a capped speed; scene cuts reset the
smoothing so the window can jump with the cut instead of sliding across it.

Usage: action_crop_path.py <video> <start_sec> <duration_sec> [aspect=0.5625]
Prints JSON: {"width": W, "height": H, "cropFrac": f, "points": [[t, leftFrac], ...]}
leftFrac is the crop window's left edge as a fraction of the frame width (0 .. 1 - cropFrac).
"""
import json
import os
import subprocess
import sys

SW, SH = 96, 54          # analysis resolution
FPS = 4
CUT_DIFF = 38            # mean abs luma diff that marks a scene cut
MAX_PAN_PER_SEC = 0.45   # of the frame width
SMOOTH_RADIUS = 3        # samples on each side (~0.75 s)
OVERLAY_PENALTY = 2.5    # how hard the window avoids stream overlay boxes


def ffbin(name):
    for p in (f"/usr/local/bin/{name}", f"/opt/homebrew/bin/{name}"):
        if os.path.exists(p):
            return p
    return name


def probe_size(path):
    try:
        out = subprocess.check_output(
            [ffbin("ffprobe"), "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
            timeout=20,
        ).decode().strip().split(",")
        return int(out[0]), int(out[1])
    except Exception:
        return 1280, 720


def read_frames(path, start, dur):
    proc = subprocess.Popen(
        [ffbin("ffmpeg"), "-v", "error", "-ss", str(start), "-t", str(dur), "-i", path, "-an",
         "-vf", f"fps={FPS},scale={SW}:{SH}:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    size = SW * SH * 3
    frames = []
    while True:
        b = proc.stdout.read(size)
        if len(b) < size:
            break
        frames.append(b)
    proc.wait()
    return frames


def best_window(col_weight, win, overlay_cols=None):
    """Left column of the win-wide window with the most action, steering away from overlays.

    Each window scores (its share of the best achievable action) - OVERLAY_PENALTY x (share of
    the window covered by stream overlays). Returns None when there is no evidence at all.
    """
    total = sum(col_weight)
    if total <= 0:
        return None
    sums = []
    s = sum(col_weight[:win])
    sums.append(s)
    for x in range(1, SW - win + 1):
        s += col_weight[x + win - 1] - col_weight[x - 1]
        sums.append(s)
    best_action = max(sums) or 1.0
    best_x, best_score = 0, None
    for x, act in enumerate(sums):
        cover = sum(overlay_cols[x:x + win]) / win if overlay_cols else 0.0
        score = act / best_action - OVERLAY_PENALTY * cover
        if best_score is None or score > best_score:
            best_x, best_score = x, score
    return float(best_x)


def overlay_columns(mask):
    """Per-column share of rows covered by stream overlays (boxes, picture-in-picture).

    Connected regions of the mask are replaced by their filled bounding box, so a box whose
    border is fixed but whose inside is live video counts as a whole. Small marks and anything
    in the top strip (scoreboard / clock, fine to show) are ignored.
    """
    seen = [False] * (SW * SH)
    boxed = [False] * (SW * SH)
    top_strip = int(SH * 0.15)
    for start in range(SW * SH):
        if not mask[start] or seen[start]:
            continue
        stack, comp = [start], []
        seen[start] = True
        while stack:
            i = stack.pop()
            comp.append(i)
            y, x = divmod(i, SW)
            for j in ((i - SW) if y > 0 else -1, (i + SW) if y < SH - 1 else -1,
                      (i - 1) if x > 0 else -1, (i + 1) if x < SW - 1 else -1):
                if j >= 0 and mask[j] and not seen[j]:
                    seen[j] = True
                    stack.append(j)
        ys = [i // SW for i in comp]
        xs = [i % SW for i in comp]
        y0, y1, x0, x1 = min(ys), max(ys), min(xs), max(xs)
        area = (y1 - y0 + 1) * (x1 - x0 + 1)
        if y0 < top_strip or area < 0.01 * SW * SH or len(comp) < 12:
            continue
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                boxed[y * SW + x] = True
    return [sum(boxed[y * SW + x] for y in range(SH)) / SH for x in range(SW)]


def main():
    path, start, dur = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    aspect = float(sys.argv[4]) if len(sys.argv) > 4 else 9 / 16
    width, height = probe_size(path)
    crop_frac = min(1.0, (height * aspect) / width)
    result = {"width": width, "height": height, "cropFrac": round(crop_frac, 4), "points": []}
    if crop_frac >= 0.999:
        result["points"] = [[0, 0.0]]
        print(json.dumps(result))
        return

    frames = read_frames(path, start, dur)
    if len(frames) < 2:
        result["points"] = [[0, (1 - crop_frac) / 2]]
        print(json.dumps(result))
        return

    n_px = SW * SH
    lum = [[(f[i * 3] * 3 + f[i * 3 + 1] * 6 + f[i * 3 + 2]) // 10 for i in range(n_px)] for f in frames]
    grass = [[(f[i * 3 + 1] > 60 and f[i * 3 + 1] > f[i * 3] + 12 and f[i * 3 + 1] > f[i * 3 + 2] + 12)
              for i in range(n_px)] for f in frames]

    # Static pixels (overlays / bars): almost no change across the whole clip.
    change = [0] * n_px
    for a, b in zip(lum, lum[1:]):
        for i in range(n_px):
            change[i] += abs(a[i] - b[i])
    static = [c / (len(lum) - 1) < 2.5 for c in change]

    def player_pixels(k):
        # players: non-grass, non-static, with grass 2-3 rows above and below
        g = grass[k]
        hits = []
        for y in range(3, SH - 3):
            row = y * SW
            for x in range(SW):
                i = row + x
                if g[i] or static[i]:
                    continue
                if (g[i - 2 * SW] or g[i - 3 * SW]) and (g[i + 2 * SW] or g[i + 3 * SW]):
                    hits.append(i)
        return hits

    pitch = [sum(grass[k]) / n_px > 0.35 for k in range(len(frames))]
    hits_per_frame = [player_pixels(k) if pitch[k] else [] for k in range(len(frames))]

    # HUD mask: live overlays (mini-map, picture-in-picture, nameplates) change every frame
    # but sit on the same screen pixels. Players move across the screen as the camera pans,
    # so any pixel that reads as a "player" in >20% of pitch frames is HUD, not action.
    heat = [0] * n_px
    for hits in hits_per_frame:
        for i in hits:
            heat[i] += 1
    n_pitch = max(1, sum(pitch))
    hud = [False] * n_px
    for i in range(n_px):
        if heat[i] > 0.2 * n_pitch and n_pitch >= 8:
            y, x = divmod(i, SW)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < SH and 0 <= xx < SW:
                        hud[yy * SW + xx] = True
    ignore = [static[i] or hud[i] for i in range(n_px)]
    ov_cols = overlay_columns(ignore)

    win = max(2, int(round(crop_frac * SW)))
    centre_left = (SW - win) / 2
    raw, cuts = [], [False] * len(frames)
    for k in range(len(frames)):
        if k > 0:
            diff = sum(abs(lum[k][i] - lum[k - 1][i]) for i in range(n_px)) / n_px
            cuts[k] = diff > CUT_DIFF
        col = [0.0] * SW
        for i in hits_per_frame[k]:
            if not hud[i]:
                col[i % SW] += 1
        if sum(col) < 3 and k > 0 and not cuts[k]:
            # motion fallback
            a, b = lum[k], lum[k - 1]
            for i in range(n_px):
                if not ignore[i]:
                    d = abs(a[i] - b[i])
                    if d > 18:
                        col[i % SW] += d
        raw.append(best_window(col, win, ov_cols))

    # fill gaps (no evidence) with the previous / centre position
    filled, prev = [], centre_left
    for v in raw:
        prev = prev if v is None else v
        filled.append(prev)

    # smooth within cut-delimited shots, then cap the pan speed
    out = [0.0] * len(filled)
    shot_start = 0
    bounds = [k for k in range(1, len(filled)) if cuts[k]] + [len(filled)]
    max_step = MAX_PAN_PER_SEC * SW / FPS
    for end in bounds:
        for k in range(shot_start, end):
            lo, hi = max(shot_start, k - SMOOTH_RADIUS), min(end, k + SMOOTH_RADIUS + 1)
            out[k] = sum(filled[lo:hi]) / (hi - lo)
        for k in range(shot_start + 1, end):
            delta = out[k] - out[k - 1]
            if abs(delta) > max_step:
                out[k] = out[k - 1] + max_step * (1 if delta > 0 else -1)
        shot_start = end

    max_left = SW - win
    pts = []
    for k, v in enumerate(out):
        frac = min(max(0.0, v), max_left) / SW
        t = round(k / FPS, 3)
        if cuts[k] and pts:
            # hold the old position until just before the cut, then jump
            pts.append([round(max(0.0, t - 0.01), 3), pts[-1][1]])
        pts.append([t, round(frac, 4)])
    result["points"] = pts
    print(json.dumps(result))


if __name__ == "__main__":
    main()
