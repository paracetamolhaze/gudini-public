# Какой дубль голоса ближе к образцу (news/voice/reference.mp3, его владелец одобрил на слух): тембр (средний спектр
# громких кадров) и высота голоса. Печатает JSON [{file, score}] от лучшего.
import json, sys
import numpy as np, librosa

def feats(path):
    y, sr = librosa.load(path, sr=16000, mono=True)
    S = librosa.feature.melspectrogram(y=y, sr=sr, n_fft=512, hop_length=160, n_mels=40, fmin=60, fmax=7600)
    lm = np.log(S + 1e-9)
    rms = librosa.feature.rms(y=y, frame_length=512, hop_length=160)[0][: lm.shape[1]]
    loud = 20 * np.log10(rms + 1e-9) > np.percentile(20 * np.log10(rms + 1e-9), 60)
    ltas = lm[:, loud].mean(1)
    ltas -= ltas.mean()
    f0 = librosa.pyin(y, fmin=60, fmax=300, sr=sr, frame_length=1024, hop_length=160)[0]
    return ltas, float(np.nanmedian(f0))

ref_l, ref_f = feats(sys.argv[1])
out = []
for path in sys.argv[2:]:
    l, f = feats(path)
    # высоту голоса не нашёл (дубль шёпотом или сорвался) — такой дубль последний, а не NaN, который ломает JSON
    pitch = abs(f - ref_f) / 40 if np.isfinite(f) else 10.0
    out.append({"file": path, "score": float(np.sqrt(np.mean((l - ref_l) ** 2)) + pitch)})
print(json.dumps(sorted(out, key=lambda x: x["score"])))
