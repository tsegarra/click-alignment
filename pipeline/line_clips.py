"""Cut each full verse into one clip per lyric line and append them to clips.json, for clicking in
the app one line at a time.

Each line's span comes from MFA's alignment of the verse (out/verses/aligned_fmllr: ARPAbet,
speaker-adapted): from its first word's start to its last word's end, padded into the
neighbouring gap by half the gap (at least PAD_MIN_MS, so a word MFA ended early isn't cut off,
and at most PAD_MAX_MS). Each word's
syllable count is the number of vowels in MFA's pronunciation of it.

Every clip records where it came from (source, sourceStartMs), so its clicks can be mapped back
onto the full verse: verse time = sourceStartMs + clickTimeMs.

Writes clips/lines/<verse>/<nn>.wav and replaces any line clips already in clips.json, keeping
the hand-made clips (and their order) ahead of them. Needs num2words (via transcribe.normalize):
run with .venv-whisper/bin/python.
"""

import json
import re
import wave
from array import array
from pathlib import Path

from transcribe import normalize

ROOT = Path(__file__).resolve().parent.parent
VERSES = [  # (verse id, clip id prefix, title)
    ("2pac_all_eyez_full", "2pac-all-eyez-line", "All Eyez On Me"),
    ("bdk_set_it_off_full", "bdk-set-it-off-line", "Set It Off"),
    ("eminem_my_name_is", "eminem-my-name-is-line", "My Name Is"),
    ("meth_plo_style_full", "method-man-plo-style-line", "PLO Style"),
    ("migos_superstar", "migos-supastars-line", "Supastars"),
    ("nas_aint_hard_full", "nas-aint-hard-line", "It Ain't Hard To Tell"),
]
PAD_MIN_MS, PAD_MAX_MS = 150, 400
FADE_MS = 5
SILENCE = {"", "sp", "sil", "spn", "<eps>"}


def mfa_words(path):
    """MFA json -> [(start_s, end_s, label, vowel count)], silences dropped."""
    tiers = json.loads(path.read_text())["tiers"]
    words = [e for e in tiers["words"]["entries"] if e[2] not in SILENCE]
    phones = [e for e in tiers["phones"]["entries"] if e[2] not in SILENCE]
    out = []
    for start, end, label in words:
        vowels = sum(1 for p in phones
                     if p[0] >= start - 1e-6 and p[1] <= end + 1e-6 and p[2][-1].isdigit())
        out.append((start, end, label, vowels))
    return out


def lyric_lines(verse, words):
    """-> per lyric line, [(display word, [MFA words])]. A display word is a whitespace-separated
    lyric token; it may cover several MFA words ("nine-inch", "mack'll" -> "mack" "'ll"). A token
    that normalizes to nothing (a lone dash) is glued onto the previous word."""
    lines = json.loads((ROOT / "out/verses/lyrics" / f"{verse}.json").read_text())["lines"]
    i = 0
    out = []
    for line in lines:
        cols = []
        for text in line["text"].split():
            taken = []
            for tok in normalize(text).split():
                joined = ""
                while joined != tok:
                    assert len(joined) < len(tok), f"{verse}: MFA words don't spell {tok!r} near {i}"
                    joined += words[i][2]
                    taken.append(words[i])
                    i += 1
            if taken or not cols:
                cols.append([text, taken])
            else:
                cols[-1][0] += " " + text
        out.append([(t, ws) for t, ws in cols if ws])
    assert i == len(words), f"{verse}: {len(words) - i} MFA words left over"
    return out


def main():
    data = json.loads((ROOT / "clips.json").read_text())
    clips = [c for c in data["clips"] if "source" not in c]

    for verse, prefix, title in VERSES:
        src = ROOT / "full_verses" / f"{verse}.wav"
        with wave.open(str(src)) as w:
            params = w.getparams()
            assert params.nchannels == 1 and params.sampwidth == 2, f"{src}: expected mono 16-bit"
            rate = params.framerate
            samples = array("h", w.readframes(params.nframes))
        dur_ms = len(samples) / rate * 1000

        lines = lyric_lines(verse, mfa_words(ROOT / "out/verses/aligned_fmllr" / verse / f"{verse}.json"))
        spans = [(cols[0][1][0][0] * 1000, cols[-1][1][-1][1] * 1000) for cols in lines]
        outdir = ROOT / "clips/lines" / verse
        outdir.mkdir(parents=True, exist_ok=True)
        for n, (cols, (s, e)) in enumerate(zip(lines, spans)):
            prev_end = spans[n - 1][1] if n else 0
            next_start = spans[n + 1][0] if n + 1 < len(spans) else dur_ms
            pad = lambda gap: min(max(gap / 2, PAD_MIN_MS), PAD_MAX_MS)
            a = round(max(0, s - pad(s - prev_end)) * rate / 1000)
            b = round(min(len(samples), (e + pad(next_start - e)) * rate / 1000))

            cut = samples[a:b]
            fade = round(FADE_MS * rate / 1000)
            for k in range(fade):
                cut[k] = int(cut[k] * k / fade)
                cut[-1 - k] = int(cut[-1 - k] * k / fade)
            path = outdir / f"{n + 1:02d}.wav"
            with wave.open(str(path), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(rate)
                w.writeframes(cut.tobytes())

            clips.append({
                "id": f"{prefix}{n + 1:02d}",
                "title": f"{title}: line {n + 1} of {len(lines)}",
                "file": str(path.relative_to(ROOT)),
                "source": str(src.relative_to(ROOT)),
                "sourceStartMs": round(a / rate * 1000, 3),
                "words": [{"text": t, "syllables": max(1, sum(w[3] for w in ws))} for t, ws in cols],
            })
        print(f"{verse}: {len(lines)} lines")

    data["clips"] = clips
    text = json.dumps(data, indent=2, ensure_ascii=False)
    # One line per word, as in the hand-made entries.
    text = re.sub(r'\{\n\s+("text": .*),\n\s+("syllables": \d+)\n\s+\}', r"{ \1, \2 }", text)
    (ROOT / "clips.json").write_text(text + "\n")


if __name__ == "__main__":
    main()
