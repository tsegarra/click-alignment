"""Full-verse step 1: transcribe each wav in full_verses/ with Whisper, with word timestamps.

The transcript is not what MFA aligns: lyrics_corpus.py uses Whisper's word times only to find
where each line of the verse's lyrics (full_verses/<id>.txt) is in the recording.

Writes out/verses/whisper/<id>.json (raw Whisper result) per verse.
"""

import argparse
import json
from pathlib import Path

import whisper

from transcribe import normalize

ROOT = Path(__file__).resolve().parent.parent


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="large-v3")
    p.add_argument("--audio", default=str(ROOT / "full_verses"))
    p.add_argument("--out", default=str(ROOT / "out" / "verses"))
    p.add_argument("--only", nargs="*", help="verse ids (wav names without .wav)")
    args = p.parse_args()

    out = Path(args.out)
    (out / "whisper").mkdir(parents=True, exist_ok=True)
    files = sorted(Path(args.audio).glob("*.wav"))
    if args.only:
        files = [f for f in files if f.stem in args.only]

    model = whisper.load_model(args.model, device="cpu")
    for f in files:
        vid = f.stem
        result = model.transcribe(
            str(f),
            language="en",
            temperature=0.0,
            condition_on_previous_text=False,
            word_timestamps=True,  # lyrics_corpus.py places the lyrics by these
            hallucination_silence_threshold=2.0,
            fp16=False,
        )
        result["model"] = args.model
        result["normalized"] = normalize(result["text"])
        (out / "whisper" / f"{vid}.json").write_text(json.dumps(result, indent=2))

        print(f"{vid:28s} {len(result['segments'])} segments  {result['normalized'][:80]}…",
              flush=True)


if __name__ == "__main__":
    main()
