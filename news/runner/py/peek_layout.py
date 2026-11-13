# Раскладка вставки «владелец поднимается снизу»:
#   python peek_layout.py <figure.png> <shots.json> <preview.jpg>
# shots.json — планы, на которые он попадает: [{"frame","view":[scale,tx,ty],"box":[x,y,w,h]|null,"body":[x,y,w,h]|null}],
# box — рамка головы героя, body — весь герой, уже в координатах ролика 1080×1920. Владелец 29.10: без стрелки, «снизу
# выходил вначале с фразой начальной», «после зелёной заставки прям», «без указательной руки, без обрезанных плеч, по
# пояс». Он поднимается снизу по центру, лицом к зрителю; фигура не заходит на голову героя ни на одном из планов (с
# запасом GAP), на тело — можно. Субтитры в это время стоят над его головой (engine/src/Main.tsx). Места нет — раскладки нет ({"layout": null}):
# лучше без вставки, чем криво. Печатает JSON раскладки и кладёт кадры для проверки — все планы рядом.
import json
import sys

import numpy as np
from PIL import Image

W, H = 1080, 1920
# сколько его видно над нижним краем; шире MAX_W — уменьшается: герою остаётся хотя бы треть кадра. Герои снимают себя
# вплотную, и под лицом часто остаётся только полоса — тогда он поменьше, но всё ещё узнаваем
HEIGHTS = (860, 760, 660, 560, 480)
MAX_W = 720
GAP = 40


def figure_layer(fig_src, flip, h):
    w = round(fig_src.width * h / fig_src.height)
    if w > MAX_W:
        w, h = MAX_W, round(fig_src.height * MAX_W / fig_src.width)
    fig = fig_src.resize((w, h), Image.LANCZOS)
    if flip:
        fig = fig.transpose(Image.FLIP_LEFT_RIGHT)
    gx = (W - w) // 2
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    layer.alpha_composite(fig, (gx, H - h))
    return {"side": "center", "flip": flip, "fig": {"x": gx, "y": H - h, "w": w, "h": h}}, layer


def layout(fig_src, shots):
    heads = [s["box"] for s in shots if s.get("box")]
    for h in HEIGHTS:
        # he faces the viewer, the picture is never mirrored
        result, layer = figure_layer(fig_src, False, h)
        mask = np.array(layer.getchannel("A")) > 40
        def touches(b):
            x0, y0 = max(0, int(b[0] - GAP)), max(0, int(b[1] - GAP))
            x1, y1 = min(W, int(b[0] + b[2] + GAP)), min(H, int(b[1] + b[3] + GAP))
            return x1 > x0 and y1 > y0 and mask[y0:y1, x0:x1].any()
        if not any(touches(b) for b in heads):
            return result, layer
    return None, None


def main():
    fig_path, shots_path, preview = sys.argv[1:4]
    shots = json.load(open(shots_path, encoding="utf-8"))
    result, layer = layout(Image.open(fig_path).convert("RGBA"), shots)
    if result:
        panels = []
        for s in shots:
            # кадр, как его показывает движок в эту секунду: тот же наезд и сдвиг
            scale, tx, ty = s["view"]
            src = Image.open(s["frame"]).convert("RGBA")
            view = Image.new("RGBA", (W, H), (0, 0, 0, 255))
            # paste, а не alpha_composite: при наезде сдвиг отрицательный
            view.paste(src.resize((round(W * scale), round(H * scale)), Image.LANCZOS), (round(tx), round(ty)))
            view.alpha_composite(layer)
            panels.append(view.convert("RGB").resize((W // 2, H // 2), Image.LANCZOS))
        sheet = Image.new("RGB", (len(panels) * W // 2 + (len(panels) - 1) * 20, H // 2), (255, 255, 255))
        for i, p in enumerate(panels):
            sheet.paste(p, (i * (W // 2 + 20), 0))
        sheet.save(preview, quality=90)
    print(json.dumps({"layout": result}))


if __name__ == "__main__":
    main()
