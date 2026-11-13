# Лица на кадре — рамки [x, y, w, h] в пикселях кадра 1080×1920. По ним мем или вставка встаёт туда, где лиц нет
# (владелец 30.10 о Копатыче: коала легла прямо на лицо). Детектор InsightFace (SCRFD, ~/.insightface/models/buffalo_l)
# видит и лица вполоборота; без него — Haar анфас и профиль, как vertical.py.
#   python faces.py <кадр.jpg>
import contextlib
import json
import sys

import cv2

img = cv2.imread(sys.argv[1])
h, w = img.shape[:2]
k = 1080 / w


def scrfd():
    from insightface.app import FaceAnalysis

    app = FaceAnalysis(name="buffalo_l", allowed_modules=["detection"], providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=-1, det_size=(640, 640), det_thresh=0.4)
    return [(f.bbox[0], f.bbox[1], f.bbox[2] - f.bbox[0], f.bbox[3] - f.bbox[1]) for f in app.get(img)]


def haar():
    gray = cv2.equalizeHist(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    face = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    prof = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
    size = (int(w * 0.08), int(w * 0.08))
    boxes = [tuple(b) for b in face.detectMultiScale(gray, 1.1, 5, minSize=size)]
    boxes += [tuple(b) for b in prof.detectMultiScale(gray, 1.1, 5, minSize=size)]
    for x, y, bw, bh in prof.detectMultiScale(cv2.flip(gray, 1), 1.1, 5, minSize=size):
        boxes.append((w - x - bw, y, bw, bh))
    return boxes


# InsightFace печатает служебные строки в stdout — ответ скрипта только последней строкой JSON
try:
    with contextlib.redirect_stdout(sys.stderr):
        boxes = scrfd()
except Exception:
    boxes = haar()
print(json.dumps([[int(v * k) for v in b] for b in boxes]))
