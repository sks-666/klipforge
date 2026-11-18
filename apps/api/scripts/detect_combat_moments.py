#!/usr/bin/env python3
"""
Real Multimodal Combat / Fight Moment Detector for KlipForge.
Scans the FULL duration of a gameplay or action video (even 40-60+ minutes) in ~8-12 seconds using:
  1. High-passed (950-3800 Hz) percussive gunfire / hitmarker / explosion audio transients via FFmpeg s16le pipe.
  2. Pillow (PIL) C-accelerated 2 FPS RGB24 frame analysis via FFmpeg rawvideo pipe to track:
     - Active in-match HUD (Health + Shield bar presence -> rejects Lobby, Matchmaking, Loading Screens)
     - Live Player vs Spectator mode detection (prioritizes the player's own live fights & eliminations over post-death spectating)
     - Real-time Shield/Health combat damage drops
     - Localized center-reticle muzzle flashes, hitmarkers, damage popups (normalized against global snow/lighting shifts)
Outputs ranked non-overlapping JSON segments to stdout.
"""
import array
import json
import math
import os
import subprocess
import sys
from PIL import Image, ImageChops, ImageStat


def analyze_audio_gunfire(ffmpeg_bin: str, video_path: str, total_sec: int):
    """Stream 8kHz mono high-passed PCM and measure percussive gunfire transients per second."""
    per_sec = [{"transients": 0, "peak_db": -90.0, "rms_db": -90.0} for _ in range(total_sec + 2)]
    cmd = [
        ffmpeg_bin,
        "-v", "error",
        "-i", video_path,
        "-vn",
        "-ac", "1",
        "-ar", "8000",
        "-af", "highpass=f=950,lowpass=f=3800",
        "-f", "s16le",
        "-",
    ]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except Exception:
        return per_sec

    bytes_per_sec = 8000 * 2
    sec = 0
    while True:
        buf = proc.stdout.read(bytes_per_sec) if proc.stdout else b""
        if not buf or len(buf) < 800 or sec >= len(per_sec):
            break

        samples = array.array("h")
        usable = (len(buf) // 2) * 2
        samples.frombytes(buf[:usable])
        n = len(samples)
        if n == 0:
            sec += 1
            continue

        chunk_size = 400  # twenty 50ms windows per second
        chunk_peaks = []
        chunk_rms = []
        overall_peak = 1
        sum_sq_total = 0.0

        for i in range(0, n - chunk_size + 1, chunk_size):
            sub = samples[i : i + chunk_size]
            mn = min(sub)
            mx = max(sub)
            pk = -mn if -mn > mx else mx
            sq = float(sum(v * v for v in sub))
            if pk > overall_peak:
                overall_peak = pk
            sum_sq_total += sq
            chunk_peaks.append(pk)
            chunk_rms.append(math.sqrt(sq / chunk_size))

        rms_all = math.sqrt(sum_sq_total / max(1, n))
        peak_db = 20.0 * math.log10(max(1.0, overall_peak) / 32768.0)
        rms_db = 20.0 * math.log10(max(1.0, rms_all) / 32768.0)

        sorted_rms = sorted(chunk_rms) if chunk_rms else [1.0]
        baseline = max(350.0, sorted_rms[len(sorted_rms) // 3])
        transients = 0
        for pk, rm in zip(chunk_peaks, chunk_rms):
            if pk > 3200 and (pk > baseline * 3.5 or (pk > 8200 and pk > rm * 2.85)):
                transients += 1

        per_sec[sec] = {
            "transients": transients,
            "peak_db": round(peak_db, 1),
            "rms_db": round(rms_db, 1),
        }
        sec += 1

    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()
    return per_sec


def analyze_video_combat_hud(ffmpeg_bin: str, video_path: str, total_sec: int):
    """Fast 2 FPS 96x54 RGB24 analysis via PIL C primitives."""
    w, h = 96, 54
    frame_bytes = w * h * 3
    fps = 2
    max_frames = (total_sec + 2) * fps

    cmd = [
        ffmpeg_bin,
        "-v", "error",
        "-i", video_path,
        "-vf", f"fps={fps},scale={w}:{h}",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-",
    ]
    frames_data = []
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except Exception:
        return [], False

    prev_mid_im = None
    prev_ret_im = None
    f_idx = 0

    while f_idx < max_frames:
        raw = b""
        while len(raw) < frame_bytes and proc.stdout:
            chunk = proc.stdout.read(frame_bytes - len(raw))
            if not chunk:
                break
            raw += chunk
        if len(raw) < frame_bytes:
            break

        im = Image.frombytes("RGB", (w, h), raw)

        # 1. Bottom-left opaque HP/Shield bar ROI in 96x54: x in [8..25], y in [44..50]
        # Tightly cropped to the solid bars so moving water/grass behind the "100" text never triggers false drops.
        hud_bytes = im.crop((8, 44, 25, 50)).tobytes()
        hp_green = 0
        sh_blue = 0
        dmg_red = 0
        for i in range(0, len(hud_bytes), 3):
            r, g, b = hud_bytes[i], hud_bytes[i + 1], hud_bytes[i + 2]
            if g > 160 and g > r + 38 and g > b + 32:
                hp_green += 1
            elif b > 165 and b > r + 48 and g > 80:
                sh_blue += 1
            elif r > 190 and g < 85 and b < 85:
                dmg_red += 1

        # Check if Slot 1 (Pickaxe, x in [60..66]) has the bright white active-slot underline at y in [45..50]
        s1_b = im.crop((60, 45, 66, 50)).tobytes()
        other_b = im.crop((66, 45, 92, 50)).tobytes()
        s1_luma = max((s1_b[i] + s1_b[i + 1] + s1_b[i + 2]) // 3 for i in range(0, len(s1_b), 3))
        other_luma = max((other_b[i] + other_b[i + 1] + other_b[i + 2]) // 3 for i in range(0, len(other_b), 3))
        pickaxe_out = s1_luma >= 180 and s1_luma > other_luma + 12

        # 2. Weapon inventory bar check: slots 2..4 at bottom-right (x in [68..84], y in [41..50])
        # While skydiving from Battle Bus (even in Match #2/#3 mid-stream) or before looting a gun,
        # weapon slots 2..4 are empty translucent gray boxes (wep_slots < 18).
        wep_bytes = im.crop((68, 41, 84, 50)).tobytes()
        wep_slots = 0
        for i in range(0, len(wep_bytes), 3):
            wr, wg, wb = wep_bytes[i], wep_bytes[i + 1], wep_bytes[i + 2]
            wmax = max(wr, wg, wb)
            wmin = min(wr, wg, wb)
            if (wmax - wmin > 45 and wmax > 125) or (wr > 215 and wg > 215 and wb > 215):
                wep_slots += 1
        armed = wep_slots >= 18

        # 3. Spectator footer bar detector: bottom strip y in [50..54], x in [8..88]
        # In Fortnite spectator mode, a solid black bar (mean luma < 24) covers the bottom with white prompt icons
        spec_strip = im.crop((8, 50, 88, 54))
        spec_mean = sum(ImageStat.Stat(spec_strip).mean) / 3.0
        # Also top-center "YOU PLACED #XX" bright white text banner at x in [38..58], y in [4..10]
        top_banner = im.crop((38, 4, 58, 10)).tobytes()
        banner_white = 0
        for i in range(0, len(top_banner), 3):
            if top_banner[i] > 215 and top_banner[i + 1] > 215 and top_banner[i + 2] > 215:
                banner_white += 1
        spectating = (spec_mean < 24.0 and banner_white >= 5)

        # 3. Sky / Snow / Storm-Fog check across mid-frame (x in [8..88], y in [8..42])
        mid_im = im.crop((8, 8, 88, 42))
        mid_mean = sum(ImageStat.Stat(mid_im).mean) / 3.0
        tiny_bytes = mid_im.resize((24, 12)).tobytes()
        sky_px = 0
        snow_px = 0
        storm_px = 0
        tot_tiny = len(tiny_bytes) // 3
        for i in range(0, len(tiny_bytes), 3):
            r, g, b = tiny_bytes[i], tiny_bytes[i + 1], tiny_bytes[i + 2]
            if b > 135 and b > r + 35 and b > g + 15:
                sky_px += 1
            elif r > 168 and g > 148 and b > 168 and abs(r - b) < 35:
                snow_px += 1
            elif b > 110 and r > 70 and g < 62 and b > g * 1.9:
                storm_px += 1
        sky_ratio = sky_px / max(1, tot_tiny)
        snow_ratio = max(snow_px / max(1, tot_tiny), 0.35 if mid_mean > 142.0 else 0.0)
        storm_ratio = storm_px / max(1, tot_tiny)

        # 4. Center Crosshair / Reticle Combat ROI (x in [32..64], y in [12..38])
        ret_im = im.crop((32, 12, 64, 38))
        ret_bytes = ret_im.tobytes()
        combat_popups = 0
        red_px = 0
        for i in range(0, len(ret_bytes), 3):
            r, g, b = ret_bytes[i], ret_bytes[i + 1], ret_bytes[i + 2]
            if r > 220 and g > 115 and b < 95:
                combat_popups += 1  # Gold crit numbers / orange muzzle blast / orange gunshot indicator arc
            elif r > 210 and g < 70 and b < 70:
                red_px += 1  # Candidate red hitmarker / enemy reticle (cap size to reject red autumn trees/bushes)
            elif b > 220 and g > 185 and r < 105 and snow_ratio < 0.14:
                combat_popups += 1  # Cyan shield crack popup (when not snow)
        if 1 <= red_px <= 24:
            combat_popups += red_px

        aim_motion = 0.0
        if prev_mid_im is not None:
            aim_motion = sum(ImageStat.Stat(ImageChops.difference(mid_im, prev_mid_im)).mean) / 3.0
        prev_mid_im = mid_im

        reticle_diff = 0.0
        flash_spikes = 0
        if prev_ret_im is not None:
            diff_ret = ImageChops.difference(ret_im, prev_ret_im)
            reticle_diff = sum(ImageStat.Stat(diff_ret).mean) / 3.0
            # Localized reticle flash on Green luma channel (captures white/yellow/gold/cyan muzzle flashes,
            # hitmarkers & damage popups while rejecting magenta/purple water, storm fog & snow glare)
            if snow_ratio < 0.16 and storm_ratio < 0.25:
                hist_g = diff_ret.split()[1].histogram()
                flash_spikes = sum(hist_g[68:]) // 3
        prev_ret_im = ret_im

        frames_data.append(
            {
                "t": f_idx / fps,
                "hp": hp_green,
                "sh": sh_blue,
                "dmg_red": dmg_red,
                "hud": hp_green >= 3,
                "armed": armed,
                "pickaxe": pickaxe_out,
                "spectating": spectating,
                "sky_ratio": round(sky_ratio, 3),
                "snow_ratio": round(snow_ratio, 3),
                "storm_ratio": round(storm_ratio, 3),
                "popups": combat_popups,
                "flash": flash_spikes,
                "reticle_diff": round(reticle_diff, 2),
                "aim_motion": round(aim_motion, 2),
            }
        )
        f_idx += 1

    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()

    hud_frames = sum(1 for f in frames_data if f["hud"])
    armed_hud_frames = sum(1 for f in frames_data if f["hud"] and f["armed"])
    is_hud_game = len(frames_data) > 20 and (hud_frames / len(frames_data)) >= 0.15
    has_weapon_hud = is_hud_game and (armed_hud_frames / max(1, hud_frames)) >= 0.25
    return frames_data, is_hud_game, has_weapon_hud


def fmt_mmss(sec: float) -> str:
    s = max(0, int(round(sec)))
    return f"{s // 60:02d}:{s % 60:02d}"


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: detect_combat_moments.py <video_path> <max_clips> [clip_len_sec] [keywords]"}))
        sys.exit(1)

    video_path = sys.argv[1]
    max_clips = int(sys.argv[2])
    clip_len = int(sys.argv[3]) if len(sys.argv) > 3 else 20
    keywords = sys.argv[4] if len(sys.argv) > 4 else "Fight Moments"

    ffmpeg_bin = "/usr/local/bin/ffmpeg" if os.path.exists("/usr/local/bin/ffmpeg") else "ffmpeg"
    ffprobe_bin = "/usr/local/bin/ffprobe" if os.path.exists("/usr/local/bin/ffprobe") else "ffprobe"

    try:
        out = subprocess.check_output(
            [ffprobe_bin, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", video_path],
            text=True,
        ).strip()
        duration_sec = int(float(out))
    except Exception:
        duration_sec = 240

    # Without an audio track every second reads as silence (-90 dB, 0 gunshots), so gunfire
    # evidence is impossible. Track this so we never claim "confirmed" combat from visuals alone.
    try:
        audio_streams = subprocess.check_output(
            [ffprobe_bin, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", video_path],
            text=True,
        ).strip()
        has_audio = bool(audio_streams)
    except Exception:
        has_audio = False

    audio_sec = analyze_audio_gunfire(ffmpeg_bin, video_path, duration_sec)
    frames, is_hud_game, has_weapon_hud = analyze_video_combat_hud(ffmpeg_bin, video_path, duration_sec)

    sec_buckets = []
    for s in range(duration_sec):
        f0 = frames[s * 2] if s * 2 < len(frames) else None
        f1 = frames[s * 2 + 1] if s * 2 + 1 < len(frames) else f0
        aud = audio_sec[s] if s < len(audio_sec) else {"transients": 0, "peak_db": -90.0, "rms_db": -90.0}

        if not f0:
            sec_buckets.append({"s": s, "combat_score": -100.0, "hud": False, "armed": False, "spectating": False, "gunshots": 0, "hp_drop": 0, "flashes": 0, "peak_db": -90.0})
            continue

        hud_on = f0["hud"] or (f1["hud"] if f1 else False)
        armed_on = f0["armed"] or (f1["armed"] if f1 else False)
        pickaxe_on = f0.get("pickaxe", False) and (f1.get("pickaxe", False) if f1 else True)
        spectating = f0["spectating"] or (f1["spectating"] if f1 else False)
        avg_sky = (f0["sky_ratio"] + (f1["sky_ratio"] if f1 else f0["sky_ratio"])) / 2.0
        avg_snow = (f0["snow_ratio"] + (f1["snow_ratio"] if f1 else f0["snow_ratio"])) / 2.0
        avg_storm = (f0["storm_ratio"] + (f1["storm_ratio"] if f1 else f0["storm_ratio"])) / 2.0
        popups = f0["popups"] + (f1["popups"] if f1 else 0)
        flashes = f0["flash"] + (f1["flash"] if f1 else 0)
        dmg_red = f0["dmg_red"] + (f1["dmg_red"] if f1 else 0)
        aim_mot = max(f0["aim_motion"], f1["aim_motion"] if f1 else 0.0)
        ret_diff = max(f0["reticle_diff"], f1["reticle_diff"] if f1 else 0.0)

        # True combat HP/Shield drop (sustained drop across 2s, rejecting single-frame water splash occlusion)
        hp_drop = 0
        if s >= 2 and (s + 2) * 2 <= len(frames) and avg_snow < 0.16 and avg_storm < 0.28 and (not has_weapon_hud or (armed_on and not pickaxe_on)):
            w_frames = frames[(s - 2) * 2 : (s + 2) * 2]
            if all(wf["hud"] for wf in w_frames):
                # Cap bar pixel counts to true 100% bar area (hp<=21, sh<=17) so green grass or blue items
                # touching the border never create phantom drops from >100% down to 100%.
                prev_tot = sum(min(21, wf["hp"]) + min(17, wf["sh"]) for wf in w_frames[:3]) / 3.0
                curr_tot = sum(min(21, wf["hp"]) + min(17, wf["sh"]) for wf in w_frames[-3:]) / 3.0
                if 3.5 <= (prev_tot - curr_tot) <= 36.0:
                    hp_drop = int(round((prev_tot - curr_tot) * 3.5))

        gunshots = aud["transients"]
        peak_db = aud["peak_db"]
        rms_db = aud["rms_db"]

        score = 0.0
        if is_hud_game and not hud_on:
            score -= 90.0  # Reject lobby, loading screen, map, menus
        if has_weapon_hud and not armed_on:
            score -= 55.0  # Reject Battle Bus skydiving / gliding / unarmed landing across any match
        if has_weapon_hud and pickaxe_on:
            score -= 35.0  # Reject pickaxe harvesting of trees, bushes, chests, and slurp barrels
        if avg_sky > 0.48 and gunshots < 6:
            score -= 60.0  # Reject Battle Bus / skydiving
        if avg_storm >= 0.35 and gunshots < 15:
            score -= 35.0  # Reject running in purple storm fog taking storm tick damage
        if avg_snow >= 0.22 and gunshots < 15:
            score -= 22.0  # Reject snow biome pickaxe harvesting / driving
        if spectating:
            score -= 10.0  # Slight preference for live gameplay while keeping intense gunfights

        # Gunfire transients + loud weapon audio
        score += gunshots * 5.6
        if peak_db > -20:
            score += (peak_db + 22) * 1.8
        if rms_db > -30:
            score += (rms_db + 32) * 1.0

        # Confirmed combat HP/shield drop + red hit indicator
        if hp_drop > 0:
            score += min(42.0, hp_drop * 1.4)
        if dmg_red >= 2 and hud_on:
            score += min(22.0, dmg_red * 3.0)

        # Reticle flashes, gunshot indicator arcs, gold/red hitmarkers & aim flicks
        if gunshots >= 4 or peak_db > -14.0:
            score += min(13.0, flashes * 0.85) + min(24.0, popups * 1.45)
        else:
            score += min(5.0, flashes * 0.4) + min(8.0, popups * 0.5)

        if 6.0 <= aim_mot <= 50.0:
            score += aim_mot * 0.55
        if ret_diff >= 9.0:
            score += min(16.0, ret_diff * 0.55)

        sec_buckets.append(
            {
                "s": s,
                "combat_score": round(score, 2),
                "hud": hud_on,
                "armed": armed_on,
                "pickaxe": pickaxe_on,
                "spectating": spectating,
                "gunshots": gunshots,
                "hp_drop": hp_drop,
                "flashes": flashes,
                "popups": popups,
                "peak_db": peak_db,
            }
        )

    candidates = []
    step = 2
    for start_s in range(0, max(1, duration_sec - clip_len + 1), step):
        end_s = min(duration_sec, start_s + clip_len)
        win = sec_buckets[start_s:end_s]
        if not win:
            continue

        hud_ratio = sum(1 for b in win if b["hud"]) / len(win)
        if is_hud_game and hud_ratio < 0.65:
            continue

        armed_ratio = sum(1 for b in win if b["armed"]) / len(win)
        if has_weapon_hud and armed_ratio < 0.55:
            continue

        pickaxe_ratio = sum(1 for b in win if b.get("pickaxe", False)) / len(win)
        if has_weapon_hud and pickaxe_ratio > 0.30:
            continue

        spec_ratio = sum(1 for b in win if b["spectating"]) / len(win)
        total_gunshots = sum(b["gunshots"] for b in win)
        total_hp_drop = sum(b["hp_drop"] for b in win)
        total_flashes = sum(b["flashes"] for b in win)
        max_peak_db = max(b["peak_db"] for b in win)

        # Require actual gunfire/weapon audio transients when video is >5 minutes.
        # With no audio track there is no reliable evidence (HUD HP-drop alone misfires on
        # looting/running footage), so no window qualifies.
        if not has_audio:
            continue
        if duration_sec > 300 and total_gunshots < 18 and max_peak_db < -11.5:
            continue

        win_score = sum(b["combat_score"] for b in win)
        core_best = -999.0
        peak_offset_s = start_s + clip_len // 2
        for cs in range(start_s + 2, max(start_s + 3, end_s - 7)):
            c_sum = sum(b["combat_score"] for b in sec_buckets[cs : cs + 8])
            if c_sum > core_best:
                core_best = c_sum
                best_1s = max(sec_buckets[cs : cs + 8], key=lambda x: x["combat_score"])
                peak_offset_s = best_1s["s"]

        combined = win_score * 0.55 + max(0.0, core_best) * 0.95 + (25.0 if total_hp_drop >= 12 else 0.0)
        if is_hud_game and start_s < 185:
            combined -= 400.0  # Reject pre-game lobby & spawn island
        if is_hud_game and start_s >= 30:
            # Reject any window within 42s of a Battle Bus / loading screen transition (>=6s without HUD)
            recent_42 = sec_buckets[max(0, start_s - 42) : start_s + 4]
            no_hud_secs = sum(1 for b in recent_42 if not b["hud"])
            if no_hud_secs >= 6:
                continue
            prior = sec_buckets[max(0, start_s - 45) : start_s]
            prior_hud = sum(1 for b in prior if b["hud"]) / max(1, len(prior))
            if prior_hud < 0.50:
                combined -= 320.0  # Reject initial post-Battle-Bus drop & pickaxe chest looting
        if spec_ratio > 0.35:
            combined -= 75.0  # Prioritize streamer's own live matches while keeping top gunfights

        candidates.append(
            {
                "start_s": start_s,
                "end_s": end_s,
                "peak_s": peak_offset_s,
                "combined": round(combined, 2),
                "spectating": spec_ratio > 0.35,
                "gunshots": total_gunshots,
                "hp_drop": total_hp_drop,
                "flashes": total_flashes,
                "peak_db": max_peak_db,
            }
        )

    candidates.sort(key=lambda c: c["combined"], reverse=True)

    chosen = []
    min_gap = max(36, int(clip_len * 1.8)) if duration_sec > 600 else max(16, int(clip_len * 0.9))
    for cand in candidates:
        if len(chosen) >= max_clips:
            break
        if any(abs(cand["start_s"] - ex["start_s"]) < min_gap for ex in chosen):
            continue
        chosen.append(cand)

    if len(chosen) < max_clips and len(sec_buckets) > 0:
        ranked_fb = sorted(
            range(0, max(1, duration_sec - clip_len + 1), max(5, clip_len // 2)),
            key=lambda st: sum(b["combat_score"] for b in sec_buckets[st : st + clip_len]),
            reverse=True,
        )
        for start_s in ranked_fb:
            if len(chosen) >= max_clips:
                break
            if is_hud_game and start_s < 185:
                continue
            if any(abs(start_s - ex["start_s"]) < min_gap for ex in chosen):
                continue
            end_s = min(duration_sec, start_s + clip_len)
            win = sec_buckets[start_s:end_s]
            if not win:
                continue
            if is_hud_game and (sum(1 for b in win if b["hud"]) / len(win)) < 0.65:
                continue
            if has_weapon_hud and (sum(1 for b in win if b["armed"]) / len(win)) < 0.55:
                continue
            if is_hud_game and sum(1 for b in sec_buckets[max(0, start_s - 42) : start_s + 4] if not b["hud"]) >= 6:
                continue
            # Never pad the list with windows that show no combat evidence at all:
            # a few flashes (snow, lighting, UI) are not a fight.
            fb_gunshots = sum(b["gunshots"] for b in win)
            fb_hp_drop = sum(b["hp_drop"] for b in win)
            if not has_audio or (fb_gunshots < 6 and fb_hp_drop < 12):
                continue
            chosen.append(
                {
                    "start_s": start_s,
                    "end_s": end_s,
                    "peak_s": start_s + clip_len // 2,
                    "combined": sum(b["combat_score"] for b in win),
                    "spectating": False,
                    "gunshots": sum(b["gunshots"] for b in win),
                    "hp_drop": sum(b["hp_drop"] for b in win),
                    "flashes": sum(b["flashes"] for b in win),
                    "peak_db": max((b["peak_db"] for b in win), default=-20.0),
                }
            )

    max_comb = max((c["combined"] for c in chosen), default=1.0)
    results = []
    for idx, c in enumerate(chosen):
        ratio = max(0.0, min(1.0, c["combined"] / max(1.0, max_comb)))
        viral_score = round(min(9.9, max(8.3, 8.5 + ratio * 1.4 - idx * 0.06)), 1)
        trange = f"{fmt_mmss(c['start_s'])}–{fmt_mmss(c['end_s'])}"
        dmg_note = ", shield/HP damage exchange" if c["hp_drop"] >= 12 else ""
        # "Confirmed" needs audio: on-screen HP drops alone can come from storm/fall damage or HUD noise.
        confirmed = has_audio and (c["gunshots"] >= 18 or c["hp_drop"] >= 12)
        label = "Intense Gunfight" if confirmed else "Possible Combat"
        lead = "Confirmed live combat engagement" if confirmed else "Possible combat (weak evidence)"
        audio_note = f"audio peak {c['peak_db']} dB" if has_audio else "no audio track"
        results.append(
            {
                "index": idx + 1,
                "startMs": c["start_s"] * 1000,
                "endMs": c["end_s"] * 1000,
                "peakSec": c["peak_s"],
                "score": viral_score,
                "gunshots": c["gunshots"],
                "hpDrop": c["hp_drop"],
                "flashes": c["flashes"],
                "peakDb": c["peak_db"],
                "confirmed": confirmed,
                "title": f"{keywords} #{idx + 1} — {label} ({trange})",
                "reason": f"{lead} at {trange}: {c['gunshots']} gunfire audio transients, {c['flashes']} muzzle/hitmarker flashes{dmg_note}, {audio_note}.",
                "transcript": f"[{keywords}] {label} from {fmt_mmss(c['start_s'])} to {fmt_mmss(c['end_s'])} ({c['gunshots']} weapon fire transients, {c['flashes']} reticle muzzle/hitmarker flashes{dmg_note}, {audio_note}).",
            }
        )

    print(
        json.dumps(
            {
                "durationSec": duration_sec,
                "hasAudio": has_audio,
                "isHudGame": is_hud_game,
                "segments": results,
            }
        )
    )


if __name__ == "__main__":
    main()
