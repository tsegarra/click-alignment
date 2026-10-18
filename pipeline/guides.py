"""Guide clicks for guided.html: VPR's syllable times for each line clip, with no lyric information.

For each verse, VPR (evaluate.add_vpr, as in verses.py) runs on the full verse audio with MFA's
alignment in out/verses/aligned_fmllr, the alignment line_clips.py cut the clips from. Each clip
gets the VPR times of the syllables of the MFA words in its own lyric line, never every syllable
inside its time window: a clip is padded into its neighbours, and a neighbouring line's syllable
would otherwise become guide #1 and shift every default assignment by one.

The verse is split into lines with line_clips.py's own lyric_lines(), and lines are matched to
clips by line number (the clip file's NN), not by the clip's words, which may have been edited on
the admin page. As a sanity check, each line's span is recomputed and must match the clip's
sourceStartMs and length; clips that don't are skipped and reported.

Writes guide_timestamps.json at the repo root: clip id -> sorted times in ms, relative to the clip
start, rounded to 1 ms and clamped to [0, clip length]. Re-run whenever the line clips are
regenerated. Reads the clip list from Firestore (via clips.py). Needs num2words (via
line_clips.lyric_lines): run with .venv-whisper/bin/python.
"""

import json
import re
import wave
from pathlib import Path

import vpr
from clips import load_clips
from evaluate import add_vpr, load_mfa
from line_clips import line_bounds, lyric_lines, mfa_words

ROOT = Path(__file__).resolve().parent.parent
ALIGNED = ROOT / "out/verses/aligned_fmllr"
TOLERANCE_MS = 1  # sourceStartMs is rounded to 1 µs, so any real mismatch is far bigger


def wav_info(path):
    """-> (sample count, sample rate)."""
    with wave.open(str(path)) as w:
        return w.getnframes(), w.getframerate()


def verse_guides(verse, clips):
    """clips: {line number: clip} for one verse -> ({clip id: guide times}, [problems])."""
    audio = ROOT / "full_verses" / f"{verse}.wav"
    mfa_path = ALIGNED / verse / f"{verse}.json"
    # The same MFA words twice: as tuples for lyric_lines(), and with syllables for add_vpr().
    # Both drop the same silences, so they line up one to one.
    words = mfa_words(mfa_path)
    mfa = load_mfa(mfa_path)
    assert len(words) == len(mfa), f"{verse}: MFA word lists differ"
    add_vpr(mfa, audio)
    index = {id(w): i for i, w in enumerate(words)}

    lines = lyric_lines(verse, words)
    n_samples, rate = wav_info(audio)
    bounds = line_bounds(lines, n_samples, rate)

    guides, problems = {}, []
    for n, c in sorted(clips.items()):
        if n > len(lines):
            problems.append(f"{c['id']}: the verse has only {len(lines)} lines")
            continue
        a, b = bounds[n - 1]
        clip_samples, clip_rate = wav_info(ROOT / c["file"])
        start_ms = a / rate * 1000
        if (clip_rate != rate or abs(start_ms - c["sourceStartMs"]) > TOLERANCE_MS
                or abs(b - a - clip_samples) / rate * 1000 > TOLERANCE_MS):
            problems.append(f"{c['id']}: line {n} spans {start_ms:.0f}-{b / rate * 1000:.0f} ms, but the "
                            f"clip starts at {c['sourceStartMs']:.0f} ms and lasts "
                            f"{clip_samples / clip_rate * 1000:.0f} ms")
            continue
        length_ms = clip_samples / clip_rate * 1000
        times = [s["vpr"] * 1000 - c["sourceStartMs"]
                 for _, ws in lines[n - 1] for w in ws for s in mfa[index[id(w)]]["syllables"]]
        guides[c["id"]] = sorted(round(min(max(t, 0), length_ms)) for t in times)
    return guides, problems


def main():
    by_verse = {}  # verse id -> {line number: clip}
    for c in load_clips():
        if "source" not in c:
            continue
        m = re.fullmatch(r"clips/lines/(.+)/(\d+)\.wav", c["file"])
        assert m and Path(c["source"]).stem == m[1], f"{c['id']}: unexpected file {c['file']}"
        by_verse.setdefault(m[1], {})[int(m[2])] = c

    guides, problems = {}, []
    for verse, clips in sorted(by_verse.items()):
        g, p = verse_guides(verse, clips)
        guides.update(g)
        problems += p
        print(f"{verse:24s} {len(g):3d} clips, {sum(map(len, g.values())):4d} guides")

    # In the app's order, one clip per line.
    order = [c["id"] for v in by_verse.values() for c in v.values()]
    out = {k: guides[k] for k in sorted(guides, key=order.index)}
    text = json.dumps(out, indent=2)
    text = re.sub(r"\[\s+([\d,\s]*?)\s+\]", lambda m: "[" + re.sub(r",\s+", ", ", m[1]) + "]", text)
    (ROOT / "guide_timestamps.json").write_text(text + "\n")
    print(f"wrote guide_timestamps.json: {len(out)} clips")
    for p in problems:
        print("skipped", p)


if __name__ == "__main__":
    main()
