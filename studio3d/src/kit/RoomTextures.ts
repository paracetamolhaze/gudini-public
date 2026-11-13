import * as THREE from "three";
import { hash } from "./util";

const cache = new Map<string, THREE.CanvasTexture>();

const canvasMap = (key: string, width: number, height: number, paint: (c: CanvasRenderingContext2D) => void) => {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  paint(canvas.getContext("2d")!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cache.set(key, texture);
  return texture;
};

export const roomWood = (floor = false) => canvasMap(`room-wood-${floor}`, 1024, 512, (c) => {
  c.fillStyle = floor ? "#675344" : "#422b27";
  c.fillRect(0, 0, 1024, 512);
  for (let y = 0; y < 512; y++) {
    const n = hash(y, floor ? 2 : 1, 71);
    c.strokeStyle = `rgba(${n > 0.5 ? "183,134,91" : "18,7,7"},${0.03 + n * 0.09})`;
    c.lineWidth = 0.4 + n * 0.75;
    c.beginPath();
    for (let x = 0; x <= 1024; x += 16) {
      const wave = Math.sin(x / 145 + y * 0.019) * 1.9 + Math.sin(x / 57 + y * 0.027) * 0.6;
      if (x === 0) c.moveTo(x, y + wave); else c.lineTo(x, y + wave);
    }
    c.stroke();
  }
  if (floor) {
    c.strokeStyle = "rgba(24,17,14,0.5)"; c.lineWidth = 2;
    for (let row = 0; row < 8; row++) {
      c.beginPath(); c.moveTo(0, row * 64); c.lineTo(1024, row * 64); c.stroke();
      for (let x = (row % 2) * 170; x < 1024; x += 340) { c.beginPath(); c.moveTo(x, row * 64); c.lineTo(x, row * 64 + 64); c.stroke(); }
    }
  }
});

/** Very fine painted plaster, with no repeating graphic or visible pixel grid. */
export const roomPlaster = () => {
  const texture = canvasMap("room-painted-plaster", 512, 512, (c) => {
    const data = c.createImageData(512, 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const value = Math.round(239 + (hash(x, y, 89) - 0.5) * 15);
      const i = (y * 512 + x) * 4;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = value;
      data.data[i + 3] = 255;
    }
    c.putImageData(data, 0, 0);
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 5);
  return texture;
};

/** Soft indirect-light falloff, used only by the photographed room's preview lighting. */
export const roomLightFalloff = () => canvasMap("room-indirect-wash", 256, 256, (c) => {
  const gradient = c.createRadialGradient(128, 128, 4, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255,255,255,0.78)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.49)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.16)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = gradient; c.fillRect(0, 0, 256, 256);
});

export const roomLed = () => canvasMap("room-ac-display", 128, 64, (c) => {
  c.clearRect(0, 0, 128, 64); c.fillStyle = "#adc7e3"; c.font = "45px monospace"; c.textAlign = "center"; c.fillText("26°", 64, 49);
});
