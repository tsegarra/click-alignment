// Admin page: for every email that has submitted responses, the songs they've aligned
// and how many of each song's syllables they've done; an editor for each clip's words and
// syllable counts; an import of new clips from clips.json; an update of existing clips' words from
// clips.json; and a one-time action that excludes the
// hand-made clips (those with no source) from analysis.
// Only ADMIN_UID can read other users' responses or write clips; the Firestore rules enforce that.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, query, orderBy, getDocs, doc, updateDoc, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from '../firebase-config.js';

const ADMIN_UID = 'jW5a1syKlVamPYlVyuZxAA6gmjp1';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);

let clips = [];      // Firestore's clips collection, in the app's order
let responses = [];  // every user's response docs' data
let draft = null;    // the edited clip's words, as edited so far

function setStatus(text) {
  $('status').textContent = text;
  $('status').hidden = !text;
}

const syllableCount = (clip) => clip.words.reduce((n, w) => n + w.syllables, 0);

async function loadClipList() {
  const snap = await getDocs(query(collection(db, 'clips'), orderBy('order')));
  return snap.docs.map((d) => d.data());
}

async function render() {
  setStatus('Loading…');
  const [list, snap] = await Promise.all([loadClipList(), getDocs(collection(db, 'responses'))]);
  clips = list;
  responses = snap.docs.map((d) => d.data());
  renderUsers();
  renderClipMenu();
  setStatus(responses.length ? '' : 'No responses yet.');
}

function renderUsers() {
  // email -> clip id -> Set of aligned syllable indices
  const byEmail = new Map();
  for (const { email, clipId, syllableIndex } of responses) {
    if (excluded.has(clipId)) continue;
    const key = email ?? '(no email)';
    if (!byEmail.has(key)) byEmail.set(key, new Map());
    const songs = byEmail.get(key);
    if (!songs.has(clipId)) songs.set(clipId, new Set());
    songs.get(clipId).add(syllableIndex);
  }

  const clipOrder = new Map(clips.map((c, i) => [c.id, i]));
  const clipById = new Map(clips.map((c) => [c.id, c]));
  const excluded = new Set(clips.filter((c) => c.excludeFromAnalysis).map((c) => c.id));

  const container = $('users');
  container.replaceChildren();
  for (const email of [...byEmail.keys()].sort()) {
    const section = document.createElement('section');
    const h = document.createElement('h2');
    h.textContent = email;
    const ul = document.createElement('ul');
    // Songs in the app's order; clips no longer in Firestore go last.
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
  container.hidden = false;
}

// ---------- Clip editor ----------

const editedClip = () => clips.find((c) => c.id === $('edit-clip').value);

// The clip menu, keeping the selected clip if it's still there.
function renderClipMenu() {
  const menu = $('edit-clip');
  const selected = menu.value;
  menu.replaceChildren(...clips.map((c) => new Option(c.title, c.id)));
  if (clips.some((c) => c.id === selected)) menu.value = selected;
  $('editor').hidden = !clips.length;
  openClip();
}

function openClip() {
  const clip = editedClip();
  draft = clip ? clip.words.map((w) => ({ ...w })) : null;
  $('edit-status').textContent = '';
  renderWarning();
  renderDraft();
}

// Responses are stored by syllable position, so changing syllable counts moves saved clicks.
function renderWarning() {
  const clip = editedClip();
  const saved = clip ? responses.filter((r) => r.clipId === clip.id) : [];
  const users = new Set(saved.map((r) => r.uid)).size;
  $('edit-warning').hidden = !saved.length;
  $('edit-warning').textContent = `This clip has ${saved.length} saved clicks from ${users} `
    + `${users === 1 ? 'user' : 'users'}. They're stored by syllable position, so changing a word's `
    + 'syllable count, or adding or removing a word, moves the clicks after it onto different syllables.';
}

function renderDraft() {
  const body = $('edit-words');
  body.replaceChildren();
  if (!draft) return;
  draft.forEach((w, i) => {
    const text = document.createElement('input');
    text.value = w.text;
    text.addEventListener('input', () => { w.text = text.value; });

    const syllables = document.createElement('input');
    syllables.type = 'number';
    syllables.min = 1;
    syllables.value = w.syllables;
    syllables.addEventListener('input', () => { w.syllables = syllables.valueAsNumber; });

    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => { draft.splice(i, 1); renderDraft(); });

    const row = document.createElement('tr');
    for (const el of [text, syllables, remove]) {
      const td = document.createElement('td');
      td.append(el);
      row.append(td);
    }
    body.append(row);
  });
}

async function saveClip() {
  const clip = editedClip();
  const words = draft.map((w) => ({ text: w.text.trim(), syllables: w.syllables }));
  if (!words.length) throw new Error('A clip needs at least one word.');
  const bad = words.find((w) => !w.text || !Number.isInteger(w.syllables) || w.syllables < 1);
  if (bad) throw new Error('Every word needs text and a whole number of syllables, at least 1.');

  const counts = (ws) => ws.map((w) => w.syllables).join();
  const hasClicks = responses.some((r) => r.clipId === clip.id);
  if (hasClicks && counts(words) !== counts(clip.words)
      && !confirm('This changes syllable positions in a clip with saved clicks. Save anyway?')) {
    return 'Not saved.';
  }

  await updateDoc(doc(db, 'clips', clip.id), { words });
  clip.words = words;
  renderUsers();
  openClip();
  return 'Saved.';
}

$('edit-clip').addEventListener('change', openClip);

$('add-word').addEventListener('click', () => {
  draft.push({ text: '', syllables: 1 });
  renderDraft();
});

$('save-clip').addEventListener('click', async () => {
  $('save-clip').disabled = true;
  $('edit-status').textContent = 'Saving…';
  try {
    $('edit-status').textContent = await saveClip();
  } catch (err) {
    $('edit-status').textContent = err.message;
  } finally {
    $('save-clip').disabled = false;
  }
});

// ---------- Import ----------

// Copies clips.json clips missing from the Firestore clips collection, keyed by clip id.
// They go after the clips already there, in clips.json's order; `order` holds the app's
// ordering, since Firestore doesn't preserve one.
async function importClips() {
  const res = await fetch('../clips.json');
  if (!res.ok) throw new Error(`Couldn't load clips.json (HTTP ${res.status}).`);
  const staged = (await res.json()).clips;
  const current = await loadClipList(); // fresh, so a clip is never overwritten
  const existing = new Set(current.map((c) => c.id));
  const next = Math.max(-1, ...current.map((c) => c.order)) + 1;
  const missing = staged.filter((c) => !existing.has(c.id)).map((c, k) => ({ ...c, order: next + k }));
  // A batch holds at most 500 writes.
  for (let i = 0; i < missing.length; i += 500) {
    const batch = writeBatch(db);
    for (const c of missing.slice(i, i + 500)) batch.set(doc(db, 'clips', c.id), c);
    await batch.commit();
  }
  return { added: missing.length, skipped: staged.length - missing.length };
}

$('import-clips').addEventListener('click', async () => {
  $('import-clips').disabled = true;
  $('import-status').textContent = 'Importing…';
  try {
    const { added, skipped } = await importClips();
    if (added) await render();
    $('import-status').textContent = `Added ${added} clips; ${skipped} were already in Firestore.`;
  } catch (err) {
    $('import-status').textContent = err.message;
  } finally {
    $('import-clips').disabled = false;
  }
});

// ---------- Update words ----------

// Overwrites the words of Firestore clips whose words differ from clips.json's. Other fields, and
// clips missing from either side, are left alone.
async function updateWords() {
  const res = await fetch('../clips.json');
  if (!res.ok) throw new Error(`Couldn't load clips.json (HTTP ${res.status}).`);
  const staged = new Map((await res.json()).clips.map((c) => [c.id, c]));
  const current = await loadClipList();
  // Compared field by field, since Firestore doesn't keep a map's key order.
  const key = (words) => JSON.stringify(words.map((w) => [w.text, w.syllables]));
  const same = (a, b) => key(a) === key(b);
  const changed = current.filter((c) => staged.has(c.id) && !same(c.words, staged.get(c.id).words));
  if (!changed.length) return [];

  const withClicks = changed.filter((c) => responses.some((r) => r.clipId === c.id));
  if (withClicks.length && !confirm(`${withClicks.length} of these clips have saved clicks, which `
      + 'may move onto different syllables:\n\n'
      + `${withClicks.map((c) => c.title).join('\n')}\n\nUpdate anyway?`)) {
    throw new Error('Not updated.');
  }
  // A batch holds at most 500 writes.
  for (let i = 0; i < changed.length; i += 500) {
    const batch = writeBatch(db);
    for (const c of changed.slice(i, i + 500)) {
      batch.update(doc(db, 'clips', c.id), { words: staged.get(c.id).words });
    }
    await batch.commit();
  }
  return changed;
}

$('update-words').addEventListener('click', async () => {
  $('update-words').disabled = true;
  $('update-status').textContent = 'Updating…';
  try {
    const changed = await updateWords();
    if (changed.length) await render();
    $('update-status').textContent = changed.length
      ? `Updated ${changed.length} clips: ${changed.map((c) => c.title).join('; ')}.`
      : 'Every clip already matches clips.json.';
  } catch (err) {
    $('update-status').textContent = err.message;
  } finally {
    $('update-words').disabled = false;
  }
});

// ---------- Exclude the hand-made clips ----------

// Marks every clip with no source (the hand-made ones) excludeFromAnalysis, so the app and the
// pipeline skip them.
async function excludeHandMade() {
  const current = await loadClipList();
  const todo = current.filter((c) => !c.source && !c.excludeFromAnalysis);
  const batch = writeBatch(db);
  for (const c of todo) batch.update(doc(db, 'clips', c.id), { excludeFromAnalysis: true });
  if (todo.length) await batch.commit();
  return todo.length;
}

$('exclude-hand-made').addEventListener('click', async () => {
  if (!confirm('Exclude every clip with no source from the app and from analysis?')) return;
  $('exclude-hand-made').disabled = true;
  $('exclude-status').textContent = 'Saving…';
  try {
    const n = await excludeHandMade();
    if (n) await render();
    $('exclude-status').textContent = `Excluded ${n} clips.`;
  } catch (err) {
    $('exclude-status').textContent = err.message;
  } finally {
    $('exclude-hand-made').disabled = false;
  }
});

// ---------- Sign-in ----------

$('sign-in').addEventListener('click', () => {
  signInWithPopup(auth, new GoogleAuthProvider()).catch((err) => alert(err.message));
});

$('sign-out').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (u) => {
  $('users').hidden = true;
  $('users').replaceChildren();
  $('editor').hidden = true;
  $('import').hidden = true;
  $('import-status').textContent = '';
  $('update-status').textContent = '';
  $('exclude-status').textContent = '';
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
