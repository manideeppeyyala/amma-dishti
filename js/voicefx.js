// "Fine-tuning" for every voice clip, Amma's or the default one:
//   1. mix to mono
//   2. trim the silence before and after the voice
//   3. even out the loudness so every line plays at the same level
//   4. short fades so nothing clicks
// On playback the clip also runs through a rumble filter, a gentle
// presence lift and a soft compressor (see createVoiceChain).

const WINDOW_SEC = 0.01;
const PAD_START = 0.06;
const PAD_END = 0.18;
const TARGET_RMS = 0.11; // about -19 dBFS: clear on a phone speaker
const PEAK_CEILING = 0.92;
const MAX_GAIN = 10;

/** Returns a cleaned mono AudioBuffer, or null when no voice is found. */
export function tuneClip(ctx, input) {
  const sr = input.sampleRate;
  const len = input.length;
  const mono = new Float32Array(len);
  for (let ch = 0; ch < input.numberOfChannels; ch++) {
    const data = input.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += data[i] / input.numberOfChannels;
  }

  // Loudness of each 10 ms window.
  const win = Math.max(1, Math.round(sr * WINDOW_SEC));
  const windows = Math.ceil(len / win);
  const rms = new Float32Array(windows);
  let loudest = 0;
  for (let w = 0; w < windows; w++) {
    let sum = 0;
    const end = Math.min(len, (w + 1) * win);
    for (let i = w * win; i < end; i++) sum += mono[i] * mono[i];
    rms[w] = Math.sqrt(sum / (end - w * win));
    if (rms[w] > loudest) loudest = rms[w];
  }
  if (loudest < 0.004) return null; // nothing but silence

  // Where the voice starts and stops.
  const gate = Math.max(0.006, loudest * 0.1);
  let first = 0;
  while (first < windows && rms[first] < gate) first++;
  let last = windows - 1;
  while (last > first && rms[last] < gate) last--;

  const start = Math.max(0, first * win - Math.round(PAD_START * sr));
  const stop = Math.min(len, (last + 1) * win + Math.round(PAD_END * sr));
  const out = mono.subarray(start, stop);

  // Level: aim for a steady speaking loudness without clipping.
  let voicedSum = 0;
  let voicedCount = 0;
  let peak = 0;
  for (let w = first; w <= last; w++) {
    if (rms[w] >= gate) {
      voicedSum += rms[w] * rms[w];
      voicedCount++;
    }
  }
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const voicedRms = Math.sqrt(voicedSum / Math.max(1, voicedCount));
  const gain = Math.min(TARGET_RMS / voicedRms, PEAK_CEILING / peak, MAX_GAIN);

  const buffer = ctx.createBuffer(1, out.length, sr);
  const dest = buffer.getChannelData(0);
  const fadeIn = Math.round(0.012 * sr);
  const fadeOut = Math.round(0.06 * sr);
  for (let i = 0; i < out.length; i++) {
    let g = gain;
    if (i < fadeIn) g *= i / fadeIn;
    const fromEnd = out.length - 1 - i;
    if (fromEnd < fadeOut) g *= fromEnd / fadeOut;
    dest[i] = out[i] * g;
  }
  return buffer;
}

/** Playback chain: rumble cut → presence lift → soft compressor → `output`. Returns its input node. */
export function createVoiceChain(ctx, output = ctx.destination) {
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 85;
  highpass.Q.value = 0.7;

  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 2800;
  presence.Q.value = 0.9;
  presence.gain.value = 2.5;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -22;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.006;
  comp.release.value = 0.2;

  highpass.connect(presence).connect(comp).connect(output);
  return highpass;
}
