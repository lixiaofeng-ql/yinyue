/**
 * 把本地音乐导入到站点。
 *
 *   node scripts/add-local.mjs <音乐文件夹> [--convert] [--bitrate 192] [--prune]
 *
 * 产出：
 *   media/<文件名>.mp3          音频文件（站点静态资源，浏览器直接播）
 *   media/covers/<文件名>.jpg    封面（可选，与音频同目录的 cover.jpg/folder.jpg/图片文件）
 *   data/local.json              本地歌单清单（含歌词），不会被 CI 的 npm run fetch 覆盖
 *
 * 依赖：ffmpeg / ffprobe（用于读取标签、时长、转码）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const MEDIA = path.join(ROOT, 'media');
const LOCAL_JSON = path.join(DATA, 'local.json');

const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.wma', '.ape']);
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const COVER_NAMES = ['cover', 'folder', 'front', 'album', '封面', '专辑'];

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));
const srcDir = positional[0];

if (!srcDir || flags.has('--help')) {
  console.log(`
用法：
  node scripts/add-local.mjs <音乐文件夹> [选项]

选项：
  --convert        转码为 mp3（192kbps），浏览器兼容性最好，体积最小
  --bitrate <k>   转码码率，默认 192
  --prune          移除清单中已不存在的文件
  --no-lyrics      忽略同名 .lrc 歌词文件
  --keep-ext       保留原始格式（默认在 --convert 时统一转 mp3）

示例：
  node scripts/add-local.mjs "D:\\Music\\华语" --convert
  node scripts/add-local.mjs "D:\\Music" --convert --prune
`);
  process.exit(srcDir ? 0 : 1);
}

function readFlagValue(name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1 || i === argv.length - 1) return fallback;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const BITRATE = String(Math.round(readFlagValue('--bitrate', 192)));
const CONVERT = flags.has('--convert');
const PRUNE = flags.has('--prune');
const USE_LYRICS = !flags.has('--no-lyrics');

/* ---------------- 工具 ---------------- */
function which(cmd) {
  for (const p of (process.env.PATH || '').split(path.delimiter)) {
    if (!p) continue;
    const full = path.join(p, cmd + (os.platform() === 'win32' ? '.exe' : ''));
    if (fs.existsSync(full)) return full;
  }
  return null;
}

const FFPROBE = which('ffprobe');
const FFMPEG = which('ffmpeg');
if (!FFPROBE) {
  console.error('找不到 ffprobe。请安装 ffmpeg 并加入 PATH：https://ffmpeg.org/download.html');
  process.exit(1);
}

function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : '';
}

/** 用 ffprobe 读取音频元信息 */
function probe(file) {
  const out = run(FFPROBE, [
    '-v', 'quiet', '-print_format', 'json',
    '-show_format', '-show_streams', file,
  ]);
  let json;
  try {
    json = JSON.parse(out);
  } catch {
    return {};
  }
  const fmt = json.format || {};
  const stream = (json.streams || []).find((s) => s.codec_type === 'audio') || {};
  const tags = { ...(fmt.tags || {}), ...(stream.tags || {}) };
  const pick = (...keys) => {
    for (const k of keys) {
      const v = tags[k];
      if (v) return String(v).trim();
    }
    return '';
  };
  return {
    duration: Math.round(Number(fmt.duration || stream.duration || 0) * 1000) || undefined,
    title: pick('title', 'TITLE', 'songname', 'TIT2'),
    artist: pick('artist', 'ARTIST', 'albumartist', 'ALBUMARTIST', 'singer', 'TPE1'),
    album: pick('album', 'ALBUM', 'TALB'),
    trackNo: pick('track', 'TRACKNUMBER', 'TRCK'),
    cover: pick('cover', 'picture'),
  };
}

/** 把文件名清洗成安全的相对路径片段 */
function safeName(name) {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 递归收集目录下的音频文件 */
function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

/** 在音频同目录里找封面图 */
function findCover(file) {
  const dir = path.dirname(file);
  const stem = path.basename(file, path.extname(file)).toLowerCase();
  let fallback = null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!IMG_EXT.has(ext)) continue;
    const base = path.basename(e.name, ext).toLowerCase();
    if (COVER_NAMES.includes(base)) return path.join(dir, e.name);
    if (base === stem || base === `${stem}_cover` || base === `${stem}-cover`) {
      return path.join(dir, e.name);
    }
    if (!fallback) fallback = path.join(dir, e.name);
  }
  return fallback;
}

/** 解析 LRC 为 { t, text } 数组 */
function parseLrc(lrc) {
  const out = [];
  if (!lrc) return out;
  // 去掉 UTF-8 BOM
  const text = lrc.replace(/^﻿/, '');
  const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of text.split(/\r?\n/)) {
    re.lastIndex = 0;
    const stamps = [];
    let m;
    while ((m = re.exec(line)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
      stamps.push(min * 60 + sec + ms / 1000);
    }
    if (!stamps.length) continue;
    const text = line.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').trim();
    for (const t of stamps) out.push({ t, text });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/* ---------------- 主流程 ---------------- */
const src = path.resolve(srcDir);
if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
  console.error(`目录不存在：${src}`);
  process.exit(1);
}

console.log(`==> 扫描 ${src}`);
const files = collect(src);
console.log(`  找到 ${files.length} 个音频文件`);
if (!files.length) process.exit(0);

fs.mkdirSync(MEDIA, { recursive: true });
fs.mkdirSync(path.join(MEDIA, 'covers'), { recursive: true });

// 读取已有清单，用于增量更新
let existing = { songs: [], updatedAt: null };
if (fs.existsSync(LOCAL_JSON)) {
  try {
    existing = JSON.parse(fs.readFileSync(LOCAL_JSON, 'utf8'));
  } catch {
    console.warn('  local.json 解析失败，将重建');
  }
}
const prevByPath = new Map((existing.songs || []).map((s) => [s.src, s]));

const songs = [];
let reused = 0;
let converted = 0;
let skipped = 0;

for (const file of files) {
  const rel = path.relative(src, file);
  const base = path.basename(file, path.extname(file));
  const meta = probe(file);

  const stem = safeName(base);
  const ext = CONVERT ? '.mp3' : path.extname(file).toLowerCase() || '.mp3';
  const outName = `${stem}${ext}`;
  const outPath = path.join(MEDIA, outName);
  const mediaRel = `media/${outName}`;

  // 封面（音频同目录的 cover.jpg / folder.jpg / 同名图）
  let coverRel = '';
  let coverMtime = 0;
  const coverSrc = findCover(file);
  if (coverSrc) {
    const coverExt = path.extname(coverSrc).toLowerCase();
    const coverName = `${stem}${coverExt}`;
    const coverDest = path.join(MEDIA, 'covers', coverName);
    coverRel = `media/covers/${coverName}`;
    coverMtime = Math.round(fs.statSync(coverSrc).mtimeMs);
    if (!fs.existsSync(coverDest) || fs.statSync(coverDest).mtimeMs < coverMtime) {
      fs.mkdirSync(path.dirname(coverDest), { recursive: true });
      fs.copyFileSync(coverSrc, coverDest);
    }
  }

  // 歌词（同名 .lrc）
  let lrc = [];
  let lrcMtime = 0;
  if (USE_LYRICS) {
    const lrcPath = path.join(path.dirname(file), base + '.lrc');
    if (fs.existsSync(lrcPath)) {
      lrc = parseLrc(fs.readFileSync(lrcPath, 'utf8'));
      lrcMtime = Math.round(fs.statSync(lrcPath).mtimeMs);
    }
  }

  // 目标已存在且源文件未变 → 复用（歌词/封面有变化时也要重算）
  const prev = prevByPath.get(mediaRel);
  const srcStat = fs.statSync(file);
  const audioUnchanged =
    prev && prev.sourceBytes === srcStat.size &&
    prev.sourceMtime === Math.round(srcStat.mtimeMs) &&
    fs.existsSync(outPath);
  const metaUnchanged =
    !!prev &&
    (prev.lrcMtime || 0) === lrcMtime &&
    (prev.coverMtime || 0) === coverMtime &&
    (prev.pic || '') === coverRel;
  if (audioUnchanged && metaUnchanged) {
    songs.push(prev);
    reused++;
    continue;
  }
  // 音频没变但歌词/封面变了 → 复用已转码的文件，只更新清单
  if (audioUnchanged) {
    songs.push({ ...prev, lrc, lrcMtime, pic: coverRel, coverMtime, no: songs.length + 1 });
    reused++;
    continue;
  }

  if (CONVERT) {
    if (!FFMPEG) {
      console.warn('  找不到 ffmpeg，跳过转码，原样复制');
      fs.copyFileSync(file, outPath);
    } else {
      const r = spawnSync(
        FFMPEG,
        ['-y', '-hide_banner', '-loglevel', 'error', '-i', file,
         '-vn', '-codec:a', 'libmp3lame', '-b:a', `${BITRATE}k`, '-map_metadata', '0', outPath],
        { encoding: 'utf8' }
      );
      if (r.status !== 0) {
        const why = (r.error && r.error.message) || (r.stderr || '').trim() || `退出码 ${r.status}`;
        console.warn(`  转码失败（${why}），复制原文件：${rel}`);
        fs.copyFileSync(file, outPath);
      } else {
        converted++;
      }
    }
  } else {
    fs.copyFileSync(file, outPath);
  }

  const id = `local-${hash(mediaRel)}`;
  songs.push({
    id,
    local: true,
    src: mediaRel,
    name: meta.title || base,
    artists: meta.artist ? [meta.artist] : ['未知歌手'],
    album: meta.album || '',
    pic: coverRel,
    duration: meta.duration,
    no: songs.length + 1,
    lrc,
    lrcMtime,
    coverMtime,
    // 用于增量比对
    sourcePath: rel,
    sourceBytes: srcStat.size,
    sourceMtime: Math.round(srcStat.mtimeMs),
  });
  if (songs.length % 10 === 0) console.log(`  处理中 ${songs.length}/${files.length} ...`);
}

if (PRUNE) {
  const keep = new Set(songs.map((s) => s.src));
  const keepCovers = new Set(songs.map((s) => s.pic).filter(Boolean));
  for (const s of existing.songs || []) {
    if (keep.has(s.src)) continue;
    // 删除音频和它对应的封面
    for (const rel of [s.src, s.pic]) {
      if (!rel || keepCovers.has(rel)) continue;
      const p = path.join(ROOT, rel);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch { /* 忽略 */ }
      }
    }
  }
}

const out = {
  updatedAt: new Date().toISOString(),
  total: songs.length,
  songs,
};
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(LOCAL_JSON, JSON.stringify(out), 'utf8');

let mediaSize = 0;
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else mediaSize += fs.statSync(p).size;
  }
};
if (fs.existsSync(MEDIA)) walk(MEDIA);

console.log(`
完成：
  新增/更新 ${songs.length} 首（复用 ${reused}，转码 ${converted}）
  data/local.json      ${(fs.statSync(LOCAL_JSON).size / 1024).toFixed(1)} KB
  media/ 合计         ${(mediaSize / 1024 / 1024).toFixed(2)} MB
  单文件最大         ${(Math.max(...songs.map((s) => {
    const p = path.join(ROOT, s.src);
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  })) / 1024 / 1024).toFixed(2)} MB（GitHub 上限 100MB/文件）

下一步：
  git add media data/local.json
  git commit -m "feat: 导入本地音乐"
  git push
`);
