#!/bin/bash
# Turn a screen recording into an H.264 .mp4 that fits TikTok's 50 MB upload limit.
# Usage: compress.sh <recording.mov|mp4> [output.mp4]
set -euo pipefail
in="${1:?usage: compress.sh <recording> [output.mp4]}"
out="${2:-$(dirname "$in")/klipforge-tiktok-demo.mp4}"
limit_mb=48

dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$in")
# Video bitrate that lands under the limit (kbit/s), capped at 4500 for 1080p screen video.
kbps=$(awk -v d="$dur" -v mb="$limit_mb" 'BEGIN { b = int(mb * 8192 / d) - 96; if (b > 4500) b = 4500; print b }')
if [ "$kbps" -lt 600 ]; then
  echo "This recording is too long for one 50 MB file (${dur%.*}s). Split it into parts first." >&2
  exit 1
fi

ffmpeg -hide_banner -loglevel warning -y -i "$in" \
  -vf "scale='min(1920,iw)':-2:flags=lanczos,fps=30" \
  -c:v libx264 -preset slow -b:v "${kbps}k" -maxrate "$((kbps * 2))k" -bufsize "$((kbps * 4))k" \
  -pix_fmt yuv420p -movflags +faststart -an "$out"

size=$(du -m "$out" | cut -f1)
echo "Wrote $out (${size} MB, ${dur%.*}s)"
