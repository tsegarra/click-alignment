"""Full-verse step 2: place each verse's lyrics (full_verses/<id>.txt) in its audio and build the
MFA corpus from them.

The lyrics have no timing, and often cover only part of the recording (one verse of a song), so
Whisper is used only to find where each lyric line is: the lyric words are aligned to Whisper's
words (semi-global edit distance, spelling-tolerant matching), and a line's span runs from its
first to its last matched word. Lines with too few matches (Whisper skipped or garbled them) are
spread over the gap between their neighbors and marked as guessed. MFA then aligns the lyric text,
one interval per lyric line, widened into the surrounding silence by up to PAD_S.

Writes, per verse:
  out/verses/lyrics/<id>.json          each lyric line's span and how it was placed
  out/verses/corpus/<id>/<id>.wav      audio
  out/verses/corpus/<id>/<id>.TextGrid normalized lyric lines
"""

import argparse
import json
import shutil
import wave
from pathlib import Path

from evaluate import same_word
from transcribe import normalize

ROOT = Path(__file__).resolve().parent.parent
PAD_S = 0.5
WORD_S = 0.22              # assumed length of a lyric word that has no Whisper match
MIN_MATCHED = 0.3          # a line is anchored if at least this share of its words matched
MATCH, SUB, DEL_LYRIC, SKIP_WHISPER = 2.0, -1.0, -1.0, -0.5


def whisper_tokens(result):
    """Whisper result -> [(token, start_s, end_s)]; a word that normalizes to several tokens
    ("36th" -> "thirty sixth") gives each the word's span."""
    out = []
    for seg in result["segments"]:
        for w in seg.get("words", []):
            out += [(t, w["start"], w["end"]) for t in normalize(w["word"]).split()]
    return out


def align(lyric, whisper):
    """Semi-global alignment: every lyric token is matched or deleted, while Whisper tokens before
    the first and after the last match are free (the recording is longer than the lyrics).
    -> {lyric index: whisper index} for the matched pairs."""
    n, m = len(lyric), len(whisper)
    cache = {}

    def sim(a, b):
        if (a, b) not in cache:
            cache[a, b] = same_word(a, b)
        return cache[a, b]

    NEG = float("-inf")
    prev = [0.0] * (m + 1)  # free leading Whisper tokens
    back = [bytearray(m + 1)]  # 1 = diagonal, 2 = up (delete lyric), 3 = left (skip whisper)
    for i in range(1, n + 1):
        cur = [NEG] * (m + 1)
        b = bytearray(m + 1)
        cur[0], b[0] = prev[0] + DEL_LYRIC, 2
        for j in range(1, m + 1):
            diag = prev[j - 1] + (MATCH if sim(lyric[i - 1], whisper[j - 1]) else SUB)
            up = prev[j] + DEL_LYRIC
            left = cur[j - 1] + SKIP_WHISPER
            if diag >= up and diag >= left:
                cur[j], b[j] = diag, 1
            elif up >= left:
                cur[j], b[j] = up, 2
            else:
                cur[j], b[j] = left, 3
        back.append(b)
        prev = cur
    i, j = n, max(range(m + 1), key=prev.__getitem__)  # free trailing Whisper tokens
    pairs = {}
    while i > 0:
        step = back[i][j]
        if step == 1:
            if sim(lyric[i - 1], whisper[j - 1]):
                pairs[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif step == 2:
            i -= 1
        else:
            j -= 1
    return pairs


def place_lines(lines, pairs, whisper, duration):
    """-> [{'text', 's', 'e', 'matched', 'words', 'guessed'}] in seconds, non-overlapping."""
    placed, k = [], 0
    for text in lines:
        toks = normalize(text).split()
        hits = [(p, pairs[k + p]) for p in range(len(toks)) if k + p in pairs]
        line = {"text": text, "norm": " ".join(toks), "words": len(toks), "matched": len(hits),
                "guessed": len(hits) == 0 or len(hits) < MIN_MATCHED * len(toks)}
        if not line["guessed"]:
            (p0, j0), (p1, j1) = hits[0], hits[-1]
            line["s"] = whisper[j0][1] - p0 * WORD_S
            line["e"] = whisper[j1][2] + (len(toks) - 1 - p1) * WORD_S
        placed.append(line)
        k += len(toks)

    # Guessed lines: spread each run over the gap between the anchored lines around it.
    i = 0
    while i < len(placed):
        if not placed[i]["guessed"]:
            i += 1
            continue
        j = i
        while j < len(placed) and placed[j]["guessed"]:
            j += 1
        run = placed[i:j]
        words = sum(l["words"] for l in run)
        lo = placed[i - 1]["e"] if i else None
        hi = placed[j]["s"] if j < len(placed) else None
        if lo is None and hi is None:
            lo, hi = 0.0, duration
        elif lo is None:
            lo = max(0.0, hi - words * WORD_S)
        elif hi is None:
            hi = min(duration, lo + words * WORD_S)
        t = lo
        for l in run:
            l["s"] = t
            t = l["e"] = t + (hi - lo) * l["words"] / max(1, words)
        i = j

    # Matched spans can overlap where the extrapolation for unmatched end words runs into the
    # next line: split the overlap.
    for a, b in zip(placed, placed[1:]):
        if b["s"] < a["e"]:
            a["e"] = b["s"] = (a["e"] + b["s"]) / 2
    for l in placed:
        l["s"], l["e"] = max(0.0, l["s"]), min(duration, l["e"])
    return placed


def intervals(placed, duration):
    """Lyric lines -> TextGrid intervals, widened into the silence around them."""
    out = []
    for i, l in enumerate(placed):
        if not l["norm"] or l["e"] - l["s"] < 0.05:
            continue
        lo = placed[i - 1]["e"] if i else 0.0
        hi = placed[i + 1]["s"] if i + 1 < len(placed) else duration
        start = max(l["s"] - PAD_S, (lo + l["s"]) / 2 if i else 0.0)
        end = min(l["e"] + PAD_S, (l["e"] + hi) / 2 if i + 1 < len(placed) else duration)
        if out and start < out[-1][1]:
            start = out[-1][1]
        out.append((round(start, 3), round(end, 3), l["norm"]))
    return out


def textgrid(ivs, duration, tier):
    """Long-format Praat TextGrid with one interval tier; gaps become empty intervals."""
    filled, t = [], 0.0
    for start, end, text in ivs:
        if start > t:
            filled.append((t, start, ""))
        filled.append((start, end, text))
        t = end
    if t < duration:
        filled.append((t, duration, ""))
    L = ['File type = "ooTextFile"', 'Object class = "TextGrid"', "",
         "xmin = 0", f"xmax = {duration}", "tiers? <exists>", "size = 1", "item []:",
         "    item [1]:", '        class = "IntervalTier"', f'        name = "{tier}"',
         "        xmin = 0", f"        xmax = {duration}", f"        intervals: size = {len(filled)}"]
    for i, (start, end, text) in enumerate(filled, 1):
        L += [f"        intervals [{i}]:", f"            xmin = {start}", f"            xmax = {end}",
              f'            text = "{text}"']
    return "\n".join(L) + "\n"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--audio", default=str(ROOT / "full_verses"))
    p.add_argument("--out", default=str(ROOT / "out" / "verses"))
    args = p.parse_args()
    out = Path(args.out)
    (out / "lyrics").mkdir(parents=True, exist_ok=True)

    for f in sorted(Path(args.audio).glob("*.wav")):
        vid, txt = f.stem, f.with_suffix(".txt")
        if not txt.exists():
            print(f"{vid:28s} no {txt.name}, skipped")
            continue
        lines = [l.strip() for l in txt.read_text().splitlines() if l.strip()]
        result = json.loads((out / "whisper" / f"{vid}.json").read_text())
        whisper = whisper_tokens(result)
        lyric = [t for l in lines for t in normalize(l).split()]
        with wave.open(str(f)) as w:
            duration = w.getnframes() / w.getframerate()

        pairs = align(lyric, [t for t, _, _ in whisper])
        placed = place_lines(lines, pairs, whisper, duration)
        (out / "lyrics" / f"{vid}.json").write_text(json.dumps(
            {"lines": placed, "lyricWords": len(lyric), "matchedWords": len(pairs)}, indent=1))

        spk = out / "corpus" / vid
        spk.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(f, spk / f"{vid}.wav")
        (spk / f"{vid}.TextGrid").write_text(textgrid(intervals(placed, duration), duration, vid))
        guessed = sum(l["guessed"] for l in placed)
        print(f"{vid:28s} {len(pairs)}/{len(lyric)} lyric words matched Whisper  "
              f"{placed[0]['s']:.1f}-{placed[-1]['e']:.1f} s  "
              f"{len(lines) - guessed}/{len(lines)} lines placed, {guessed} guessed", flush=True)


if __name__ == "__main__":
    main()
