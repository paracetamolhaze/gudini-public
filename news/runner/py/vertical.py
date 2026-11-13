# Горизонтальный ролик → вертикальный 1080×1920: рамка 9:16 стоит на том, кто говорит.
# Владелец 30.10 о прежней версии (рамка по самому крупному лицу, на трёх лицах и больше — середина): «показывают
# 3 других людей, а не того, кто говорит», «половину человека только видно» (Exile: ряд из 5–6 человек, говорит крайний).
# Теперь лица ведутся по кадрам и узнаются между планами (InsightFace: SCRFD, 106 точек, ArcFace), у каждого меряется,
# как ходит рот, и пока в звуке речь — рамка на самом живом рте. На общем плане рот мелкий — тогда держится тот, кто
# говорил на соседнем крупном (узнаём по лицу). Говорят по очереди — рамка переходит к другому жёстким переходом,
# не чаще раза в 1,5 с. Лицо целиком в кадре, уходящее за край лицо в рамку не ставится; камера стоит, пока лицо около
# середины, и плавно догоняет его на панорамах. Никто не говорит — крупное лицо ближе к середине, нет лиц — фигура,
# нет и её — середина.
#   python -I vertical.py <вход.mp4> <выход.mp4>
# Склейки ищутся на 30 кадрах в секунду (96×54) параллельно с разбором лиц на 15 (кадр не выше 1080): лица — на каждом
# третьем, между ними рамки лиц сдвигаются по точкам. Минута видео — около полутора минут на процессоре.
import contextlib, json, os, subprocess, sys, tempfile, threading, warnings
import numpy as np
import cv2

src, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
RATE, OUT_FPS, DET = 15, 30, 3
STEP = OUT_FPS // RATE  # кадр анализа = каждый STEP-й кадр вывода (fps с round=up — кадры совпадают точно)
info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,start_time", "-of", "json", src], capture_output=True, text=True).stdout)["streams"][0]
W, H, T0 = int(info["width"]), int(info["height"]), float(info.get("start_time") or 0)
CW = int(round(H * 9 / 16 / 2) * 2)
AH = min(H, 1080)
AW = int(round(W * AH / H / 2) * 2)
K = W / AW  # пиксели анализа → пиксели исходника

# склейки — резкая смена картинки между соседними кадрами вывода; считаются в своём потоке
cuts = [0]


def find_cuts():
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-vf", f"fps={OUT_FPS}:round=up,scale=96:54", "-f", "rawvideo", "-pix_fmt", "gray", "-"], stdout=subprocess.PIPE)
    prev, n = None, 0
    while len(buf := dec.stdout.read(96 * 54)) == 96 * 54:
        small = np.frombuffer(buf, np.uint8).astype(np.int16)
        if prev is not None and np.abs(small - prev).mean() > 28:
            cuts.append(n)
        prev, n = small, n + 1
    dec.wait()
    cuts.append(n)


cutter = threading.Thread(target=find_cuts)
cutter.start()

warnings.filterwarnings("ignore")
try:
    import onnxruntime

    onnxruntime.set_default_logger_severity(3)
    with contextlib.redirect_stdout(sys.stderr):  # InsightFace печатает служебные строки в stdout
        from insightface.model_zoo import get_model
        from insightface.utils.face_align import norm_crop

        root = os.path.expanduser("~/.insightface/models/buffalo_l")
        det = get_model(os.path.join(root, "det_10g.onnx"), providers=["CPUExecutionProvider"])
        det.prepare(ctx_id=-1, input_size=(640, 384), det_thresh=0.5)
        lmk = get_model(os.path.join(root, "2d106det.onnx"), providers=["CPUExecutionProvider"])
        rec = get_model(os.path.join(root, "w600k_r50.onnx"), providers=["CPUExecutionProvider"])
except Exception as e:
    # без InsightFace — лица анфас по Haar: рамка на крупном лице ближе к середине, рот и узнавание не работают
    print(f"InsightFace недоступен ({e}), лица по Haar", file=sys.stderr)
    det = lmk = rec = None
    haar = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
hog = cv2.HOGDescriptor()
hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())


def run(model, crops, size):
    blob = cv2.dnn.blobFromImages(crops, 1 / model.input_std, (size, size), (model.input_mean,) * 3, swapRB=True)
    return model.session.run(None, {model.session.get_inputs()[0].name: blob})[0]


def detect(img):
    """Рамки лиц [x1, y1, x2, y2] и выровненные лица 112×112 для узнавания (None — мелкое или без точек)."""
    if det is None:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        return [np.array([x, y, x + w, y + h], float) for x, y, w, h in haar.detectMultiScale(gray, 1.1, 6, minSize=(24, 24))], None
    found, kps = det.detect(img, input_size=(640, 384))
    keep = [j for j, b in enumerate(found) if b[3] - b[1] >= AH * 0.015]
    return [found[j][:4] for j in keep], [norm_crop(img, landmark=kps[j], image_size=112) if found[j][3] - found[j][1] >= 24 else None for j in keep]


def faces(img, boxes):
    """106 точек сразу для всех лиц кадра → [(середина x, середина y, ширина, высота, раскрытие рта)]."""
    if lmk is None:
        return [((x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1, 0.0) for x1, y1, x2, y2 in boxes]
    crops, mats = [], []
    for x1, y1, x2, y2 in boxes:
        s = 192 / (max(x2 - x1, y2 - y1) * 1.5)
        mats.append((s, 96 - (x1 + x2) / 2 * s, 96 - (y1 + y2) / 2 * s))
        crops.append(cv2.warpAffine(img, np.float32([[s, 0, mats[-1][1]], [0, s, mats[-1][2]]]), (192, 192)))
    pred = run(lmk, crops, 192).reshape(len(boxes), -1, 2)
    res = []
    for p, (s, tx, ty), (x1, y1, x2, y2) in zip(pred, mats, boxes):
        p = ((p + 1) * 96 - (tx, ty)) / s
        # губы снаружи (71 — верх, 53 — низ) и изнутри (62, 60): у бородатых внутренняя щель почти не видна
        o = (np.linalg.norm(p[53] - p[71]) + np.linalg.norm(p[60] - p[62])) / (y2 - y1)
        res.append(((p[:, 0].min() + p[:, 0].max()) / 2, p[:, 1].mean(), np.ptp(p[:, 0]), y2 - y1, o))
    return res


# кадры анализа: лица ищутся на каждом DET-м и после резкой смены картинки, между ними рамки едут вслед за точками
dec = subprocess.Popen(["ffmpeg", "-v", "error", "-i", src, "-vf", f"fps={RATE}:round=up,scale={AW}:{AH}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
seen, crops, figs = [], {}, {}
prev, base, ref, shift, i = None, [], [], [], 0
while len(buf := dec.stdout.read(AW * AH * 3)) == AW * AH * 3:
    frame = np.frombuffer(buf, np.uint8).reshape(AH, AW, 3)
    small = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (96, 54)).astype(np.int16)
    fresh = i % DET == 0 or prev is None or np.abs(small - prev).mean() > 20
    prev = small
    if fresh:
        base, aligned = detect(frame)
        for j, c in enumerate(aligned or []):
            if c is not None:
                crops[(i, j)] = c
        boxes = base
    else:
        boxes = [b + (dx, dy, dx, dy) for b, (dx, dy) in zip(base, shift)]
    obs = faces(frame, boxes) if boxes else []
    if fresh:
        ref = [o[:2] for o in obs]
    shift = [(o[0] - r[0], o[1] - r[1]) for o, r in zip(obs, ref)]
    seen.append(obs)
    if fresh and not base and i % (DET * 3) == 0:
        rects, _ = hog.detectMultiScale(cv2.resize(frame, (640, 360)), winStride=(8, 8), scale=1.05)
        if len(rects):
            big = max(rects, key=lambda r: r[2] * r[3])
            figs[i] = (big[0] + big[2] / 2) * AW / 640
    i += 1
dec.wait()
cutter.join()
N, NOUT = len(seen), cuts[-1]

# где в звуке речь, по кадрам анализа (VAD Silero из faster-whisper); без звука или без VAD — речь везде
talk = np.ones(N, bool)
try:
    from faster_whisper.audio import decode_audio
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    talk[:] = False
    for s in get_speech_timestamps(decode_audio(src, sampling_rate=16000), VadOptions(min_silence_duration_ms=300, speech_pad_ms=150)):
        talk[int(s["start"] / 16000 * RATE) : int(np.ceil(s["end"] / 16000 * RATE))] = True
except Exception:
    talk[:] = True

bounds = sorted(set(min(-(-c // STEP), N) for c in cuts))
shots = [(a, b) for a, b in zip(bounds, bounds[1:]) if b > a]


def link(a, b):
    """Лица плана, связанные по кадрам: [{кадр: номер лица в кадре}]."""
    live = []
    for f in range(a, b):
        obs, pairs = seen[f], []
        for ti, t in enumerate(live):
            lf = max(t)
            if f - lf > RATE:
                continue
            x, y, w, h = seen[lf][t[lf]][:4]
            for oi, (ox, oy, ow, oh, _) in enumerate(obs):
                d = np.hypot(ox - x, oy - y) / max(h, oh)
                if d < 1.0 and 0.6 < oh / h < 1.7:
                    pairs.append((d, ti, oi))
        used_t, used_o = set(), set()
        for d, ti, oi in sorted(pairs):
            if ti not in used_t and oi not in used_o:
                live[ti][f] = oi
                used_t.add(ti), used_o.add(oi)
        live += [{f: oi} for oi in range(len(obs)) if oi not in used_o]
    return [t for t in live if len(t) >= 3]


def window(v, r):
    """Сумма v в окне ±r кадров."""
    cs = np.concatenate([[0], np.cumsum(v)])
    idx = np.arange(len(v))
    return cs[np.minimum(idx + r + 1, len(v))] - cs[np.maximum(idx - r, 0)]


# треки: положение, размер и рот на каждом кадре плана (между наблюдениями — линейно, разрыв до 1 с), отпечаток лица
T = []
for a, b in shots:
    for t in link(a, b):
        fs = np.array(sorted(t))
        ob = np.array([seen[f][t[f]] for f in fs], float)
        tr = {"a": a, "b": b, "frames": set(fs.tolist())}
        for k, name in enumerate(("x", "y", "w", "h")):
            v = np.full(b - a, np.nan)
            for f0, f1, v0, v1 in zip(fs, fs[1:], ob[:, k], ob[1:, k]):
                if f1 - f0 <= RATE:
                    v[f0 - a : f1 - a + 1] = np.linspace(v0, v1, f1 - f0 + 1)
            v[fs - a] = ob[:, k]
            tr[name] = v
        # как ходит рот: среднее |Δ раскрытия| между соседними кадрами в окне ±1 с
        d, c = np.zeros(b - a), np.zeros(b - a)
        cons = np.diff(fs) == 1
        np.add.at(d, fs[:-1][cons] - a, np.abs(np.diff(ob[:, 4]))[cons])
        np.add.at(c, fs[:-1][cons] - a, 1)
        ds, cs = window(d, RATE), window(c, RATE)
        tr["act"] = np.where(cs >= RATE * 0.6, ds / np.maximum(cs, 1), np.nan)
        # для узнавания — самое крупное лицо трека
        best = max((f for f in fs if (f, t[f]) in crops), key=lambda f: seen[f][t[f]][3], default=None)
        tr["crop"] = crops[(best, t[best])] if best is not None and len(fs) >= 5 else None
        T.append(tr)
crops.clear()
want = [tr for tr in T if tr["crop"] is not None]
for k in range(0, len(want), 16):
    for tr, e in zip(want[k : k + 16], run(rec, [tr["crop"] for tr in want[k : k + 16]], 112)):
        tr["emb"] = e / np.linalg.norm(e)

# один человек в разных планах и после рывка камеры — по отпечатку лица; двое в одном кадре — разные люди
who = list(range(len(T)))


def root(j):
    while who[j] != j:
        j = who[j]
    return j


emb = [j for j, tr in enumerate(T) if "emb" in tr]
pairs = sorted(((float(T[p]["emb"] @ T[q]["emb"]), p, q) for n, p in enumerate(emb) for q in emb[n + 1 :]), reverse=True)
frames = [tr["frames"] for tr in T]
for s, p, q in pairs:
    if s < 0.45:
        break
    rp, rq = root(p), root(q)
    if rp != rq and len(frames[rp] & frames[rq]) <= 3:
        who[rq] = rp
        frames[rp] = frames[rp] | frames[rq]
ids = sorted(set(root(j) for j in range(len(T))))
col = {r: k + 1 for k, r in enumerate(ids)}
I = len(ids) + 1  # 0 — «никого»
X, Y, Wd, Hh, A = (np.full((I, N), np.nan) for _ in range(5))
for j, tr in enumerate(T):
    c, sl = col[root(j)], slice(tr["a"], tr["b"])
    better = ~np.isnan(tr["h"]) & ~(Hh[c, sl] >= tr["h"])
    for M, name in ((X, "x"), (Y, "y"), (Wd, "w"), (Hh, "h"), (A, "act")):
        M[c, sl] = np.where(better, tr[name], M[c, sl])
present = ~np.isnan(X)
# лицо, уходящее за край кадра, в рамку не ставим — была бы половина человека
with np.errstate(invalid="ignore"):
    present &= (X - Wd * 0.6 >= 0) & (X + Wd * 0.6 <= AW)
present[0] = True
# рот: у мелкого лица точки дрожат сильнее и доверия меньше; живой рот говорящего заметно выше дрожи
# (высота лица — в пикселях кадра высотой 1080)
hh = np.nan_to_num(Hh, nan=1.0) * 1080 / AH
trust = np.clip((hh - 30) / 40, 0, 1)
live = trust * np.clip((np.nan_to_num(A) - 0.003 - 0.12 / np.maximum(hh, 1)) / 0.004, 0, 3) * talk
hmax = np.nanmax(np.where(present[1:], Hh[1:], np.nan), axis=0, initial=1)
prior = 0.15 * hh / hmax + 0.05 * (1 - np.abs(np.nan_to_num(X, nan=AW / 2) - AW / 2) / (AW / 2))
E = np.where(present, live + prior, -1e9)
E[0] = -0.5
# Витерби по людям: смена говорящего внутри плана стоит дорого (рамка не прыгает от шума), на склейке — дешевле,
# поэтому на общем плане остаётся тот, кто говорил на соседнем крупном
first = np.zeros(N, bool)
first[[a for a, b in shots]] = True
pick = np.zeros(N, int)
if N:
    dp, back = E[:, 0].copy(), np.zeros((I, N), int)
    for f in range(1, N):
        best = int(np.argmax(dp))
        move = dp[best] - (5.0 if first[f] else 10.0)
        back[:, f] = np.where(dp >= move, np.arange(I), best)
        dp = np.maximum(dp, move) + E[:, f]
    pick[-1] = int(np.argmax(dp))
    for f in range(N - 1, 0, -1):
        pick[f - 1] = back[pick[f], f]
# внутри плана кусок короче 1,5 с — соседу, если тот всё это время в кадре
for a, b in shots:
    changed = True
    while changed:
        changed = False
        bnd = [a] + [f for f in range(a + 1, b) if pick[f] != pick[f - 1]] + [b]
        segs = list(zip(bnd, bnd[1:]))
        for si, (s, e) in enumerate(segs):
            if e - s >= RATE * 1.5 or len(segs) == 1:
                continue
            for nb in segs[si - 1 : si] + segs[si + 1 : si + 2]:
                j = pick[nb[0]]
                if present[j, s:e].all():
                    pick[s:e], changed = j, True
                    break
            if changed:
                break


def path(a, b):
    """Середина рамки на кадрах плана: ленивая камера на выбранном лице; «никого» — фигура или середина."""
    L = b - a
    x = X[pick[a:b], np.arange(a, b)]
    w = np.nan_to_num(Wd[pick[a:b], np.arange(a, b)])
    if np.isnan(x).all():
        xs = [figs[f] for f in range(a, b) if f in figs]
        return np.full(L, float(np.median(xs)) if xs else AW / 2)
    # лицо на миг потерялось — рамка стоит, где была
    ok = ~np.isnan(x)
    idx = np.maximum.accumulate(np.where(ok, np.arange(L), 0))
    x, w = x[idx], w[idx]
    f0 = int(np.argmax(ok))
    x[:f0], w[:f0] = x[f0], w[f0]
    c = np.zeros(L)
    bnd = [0] + [f for f in range(1, L) if pick[a + f] != pick[a + f - 1]] + [L]
    for s, e in zip(bnd, bnd[1:]):
        cur, dz = float(np.median(x[s : s + RATE])), CW / K * 0.08
        for k in range(s, e):
            cur = min(max(cur, x[k] - dz), x[k] + dz)
            c[k] = cur
        if e - s > 2:
            r = int(RATE * 0.6)
            g = np.exp(-0.5 * (np.arange(-r, r + 1) / (RATE * 0.2)) ** 2)
            c[s:e] = np.convolve(np.pad(c[s:e], r, mode="edge"), g / g.sum(), "valid")
        # лицо целиком: от середины лица до края рамки — не меньше полуширины лица с запасом
        lim = np.maximum(CW / K / 2 - w[s:e] * 0.75, 0)
        c[s:e] = np.clip(c[s:e], x[s:e] - lim, x[s:e] + lim)
    return c


centre = np.full(max(N, 1), AW / 2)
# план без лица или с крошечным лицом (графика, логотип, игра, текст, общий план) не режется полосой 9:16, а идёт целиком
# карточкой на своём размытом фоне: полоса резала «000» от цифры, логотип GTA VI вплотную и пол-ведущей в студии
# (владелец 5.11: «раскадровка кривая… ты делаешь вертикальные видосы!!!!»)
FIT_FACE = 0.06  # лицо уже этой доли ширины кадра — человека не видно, режем вслепую
fit = np.zeros(max(N, 1), bool)
for a, b in shots:
    centre[a:b] = path(a, b)
    fx = X[pick[a:b], np.arange(a, b)]
    fw = np.nan_to_num(Wd[pick[a:b], np.arange(a, b)])
    if np.isnan(fx).all() or float(fw.max(initial=0)) < AW * FIT_FACE:
        fit[a:b] = True
        continue
    # двое в студии (ведущий и гость по разные стороны, сплит эфира): полоса 9:16 вставала между ними — «пол-ведущей»
    # (владелец 5.11 о кадре CNBC: «снова одна и та же ошибка»). Ряд из многих людей по-прежнему режется по говорящему
    big = [j for j in range(X.shape[0]) if np.mean(~np.isnan(X[j, a:b])) > 0.5 and float(np.nanmedian(Wd[j, a:b])) > AW * 0.07]
    if len(big) == 2 and abs(float(np.nanmedian(X[big[0], a:b])) - float(np.nanmedian(X[big[1], a:b]))) > AW * 0.35:
        fit[a:b] = True
        continue
    # склейку детектор пропускает (обложка игры плавно уходит в геймплей, комментарий всплывает поверх игры): лицо было
    # только в начале плана, и 25 секунд игры резались полосой (5.11, NFS: «Jared_Robinson to an outr», комментарий без
    # правого края). Отрезок плана от 2 с без лица крупнее FIT_FACE — тоже карточкой
    seen = np.nan_to_num(Wd[:, a:b]).max(axis=0, initial=0) >= AW * FIT_FACE
    run = None
    for k in range(b - a + 1):
        off = k < b - a and not seen[k]
        if off and run is None:
            run = k
        if not off and run is not None:
            if k - run >= RATE * 2:
                fit[a + run : a + k] = True
            run = None
# кадр вывода → кадр анализа своего плана (между ними — линейно); x рамки в пикселях исходника
xs = np.full(NOUT, (W - CW) // 2, int)
for a, b in zip(cuts, cuts[1:]):
    lo = min(-(-a // STEP), max(N - 1, 0))
    hi = min(max(-(-b // STEP) - 1, lo), max(N - 1, 0))
    for n in range(a, b):
        f = min(max(n / STEP, lo), hi)
        f0 = int(f)
        f1 = min(f0 + 1, hi)
        v = centre[f0] + (centre[f1] - centre[f0]) * (f - f0)
        xs[n] = int(round(min(max(v * K - CW / 2, 0), W - CW)))
# рамка едет командами sendcmd в фильтр crop (файл команд — во временной папке, ffmpeg запускается из неё)
with tempfile.TemporaryDirectory() as tmp:
    moves = [f"{T0 + (n - 0.5) / OUT_FPS:.4f} crop@c x {xs[n]};" for n in range(1, NOUT) if xs[n] != xs[n - 1]]
    with open(os.path.join(tmp, "x.cmd"), "w") as fh:
        fh.write("\n".join(moves))
    x0 = xs[0] if NOUT else (W - CW) // 2
    send = "sendcmd=f=x.cmd," if moves else ""  # пустой файл команд ffmpeg не принимает
    # кадры вывода «карточкой» — промежутками времени для overlay enable
    spans, start = [], None
    for n in range(NOUT + 1):
        on = n < NOUT and bool(fit[min(n // STEP, max(N - 1, 0))])
        if on and start is None:
            start = n
        if not on and start is not None:
            spans.append((T0 + start / OUT_FPS, T0 + n / OUT_FPS))
            start = None
    crop = f"{send}crop@c={CW}:{H}:{x0}:0,scale=1080:1920:flags=lanczos"
    if not spans:
        graph = ["-vf", f"fps={OUT_FPS}:round=up,{crop},format=yuv420p"]
    else:
        # карточка 16:9 во всю ширину чуть выше середины — низ 16:9 — 1008 px, под ней строка субтитров (y ≈ 1040)
        when = "+".join(f"between(t,{a:.3f},{b - 0.001:.3f})" for a, b in spans)
        fg_h = int(round(1080 * H / W / 2) * 2)
        top = max(0, min(400, (1920 - fg_h) // 2))
        graph = ["-filter_complex",
                 f"[0:v]fps={OUT_FPS}:round=up,split=3[a][b][c];"
                 f"[a]{crop}[cut];"
                 f"[b]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=40,eq=brightness=-0.12:saturation=0.85[bg];"
                 f"[c]scale=1080:{fg_h}:flags=lanczos[fg];"
                 f"[bg][fg]overlay=0:{top}[card];"
                 f"[cut][card]overlay=0:0:enable='{when}',format=yuv420p[v]",
                 "-map", "[v]", "-map", "0:a?"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, *graph, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", out], check=True, cwd=tmp)
    print(json.dumps({"fit": [[round(a, 2), round(b, 2)] for a, b in spans]}), file=sys.stderr)
if len(sys.argv) > 3:  # карточные промежутки и место карточки — монтажу: титры не ложатся на карточку (5.11, GTA; 7.11)
    geo = {"top": top, "height": fg_h} if spans else {}
    with open(sys.argv[3], "w") as fh:
        json.dump({"spans": [[round(a, 2), round(b, 2)] for a, b in spans], **geo}, fh)
if os.environ.get("VERTICAL_DEBUG"):  # отладка: кто в рамке и где рамка, по кадрам анализа и вывода
    json.dump({"rate": RATE, "cuts": cuts, "talk": talk.astype(int).tolist(), "pick": pick.tolist(), "xs": xs.tolist(), "shots": shots, "X": np.nan_to_num(X, nan=-1).round().tolist(), "Y": np.nan_to_num(Y, nan=-1).round().tolist(), "H": np.nan_to_num(Hh, nan=-1).round().tolist(), "A": np.nan_to_num(A, nan=-1).round(4).tolist(), "E": np.maximum(E, -1).round(2).tolist()}, open(os.environ["VERTICAL_DEBUG"], "w"))
print(len(shots))
