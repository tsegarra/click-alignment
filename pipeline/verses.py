"""Full-verse step 3: VPR on MFA's alignment of each verse's lyrics, one page per verse.

There is no ground truth for the verses, so nothing is scored: each page lays the verse out in
lines of LINE_MIN_S to LINE_MAX_S seconds and plays it back with a click at every VPR time, for
checking by ear. A page covers only the part of the recording the lyrics were placed in (see
lyrics_corpus.py), plus SPAN_PAD_S either side.

Lines break where the verse is quietest between two MFA words (a breath, a pause), so a line
never cuts through a word that MFA aligned.

Writes out/verses/<id>.html per verse and out/verses/index.html. Standard library only.
"""

import argparse
import json
import re
import wave
from array import array
from pathlib import Path

import verse_html
import vpr
from evaluate import add_vpr, load_mfa

ROOT = Path(__file__).resolve().parent.parent
LINE_MIN_S, LINE_MAX_S = 5.0, 10.0
LAST_LINE_MIN_S = 2.0  # don't leave a stub shorter than this at the end of the verse
GAP_MIN_MS = 30        # a word boundary's loudness is averaged over at least this span
PEAKS_PER_S = 150      # waveform resolution
SKIPPED_MIN_S = 2.5    # a stretch this long with no MFA words...
SKIPPED_MIN_DB = 35.0  # ...and at least this loud on average is flagged (e.g. a hook not in the lyrics)
SPAN_PAD_S = 1.0


def peaks(path):
    """Mono 16-bit wav -> duration in ms and [min, max] per bin as ints in -100..100."""
    with wave.open(str(path)) as w:
        assert w.getsampwidth() == 2, f"{path}: expected 16-bit audio"
        rate, channels = w.getframerate(), w.getnchannels()
        samples = array("h", w.readframes(w.getnframes()))[::channels]
    full = max(1, max(abs(s) for s in samples))
    step = rate / PEAKS_PER_S
    out = []
    for b in range(int(len(samples) / step)):
        chunk = samples[int(b * step):int((b + 1) * step)]
        out.append([round(min(chunk) / full * 100), round(max(chunk) / full * 100)])
    return len(samples) / rate * 1000, out


def mean_db(env, a, b):
    a, b = max(0, int(a)), min(len(env), int(b))
    return sum(env[a:b]) / (b - a) if b > a else float("inf")


def line_breaks(words, env, t, duration):
    """-> [(start_ms, end_ms)] covering t..duration ms, each LINE_MIN_S..LINE_MAX_S long (bar the last).

    Candidate cuts are the boundaries between consecutive MFA words (and the silence before the
    first and after the last); the cut goes in the middle of the quietest one in the window. If
    no boundary falls in the window, the cut is at the quietest 50 ms in it."""
    cands = []  # (cut_ms, loudness of the boundary in dB)
    edges = [(t, t)] + [(w["start"] * 1000, w["end"] * 1000) for w in words] + [(duration, duration)]
    for (_, end), (start, _) in zip(edges, edges[1:]):
        if start < end:  # overlapping words never happen in MFA output, but be safe
            continue
        mid = (end + start) / 2
        half = max(start - end, GAP_MIN_MS) / 2
        cands.append((mid, mean_db(env, mid - half, mid + half)))

    lines = []
    while duration - t > LINE_MAX_S * 1000:
        lo = t + LINE_MIN_S * 1000
        hi = min(t + LINE_MAX_S * 1000, duration - LAST_LINE_MIN_S * 1000)
        if hi < lo:
            hi = t + LINE_MAX_S * 1000
        inside = [c for c in cands if lo <= c[0] <= hi]
        if inside:
            cut = min(inside, key=lambda c: c[1])[0]
        else:
            cut = min(range(int(lo), int(hi) + 1, 10), key=lambda m: mean_db(env, m - 25, m + 25))
        lines.append((t, cut))
        t = cut
    lines.append((t, duration))
    return [(round(a, 1), round(b, 1)) for a, b in lines]


def textgrid_intervals(path):
    """Corpus TextGrid -> [(start_s, end_s, text)] for the non-empty intervals."""
    found = re.findall(r'xmin = ([\d.]+)\s+xmax = ([\d.]+)\s+text = "(.*)"', path.read_text())
    return [(float(a), float(b), t) for a, b, t in found if t.strip()]


def build(vid, audio, out):
    mfa_path = out / "aligned" / vid / f"{vid}.json"
    mfa = load_mfa(mfa_path) if mfa_path.exists() else []
    env = vpr.envelope_db(audio)
    add_vpr(mfa, audio, env)
    duration, pk = peaks(audio)
    lyrics = json.loads((out / "lyrics" / f"{vid}.json").read_text())
    lyric_lines = lyrics["lines"]
    span = (max(0.0, (lyric_lines[0]["s"] - SPAN_PAD_S) * 1000),
            min(duration, (lyric_lines[-1]["e"] + SPAN_PAD_S) * 1000))

    # Lyric lines MFA produced no words for (it gave up on the utterance).
    tg = out / "corpus" / vid / f"{vid}.TextGrid"
    unaligned = [{"s": a * 1000, "e": b * 1000, "text": text}
                 for a, b, text in (textgrid_intervals(tg) if tg.exists() else [])
                 if not any(a <= w["start"] < b for w in mfa)]
    # Loud stretches with no words at all: usually a hook or ad-libs the lyrics leave out.
    edges = [span[0]] + [t * 1000 for w in mfa for t in (w["start"], w["end"])] + [span[1]]
    for a, b in zip(edges[::2], edges[1::2]):
        if b - a >= SKIPPED_MIN_S * 1000 and mean_db(env, a, b) >= SKIPPED_MIN_DB \
                and not any(u["s"] < b and u["e"] > a for u in unaligned):
            unaligned.append({"s": a, "e": b, "text": "no lyrics here", "skipped": True})
    unaligned.sort(key=lambda u: u["s"])

    sylls = []
    for wi, w in enumerate(mfa):
        for k, s in enumerate(w["syllables"]):
            sylls.append({"w": wi, "syl": k, "of": len(w["syllables"]),
                          "vpr": round(s["vpr"] * 1000, 1), "vowel": round(s["vowel"] * 1000, 1),
                          "rule": s["vpr_rule"], "jump": s["vpr_jump_db"]})
    whisper_path = out / "whisper" / f"{vid}.json"
    whisper = json.loads(whisper_path.read_text()) if whisper_path.exists() else {}
    return {
        "id": vid, "title": vid.replace("_", " "), "audio": f"../../{audio.relative_to(ROOT)}",
        "durationMs": duration, "peaksPerS": PEAKS_PER_S, "peaks": pk,
        "words": [{"w": w["word"], "s": round(w["start"] * 1000, 1), "e": round(w["end"] * 1000, 1)}
                  for w in mfa],
        "syllables": sylls, "unaligned": unaligned,
        "spanStartMs": span[0], "spanEndMs": span[1],
        "lines": line_breaks(mfa, env, *span),
        "guessed": [{"s": l["s"] * 1000, "e": l["e"] * 1000, "text": l["text"]}
                    for l in lyric_lines if l["guessed"]],
        "lyricLines": len(lyric_lines),
        "lyricWords": lyrics["lyricWords"], "matchedWords": lyrics["matchedWords"],
        "whisperModel": whisper.get("model"),
        "jumpMinDb": vpr.JUMP_MIN_DB, "shiftMs": vpr.VOWEL_SHIFT_MS,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--audio", default=str(ROOT / "full_verses"))
    p.add_argument("--out", default=str(ROOT / "out" / "verses"))
    args = p.parse_args()
    out = Path(args.out)

    index = []
    for audio in sorted(Path(args.audio).glob("*.wav")):
        if not (out / "lyrics" / f"{audio.stem}.json").exists():
            print(f"{audio.stem:28s} no lyrics placed (run lyrics_corpus.py), skipped")
            continue
        data = build(audio.stem, audio, out)
        verse_html.write(out / f"{audio.stem}.html", data)
        n = len(data["syllables"])
        jumps = sum(s["rule"] == "jump" for s in data["syllables"])
        index.append({"id": data["id"], "title": data["title"],
                      "spanMs": (data["spanStartMs"], data["spanEndMs"]),
                      "matched": data["matchedWords"] / data["lyricWords"],
                      "guessed": len(data["guessed"]), "lyricLines": data["lyricLines"],
                      "words": len(data["words"]), "syllables": n, "jumps": jumps,
                      "lines": len(data["lines"]), "unaligned": len(data["unaligned"])})
        print(f"{audio.stem:28s} {data['spanStartMs'] / 1000:5.1f}-{data['spanEndMs'] / 1000:5.1f} s  "
              f"{len(data['words']):4d} words  "
              f"{n:4d} VPR clicks ({jumps} burst)  {len(data['lines'])} lines  "
              f"{len(data['unaligned'])} stretches without words")
    verse_html.write_index(out / "index.html", index)


if __name__ == "__main__":
    main()
