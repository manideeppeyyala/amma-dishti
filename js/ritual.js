// The guided ritual: Amma (with the uploaded photo as her face) stands
// facing you and moves the item around you with her hand, with counts,
// voice and bell. Pause, restart and close all work at any moment.

import { PHASES, COUNTS, UI } from './data.js';
import {
  say,
  pauseVoice,
  resumeVoice,
  stopVoice,
  ring,
  unlockAudio,
  preloadVoices,
  startBackground,
  stopBackground,
  audioState,
} from './sound.js';

const CANCEL = Symbol('cancel');
const COUNT_KEYS = ['one', 'two', 'three'];
const SVGNS = 'http://www.w3.org/2000/svg';
const TRAIL = 14;
const SWEEPS_PER_PHASE = 3;
const SWEEP_PHASES = ['around', 'left', 'right'];
const TOTAL_SWEEPS = SWEEP_PHASES.length * SWEEPS_PER_PHASE;

// Amma's figure, in SVG units (viewBox 300 × 420). She faces you, so her
// right hand is on the left of the screen, which is your left side.
const FACE = { x: 150, y: 100, r: 40 };
const SHOULDER = { right: { x: 113, y: 177 }, left: { x: 187, y: 177 } };
const ARM = { upper: 82, fore: 80 };
const REST = { right: { x: 102, y: 262 }, left: { x: 198, y: 262 } };
const BLESS = { x: 92, y: 132 };
const AROUND = { x: 150, y: 214, rx: 64, ry: 52 };
const SIDE_X = { left: 46, right: 254 };
const SIDE_Y = [66, 318];
const SPIT_AT = { x: 150, y: 228 };

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function bi(obj, lang) {
  const other = lang === 'te' ? 'en' : 'te';
  return `<span class="pri">${esc(obj[lang])}</span><span class="sec">${esc(obj[other])}</span>`;
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Two-bone arm: returns the elbow and the hand (clamped to the arm's reach). */
function solveArm(s, target, outward) {
  const dx = target.x - s.x;
  const dy = target.y - s.y;
  const dist = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(ARM.upper - ARM.fore) + 1), ARM.upper + ARM.fore - 0.5);
  const base = Math.atan2(dy, dx);
  const cos = (ARM.upper ** 2 + dist ** 2 - ARM.fore ** 2) / (2 * ARM.upper * dist);
  const off = Math.acos(Math.min(1, Math.max(-1, cos)));
  const e1 = { x: s.x + ARM.upper * Math.cos(base + off), y: s.y + ARM.upper * Math.sin(base + off) };
  const e2 = { x: s.x + ARM.upper * Math.cos(base - off), y: s.y + ARM.upper * Math.sin(base - off) };
  return {
    elbow: outward(e1) >= outward(e2) ? e1 : e2,
    hand: { x: s.x + dist * Math.cos(base), y: s.y + dist * Math.sin(base) },
  };
}

const armSvg = (side) => `
    <g class="arm" data-arm="${side}">
      <path class="arm-skin" d=""/>
      <path class="arm-sleeve" d=""/>
      <line class="bangle b1"/><line class="bangle b2"/><line class="bangle b3"/>
      <circle class="arm-hand" r="8.5"/>
    </g>`;

function stageSvg(photo, emoji) {
  const jasmine = Array.from({ length: 6 }, (_, i) => {
    const a = (-0.62 + i * 0.13) * Math.PI; // a half-crown over the top-right of her head
    return `<circle cx="${(FACE.x + 47 * Math.cos(a)).toFixed(1)}" cy="${(FACE.y + 47 * Math.sin(a)).toFixed(1)}" r="4.2"/>`;
  }).join('');

  return `
<svg viewBox="0 0 300 420" role="img" aria-label="Amma doing dishti">
  <defs>
    <clipPath id="face-clip"><circle cx="${FACE.x}" cy="${FACE.y}" r="${FACE.r}"/></clipPath>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffd36b" stop-opacity=".6"/>
      <stop offset="100%" stop-color="#ffd36b" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <circle cx="${FACE.x}" cy="${FACE.y + 10}" r="120" fill="url(#halo)"/>

  <ellipse class="guide" data-guide="around" cx="${AROUND.x}" cy="${AROUND.y}" rx="${AROUND.rx}" ry="${AROUND.ry}"/>
  <line class="guide" data-guide="left" x1="${SIDE_X.left}" y1="${SIDE_Y[0] - 14}" x2="${SIDE_X.left}" y2="${SIDE_Y[1] + 14}"/>
  <line class="guide" data-guide="right" x1="${SIDE_X.right}" y1="${SIDE_Y[0] - 14}" x2="${SIDE_X.right}" y2="${SIDE_Y[1] + 14}"/>

  <text class="side-label" data-side="left" x="${SIDE_X.left}" y="30" text-anchor="middle"></text>
  <text class="side-label" data-side="right" x="${SIDE_X.right}" y="30" text-anchor="middle"></text>

  <g class="amma" aria-hidden="true">
    <ellipse class="amma-shadow" cx="150" cy="410" rx="82" ry="9"/>

    <!-- pallu hanging behind her shoulder -->
    <path class="saree-dark" d="M184 176 Q214 222 212 322 L196 320 Q198 232 176 190 Z"/>

    <!-- saree skirt with pleats and a marigold border -->
    <path class="saree" d="M108 244 Q150 254 192 244 L224 404 Q150 415 76 404 Z"/>
    <path class="pleat" d="M141 262 L129 402 M150 262 L150 406 M159 262 L171 402"/>
    <path class="saree-border" d="M79 390 Q150 401 221 390 L224 404 Q150 415 76 404 Z"/>
    <path class="border-dots" d="M92 397 h0.1 M110 399 h0.1 M128 401 h0.1 M146 402 h0.1 M164 401 h0.1 M182 400 h0.1 M200 398 h0.1"/>

    <!-- blouse, waist belt and pallu across the front -->
    <rect class="skin" x="141" y="134" width="18" height="30" rx="8"/>
    <path class="blouse" d="M110 174 Q150 156 190 174 L196 248 Q150 257 104 248 Z"/>
    <path class="saree-dark" d="M172 166 L198 178 L136 262 L108 251 Z"/>
    <path class="saree-edge" d="M198 178 L136 262"/>
    <path class="vaddanam" d="M104 242 Q150 252 196 242 L197 251 Q150 262 103 251 Z"/>
    <circle class="gold" cx="150" cy="252" r="4.5"/>
    <path class="necklace" d="M134 158 Q150 180 166 158"/>
    <circle class="gold" cx="150" cy="176" r="4"/>

    <!-- hair, jasmine and Amma's face from the uploaded photo -->
    <circle class="hair" cx="${FACE.x}" cy="${FACE.y - 2}" r="${FACE.r + 6}"/>
    <g class="jasmine">${jasmine}</g>
    <circle class="face-bg" cx="${FACE.x}" cy="${FACE.y}" r="${FACE.r}"/>
    <image href="${esc(photo)}" x="${FACE.x - FACE.r}" y="${FACE.y - FACE.r}" width="${FACE.r * 2}" height="${FACE.r * 2}" clip-path="url(#face-clip)" preserveAspectRatio="xMidYMid slice"/>
    <circle class="face-ring" cx="${FACE.x}" cy="${FACE.y}" r="${FACE.r + 1}"/>

    <text class="thoo" x="92" y="132">థూ!</text>
    <text class="thoo" x="192" y="126">థూ!</text>
    <text class="thoo" x="148" y="50">థూ!</text>

    <g class="trails"></g>
    ${armSvg('left')}
    ${armSvg('right')}

    <g class="item">
      <circle class="item-glow" r="22"/>
      <text class="item-emoji" y="2" font-size="28" text-anchor="middle" dominant-baseline="central">${emoji}</text>
    </g>
  </g>
</svg>`;
}

export function mountRitual(root, { method, photo, settings, onSettings, onDone, onExit }) {
  let lang = settings.lang;
  let voiceOn = settings.voice;
  let bellOn = settings.bell;
  const bgOn = settings.bgVoice !== false;
  const slow = settings.speed === 'slow' ? 1.5 : 1;

  root.innerHTML = `
<section class="screen ritual">
  <div class="controls">
    <button class="icon-btn" data-act="bell" aria-pressed="${bellOn}" aria-label="${esc(UI.bell[lang])}" title="${esc(UI.bell[lang])}">🔔</button>
    <button class="icon-btn" data-act="voice" aria-pressed="${voiceOn}" aria-label="${esc(UI.voice[lang])}" title="${esc(UI.voice[lang])}">🔊</button>
    <button class="icon-btn" data-act="pause" aria-label="${esc(UI.pause[lang])}" title="${esc(UI.pause[lang])}">⏸</button>
    <button class="icon-btn" data-act="restart" aria-label="${esc(UI.restart[lang])}" title="${esc(UI.restart[lang])}">↻</button>
    <button class="icon-btn" data-act="close" aria-label="${esc(UI.close[lang])}" title="${esc(UI.close[lang])}">✕</button>
  </div>

  <div class="phase" aria-live="polite">
    <div class="bi center phase-title"></div>
    <p class="hint-line"></p>
    <div class="count"><span class="count-word"></span><small class="count-num"></small></div>
  </div>

  <div class="stage">
    ${stageSvg(photo, method.emoji)}
    <div class="paused-veil"><div class="bi center">${bi(UI.paused, lang)}<span class="sec">${esc(UI.tapResume[lang])}</span></div></div>
    <button class="sound-hint" data-act="sound" hidden>🔈 ${esc(UI.tapForSound[lang])}</button>
  </div>

  <div class="progress">
    <div class="bar"><span></span></div>
    <output>0 / ${TOTAL_SWEEPS}</output>
  </div>

  <div class="finish-card card">
    <h2 class="bi">${bi({ te: 'చివరగా', en: 'Last step' }, lang)}</h2>
    <p class="finish-text bi"></p>
    <div class="actions">
      <button class="btn sun" data-act="done"><span class="bi center">${bi(UI.doneBtn, lang)}</span></button>
    </div>
  </div>
</section>`;

  const $ = (sel) => root.querySelector(sel);
  const section = $('.ritual');
  const stage = $('.stage');
  const item = $('.item');
  const titleEl = $('.phase-title');
  const hintEl = $('.hint-line');
  const countEl = $('.count');
  const barEl = $('.bar span');
  const progEl = $('.progress output');
  const pauseBtn = $('[data-act="pause"]');
  const thoos = [...root.querySelectorAll('.thoo')];
  const sideLabels = [...root.querySelectorAll('.side-label')];
  const guides = [...root.querySelectorAll('.guide')];

  sideLabels[0].textContent = UI.left[lang];
  sideLabels[1].textContent = UI.right[lang];

  // Trail dots behind the moving photo.
  const trailGroup = $('.trails');
  const trailDots = Array.from({ length: TRAIL }, () => {
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('class', 'trail');
    c.setAttribute('r', '0');
    trailGroup.appendChild(c);
    return c;
  });
  let trail = [];

  // ----------------------------------------------------- run control --
  let token = 0;
  let paused = false;
  let resumeWaiters = [];
  let wakeLock = null;
  let sweepsDone = 0;

  function guard(my) {
    if (my !== token) throw CANCEL;
  }

  /** requestAnimationFrame loop that only advances while not paused. */
  function animate(ms, frame, my) {
    return new Promise((resolve, reject) => {
      let elapsed = 0;
      let last = performance.now();
      function tick(now) {
        if (my !== token) return reject(CANCEL);
        if (!paused) elapsed += Math.min(now - last, 100);
        last = now;
        const t = Math.min(elapsed / ms, 1);
        frame(t);
        if (t >= 1) return resolve();
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  const wait = (ms, my) => animate(ms, () => {}, my);

  async function speak(key, my) {
    await say(key, { enabled: voiceOn });
    while (paused) await new Promise((r) => resumeWaiters.push(r));
    guard(my);
  }

  // ----------------------------------------------------- drawing --
  const armEls = Object.fromEntries(
    ['right', 'left'].map((side) => {
      const g = root.querySelector(`.arm[data-arm="${side}"]`);
      return [
        side,
        {
          skin: g.querySelector('.arm-skin'),
          sleeve: g.querySelector('.arm-sleeve'),
          bangles: [...g.querySelectorAll('.bangle')],
          hand: g.querySelector('.arm-hand'),
        },
      ];
    }),
  );
  const outward = {
    right: (e) => -e.x + 0.35 * e.y, // her right elbow bends out to the left and down
    left: (e) => e.x + 0.35 * e.y,
  };
  const f = (n) => n.toFixed(1);
  let cur = { right: { ...REST.right }, left: { ...REST.left }, side: 'right' };

  function paintArm(side, { elbow, hand }) {
    const s = SHOULDER[side];
    const el = armEls[side];
    el.skin.setAttribute('d', `M${f(s.x)} ${f(s.y)} L${f(elbow.x)} ${f(elbow.y)} L${f(hand.x)} ${f(hand.y)}`);
    el.sleeve.setAttribute(
      'd',
      `M${f(s.x)} ${f(s.y)} L${f(s.x + (elbow.x - s.x) * 0.36)} ${f(s.y + (elbow.y - s.y) * 0.36)}`,
    );
    const fx = hand.x - elbow.x;
    const fy = hand.y - elbow.y;
    const len = Math.hypot(fx, fy) || 1;
    const nx = (-fy / len) * 8.6;
    const ny = (fx / len) * 8.6;
    [0.7, 0.77, 0.84].forEach((k, i) => {
      const bx = elbow.x + fx * k;
      const by = elbow.y + fy * k;
      const b = el.bangles[i];
      b.setAttribute('x1', f(bx + nx));
      b.setAttribute('y1', f(by + ny));
      b.setAttribute('x2', f(bx - nx));
      b.setAttribute('y2', f(by - ny));
    });
    el.hand.setAttribute('cx', f(hand.x));
    el.hand.setAttribute('cy', f(hand.y));
  }

  /** Draws both arms for `pose`; the item sits in the hand named by pose.side. */
  function draw(pose, { trail: withTrail = false, handover = null } = {}) {
    cur = { right: { ...pose.right }, left: { ...pose.left }, side: pose.side };
    const hands = {
      right: solveArm(SHOULDER.right, pose.right, outward.right),
      left: solveArm(SHOULDER.left, pose.left, outward.left),
    };
    paintArm('right', hands.right);
    paintArm('left', hands.left);
    let at = hands[pose.side].hand;
    if (handover) {
      const a = hands[handover.from].hand;
      at = { x: a.x + (at.x - a.x) * handover.e, y: a.y + (at.y - a.y) * handover.e };
    }
    placeItem(at.x, at.y - 6, withTrail);
  }

  function placeItem(x, y, withTrail) {
    item.setAttribute('transform', `translate(${f(x)} ${f(y)})`);
    if (!withTrail) return;
    trail.unshift({ x, y });
    trail = trail.slice(0, TRAIL);
    trailDots.forEach((dot, i) => {
      const p = trail[i];
      if (!p) return dot.setAttribute('r', '0');
      dot.setAttribute('cx', f(p.x));
      dot.setAttribute('cy', f(p.y));
      dot.setAttribute('r', String(Math.max(0, 6 - i * 0.4)));
      dot.style.opacity = String((1 - i / TRAIL) * 0.55);
    });
  }

  function clearTrail() {
    trail = [];
    trailDots.forEach((d) => d.setAttribute('r', '0'));
  }

  /** Smoothly moves both hands (and passes the item between hands if needed). */
  function moveTo(to, ms, my) {
    const from = cur;
    return animate(
      ms,
      (t) => {
        const e = easeInOut(t);
        const mix = (a, b) => ({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e });
        draw(
          { right: mix(from.right, to.right), left: mix(from.left, to.left), side: to.side },
          { handover: from.side !== to.side ? { from: from.side, e } : null },
        );
      },
      my,
    );
  }

  const restPose = () => ({ right: { ...REST.right }, left: { ...REST.left }, side: 'right' });

  function phasePose(phase, t) {
    const y = SIDE_Y[0] + (SIDE_Y[1] - SIDE_Y[0]) * easeInOut(t);
    switch (phase) {
      case 'around': {
        const a = -Math.PI / 2 + Math.PI * 2 * easeInOut(t);
        return {
          right: { x: AROUND.x + AROUND.rx * Math.cos(a), y: AROUND.y + AROUND.ry * Math.sin(a) },
          left: REST.left,
          side: 'right',
        };
      }
      case 'left':
        return { right: { x: SIDE_X.left, y }, left: REST.left, side: 'right' };
      case 'right':
        return { right: REST.right, left: { x: SIDE_X.right, y }, side: 'left' };
      default:
        return { right: SPIT_AT, left: REST.left, side: 'right' };
    }
  }

  function setPhase(key) {
    const p = PHASES[key];
    titleEl.innerHTML = bi(p.title, lang);
    hintEl.textContent = p.hint[lang];
    guides.forEach((g) => g.classList.toggle('on', g.dataset.guide === key));
    sideLabels.forEach((l) => l.classList.toggle('on', l.dataset.side === key));
    countEl.classList.remove('on');
  }

  function setCount(i) {
    $('.count-word').textContent = COUNTS[i][lang];
    $('.count-num').textContent = `${i + 1}/3`;
    countEl.classList.remove('on');
    void countEl.offsetWidth; // restart the pop animation
    countEl.classList.add('on');
  }

  function setProgress(n) {
    sweepsDone = n;
    barEl.style.width = `${(n / TOTAL_SWEEPS) * 100}%`;
    progEl.textContent = `${n} / ${TOTAL_SWEEPS}`;
  }

  function popThoo(i) {
    const el = thoos[i % thoos.length];
    el.classList.remove('pop');
    void el.getBoundingClientRect();
    el.classList.add('pop');
  }

  // ----------------------------------------------------- sequence --
  async function sequence(my) {
    section.classList.remove('finishing');
    setProgress(0);
    clearTrail();
    draw(restPose());

    // Amma raises her hand in blessing.
    titleEl.innerHTML = bi(method.name, lang);
    hintEl.textContent = '';
    if (voiceOn && bgOn) startBackground();
    await moveTo({ right: BLESS, left: REST.left, side: 'right' }, 900, my);
    ring({ enabled: bellOn });
    await Promise.all([speak('welcome', my), wait(1600 * slow, my)]);

    let n = 0;
    for (const phase of SWEEP_PHASES) {
      setPhase(phase);
      clearTrail();
      await moveTo(phasePose(phase, 0), 800, my);
      await Promise.all([speak(phase, my), wait(1400 * slow, my)]);

      for (let i = 0; i < SWEEPS_PER_PHASE; i++) {
        setCount(i);
        say(COUNT_KEYS[i], { enabled: voiceOn });
        const ms = (phase === 'around' ? 3000 : 2600) * slow;
        await animate(ms, (t) => draw(phasePose(phase, t), { trail: true }), my);
        ring({ enabled: bellOn, strength: 0.6 });
        setProgress(++n);
        if (phase !== 'around' && i < SWEEPS_PER_PHASE - 1) {
          // Lift the hand back up for the next sweep.
          clearTrail();
          await animate(650 * slow, (t) => draw(phasePose(phase, 1 - t)), my);
        } else {
          await wait(500 * slow, my);
        }
      }
    }

    if (method.spit) {
      setPhase('spit');
      clearTrail();
      await moveTo(phasePose('spit', 0), 700, my);
      const spoken = speak('spit', my);
      spoken.catch(() => {}); // a restart mid-loop is handled by the waits below
      for (let i = 0; i < 3; i++) {
        await wait(900 * slow, my);
        popThoo(i);
      }
      await Promise.all([spoken, wait(900, my)]);
    }

    // Final step: method-specific instructions, the user taps Done.
    stopBackground();
    guides.forEach((g) => g.classList.remove('on'));
    sideLabels.forEach((l) => l.classList.remove('on'));
    countEl.classList.remove('on');
    titleEl.innerHTML = bi({ te: 'దాదాపు అయిపోయింది', en: 'Almost done' }, lang);
    hintEl.textContent = '';
    $('.finish-text').innerHTML = bi(method.finish, lang);
    section.classList.add('finishing');
    clearTrail();
    await moveTo({ right: BLESS, left: REST.left, side: 'right' }, 700, my);
    ring({ enabled: bellOn, strength: 1 });
    await speak('finish_' + method.id, my);
  }

  function start() {
    const my = ++token;
    paused = false;
    stage.classList.remove('is-paused');
    pauseBtn.textContent = '⏸';
    resumeVoice();
    stopVoice();
    stopBackground(0.2);
    sequence(my).catch((e) => {
      if (e !== CANCEL) console.error(e);
    });
  }

  function setPaused(p) {
    paused = p;
    stage.classList.toggle('is-paused', p);
    pauseBtn.textContent = p ? '▶' : '⏸';
    pauseBtn.setAttribute('aria-label', p ? 'Play' : UI.pause[lang]);
    if (p) pauseVoice();
    else {
      resumeVoice();
      const waiters = resumeWaiters;
      resumeWaiters = [];
      waiters.forEach((r) => r());
    }
  }

  // ----------------------------------------------------- wake lock --
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {}
  }
  // Pause when the user leaves (app switch, screen lock) and carry on when they return.
  let autoPaused = false;
  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      keepAwake();
      if (autoPaused) {
        autoPaused = false;
        setPaused(false);
      }
    } else if (!paused) {
      autoPaused = true;
      setPaused(true);
    }
  };

  // Phones can block or interrupt sound (silent start, a call, another app).
  // Show a "tap for sound" button whenever audio should be playing but is not.
  const soundHint = $('.sound-hint');
  const soundWatch = setInterval(() => {
    const blocked = !paused && (voiceOn || bellOn) && audioState().state !== 'running';
    soundHint.hidden = !blocked;
  }, 700);

  // ----------------------------------------------------- events --
  root.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVisible);

  function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) {
      if (e.target.closest('.stage') && paused) setPaused(false);
      return;
    }
    unlockAudio();
    switch (btn.dataset.act) {
      case 'bell':
        bellOn = !bellOn;
        btn.setAttribute('aria-pressed', String(bellOn));
        onSettings({ bell: bellOn });
        if (bellOn) ring({ strength: 0.5 });
        break;
      case 'voice':
        voiceOn = !voiceOn;
        btn.setAttribute('aria-pressed', String(voiceOn));
        onSettings({ voice: voiceOn });
        if (!voiceOn) {
          stopVoice();
          stopBackground(0.3);
        } else if (bgOn && !section.classList.contains('finishing')) {
          startBackground();
        }
        break;
      case 'pause':
        autoPaused = false;
        setPaused(!paused);
        break;
      case 'sound': // unlockAudio() above has already resumed it
        soundHint.hidden = true;
        break;
      case 'restart':
        start();
        break;
      case 'close':
        onExit();
        break;
      case 'done':
        onDone();
        break;
    }
  }

  unlockAudio();
  preloadVoices(['welcome', ...SWEEP_PHASES, ...COUNT_KEYS, 'spit', 'finish_' + method.id]);
  keepAwake();
  start();

  return {
    destroy() {
      token++;
      stopVoice();
      stopBackground(0.2);
      resumeVoice();
      resumeWaiters.forEach((r) => r());
      resumeWaiters = [];
      clearInterval(soundWatch);
      root.removeEventListener('click', onClick);
      document.removeEventListener('visibilitychange', onVisible);
      try {
        wakeLock?.release();
      } catch {}
    },
  };
}
