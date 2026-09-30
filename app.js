// Click alignment app: Google sign-in, a queue of (clip, syllable) tasks per song,
// and an audio engine that loops the clip and plays a movable click on every loop.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, query, where, getDocs, doc, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const SCHEDULER_INTERVAL_MS = 25; // how often the scheduler wakes up
const SCHEDULE_AHEAD_S = 0.1;     // how far ahead it schedules audio
const PAD_S = 0.1;                // silence before and after each loop of the clip
const MIN_SEGMENT_MS = 500;       // shortest audible segment

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const startBtn = $('start');
const stopBtn = $('stop');
const slider = $('offset');
const readout = $('readout');
const doneBtn = $('done');

// ---------- App state ----------

let user = null;
let clips = null;            // from clips.json
let responses = new Map();   // doc id -> response data, for the signed-in user
let song = null;             // { clip, byIndex: Map(syllableIndex -> task), tasks: [task], pos, editing: task | null }
let writing = false;

const SCREENS = ['signed-out', 'loading', 'task', 'song-complete', 'all-done'];
function show(name) {
  for (const s of SCREENS) $(s).hidden = s !== name;
  $('account').hidden = name === 'signed-out';
  $('line-area').hidden = name !== 'task' && name !== 'song-complete';
}

const docId = (clipId, syllableIndex) => `${user.uid}_${clipId}_${syllableIndex}`;

async function loadClipList() {
  const res = await fetch('clips.json');
  if (!res.ok) throw new Error(`Couldn't load clips.json (HTTP ${res.status}).`);
  const data = await res.json();
  for (const c of data.clips) {
    if (c.id.includes('_')) throw new Error(`Clip id "${c.id}" must not contain underscores.`);
  }
  return data.clips;
}

// Binary-search task order. Each task is { syllable, lo, hi }: the syllable to align,
// and the already-aligned syllables bounding its audible segment (null = clip start/end).
// The middle syllable comes first with the whole clip audible; then the middle of each
// half, and so on. Within each level, tasks alternate between halves of the line
// (e.g. left-left, right-left, left-right, right-right) so consecutive tasks play
// different stretches of audio.
function binarySearchOrder(n) {
  // Returns the subtree's tasks grouped by depth.
  const build = (a, b, lo, hi) => {
    if (a > b) return [];
    const m = Math.floor((a + b) / 2);
    const left = build(a, m - 1, lo, m);
    const right = build(m + 1, b, m, hi);
    const levels = [[{ syllable: m, lo, hi }]];
    for (let d = 0; d < Math.max(left.length, right.length); d++) {
      levels.push(interleave(left[d] ?? [], right[d] ?? []));
    }
    return levels;
  };
  return build(0, n - 1, null, null).flat();
}

function interleave(xs, ys) {
  const out = [];
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    if (i < xs.length) out.push(xs[i]);
    if (i < ys.length) out.push(ys[i]);
  }
  return out;
}

const syllableCount = (clip) => clip.words.reduce((n, w) => n + w.syllables, 0);

// Flat syllable index -> word index and syllable position within that word.
function locate(clip, idx) {
  for (let w = 0; w < clip.words.length; w++) {
    const n = clip.words[w].syllables;
    if (idx < n) return { word: w, syllable: idx };
    idx -= n;
  }
  throw new Error(`Syllable ${idx} is out of range for clip ${clip.id}.`);
}

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

function songFor(clip) {
  const all = binarySearchOrder(syllableCount(clip));
  const tasks = all.filter((t) => !responses.has(docId(clip.id, t.syllable)));
  const byIndex = new Map(all.map((t) => [t.syllable, t]));
  return { clip, byIndex, tasks, pos: 0, editing: null };
}

// Returns true if a song with unfinished syllables was found.
function nextSong() {
  for (const clip of clips) {
    const s = songFor(clip);
    if (s.tasks.length) {
      song = s;
      showTask(null);
      return true;
    }
  }
  song = null;
  stop();
  show('all-done');
  renderAllLines();
  return false;
}

// On the all-done page: every song's line, each with its own play button.
// Clicking an aligned syllable reopens that song to redo it.
function renderAllLines() {
  const list = $('all-lines');
  for (const old of list.querySelectorAll('.line')) lineObserver.unobserve(old);
  list.replaceChildren();
  for (const clip of clips) {
    const btn = document.createElement('button');
    btn.textContent = '▶';
    btn.title = 'Play the clip with a click on every syllable';
    btn.addEventListener('click', () => playSongClicked(clip));

    const line = document.createElement('div');
    line.className = 'line';
    buildLine(line, clip, null, (idx) => {
      song = songFor(clip);
      edit(idx);
    });

    const row = document.createElement('div');
    row.className = 'line-row';
    row.append(btn, line);
    list.append(row);
    lineObserver.observe(line);
  }
}

// The task being worked on: an already-aligned syllable the user clicked to redo,
// otherwise the next unfinished task.
const activeTask = () => song.editing ?? song.tasks[song.pos];

// Clip-relative time (ms) of an already-aligned syllable.
const alignedTimeMs = (idx) => responses.get(docId(song.clip.id, idx)).clickTimeMs;

const normalizeWord = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// The boundary syllables of the task's audible segment, as { lo, hi } (null = clip start/end).
// Starts from the task's own bounds and widens outward, one aligned syllable at a time,
// while the words the segment touches appear more than once in the line (so the listener
// can tell which "as a" they're hearing) or the segment is shorter than MIN_SEGMENT_MS.
// Each step widens whichever side fixes that, otherwise whichever side adds fewer syllables.
function segmentBounds(task) {
  const { clip } = song;
  const n = syllableCount(clip);
  const words = clip.words.map((w) => normalizeWord(w.text));
  const aligned = [...Array(n).keys()].filter((i) => responses.has(docId(clip.id, i)));

  const ambiguous = (lo, hi) => {
    const first = locate(clip, lo ?? 0).word;
    const last = locate(clip, (hi ?? n) - 1).word;
    const len = last - first + 1;
    let count = 0;
    for (let i = 0; i + len <= words.length; i++) {
      if (words.slice(i, i + len).every((w, k) => w === words[first + k])) count++;
    }
    return count > 1;
  };
  // A null end is the end of the clip, which we treat as far enough away.
  const tooShort = (lo, hi) =>
    (hi === null ? Infinity : alignedTimeMs(hi)) - (lo === null ? 0 : alignedTimeMs(lo)) < MIN_SEGMENT_MS;
  const needsWidening = (lo, hi) => ambiguous(lo, hi) || tooShort(lo, hi);

  let { lo, hi } = task;
  while (needsWidening(lo, hi)) {
    // Terminates: every step moves a bound outward, and the whole clip never needs widening.
    const options = [];
    if (lo !== null) {
      const next = aligned.filter((i) => i < lo).at(-1) ?? null;
      options.push({ lo: next, hi, grows: lo - (next ?? 0) });
    }
    if (hi !== null) {
      const next = aligned.find((i) => i > hi) ?? null;
      options.push({ lo, hi: next, grows: (next ?? n) - hi });
    }
    for (const o of options) o.fixes = !needsWidening(o.lo, o.hi);
    options.sort((a, b) => (b.fixes - a.fixes) || (a.grows - b.grows));
    ({ lo, hi } = options[0]);
  }
  return { lo, hi };
}

// Draws the lyric line. `task` is the task being aligned, or null.
function renderLine(task) {
  buildLine($('line'), song.clip, task ? task.syllable : null, edit);

  // Once every syllable is aligned, offer to play the whole clip with all the clicks.
  $('play-song').hidden = !allAligned();

  lineTask = task;
  fitLine($('line'));
}

// Fills `line` with the clip's words and syllable boxes. `active` is the flat index of
// the syllable being aligned, or null; clicking an aligned syllable calls onEdit(index).
function buildLine(line, clip, active, onEdit) {
  const word = active === null ? -1 : locate(clip, active).word;

  line.replaceChildren();
  // One column per word: the word on top, its syllable boxes underneath.
  let flat = 0; // flat syllable index of the current word's first syllable
  clip.words.forEach((w, i) => {
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
      if (responses.has(docId(clip.id, flat))) {
        box.classList.add('aligned');
        const idx = flat;
        box.addEventListener('click', () => onEdit(idx));
      }
      syllables.append(box);
    }

    const col = document.createElement('div');
    col.className = 'column';
    col.append(cell, syllables);
    line.append(col);
  });
}

// The task whose segment is outlined on the main line, or null.
let lineTask = null;

// Shrinks the line's font (never grows it) until every word fits on one row,
// then (for the main line) redraws the segment outline to match the new layout.
function fitLine(line) {
  line.style.fontSize = '';
  line.querySelector('.segment')?.remove();
  if (line.clientWidth === 0) return; // hidden: refit when it's shown (see the ResizeObserver)
  const base = parseFloat(getComputedStyle(line).fontSize);
  let size = base;
  // Borders don't scale with the font, so the first guess can be slightly off; repeat a few times.
  for (let i = 0; i < 5 && line.scrollWidth > line.clientWidth; i++) {
    size *= line.clientWidth / line.scrollWidth * 0.99;
    line.style.fontSize = `${size}px`;
  }
  if (line === $('line') && lineTask) outlineSegment(lineTask);
}

// Refit whenever a line's width changes (window resize, or the line becoming visible).
const lineWidths = new WeakMap();
const lineObserver = new ResizeObserver((entries) => {
  for (const { target } of entries) {
    const w = target.clientWidth;
    if (w !== lineWidths.get(target)) { lineWidths.set(target, w); fitLine(target); }
  }
});
lineObserver.observe($('line'));

const allAligned = () =>
  [...Array(syllableCount(song.clip)).keys()].every((i) => responses.has(docId(song.clip.id, i)));

// Outlines in red the syllables that are audible: from the segment's starting boundary
// syllable (heard from its onset) up to, not including, the ending boundary syllable.
// Needs the line to be laid out, so call it only while the line is visible.
function outlineSegment(task) {
  const line = $('line');
  const boxes = line.querySelectorAll('.syllable');
  const { lo, hi } = segmentBounds(task);
  const first = lo ?? 0;
  const last = (hi ?? boxes.length) - 1;
  // Extend to the column's edge when the segment starts/ends at a word boundary,
  // otherwise stop between two syllable boxes of the same word.
  const edge = (idx, side) => {
    const box = boxes[idx];
    const col = box.closest('.column');
    const sibling = side === 'left' ? box.previousElementSibling : box.nextElementSibling;
    if (!sibling) return side === 'left' ? col.offsetLeft : col.offsetLeft + col.offsetWidth;
    return side === 'left' ? box.offsetLeft - 2 : box.offsetLeft + box.offsetWidth + 2;
  };
  const left = edge(first, 'left');
  const outline = document.createElement('div');
  outline.className = 'segment';
  outline.style.left = `${left}px`;
  outline.style.width = `${edge(last, 'right') - left}px`;
  line.append(outline);
}

// `clickMs` is where to put the click (clip-relative ms), or null for the segment's middle.
function showTask(clickMs) {
  const { clip } = song;
  const task = activeTask();
  const { word, syllable } = locate(clip, task.syllable);

  // For long words, also count from the end when the syllable is past the middle.
  const n = clip.words[word].syllables;
  const fromEnd = n - syllable;
  const hint = n < 4 || fromEnd >= syllable + 1 ? ''
    : fromEnd === 1 ? ' (the last syllable of the word)'
    : ` (${ordinal(fromEnd)} from the end of the word)`;
  $('prompt').replaceChildren(
    'Align the click to the ', boldUnderline(ordinal(syllable + 1)),
    ` syllable${hint} in the underlined word.`,
  );

  wantedClickMs = clickMs;
  current = clipBuffers.get(clip.id) ?? null;
  if (timer) start(); // playing: restart the loop on the new segment
  configureSlider();
  updateReadout();
  show('task');
  renderLine(task);
  updateButtons();
  if (!slider.disabled) slider.focus();
}

function updateButtons() {
  doneBtn.disabled = writing || !current;
}

async function done() {
  const syllableIndex = activeTask().syllable;
  const id = docId(song.clip.id, syllableIndex);
  const prev = responses.get(id);
  const data = {
    uid: user.uid,
    email: user.email,
    clipId: song.clip.id,
    syllableIndex,
    offsetMs: clickMs - current.duration * 500, // relative to the middle of the whole clip
    clickTimeMs: clickMs,
    segmentStartMs: segment.startMs,
    segmentEndMs: segment.endMs,
    revision: prev ? (prev.revision ?? 0) + 1 : 0,
    updatedAt: serverTimestamp(),
    userAgent: navigator.userAgent,
  };

  writing = true;
  updateButtons();
  try {
    await setDoc(doc(db, 'responses', id), data);
    responses.set(id, data);
    // After redoing a syllable, pick up where the unfinished ones left off.
    if (song.editing !== null) song.editing = null;
    else song.pos++;
    if (song.pos < song.tasks.length) {
      showTask(null);
    } else {
      stop();
      renderLine(null);
      show('song-complete');
    }
  } catch (err) {
    readout.textContent = `Couldn't save: ${err.message}`;
  } finally {
    writing = false;
    updateButtons();
  }
}

// Go back to an already-aligned syllable, starting from its saved click time.
function edit(syllableIndex) {
  if (writing) return;
  song.editing = song.byIndex.get(syllableIndex);
  showTask(alignedTimeMs(syllableIndex));
  if (!timer && current) start();
}

// ---------- Audio engine ----------

let ctx = null;
let clickBuffer = null;
const clipBuffers = new Map(); // clip id -> AudioBuffer

let current = null;      // AudioBuffer of the clip being looped
let segment = null;      // { startMs, endMs }: clip-relative part of the clip that is audible
let clickMs = 0;         // click time, clip-relative ms
let wantedClickMs = null; // click time to restore when the slider is next configured; null = segment middle
let nextLoopStart = 0;   // context time of the next loop (leading silence) to schedule
let nextClickLoop = 0;   // start time of the loop whose click isn't scheduled yet
let timer = null;
let sources = [];        // scheduled sources, so Stop can cancel them

async function loadBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (HTTP ${res.status}).`);
  return ctx.decodeAudioData(await res.arrayBuffer());
}

// A short 2 kHz tone burst that starts at full strength and decays fast.
// Its onset is exactly sample 0, so the scheduled time is the heard time.
// The tone is driven through tanh (soft clipping) to make it louder without exceeding full scale.
function makeClickBuffer() {
  const sr = ctx.sampleRate;
  const length = Math.round(sr * 0.04);
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);
  const DRIVE = 4;
  for (let i = 0; i < length; i++) {
    const t = i / sr;
    const x = Math.sin(2 * Math.PI * 2000 * t) * Math.exp(-t / 0.01);
    data[i] = Math.tanh(DRIVE * x) / Math.tanh(DRIVE);
  }
  return buffer;
}

async function loadAudio() {
  readout.textContent = 'Loading audio…';
  clickBuffer = makeClickBuffer();
  await Promise.all(clips.map(async (c) => {
    clipBuffers.set(c.id, await loadBuffer(c.file));
  }));
}

// Music is played quieter than the click so the click stands out.
const MUSIC_GAIN = 0.7;

function play(buffer, when, offset = 0, duration = undefined) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  if (buffer === clickBuffer) {
    src.connect(ctx.destination);
  } else {
    const gain = ctx.createGain();
    gain.gain.value = MUSIC_GAIN;
    src.connect(gain).connect(ctx.destination);
  }
  src.onended = () => { sources = sources.filter((s) => s !== src); };
  src.start(when, offset, duration);
  sources.push(src);
}

function schedule() {
  const now = ctx.currentTime;
  const horizon = now + SCHEDULE_AHEAD_S;
  const segStart = segment.startMs / 1000;
  const segDur = (segment.endMs - segment.startMs) / 1000;
  const loopLen = PAD_S + current.duration + PAD_S;

  // Each loop is the whole clip's timeline (silence, clip, silence), but only the
  // audible segment is played; the rest of the clip is muted.
  while (nextLoopStart < horizon) {
    play(current, nextLoopStart + PAD_S + segStart, segStart, segDur);
    nextLoopStart += loopLen;
  }

  // Clicks are scheduled separately from the audio, as late as possible,
  // so slider moves take effect within the current loop when they can.
  for (;;) {
    const clickTime = nextClickLoop + PAD_S + clickMs / 1000;
    if (clickTime >= horizon) break;
    if (clickTime >= now) play(clickBuffer, clickTime); // else: slider jumped past it; skip this loop
    nextClickLoop += loopLen;
  }
}

function stop() {
  clearInterval(timer);
  timer = null;
  for (const s of sources) {
    try { s.stop(); } catch { /* already stopped */ }
  }
  sources = [];
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

function start() {
  stop();
  current = clipBuffers.get(song.clip.id);
  configureSlider();
  updateReadout();
  updateButtons();

  nextLoopStart = nextClickLoop = ctx.currentTime + 0.1;
  schedule();
  timer = setInterval(schedule, SCHEDULER_INTERVAL_MS);

  startBtn.disabled = true;
  stopBtn.disabled = false;
  slider.focus();
}

// Plays the whole clip once, with a click at every syllable's aligned time.
function playSong(clip) {
  stop();
  const buffer = clipBuffers.get(clip.id);
  // The leading pad leaves room for clicks placed slightly before the clip begins.
  const t0 = ctx.currentTime + 0.1 + PAD_S;
  play(buffer, t0);
  for (let i = 0; i < syllableCount(clip); i++) {
    const { clickTimeMs } = responses.get(docId(clip.id, i));
    play(clickBuffer, Math.max(t0 + clickTimeMs / 1000, ctx.currentTime));
  }
}

// The audible part of the clip for the active task: between the aligned times of its
// (possibly widened) boundary syllables, or the clip's start/end where it has none.
function computeSegment() {
  const { lo, hi } = segmentBounds(activeTask());
  const durMs = current.duration * 1000;
  const clamp = (t) => Math.min(Math.max(t, 0), durMs);
  let startMs = lo === null ? 0 : clamp(alignedTimeMs(lo));
  let endMs = hi === null ? durMs : clamp(alignedTimeMs(hi));
  if (endMs - startMs < MIN_SEGMENT_MS) {
    // Only possible for a very short clip, or with boundary times at the clip's edges: widen around the middle.
    const mid = Math.min(Math.max((startMs + endMs) / 2, MIN_SEGMENT_MS / 2), durMs - MIN_SEGMENT_MS / 2);
    startMs = mid - MIN_SEGMENT_MS / 2;
    endMs = mid + MIN_SEGMENT_MS / 2;
  }
  return { startMs, endMs };
}

// The slider spans the whole loop: the clip plus the silence on either side.
// It starts at the middle of the audible segment.
function configureSlider() {
  if (!current) { slider.disabled = true; return; }
  segment = computeSegment();
  const min = -Math.floor(PAD_S * 1000);
  const max = Math.floor(current.duration * 1000 + PAD_S * 1000);
  if (wantedClickMs === null) wantedClickMs = Math.round((segment.startMs + segment.endMs) / 2);
  clickMs = Math.min(Math.max(wantedClickMs, min), max);
  slider.min = min;
  slider.max = max;
  slider.value = clickMs;
  slider.disabled = false;
}

function updateReadout() {
  readout.textContent = '';
}

// ---------- Events ----------

$('sign-in').addEventListener('click', () => {
  signInWithPopup(auth, new GoogleAuthProvider()).catch((err) => alert(err.message));
});

$('sign-out').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (u) => {
  user = u;
  stop();
  song = null;
  if (!u) { show('signed-out'); return; }
  $('who').textContent = `Logged in as ${u.email}`;
  $('loading-msg').textContent = 'Loading…';
  show('loading');
  try {
    if (!clips) clips = await loadClipList();
    const snap = await getDocs(query(collection(db, 'responses'), where('uid', '==', u.uid)));
    responses = new Map(snap.docs.map((d) => [d.id, d.data()]));
    nextSong();
  } catch (err) {
    $('loading-msg').textContent = err.message;
  }
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  // Create and resume the context synchronously inside the click,
  // before any await, so every browser treats it as user-initiated.
  if (!ctx) ctx = new AudioContext();
  ctx.resume();
  try {
    if (clipBuffers.size === 0) await loadAudio();
    start();
  } catch (err) {
    readout.textContent = err.message;
    startBtn.disabled = false;
  }
});

async function playSongClicked(clip) {
  if (!ctx) ctx = new AudioContext();
  ctx.resume();
  try {
    if (clipBuffers.size === 0) await loadAudio();
    playSong(clip);
  } catch (err) {
    readout.textContent = err.message;
  }
}

$('play-song').addEventListener('click', () => playSongClicked(song.clip));

stopBtn.addEventListener('click', stop);
doneBtn.addEventListener('click', done);

$('another').addEventListener('click', (e) => {
  e.preventDefault();
  if (nextSong() && current) start();
});

slider.addEventListener('input', () => {
  clickMs = wantedClickMs = Number(slider.value);
  updateReadout();
});

// Arrow keys don't move the slider.
slider.addEventListener('keydown', (e) => {
  if (e.key.startsWith('Arrow')) e.preventDefault();
});
