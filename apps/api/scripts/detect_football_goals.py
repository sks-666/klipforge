#!/usr/bin/env python3
"""
Football (soccer) goal detector for KlipForge — works on match broadcasts and football games
(eFootball, EA FC / FIFA) without ML dependencies.

How a goal looks in the signal:
  1. Live play: the frame is dominated by green pitch.
  2. The ball goes in and the director cuts away from the wide pitch view to close-ups of
     players celebrating (pitch share drops sharply) while the crowd roars (loudness jumps
     above the match's normal level).
  3. The celebration lasts a while (long cutaway) and/or a replay follows, which games
     open with a full-screen coloured wipe (eFootball: yellow).

Fouls, near-misses and injuries also cut away, but briefly and without a sustained crowd roar,
so they are rejected. Menus, loading screens, pause screens and half-time graphics are never
"live play" and can't produce a goal.

Usage: detect_football_goals.py <video> <max_clips> <clip_seconds> [label]
Prints JSON: {"isFootballMatch": bool, "gameplaySec": int, "goals": [...], "segments": [...]}
"""
import array
import json
import math
import os
import subprocess
import sys

FPS = 2
W, H = 48, 27

PITCH_ON = 0.5        # frame counts as live play above this green share
PITCH_OFF = 0.35      # frame counts as a cutaway below this green share
WIPE_ON = 0.5         # full-screen replay wipe above this yellow share
MIN_LIVE_SECONDS = 120
MIN_ROAR_DB = 2.5     # crowd loudness over the match median around the cut
MIN_CELEBRATION_S = 11
DEDUPE_S = 60


def ffmpeg_bin():
    for p in ("/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg"):
        if os.path.exists(p):
            return p
    return "ffmpeg"


def fmt(sec):
    sec = max(0, int(round(sec)))
    return f"{sec // 60:02d}:{sec % 60:02d}"


def audio_rms_per_second(ff, path):
    out = []
    proc = subprocess.Popen(
        [ff, "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    while True:
        buf = proc.stdout.read(16000)
        if len(buf) < 1000:
            break
        s = array.array("h")
        s.frombytes(buf[: len(buf) // 2 * 2])
        rms = math.sqrt(sum(x * x for x in s) / len(s)) if len(s) else 0
        out.append(20 * math.log10(rms / 32768) if rms > 0 else -90.0)
    proc.wait()
    return out


def video_signals_per_second(ff, path):
    """Returns per-second (green share, max yellow share)."""
    frame_bytes = W * H * 3
    proc = subprocess.Popen(
        [
            ff, "-v", "error", "-threads", "0", "-i", path, "-an",
            "-vf", f"fps={FPS},scale={W}:{H}:flags=fast_bilinear",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    frames = []
    n = W * H
    while True:
        b = proc.stdout.read(frame_bytes)
        if len(b) < frame_bytes:
            break
        green = yellow = 0
        for i in range(0, frame_bytes, 3):
            r, g, bl = b[i], b[i + 1], b[i + 2]
            if g > 60 and g > r + 12 and g > bl + 12:
                green += 1
            elif r > 170 and g > 170 and bl < 110:
                yellow += 1
        frames.append((green / n, yellow / n))
    proc.wait()
    per_sec = []
    for s in range(0, len(frames), FPS):
        chunk = frames[s : s + FPS]
        per_sec.append(
            (sum(c[0] for c in chunk) / len(chunk), max(c[1] for c in chunk))
        )
    return per_sec


def median(values):
    v = sorted(values)
    if not v:
        return -90.0
    m = len(v) // 2
    return v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2



KIT_BINS = ["red", "orange", "yellow", "blue", "sky", "purple", "pink", "white", "black"]
KIT_HEX = {"red": "#d7262e", "orange": "#f07a1a", "yellow": "#f2c81b", "blue": "#2353c8",
           "sky": "#36a6e8", "purple": "#7a3fc4", "pink": "#e0469a", "white": "#f4f4f4",
           "black": "#222222"}


def kit_features(ff, path, goal_sec):
    """Colour make-up of the celebration right after a goal (scorers dominate those shots)."""
    proc = subprocess.run(
        [ff, "-v", "error", "-ss", str(goal_sec + 1), "-t", "8", "-i", path, "-an",
         "-vf", "fps=2,scale=96:54", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True,
    )
    b = proc.stdout
    counts = dict.fromkeys(KIT_BINS, 0)
    for i in range(0, len(b) - 2, 3):
        r, g, bl = b[i], b[i + 1], b[i + 2]
        if g > 60 and g > r + 12 and g > bl + 12:
            continue  # grass
        mx, mn = max(r, g, bl), min(r, g, bl)
        if mx > 175 and mx - mn < 28:
            counts["white"] += 1
        elif mx < 40:
            counts["black"] += 1
        elif mx - mn > 70:
            if r == mx and g < r * 0.52 and bl < r * 0.6:
                counts["red"] += 1
            elif r == mx and g >= r * 0.52 and g < r * 0.8:
                counts["orange"] += 1
            elif r > 150 and g > 150 and bl < 100:
                counts["yellow"] += 1
            elif bl == mx and g > bl * 0.6:
                counts["sky"] += 1
            elif bl == mx and r < bl * 0.6:
                counts["blue"] += 1
            elif bl == mx or (r == mx and bl > g * 1.3):
                counts["pink" if r > bl else "purple"] += 1
    total = sum(counts.values()) or 1
    return [counts[k] / total for k in KIT_BINS]


def assign_teams(feats):
    """Split goals into (at most) two kits at the biggest gap along the main difference axis."""
    n = len(feats)
    if n == 0:
        return [], []
    if n == 1:
        best = max(range(len(KIT_BINS)), key=lambda k: feats[0][k] if KIT_BINS[k] != "black" else -1)
        return [0], [KIT_BINS[best]]
    # axis: the bin whose values vary most across goals
    var = []
    for k in range(len(KIT_BINS)):
        vals = [f[k] for f in feats]
        m = sum(vals) / n
        var.append(sum((v - m) ** 2 for v in vals) / n)
    # use the two most varying bins as a contrast (e.g. red vs white)
    # black is mostly shadows / dark backdrops, not kit colour, so it never defines the axis
    order = sorted((k for k in range(len(KIT_BINS)) if KIT_BINS[k] != "black"),
                   key=lambda k: var[k], reverse=True)
    a, b = order[0], order[1]
    proj = [f[a] - f[b] for f in feats]
    srt = sorted(proj)
    gaps = [(srt[i + 1] - srt[i], i) for i in range(n - 1)]
    gap, idx = max(gaps)
    if gap < 0.12:
        # one team scored everything
        best = max(range(len(KIT_BINS)), key=lambda k: sum(f[k] for f in feats) if KIT_BINS[k] != "black" else -1)
        return [0] * n, [KIT_BINS[best]]
    cut = (srt[idx] + srt[idx + 1]) / 2
    groups = [1 if p > cut else 0 for p in proj]
    # name each group by its most distinctive colour vs the other group
    names = []
    for gi in (0, 1):
        mine = [feats[i] for i in range(n) if groups[i] == gi]
        other = [feats[i] for i in range(n) if groups[i] != gi]
        mean = lambda fs, k: sum(f[k] for f in fs) / len(fs)
        best = max((k for k in range(len(KIT_BINS)) if KIT_BINS[k] != "black"),
                   key=lambda k: mean(mine, k) - mean(other, k))
        names.append(KIT_BINS[best])
    # team order = order of first goal
    first = groups[0]
    if first == 1:
        groups = [1 - g for g in groups]
        names = names[::-1]
    return groups, names


def situation(before, after, scorer, idx, total, last_goal_in_match):
    us, them = after[scorer], after[1 - scorer]
    b_us, b_them = before[scorer], before[1 - scorer]
    if last_goal_in_match and idx == total - 1 and total > 2:
        late = True
    else:
        late = False
    if sum(before) == 0:
        kind = "opener"
    elif us == them:
        kind = "equaliser"
    elif b_us == b_them and us > them:
        kind = "go_ahead"
    elif us > them and b_us > b_them:
        kind = "extends_lead"
    elif us < them:
        kind = "pulls_back"
    else:
        kind = "go_ahead"
    return kind, late


def detect(path, max_clips, clip_s, label):
    ff = ffmpeg_bin()
    audio = audio_rms_per_second(ff, path)
    video = video_signals_per_second(ff, path)
    n = min(len(audio), len(video))
    G = [video[i][0] for i in range(n)]
    Y = [video[i][1] for i in range(n)]
    A = audio[:n]

    live = [i for i in range(n) if G[i] > PITCH_ON]
    result = {"isFootballMatch": len(live) >= MIN_LIVE_SECONDS, "gameplaySec": len(live),
              "goals": [], "segments": []}
    if not result["isFootballMatch"]:
        return result

    match_level = median([A[i] for i in live])
    goals = []
    for s in range(10, n - 3):
        live_before = sum(1 for i in range(s - 10, s) if G[i] > PITCH_ON)
        if live_before < 7 or G[s - 1] < PITCH_OFF:
            continue
        if not all(G[i] < PITCH_OFF for i in range(s, min(n, s + 3))):
            continue
        if goals and s - goals[-1]["cutSec"] < DEDUPE_S:
            continue  # replay / restart of the goal we already have

        window = A[max(0, s - 3) : min(n, s + 8)]
        roar = sum(window) / len(window) - match_level
        celebration = sum(1 for i in range(s, min(n, s + 40)) if G[i] < PITCH_OFF)
        wipe = any(Y[i] > WIPE_ON for i in range(s, min(n, s + 60)))

        if roar < MIN_ROAR_DB or not (celebration >= MIN_CELEBRATION_S or wipe):
            continue

        confidence = 8.0 + min(1.0, roar / 8.0) + (0.5 if wipe else 0.0) + min(celebration, 25) / 25 * 0.4
        goals.append({
            "cutSec": s,
            "goalSec": max(0, s - 1),
            "roarDb": round(roar, 1),
            "celebrationSec": celebration,
            "replay": wipe,
            "score": round(min(9.9, confidence), 1),
        })

    for idx, g in enumerate(goals):
        g["number"] = idx + 1

    # Who scored each goal (kit colour of the celebrating players) and the running score.
    groups, kit_names = assign_teams([kit_features(ff, path, g["goalSec"]) for g in goals])
    teams = [{"kit": k, "color": KIT_HEX.get(k, "#7a3fc4")} for k in kit_names]
    if len(teams) == 1:
        teams.append({"kit": "opponent", "color": "#555555"})
    score = [0, 0]
    for idx, g in enumerate(goals):
        scorer = groups[idx] if groups else 0
        before = list(score)
        score[scorer] += 1
        kind, late = situation(before, list(score), scorer, idx, len(goals), True)
        g.update({"team": scorer, "scoreBefore": before, "scoreAfter": list(score),
                  "situation": kind, "late": late})
    result["teams"] = teams
    result["goals"] = goals

    lead = max(6, int(round(clip_s * 0.7)))
    picked = sorted(goals, key=lambda g: g["score"], reverse=True)[: max(1, max_clips)]
    segments = []
    for g in picked:
        start = max(0, g["cutSec"] - lead)
        end = min(n, start + clip_s)
        start = max(0, end - clip_s)
        when = fmt(g["goalSec"])
        evidence = (
            f"play cut from the pitch to a {g['celebrationSec']} s celebration, crowd "
            f"+{g['roarDb']:.1f} dB above match level"
            + (", followed by a replay" if g["replay"] else "")
        )
        segments.append({
            "title": f"Goal {g['number']} of {len(goals)} — {when}",
            "startMs": start * 1000,
            "endMs": end * 1000,
            "peakSec": g["goalSec"],
            "score": g["score"],
            "reason": f"Goal detected at {when}: {evidence}.",
            "transcript": f"[{label}] Goal {g['number']} at {when} — build-up, finish and celebration ({fmt(start)}–{fmt(end)}).",
            "goal": {
                "number": g["number"],
                "total": len(goals),
                "offsetSec": round(g["goalSec"] - start, 2),
                "team": g.get("team", 0),
                "scoreBefore": g.get("scoreBefore", [0, 0]),
                "scoreAfter": g.get("scoreAfter", [0, 0]),
                "situation": g.get("situation", "opener"),
                "late": g.get("late", False),
                "teams": result.get("teams", []),
            },
        })
    result["segments"] = segments
    return result


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "usage: detect_football_goals.py <video> <max_clips> <clip_seconds> [label]"}))
        sys.exit(2)
    path = sys.argv[1]
    max_clips = int(sys.argv[2])
    clip_s = max(8, int(sys.argv[3]))
    label = sys.argv[4] if len(sys.argv) > 4 else "Goal"
    print(json.dumps(detect(path, max_clips, clip_s, label)))


if __name__ == "__main__":
    main()
