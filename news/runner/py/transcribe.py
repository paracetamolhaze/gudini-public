# Речь ролика героя по словам: язык, слова с таймингами, фразы. Локально, faster-whisper на процессоре.
import json, sys
from faster_whisper import WhisperModel

src, out = sys.argv[1], sys.argv[2]
model = WhisperModel("small", device="cpu", compute_type="int8")
segments, info = model.transcribe(src, word_timestamps=True, vad_filter=True, condition_on_previous_text=False)
words, phrases = [], []
for s in segments:
    phrases.append({"s": round(s.start, 2), "e": round(s.end, 2), "text": s.text.strip()})
    for w in s.words or []:
        words.append({"w": w.word.strip(), "s": round(w.start, 2), "e": round(w.end, 2)})
json.dump({"language": info.language, "probability": round(info.language_probability, 2), "phrases": phrases, "words": words}, open(out, "w", encoding="utf8"), ensure_ascii=False)
