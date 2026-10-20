// Guided click alignment: each line clip starts with VPR's syllable times (guide_timestamps.json) as
// provisional clicks, which the user checks and adjusts, then saves in one go.
// Overview: the whole clip loops with every staged click. Each syllable is gray (no click),
// amber (a guide click, not yet confirmed) or green (confirmed).
// Clicking a syllable with a click loops a window around it, where its click can be dragged (click
// stage). Clicking a gray one starts from index.html's range stage. Done confirms it and returns to
// the overview.
// Nothing is written until Submit, which saves the whole clip in one batch.

import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  $, auth, db, docId as responseId, loadClipList, loadResponses, syllableCount, indices, locate, describe,
  orange, buildLine, fitLine, lineObserver, ctx, loadBuffer, hasBuffer, bufferOf, clipMs as lengthMs, setLoopSource,
  onPlayStateChange, isPlaying, schedule, start, stop, playOnce, playingMs, CLICK_GAIN, SAVED_CLICK_GAIN,
} from './common.js';

const MIN_RANGE_MS = 100;    // the Start and End handles can't get closer than this
const ADJUST_WINDOW_MS = 500; // adjusting a click loops this much either side of it

const bar = $('bar');
const zoneEl = $('zone');
const playhead = $('playhead');

// ---------- App state ----------

let user = null;
let clips = null;           // from Firestore's clips collection
let responses = new Map();  // doc id -> response data, for the signed-in user
let guides = null;          // guide_timestamps.json: clip id -> guide times in ms
let clip = null;            // the song being worked on
let reviewing = false;      // the song was picked from the footer menu
let writing = false;        // the clip is being saved

// The clip's staged state, kept in memory until Submit.
let assignment = []; // guide k -> flat syllable index, or null (not played)
let marks = [];      // per syllable: { ms, state, guideMs, segment }
                     // (ms: the staged click, or null; state: 'none', 'provisional' or 'confirmed';
                     // guideMs: the guide it started from, or null; segment: what was looping when the
                     // click was placed, or null if it was accepted without adjustment)

// Adjusting one syllable.
let stage = 'overview';     // 'overview', 'range', 'click' or 'assignment'
let target = 0;             // flat index of the syllable being adjusted
let fromGray = false;       // it had no click, so it started from the range stage
let range = { startMs: 0, endMs: 0 }; // the looped part of the clip
let clickFrac = 0.5;        // click stage: where the click is, as a fraction of the range
let clickMoved = false;     // the click has been dragged since the click stage began
let rangeMoved = false;     // a handle has moved since the range stage began (enables Next)

const clipMs = () => lengthMs(clip);
const clickMs = () => range.startMs + clickFrac * (range.endMs - range.startMs);
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

// What the bar spans: the whole clip in the range stage, the chosen range in the click stage.
const view = () => (stage === 'range' ? { startMs: 0, endMs: clipMs() } : range);

const SCREENS = ['signed-out', 'loading', 'overview', 'task', 'assignment', 'all-done'];
function show(name) {
  for (const s of SCREENS) $(s).hidden = s !== name;
  $('account').hidden = name === 'signed-out';
  $('line-area').hidden = !['overview', 'task', 'assignment'].includes(name);
  renderSongMenu();
}

const docId = (clipId, syllableIndex) => responseId(user.uid, clipId, syllableIndex);
const isAligned = (c, idx) => responses.has(docId(c.id, idx));
const guideTimes = (c) => guides[c.id] ?? [];

async function loadGuides() {
  const res = await fetch('guide_timestamps.json');
  if (!res.ok) throw new Error(`Couldn't load guide_timestamps.json (HTTP ${res.status}).`);
  return res.json();
}

// ---------- Songs ----------

const isComplete = (c) => indices(c).every((i) => isAligned(c, i));

// The first song after the current one (wrapping around) with unaligned syllables, or undefined.
// Starting after the current song means a skipped song comes back only after the rest.
function nextIncomplete() {
  const from = clip ? clips.indexOf(clip) + 1 : 0;
  const order = [...clips.slice(from), ...clips.slice(0, from)];
  return order.find((x) => x !== clip && !isComplete(x)) ?? (clip && !isComplete(clip) ? clip : undefined);
}

// Opens the next song with unaligned syllables, or the all-done page if there are none.
function nextSong() {
  const c = nextIncomplete();
  if (c) {
    openClip(c, false);
    return;
  }
  clip = null;
  stop();
  show('all-done');
  renderAllLines();
}

// Loads the clip and stages its clicks: saved responses (confirmed), else the default assignment's
// guides (provisional). Returns false if the audio couldn't be loaded.
async function openClip(c, review) {
  stop();
  clip = c;
  reviewing = review;
  $('loading-msg').textContent = 'Loading audio…';
  show('loading');
  try {
    await loadBuffer(c);
  } catch (err) {
    $('loading-msg').textContent = err.message;
    return false;
  }
  const n = syllableCount(c);
  assignment = guideTimes(c).map((_, k) => (k < n ? k : null));
  marks = stagedMarks(true);
  $('overview-status').textContent = '';
  showOverview();
  return true;
}

// Every syllable's click from the assignment (provisional, or none if no guide is assigned to it).
// useSaved: syllables with saved responses keep their saved clicks instead, confirmed.
function stagedMarks(useSaved) {
  const times = guideTimes(clip);
  const guideOf = new Map();
  assignment.forEach((idx, k) => { if (idx !== null) guideOf.set(idx, times[k]); });
  return indices(clip).map((i) => {
    const saved = useSaved && responses.get(docId(clip.id, i));
    if (saved) return { ms: saved.clickTimeMs, state: 'confirmed', guideMs: null, segment: null };
    const g = guideOf.get(i);
    if (g === undefined) return { ms: null, state: 'none', guideMs: null, segment: null };
    return { ms: g, state: 'provisional', guideMs: g, segment: null };
  });
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
// Clicking a syllable reopens that song to adjust it.
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
      onSelect: async (idx) => { if (await openClip(c, true)) adjust(idx); },
      clickable: (idx) => isAligned(c, idx),
    });

    const row = document.createElement('div');
    row.className = 'line-row';
    row.append(btn, line);
    list.append(row);
    lineObserver.observe(line);
  }
}

// ---------- Lyric line ----------

const STATE_CLASSES = { none: [], provisional: ['provisional'], confirmed: ['aligned'] };

// Draws the main lyric line. `active` is the syllable being adjusted, or null.
function renderLine(active) {
  buildLine($('line'), clip, {
    active,
    classOf: (idx) => STATE_CLASSES[marks[idx].state],
    onSelect: adjust,
  });
  fitLine($('line'));
}
lineObserver.observe($('line'));

// The neighbour that stays in the loop with the target: the next syllable, or the previous one at the end
// of the clip (null if the clip has only one syllable).
function adjacent() {
  if (target + 1 < syllableCount(clip)) return target + 1;
  return target > 0 ? target - 1 : null;
}

// ---------- Overview ----------

function showOverview() {
  stage = 'overview';
  renderLine(null);
  const count = (state) => marks.filter((m) => m.state === state).length;
  const gray = count('none');
  const msg = [];
  if (reviewing && isComplete(clip)) msg.push(`Your alignments for “${clip.title}”.`);
  if (!guideTimes(clip).length) {
    msg.push('There are no guide clicks for this line, so every syllable starts gray.');
  } else {
    msg.push('Press Play to hear the line with a click on every syllable that has one.');
  }
  msg.push('Click a syllable to adjust its click: amber ones are guesses, green ones are confirmed.');
  if (gray) msg.push(`${gray} gray ${gray === 1 ? 'syllable has' : 'syllables have'} no click yet; click to align by hand.`);
  else msg.push('When they all sound right, press Submit.');
  $('overview-msg').textContent = msg.join(' ');
  $('edit-assignment').hidden = !guideTimes(clip).length;
  renderOverviewButtons();
  show('overview');
  if (isPlaying()) start(); // keep playing, now the whole clip
}

function renderOverviewButtons() {
  $('submit').disabled = writing || marks.some((m) => m.ms === null);
  $('skip').disabled = writing || [undefined, clip].includes(nextIncomplete());
  $('edit-assignment').disabled = writing;
}

// Moves on to the next unfinished song without saving this one.
function skip() {
  if (writing) return;
  const c = nextIncomplete();
  if (c && c !== clip) openClip(c, false);
}

// Saves every new or changed syllable in one batch, then moves on to the next unfinished song.
async function submit() {
  if (writing || marks.some((m) => m.ms === null)) return;
  const batch = writeBatch(db);
  const written = [];
  marks.forEach((m, i) => {
    const id = docId(clip.id, i);
    const prev = responses.get(id);
    if (prev && prev.clickTimeMs === m.ms) return; // unchanged: leave its revision alone
    const data = {
      uid: user.uid,
      email: user.email,
      clipId: clip.id,
      syllableIndex: i,
      offsetMs: m.ms - clipMs() / 2, // relative to the middle of the whole clip
      clickTimeMs: m.ms,
      segmentStartMs: m.segment?.startMs ?? null,
      segmentEndMs: m.segment?.endMs ?? null,
      revision: prev ? (prev.revision ?? 0) + 1 : 0,
      updatedAt: serverTimestamp(),
      userAgent: navigator.userAgent,
      method: 'guided',
      guideTimeMs: m.guideMs,
    };
    batch.set(doc(db, 'responses', id), data);
    written.push([id, data]);
  });

  writing = true;
  renderOverviewButtons();
  $('overview-status').textContent = 'Saving…';
  try {
    if (written.length) await batch.commit();
    for (const [id, data] of written) responses.set(id, { ...data, updatedAt: new Date() }); // stand-in for the server timestamp
    $('overview-status').textContent = '';
    writing = false;
    nextSong();
  } catch (err) {
    $('overview-status').textContent = `Couldn't save: ${err.message}`;
  } finally {
    writing = false;
    if (stage === 'overview') renderOverviewButtons();
  }
}

// ---------- Adjusting a syllable ----------

// A syllable with a click loops a window around it, in the click stage; a gray one starts from the
// range stage, on the whole clip.
function adjust(idx) {
  if (writing) return;
  target = idx;
  const m = marks[idx];
  fromGray = m.ms === null;
  if (fromGray) {
    stage = 'range';
    range = { startMs: 0, endMs: clipMs() };
    rangeMoved = false;
  } else {
    const t = clamp(m.ms, 0, clipMs());
    range = {
      startMs: Math.max(0, Math.min(t - ADJUST_WINDOW_MS, clipMs() - MIN_RANGE_MS)),
      endMs: Math.min(clipMs(), Math.max(t + ADJUST_WINDOW_MS, MIN_RANGE_MS)),
    };
    stage = 'click';
    clickFrac = (t - range.startMs) / (range.endMs - range.startMs);
  }
  clickMoved = false;
  renderLine(target);
  show('task');
  if (isPlaying()) start();
  render();
}

// Confirms the syllable's click and goes back to the overview, looping the whole clip from the top so
// the new click can be heard in context.
function done() {
  const m = marks[target];
  if (fromGray || clickMoved) {
    m.ms = clickMs();
    m.segment = { ...range };
  }
  m.state = 'confirmed';
  showOverview();
  if (!isPlaying()) start();
}

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
  clickMoved = true;
  render();
}

// Range stage -> click stage, looping just the chosen range.
function next() {
  stage = 'click';
  clickFrac = 0.5;
  if (isPlaying()) start();
  render();
}

// Click stage -> range stage, with the handles where they were.
function back() {
  stage = 'range';
  if (isPlaying()) start();
  render();
}

const pct = (frac) => `${frac * 100}%`;

function render() {
  if (!clip || !hasBuffer(clip) || (stage !== 'range' && stage !== 'click')) return;
  const v = view();
  const frac = (ms) => (ms - v.startMs) / (v.endMs - v.startMs);
  const clicking = stage === 'click';

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
      'Drag the blue line until the click lands on ', ...describe(clip, target), ', then press Done.',
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
  $('back').hidden = !clicking || !fromGray;
  $('next').hidden = clicking;
  $('next').disabled = !rangeMoved;
  $('done').hidden = !clicking;
}

// ---------- Syllable assignment ----------

let draft = []; // the assignment as edited so far

// "5. as (1 of 1)": flat syllable number, word, syllable within the word.
function syllableLabel(idx) {
  const { word, syllable } = locate(clip, idx);
  const w = clip.words[word];
  return `${idx + 1}. ${w.text} (${syllable + 1} of ${w.syllables})`;
}

function openAssignment() {
  stop();
  stage = 'assignment';
  draft = [...assignment];
  const times = guideTimes(clip);
  const rows = times.map((ms, k) => {
    const select = document.createElement('select');
    select.append(new Option('None', ''), ...indices(clip).map((i) => new Option(syllableLabel(i), String(i))));
    select.value = draft[k] === null ? '' : String(draft[k]);
    select.addEventListener('change', () => {
      draft[k] = select.value === '' ? null : Number(select.value);
      renderClashes();
    });

    const row = document.createElement('tr');
    for (const content of [`${k + 1}`, `${(ms / 1000).toFixed(3)} s`, select]) {
      const td = document.createElement('td');
      td.append(content);
      row.append(td);
    }
    return row;
  });
  $('assignment-rows').replaceChildren(...rows);
  renderLine(null);
  show('assignment');
  renderClashes();
}

// Two guides on one syllable: highlight both rows and disable Done.
function renderClashes() {
  const uses = new Map();
  for (const idx of draft) if (idx !== null) uses.set(idx, (uses.get(idx) ?? 0) + 1);
  const clash = (idx) => idx !== null && uses.get(idx) > 1;
  [...$('assignment-rows').children].forEach((row, k) => row.classList.toggle('clash', clash(draft[k])));
  const any = draft.some(clash);
  $('assignment-status').textContent = any ? 'Two guides can’t go on the same syllable.' : '';
  $('assignment-done').disabled = any;
}

// A changed assignment resets the clip: every syllable takes its guide's click (or none), and all
// confirmations and hand-placed clicks are dropped.
function applyAssignment() {
  if (draft.every((idx, k) => idx === assignment[k])) {
    showOverview();
    return;
  }
  if (marks.some((m) => m.state === 'confirmed')
      && !confirm('This will clear your confirmed syllables. Continue?')) {
    return;
  }
  assignment = draft;
  marks = stagedMarks(false);
  showOverview();
}

// ---------- Audio ----------

// Overview: the whole clip, with every staged click. Adjusting: the range, with the click being dragged
// in the click stage, and the other syllables' staged clicks a little quieter.
setLoopSource({
  buffer: () => bufferOf(clip),
  range: () => (stage === 'overview' ? { startMs: 0, endMs: clipMs() } : range),
  liveClickMs: () => (stage === 'click' ? clickMs() : null),
  otherClicks: () => marks.flatMap((m, i) => {
    if (m.ms === null) return [];
    if (stage === 'overview') return [[i, m.ms, CLICK_GAIN]];
    return i === target ? [] : [[i, m.ms, SAVED_CLICK_GAIN]];
  }),
});
onPlayStateChange(() => {
  if (!isPlaying()) playhead.hidden = true;
  renderPlayState();
});

// All-done page: plays the whole clip once, with a click at every syllable's saved time.
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
  for (const btn of [$('play'), $('overview-play')]) {
    btn.textContent = playing ? '■ Stop' : '▶ Play';
    btn.classList.toggle('playing', playing);
  }
  bar.classList.toggle('disabled', !playing);
  $('handles').classList.toggle('disabled', !playing);
  bar.setAttribute('aria-disabled', String(!playing));
  $('handles').setAttribute('aria-disabled', String(!playing));
}

// The playhead follows what's audible now, and hides when nothing in the view is playing.
function drawPlayhead() {
  requestAnimationFrame(drawPlayhead);
  if (!isPlaying() || (stage !== 'range' && stage !== 'click')) return;
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
    if (!clips) [clips, guides] = await Promise.all([loadClipList(), loadGuides()]);
    responses = await loadResponses(u.uid);
    nextSong();
  } catch (err) {
    $('loading-msg').textContent = err.message;
  }
});

for (const id of ['play', 'overview-play']) {
  $(id).addEventListener('click', () => {
    if (isPlaying()) {
      stop();
      return;
    }
    ctx.resume();
    start();
  });
}
$('next').addEventListener('click', next);
$('back').addEventListener('click', back);
$('done').addEventListener('click', done);
$('to-overview').addEventListener('click', showOverview);
$('submit').addEventListener('click', submit);
$('skip').addEventListener('click', skip);
$('edit-assignment').addEventListener('click', openAssignment);
$('assignment-done').addEventListener('click', applyAssignment);
$('assignment-cancel').addEventListener('click', showOverview);

$('song-menu').addEventListener('change', (e) => {
  const c = clips.find((x) => x.id === e.target.value);
  if (writing || !c) { renderSongMenu(); return; }
  openClip(c, true);
});

// Click stage: the click jumps to where the bar is pressed and follows the pointer.
let draggingClick = false;
const pointerFrac = (e) => {
  const rect = bar.getBoundingClientRect();
  return (e.clientX - rect.left) / rect.width;
};
bar.addEventListener('pointerdown', (e) => {
  if (stage !== 'click' || !isPlaying()) return;
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
