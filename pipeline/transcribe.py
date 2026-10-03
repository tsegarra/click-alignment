"""Step 1: transcribe each clip with Whisper and build an MFA corpus from the transcripts.

The lyrics in clips.json are deliberately NOT used here; MFA only ever sees Whisper's words.

Writes, per clip:
  out/whisper/<id>.json        raw Whisper result
  out/corpus/<id>/<id>.wav     audio (one directory per clip, so MFA treats each as its own speaker)
  out/corpus/<id>/<id>.lab     normalized Whisper transcript
"""

import argparse
import json
import re
import shutil
from pathlib import Path

import whisper
from num2words import num2words

ROOT = Path(__file__).resolve().parent.parent


def normalize(text):
    """Whisper text -> lowercase, dictionary-friendly tokens for MFA."""
    text = text.lower().replace("’", "'")

    def spell(m):
        num, suffix = m.group(1), m.group(2)
        return num2words(int(num), to="ordinal" if suffix else "cardinal")

    text = re.sub(r"(\d+)(st|nd|rd|th)?\b", spell, text)
    text = re.sub(r"[-–—]", " ", text)
    text = re.sub(r"[^a-z' ]", " ", text)
    words = [w.strip("'") for w in text.split()]
    return " ".join(w for w in words if w)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="large-v3")
    p.add_argument("--out", default=str(ROOT / "out"))
    args = p.parse_args()

    out = Path(args.out)
    (out / "whisper").mkdir(parents=True, exist_ok=True)
    clips = json.loads((ROOT / "clips.json").read_text())["clips"]

    model = whisper.load_model(args.model, device="cpu")
    for clip in clips:
        result = model.transcribe(
            str(ROOT / clip["file"]),
            language="en",
            temperature=0.0,
            condition_on_previous_text=False,
            fp16=False,
        )
        result["model"] = args.model
        result["normalized"] = normalize(result["text"])
        (out / "whisper" / f"{clip['id']}.json").write_text(json.dumps(result, indent=2))

        spk = out / "corpus" / clip["id"]
        spk.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / clip["file"], spk / f"{clip['id']}.wav")
        (spk / f"{clip['id']}.lab").write_text(result["normalized"] + "\n")
        print(f"{clip['id']:28s} {result['normalized']}")


if __name__ == "__main__":
    main()
