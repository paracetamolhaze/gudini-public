# своя «зелёная вспышка» на первую секунду: неоновое пламя закрывает кадр, закручивается и уносится
import numpy as np, sys
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates
out = sys.argv[1]
W, H, N = 540, 960, 33
rng = np.random.default_rng(11)
def field(sig, h=H * 3):
    f = gaussian_filter(rng.standard_normal((h, W)), sig, mode="wrap")
    return (f - f.mean()) / f.std()
# вытянутые вверх языки пламени
base = 0.6 * field((70, 26)) + 0.28 * field((30, 12)) + 0.12 * field((10, 5))
shade = field((20, 20))
warpx = field(80) * 30
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
cx, cy = W / 2, H * 0.6
r = np.hypot(xx - cx, (yy - cy) * 0.75)
ang = np.arctan2(yy - cy, xx - cx)
def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)
neon = np.array([70, 255, 110], np.float32)
green = np.array([0, 225, 70], np.float32)
deep = np.array([0, 140, 40], np.float32)
white = np.array([235, 255, 240], np.float32)
for k in range(N):
    t = k / (N - 1)
    swirl = smooth(0.45, 1.0, t) * 2.2
    a2 = ang + swirl * np.exp(-r / 420)
    sx = cx + np.cos(a2) * r + warpx[:H] * (0.5 + t)
    sy = cy + np.sin(a2) * r / 0.75 + H * 2.0 * (1 - t) - t * 300
    v = map_coordinates(base, [np.mod(sy, base.shape[0]), np.mod(sx, W)], order=1)
    s = map_coordinates(shade, [np.mod(sy, base.shape[0]), np.mod(sx, W)], order=1)
    v = (v + 2.4) / 4.8
    # до 0,45 с кадр закрыт целиком, потом пламя плавно редеет, сначала в центре
    cover = 1 - smooth(0.42, 1.0, t) ** 0.9
    hole = smooth(0, 1, (smooth(0.42, 1.0, t) * 700 - r) / 300)
    vv = v - hole * 0.25
    th = np.quantile(vv, 1 - cover) if cover < 0.999 else vv.min() - 0.3
    d = vv - th
    a = smooth(0.0, 0.015, d)
    # белые сердцевины — верхняя доля значений, неон — у кромки, где пламя открывает кадр
    inside = vv[vv > th]
    q1, q2 = np.quantile(inside if inside.size > 50 else vv, [0.5, 0.7])
    core = smooth(q1, q2, vv)[..., None]
    edge = (1 - smooth(0.0, 0.05, d))[..., None]
    body = green + (deep - green) * (np.clip(s * 0.5 + 0.5, 0, 1) * 0.6)[..., None]
    body = body + (neon - body) * edge
    col = body * (1 - core) + white * core
    glow = gaussian_filter(a, 7) * 0.9
    alpha = np.maximum(a, glow)
    col = np.where(a[..., None] > 0.02, col, neon)
    Image.fromarray(np.dstack([col, alpha * 255]).clip(0, 255).astype(np.uint8), "RGBA").save(f"{out}/fx_{k:02d}.png")
print("ok")
