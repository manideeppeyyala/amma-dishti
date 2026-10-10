// Records from the microphone with MediaRecorder. The phone's own echo
// cancelling and noise suppression are switched on for a cleaner voice.

import { setAudioSession } from './sound.js';

const MAX_SECONDS = 20;

export const canRecord = () =>
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

function pickMime() {
  const options = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return options.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
}

/**
 * Starts recording. `onLevel(0..1)` is called while recording for a meter,
 * `onTick(seconds)` once per second. Resolves to { stop(), result } where
 * result is a Promise<Blob>.
 */
export async function startRecording({ onLevel, onTick } = {}) {
  setAudioSession('play-and-record');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (err) {
    setAudioSession('playback');
    throw err;
  }

  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);

  // Live level meter.
  let meterCtx = null;
  let raf = 0;
  try {
    meterCtx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = meterCtx.createAnalyser();
    analyser.fftSize = 512;
    meterCtx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const loop = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      onLevel?.(Math.min(1, Math.sqrt(sum / buf.length) * 6));
      raf = requestAnimationFrame(loop);
    };
    loop();
  } catch {}

  let seconds = 0;
  const ticker = setInterval(() => {
    seconds++;
    onTick?.(seconds);
    if (seconds >= MAX_SECONDS) stop();
  }, 1000);

  const result = new Promise((resolve) => {
    rec.onstop = () => {
      clearInterval(ticker);
      cancelAnimationFrame(raf);
      meterCtx?.close().catch(() => {});
      stream.getTracks().forEach((t) => t.stop());
      setAudioSession('playback'); // back to loud-speaker playback
      resolve(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }));
    };
  });

  function stop() {
    if (rec.state !== 'inactive') rec.stop();
  }

  rec.start(250);
  return { stop, result };
}
