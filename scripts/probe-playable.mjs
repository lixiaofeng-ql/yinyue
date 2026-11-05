/**
 * 探测运行时真实可播率。
 * 逐个请求 outer/url，跟随 302 看是否能拿到可用的 CDN 地址。
 * 用法：node scripts/probe-playable.mjs [每档抽样数]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SAMPLE = Number(process.argv[2] || 12);

const songs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/songs.json'), 'utf8')).songs;
const playback = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/playback.json'), 'utf8'));

const FEE_NAME = { 0: '免费', 1: 'VIP', 4: '买断', 8: '专辑' };

/** 请求 outer/url，判断能否解析出可用 CDN 地址 */
async function probe(id) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`https://music.163.com/song/media/outer/url?id=${id}`, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' },
      signal: ctrl.signal,
    });
    const url = res.url || '';
    if (/\.(mp3|flac|m4a)/i.test(url)) {
      // 再验一次 CDN 是否真的放行（HEAD 可能被拒，用 Range GET 取 1KB）
      const r2 = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: 'https://music.163.com/', Range: 'bytes=0-1023' },
        signal: ctrl.signal,
      });
      return { ok: r2.status === 206 || r2.status === 200, status: r2.status, url };
    }
    // 没解析出音频地址 -> 通常是 VIP / 无版权
    return { ok: false, status: res.status, url: url.slice(0, 90) };
  } catch (err) {
    return { ok: false, status: 0, url: String(err.message).slice(0, 60) };
  } finally {
    clearTimeout(timer);
  }
}

const byFee = new Map();
for (const s of songs) {
  const k = s.fee === undefined ? 'undef' : s.fee;
  if (!byFee.has(k)) byFee.set(k, []);
  byFee.get(k).push(s);
}

console.log(`每档抽样 ${SAMPLE} 首，用运行时 outer/url 实测\n`);

const results = [];
for (const [fee, list] of byFee) {
  const step = Math.max(1, Math.floor(list.length / SAMPLE));
  const picks = [];
  for (let i = 0; i < list.length && picks.length < SAMPLE; i += step) picks.push(list[i]);
  let ok = 0;
  for (const s of picks) {
    const r = await probe(s.id);
    if (r.ok) ok++;
    results.push({ name: s.name, artist: (s.artists || [])[0], fee, ok: r.ok, status: r.status });
    await new Promise((r) => setTimeout(r, 250));
  }
  const label = FEE_NAME[fee] || `fee=${fee}`;
  console.log(
    `${label.padEnd(6)} 抽样 ${picks.length}  →  可播 ${ok}  (${Math.round((ok / picks.length) * 100)}%)`
  );
}

console.log('\n不可播的样本：');
results.filter((r) => !r.ok).slice(0, 15).forEach((r) => {
  console.log(`  [${FEE_NAME[r.fee] || r.fee}] ${r.name} - ${r.artist}  (${r.status})`);
});

const total = results.length;
const okTotal = results.filter((r) => r.ok).length;
console.log(`\n总体抽样可播率：${okTotal}/${total} = ${Math.round((okTotal / total) * 100)}%`);

// 缓存直链的过期验证
const withUrl = songs.filter((s) => playback[s.id]).slice(0, 5);
console.log('\n缓存直链（playback.json）过期检查：');
for (const s of withUrl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(playback[s.id], {
      headers: { 'User-Agent': UA, Referer: 'https://music.163.com/', Range: 'bytes=0-1023' },
      signal: ctrl.signal,
    });
    console.log(`  ${s.name}: HTTP ${r.status} ${r.status === 206 || r.status === 200 ? 'OK' : '已过期'}`);
  } catch (e) {
    console.log(`  ${s.name}: 失败 ${String(e.message).slice(0, 40)}`);
  } finally {
    clearTimeout(timer);
  }
}
