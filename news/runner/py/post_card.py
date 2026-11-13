"""Пост X без видео — неподвижными роликами для монтажа (владелец 1.11: «говорится про репост, почему его нету?»,
«скрин реально чата с GPT не было?»).

Первый ролик — снимок поста: автор, текст, первая картинка, просмотры. Следующие — остальные картинки поста целиком
(скриншоты переписки, ответы брендов). Каждый 5 секунд, 1080×1920, с тихой дорожкой: разбор пометит их «картинка».
Печатает JSON-список файлов последней строкой.

python -I post_card.py <post.json> <префикс выхода>
post.json: {"text","name","handle","avatar","photos":[url],"views","likes"}
"""
import io
import json
import os
import subprocess
import sys
import textwrap
import urllib.request

from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
FONTS = "C:/Windows/Fonts"


def font(bold: bool, size: int) -> ImageFont.FreeTypeFont:
    for name in (["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        p = os.path.join(FONTS, name)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def fetch(url: str) -> Image.Image | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return Image.open(io.BytesIO(r.read())).convert("RGB")
    except Exception:
        return None


def short(n) -> str:
    if not isinstance(n, (int, float)):
        return ""
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}".rstrip("0").rstrip(".") + "M"
    if n >= 1000:
        return f"{n / 1000:.1f}".rstrip("0").rstrip(".") + "K"
    return str(int(n))


def fit(img: Image.Image, w: int, h: int) -> Image.Image:
    k = min(w / img.width, h / img.height)
    return img.resize((max(1, int(img.width * k)), max(1, int(img.height * k))), Image.LANCZOS)


def clean(text: str) -> str:
    """Без эмодзи и значков: шрифт их не рисует, вышли бы квадратики (2.11, посты Samsung)."""
    keep = "–—‘’“”„…«»€₽№•"
    return "".join(ch for ch in text if ord(ch) < 0x2000 or ch in keep).strip()


def card(post: dict, photo: Image.Image | None) -> Image.Image:
    """Тёмная карточка поста, как в X: аватар, имя, @ник, текст, картинка, просмотры — по центру кадра. Пост без
    картинки — крупнее: одна строка текста на весь экран читается с телефона."""
    k = 1.0 if photo else 1.4
    pad, inner = 30, W - 2 * 30 - 2 * 40
    name_f, handle_f, text_f, meta_f = font(True, int(56 * k)), font(False, int(44 * k)), font(False, int(54 * k)), font(False, int(42 * k))
    av, step, head = int(96 * k), int(70 * k), int(128 * k)
    lines: list[str] = []
    for para in clean(post.get("text") or "").splitlines():
        lines += textwrap.wrap(para, width=int(30 / k)) or [""]
    lines = lines[:9]
    text_h = len(lines) * step
    pic = fit(photo, inner, 900) if photo else None
    card_h = 40 + head + 24 + text_h + (24 + pic.height if pic else 0) + 24 + int(50 * k) + 40
    img = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)
    top = max(60, (H - card_h) // 2)
    d.rounded_rectangle([pad, top, W - pad, top + card_h], radius=36, fill=(22, 24, 28), outline=(56, 60, 66), width=2)
    x, y = pad + 40, top + 40
    avatar = fetch(post.get("avatar") or "")
    if avatar:
        avatar = avatar.resize((av, av), Image.LANCZOS)
        mask = Image.new("L", (av, av), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, av, av], fill=255)
        img.paste(avatar, (x, y + 7), mask)
    d.text((x + av + 24, y + 10), clean(post.get("name") or ""), font=name_f, fill=(240, 242, 245))
    d.text((x + av + 24, y + int(76 * k)), f"@{post.get('handle') or ''}", font=handle_f, fill=(130, 138, 148))
    y += head + 24
    for line in lines:
        d.text((x, y), line, font=text_f, fill=(236, 238, 240))
        y += step
    if pic:
        y += 24
        img.paste(pic, (x + (inner - pic.width) // 2, y))
        y += pic.height
    y += 24
    meta = "   ".join(s for s in [f"{short(post.get('views'))} просмотров" if post.get("views") else "", f"♥ {short(post.get('likes'))}" if post.get("likes") else ""] if s)
    d.text((x, y), meta, font=meta_f, fill=(130, 138, 148))
    return img


def plain(photo: Image.Image) -> Image.Image:
    """Картинка поста целиком на тёмном фоне — скриншот читается, ничего не срезано."""
    img = Image.new("RGB", (W, H), (0, 0, 0))
    pic = fit(photo, W - 60, H - 200)
    img.paste(pic, ((W - pic.width) // 2, (H - pic.height) // 2))
    return img


def to_video(frame: Image.Image, out: str) -> None:
    png = out.replace(".mp4", ".png")
    frame.save(png)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-i", png, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
                    "-t", "5", "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out], check=True)
    os.remove(png)


def main() -> None:
    post = json.load(open(sys.argv[1], encoding="utf8"))
    prefix = sys.argv[2]
    photos = [p for p in (fetch(u) for u in post.get("photos") or []) if p]
    files = []
    first = f"{prefix}_1.mp4"
    to_video(card(post, photos[0] if photos else None), first)
    files.append(first)
    # высокий скриншот (переписка) в карточке мелкий — он идёт и отдельно целиком
    for i, photo in enumerate(photos, start=1):
        if i == 1 and photo.height < photo.width * 1.2:
            continue
        out = f"{prefix}_{i + 1}.mp4"
        to_video(plain(photo), out)
        files.append(out)
    print(json.dumps(files))


if __name__ == "__main__":
    main()
