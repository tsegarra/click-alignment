#!/usr/bin/env bash
# Whisper -> MFA -> comparison against the manual click alignments.
#
#   pipeline/run.sh                     # everything
#   SKIP_WHISPER=1 pipeline/run.sh      # reuse out/corpus (e.g. after hand-checking transcripts)
#   WHISPER_MODEL=medium.en pipeline/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."

WHISPER_PY=${WHISPER_PY:-.venv-whisper/bin/python}
MFA_ENV=${MFA_ENV:-aligner}  # conda env with montreal-forced-aligner
USER_DATA=${USER_DATA:-$(ls -t user-data/*.json | head -1)}

if [[ -z "${SKIP_WHISPER:-}" ]]; then
  rm -rf out/corpus
  "$WHISPER_PY" pipeline/transcribe.py --model "${WHISPER_MODEL:-large-v3}"
fi

# Clips are ~2.5 s each, too short for per-speaker adaptation to help, so it is turned off.
rm -rf out/aligned
conda run --no-capture-output -n "$MFA_ENV" mfa align out/corpus english_us_arpa english_us_arpa out/aligned \
  --g2p_model_path english_us_arpa \
  --output_format json \
  --uses_speaker_adaptation false \
  --beam 100 --retry_beam 400 \
  --clean --quiet

python3 pipeline/evaluate.py --user-data "$USER_DATA"
