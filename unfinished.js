// Every clip the signed-in user hasn't finished aligning, each as its lyric line (aligned syllables
// green) with a play button that plays the clip without clicks.

import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  $, auth, docId, loadClipList, loadResponses, indices, buildLine, lineObserver, ctx, loadBuffer, playOnce, stop,
} from './common.js';

let user = null;
let clips = null;           // from Firestore's clips collection
let responses = new Map();  // doc id -> response data, for the signed-in user
let playing = null;         // { btn, timer }: the clip playing now, or null
const marked = [];          // .wav file names marked for extension, in the order they were marked

const SCREENS = ['signed-out', 'loading', 'unfinished'];
function show(name) {
  for (const s of SCREENS) $(s).hidden = s !== name;
  $('account').hidden = name === 'signed-out';
}

const isAligned = (c, idx) => responses.has(docId(user.uid, c.id, idx));
const isComplete = (c) => indices(c).every((i) => isAligned(c, i));

function stopPlaying() {
  stop();
  if (!playing) return;
  clearTimeout(playing.timer);
  playing.btn.textContent = '▶';
  playing = null;
}

// Each button toggles its clip; starting one stops any other.
async function toggle(c, btn) {
  const wasThis = playing?.btn === btn;
  stopPlaying();
  if (wasThis) return;
  ctx.resume();
  let buffer;
  try {
    buffer = await loadBuffer(c);
  } catch (err) {
    alert(err.message);
    return;
  }
  stopPlaying(); // another button may have started while this one loaded
  playOnce(buffer, []);
  btn.textContent = '■';
  // playOnce starts the audio a fraction of a second late; this leaves time for that.
  playing = { btn, timer: setTimeout(stopPlaying, buffer.duration * 1000 + 500) };
}

const wavName = (c) => c.file.split('/').pop();

// Adds the clip's file name to the list at the top, or takes it off if it's already there.
// Only the page changes; nothing is written to the database.
function toggleMark(c, btn) {
  const name = wavName(c);
  const i = marked.indexOf(name);
  if (i === -1) marked.push(name);
  else marked.splice(i, 1);
  btn.textContent = i === -1 ? 'Unmark' : 'Mark for extension';
  $('marked').value = marked.join('\n');
}

function render() {
  const list = $('all-lines');
  for (const old of list.querySelectorAll('.line')) lineObserver.unobserve(old);
  list.replaceChildren();
  const unfinished = clips.filter((c) => !isComplete(c));
  $('unfinished-msg').textContent = unfinished.length
    ? `${unfinished.length} ${unfinished.length === 1 ? 'clip isn’t' : 'clips aren’t'} fully aligned yet.`
    : 'Every clip is aligned.';
  for (const c of unfinished) {
    const btn = document.createElement('button');
    btn.textContent = '▶';
    btn.title = 'Play the clip without clicks';
    btn.addEventListener('click', () => toggle(c, btn));

    const line = document.createElement('div');
    line.className = 'line';
    buildLine(line, c, {
      classOf: (idx) => (isAligned(c, idx) ? ['aligned'] : []),
      clickable: () => false,
    });

    const row = document.createElement('div');
    row.className = 'line-row';
    const mark = document.createElement('button');
    mark.textContent = marked.includes(wavName(c)) ? 'Unmark' : 'Mark for extension';
    mark.addEventListener('click', () => toggleMark(c, mark));

    row.append(btn, line, mark);
    list.append(row);
    lineObserver.observe(line);
  }
}

$('sign-in').addEventListener('click', () => {
  signInWithPopup(auth, new GoogleAuthProvider()).catch((err) => alert(err.message));
});

$('sign-out').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (u) => {
  user = u;
  stopPlaying();
  if (!u) { show('signed-out'); return; }
  $('who').textContent = `Logged in as ${u.email}`;
  $('loading-msg').textContent = 'Loading…';
  show('loading');
  try {
    if (!clips) clips = await loadClipList();
    responses = await loadResponses(u.uid);
    show('unfinished');
    render();
  } catch (err) {
    $('loading-msg').textContent = err.message;
  }
});
