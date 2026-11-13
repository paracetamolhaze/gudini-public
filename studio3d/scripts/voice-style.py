"""
Measures how a voice is delivered, to match two voices to a reference by numbers, not by ear:
  voiced  — share of speech frames that are voiced (a whisper has almost none)
  hnr     — harmonics-to-noise in dB (breathy, ASMR-like speech is low)
  tilt    — energy 4–8 kHz against 0.3–2 kHz in dB (soft speech has little top)
  range   — spread of pitch in semitones (calm, intimate speech is narrow)
  f0      — median pitch, Hz
  python -I scripts/voice-style.py <file>[@start-end[,start-end…]] …
"""
import subprocess
import sys

import numpy as np

RATE = 16000


def pcm(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def measure(x):
    n, hop = 640, 160
    frames = np.array([x[i : i + n] for i in range(0, len(x) - n, hop)])
    rms = np.sqrt((frames**2).mean(axis=1))
    speech = frames[rms > max(0.01, np.percentile(rms, 50) * 0.5)]
    win = np.hanning(n)
    f0, hnr, voiced = [], [], 0
    lo, hi = int(RATE / 400), int(RATE / 60)
    for fr in speech:
        w = fr * win
        ac = np.correlate(w, w, "full")[n - 1 :]
        if ac[0] <= 0:
            continue
        k = lo + int(np.argmax(ac[lo:hi]))
        r = ac[k] / ac[0]
        if r > 0.45:
            voiced += 1
            f0.append(RATE / k)
            hnr.append(10 * np.log10(r / max(1e-3, 1 - r)))
    spec = np.abs(np.fft.rfft(speech * win, axis=1)) ** 2
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    low = spec[:, (freqs >= 300) & (freqs < 2000)].sum()
    top = spec[:, (freqs >= 4000) & (freqs < 8000)].sum()
    st = 12 * np.log2(np.array(f0) / np.median(f0)) if f0 else np.array([0])
    return {
        "voiced": round(voiced / max(1, len(speech)), 2),
        "hnr": round(float(np.median(hnr)) if hnr else 0, 1),
        "tilt": round(float(10 * np.log10(top / low)), 1),
        "range": round(float(np.percentile(st, 90) - np.percentile(st, 10)), 1),
        "f0": round(float(np.median(f0)) if f0 else 0),
    }


for arg in sys.argv[1:]:
    path, _, spans = arg.partition("@")
    x = pcm(path)
    if spans:
        parts = []
        for span in spans.split(","):
            a, b = (float(v) for v in span.split("-"))
            parts.append(x[int(a * RATE) : int(b * RATE)])
        x = np.concatenate(parts)
    m = measure(x)
    print(f"{path.split('/')[-1][:34]:34} voiced {m['voiced']:.2f}  hnr {m['hnr']:5.1f} dB  tilt {m['tilt']:6.1f} dB  range {m['range']:4.1f} st  f0 {m['f0']} Hz")
