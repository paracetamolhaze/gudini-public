"""Слышны ли все слова в дублях голоса автора (владелец 1.11: «вот эта казашка» — «слышится казака»; ElevenLabs
проглотил слово в самом дубле). Каждый дубль распознаётся faster-whisper, и для каждого слова текста ищется похожее
в услышанном: совпадают первые буквы основы. Числа не сверяются — их распознавание пишет цифрами.

python -I heard.py <текст.txt> <дубль> [дубль ...]  →  JSON [{"file","missed":["казашка"]}]
"""
import json
import re
import sys

from faster_whisper import WhisperModel

NUM = re.compile(r"^(ноль|один|одна|одно|одного|одной|два|две|двух|три|трёх|трех|четыр|пят|шест|сем|восем|девят|десят|"
                 r"одиннадц|двенадц|тринадц|двадцат|тридцат|сорок|девяност|сто|двест|трист|тысяч|миллион|миллиард|полтор|"
                 r"перв|втор|трет|четвёрт|четверт)")


def norm(word: str) -> str:
    return re.sub(r"[^a-zа-я0-9]", "", word.lower().replace("ё", "е"))


def main() -> None:
    text = open(sys.argv[1], encoding="utf8").read()
    model = WhisperModel("small", device="cpu", compute_type="int8")
    out = []
    for f in sys.argv[2:]:
        segs, _ = model.transcribe(f, language="ru", vad_filter=False, condition_on_previous_text=False)
        heard = [norm(w) for s in segs for w in s.text.split()]
        heard = [w for w in heard if w]
        missed = []
        for raw in text.split():
            w = norm(raw)
            # короткие слова whisper путает и сам; сверяются слова от 5 букв, кроме чисел
            if len(w) < 5 or NUM.match(w) or not re.match(r"^[а-я]", w):
                continue
            stem = w[: max(4, len(w) - 2)]
            if not any(h.startswith(stem) or w.startswith(h[: max(4, len(h) - 2)]) and len(h) >= 5 for h in heard):
                missed.append(raw.strip("«»\"“”.,:;!?…()"))
        out.append({"file": f, "missed": missed})
    print(json.dumps(out))


if __name__ == "__main__":
    main()
