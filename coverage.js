// One bar per full-length source .wav, gray, with the parts covered by clips the signed-in user has
// aligned in green (pale green where only some of a clip's syllables are aligned).

import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  $, auth, docId, loadClipList, loadResponses, indices,
} from './common.js';

let user = null;
let clips = null;           // from Firestore's clips collection
let responses = new Map();  // doc id -> response data, for the signed-in user
const durations = new Map(); // .wav path -> its duration in ms

const SCREENS = ['signed-out', 'loading', 'coverage'];
function show(name) {
  for (const s of SCREENS) $(s).hidden = s !== name;
  $('account').hidden = name === 'signed-out';
}

const isAligned = (c, idx) => responses.has(docId(user.uid, c.id, idx));
const alignedCount = (c) => indices(c).filter((i) => isAligned(c, i)).length;

// A .wav's duration, read from its header: only the first 64 KB are requested.
async function wavMs(path) {
  if (durations.has(path)) return durations.get(path);
  const res = await fetch(path, { headers: { Range: 'bytes=0-65535' } });
  if (!res.ok) throw new Error(`Couldn't load ${path} (HTTP ${res.status}).`);
  const view = new DataView(await res.arrayBuffer());
  const tag = (at) => String.fromCharCode(...new Uint8Array(view.buffer, at, 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error(`${path} isn't a WAV file.`);
  let byteRate = null;
  // Walk the chunks (fmt, LIST, …) to the data chunk; chunks are padded to an even length.
  for (let at = 12; at + 8 <= view.byteLength;) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === 'fmt ') byteRate = view.getUint32(at + 16, true);
    if (tag(at) === 'data') {
      if (!byteRate) break;
      const ms = (size / byteRate) * 1000;
      durations.set(path, ms);
      return ms;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`Couldn't read the length of ${path}.`);
}

async function render() {
  // Source .wav -> its clips, in the order the sources first appear.
  const bySource = new Map();
  for (const c of clips) {
    if (!c.source) continue;
    if (!bySource.has(c.source)) bySource.set(c.source, []);
    bySource.get(c.source).push(c);
  }
  const paths = [...bySource.keys(), ...clips.filter((c) => c.source).map((c) => c.file)];
  await Promise.all(paths.map(wavMs));

  const songs = $('songs');
  songs.replaceChildren();
  for (const [source, list] of bySource) {
    const total = durations.get(source);
    const bar = document.createElement('div');
    bar.className = 'coverage-bar';
    let doneMs = 0;
    for (const c of list) {
      const n = alignedCount(c);
      if (n === 0) continue;
      const full = n === indices(c).length;
      const len = durations.get(c.file);
      if (full) doneMs += len;
      const seg = document.createElement('div');
      seg.className = `segment ${full ? 'aligned' : 'partial'}`;
      seg.style.left = `${(c.sourceStartMs / total) * 100}%`;
      seg.style.width = `${(len / total) * 100}%`;
      seg.title = `${c.title} (${n}/${indices(c).length} syllables)`;
      bar.append(seg);
    }

    const heading = document.createElement('div');
    const done = list.filter((c) => alignedCount(c) === indices(c).length).length;
    heading.textContent = `${list[0].title.split(':')[0]} — ${source.split('/').pop()}: `
      + `${done}/${list.length} clips aligned (${Math.round((doneMs / total) * 100)}% of the audio)`;

    const song = document.createElement('div');
    song.className = 'coverage-song';
    song.append(heading, bar);
    songs.append(song);
  }
}

$('sign-in').addEventListener('click', () => {
  signInWithPopup(auth, new GoogleAuthProvider()).catch((err) => alert(err.message));
});

$('sign-out').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (u) => {
  user = u;
  if (!u) { show('signed-out'); return; }
  $('who').textContent = `Logged in as ${u.email}`;
  $('loading-msg').textContent = 'Loading…';
  show('loading');
  try {
    if (!clips) clips = await loadClipList();
    responses = await loadResponses(u.uid);
    await render();
    show('coverage');
  } catch (err) {
    $('loading-msg').textContent = err.message;
  }
});
