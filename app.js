// Click alignment app: Google sign-in, songs worked through one syllable at a time, and a two-stage
// alignment interface.
// Range stage: the whole clip loops, and the user moves the Start and End handles until the loop holds
// just two syllables, the target and one named neighbour. The loop follows the handles as they move.
// Click stage: that range loops with a single click the user drags until it lands on the target.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, query, where, orderBy, getDocs, doc, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const SCHEDULER_INTERVAL_MS = 25; // how often the scheduler wakes up
const SCHEDULE_AHEAD_S = 0.1;     // how far ahead it schedules audio
const LEAD_IN_S = 0.1;            // silence before a clip played in full, so early clicks still sound
const MIN_RANGE_MS = 100;         // the Start and End handles can't get closer than this
const EDIT_WINDOW_MS = 250;       // redoing an aligned syllable loops this much either side of its click
const FADE_S = 0.003;             // fade at the loop's edges, so cutting the audio doesn't pop
const MUSIC_GAIN = 0.7;           // volume of the music
const CLICK_GAIN = 0.35;          // volume of the clicks
const SAVED_CLICK_GAIN = 0.3;     // volume of other syllables' saved clicks heard while aligning, a touch quieter
const CLICK_HZ = 2000;            // pitch of the click

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const bar = $('bar');
const zoneEl = $('zone');
const playhead = $('playhead');

// ---------- App state ----------

let user = null;
let clips = null;           // from Firestore's clips collection
let responses = new Map();  // doc id -> response data, for the signed-in user
let clip = null;            // the song being worked on
let target = 0;             // flat index of the syllable being aligned
let phase = 'range';        // 'range': trim the loop to two syllables; 'click': line a click up with the target
let range = { startMs: 0, endMs: 0 }; // the looped part of the clip
let clickFrac = 0.5;        // click stage: where the click is, as a fraction of the range
let rangeMoved = false;     // whether a handle has moved since the range stage began (enables Next)
let writing = false;        // a response is being saved
let reviewing = false;      // the song was picked from the footer menu: after each save, return to its page

const clipMs = () => buffers.get(clip.id).duration * 1000;
const clickMs = () => range.startMs + clickFrac * (range.endMs - range.startMs);

// What the bar spans: the whole clip in the range stage, the chosen range in the click stage.
const view = () => (phase === 'range' ? { startMs: 0, endMs: clipMs() } : range);

const SCREENS = ['signed-out', 'loading', 'task', 'song-complete', 'song-review', 'all-done'];
function show(name) {
  for (const s of SCREENS) $(s).hidden = s !== name;
  $('account').hidden = name === 'signed-out';
  $('line-area').hidden = !['task', 'song-complete', 'song-review'].includes(name);
  renderSongMenu();
}

const docId = (clipId, syllableIndex) => `${user.uid}_${clipId}_${syllableIndex}`;
const isAligned = (c, idx) => responses.has(docId(c.id, idx));

async function loadClipList() {
  const snap = await getDocs(query(collection(db, 'clips'), orderBy('order')));
  const list = snap.docs.map((d) => d.data());
  for (const c of list) {
    if (c.id.includes('_')) throw new Error(`Clip id "${c.id}" must not contain underscores.`);
  }
  return list;
}

// ---------- Songs ----------

const syllableCount = (c) => c.words.reduce((n, w) => n + w.syllables, 0);
const indices = (c) => [...Array(syllableCount(c)).keys()];

// The first unaligned syllable after `from`, wrapping around to the line's start; null if all are aligned.
function nextUnaligned(c, from = -1) {
  const todo = indices(c).filter((i) => !isAligned(c, i));
  return todo.find((i) => i > from) ?? todo[0] ?? null;
}

// Opens the first song with unaligned syllables, or the all-done page if there are none.
// Returns true if a song was found.
function nextSong() {
  reviewing = false;
  for (const c of clips) {
    const idx = nextUnaligned(c);
    if (idx !== null) {
      openSong(c, idx);
      return true;
    }
  }
  clip = null;
  stop();
  show('all-done');
  renderAllLines();
  return false;
}

async function openSong(c, idx) {
  stop();
  clip = c;
  $('loading-msg').textContent = 'Loading audio…';
  show('loading');
  try {
    await loadBuffer(c);
  } catch (err) {
    $('loading-msg').textContent = err.message;
    return;
  }
  show('task');
  selectTarget(idx);
}

// The song's page, opened from the footer menu: its line, where any block can be clicked to (re)align it.
async function openReview(c) {
  stop();
  clip = c;
  reviewing = true;
  $('loading-msg').textContent = 'Loading audio…';
  show('loading');
  try {
    await loadBuffer(c);
  } catch (err) {
    $('loading-msg').textContent = err.message;
    return;
  }
  showReview();
}

function showReview() {
  stop();
  renderLine(null);
  const msg = [`Your alignments for “${clip.title}”. Click a green block to redo it.`];
  if (nextUnaligned(clip) !== null) msg.push('Gray blocks aren’t aligned yet; click one to align it.');
  $('review-msg').textContent = msg.join(' ');
  show('song-review');
}

// The footer menu of every song, marked by how much of it is aligned.
// It shows the song being reviewed, and otherwise its placeholder.
function renderSongMenu() {
  const menu = $('song-menu');
  menu.hidden = !clips;
  if (!clips || !user) return;
  const placeholder = new Option('Go to a song…', '');
  placeholder.disabled = true;
  const options = clips.map((c) => {
    const done = indices(c).filter((i) => isAligned(c, i)).length;
    const mark = done === 0 ? '' : done === syllableCount(c) ? ' (aligned)' : ' (partly aligned)';
    return new Option(c.title + mark, c.id);
  });
  menu.replaceChildren(placeholder, ...options);
  menu.value = reviewing && clip ? clip.id : '';
}

// On the all-done page: every song's line, each with its own play button.
// Clicking an aligned syllable reopens that song to redo it.
function renderAllLines() {
  const list = $('all-lines');
  for (const old of list.querySelectorAll('.line')) lineObserver.unobserve(old);
  list.replaceChildren();
  for (const c of clips) {
    const btn = document.createElement('button');
    btn.textContent = '▶';
    btn.title = 'Play the clip with a click on every syllable';
    btn.addEventListener('click', () => playSong(c));

    const line = document.createElement('div');
    line.className = 'line';
    buildLine(line, c, null, (idx) => openSong(c, idx), false);

    const row = document.createElement('div');
    row.className = 'line-row';
    row.append(btn, line);
    list.append(row);
    lineObserver.observe(line);
  }
}

// Downloads the user's alignments as JSON: every song, with each syllable's word and saved click.
function downloadAlignments() {
  const iso = (t) => (t?.toDate ? t.toDate() : t)?.toISOString?.() ?? null; // Firestore Timestamp or Date
  const songs = clips.map((c) => ({
    id: c.id,
    title: c.title,
    file: c.file,
    syllables: indices(c).map((i) => {
      const { word, syllable } = locate(c, i);
      const r = responses.get(docId(c.id, i));
      return {
        index: i,
        word: c.words[word].text,
        wordIndex: word,
        syllableInWord: syllable,
        clickTimeMs: r?.clickTimeMs ?? null,
        offsetMs: r?.offsetMs ?? null,
        segmentStartMs: r?.segmentStartMs ?? null,
        segmentEndMs: r?.segmentEndMs ?? null,
        revision: r?.revision ?? null,
        updatedAt: r ? iso(r.updatedAt) : null,
      };
    }),
  }));
  const data = { exportedAt: new Date().toISOString(), uid: user.uid, email: user.email, songs };

  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `alignments-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Lyric line ----------

// Flat syllable index -> word index and syllable position within that word.
function locate(c, idx) {
  for (let w = 0; w < c.words.length; w++) {
    const n = c.words[w].syllables;
    if (idx < n) return { word: w, syllable: idx };
    idx -= n;
  }
  throw new Error(`Syllable ${idx} is out of range for clip ${c.id}.`);
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

// Draws the main lyric line. `active` is the syllable being aligned, or null.
// Clicking any syllable aligns (or re-aligns) it.
function renderLine(active) {
  buildLine($('line'), clip, active, selectSyllable, true);

  // Once every syllable is aligned, offer to play the whole clip with all the clicks.
  $('play-song').hidden = nextUnaligned(clip) !== null;

  fitLine($('line'));
}

// Fills `line` with the clip's words and syllable boxes. `active` is the flat index of the syllable
// being aligned, or null. Clicking a syllable calls onSelect(index): any syllable if `allClickable`,
// otherwise only aligned ones.
function buildLine(line, c, active, onSelect, allClickable) {
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
      const aligned = isAligned(c, flat);
      if (aligned) box.classList.add('aligned');
      if (aligned || allClickable) {
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
function fitLine(line) {
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
const lineObserver = new ResizeObserver((entries) => {
  for (const { target: line } of entries) {
    const w = line.clientWidth;
    if (w !== lineWidths.get(line)) { lineWidths.set(line, w); fitLine(line); }
  }
});
lineObserver.observe($('line'));

// The neighbour that stays in the loop with the target: the next syllable, or the previous one at the end
// of the clip (null if the clip has only one syllable).
function adjacent() {
  if (target + 1 < syllableCount(clip)) return target + 1;
  return target > 0 ? target - 1 : null;
}

// "the 2nd syllable of “criminal”", with the ordinal underlined in orange.
function describe(idx) {
  const { word, syllable } = locate(clip, idx);
  const w = clip.words[word];
  const which = w.syllables === 1 ? 'only' : ordinal(syllable + 1);
  return ['the ', orangeUnderline(which), ` syllable of “${w.text}”`];
}

function orange(text) {
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

// ---------- Search ----------

// keepRange: start from the range chosen for the previous syllable instead of the whole clip.
function selectTarget(idx, keepRange = false) {
  target = idx;
  $('status').textContent = '';
  renderLine(target);
  resetSearch(keepRange);
}

// Picks a syllable from the lyric line, including from the song-complete screen.
function selectSyllable(idx) {
  if (writing) return;
  show('task');
  selectTarget(idx);
}

// An already-aligned syllable skips straight to the click stage, looping a window around its saved click.
function resetSearch(keepRange = false) {
  const saved = keepRange ? null : responses.get(docId(clip.id, target));
  if (saved) {
    const t = clamp(saved.clickTimeMs, 0, clipMs());
    range = {
      startMs: Math.max(0, Math.min(t - EDIT_WINDOW_MS, clipMs() - MIN_RANGE_MS)),
      endMs: Math.min(clipMs(), Math.max(t + EDIT_WINDOW_MS, MIN_RANGE_MS)),
    };
    phase = 'click';
    clickFrac = (t - range.startMs) / (range.endMs - range.startMs);
    rangeMoved = true; // so Back, then Next, works without moving a handle
  } else {
    phase = 'range';
    if (!keepRange) range = { startMs: 0, endMs: clipMs() };
    rangeMoved = keepRange; // a carried-over range is already trimmed, so Next works right away
  }
  if (timer) start();
  render();
}

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

function setEdge(edge, ms) {
  const before = range[`${edge}Ms`];
  if (edge === 'start') range.startMs = clamp(ms, 0, range.endMs - MIN_RANGE_MS);
  else range.endMs = clamp(ms, range.startMs + MIN_RANGE_MS, clipMs());
  if (range[`${edge}Ms`] !== before) rangeMoved = true;
  if (timer) schedule(); // the current loop follows right away
  render();
}

function setClick(frac) {
  clickFrac = clamp(frac, 0, 1);
  render();
}

// Range stage -> click stage, looping just the chosen range.
function next() {
  phase = 'click';
  clickFrac = 0.5;
  if (timer) start();
  render();
}

// Click stage -> range stage, with the handles where they were.
function back() {
  phase = 'range';
  if (timer) start();
  render();
}

// Saves the click as the syllable's time, then moves on to the next unaligned syllable.
async function submit() {
  const id = docId(clip.id, target);
  const prev = responses.get(id);
  const time = clickMs();
  const data = {
    uid: user.uid,
    email: user.email,
    clipId: clip.id,
    syllableIndex: target,
    offsetMs: time - clipMs() / 2, // relative to the middle of the whole clip
    clickTimeMs: time,
    segmentStartMs: range.startMs,
    segmentEndMs: range.endMs,
    revision: prev ? (prev.revision ?? 0) + 1 : 0,
    updatedAt: serverTimestamp(),
    userAgent: navigator.userAgent,
  };

  writing = true;
  render();
  try {
    await setDoc(doc(db, 'responses', id), data);
    responses.set(id, { ...data, updatedAt: new Date() }); // stand-in for the server timestamp
    renderSongMenu();
    // A first-time alignment moves on to the next unaligned syllable, keeping the loop window.
    // Redoing an aligned syllable from a song's page returns to that page.
    const idx = nextUnaligned(clip, target);
    if (reviewing && (prev || idx === null)) {
      showReview();
    } else if (idx !== null) {
      selectTarget(idx, true);
    } else {
      stop();
      renderLine(null);
      show('song-complete');
    }
  } catch (err) {
    $('status').textContent = `Couldn't save: ${err.message}`;
  } finally {
    writing = false;
    render();
  }
}

const pct = (frac) => `${frac * 100}%`;

function render() {
  if (!clip || !buffers.has(clip.id)) return;
  const v = view();
  const frac = (ms) => (ms - v.startMs) / (v.endMs - v.startMs);
  const clicking = phase === 'click';

  if (clicking) {
    zoneEl.style.left = pct(clickFrac);
    zoneEl.style.width = '0';
  } else {
    zoneEl.style.left = pct(frac(range.startMs));
    zoneEl.style.width = pct(frac(range.endMs) - frac(range.startMs));
  }
  zoneEl.classList.toggle('single', clicking);
  bar.classList.toggle('fixed', !clicking);

  $('handles').hidden = clicking;
  $('start-handle').style.left = pct(frac(range.startMs));
  $('end-handle').style.right = pct(1 - frac(range.endMs));

  const adj = adjacent();
  $('line').querySelectorAll('.syllable').forEach((box, i) => {
    box.classList.toggle('in-range', !clicking && (i === target || i === adj));
  });

  if (clicking) {
    $('prompt').replaceChildren(
      'Drag the blue line until the click lands on ', ...describe(target), '.',
    );
  } else if (adj === null) {
    $('prompt').replaceChildren(
      'Move the Start and End handles until you can only hear the syllable outlined above in ', orange('ORANGE'),
      ': ', ...describe(target), '.',
    );
  } else {
    const list = document.createElement('ul');
    for (const idx of [target, adj].sort((a, b) => a - b)) {
      const li = document.createElement('li');
      li.append(...describe(idx));
      list.append(li);
    }
    $('prompt').replaceChildren(
      'Move the Start and End handles until you can only hear the 2 syllables outlined above in ', orange('ORANGE'),
      ':', list,
    );
  }
  $('back').hidden = !clicking;
  $('next').hidden = clicking;
  $('next').disabled = !rangeMoved;
  $('submit').hidden = !clicking;
  $('submit').disabled = writing;
}

// ---------- Audio engine ----------

// Created up front so clips can be decoded; it stays suspended until the first Play.
const ctx = new AudioContext();
const buffers = new Map(); // clip id -> AudioBuffer

let timer = null;
let sources = []; // scheduled sources, so Stop can cancel them
let loops = [];   // the last two loops: { audioStart, offsetS, endS, src, gain, clicked, saved }
                  // (offsetS: where in the clip the audio starts;
                  // endS: context time the audio ends, which follows the End handle;
                  // saved: syllable index -> { src, t } for the other syllables' clicks scheduled in it)

async function loadBuffer(c) {
  if (buffers.has(c.id)) return buffers.get(c.id);
  const res = await fetch(c.file);
  if (!res.ok) throw new Error(`Couldn't load ${c.file} (HTTP ${res.status}).`);
  const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
  buffers.set(c.id, buffer);
  return buffer;
}

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

function track(src) {
  src.onended = () => { sources = sources.filter((s) => s !== src); };
  sources.push(src);
}

function playClick(when, volume = CLICK_GAIN) {
  const src = ctx.createBufferSource();
  src.buffer = click;
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
  const src = ctx.createBufferSource();
  src.buffer = buffers.get(clip.id);
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
  // Drop saved clicks the loop no longer reaches; scheduleSaved puts them back if the end moves out again.
  for (const [i, { src, t }] of loop.saved) {
    if (t >= endS) {
      src.stop();
      loop.saved.delete(i);
    }
  }
}

// Click stage: each loop's click is scheduled as late as possible,
// so dragging takes effect within the current loop when it can.
function scheduleClick(loop, now, horizon) {
  if (phase !== 'click' || loop.clicked) return;
  const t = loop.audioStart + clickMs() / 1000 - loop.offsetS;
  if (t >= horizon) return;
  if (t >= now) playClick(t); // else: the click was dragged past it
  loop.clicked = true;
}

// Both stages: the clicks already aligned for the song's other syllables sound wherever they fall in the loop.
function scheduleSaved(loop, now, horizon) {
  for (const i of indices(clip)) {
    const r = responses.get(docId(clip.id, i));
    if (i === target || !r || loop.saved.has(i)) continue;
    const t = loop.audioStart + r.clickTimeMs / 1000 - loop.offsetS;
    if (t < loop.audioStart || t < now || t >= loop.endS || t >= horizon) continue;
    loop.saved.set(i, { src: playClick(t, SAVED_CLICK_GAIN), t });
  }
}

function schedule() {
  const now = ctx.currentTime;
  const horizon = now + SCHEDULE_AHEAD_S;
  const cur = loops.at(-1);

  // The current loop follows the handles: it ends at the End handle,
  // and stops now if the Start handle has moved past what's playing.
  const playingS = cur.offsetS + (now - cur.audioStart);
  const passed = now > cur.audioStart && playingS < range.startMs / 1000;
  retime(cur, passed ? now : cur.audioStart + range.endMs / 1000 - cur.offsetS, now);
  scheduleClick(cur, now, horizon);
  scheduleSaved(cur, now, horizon);

  if (cur.endS < horizon) {
    const loop = startLoop(cur.endS);
    scheduleClick(loop, now, horizon);
    scheduleSaved(loop, now, horizon);
  }
}

function stop() {
  clearInterval(timer);
  timer = null;
  for (const s of sources) {
    try { s.stop(); } catch { /* already stopped */ }
  }
  sources = [];
  loops = [];
  playhead.hidden = true;
  renderPlayState();
}

function start() {
  stop();
  startLoop(ctx.currentTime + 0.05);
  schedule();
  timer = setInterval(schedule, SCHEDULER_INTERVAL_MS);
  renderPlayState();
}

// Plays the whole clip once, with a click at every syllable's aligned time.
async function playSong(c) {
  stop();
  ctx.resume();
  let buffer;
  try {
    buffer = await loadBuffer(c);
  } catch (err) {
    alert(err.message);
    return;
  }
  // The leading pad leaves room for clicks placed slightly before the clip begins.
  const t0 = ctx.currentTime + 0.1 + LEAD_IN_S;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = MUSIC_GAIN;
  src.connect(gain).connect(ctx.destination);
  src.start(t0);
  track(src);
  for (const i of indices(c)) {
    const { clickTimeMs } = responses.get(docId(c.id, i));
    playClick(Math.max(t0 + clickTimeMs / 1000, ctx.currentTime));
  }
}

// One button toggles playback; the bar and handles only respond while the clip is playing.
function renderPlayState() {
  const playing = timer !== null;
  $('play').textContent = playing ? '■ Stop' : '▶ Play';
  $('play').classList.toggle('playing', playing);
  bar.classList.toggle('disabled', !playing);
  $('handles').classList.toggle('disabled', !playing);
  bar.setAttribute('aria-disabled', String(!playing));
  $('handles').setAttribute('aria-disabled', String(!playing));
}

// The playhead follows what's audible now (compensating for output latency),
// and hides when nothing in the view is playing.
function drawPlayhead() {
  requestAnimationFrame(drawPlayhead);
  if (!timer) return;
  const t = ctx.currentTime - (ctx.outputLatency || 0);
  const loop = loops.find((l) => t >= l.audioStart && t < l.endS);
  const v = view();
  const frac = loop ? ((loop.offsetS + t - loop.audioStart) * 1000 - v.startMs) / (v.endMs - v.startMs) : -1;
  playhead.hidden = frac < 0 || frac > 1;
  playhead.style.left = pct(frac);
}
requestAnimationFrame(drawPlayhead);

// ---------- Events ----------

$('sign-in').addEventListener('click', () => {
  signInWithPopup(auth, new GoogleAuthProvider()).catch((err) => alert(err.message));
});

$('sign-out').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (u) => {
  user = u;
  stop();
  clip = null;
  reviewing = false;
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

$('play').addEventListener('click', () => {
  if (timer) {
    stop();
    return;
  }
  ctx.resume();
  start();
});
$('next').addEventListener('click', next);
$('back').addEventListener('click', back);
$('submit').addEventListener('click', submit);
$('play-song').addEventListener('click', () => playSong(clip));
$('download').addEventListener('click', downloadAlignments);

$('song-menu').addEventListener('change', (e) => {
  const c = clips.find((x) => x.id === e.target.value);
  if (writing || !c) { renderSongMenu(); return; }
  openReview(c);
});

$('another').addEventListener('click', (e) => {
  e.preventDefault();
  nextSong();
});

// Click stage: the click jumps to where the bar is pressed and follows the pointer.
let draggingClick = false;
const pointerFrac = (e) => {
  const rect = bar.getBoundingClientRect();
  return (e.clientX - rect.left) / rect.width;
};
bar.addEventListener('pointerdown', (e) => {
  if (phase !== 'click' || !timer) return;
  draggingClick = true;
  setClick(pointerFrac(e));
  bar.setPointerCapture(e.pointerId);
  bar.classList.add('dragging');
});
bar.addEventListener('pointermove', (e) => {
  if (draggingClick && timer) setClick(pointerFrac(e));
});
for (const type of ['pointerup', 'pointercancel']) {
  bar.addEventListener(type, () => {
    draggingClick = false;
    bar.classList.remove('dragging');
  });
}

// Range stage: pressing anywhere in a handle's row and dragging moves that handle by as much.
for (const edge of ['start', 'end']) {
  const row = $(`${edge}-row`);
  let grab = null; // { x, ms }: pointer position and the handle's time when pressed
  row.addEventListener('pointerdown', (e) => {
    if (!timer) return;
    grab = { x: e.clientX, ms: range[`${edge}Ms`] };
    row.setPointerCapture(e.pointerId);
    row.classList.add('dragging');
  });
  row.addEventListener('pointermove', (e) => {
    if (!grab || !timer) return;
    const msPerPx = clipMs() / row.getBoundingClientRect().width;
    setEdge(edge, grab.ms + (e.clientX - grab.x) * msPerPx);
  });
  for (const type of ['pointerup', 'pointercancel']) {
    row.addEventListener(type, () => {
      grab = null;
      row.classList.remove('dragging');
    });
  }
}
