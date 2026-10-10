// Voice: only real recordings, never a synthetic voice.
//   1. Amma's own clip (recorded or uploaded by the user, kept in IndexedDB)
//   2. otherwise the default voice clip from audio/ (listed in audio/clips.json)
//   3. otherwise silence: the captions on screen still guide the user
// Every clip is fine-tuned before it plays (see voicefx.js).
//
// Bell: a temple-bell tone synthesised with Web Audio, so no file is needed.
//
// Clips go through Web Audio (not <audio> tags) because once the AudioContext
// is unlocked by a tap, iPhones let it play later cues without another tap.

import { getSettings } from './store.js';
import { getClip, listClipKeys } from './voicestore.js';
import { tuneClip, createVoiceChain } from './voicefx.js';

const AUDIO_DIR = 'audio/';

const defaultFiles = new Map(); // cue key -> file name in audio/
const ammaKeys = new Set(); // cue keys Amma has recorded
const cache = new Map(); // 'amma:key' | 'default:key' -> Promise<AudioBuffer|null>
let current = null; // { src?, resolve, timer? }
let ctx = null;
let voiceIn = null;
let userPaused = false; // the ritual's pause button, so a stray tap doesn't resume audio

let master = null; // everything plays through this, then a limiter, then the speaker
let meter = null; // measures what is actually being played (for audioState)

// Background voice: one longer recording that plays under the whole ritual.
const BG_LEVEL = 1.0;
const BG_DUCKED = 0.3; // while a spoken line plays
const BG_GAP = 1.2; // seconds of silence between loops
let backgroundFile = null;
let bgBuffer = null;
let bg = null; // { src, gain }

function ensureCtx() {
  if (!ctx) {
    // Let the voice play even when an iPhone's silent switch is on.
    // This must be set before the AudioContext exists.
    setAudioSession('playback');
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    // master → limiter → speaker. The limiter stops the voice + bell from clipping.
    master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    master.connect(limiter).connect(ctx.destination);
    meter = ctx.createAnalyser();
    meter.fftSize = 1024;
    master.connect(meter);

    voiceIn = createVoiceChain(ctx, master);
  }
  return ctx;
}

/** iPhone only (Safari 16.4+): 'playback' ignores the silent switch, 'play-and-record' allows the mic. */
export function setAudioSession(type) {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type;
  } catch {}
}

/** For checking that sound is really coming out: context state + current output level (0..1). */
export function audioState() {
  if (!ctx) return { state: 'none', background: false, speaking: false, level: 0 };
  const data = new Float32Array(meter.fftSize);
  meter.getFloatTimeDomainData(data);
  let sum = 0;
  for (const v of data) sum += v * v;
  return {
    state: ctx.state,
    background: !!bg,
    speaking: !!(current && current.src),
    level: +Math.sqrt(sum / data.length).toFixed(4),
  };
}

// ---------------------------------------------------------------- setup --

/** Loads the list of default clips and the list of Amma's clips. */
export async function initVoices() {
  try {
    const res = await fetch(AUDIO_DIR + 'clips.json', { cache: 'no-cache' });
    if (res.ok) {
      const { clips = [], background = null } = await res.json();
      backgroundFile = background;
      // Entries may be "welcome" (→ welcome.mp3) or "welcome.m4a".
      for (const entry of clips) {
        const name = String(entry);
        const key = name.replace(/\.[a-z0-9]+$/i, '');
        defaultFiles.set(key, /\.[a-z0-9]+$/i.test(name) ? name : name + '.mp3');
      }
    }
  } catch {}
  await refreshAmmaKeys();
}

export async function refreshAmmaKeys() {
  ammaKeys.clear();
  for (const k of await listClipKeys()) ammaKeys.add(k);
  return ammaKeys;
}

export const hasAmma = (key) => ammaKeys.has(key);
export const hasDefault = (key) => defaultFiles.has(key);
export const ammaCount = () => ammaKeys.size;

/** Forget the cached version of Amma's clip after it is re-recorded or removed. */
export function forgetAmma(key) {
  cache.delete('amma:' + key);
}

/** Call from every tap: starts/resumes audio so later cues can play on their own. */
export function unlockAudio() {
  try {
    ensureCtx();
    // 'interrupted' is what an iPhone reports after the photo picker, the mic,
    // a call or switching apps. Any state other than 'running' needs a resume.
    if (ctx.state !== 'running' && !userPaused) ctx.resume();
  } catch {}
}

/** Decodes and fine-tunes raw audio bytes. Rejects if undecodable, null if silent. */
export async function decodeAndTune(arrayBuffer) {
  ensureCtx();
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  return { tuned: tuneClip(ctx, decoded), duration: decoded.duration };
}

function load(source, key) {
  const id = source + ':' + key;
  if (!cache.has(id)) {
    const bytes =
      source === 'amma'
        ? getClip(key).then((rec) => (rec ? rec.data : Promise.reject()))
        : fetch(AUDIO_DIR + defaultFiles.get(key)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()));
    const p = bytes.then((data) => decodeAndTune(data)).then((r) => r.tuned).catch(() => null);
    cache.set(id, p);
  }
  return cache.get(id);
}

async function bufferFor(key, source) {
  const preferAmma = source === 'amma' || (source === 'auto' && getSettings().voiceSource !== 'default');
  if (preferAmma && ammaKeys.has(key)) {
    const b = await load('amma', key);
    if (b || source === 'amma') return b;
  }
  if (source !== 'amma' && defaultFiles.has(key)) return load('default', key);
  return null;
}

/** Warm the cache so the first cues start without a delay. */
export function preloadVoices(keys) {
  ensureCtx();
  for (const key of keys) bufferFor(key, 'auto');
}

// ---------------------------------------------------------------- voice --

/**
 * Plays a cue. Resolves when it finishes, or straight away if the voice is
 * off or there is no recording for it. `source`: 'auto' | 'amma' | 'default'.
 */
export function say(key, { enabled = true, source = 'auto' } = {}) {
  stopVoice();
  if (!enabled) return Promise.resolve();

  const mine = {};
  const promise = new Promise((resolve) => (mine.resolve = resolve));
  current = mine;

  (async () => {
    ensureCtx();
    const buf = await bufferFor(key, source);
    if (current !== mine) return; // replaced while loading
    if (!buf) return finish(mine);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(voiceIn);
    src.onended = () => finish(mine);
    mine.src = src;
    if (ctx.state !== 'running' && !userPaused) ctx.resume();
    duck(true);
    src.start();
    // Safety net in case 'ended' never fires (e.g. the context was closed).
    mine.timer = setTimeout(() => finish(mine), (buf.duration + 3) * 1000);
  })();

  return promise;
}

function finish(entry) {
  clearTimeout(entry.timer);
  if (current === entry) {
    current = null;
    duck(false);
  }
  entry.resolve();
}

/** Pauses all sound (voice, background, bell) until resumeVoice(). */
export function pauseVoice() {
  userPaused = true;
  if (current) clearTimeout(current.timer);
  if (ctx) ctx.suspend();
}

export function resumeVoice() {
  userPaused = false;
  if (ctx) ctx.resume();
  if (!current) return;
  if (current.src) {
    const entry = current;
    entry.timer = setTimeout(() => finish(entry), (entry.src.buffer.duration + 3) * 1000);
  }
}

export function stopVoice() {
  const entry = current;
  if (!entry) return;
  current = null;
  if (entry.src) {
    entry.src.onended = null;
    try {
      entry.src.stop();
    } catch {}
  }
  if (ctx && ctx.state !== 'running' && !userPaused) ctx.resume();
  finish(entry);
}

// ----------------------------------------------------------- background --

export const hasBackground = () => !!backgroundFile;

/** Fades in the background voice, looping, until stopBackground(). */
export async function startBackground() {
  if (!backgroundFile || bg) return;
  ensureCtx();
  if (!bgBuffer) {
    try {
      const res = await fetch(AUDIO_DIR + backgroundFile);
      if (!res.ok) return;
      const decoded = await ctx.decodeAudioData(await res.arrayBuffer());
      // Add a short pause at the end so each loop breathes.
      bgBuffer = ctx.createBuffer(decoded.numberOfChannels, decoded.length + Math.round(BG_GAP * decoded.sampleRate), decoded.sampleRate);
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) bgBuffer.copyToChannel(decoded.getChannelData(ch), ch);
    } catch {
      return;
    }
  }
  if (bg) return; // started twice while loading
  const src = ctx.createBufferSource();
  src.buffer = bgBuffer;
  src.loop = true;
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(current ? BG_DUCKED : BG_LEVEL, now + 1.5);
  src.connect(gain).connect(master);
  if (ctx.state !== 'running' && !userPaused) ctx.resume();
  src.start();
  bg = { src, gain };
}

export function stopBackground(fade = 1.2) {
  if (!bg || !ctx) return;
  const { src, gain } = bg;
  bg = null;
  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + fade);
  try {
    src.stop(now + fade + 0.05);
  } catch {}
}

function duck(on) {
  if (!bg || !ctx) return;
  const g = bg.gain.gain;
  g.cancelScheduledValues(ctx.currentTime);
  g.setTargetAtTime(on ? BG_DUCKED : BG_LEVEL, ctx.currentTime, on ? 0.08 : 0.35);
}

// ----------------------------------------------------------------- bell --

/** A soft temple bell: a few inharmonic partials with a long decay. */
export function ring({ strength = 1, enabled = true } = {}) {
  if (!enabled) return;
  unlockAudio();
  if (!ctx) return;

  const now = ctx.currentTime;
  const base = 660;
  const bell = ctx.createGain();
  bell.gain.value = 0.2 * strength;
  bell.connect(master);

  const partials = [
    [1, 1, 2.8],
    [2.32, 0.55, 1.9],
    [4.07, 0.3, 1.2],
    [6.21, 0.16, 0.8],
  ];
  for (const [ratio, amp, decay] of partials) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const end = now + decay * (0.6 + strength * 0.4);
    osc.type = 'sine';
    osc.frequency.value = base * ratio;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(amp, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g).connect(bell);
    osc.start(now);
    osc.stop(end + 0.05);
  }
}
