"""Renders one full-verse page (out/verses/<id>.html) and the index linking them. Called from
verses.py; standard library only."""

import html
import json
from pathlib import Path


def write(path, data):
    page = TEMPLATE.replace("/*DATA*/", json.dumps(data, separators=(",", ":")).replace("</", "<\\/"))
    Path(path).write_text(page.replace("<!--TITLE-->", html.escape(data["title"])))


def fmt_time(ms):
    s = ms / 1000
    return f"{int(s // 60)}:{s % 60:04.1f}"


def write_index(path, verses):
    rows = "".join(
        f'<tr><td><a href="{html.escape(v["id"])}.html">{html.escape(v["title"])}</a></td>'
        f'<td>{fmt_time(v["spanMs"][0])}–{fmt_time(v["spanMs"][1])}</td><td>{v["lines"]}</td>'
        f'<td>{v["words"]}</td><td>{v["matched"]:.0%}</td><td>{v["guessed"] or "–"}</td>'
        f'<td>{v["syllables"]}</td><td>{v["jumps"] / max(1, v["syllables"]):.0%}</td>'
        f'<td>{v["unaligned"] or "–"}</td></tr>'
        for v in verses)
    Path(path).write_text(INDEX.replace("<!--ROWS-->", rows))


STYLE = r"""
:root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --border: rgba(11,11,11,0.10);
  --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --wave: #c3c2b7; --word-band: #f0efec;
  --vpr: #d42a3c; --accent: #2a78d6; --warn: #b8690f;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --border: rgba(255,255,255,0.10);
    --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --wave: #4a4a46; --word-band: #242422;
    --vpr: #f0485a; --accent: #3987e5; --warn: #e0973a;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --border: rgba(255,255,255,0.10);
  --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --wave: #4a4a46; --word-band: #242422;
  --vpr: #f0485a; --accent: #3987e5; --warn: #e0973a;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1200px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
.sub { color: var(--ink-2); margin: 0 0 16px; }
a { color: var(--accent); }
"""

TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><!--TITLE--> · VPR</title>
<style>
""" + STYLE + r"""
.bar { position: sticky; top: 0; z-index: 3; background: var(--page); padding: 10px 0;
  border-bottom: 1px solid var(--border); display: flex; flex-wrap: wrap; gap: 8px 18px;
  align-items: center; color: var(--ink-2); }
.bar label, .bar span { display: inline-flex; align-items: center; gap: 6px; }
button { font: inherit; font-size: 13px; color: var(--ink); background: transparent;
  border: 1px solid var(--axis); border-radius: 6px; padding: 2px 10px; cursor: pointer; }
button:hover { background: var(--word-band); }
#play { min-width: 84px; font-weight: 600; }
#time { font-variant-numeric: tabular-nums; color: var(--ink); min-width: 110px; }
.legend { margin-left: auto; display: flex; gap: 14px; flex-wrap: wrap; }
.line { display: grid; grid-template-columns: 64px 1fr; gap: 8px; align-items: start;
  padding: 6px 0; border-bottom: 1px solid var(--grid); }
.line.active { background: linear-gradient(90deg, transparent, var(--word-band) 8%, var(--word-band) 92%, transparent); }
.gutter { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; padding-top: 24px;
  font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.gutter button { padding: 1px 8px; font-size: 12px; }
.plot svg { display: block; overflow: visible; cursor: pointer; }
.tip { position: fixed; pointer-events: none; z-index: 10; background: var(--surface); color: var(--ink);
  border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12.5px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12); display: none; min-width: 200px;
  font-variant-numeric: tabular-nums; }
.tip .t { font-weight: 600; margin-bottom: 4px; }
.tip .r { display: flex; color: var(--ink-2); }
.tip .r b { margin-left: auto; color: var(--ink); font-weight: 500; padding-left: 12px; }
.tip .st { color: var(--muted); margin-top: 4px; max-width: 320px; }
.note { color: var(--muted); font-size: 12.5px; margin-top: 16px; }
text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (max-width: 600px) { .line { grid-template-columns: 1fr; } .gutter { flex-direction: row; padding-top: 0; } }
</style>
</head>
<body>
<main>
  <p class="sub" style="margin:0 0 4px"><a href="index.html">← All verses</a></p>
  <h1 id="title"></h1>
  <p class="sub" id="sub"></p>
  <div class="bar">
    <button id="play" type="button">▶ Play</button>
    <span id="time"></span>
    <label><input type="checkbox" id="clicks" checked> Clicks</label>
    <label>Click vol <input type="range" id="clickVol" min="0" max="1" step="0.05" value="0.35"></label>
    <label>Music vol <input type="range" id="musicVol" min="0" max="1" step="0.05" value="0.7"></label>
    <label><input type="checkbox" id="follow" checked> Follow</label>
    <div class="legend" id="legend"></div>
  </div>
  <div id="lines"></div>
  <p class="note">Click anywhere on a line to play from there; ▶ next to a line plays just that line;
    space plays / pauses. Each VPR time sounds as a click. VPR takes the halfway point of the steepest
    10 ms loudness jump before MFA’s vowel when that jump is at least <span id="jmin"></span> dB
    (a burst, filled marker); otherwise MFA’s vowel onset moved <span id="shift"></span> ms earlier
    (no clear burst, hollow marker). Words along the top are MFA’s alignment of the lyrics. Each lyric line was first located by
    matching its words to Whisper’s; a line with too few matches was spread over the gap between its
    neighbors instead, and is underlined in orange (MFA had only a guess where to look).</p>
</main>
<div class="tip" id="tip"></div>
<script>
const D = /*DATA*/;
const NS = 'http://www.w3.org/2000/svg';
const LINE_MS = 10000;  // the width of the plot is this much time, so every line has the same scale
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtT = ms => { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const fmtPrecise = ms => { const s = ms / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`; };
function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
// Burst = filled diamond, shift = hollow diamond, so the rule never rests on fill color alone.
function diamond(x, y, rule, parent) {
  return el('path', { d: `M${x},${y - 6} L${x + 5},${y} L${x},${y + 6} L${x - 5},${y}Z`,
    fill: rule === 'jump' ? 'var(--vpr)' : 'var(--surface)', stroke: 'var(--vpr)', 'stroke-width': 1.5 }, parent);
}
function swatch(rule) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('width', 14); s.setAttribute('height', 16);
  diamond(7, 8, rule, s);
  return s;
}

document.getElementById('title').textContent = D.title;
const nSkipped = D.unaligned.filter(u => u.skipped).length;
const nJump = D.syllables.filter(s => s.rule === 'jump').length;
document.getElementById('sub').textContent =
  `${fmtT(D.spanStartMs)}–${fmtT(D.spanEndMs)} of ${fmtT(D.durationMs)} · ${D.words.length} words · ${D.syllables.length} VPR clicks ` +
  `(${nJump} burst, ${D.syllables.length - nJump} shifted vowel onset) · lyrics → MFA · ` +
  `${Math.round(100 * D.matchedWords / D.lyricWords)}% of lyric words found by Whisper ${D.whisperModel || '?'}` +
  (D.guessed.length ? ` · ${D.guessed.length} of ${D.lyricLines} lyric lines placed by guess` : '') +
  (nSkipped ? ` · ${nSkipped} loud stretches with no lyrics` : '') +
  (D.unaligned.length - nSkipped ? ` · ${D.unaligned.length - nSkipped} lyric lines MFA could not align` : '');
document.getElementById('jmin').textContent = D.jumpMinDb;
document.getElementById('shift').textContent = D.shiftMs;
const legend = document.getElementById('legend');
for (const [rule, label] of [['jump', 'VPR: burst'], ['shift', 'VPR: shifted vowel onset']]) {
  const s = document.createElement('span'); s.append(swatch(rule), label); legend.append(s);
}
if (D.guessed.length) {
  const s = document.createElement('span');
  s.innerHTML = '<svg width="22" height="14"><rect x="1" y="5" width="20" height="3" fill="var(--warn)"/></svg>Line placed by guess';
  legend.append(s);
}
if (D.unaligned.length) {
  const s = document.createElement('span');
  s.innerHTML = '<svg width="22" height="14"><rect x="1" y="2" width="20" height="10" rx="2" fill="none" stroke="var(--warn)" stroke-dasharray="3 2"/></svg>No words (no lyrics, or not aligned)';
  legend.append(s);
}

const tip = document.getElementById('tip');
function showTip(ev, s) {
  const w = D.words[s.w];
  const which = s.of > 1 ? ` · syllable ${s.syl + 1} of ${s.of}` : '';
  const delta = s.vpr - s.vowel;
  tip.innerHTML = `<div class="t">“${esc(w.w)}”${which}</div>
    <div class="r">VPR<b>${fmtPrecise(s.vpr)}</b></div>
    <div class="r">MFA vowel onset<b>${fmtPrecise(s.vowel)}</b></div>
    <div class="r">VPR − vowel<b>${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(Math.round(delta))} ms</b></div>
    <div class="st">${s.rule === 'jump' ? 'Burst' : 'No clear burst, vowel onset shifted'} · steepest jump ${s.jump.toFixed(1)} dB</div>`;
  tip.style.display = 'block';
  const pad = 14, r = tip.getBoundingClientRect();
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
  tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${Math.max(8, y)}px`;
}
const hideTip = () => { tip.style.display = 'none'; };

// ---- Lines ----
const H = 128, WORD_Y = 2, WORD_H = 18, WAVE_TOP = 28, WAVE_BOT = 104, AXIS_Y = 108;
const linesEl = document.getElementById('lines');
const rows = D.lines.map(([s, e], i) => {
  const row = document.createElement('div');
  row.className = 'line';
  row.innerHTML = `<div class="gutter"><span>${fmtT(s)}</span><button type="button" title="Play this line">▶</button></div><div class="plot"></div>`;
  linesEl.append(row);
  const r = { i, s, e, row, plot: row.querySelector('.plot'), x: null, playhead: null };
  row.querySelector('button').addEventListener('click', () => {
    if (playing && playing.line === r) pause(); else playFrom(s, e, r);
  });
  return r;
});
const maxPeak = Math.max(1, ...D.peaks.map(([lo, hi]) => Math.max(-lo, hi)));

function drawLine(r) {
  r.plot.innerHTML = '';
  const full = Math.max(r.plot.clientWidth, 280);
  const pxPerMs = full / LINE_MS;
  const W = (r.e - r.s) * pxPerMs;
  const x = ms => (ms - r.s) * pxPerMs;
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': `${fmtT(r.s)} to ${fmtT(r.e)}` });
  r.plot.appendChild(svg);

  // Seconds grid.
  const every = full < 600 ? 2000 : 1000;
  for (let t = Math.ceil(r.s / every) * every; t <= r.e; t += every) {
    el('line', { x1: x(t), x2: x(t), y1: WAVE_TOP, y2: AXIS_Y, stroke: 'var(--grid)' }, svg);
    const lab = el('text', { x: x(t), y: AXIS_Y + 12, 'text-anchor': 'middle', 'font-size': 10.5, fill: 'var(--muted)' }, svg);
    lab.textContent = fmtT(t).replace(/\.0$/, '');
  }

  // Words along the top.
  for (const w of D.words) {
    if (w.e <= r.s || w.s >= r.e) continue;
    const x0 = x(Math.max(w.s, r.s)), x1 = x(Math.min(w.e, r.e));
    el('rect', { x: x0 + 0.5, y: WORD_Y, width: Math.max(1, x1 - x0 - 1), height: WORD_H, rx: 3,
      fill: 'var(--word-band)', stroke: 'var(--axis)' }, svg);
    const t = el('text', { x: (x0 + x1) / 2, y: WORD_Y + 13, 'text-anchor': 'middle', 'font-size': 11.5, fill: 'var(--ink-2)' }, svg);
    t.textContent = w.w;
    // Shrink or drop labels that don't fit their word's box.
    const tw = t.getComputedTextLength();
    if (tw > x1 - x0 - 2) {
      if (x1 - x0 < 12) t.remove();
      else { t.setAttribute('textLength', x1 - x0 - 3); t.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
    }
  }
  for (const u of D.unaligned) {
    if (u.e <= r.s || u.s >= r.e) continue;
    const x0 = x(Math.max(u.s, r.s)), x1 = x(Math.min(u.e, r.e));
    el('rect', { x: x0 + 0.5, y: WORD_Y, width: Math.max(1, x1 - x0 - 1), height: WORD_H, rx: 3,
      fill: 'none', stroke: 'var(--warn)', 'stroke-dasharray': '3 2' }, svg);
    const t = el('text', { x: x0 + 4, y: WORD_Y + 13, 'font-size': 11, 'font-style': 'italic', fill: 'var(--warn)' }, svg);
    t.textContent = u.text;
    const avail = x1 - x0 - 8;
    if (t.getComputedTextLength() > avail) { t.setAttribute('textLength', Math.max(avail, 1)); t.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
    const title = el('title', {}, t);
    title.textContent = u.skipped ? 'Loud, but no lyric words here (a hook or ad-libs?), so no VPR clicks' : `MFA did not align the lyric line “${u.text}”`;
  }
  for (const g of D.guessed) {
    if (g.e <= r.s || g.s >= r.e) continue;
    const x0 = x(Math.max(g.s, r.s)), x1 = x(Math.min(g.e, r.e));
    const bar = el('rect', { x: x0, y: WORD_Y + WORD_H + 2, width: Math.max(1, x1 - x0), height: 3, fill: 'var(--warn)' }, svg);
    el('title', {}, bar).textContent = `Whisper didn't find “${g.text}”, so this span is a guess`;
  }

  // Waveform as a min/max envelope.
  const mid = (WAVE_TOP + WAVE_BOT) / 2, amp = (WAVE_BOT - WAVE_TOP) / 2 / maxPeak;
  const b0 = Math.floor(r.s * D.peaksPerS / 1000), b1 = Math.min(D.peaks.length, Math.ceil(r.e * D.peaksPerS / 1000));
  let top = '', bot = '';
  for (let b = b0; b < b1; b++) {
    const px = x(b * 1000 / D.peaksPerS).toFixed(1), [lo, hi] = D.peaks[b];
    top += `${b === b0 ? 'M' : 'L'}${px},${(mid - hi * amp).toFixed(1)}`;
    bot = `L${px},${(mid - lo * amp).toFixed(1)}` + bot;
  }
  if (top) el('path', { d: top + bot + 'Z', fill: 'var(--wave)' }, svg);
  el('line', { x1: 0, x2: W, y1: mid, y2: mid, stroke: 'var(--axis)' }, svg);

  // Background hit area: click to play from that time.
  const bg = el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' }, svg);
  bg.addEventListener('click', ev => {
    const box = svg.getBoundingClientRect();
    playFrom(r.s + (ev.clientX - box.left) / pxPerMs, null, null);
  });
  svg.insertBefore(bg, svg.firstChild);

  // VPR markers.
  for (const s of D.syllables) {
    if (s.vpr < r.s || s.vpr >= r.e) continue;
    const px = x(s.vpr);
    const g = el('g', {}, svg);
    el('line', { x1: px, x2: px, y1: WAVE_TOP - 4, y2: WAVE_BOT, stroke: 'var(--vpr)', 'stroke-width': 1.5,
      'stroke-dasharray': s.rule === 'jump' ? '' : '3 2' }, g);
    diamond(px, WAVE_BOT - 4, s.rule, g);
    const hit = el('rect', { x: px - 5, y: WAVE_TOP - 6, width: 10, height: WAVE_BOT - WAVE_TOP + 12, fill: 'transparent' }, g);
    hit.addEventListener('mousemove', ev => showTip(ev, s));
    hit.addEventListener('mouseleave', hideTip);
    hit.addEventListener('click', ev => { ev.stopPropagation(); playFrom(Math.max(0, s.vpr - 600), null, null); });
  }

  r.x = x;
  r.playhead = el('line', { y1: 0, y2: AXIS_Y, stroke: 'var(--ink)', 'stroke-width': 1.5, opacity: 0, 'pointer-events': 'none' }, svg);
}
const drawAll = () => { rows.forEach(drawLine); showPosition(position); };

// ---- Playback: Web Audio, with every VPR click scheduled sample-accurately. ----
const CLICK_HZ = 2000;  // the same tone burst as the clicking UI (app.js)
let actx = null, clickBuf = null, musicBuf = null, musicGain, clickGain;
let playing = null;  // { sources, t0, from, to, line }
let position = D.spanStartMs;  // ms; where playback resumes
let activeRow = null;
const playBtn = document.getElementById('play'), timeEl = document.getElementById('time');
const clicksBox = document.getElementById('clicks'), clickVol = document.getElementById('clickVol');
const musicVol = document.getElementById('musicVol'), follow = document.getElementById('follow');

function audioCtx() {
  if (actx) return actx;
  actx = new AudioContext();
  const sr = actx.sampleRate, length = Math.round(sr * 0.04), DRIVE = 4;
  clickBuf = actx.createBuffer(1, length, sr);
  const d = clickBuf.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / sr;
    d[i] = Math.tanh(DRIVE * Math.sin(2 * Math.PI * CLICK_HZ * t) * Math.exp(-t / 0.01)) / Math.tanh(DRIVE);
  }
  musicGain = actx.createGain(); musicGain.connect(actx.destination);
  clickGain = actx.createGain(); clickGain.connect(actx.destination);
  setGains();
  return actx;
}
function setGains() {
  if (!actx) return;
  musicGain.gain.value = +musicVol.value;
  clickGain.gain.value = clicksBox.checked ? +clickVol.value : 0;
}
[clicksBox, clickVol, musicVol].forEach(i => i.addEventListener('input', setGains));

let loading = null;
async function loadMusic() {
  if (musicBuf) return musicBuf;
  loading = loading || fetch(D.audio).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
  }).then(b => actx.decodeAudioData(b));
  try { musicBuf = await loading; } catch (e) { loading = null; throw e; }
  return musicBuf;
}

async function playFrom(from, to, line) {
  stopSources();
  audioCtx().resume();
  from = Math.max(D.spanStartMs, Math.min(from, D.spanEndMs - 1));
  to = to == null ? D.spanEndMs : to;
  position = from;
  showPosition(position);
  playBtn.textContent = 'Loading…';
  let buf;
  try { buf = await loadMusic(); }
  catch (e) { playBtn.textContent = 'Audio unavailable'; console.error(D.audio, e); return; }
  stopSources();  // a second click may have started playback while the audio was loading
  const t0 = actx.currentTime + 0.05;
  const music = actx.createBufferSource();
  music.buffer = buf; music.connect(musicGain);
  music.start(t0, from / 1000, (to - from) / 1000);
  const sources = [music];
  for (const s of D.syllables) {
    if (s.vpr < from || s.vpr >= to) continue;
    const c = actx.createBufferSource();
    c.buffer = clickBuf; c.connect(clickGain);
    c.start(t0 + (s.vpr - from) / 1000);
    sources.push(c);
  }
  playing = { sources, t0, from, to, line };
  playBtn.textContent = '❚❚ Pause';
  requestAnimationFrame(tick);
}
function stopSources() {
  if (!playing) return;
  playing.sources.forEach(s => { try { s.stop(); } catch {} });
  playing = null;
  playBtn.textContent = '▶ Play';
}
function nowMs() {
  // What's audible now, compensating for output latency.
  return playing.from + (actx.currentTime - (actx.outputLatency || 0) - playing.t0) * 1000;
}
function pause() {
  if (!playing) return;
  position = Math.max(playing.from, Math.min(nowMs(), playing.to));
  stopSources();
  showPosition(position);
}
function tick() {
  if (!playing) return;
  const t = nowMs();
  if (t >= playing.to) {
    position = playing.line ? playing.line.s : (playing.to >= D.spanEndMs ? D.spanStartMs : playing.to);
    stopSources(); showPosition(position); return;
  }
  showPosition(Math.max(playing.from, t));
  requestAnimationFrame(tick);
}
function showPosition(ms) {
  timeEl.textContent = `${fmtT(ms)} / ${fmtT(D.durationMs)}`;
  const r = rows.find(r => ms >= r.s && ms < r.e) || rows[rows.length - 1];
  if (r !== activeRow) {
    if (activeRow) { activeRow.row.classList.remove('active'); activeRow.playhead?.setAttribute('opacity', 0); }
    activeRow = r;
    r.row.classList.add('active');
    if (playing && follow.checked) {
      const box = r.row.getBoundingClientRect();
      if (box.top < 60 || box.bottom > innerHeight) r.row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  if (r.x) {
    const px = r.x(ms);
    r.playhead.setAttribute('x1', px); r.playhead.setAttribute('x2', px);
    r.playhead.setAttribute('opacity', playing ? 1 : 0.4);
  }
}

playBtn.addEventListener('click', () => playing ? pause() : playFrom(position, null, null));
document.addEventListener('keydown', ev => {
  if (ev.code !== 'Space' || ev.target.closest('input, button')) return;
  ev.preventDefault();
  playing ? pause() : playFrom(position, null, null);
});

requestAnimationFrame(drawAll);
let rt, lastW = 0;
new ResizeObserver(() => {
  if (linesEl.clientWidth === lastW) return;
  lastW = linesEl.clientWidth;
  clearTimeout(rt); rt = setTimeout(drawAll, 80);
}).observe(linesEl);
</script>
</body>
</html>
"""

INDEX = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Full Verses · VPR</title>
<style>
""" + STYLE + r"""
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; font-size: 13px; }
th, td { padding: 8px 12px; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--grid); }
th { color: var(--ink-2); font-weight: 500; }
th:first-child, td:first-child { text-align: left; }
tr:last-child td { border-bottom: 0; }
</style>
</head>
<body>
<main>
  <h1>Full verses: VPR clicks</h1>
  <p class="sub">Lyrics (full_verses/*.txt, located with Whisper) → MFA → VPR. No ground truth; open a verse to check the clicks by ear.</p>
  <div class="table-wrap"><table>
    <thead><tr><th>Verse</th><th>Lyrics span</th><th>Lines</th><th>Words aligned</th><th>Lyric words found by Whisper</th><th>Lines guessed</th><th>VPR clicks</th><th>Burst rule</th><th>Stretches without words</th></tr></thead>
    <tbody><!--ROWS--></tbody>
  </table></div>
</main>
</body>
</html>
"""
