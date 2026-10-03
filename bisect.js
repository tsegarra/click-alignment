// Two-stage alignment prototype: no login, no database.
// Range stage: the whole clip loops, and the user moves the Start and End handles until the loop holds
// just two syllables, the target and one named neighbour. The loop follows the handles as they move.
// Click stage: that range loops with a single click the user drags until it lands on the target.

const SCHEDULER_INTERVAL_MS = 25; // how often the scheduler wakes up
const SCHEDULE_AHEAD_S = 0.1;     // how far ahead it schedules audio
const PAD_S = 0.1;                // silence before and after each loop
const SHORT_LOOP_MS = 600;        // loops shorter than this repeat less often, so they don't grate
const SHORT_LOOP_PERIOD_S = 1;    // time between starts of a short loop
const MIN_RANGE_MS = 100;         // the Start and End handles can't get closer than this
const FADE_S = 0.003;             // fade at the loop's edges, so cutting the audio doesn't pop
const MUSIC_GAIN = 0.7;           // volume of the music
const CLICK_GAIN = 0.35;          // volume of the clicks
const CLICK_HZ = 2000;            // pitch of the single click

const $ = (id) => document.getElementById(id);
const bar = $('bar');
const zoneEl = $('zone');
const playhead = $('playhead');

// ---------- State ----------

let clips = [];
let clip = null;          // the selected clip
let target = 0;           // flat index of the syllable being aligned
let phase = 'range';      // 'range': trim the loop to two syllables; 'click': line a click up with the target
let range = { startMs: 0, endMs: 0 }; // the looped part of the clip
let clickFrac = 0.5;      // click stage: where the click is, as a fraction of the range
let rangeMoved = false;   // whether a handle has moved since the range stage began (enables Next)
const results = [];       // { clipId, syllable, estimateMs, rangeStartMs, rangeEndMs }

const clipMs = () => buffers.get(clip.id).duration * 1000;
const clickMs = () => range.startMs + clickFrac * (range.endMs - range.startMs);

// What the bar spans: the whole clip in the range stage, the chosen range in the click stage.
const view = () => (phase === 'range' ? { startMs: 0, endMs: clipMs() } : range);

// ---------- Lyric line ----------

const syllableCount = (c) => c.words.reduce((n, w) => n + w.syllables, 0);

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

const hasResult = (idx) => results.some((r) => r.clipId === clip.id && r.syllable === idx);

// Words on top, one box per syllable underneath. Click a box to align that syllable.
function renderLine() {
  const line = $('line');
  const { word } = locate(clip, target);
  line.replaceChildren();
  let flat = 0;
  clip.words.forEach((w, i) => {
    const cell = document.createElement('div');
    cell.className = 'word';
    if (i === word) cell.append(boldUnderline(w.text));
    else cell.append(w.text);

    const syllables = document.createElement('div');
    syllables.className = 'syllables';
    for (let s = 0; s < w.syllables; s++, flat++) {
      const box = document.createElement('span');
      box.className = 'syllable';
      if (flat === target) box.classList.add('active');
      if (hasResult(flat)) box.classList.add('aligned');
      const idx = flat;
      box.addEventListener('click', () => selectTarget(idx));
      syllables.append(box);
    }

    const col = document.createElement('div');
    col.className = 'column';
    col.append(cell, syllables);
    line.append(col);
  });
  fitLine();
}

// Shrinks the line's font (never grows it) until every word fits on one row.
function fitLine() {
  const line = $('line');
  line.style.fontSize = '';
  if (line.clientWidth === 0) return;
  let size = parseFloat(getComputedStyle(line).fontSize);
  for (let i = 0; i < 5 && line.scrollWidth > line.clientWidth; i++) {
    size *= line.clientWidth / line.scrollWidth * 0.99;
    line.style.fontSize = `${size}px`;
  }
}
new ResizeObserver(fitLine).observe($('line'));

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

function resetSearch() {
  phase = 'range';
  range = { startMs: 0, endMs: clipMs() };
  rangeMoved = false;
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

// Records the click as the syllable's time and moves on to the next syllable.
function finish() {
  const existing = results.findIndex((r) => r.clipId === clip.id && r.syllable === target);
  const result = {
    clipId: clip.id,
    syllable: target,
    estimateMs: clickMs(),
    rangeStartMs: range.startMs,
    rangeEndMs: range.endMs,
  };
  if (existing >= 0) results[existing] = result;
  else results.push(result);
  selectTarget(Math.min(target + 1, syllableCount(clip) - 1));
}

function selectTarget(idx) {
  target = idx;
  renderLine();
  resetSearch();
}

const pct = (frac) => `${frac * 100}%`;

function render() {
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
  $('finish').hidden = !clicking;
}

// ---------- Audio engine ----------

// Created up front so clips can be decoded; it stays suspended until the first Play.
const ctx = new AudioContext();
const buffers = new Map(); // clip id -> AudioBuffer

let timer = null;
let sources = []; // scheduled sources, so Stop can cancel them
let loops = [];   // the last two loops: { loopStart, audioStart, offsetS, endS, src, gain, clicked }
                  // (loopStart: context time of the silence before the audio; offsetS: where in the clip
                  // the audio starts; endS: context time the audio ends, which follows the End handle)

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

function playClick(buffer, when) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = CLICK_GAIN;
  src.connect(gain).connect(ctx.destination);
  src.start(when);
  track(src);
}

// Plays `dur` seconds of the clip from `offset`, with short fades so the cut edges don't pop.
// Starts a loop of the range: PAD_S of silence, then the range's audio (its end is set by retime).
function startLoop(loopStart) {
  const audioStart = loopStart + PAD_S;
  const src = ctx.createBufferSource();
  src.buffer = buffers.get(clip.id);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, audioStart);
  gain.gain.linearRampToValueAtTime(MUSIC_GAIN, audioStart + FADE_S);
  src.connect(gain).connect(ctx.destination);
  src.start(audioStart, range.startMs / 1000);
  track(src);
  const loop = { loopStart, audioStart, offsetS: range.startMs / 1000, endS: Infinity, src, gain, clicked: false };
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
}

// Click stage: each loop's click is scheduled as late as possible,
// so dragging takes effect within the current loop when it can.
function scheduleClick(loop, now, horizon) {
  if (phase !== 'click' || loop.clicked) return;
  const t = loop.audioStart + clickMs() / 1000 - loop.offsetS;
  if (t >= horizon) return;
  if (t >= now) playClick(click, t); // else: the click was dragged past it
  loop.clicked = true;
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

  if (cur.endS + PAD_S < horizon) {
    const period = range.endMs - range.startMs < SHORT_LOOP_MS ? SHORT_LOOP_PERIOD_S : 0;
    scheduleClick(startLoop(Math.max(cur.endS + PAD_S, cur.loopStart + period)), now, horizon);
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
// and hides during the silence between loops.
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

async function selectClip(id) {
  stop();
  clip = clips.find((c) => c.id === id);
  $('prompt').textContent = 'Loading audio…';
  try {
    await loadBuffer(clip);
    selectTarget(0);
  } catch (err) {
    $('prompt').textContent = err.message;
  }
}

$('clip').addEventListener('change', (e) => selectClip(e.target.value));

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
$('finish').addEventListener('click', finish);

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

(async () => {
  try {
    const res = await fetch('clips.json');
    if (!res.ok) throw new Error(`Couldn't load clips.json (HTTP ${res.status}).`);
    clips = (await res.json()).clips;
    for (const c of clips) $('clip').append(new Option(c.title, c.id));
    await selectClip(clips[0].id);
  } catch (err) {
    $('prompt').textContent = err.message;
  }
})();
