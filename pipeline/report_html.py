"""Renders out/report.html: per-clip waveforms with the click / MFA onset / MFA vowel markers,
followed by the summary statistics. Called from evaluate.py; standard library only."""

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


def write(path, rows, clip_info, clips, user_data, summaries):
    data = {"userData": user_data, "summaries": summaries, "clips": []}
    for c in clip_info:
        clip = clips[c["id"]]
        duration, pk = peaks(ROOT / clip["file"])
        sylls = []
        for r in (r for r in rows if r["clip"] == c["id"]):
            sylls.append({
                "word": r["word"], "syl": r["syllable_in_word"], "of": r["ref_syllables"],
                "click": r["click_ms"], "onset": r.get("mfa_onset_ms"), "vowel": r.get("mfa_vowel_ms"),
                "errOnset": r.get("err_onset_ms"), "errVowel": r.get("err_vowel_ms"),
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
  --click: #2a78d6; --onset: #eb6834; --vowel: #1baf7a;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --border: rgba(255,255,255,0.10);
    --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --wave: #4a4a46; --word-band: #242422;
    --click: #3987e5; --onset: #d95926; --vowel: #199e70;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --border: rgba(255,255,255,0.10);
  --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --wave: #4a4a46; --word-band: #242422;
  --click: #3987e5; --onset: #d95926; --vowel: #199e70;
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
    “After bias removed” subtracts the mean error of that row, measured on the same syllables.</p>
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
];
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
  return el('circle', { cx: x, cy: y, r: 4.5, fill: color, ...extra }, parent);
}

function swatch(kind) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('width', 26); s.setAttribute('height', 16); s.setAttribute('class', 'sw');
  const dash = kind === 'onset' ? '4 3' : kind === 'vowel' ? '1.5 2.5' : '';
  el('line', { x1: 13, x2: 13, y1: 1, y2: 15, stroke: `var(--${kind})`, 'stroke-width': 2, 'stroke-dasharray': dash }, s);
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
  tip.innerHTML = `<div class="t">“${esc(s.word)}”${which}</div>${rows}<div class="st">${mfa}</div>`;
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
      const dash = m.key === 'onset' ? '4 3' : m.key === 'vowel' ? '1.5 2.5' : '';
      el('line', { x1: px, x2: px, y1: WAVE_TOP - 6, y2: WAVE_BOT, stroke: `var(--${m.key})`,
        'stroke-width': 2, 'stroke-dasharray': dash }, g);
      const gy = m.key === 'click' ? WAVE_TOP - 4 : m.key === 'onset' ? WAVE_TOP + 2 : WAVE_BOT - 2;
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

const clipsEl = document.getElementById('clips');
const renders = [];
let playing = null;
for (const c of DATA.clips) {
  const card = document.createElement('section');
  card.className = 'card';
  const scored = c.syllables.filter(s => s.errVowel != null);
  const med = arr => { const a = [...arr].sort((p, q) => p - q); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const statLine = scored.length
    ? `median |err| vowel ${Math.round(med(scored.map(s => Math.abs(s.errVowel))))} ms · onset ${Math.round(med(scored.map(s => Math.abs(s.errOnset))))} ms · ${c.refSyllables === c.mfaSyllables ? `${c.refSyllables} syllables on both sides` : `⚠ ${c.refSyllables} lyric vs ${c.mfaSyllables} MFA syllables`} · WER ${pct(c.wer)}`
    : 'not aligned';
  card.innerHTML = `<header><h3>${esc(c.title)}</h3><span class="stats">${statLine}</span>
    <button class="play" type="button">▶ Play</button></header>
    <div class="lines"><b>lyrics</b><span>${esc(c.lyrics)}</span><b>whisper</b><span>${esc(c.whisper)}</span></div>
    <div class="plot"></div>`;
  clipsEl.append(card);
  const plot = card.querySelector('.plot');
  const entry = { c, plot, r: null };
  renders.push(entry);

  const btn = card.querySelector('.play');
  const audio = new Audio(c.audio);
  btn.addEventListener('click', () => {
    if (playing && playing.audio !== audio) playing.stop();
    if (!audio.paused) { stop(); return; }
    audio.currentTime = 0;
    audio.play().catch(() => { btn.textContent = 'Audio unavailable'; });
    btn.textContent = '■ Stop';
    playing = { audio, stop };
    const tick = () => {
      if (audio.paused) return;
      const px = entry.r.x(audio.currentTime * 1000);
      entry.r.playhead.setAttribute('x1', px); entry.r.playhead.setAttribute('x2', px);
      entry.r.playhead.setAttribute('opacity', 1);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  function stop() { audio.pause(); btn.textContent = '▶ Play'; entry.r.playhead.setAttribute('opacity', 0); }
  audio.addEventListener('ended', stop);
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
  const sw = swatch(s.anchor).outerHTML;
  const m = s.stats;
  html += summaryRow([esc(s.subset), `${sw}${s.anchor === 'onset' ? 'Syllable onset' : 'Vowel onset'}`, m.n,
    fmtErr(m.bias), fmtMs(m.median_ae), fmtMs(m.mae), fmtMs(m.mae_debiased), fmtMs(m.rmse),
    pct(m.within_25), pct(m.within_50), pct(m.within_100)]);
}
document.getElementById('summary').innerHTML = html + '</tbody>';

const ph = ['Clip', 'Whisper', 'Syllables (lyrics / MFA)', 'Scored', 'Bias, vowel', 'Median |err|, vowel', 'Bias, onset', 'Median |err|, onset'];
html = `<thead><tr>${ph.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>`;
for (const c of DATA.clips) {
  const sc = c.syllables.filter(s => s.errVowel != null);
  const mean = a => a.reduce((p, q) => p + q, 0) / a.length;
  const med = a => { const b = [...a].sort((p, q) => p - q); const k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; };
  const v = sc.map(s => s.errVowel), o = sc.map(s => s.errOnset);
  html += summaryRow([esc(c.title), `WER ${pct(c.wer)}`, `${c.refSyllables} / ${c.mfaSyllables}`, `${sc.length}/${c.syllables.length}`,
    sc.length ? fmtErr(mean(v)) : '–', sc.length ? fmtMs(med(v.map(Math.abs))) : '–',
    sc.length ? fmtErr(mean(o)) : '–', sc.length ? fmtMs(med(o.map(Math.abs))) : '–']);
}
document.getElementById('perclip').innerHTML = html + '</tbody>';
</script>
</body>
</html>
"""
