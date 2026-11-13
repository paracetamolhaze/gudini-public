"""
Ranks ElevenLabs library voices by how close they sound to a reference recording:
median pitch and the long-term average spectrum (mel bands) of voiced frames.
  python -I scripts/voice-match.py <reference.wav> <candidates.json> <work dir>
Writes <work dir>/ranking.json, best first. Only public preview files are downloaded.
"""
import json
import os
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

RATE = 16000


def pcm(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def mel_filters(n_fft=512, n_mels=40):
    def hz2mel(f):
        return 2595 * np.log10(1 + f / 700)

    def mel2hz(m):
        return 700 * (10 ** (m / 2595) - 1)

    mels = np.linspace(hz2mel(60), hz2mel(7600), n_mels + 2)
    bins = np.floor((n_fft + 1) * mel2hz(mels) / RATE).astype(int)
    fb = np.zeros((n_mels, n_fft // 2 + 1))
    for i in range(n_mels):
        a, b, c = bins[i], bins[i + 1], bins[i + 2]
        for k in range(a, b):
            fb[i, k] = (k - a) / max(1, b - a)
        for k in range(b, c):
            fb[i, k] = (c - k) / max(1, c - b)
    return fb


FB = mel_filters()


def features(x):
    n, hop = 512, 256
    frames = [x[i : i + n] * np.hanning(n) for i in range(0, len(x) - n, hop)]
    if not frames:
        return None
    frames = np.array(frames)
    rms = np.sqrt((frames**2).mean(axis=1))
    voiced = frames[rms > max(0.02, np.percentile(rms, 40))]
    if len(voiced) < 20:
        return None
    spec = np.abs(np.fft.rfft(voiced, axis=1)) ** 2
    lmel = np.log(spec @ FB.T + 1e-9)
    ltas = lmel.mean(axis=0)
    ltas = ltas - ltas.mean()
    f0 = []
    for fr in voiced[:: 2]:
        ac = np.correlate(fr, fr, "full")[n - 1 :]
        lo, hi = int(RATE / 400), int(RATE / 60)
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] / (ac[0] + 1e-9) > 0.45:
            f0.append(RATE / k)
    return {"ltas": ltas, "f0": float(np.median(f0)) if f0 else 0.0}


def main():
    ref_path, cand_path, work = sys.argv[1:4]
    os.makedirs(work, exist_ok=True)
    ref = features(pcm(ref_path))
    cands = json.load(open(cand_path, encoding="utf-8"))

    def score(c):
        url = c.get("preview_url")
        if not url:
            return None
        path = os.path.join(work, c["voice_id"] + ".mp3")
        try:
            if not os.path.exists(path):
                urllib.request.urlretrieve(url, path)
            f = features(pcm(path))
        except Exception:
            return None
        if not f or not f["f0"]:
            return None
        cos = float(np.dot(ref["ltas"], f["ltas"]) / (np.linalg.norm(ref["ltas"]) * np.linalg.norm(f["ltas"]) + 1e-9))
        pitch = abs(np.log2(f["f0"] / ref["f0"]))  # octaves apart
        return {**c, "f0": round(f["f0"]), "timbre": round(cos, 3), "score": round(cos - 1.5 * pitch, 3)}

    with ThreadPoolExecutor(8) as pool:
        ranked = [r for r in pool.map(score, cands) if r]
    ranked.sort(key=lambda r: -r["score"])
    json.dump(ranked, open(os.path.join(work, "ranking.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"reference f0 {ref['f0']:.0f} Hz, scored {len(ranked)} voices")
    for r in ranked[:10]:
        print(r["score"], r["timbre"], r["f0"], r["voice_id"], (r.get("name") or "")[:40], "|", (r.get("descriptive") or ""), (r.get("use_case") or ""))


main()
