# Вырезает вставку с зелёного фона: python cutout.py <картинка> <out.png>
# GPT рисует один предмет на сплошном зелёном; здесь фон становится прозрачным, зелёная кайма снимается, картинка
# обрезается по предмету. Печатает {"w","h","share"} — share: какая доля кадра занята предметом (меньше 3% — не вышло).
import json
import sys

import numpy as np
from PIL import Image


def main():
    src, out = sys.argv[1:3]
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    green = g - np.maximum(r, b)
    # фон — чистый зелёный; по краю предмета прозрачность плавная
    alpha = np.clip(1 - (green - 40) / 60, 0, 1)
    # кайма: зелёный, просочившийся в край, гасится до соседних каналов
    spill = (green > 0) & (alpha > 0)
    g2 = np.where(spill, np.maximum(r, b) + np.minimum(green, 0), g)
    rgba = np.dstack([r, g2, b, alpha * 255]).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA")
    box = img.getchannel("A").point(lambda v: 255 if v > 30 else 0).getbbox()
    if not box:
        print(json.dumps({"w": 0, "h": 0, "share": 0}))
        return
    img = img.crop(box)
    share = float((alpha > 0.5).mean())
    img.save(out)
    print(json.dumps({"w": img.width, "h": img.height, "share": round(share, 3)}))


if __name__ == "__main__":
    main()
