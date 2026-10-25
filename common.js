// Shared by the manual page (app.js) and the guided page (guided.js): Firebase setup, the clip list,
// the looping audio engine and the lyric line.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, query, where, orderBy, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const SCHEDULER_INTERVAL_MS = 25; // how often the scheduler wakes up
const SCHEDULE_AHEAD_S = 0.1;     // how far ahead it schedules audio
const LEAD_IN_S = 0.1;            // silence before a clip played in full, so early clicks still sound
const FADE_S = 0.003;             // fade at the loop's edges, so cutting the audio doesn't pop
const MUSIC_GAIN = 0.7;           // volume of the music
export const CLICK_GAIN = 0.35;   // volume of the clicks
export const SAVED_CLICK_GAIN = 0.3; // volume of other syllables' clicks heard while aligning, a touch quieter
const CLICK_HZ = 2000;            // pitch of the click
const HIGH_CLICK_HZ = 3000;       // pitch of a click picked out from the rest (the guided page's selected click)

// ---------- Firebase ----------

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const $ = (id) => document.getElementById(id);

export const docId = (uid, clipId, syllableIndex) => `${uid}_${clipId}_${syllableIndex}`;

// Every clip in Firestore's clips collection, in the app's order, minus those excluded from analysis
// (the hand-made clips).
export async function loadClipList() {
  const snap = await getDocs(query(collection(db, 'clips'), orderBy('order')));
  const list = snap.docs.map((d) => d.data()).filter((c) => !c.excludeFromAnalysis);
  for (const c of list) {
    if (c.id.includes('_')) throw new Error(`Clip id "${c.id}" must not contain underscores.`);
  }
  return list;
}

// The user's responses: doc id -> response data.
export async function loadResponses(uid) {
  const snap = await getDocs(query(collection(db, 'responses'), where('uid', '==', uid)));
  return new Map(snap.docs.map((d) => [d.id, d.data()]));
}

// ---------- Songs ----------

export const syllableCount = (c) => c.words.reduce((n, w) => n + w.syllables, 0);
export const indices = (c) => [...Array(syllableCount(c)).keys()];

// Flat syllable index -> word index and syllable position within that word.
export function locate(c, idx) {
  for (let w = 0; w < c.words.length; w++) {
    const n = c.words[w].syllables;
    if (idx < n) return { word: w, syllable: idx };
    idx -= n;
  }
  throw new Error(`Syllable ${idx} is out of range for clip ${c.id}.`);
}

// ---------- Lyric line ----------

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function boldUnderline(text) {
  const b = document.createElement('strong');
  const u = document.createElement('u');
  u.textContent = text;
  b.append(u);
  return b;
}

export function orange(text) {
  const b = document.createElement('strong');
  b.className = 'orange';
  b.textContent = text;
  return b;
}

function orangeUnderline(text) {
  const u = document.createElement('u');
  u.className = 'orange';
  u.textContent = text;
  return u;
}

// "the 2nd syllable of “criminal”", with the ordinal underlined in orange.
export function describe(c, idx) {
  const { word, syllable } = locate(c, idx);
  const w = c.words[word];
  const which = w.syllables === 1 ? 'only' : ordinal(syllable + 1);
  return ['the ', orangeUnderline(which), ` syllable of “${w.text}”`];
}

// Fills `line` with the clip's words and syllable boxes. `active` is the flat index of the syllable
// being aligned, or null. Each box gets the classes classOf(index) returns. Clicking a syllable calls
// onSelect(index), for the syllables where clickable(index) is true.
export function buildLine(line, c, { active = null, classOf = () => [], onSelect, clickable = () => true }) {
  const word = active === null ? -1 : locate(c, active).word;

  line.replaceChildren();
  // One column per word: the word on top, its syllable boxes underneath.
  let flat = 0; // flat syllable index of the current word's first syllable
  c.words.forEach((w, i) => {
    const cell = document.createElement('div');
    cell.className = 'word';
    if (i !== word) {
      cell.append(w.text);
    } else {
      // Mark only the letters, not punctuation at either end.
      const [, lead, core, trail] = w.text.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u);
      cell.append(lead, boldUnderline(core), trail);
    }

    const syllables = document.createElement('div');
    syllables.className = 'syllables';
    for (let s = 0; s < w.syllables; s++, flat++) {
      const box = document.createElement('span');
      box.className = 'syllable';
      if (flat === active) box.classList.add('active');
      box.classList.add(...classOf(flat));
      if (clickable(flat)) {
        const idx = flat;
        box.addEventListener('click', () => onSelect(idx));
      }
      syllables.append(box);
    }

    const col = document.createElement('div');
    col.className = 'column';
    col.append(cell, syllables);
    line.append(col);
  });
}

// Shrinks the line's font (never grows it) until every word fits on one row.
export function fitLine(line) {
  line.style.fontSize = '';
  if (line.clientWidth === 0) return; // hidden: refit when it's shown (see the ResizeObserver)
  let size = parseFloat(getComputedStyle(line).fontSize);
  // Borders don't scale with the font, so the first guess can be slightly off; repeat a few times.
  for (let i = 0; i < 5 && line.scrollWidth > line.clientWidth; i++) {
    size *= line.clientWidth / line.scrollWidth * 0.99;
    line.style.fontSize = `${size}px`;
  }
}

// Refit whenever a line's width changes (window resize, or the line becoming visible).
const lineWidths = new WeakMap();
export const lineObserver = new ResizeObserver((entries) => {
  for (const { target: line } of entries) {
    const w = line.clientWidth;
    if (w !== lineWidths.get(line)) { lineWidths.set(line, w); fitLine(line); }
  }
});

// ---------- Audio engine ----------

// Created up front so clips can be decoded; it stays suspended until the first Play.
export const ctx = new AudioContext();
const buffers = new Map(); // clip id -> AudioBuffer

export async function loadBuffer(c) {
  if (buffers.has(c.id)) return buffers.get(c.id);
  const res = await fetch(c.file);
  if (!res.ok) throw new Error(`Couldn't load ${c.file} (HTTP ${res.status}).`);
  const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
  buffers.set(c.id, buffer);
  return buffer;
}

export const hasBuffer = (c) => buffers.has(c.id);
export const bufferOf = (c) => buffers.get(c.id);
export const clipMs = (c) => buffers.get(c.id).duration * 1000;

// What the loop plays, set by the page with setLoopSource:
//   buffer():      the clip's AudioBuffer
//   range():       { startMs, endMs }, the looped part of the clip; the loop follows it as it changes
//   liveClickMs(): the click being dragged, in clip ms, or null; it's scheduled as late as possible
//   otherClicks(): [[key, ms, gain, high]], other clicks that sound wherever they fall in the loop
//                  (high: optional, plays it at a higher pitch)
let source = null;
let onPlayState = () => {}; // called whenever playback starts or stops

export function setLoopSource(s) { source = s; }
export function onPlayStateChange(fn) { onPlayState = fn; }

let timer = null;
let sources = []; // scheduled sources, so Stop can cancel them
let loops = [];   // the last two loops: { audioStart, offsetS, endS, src, gain, clicked, saved }
                  // (offsetS: where in the clip the audio starts;
                  // endS: context time the audio ends, which follows the End handle;
                  // saved: key -> { src, t } for the other clicks scheduled in it)

export const isPlaying = () => timer !== null;

// A short tone burst that starts at full strength and decays fast.
// Its onset is exactly sample 0, so the scheduled time is the heard time.
// The tone is driven through tanh (soft clipping) to make it louder without exceeding full scale.
function makeClickBuffer(hz) {
  const sr = ctx.sampleRate;
  const length = Math.round(sr * 0.04);
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);
  const DRIVE = 4;
  for (let i = 0; i < length; i++) {
    const t = i / sr;
    const x = Math.sin(2 * Math.PI * hz * t) * Math.exp(-t / 0.01);
    data[i] = Math.tanh(DRIVE * x) / Math.tanh(DRIVE);
  }
  return buffer;
}
const click = makeClickBuffer(CLICK_HZ);
const highClick = makeClickBuffer(HIGH_CLICK_HZ);

function track(src) {
  src.onended = () => { sources = sources.filter((s) => s !== src); };
  sources.push(src);
}

function playClick(when, volume = CLICK_GAIN, high = false) {
  const src = ctx.createBufferSource();
  src.buffer = high ? highClick : click;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.connect(gain).connect(ctx.destination);
  src.start(when);
  track(src);
  return src;
}

// Starts a loop of the range's audio at `audioStart` (its end is set by retime),
// with short fades so the cut edges don't pop.
function startLoop(audioStart) {
  const range = source.range();
  const src = ctx.createBufferSource();
  src.buffer = source.buffer();
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, audioStart);
  gain.gain.linearRampToValueAtTime(MUSIC_GAIN, audioStart + FADE_S);
  src.connect(gain).connect(ctx.destination);
  src.start(audioStart, range.startMs / 1000);
  track(src);
  const loop = {
    audioStart, offsetS: range.startMs / 1000, endS: Infinity, src, gain, clicked: false, saved: new Map(),
  };
  retime(loop, audioStart + (range.endMs - range.startMs) / 1000, ctx.currentTime);
  loops = [...loops.slice(-1), loop];
  return loop;
}

// Moves a loop's end (and its fade-out) to `endS`, or as soon after now as the fades allow.
// Does nothing once the fade-out has begun.
function retime(loop, endS, now) {
  if (now >= loop.endS - FADE_S) return;
  const from = Math.max(now, loop.audioStart + FADE_S + 1e-4); // keep the fade-in
  endS = Math.max(endS, from + FADE_S);
  if (Math.abs(endS - loop.endS) < 1e-4) return;
  const g = loop.gain.gain;
  g.cancelScheduledValues(from);
  g.setValueAtTime(MUSIC_GAIN, endS - FADE_S);
  g.linearRampToValueAtTime(0, endS);
  loop.src.stop(endS); // a later stop() replaces an earlier one
  loop.endS = endS;
  // Drop other clicks the loop no longer reaches; scheduleOthers puts them back if the end moves out again.
  for (const [key, { src, t }] of loop.saved) {
    if (t >= endS) {
      src.stop();
      loop.saved.delete(key);
    }
  }
}

// The live click: each loop's click is scheduled as late as possible,
// so dragging takes effect within the current loop when it can.
function scheduleClick(loop, now, horizon) {
  if (loop.clicked) return;
  const ms = source.liveClickMs();
  if (ms === null) return;
  const t = loop.audioStart + ms / 1000 - loop.offsetS;
  if (t >= horizon) return;
  if (t >= now) playClick(t); // else: the click was dragged past it
  loop.clicked = true;
}

// The other clicks sound wherever they fall in the loop.
function scheduleOthers(loop, now, horizon) {
  for (const [key, ms, gain, high] of source.otherClicks()) {
    if (loop.saved.has(key)) continue;
    const t = loop.audioStart + ms / 1000 - loop.offsetS;
    if (t < loop.audioStart || t < now || t >= loop.endS || t >= horizon) continue;
    loop.saved.set(key, { src: playClick(t, gain, high), t });
  }
}

// Also called by the page when the range changes, so the current loop follows right away.
export function schedule() {
  const now = ctx.currentTime;
  const horizon = now + SCHEDULE_AHEAD_S;
  const cur = loops.at(-1);
  const range = source.range();

  // The current loop follows the handles: it ends at the End handle,
  // and stops now if the Start handle has moved past what's playing.
  const playingS = cur.offsetS + (now - cur.audioStart);
  const passed = now > cur.audioStart && playingS < range.startMs / 1000;
  retime(cur, passed ? now : cur.audioStart + range.endMs / 1000 - cur.offsetS, now);
  scheduleClick(cur, now, horizon);
  scheduleOthers(cur, now, horizon);

  if (cur.endS < horizon) {
    const loop = startLoop(cur.endS);
    scheduleClick(loop, now, horizon);
    scheduleOthers(loop, now, horizon);
  }
}

export function stop() {
  clearInterval(timer);
  timer = null;
  for (const s of sources) {
    try { s.stop(); } catch { /* already stopped */ }
  }
  sources = [];
  loops = [];
  onPlayState();
}

export function start() {
  stop();
  startLoop(ctx.currentTime + 0.05);
  schedule();
  timer = setInterval(schedule, SCHEDULER_INTERVAL_MS);
  onPlayState();
}

// Plays a whole clip once, with a click at each of `clickTimesMs`.
export function playOnce(buffer, clickTimesMs) {
  // The leading pad leaves room for clicks placed slightly before the clip begins.
  const t0 = ctx.currentTime + 0.1 + LEAD_IN_S;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = MUSIC_GAIN;
  src.connect(gain).connect(ctx.destination);
  src.start(t0);
  track(src);
  for (const ms of clickTimesMs) playClick(Math.max(t0 + ms / 1000, ctx.currentTime));
}

// Where in the clip the loop is audible now (compensating for output latency), in ms;
// null if nothing is.
export function playingMs() {
  if (!timer) return null;
  const t = ctx.currentTime - (ctx.outputLatency || 0);
  const loop = loops.find((l) => t >= l.audioStart && t < l.endS);
  return loop ? (loop.offsetS + t - loop.audioStart) * 1000 : null;
}
