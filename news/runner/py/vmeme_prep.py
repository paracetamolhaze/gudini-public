"""Видеомемы библиотеки — без размытых полей и, где это люди, без фона (владелец 1.11: «видео мемы нужно все обрезать,
они не вертикальные, а лучше убрать фоны и накладывать на видео»).

Файл мема — 1080×1920: сам кадр мема посередине, сверху и снизу его размытая копия (иногда ещё чёрные полосы внутри).
Для каждого мема: полоса резкого кадра (по резкости строк на нескольких кадрах) → обрезанный мем crop/<id>.mp4 со
звуком → RobustVideoMatting → cut/<id>.webm (VP9 с прозрачностью) и доля кадра под человеком по кадрам. Печатает JSON
по мему в строку: {"id","band":[y0,y1],"crop","cut","cover":[мин, медиана, макс],"whole"} — whole: человек целиком
в кадре, только тогда монтаж ставит вырезку (иначе карточку).

python -I vmeme_prep.py <папка мемов> <rvm .onnx> [id ...]
RobustVideoMatting — GPL-3.0, здесь внутренний инструмент, не распространяется.
"""
import json
import os
import subprocess
import sys
import time

import numpy as np
import onnxruntime as ort

W, H = 1080, 1920


def probe(path: str) -> tuple[int, int, float, float]:
    out = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                   "stream=width,height,r_frame_rate:format=duration", "-of", "json", path])
    info = json.loads(out)
    s = info["streams"][0]
    num, den = s["r_frame_rate"].split("/")
    return int(s["width"]), int(s["height"]), float(num) / float(den), float(info["format"]["duration"])


def gray(path: str, t: float) -> np.ndarray:
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", path, "-frames:v", "1",
                                   "-vf", f"scale={W}:{H},format=gray", "-f", "rawvideo", "-"])
    return np.frombuffer(raw, dtype=np.uint8).reshape(H, W).astype(np.float32)


def band(path: str, duration: float) -> tuple[int, int]:
    """
    Полоса резкого кадра: строки с мелкими деталями, без размытых полей и чёрных полос. Мем стоит посередине файла,
    поэтому полоса достраивается симметрично относительно середины: у «Так можно было» гладкий фон над головой резким
    не считался, и обрезка оставляла один свитер. Чёрные строки по краям потом срезаются.
    """
    rows = []
    means = []
    for k in (0.25, 0.5, 0.75):
        g = gray(path, duration * k)
        sharp = np.abs(np.diff(g, axis=1)).mean(axis=1)
        dark = g.mean(axis=1) < 14
        rows.append(np.where(dark, 0.0, sharp))
        means.append(g.mean(axis=1))
    lit = np.max(means, axis=0) >= 14
    sharp = np.max(rows, axis=0)
    thr = max(0.15, 0.5 * np.percentile(sharp, 90))
    good = sharp > thr
    # самый длинный кусок резких строк, разрывы до 12 строк не считаются
    best, start, gap = (0, 0), None, 0
    for y in range(H + 1):
        on = y < H and good[y]
        if on:
            if start is None:
                start = y
            gap = 0
        elif start is not None:
            gap += 1
            if gap > 12 or y == H:
                end = y - gap + 1
                if end - start > best[1] - best[0]:
                    best = (start, end)
                start, gap = None, 0
    y0, y1 = min(best[0], H - best[1]), max(best[1], H - best[0])
    while y0 < y1 and not lit[y0]:
        y0 += 1
    while y1 > y0 and not lit[y1 - 1]:
        y1 -= 1
    y0 -= y0 % 2
    y1 -= (y1 - y0) % 2
    return y0, y1


def matte(src: str, out: str, model: str) -> tuple[list[float], bool]:
    """Маска по кадрам; whole — человек целиком в кадре мема: макушка не касается верха, бока — краёв (владелец 1.11
    о Докторе Зло: «очень плохо обрезан» — срезанная ровной линией макушка). Нижний край может касаться: вырезка
    стоит на низу экрана."""
    w, h, fps, _ = probe(src)
    whole = True
    session = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    rec = [np.zeros([1, 1, 1, 1], dtype=np.float32)] * 4
    ratio = np.array([0.4], dtype=np.float32)
    reader = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    writer = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}", "-r", f"{fps}",
                               "-i", "-", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "24",
                               "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-auto-alt-ref", "0", out], stdin=subprocess.PIPE)
    cover = []
    size = w * h * 3
    while True:
        raw = reader.stdout.read(size)
        if len(raw) < size:
            break
        rgb = np.frombuffer(raw, dtype=np.uint8).reshape(h, w, 3)
        x = (rgb.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        _, pha, *rec = session.run(None, {"src": x, "r1i": rec[0], "r2i": rec[1], "r3i": rec[2], "r4i": rec[3], "downsample_ratio": ratio})
        a = np.clip(pha[0, 0], 0.0, 1.0)
        m = a > 0.5
        cover.append(float(m.mean()))
        if m.sum() > 50:
            rows, cols = np.where(m.any(1))[0], np.where(m.any(0))[0]
            if rows[0] < 0.03 * h or m[:3].mean() > 0 or cols[0] <= 0.02 * w or cols[-1] >= 0.98 * w:
                whole = False
        writer.stdin.write(np.dstack([rgb, (a * 255.0 + 0.5).astype(np.uint8)]).tobytes())
    writer.stdin.close()
    writer.wait()
    reader.wait()
    return cover, whole


def main() -> None:
    folder, model, *only = sys.argv[1:]
    catalog = json.load(open(os.path.join(folder, "videos.json"), encoding="utf-8"))["videos"]
    os.makedirs(os.path.join(folder, "crop"), exist_ok=True)
    os.makedirs(os.path.join(folder, "cut"), exist_ok=True)
    for v in catalog:
        if only and v["id"] not in only:
            continue
        path = os.path.join(folder, v["file"])
        started = time.time()
        _, _, _, duration = probe(path)
        y0, y1 = band(path, duration)
        crop = os.path.join("crop", f"{v['id']}.mp4")
        subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-i", path, "-vf", f"crop={W}:{y1 - y0}:0:{y0}",
                               "-c:v", "libx264", "-crf", "17", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "copy",
                               os.path.join(folder, crop)])
        cut = os.path.join("cut", f"{v['id']}.webm")
        cover, whole = matte(os.path.join(folder, crop), os.path.join(folder, cut), model)
        c = sorted(cover) or [0.0]
        print(json.dumps({"id": v["id"], "band": [y0, y1], "crop": crop.replace(os.sep, "/"), "cut": cut.replace(os.sep, "/"),
                          "cover": [round(c[0], 3), round(c[len(c) // 2], 3), round(c[-1], 3)], "whole": whole, "seconds": round(time.time() - started, 1)},
                         ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
