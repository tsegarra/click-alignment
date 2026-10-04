"""Step 3: compare MFA's alignment of the Whisper transcript with the manual syllable clicks.

Each manual click marks one syllable of the reference lyrics (clips.json). MFA gives word and
phone intervals for Whisper's words, so:
  1. Each MFA word's ARPAbet phones are split into syllables (one per stressed-digit vowel,
     consonants between vowels split by maximal legal onset).
  2. Syllables are paired purely by position in the line, ignoring word boundaries: the nth
     click goes with MFA's nth syllable. Clicks past the end of MFA's syllables are unscored.

A click is a single point, and it isn't obvious which point in a syllable it corresponds to, so
two MFA anchors are scored: the syllable onset (first consonant) and the vowel onset. A third
anchor, VPR ("Vowel Plus Rules", see vpr.py), moves MFA's vowel onset onto a nearby loudness
burst when there is a clear one, and otherwise shifts it by a fixed amount.

Writes out/syllables.csv (one row per manual click), out/report.md and out/report.html.
Standard library only.
"""

import argparse
import csv
import json
import re
import statistics
from difflib import SequenceMatcher
from pathlib import Path

import report_html
import vpr

ROOT = Path(__file__).resolve().parent.parent
ANCHORS = ("onset", "vowel", "vpr")
ANCHOR_NAMES = {"onset": "MFA syllable onset", "vowel": "MFA vowel onset", "vpr": "VPR"}
SILENCE = {"", "sp", "sil", "spn", "<eps>"}
VPR_TIE_MS = 5        # |err| changes this small count as "no change" (MFA has 10 ms frames)
VPR_MIN_GAP_S = 0.03  # VPR's backward search stops this far after the previous vowel onset

# Legal English onset clusters (ARPAbet), for maximal-onset syllabification.
LIQUIDS_GLIDES = {"L", "R", "W", "Y"}
ONSETS_2 = (
    {(c, g) for c in "P B T D K G F TH SH V".split() for g in LIQUIDS_GLIDES}
    | {("S", c) for c in "P T K M N L W F".split()}
    | {(c, "Y") for c in "M N H".split()}
) - {("T", "L"), ("D", "L"), ("TH", "Y"), ("SH", "Y")}
ONSETS_3 = {("S", c, g) for c in "P T K".split() for g in LIQUIDS_GLIDES}


def is_vowel(phone):
    return phone[-1].isdigit()


def legal_onset(cluster):
    if len(cluster) == 0:
        return True
    if len(cluster) == 1:
        return cluster[0] != "NG"
    if len(cluster) == 2:
        return tuple(cluster) in ONSETS_2
    if len(cluster) == 3:
        return tuple(cluster) in ONSETS_3
    return False


def syllabify(phones):
    """phones: [(start_s, end_s, label)] for one word -> [{'onset': s, 'vowel': s}] per syllable."""
    vowels = [i for i, (_, _, p) in enumerate(phones) if is_vowel(p)]
    syllables = []
    for k, v in enumerate(vowels):
        if k == 0:
            first = 0
        else:
            between = list(range(vowels[k - 1] + 1, v))
            first = v
            for j in range(len(between)):
                if legal_onset([phones[i][2] for i in between[j:]]):
                    first = between[j]
                    break
        syllables.append({"onset": phones[first][0], "vowel": phones[v][0]})
    return syllables


def word_key(w):
    w = w.lower().replace("’", "'")
    w = re.sub(r"in'$", "ing", w)
    return re.sub(r"[^a-z]", "", w)


def same_word(a, b):
    """Spelling-tolerant: flowin'/flowing, automatic'ly/automatically."""
    a, b = word_key(a), word_key(b)
    return a == b or SequenceMatcher(None, a, b).ratio() >= 0.8


def word_errors(ref, hyp):
    """Word-level edit distance (for WER only; syllable pairing ignores words)."""
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i]
        for j, h in enumerate(hyp, 1):
            cur.append(min(prev[j - 1] + (not same_word(r, h)), prev[j] + 1, cur[j - 1] + 1))
        prev = cur
    return prev[-1]


def load_mfa(path):
    """MFA json -> [{'word', 'start', 'end', 'syllables'}] (silences dropped)."""
    tiers = json.loads(path.read_text())["tiers"]
    words = [e for e in tiers["words"]["entries"] if e[2] not in SILENCE]
    phones = [e for e in tiers["phones"]["entries"] if e[2] not in SILENCE]
    out = []
    for start, end, label in words:
        ph = [p for p in phones if p[0] >= start - 1e-6 and p[1] <= end + 1e-6]
        out.append({"word": label, "start": start, "end": end, "phones": [p[2] for p in ph],
                    "syllables": syllabify(ph)})
    return out


def add_vpr(mfa, audio):
    """Adds 'vpr' (s), 'vpr_rule' and 'vpr_jump_db' to every syllable of one clip's MFA words."""
    env = vpr.envelope_db(audio)
    prev_vowel = None
    for w in mfa:
        for syl in w["syllables"]:
            # Search back no further than just past the previous syllable's vowel onset.
            earliest = 0 if prev_vowel is None else (prev_vowel + VPR_MIN_GAP_S) * 1000
            t, rule, jump_db = vpr.vpr(env, syl["vowel"] * 1000, earliest)
            syl["vpr"], syl["vpr_rule"], syl["vpr_jump_db"] = t / 1000, rule, round(jump_db, 1)
            prev_vowel = syl["vowel"]


def summarize(errors):
    if not errors:
        return None
    abs_e = [abs(e) for e in errors]
    bias = statistics.fmean(errors)
    return {
        "n": len(errors),
        "bias": bias,
        "mae": statistics.fmean(abs_e),
        "median_ae": statistics.median(abs_e),
        "rmse": statistics.fmean(e * e for e in errors) ** 0.5,
        "sd": statistics.stdev(errors) if len(errors) > 1 else 0.0,
        "mae_debiased": statistics.fmean(abs(e - bias) for e in errors),
        "within_25": sum(a <= 25 for a in abs_e) / len(errors),
        "within_50": sum(a <= 50 for a in abs_e) / len(errors),
        "within_100": sum(a <= 100 for a in abs_e) / len(errors),
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--user-data", required=True)
    p.add_argument("--out", default=str(ROOT / "out"))
    args = p.parse_args()
    out = Path(args.out)

    clips = {c["id"]: c for c in json.loads((ROOT / "clips.json").read_text())["clips"]}
    songs = {s["id"]: s for s in json.loads(Path(args.user_data).read_text())["songs"]}

    rows, clip_info = [], []
    for cid, clip in clips.items():
        ref = [w["text"] for w in clip["words"]]
        whisper_text = json.loads((out / "whisper" / f"{cid}.json").read_text())["normalized"]
        mfa_path = out / "aligned" / cid / f"{cid}.json"
        mfa = load_mfa(mfa_path) if mfa_path.exists() else []
        add_vpr(mfa, ROOT / clip["file"])
        mfa_sylls = [{**syl, "word": w["word"], "syllable_in_word": k, "of": len(w["syllables"]),
                      "phones": " ".join(w["phones"])}
                     for w in mfa for k, syl in enumerate(w["syllables"])]
        n_ref = sum(w["syllables"] for w in clip["words"])
        clip_info.append({"id": cid, "ref": " ".join(ref), "whisper": whisper_text,
                          "aligned": bool(mfa), "mfa": mfa,
                          "wer": word_errors(ref, [w["word"] for w in mfa]) / len(ref),
                          "ref_syllables": n_ref, "mfa_syllables": len(mfa_sylls)})

        for syl in (songs.get(cid) or {}).get("syllables", []):
            if syl.get("clickTimeMs") is None:
                continue
            wi, si = syl["wordIndex"], syl["syllableInWord"]
            row = {"clip": cid, "index": syl["index"], "word": syl["word"],
                   "syllable_in_word": si, "ref_syllables": clip["words"][wi]["syllables"],
                   "click_ms": round(syl["clickTimeMs"], 1), "status": "no_mfa_syllable",
                   "mfa_word": "", "mfa_syllable_in_word": "", "mfa_syllables": ""}
            if syl["index"] < len(mfa_sylls):
                m = mfa_sylls[syl["index"]]
                same = same_word(m["word"], syl["word"]) and m["syllable_in_word"] == si
                row.update(status="same_word" if same else "different_word", mfa_word=m["word"],
                           mfa_syllable_in_word=m["syllable_in_word"], mfa_syllables=m["of"],
                           mfa_phones=m["phones"], vpr_rule=m["vpr_rule"],
                           vpr_jump_db=m["vpr_jump_db"])
                for a in ANCHORS:
                    t = m[a] * 1000
                    row[f"mfa_{a}_ms"] = round(t, 1)
                    row[f"err_{a}_ms"] = round(t - syl["clickTimeMs"], 1)
            rows.append(row)

    fields = ["clip", "index", "word", "syllable_in_word", "ref_syllables", "click_ms", "status",
              "mfa_word", "mfa_syllable_in_word", "mfa_syllables", "mfa_phones",
              "vpr_rule", "vpr_jump_db"]
    fields += [f"{k}_{a}_ms" for a in ANCHORS for k in ("mfa", "err")]
    with open(out / "syllables.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

    write_report(out / "report.md", rows, clip_info, args.user_data)
    scored = [r for r in rows if "err_onset_ms" in r]
    subsets = (("All scored", scored), ("Same word on both sides", [r for r in scored if r["status"] == "same_word"]))
    # Reference for VPR: the vowel onset moved by a constant. Each syllable's shift is the mean
    # bias of all the *other* syllables, so the shift isn't fitted to the syllable it's scored on.
    total = sum(r["err_vowel_ms"] for r in scored)
    for r in scored:
        r["err_vowel_shift_ms"] = r["err_vowel_ms"] - (total - r["err_vowel_ms"]) / (len(scored) - 1)
    summaries = [{"subset": name, "anchor": a, "stats": summarize([r[f"err_{a}_ms"] for r in sub])}
                 for name, sub in subsets for a in ANCHORS + ("vowel_shift",)]
    by_rule = [(f"{label} (rule: {rule})", [r for r in scored if r["vpr_rule"] == rule])
               for rule, label in (("jump", f"Burst ≥ {vpr.JUMP_MIN_DB:g} dB"),
                                   ("shift", "No clear burst"))]
    comparison = [compare_vpr(name, sub, base)
                  for base in ("vowel", "vowel_shift")
                  for name, sub in subsets[:1] + tuple(by_rule) if sub]
    report_html.write(out / "report.html", rows, clip_info, clips, args.user_data, summaries,
                      comparison)
    print((out / "report.md").read_text())


def compare_vpr(name, rows, base):
    """Paired, per-syllable comparison of VPR against a baseline anchor."""
    before = [abs(r[f"err_{base}_ms"]) for r in rows]
    after = [abs(r["err_vpr_ms"]) for r in rows]
    change = [a - b for a, b in zip(after, before)]
    return {
        "subset": name, "n": len(rows), "base": base,
        "vowel": summarize([r[f"err_{base}_ms"] for r in rows]),
        "vpr": summarize([r["err_vpr_ms"] for r in rows]),
        "median_change": statistics.median(change),
        "mean_change": statistics.fmean(change),
        "better": sum(c < -VPR_TIE_MS for c in change),
        "same": sum(abs(c) <= VPR_TIE_MS for c in change),
        "worse": sum(c > VPR_TIE_MS for c in change),
    }


def fmt_summary(s):
    if s is None:
        return "| – | – | – | – | – | – | – | – |"
    return (f"| {s['n']} | {s['bias']:+.0f} | {s['median_ae']:.0f} | {s['mae']:.0f} | "
            f"{s['mae_debiased']:.0f} | {s['within_25']:.0%} | {s['within_50']:.0%} | "
            f"{s['within_100']:.0%} |")


def fmt_mfa(r):
    if not r["mfa_word"]:
        return ""
    return f"{r['mfa_word']} ({r['mfa_syllable_in_word'] + 1}/{r['mfa_syllables']})"


def write_report(path, rows, clip_info, user_data):
    scored = [r for r in rows if "err_onset_ms" in r]
    exact = [r for r in scored if r["status"] == "same_word"]
    total = len(rows)
    header = ("| n | bias (ms) | median \\|err\\| | mean \\|err\\| | mean \\|err\\| after "
              "removing bias | ≤25 ms | ≤50 ms | ≤100 ms |\n|---|---|---|---|---|---|---|---|")
    L = ["# Whisper → MFA vs. manual click alignments", "",
         f"Manual data: `{user_data}`. Error = MFA time − click time (positive = MFA later).", "",
         "## Coverage", "",
         f"- Manual clicks: {total}",
         "- Pairing: the nth click is compared with MFA's nth syllable in the line; "
         "word boundaries are ignored.",
         f"- Scored (MFA has a syllable at that position): {len(scored)} "
         f"({len(scored) / total:.0%})",
         f"  - paired syllable is the same syllable of the same word: {len(exact)}",
         f"  - paired syllable belongs to a different word: {len(scored) - len(exact)}"]
    n = total - len(scored)
    if n:
        L.append(f"- Not scored, MFA ran out of syllables: {n}")
    off = [c for c in clip_info if c["ref_syllables"] != c["mfa_syllables"]]
    for c in off:
        L.append(f"- **{c['id']}: {c['ref_syllables']} lyric syllables vs {c['mfa_syllables']} "
                 "MFA syllables**, so positional pairing drifts after the first difference")

    for title, subset in (("All scored syllables", scored), ("Same word on both sides", exact)):
        L += ["", f"## Timing error: {title.lower()}", ""]
        for a in ANCHORS:
            L += [f"**{ANCHOR_NAMES[a]} vs click**", "", header,
                  fmt_summary(summarize([r[f"err_{a}_ms"] for r in subset])), ""]

    L += ["## Per clip (all scored syllables, vowel-onset anchor, then syllable-onset anchor)", "",
          "| clip | WER | syllables (lyrics/MFA) | scored | bias vowel | median \\|err\\| vowel | bias onset | "
          "median \\|err\\| onset |", "|---|---|---|---|---|---|---|---|"]
    for c in clip_info:
        sub = [r for r in scored if r["clip"] == c["id"]]
        sv = summarize([r["err_vowel_ms"] for r in sub])
        so = summarize([r["err_onset_ms"] for r in sub])
        n_clicks = sum(r["clip"] == c["id"] for r in rows)
        cells = (f"{sv['bias']:+.0f} | {sv['median_ae']:.0f} | {so['bias']:+.0f} | "
                 f"{so['median_ae']:.0f}") if sv else "– | – | – | –"
        L.append(f"| {c['id']} | {c['wer']:.0%} | {c['ref_syllables']}/{c['mfa_syllables']} | "
                 f"{len(sub)}/{n_clicks} | {cells} |")

    L += ["", "## Transcripts and syllable pairing", ""]
    for c in clip_info:
        L += [f"### {c['id']}", "", f"- lyrics:  `{c['ref']}`", f"- whisper: `{c['whisper']}`"]
        if not c["aligned"]:
            L.append("- **MFA produced no alignment for this clip**")
        L.append("")
        L += ["| click | lyric syllable | MFA syllable | phones | status | click ms | onset err | "
              "vowel err |", "|---|---|---|---|---|---|---|---|"]
        for r in (r for r in rows if r["clip"] == c["id"]):
            eo, ev = r.get("err_onset_ms"), r.get("err_vowel_ms")
            L.append(f"| {r['index']} | {r['word']} ({r['syllable_in_word'] + 1}/"
                     f"{r['ref_syllables']}) | {fmt_mfa(r)} | {r.get('mfa_phones', '')} | "
                     f"{r['status']} | {r['click_ms']:.0f} | "
                     f"{'' if eo is None else f'{eo:+.0f}'} | {'' if ev is None else f'{ev:+.0f}'} |")
        L.append("")
    path.write_text("\n".join(L))


if __name__ == "__main__":
    main()
