/**
 * 生成 PWA 图标（无第三方依赖，用 zlib 手写 PNG）。
 * 图案：深色圆角底 + 红色音符。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ICONS = path.join(ROOT, 'icons');

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function makePNG(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[p++] = pixels[i];
      raw[p++] = pixels[i + 1];
      raw[p++] = pixels[i + 2];
      raw[p++] = pixels[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [26, 26, 31, 255];
const BG_MASKABLE = [20, 20, 24, 255];
const RED = [255, 77, 79, 255];
const WHITE = [255, 255, 255, 255];

function drawIcon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const bg = maskable ? BG_MASKABLE : BG;

  // 圆角矩形背景
  const radius = maskable ? 0 : size * 0.22;
  const margin = maskable ? 0 : size * 0.0;

  const set = (x, y, c, a = 1) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const na = c[3] / 255;
    px[i] = Math.round(px[i] * (1 - na) + c[0] * na);
    px[i + 1] = Math.round(px[i + 1] * (1 - na) + c[1] * na);
    px[i + 2] = Math.round(px[i + 2] * (1 - na) + c[2] * na);
    px[i + 3] = Math.max(px[i + 3], Math.round(c[3] * a));
  };

  const inRounded = (x, y) => {
    const min = margin;
    const max = size - margin - 1;
    if (x < min || y < min || x > max || y > max) return false;
    if (radius <= 0) return true;
    const cx = Math.min(Math.max(x, min + radius), max - radius);
    const cy = Math.min(Math.max(y, min + radius), max - radius);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inRounded(x, y)) set(x, y, bg);
    }
  }

  // 音符：两个圆头 + 竖杆 + 横梁
  const S = size;
  const headR = S * 0.115;
  const head1 = { x: S * 0.36, y: S * 0.70 };
  const head2 = { x: S * 0.68, y: S * 0.60 };
  const barX = S * 0.68;
  const barTop = S * 0.28;
  const barW = S * 0.052;
  const beamY = S * 0.28;
  const beamH = S * 0.052;
  const beamW = S * 0.32;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // 左杆
      if (x >= S * 0.30 && x < S * 0.30 + barW && y >= S * 0.34 && y <= head1.y) set(x, y, RED);
      // 右杆
      if (x >= barX && x < barX + barW && y >= barTop && y <= head2.y) set(x, y, RED);
      // 横梁
      if (x >= S * 0.30 && x <= barX + barW && y >= beamY && y < beamY + beamH) set(x, y, RED);

      // 音符头（旋转椭圆近似：用偏移圆）
      for (const h of [head1, head2]) {
        const dx = (x - h.x) / (headR * 1.15);
        const dy = (y - h.y) / (headR * 0.92);
        if (dx * dx + dy * dy <= 1) set(x, y, RED);
      }
    }
  }

  // 高光小点
  const hx = S * 0.30 + barW * 0.5;
  const hy = S * 0.34;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - hx, y - hy);
      if (d < S * 0.028) set(x, y, WHITE, 0.35);
    }
  }

  return makePNG(size, size, px);
}

fs.mkdirSync(ICONS, { recursive: true });

const jobs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
  ['favicon-64.png', 64, {}],
];

for (const [name, size, opts] of jobs) {
  const buf = drawIcon(size, opts);
  fs.writeFileSync(path.join(ICONS, name), buf);
  console.log(`  ${name}  ${size}x${size}  ${(buf.length / 1024).toFixed(1)} KB`);
}
console.log('icons done');
