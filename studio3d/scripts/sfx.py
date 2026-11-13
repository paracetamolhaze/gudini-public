"""
The sketch's sound effects, synthesized so they belong to nobody but us (public/sfx/*.wav, 48 kHz mono):
  python scripts/sfx.py
Quiet and short on purpose: they sit under the two voices, never over them (the owner: no music, only voices —
these are room sounds, played to him first).
"""
import os
import wave

import numpy as np
from scipy.signal import butter, sosfilt

RATE = 48000
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "sfx")
rng = np.random.default_rng(7)


def t(seconds: float) -> np.ndarray:
    return np.arange(int(RATE * seconds)) / RATE


def band(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    return sosfilt(butter(2, [lo, hi], btype="band", fs=RATE, output="sos"), x)


def low(x: np.ndarray, hz: float) -> np.ndarray:
    return sosfilt(butter(2, hz, btype="low", fs=RATE, output="sos"), x)


def fade(x: np.ndarray, attack=0.002, release=0.01) -> np.ndarray:
    n = len(x)
    env = np.ones(n)
    a, r = max(1, int(attack * RATE)), max(1, int(release * RATE))
    env[:a] = np.linspace(0, 1, a)
    env[-r:] = np.minimum(env[-r:], np.linspace(1, 0, r))
    return x * env


def save(name: str, x: np.ndarray, peak_db: float) -> None:
    x = x / (np.max(np.abs(x)) + 1e-9) * 10 ** (peak_db / 20)
    os.makedirs(OUT, exist_ok=True)
    with wave.open(os.path.join(OUT, f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())


def key_click() -> np.ndarray:
    """A mechanical key: the stem's click, the cap's plastic tock and the board's low thump."""
    x = t(0.09)
    click = band(rng.standard_normal(len(x)), 2500, 7000) * np.exp(-x / 0.004)
    tock = np.sin(2 * np.pi * 1850 * x) * np.exp(-x / 0.012) * 0.6
    thump = np.sin(2 * np.pi * 140 * x) * np.exp(-x / 0.02) * 0.5
    return fade(click + tock + thump, 0.0005, 0.01)


def land() -> np.ndarray:
    """A small body landing on a key: a soft low thud under a key click."""
    x = t(0.22)
    f = 95 * np.exp(-x / 0.08) + 55
    thud = np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-x / 0.05)
    soft = low(rng.standard_normal(len(x)), 900) * np.exp(-x / 0.02) * 0.4
    clk = np.zeros(len(x))
    k = key_click()
    clk[: len(k)] = k * 0.7
    return fade(thud + soft + clk, 0.001, 0.03)


def pop() -> np.ndarray:
    """A bubble pop for a reaction icon."""
    x = t(0.12)
    f = 380 + 700 * (1 - np.exp(-x / 0.02))
    return fade(np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-x / 0.03), 0.001, 0.02)


def whoosh() -> np.ndarray:
    """Air past the lens on a whip or a shake."""
    x = t(0.42)
    env = np.sin(np.pi * np.clip(x / 0.42, 0, 1)) ** 2
    sweep = np.zeros(len(x))
    noise = rng.standard_normal(len(x))
    # the band slides up and back: a short pass of air
    for i, (lo, hi) in enumerate([(300, 1200), (600, 2400), (900, 3600), (600, 2400)]):
        seg = slice(i * len(x) // 4, (i + 1) * len(x) // 4)
        sweep[seg] = band(noise, lo, hi)[seg]
    return fade(low(sweep, 4000) * env, 0.01, 0.05)


def coin() -> np.ndarray:
    """A small bright ding when the light turns to money."""
    x = t(0.7)
    tone = sum(a * np.sin(2 * np.pi * f * x) * np.exp(-x / d) for f, a, d in [(1568, 1, 0.25), (2093, 0.7, 0.2), (3136, 0.3, 0.12), (4186, 0.15, 0.08)])
    second = np.zeros(len(x))
    s = int(0.08 * RATE)
    second[s:] = tone[: len(x) - s] * 0.8
    return fade(tone * 0.6 + second, 0.001, 0.05)


def alarm() -> np.ndarray:
    """Two soft beeps when the light turns to alarm."""
    x = t(0.5)
    out = np.zeros(len(x))
    for start in (0.0, 0.22):
        seg = (x >= start) & (x < start + 0.14)
        y = x[seg] - start
        out[seg] = (np.sin(2 * np.pi * 880 * y) + 0.25 * np.sin(2 * np.pi * 2640 * y)) * np.minimum(1, np.minimum(y / 0.005, (0.14 - y) / 0.02))
    return out


if __name__ == "__main__":
    save("key", key_click(), -10)
    save("land", land(), -8)
    save("pop", pop(), -12)
    save("whoosh", whoosh(), -14)
    save("coin", coin(), -14)
    save("alarm", alarm(), -18)
    print("public/sfx: key, land, pop, whoosh, coin, alarm")
