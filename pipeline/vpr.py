"""Vowel Plus Rules (VPR): refine MFA's vowel onset using the clip's amplitude envelope.

  jump    Find the steepest upward step in loudness (over JUMP_STEP_MS) between the previous
          syllable and this vowel's loudness peak. If it climbs at least JUMP_MIN_DB, it is a
          burst (a stop's release, a vowel bursting out of silence): mark where it crosses the
          halfway point of the step.
  shift   Otherwise there is no clear burst, so take MFA's vowel onset moved VOWEL_SHIFT_MS
          earlier (MFA's mean lateness against the manual clicks).

Constants are frozen so the rule can be scored on held-out clips without refitting. They were
chosen on the 82 clicks in user-data/alignments-2026-10-03.json:
  - VOWEL_SHIFT_MS is the mean MFA vowel-onset error on those clicks (+21 ms).
  - JUMP_MIN_DB = 15 was proposed before scoring; 12-20 dB scored about the same.

Standard library only.
"""

import math
import wave
from array import array

WINDOW_MS = 5          # RMS window; the envelope has one value per millisecond
PEAK_SEARCH_MS = 40    # how far after MFA's vowel time to look for the vowel's loudness peak
MAX_BACK_MS = 200      # never search further back than this from the peak
JUMP_STEP_MS = 10      # a "jump" is the rise in level across this span
JUMP_MIN_DB = 15.0     # smaller jumps are not trusted; fall back to the shift
VOWEL_SHIFT_MS = 21.0  # fallback: MFA's vowel onset moved this much earlier


def envelope_db(path, window_ms=WINDOW_MS):
    """Mono 16-bit wav -> RMS level in dB, one value per millisecond (centered window)."""
    with wave.open(str(path)) as w:
        assert w.getsampwidth() == 2, f"{path}: expected 16-bit audio"
        rate, channels = w.getframerate(), w.getnchannels()
        samples = array("h", w.readframes(w.getnframes()))[::channels]
    cum = [0.0]
    for s in samples:
        cum.append(cum[-1] + s * s)
    n, half = len(samples), max(1, int(rate * window_ms / 2000))
    env = []
    for ms in range(int(n / rate * 1000)):
        c = int(ms * rate / 1000)
        a, b = max(0, c - half), min(n, c + half)
        env.append(10 * math.log10((cum[b] - cum[a]) / (b - a) + 1))
    return env


def steepest_jump(env, vowel_ms, earliest_ms=0):
    """-> (time_ms, size_db): the halfway point of the steepest JUMP_STEP_MS rise before the
    vowel's loudness peak, searching back no further than earliest_ms."""
    v = min(int(round(vowel_ms)), len(env) - 1)
    peak = max(range(v, min(len(env), v + PEAK_SEARCH_MS + 1)), key=env.__getitem__)
    peak = max(peak, JUMP_STEP_MS)
    lo = min(max(0, int(earliest_ms), peak - MAX_BACK_MS) + JUMP_STEP_MS, peak)
    end = max(range(lo, peak + 1), key=lambda t: env[t] - env[t - JUMP_STEP_MS])
    bottom, top = env[end - JUMP_STEP_MS], env[end]
    mid = next(t for t in range(end - JUMP_STEP_MS, end + 1) if env[t] >= (bottom + top) / 2)
    return mid, top - bottom


def vpr(env, vowel_ms, earliest_ms=0):
    """-> (time_ms, rule, jump_db). earliest_ms bounds the search (the previous syllable)."""
    t, size = steepest_jump(env, vowel_ms, earliest_ms)
    if size >= JUMP_MIN_DB:
        return float(t), "jump", size
    return vowel_ms - VOWEL_SHIFT_MS, "shift", size
