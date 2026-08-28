#!/usr/bin/env bash
# Convert a recorded .webm into an MP4 that players and upload pipelines accept.
#
# The ⏺ button pushes frames manually, which is what makes the render
# deterministic — but MediaRecorder then stamps the file with a nonsense frame
# rate (ffprobe reads it as 1000/1) and a duration a few percent short. Neither
# is a problem with the pictures; both confuse players.
#
# Forcing a constant rate on the way out fixes both. The frame COUNT is already
# exact, so this only rewrites the timing.
#
#   ./tools/to-mp4.sh captcha_short-9x16.webm [fps]

set -euo pipefail

src=${1:?usage: to-mp4.sh <file.webm> [fps]}
fps=${2:-30}
out="${src%.*}.mp4"

ffmpeg -hide_banner -loglevel error \
  -r "$fps" -i "$src" \
  -vf "fps=$fps" \
  -c:v libx264 -pix_fmt yuv420p -profile:v high -crf 18 \
  -movflags +faststart \
  -y "$out"

echo "wrote $out"
ffprobe -v error -count_frames \
  -show_entries stream=width,height,r_frame_rate,nb_read_frames \
  -show_entries format=duration \
  -of default=noprint_wrappers=1 "$out"
