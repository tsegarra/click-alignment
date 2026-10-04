"""Renders out/report.html: per-clip waveforms with the click / MFA onset / MFA vowel / VPR
markers, followed by the summary statistics and the VPR-vs-vowel comparison. Called from evaluate.py; standard library only."""

import json
import wave
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PEAK_BINS = 900


def peaks(path):
    """Mono 16-bit wav -> duration in ms and [min, max] per bin, normalized to the clip's peak."""
    with wave.open(str(path)) as w:
        assert w.getsampwidth() == 2, f"{path}: expected 16-bit audio"
        rate, channels = w.getframerate(), w.getnchannels()
        samples = array("h", w.readframes(w.getnframes()))[::channels]
    full = max(1, max(abs(s) for s in samples))
    step = len(samples) / PEAK_BINS
    out = []
    for b in range(PEAK_BINS):
        chunk = samples[int(b * step):max(int((b + 1) * step), int(b * step) + 1)]
        out.append([round(min(chunk) / full, 3), round(max(chunk) / full, 3)])
    return len(samples) / rate * 1000, out


def write(path, rows, clip_info, clips, user_data, summaries, comparison):
    data = {"userData": user_data, "summaries": summaries, "comparison": comparison, "clips": []}
    for c in clip_info:
        clip = clips[c["id"]]
        duration, pk = peaks(ROOT / clip["file"])
        sylls = []
        for r in (r for r in rows if r["clip"] == c["id"]):
            sylls.append({
                "word": r["word"], "syl": r["syllable_in_word"], "of": r["ref_syllables"],
                "click": r["click_ms"], "onset": r.get("mfa_onset_ms"), "vowel": r.get("mfa_vowel_ms"),
                "vpr": r.get("mfa_vpr_ms"), "vprRule": r.get("vpr_rule"),
                "vprJump": r.get("vpr_jump_db"),
                "errOnset": r.get("err_onset_ms"), "errVowel": r.get("err_vowel_ms"),
                "errVpr": r.get("err_vpr_ms"),
                "status": r["status"], "mfaWord": r["mfa_word"],
                "mfaSyl": r["mfa_syllable_in_word"], "mfaOf": r["mfa_syllables"],
            })
        data["clips"].append({
            "id": c["id"], "title": clip["title"], "audio": "../" + clip["file"],
            "lyrics": c["ref"], "whisper": c["whisper"], "wer": c["wer"],
            "refSyllables": c["ref_syllables"], "mfaSyllables": c["mfa_syllables"],
            "durationMs": duration, "peaks": pk, "syllables": sylls,
            "mfaWords": [{"w": w["word"], "s": w["start"] * 1000, "e": w["end"] * 1000}
                         for w in c["mfa"]],
        })
    html = TEMPLATE.replace("/*DATA*/", json.dumps(data).replace("</", "<\\/"))
    Path(path).write_text(html)


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alignment Report</title>
<style>
:root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --border: rgba(11,11,11,0.10);
  --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --wave: #c3c2b7; --word-band: #f0efec;
  --click: #2a78d6; --onset: #eb6834; --vowel: #1baf7a; --vpr: #d42a3c;
  --good: #1a8a5f; --bad: #c4314b;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --border: rgba(255,255,255,0.10);
    --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --wave: #4a4a46; --word-band: #242422;
    --click: #3987e5; --onset: #d95926; --vowel: #199e70; --vpr: #f0485a;
    --good: #3fbf8c; --bad: #f06a80;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --border: rgba(255,255,255,0.10);
  --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --wave: #4a4a46; --word-band: #242422;
  --click: #3987e5; --onset: #d95926; --vowel: #199e70; --vpr: #f0485a;
    --good: #3fbf8c; --bad: #f06a80;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 40px 0 12px; }
.sub { color: var(--ink-2); margin: 0 0 20px; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; color: var(--ink-2);
  position: sticky; top: 0; z-index: 2; background: var(--page); padding: 10px 0;
  border-bottom: 1px solid var(--border); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 14px 16px 10px; margin: 16px 0; }
.card header { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: baseline; }
.card h3 { margin: 0; font-size: 15px; }
.card .stats { color: var(--ink-2); font-size: 13px; font-variant-numeric: tabular-nums; }
.lines { margin: 6px 0 4px; font-size: 13px; color: var(--ink-2); display: grid;
  grid-template-columns: auto 1fr; gap: 0 10px; }
.lines b { color: var(--muted); font-weight: 500; }
.play { margin-left: auto; font: inherit; font-size: 13px; color: var(--ink); background: transparent;
  border: 1px solid var(--axis); border-radius: 6px; padding: 2px 10px; cursor: pointer; }
.play:hover { background: var(--word-band); }
.plot { position: relative; width: 100%; }
.plot svg { display: block; width: 100%; overflow: visible; }
.tip { position: fixed; pointer-events: none; z-index: 10; background: var(--surface); color: var(--ink);
  border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12.5px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12); display: none; min-width: 190px;
  font-variant-numeric: tabular-nums; }
.tip .t { font-weight: 600; margin-bottom: 4px; }
.tip .r { display: flex; align-items: center; gap: 6px; color: var(--ink-2); }
.tip .r b { margin-left: auto; color: var(--ink); font-weight: 500; padding-left: 12px; }
.tip .st { color: var(--muted); margin-top: 4px; }
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; font-size: 13px; }
th, td { padding: 7px 12px; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--grid); }
th { color: var(--ink-2); font-weight: 500; }
th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
tr:last-child td { border-bottom: 0; }
td .sw { margin-right: 6px; vertical-align: -1px; }
.note { color: var(--muted); font-size: 12.5px; margin-top: 8px; }
text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
</style>
</head>
<body>
<main>
  <h1>Whisper → MFA vs. manual clicks</h1>
  <p class="sub" id="sub"></p>
  <div class="legend" id="legend"></div>
  <div id="clips"></div>
  <h2>Summary</h2>
  <div class="table-wrap"><table id="summary"></table></div>
  <p class="note">Error = MFA time − click time; positive means MFA is later than the click.
    “After bias removed” subtracts the mean error of that row, measured on the same syllables.
    “Vowel onset, minus its mean bias” is a reference for VPR: MFA’s vowel onset moved earlier by a
    constant, where each syllable’s shift is the mean vowel error of all the other scored syllables.</p>
  <h2>VPR vs. MFA vowel onset</h2>
  <p class="sub" id="cmp-sub"></p>
  <div class="table-wrap"><table id="compare"></table></div>
  <p class="note">VPR takes the halfway point of the steepest 10 ms loudness jump before the vowel
    when that jump is at least 15 dB (a burst), and otherwise MFA’s vowel onset moved 21 ms earlier.
    Each syllable’s |err| under VPR is compared with its |err| under the baseline. Changes within
    ±5 ms count as unchanged (MFA works in 10 ms frames). “Change” columns are VPR − baseline, so
    negative means VPR is closer to the click. The 21 ms was measured on these same clicks, so the
    shifted rows here are in-sample; the holdout data is the real test.</p>
  <h2>Per clip</h2>
  <div class="table-wrap"><table id="perclip"></table></div>
</main>
<div class="tip" id="tip"></div>
<script>
const DATA = /*DATA*/;
const MARKERS = [
  { key: 'click', label: 'Manual click', err: null },
  { key: 'onset', label: 'MFA syllable onset', err: 'errOnset' },
  { key: 'vowel', label: 'MFA vowel onset', err: 'errVowel' },
  { key: 'vpr', label: 'Vowel Plus Rules (VPR)', err: 'errVpr' },
];
const DASH = { click: '', onset: '4 3', vowel: '1.5 2.5', vpr: '7 2 1.5 2' };
const NS = 'http://www.w3.org/2000/svg';
const fmtMs = v => v == null ? '–' : `${Math.round(v)} ms`;
const fmtErr = v => v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))} ms`;
const pct = v => `${Math.round(v * 100)}%`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// Each marker kind has its own glyph, so identity never rests on color alone.
function glyph(kind, x, y, parent, extra = {}) {
  const color = `var(--${kind})`;
  if (kind === 'click') return el('path', { d: `M${x - 5},${y - 7} L${x + 5},${y - 7} L${x},${y}Z`, fill: color, ...extra }, parent);
  if (kind === 'onset') return el('rect', { x: x - 4, y: y - 4, width: 8, height: 8, fill: color, ...extra }, parent);
  if (kind === 'vpr') return el('path', { d: `M${x},${y - 6} L${x + 5},${y} L${x},${y + 6} L${x - 5},${y}Z`, fill: color, ...extra }, parent);
  return el('circle', { cx: x, cy: y, r: 4.5, fill: color, ...extra }, parent);
}

function swatch(kind) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('width', 26); s.setAttribute('height', 16); s.setAttribute('class', 'sw');
  el('line', { x1: 13, x2: 13, y1: 1, y2: 15, stroke: `var(--${kind})`, 'stroke-width': 2, 'stroke-dasharray': DASH[kind] }, s);
  glyph(kind, 13, kind === 'click' ? 8 : 8, s);
  return s;
}

document.getElementById('sub').textContent =
  `${DATA.clips.length} clips · manual data ${DATA.userData} · hover a syllable for its times`;
const legend = document.getElementById('legend');
for (const m of MARKERS) {
  const span = document.createElement('span');
  span.append(swatch(m.key), m.label);
  legend.append(span);
}
const wordKey = document.createElement('span');
wordKey.innerHTML = '<svg width="26" height="16" class="sw"><rect x="1" y="3" width="24" height="10" rx="2" fill="var(--word-band)" stroke="var(--axis)"/></svg>Whisper word (MFA span)';
legend.append(wordKey);

const tip = document.getElementById('tip');
function showTip(ev, s) {
  const rows = MARKERS.map(m => {
    const v = s[m.key];
    const err = m.err ? ` <span style="color:var(--muted)">(${fmtErr(s[m.err])})</span>` : '';
    return `<div class="r">${swatch(m.key).outerHTML}${m.label}<b>${fmtMs(v)}${v == null ? '' : err}</b></div>`;
  }).join('');
  const which = s.of > 1 ? ` · syllable ${s.syl + 1} of ${s.of}` : '';
  const mfa = s.mfaWord
    ? `paired with “${esc(s.mfaWord)}”${s.mfaOf > 1 ? `, syllable ${s.mfaSyl + 1} of ${s.mfaOf}` : ''}`
    : 'no MFA syllable at this position';
  const rule = s.vprRule
    ? `<div class="st">VPR: ${s.vprRule === 'jump' ? 'burst' : 'no clear burst, vowel onset shifted'} · steepest jump ${s.vprJump.toFixed(1)} dB</div>`
    : '';
  tip.innerHTML = `<div class="t">“${esc(s.word)}”${which}</div>${rows}<div class="st">${mfa}</div>${rule}`;
  tip.style.display = 'block';
  const pad = 14, r = tip.getBoundingClientRect();
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
  tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${Math.max(8, y)}px`;
}
const hideTip = () => { tip.style.display = 'none'; };

const H = 230, TOP = 28, WAVE_TOP = 44, WAVE_BOT = 168, AXIS_Y = 172, LYRIC_Y = 206;

function drawClip(c, plot) {
  plot.innerHTML = '';
  const W = Math.max(plot.clientWidth, 320);
  const L = 4, R = W - 4;
  const x = ms => L + (ms / c.durationMs) * (R - L);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img',
    'aria-label': `Waveform of ${c.title} with ${c.syllables.length} syllable markers` });
  plot.appendChild(svg);

  // Whisper/MFA word spans along the top.
  for (const w of c.mfaWords) {
    const x0 = x(w.s), x1 = x(w.e);
    el('rect', { x: x0 + 1, y: 4, width: Math.max(1, x1 - x0 - 2), height: 18, rx: 3,
      fill: 'var(--word-band)', stroke: 'var(--axis)', 'stroke-width': 1 }, svg);
    if (x1 - x0 > 14) {
      const t = el('text', { x: (x0 + x1) / 2, y: 17, 'text-anchor': 'middle', 'font-size': 11.5, fill: 'var(--ink-2)' }, svg);
      t.textContent = w.w;
    }
  }

  // Time grid and axis.
  const mid = (WAVE_TOP + WAVE_BOT) / 2, amp = (WAVE_BOT - WAVE_TOP) / 2;
  const tickEvery = W < 600 ? 500 : 250;
  for (let t = 0; t <= c.durationMs; t += tickEvery) {
    el('line', { x1: x(t), x2: x(t), y1: WAVE_TOP - 4, y2: AXIS_Y, stroke: 'var(--grid)', 'stroke-width': 1 }, svg);
    if (t % 500 === 0) {
      const lab = el('text', { x: x(t), y: AXIS_Y + 12, 'text-anchor': t === 0 ? 'start' : 'middle', 'font-size': 10.5, fill: 'var(--muted)' }, svg);
      lab.textContent = t === 0 ? '0 s' : `${(t / 1000).toFixed(1)}`;
    }
  }
  el('line', { x1: L, x2: R, y1: mid, y2: mid, stroke: 'var(--axis)', 'stroke-width': 1 }, svg);

  // Waveform as a min/max envelope.
  const n = c.peaks.length;
  let top = '', bot = '';
  c.peaks.forEach(([lo, hi], i) => {
    const px = L + (i / (n - 1)) * (R - L);
    top += `${i ? 'L' : 'M'}${px.toFixed(1)},${(mid - hi * amp).toFixed(1)}`;
    bot = `L${px.toFixed(1)},${(mid - lo * amp).toFixed(1)}` + bot;
  });
  el('path', { d: top + bot + 'Z', fill: 'var(--wave)' }, svg);

  const playhead = el('line', { y1: WAVE_TOP - 4, y2: AXIS_Y, stroke: 'var(--ink)', 'stroke-width': 1, opacity: 0 }, svg);

  // Markers: one group per syllable so hover highlights the trio together.
  const groups = [];
  c.syllables.forEach(s => {
    const g = el('g', {}, svg);
    const xs = MARKERS.filter(m => s[m.key] != null).map(m => x(s[m.key]));
    // A bracket joining the syllable's markers shows which belong together.
    if (xs.length > 1) el('line', { x1: Math.min(...xs), x2: Math.max(...xs), y1: WAVE_BOT + 1, y2: WAVE_BOT + 1,
      stroke: 'var(--muted)', 'stroke-width': 1.5 }, g);
    for (const m of MARKERS) {
      if (s[m.key] == null) continue;
      const px = x(s[m.key]);
      el('line', { x1: px, x2: px, y1: WAVE_TOP - 6, y2: WAVE_BOT, stroke: `var(--${m.key})`,
        'stroke-width': 2, 'stroke-dasharray': DASH[m.key] }, g);
      const gy = { click: WAVE_TOP - 4, onset: WAVE_TOP + 2, vowel: WAVE_BOT - 2, vpr: WAVE_BOT - 16 }[m.key];
      glyph(m.key, px, gy, g, { stroke: 'var(--surface)', 'stroke-width': 1.5 });
    }
    // Hit target: wider than the marks, spanning the trio.
    const hx0 = Math.min(...xs) - 8, hx1 = Math.max(...xs) + 8;
    const hit = el('rect', { x: hx0, y: WAVE_TOP - 12, width: hx1 - hx0, height: H - WAVE_TOP + 12, fill: 'transparent' }, g);
    hit.style.cursor = 'default';
    hit.addEventListener('mousemove', ev => { focus(g); showTip(ev, s); });
    hit.addEventListener('mouseleave', () => { focus(null); hideTip(); });
    groups.push(g);
  });
  function focus(active) {
    for (const g of groups) g.setAttribute('opacity', !active || g === active ? 1 : 0.25);
  }

  // Lyric syllables under their clicks: the word on its first syllable, "2/3" etc. on the rest,
  // packed into as few rows as avoid overlaps.
  const rowEnds = [];
  c.syllables.forEach(s => {
    const px = x(s.click);
    const first = s.syl === 0;
    const t = el('text', { x: px, y: LYRIC_Y, 'text-anchor': 'middle', 'font-size': first ? 11.5 : 10.5,
      fill: first ? (s.status === 'same_word' ? 'var(--ink)' : 'var(--ink-2)') : 'var(--muted)',
      'font-style': s.status === 'same_word' ? 'normal' : 'italic' }, svg);
    t.textContent = first ? s.word : `${s.syl + 1}/${s.of}`;
    const bb = t.getBBox();
    let row = rowEnds.findIndex(end => bb.x > end + 4);
    if (row < 0) { row = rowEnds.length; rowEnds.push(0); }
    rowEnds[row] = bb.x + bb.width;
    t.setAttribute('y', LYRIC_Y + row * 14);
    el('line', { x1: px, x2: px, y1: AXIS_Y + 18, y2: LYRIC_Y - 11, stroke: 'var(--axis)', 'stroke-width': 1 }, svg);
  });
  svg.setAttribute('height', LYRIC_Y + rowEnds.length * 14);
  svg.setAttribute('viewBox', `0 0 ${W} ${LYRIC_Y + rowEnds.length * 14}`);
  return { x, playhead };
}

// Playback: the clip through Web Audio with a click at each VPR time, so the clicks are
// sample-accurate. The click is the same tone burst as the clicking UI (app.js).
const MUSIC_GAIN = 0.7, CLICK_GAIN = 0.35, CLICK_HZ = 2000, LEAD_IN_S = 0.1;
let actx = null, clickBuf = null;
const buffers = new Map();
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
  return actx;
}
async function loadBuffer(url) {
  if (!buffers.has(url)) {
    buffers.set(url, fetch(url).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    }).then(b => actx.decodeAudioData(b)).catch(e => { buffers.delete(url); throw e; }));
  }
  return buffers.get(url);
}
function startSource(buffer, gainValue, when) {
  const src = actx.createBufferSource();
  src.buffer = buffer;
  const g = actx.createGain();
  g.gain.value = gainValue;
  src.connect(g).connect(actx.destination);
  src.start(when);
  return src;
}

const clipsEl = document.getElementById('clips');
const renders = [];
let playing = null;
for (const c of DATA.clips) {
  const card = document.createElement('section');
  card.className = 'card';
  const scored = c.syllables.filter(s => s.errVowel != null);
  const med = arr => { const a = [...arr].sort((p, q) => p - q); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const statLine = scored.length
    ? `median |err| VPR ${Math.round(med(scored.map(s => Math.abs(s.errVpr))))} ms · vowel ${Math.round(med(scored.map(s => Math.abs(s.errVowel))))} ms · onset ${Math.round(med(scored.map(s => Math.abs(s.errOnset))))} ms · ${c.refSyllables === c.mfaSyllables ? `${c.refSyllables} syllables on both sides` : `⚠ ${c.refSyllables} lyric vs ${c.mfaSyllables} MFA syllables`} · WER ${pct(c.wer)}`
    : 'not aligned';
  card.innerHTML = `<header><h3>${esc(c.title)}</h3><span class="stats">${statLine}</span>
    <button class="play" type="button" title="Plays the clip with a click at each VPR time">▶ Play</button></header>
    <div class="lines"><b>lyrics</b><span>${esc(c.lyrics)}</span><b>whisper</b><span>${esc(c.whisper)}</span></div>
    <div class="plot"></div>`;
  clipsEl.append(card);
  const plot = card.querySelector('.plot');
  const entry = { c, plot, r: null };
  renders.push(entry);

  const btn = card.querySelector('.play');
  let sources = [], t0 = 0, endAt = 0;
  btn.addEventListener('click', async () => {
    if (playing && playing.stop !== stop) playing.stop();
    if (sources.length) { stop(); return; }
    audioCtx().resume();
    let buffer;
    try { buffer = await loadBuffer(c.audio); }
    catch (e) { btn.textContent = 'Audio unavailable'; console.error(c.audio, e); return; }
    // The lead-in leaves room for VPR times slightly before the clip begins.
    t0 = actx.currentTime + 0.05 + LEAD_IN_S;
    endAt = t0 + buffer.duration;
    sources = [startSource(buffer, MUSIC_GAIN, t0)];
    for (const s of c.syllables) {
      if (s.vpr != null) sources.push(startSource(clickBuf, CLICK_GAIN, Math.max(t0 + s.vpr / 1000, actx.currentTime)));
    }
    btn.textContent = '■ Stop';
    playing = { stop };
    const tick = () => {
      if (!sources.length) return;
      // What's audible now, compensating for output latency.
      const t = actx.currentTime - (actx.outputLatency || 0) - t0;
      if (actx.currentTime >= endAt + 0.1) { stop(); return; }
      const px = entry.r.x(Math.max(0, t) * 1000);
      entry.r.playhead.setAttribute('x1', px); entry.r.playhead.setAttribute('x2', px);
      entry.r.playhead.setAttribute('opacity', t >= 0 ? 1 : 0);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  function stop() {
    sources.forEach(s => { try { s.stop(); } catch {} });
    sources = [];
    btn.textContent = '▶ Play';
    entry.r.playhead.setAttribute('opacity', 0);
    if (playing && playing.stop === stop) playing = null;
  }
}
const drawAll = () => renders.forEach(e => { e.r = drawClip(e.c, e.plot); });
requestAnimationFrame(drawAll);
let rt;
new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(drawAll, 80); }).observe(clipsEl);

// Summary tables.
function summaryRow(cells) { return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`; }
const head = ['Syllables', 'MFA anchor', 'n', 'Bias', 'Median |err|', 'Mean |err|', 'Mean |err|, bias removed', 'RMSE', '≤ 25 ms', '≤ 50 ms', '≤ 100 ms'];
let html = `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>`;
for (const s of DATA.summaries) {
  const sw = swatch(s.anchor === 'vowel_shift' ? 'vowel' : s.anchor).outerHTML;
  const m = s.stats;
  html += summaryRow([esc(s.subset), `${sw}${{ onset: 'Syllable onset', vowel: 'Vowel onset', vpr: 'VPR', vowel_shift: 'Vowel onset, minus its mean bias' }[s.anchor]}`, m.n,
    fmtErr(m.bias), fmtMs(m.median_ae), fmtMs(m.mae), fmtMs(m.mae_debiased), fmtMs(m.rmse),
    pct(m.within_25), pct(m.within_50), pct(m.within_100)]);
}
document.getElementById('summary').innerHTML = html + '</tbody>';

const ph = ['Clip', 'Whisper', 'Syllables (lyrics / MFA)', 'Scored', 'Bias, VPR', 'Median |err|, VPR', 'Bias, vowel', 'Median |err|, vowel', 'Bias, onset', 'Median |err|, onset'];
html = `<thead><tr>${ph.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>`;
for (const c of DATA.clips) {
  const sc = c.syllables.filter(s => s.errVowel != null);
  const mean = a => a.reduce((p, q) => p + q, 0) / a.length;
  const med = a => { const b = [...a].sort((p, q) => p - q); const k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; };
  const v = sc.map(s => s.errVowel), o = sc.map(s => s.errOnset), r = sc.map(s => s.errVpr);
  html += summaryRow([esc(c.title), `WER ${pct(c.wer)}`, `${c.refSyllables} / ${c.mfaSyllables}`, `${sc.length}/${c.syllables.length}`,
    sc.length ? fmtErr(mean(r)) : '–', sc.length ? fmtMs(med(r.map(Math.abs))) : '–',
    sc.length ? fmtErr(mean(v)) : '–', sc.length ? fmtMs(med(v.map(Math.abs))) : '–',
    sc.length ? fmtErr(mean(o)) : '–', sc.length ? fmtMs(med(o.map(Math.abs))) : '–']);
}
document.getElementById('perclip').innerHTML = html + '</tbody>';

// VPR vs. vowel onset: the two anchors side by side, then the per-syllable outcome.
{
  const sw = k => swatch(k).outerHTML;
  // d < 0 means VPR (b) is better: smaller magnitude for errors, larger share for hit rates.
  const pair = (a, b, f, higherIsBetter = false) => {
    const d = higherIsBetter ? a - b : Math.abs(b) - Math.abs(a);
    const color = Math.abs(d) < 0.5 ? 'var(--ink)' : (d < 0 ? 'var(--good)' : 'var(--bad)');
    return `${f(a)} → <span style="color:${color};font-weight:600">${f(b)}</span>`;
  };
  const head = ['Baseline', 'Syllables', 'n', 'Bias', 'Median |err|', 'Mean |err|', 'RMSE', '≤ 25 ms', '≤ 50 ms',
    'Closer / same / further', 'Median change', 'Mean change'];
  let t = `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>`;
  for (const c of DATA.comparison) {
    const a = c.vowel, b = c.vpr;
    const bar = `<span style="color:var(--good)">${c.better}</span> / ${c.same} / <span style="color:var(--bad)">${c.worse}</span>`;
    const base = c.base === 'vowel' ? 'Vowel onset' : 'Vowel onset, minus its mean bias';
    t += summaryRow([base, esc(c.subset), c.n, pair(a.bias, b.bias, fmtErr), pair(a.median_ae, b.median_ae, fmtMs),
      pair(a.mae, b.mae, fmtMs), pair(a.rmse, b.rmse, fmtMs),
      pair(a.within_25, b.within_25, pct, true), pair(a.within_50, b.within_50, pct, true),
      bar, fmtErr(c.median_change), fmtErr(c.mean_change)]);
  }
  document.getElementById('compare').innerHTML = t + '</tbody>';
  document.getElementById('cmp-sub').innerHTML =
    `Each cell reads baseline → ${sw('vpr')}VPR; green means VPR is closer to the clicks, red further.`;
}
</script>
</body>
</html>
"""
