// Click alignment app: Google sign-in, songs worked through one syllable at a time, and a two-stage
// alignment interface.
// Range stage: the whole clip loops, and the user moves the Start and End handles until the loop holds
// just two syllables, the target and one named neighbour. The loop follows the handles as they move.
// Click stage: that range loops with a single click the user drags until it lands on the target.

import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  $, auth, db, docId as responseId, loadClipList, loadResponses, syllableCount, indices, locate, describe,
  orange, buildLine, fitLine, lineObserver, ctx, loadBuffer, hasBuffer, bufferOf, clipMs as lengthMs, setLoopSource,
  onPlayStateChange, isPlaying, schedule, start, stop, playOnce, playingMs, SAVED_CLICK_GAIN,
} from './common.js';

const MIN_RANGE_MS = 100;         // the Start and End handles can't get closer than this
const EDIT_WINDOW_MS = 250;       // redoing an aligned syllable loops this much either side of its click
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

const clipMs = () => lengthMs(clip);
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

const docId = (clipId, syllableIndex) => responseId(user.uid, clipId, syllableIndex);
const isAligned = (c, idx) => responses.has(docId(c.id, idx));

// ---------- Songs ----------

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
    buildLine(line, c, {
      classOf: (idx) => (isAligned(c, idx) ? ['aligned'] : []),
      onSelect: (idx) => openSong(c, idx),
      clickable: (idx) => isAligned(c, idx), // only aligned syllables
    });

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

// Draws the main lyric line. `active` is the syllable being aligned, or null.
// Clicking any syllable aligns (or re-aligns) it.
function renderLine(active) {
  buildLine($('line'), clip, {
    active,
    classOf: (idx) => (isAligned(clip, idx) ? ['aligned'] : []),
    onSelect: selectSyllable,
  });

  // Once every syllable is aligned, offer to play the whole clip with all the clicks.
  $('play-song').hidden = nextUnaligned(clip) !== null;

  fitLine($('line'));
}

lineObserver.observe($('line'));

// The neighbour that stays in the loop with the target: the next syllable, or the previous one at the end
// of the clip (null if the clip has only one syllable).
function adjacent() {
  if (target + 1 < syllableCount(clip)) return target + 1;
  return target > 0 ? target - 1 : null;
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
  if (isPlaying()) start();
  render();
}

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

function setEdge(edge, ms) {
  const before = range[`${edge}Ms`];
  if (edge === 'start') range.startMs = clamp(ms, 0, range.endMs - MIN_RANGE_MS);
  else range.endMs = clamp(ms, range.startMs + MIN_RANGE_MS, clipMs());
  if (range[`${edge}Ms`] !== before) rangeMoved = true;
  if (isPlaying()) schedule(); // the current loop follows right away
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
  if (isPlaying()) start();
  render();
}

// Click stage -> range stage, with the handles where they were.
function back() {
  phase = 'range';
  if (isPlaying()) start();
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
  if (!clip || !hasBuffer(clip)) return;
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
      'Drag the blue line until the click lands on ', ...describe(clip, target), '.',
    );
  } else if (adj === null) {
    $('prompt').replaceChildren(
      'Move the Start and End handles until you can only hear the syllable outlined above in ', orange('ORANGE'),
      ': ', ...describe(clip, target), '.',
    );
  } else {
    const list = document.createElement('ul');
    for (const idx of [target, adj].sort((a, b) => a - b)) {
      const li = document.createElement('li');
      li.append(...describe(clip, idx));
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

// ---------- Audio ----------

// The loop plays the range; in the click stage, with the click being dragged.
// Both stages: the clicks already aligned for the song's other syllables sound wherever they fall in the loop.
setLoopSource({
  buffer: () => bufferOf(clip),
  range: () => range,
  liveClickMs: () => (phase === 'click' ? clickMs() : null),
  otherClicks: () => indices(clip)
    .filter((i) => i !== target && responses.has(docId(clip.id, i)))
    .map((i) => [i, responses.get(docId(clip.id, i)).clickTimeMs, SAVED_CLICK_GAIN]),
});
onPlayStateChange(() => {
  if (!isPlaying()) playhead.hidden = true;
  renderPlayState();
});

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
  playOnce(buffer, indices(c).map((i) => responses.get(docId(c.id, i)).clickTimeMs));
}

// One button toggles playback; the bar and handles only respond while the clip is playing.
function renderPlayState() {
  const playing = isPlaying();
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
  if (!isPlaying()) return;
  const ms = playingMs();
  const v = view();
  const frac = ms !== null ? (ms - v.startMs) / (v.endMs - v.startMs) : -1;
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
    responses = await loadResponses(u.uid);
    nextSong();
  } catch (err) {
    $('loading-msg').textContent = err.message;
  }
});

$('play').addEventListener('click', () => {
  if (isPlaying()) {
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
  if (phase !== 'click' || !isPlaying()) return;
  draggingClick = true;
  setClick(pointerFrac(e));
  bar.setPointerCapture(e.pointerId);
  bar.classList.add('dragging');
});
bar.addEventListener('pointermove', (e) => {
  if (draggingClick && isPlaying()) setClick(pointerFrac(e));
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
    if (!isPlaying()) return;
    grab = { x: e.clientX, ms: range[`${edge}Ms`] };
    row.setPointerCapture(e.pointerId);
    row.classList.add('dragging');
  });
  row.addEventListener('pointermove', (e) => {
    if (!grab || !isPlaying()) return;
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
