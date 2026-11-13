"""
Writes the QR code of the owner's Telegram channel into src/channel.json as rows of modules ("1" dark, "0" light),
without the quiet zone: the kit's Channel card draws them as crisp squares, so the code scans from a screenshot.
Run it again after changing the link in src/channel.json, then check the decode line it prints.
  python -I scripts/channel-qr.py
"""
import json
import os
import sys

import cv2
import numpy as np

FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "channel.json")


def modules(url):
    params = cv2.QRCodeEncoder_Params()
    # Q survives the video encoder's soft edges better than the default L
    params.correction_level = cv2.QRCODE_ENCODER_CORRECT_LEVEL_Q
    img = cv2.QRCodeEncoder.create(params).encode(url)
    dark = img < 128
    rows, cols = np.where(dark)
    # one pixel per module; the encoder adds a light border, the finder corners mark the code itself
    return dark[rows.min() : rows.max() + 1, cols.min() : cols.max() + 1]


def decoded(grid, scale=8):
    border = 4
    img = np.full((grid.shape[0] + 2 * border, grid.shape[1] + 2 * border), 255, np.uint8)
    img[border:-border, border:-border][grid] = 0
    img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
    text, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    return text


def main():
    with open(FILE, encoding="utf-8") as f:
        channel = json.load(f)
    grid = modules(channel["url"])
    if decoded(grid) != channel["url"]:
        sys.exit("QR не читается обратно — src/channel.json не изменён")
    channel["qr"] = ["".join("1" if v else "0" for v in row) for row in grid]
    with open(FILE, "w", encoding="utf-8") as f:
        json.dump(channel, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"{len(grid)}x{len(grid)} модулей, читается: {decoded(grid)}")


if __name__ == "__main__":
    main()
