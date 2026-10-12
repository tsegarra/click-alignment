// Admin page: for every email that has submitted responses, the songs they've aligned
// and how many of each song's syllables they've done.
// Only ADMIN_UID can read other users' responses; the Firestore rules enforce that.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, getDocs, doc, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from '../firebase-config.js';

const ADMIN_UID = 'jW5a1syKlVamPYlVyuZxAA6gmjp1';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

function setStatus(text) {
  $('status').textContent = text;
  $('status').hidden = !text;
}

const syllableCount = (clip) => clip.words.reduce((n, w) => n + w.syllables, 0);

async function loadClipList() {
  const res = await fetch('../clips.json');
  if (!res.ok) throw new Error(`Couldn't load clips.json (HTTP ${res.status}).`);
  return (await res.json()).clips;
}

async function render() {
  setStatus('Loading…');
  const [clips, snap] = await Promise.all([loadClipList(), getDocs(collection(db, 'responses'))]);

  // email -> clip id -> Set of aligned syllable indices
  const byEmail = new Map();
  for (const d of snap.docs) {
    const { email, clipId, syllableIndex } = d.data();
    const key = email ?? '(no email)';
    if (!byEmail.has(key)) byEmail.set(key, new Map());
    const songs = byEmail.get(key);
    if (!songs.has(clipId)) songs.set(clipId, new Set());
    songs.get(clipId).add(syllableIndex);
  }

  const clipOrder = new Map(clips.map((c, i) => [c.id, i]));
  const clipById = new Map(clips.map((c) => [c.id, c]));

  const container = $('users');
  container.replaceChildren();
  for (const email of [...byEmail.keys()].sort()) {
    const section = document.createElement('section');
    const h = document.createElement('h2');
    h.textContent = email;
    const ul = document.createElement('ul');
    // Songs in clips.json order; clips no longer in clips.json go last.
    const ids = [...byEmail.get(email).keys()].sort(
      (a, b) => (clipOrder.get(a) ?? Infinity) - (clipOrder.get(b) ?? Infinity),
    );
    for (const id of ids) {
      const clip = clipById.get(id);
      const done = byEmail.get(email).get(id).size;
      const li = document.createElement('li');
      li.textContent = clip
        ? `${clip.title} (${done}/${syllableCount(clip)})`
        : `${id} (${done}/?)`;
      ul.append(li);
    }
    section.append(h, ul);
    container.append(section);
  }

  setStatus(byEmail.size ? '' : 'No responses yet.');
  container.hidden = false;
}

// Copies clips.json clips missing from the Firestore clips collection, keyed by clip id.
// `order` keeps clips.json's ordering, since Firestore doesn't preserve one.
async function importClips() {
  const [clips, snap] = await Promise.all([loadClipList(), getDocs(collection(db, 'clips'))]);
  const existing = new Set(snap.docs.map((d) => d.id));
  const missing = clips.map((c, order) => ({ ...c, order })).filter((c) => !existing.has(c.id));
  // A batch holds at most 500 writes.
  for (let i = 0; i < missing.length; i += 500) {
    const batch = writeBatch(db);
    for (const c of missing.slice(i, i + 500)) batch.set(doc(db, 'clips', c.id), c);
    await batch.commit();
  }
  return { added: missing.length, skipped: clips.length - missing.length };
}

$('import-clips').addEventListener('click', async () => {
  $('import-clips').disabled = true;
  $('import-status').textContent = 'Importing…';
  try {
    const { added, skipped } = await importClips();
    $('import-status').textContent = `Added ${added} clips; ${skipped} were already in Firestore.`;
  } catch (err) {
    $('import-status').textContent = err.message;
  } finally {
    $('import-clips').disabled = false;
  }
});

$('sign-in').addEventListener('click', () => {
  signInWithPopup(auth, new GoogleAuthProvider()).catch((err) => alert(err.message));
});

$('sign-out').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (u) => {
  $('users').hidden = true;
  $('users').replaceChildren();
  $('import').hidden = true;
  $('import-status').textContent = '';
  $('signed-out').hidden = !!u;
  $('account').hidden = !u;
  if (!u) { setStatus(''); return; }
  $('who').textContent = `Logged in as ${u.email}`;
  if (u.uid !== ADMIN_UID) { setStatus('Not authorized.'); return; }
  $('import').hidden = false;
  try {
    await render();
  } catch (err) {
    setStatus(err.message);
  }
});
