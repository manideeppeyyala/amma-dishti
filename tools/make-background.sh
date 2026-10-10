#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Turns a raw voice recording (WhatsApp .opus, .m4a, .mp3, .wav …) into the
# app's background voice: audio/background.m4a
#
#   1. Clean     rumble filter + spectral noise reduction + de-essing
#   2. Change    pitch up and slightly faster (a brighter, livelier voice that
#                does not sound like the original speaker)
#   3. Brighten  EQ for clarity, gentle compression, a touch of room warmth
#   4. Level     loudness-normalised to -16 LUFS, soft fade in/out
#
# Needs:  brew install ffmpeg rubberband
#
# Usage:  tools/make-background.sh "path/to/recording.opus"
#         PITCH=2 TEMPO=1.04 tools/make-background.sh in.opus   # tweak the change
#
# PITCH is in semitones (0 = keep the voice as it is, 2 = default, 3+ = very different).
# TEMPO is a speed multiplier (1.0 = same speed).
# ---------------------------------------------------------------------------
set -euo pipefail

IN="${1:?usage: tools/make-background.sh <recording>}"
PITCH="${PITCH:-2}"
TEMPO="${TEMPO:-1.04}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/audio/background.m4a"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

command -v ffmpeg >/dev/null || { echo "error: ffmpeg missing (brew install ffmpeg)"; exit 1; }
command -v rubberband >/dev/null || { echo "error: rubberband missing (brew install rubberband)"; exit 1; }

echo "1/4  cleaning"
ffmpeg -hide_banner -loglevel error -y -i "$IN" -ac 1 -ar 48000 \
  -af "highpass=f=80,afftdn=nf=-28:nr=12:tn=1,deesser=i=0.35" \
  "$TMP/clean.wav"

echo "2/4  changing the voice (pitch +$PITCH semitones, tempo x$TEMPO)"
rubberband -3 -q -p "$PITCH" -T "$TEMPO" "$TMP/clean.wav" "$TMP/changed.wav"

DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TMP/changed.wav")"
FADE_OUT_AT="$(awk -v d="$DUR" 'BEGIN { printf "%.2f", (d > 1.2 ? d - 0.9 : 0) }')"

echo "3/4  brightening + 4/4  levelling"
ffmpeg -hide_banner -loglevel error -y -i "$TMP/changed.wav" -af "\
equalizer=f=300:t=q:w=1.2:g=-2.5,\
equalizer=f=3000:t=q:w=1.0:g=3,\
highshelf=f=6500:g=2,\
acompressor=threshold=-20dB:ratio=2.5:attack=8:release=150:makeup=2,\
aecho=0.88:0.6:35|55:0.10|0.07,\
loudnorm=I=-16:TP=-1.5:LRA=7,\
afade=t=in:st=0:d=0.4,afade=t=out:st=$FADE_OUT_AT:d=0.9" \
  -ar 44100 -c:a aac -b:a 112k -movflags +faststart "$OUT"

echo "done → $OUT ($(printf '%.1f' "$DUR") s)"
