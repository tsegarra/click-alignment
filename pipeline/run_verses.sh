#!/usr/bin/env bash
# Whisper (to locate the lyrics) -> MFA on full_verses/<id>.txt -> VPR, one page per verse in out/verses/.
#
#   pipeline/run_verses.sh                     # everything
#   SKIP_WHISPER=1 pipeline/run_verses.sh      # reuse out/verses/whisper (e.g. after editing lyrics)
#   SKIP_MFA=1 pipeline/run_verses.sh          # only rebuild the pages (e.g. after changing vpr.py)
set -euo pipefail
cd "$(dirname "$0")/.."

WHISPER_PY=${WHISPER_PY:-.venv-whisper/bin/python}
MFA_ENV=${MFA_ENV:-aligner}

if [[ -z "${SKIP_WHISPER:-}${SKIP_MFA:-}" ]]; then
  "$WHISPER_PY" pipeline/transcribe_verses.py --model "${WHISPER_MODEL:-large-v3}"
fi

# Unlike the 2.5 s clips, each verse gives MFA minutes of one speaker, so speaker adaptation stays on.
if [[ -z "${SKIP_MFA:-}" ]]; then
  rm -rf out/verses/corpus out/verses/aligned
  "$WHISPER_PY" pipeline/lyrics_corpus.py
  conda run --no-capture-output -n "$MFA_ENV" mfa align out/verses/corpus english_us_arpa english_us_arpa out/verses/aligned \
    --g2p_model_path english_us_arpa \
    --output_format json \
    --beam 100 --retry_beam 400 \
    --clean --quiet
fi

python3 pipeline/verses.py
echo "open http://localhost:8765/out/verses/index.html (python3 -m http.server 8765)"
