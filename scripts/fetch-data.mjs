/**
 * 抓取网易云音乐榜单 / 歌单 / 歌词 / 搜索索引，生成静态 JSON。
 *
 * 在 GitHub Actions（服务器侧）执行，无 CORS 限制。
 * 运行时前端只读本地 JSON + 网易云 outer/url 播放接口。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const REFERER = 'https://music.163.com/';

// 榜单：从接口返回的 65 个榜单里按播放量挑选，保证 id 永远有效
const CHART_KEYWORDS = [
  { key: 'rising',  name: '飙升榜',  match: '飙升' },
  { key: 'hot',     name: '热歌榜',  match: '热歌' },
  { key: 'new',     name: '新歌榜',  match: '新歌' },
  { key: 'original',name: '原创榜',  match: '原创' },
  { key: 'rock',    name: '摇滚榜',  match: '摇滚' },
  { key: 'rap',     name: '说唱榜',  match: '说唱' },
  { key: 'electro', name: '电音榜',  match: '电音' },
  { key: 'folk',    name: '民谣榜',  match: '民谣' },
  { key: 'classical', name: '古典榜', match: '古典' },
  { key: 'global',  name: '全球榜',  match: '全球' },
  { key: 'billboard', name: 'Billboard', match: 'Billboard' },
  { key: 'jazz',    name: '爵士榜',  match: '爵士' },
];

// 精选歌单（从 /api/playlist/list 按分类动态获取，保证内容新鲜且 id 有效）
const PLAYLIST_CATS = [
  { cat: '华语',   count: 4 },
  { cat: '流行',   count: 4 },
  { cat: '摇滚',   count: 3 },
  { cat: '民谣',   count: 3 },
  { cat: '电音',   count: 3 },
  { cat: '轻音乐', count: 3 },
  { cat: '纯音乐', count: 3 },
  { cat: '夜晚',   count: 3 },
  { cat: '运动',   count: 3 },
  { cat: '治愈',   count: 3 },
  { cat: '古风',   count: 3 },
  { cat: '说唱',   count: 3 },
];

// 每个榜单/歌单取多少首
const TRACKS_PER_LIST = 100;
// 歌词抓取上限（太多会拖慢构建）
const LYRIC_LIMIT = 500;

async function api(url, { timeout = 20000, retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: REFERER, Accept: '*/*' },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 解析网易云播放直链：请求 outer/url，跟随 302 拿到 CDN 地址，
 * 去掉时效性 query（实测不带 token 也能播），并强制 https。
 */
async function resolvePlayback(songId) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(
      `https://music.163.com/song/media/outer/url?id=${songId}`,
      {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': UA, Referer: REFERER },
        signal: ctrl.signal,
      }
    );
    const finalUrl = res.url;
    if (!finalUrl || !/\.(mp3|flac|m4a)/i.test(finalUrl)) return null;
    // 去掉 ?vuutv=... 这类时效参数（CDN 路径本身即可访问）
    const clean = finalUrl.split('?')[0].replace(/^http:\/\//, 'https://');
    return clean;
  } finally {
    clearTimeout(timer);
  }
}

/** 精简一首歌曲的字段 */
function trimSong(t, index) {
  return {
    id: t.id,
    name: t.name,
    alias: t.alias && t.alias.length ? t.alias : undefined,
    artists: (t.artists || []).map((a) => a.name),
    artistIds: (t.artists || []).map((a) => a.id),
    album: t.album ? t.album.name : '',
    albumId: t.album ? t.album.id : undefined,
    pic: t.album ? (t.album.picUrl || '').replace(/^http:/, 'https:') : '',
    duration: t.duration || undefined,
    no: index + 1,
    fee: t.fee,
    mv: t.mv || undefined,
  };
}

/** 解析 LRC 为 { time, text } 数组 */
function parseLrc(lrc) {
  const out = [];
  if (!lrc) return out;
  const lines = lrc.split('\n');
  const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of lines) {
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
    const text = line.replace(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g, '').trim();
    for (const t of stamps) out.push({ t, text });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function writeJSON(rel, obj) {
  const file = path.join(DATA, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj), 'utf8');
  const size = (fs.statSync(file).size / 1024).toFixed(1);
  console.log(`  wrote ${rel}  (${size} KB)`);
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  console.log('==> toplist');
  const toplist = await api('https://music.163.com/api/toplist');

  const charts = [];
  const playlists = [];

  // ---------- 榜单（按关键词从 live toplist 匹配） ----------
  const live = toplist.list || [];
  const usedChartIds = new Set();
  for (const plan of CHART_KEYWORDS) {
    const hit = live.find(
      (c) => !usedChartIds.has(c.id) && c.name && c.name.includes(plan.match)
    );
    if (!hit) {
      console.log(`  chart ${plan.name} ... no live chart matched`);
      continue;
    }
    usedChartIds.add(hit.id);
    process.stdout.write(`  chart ${plan.name} (${hit.id}) ... `);
    try {
      const d = await api(
        `https://music.163.com/api/playlist/detail?id=${hit.id}&n=${TRACKS_PER_LIST}&s=0`
      );
      const result = d.result || {};
      const tracks = (result.tracks || []).map(trimSong);
      charts.push({
        id: hit.id,
        key: plan.key,
        name: plan.name,
        cover: (hit.coverImgUrl || result.coverImgUrl || '').replace(/^http:/, 'https:'),
        updateFrequency: hit.updateFrequency || result.updateFrequency || '',
        description: (result.description || '').replace(/\s+/g, ' ').slice(0, 200),
        playCount: hit.playCount || 0,
        trackCount: result.trackCount || tracks.length,
        tracks,
      });
      console.log(`${tracks.length} tracks`);
    } catch (err) {
      console.log(`FAILED (${err.message})`);
    }
    await sleep(300);
  }

  // ---------- 歌单（按分类动态获取） ----------
  const usedPlaylistIds = new Set();
  let plSeq = 0;
  for (const cat of PLAYLIST_CATS) {
    process.stdout.write(`  playlist cat=${cat.cat} ... `);
    try {
      const d = await api(
        `https://music.163.com/api/playlist/list?cat=${encodeURIComponent(
          cat.cat
        )}&order=hot&limit=${cat.count * 3}&offset=0`
      );
      const candidates = (d.playlists || []).filter(
        (p) => !usedPlaylistIds.has(p.id) && (p.trackCount || 0) >= 10
      );

      let added = 0;
      for (const cand of candidates) {
        if (added >= cat.count) break;
        usedPlaylistIds.add(cand.id);
        try {
          const det = await api(
            `https://music.163.com/api/playlist/detail?id=${cand.id}&n=${TRACKS_PER_LIST}&s=0`
          );
          const result = det.result || {};
          const tracks = (result.tracks || []).map(trimSong);
          if (!tracks.length) continue;
          playlists.push({
            id: cand.id,
            key: `pl${plSeq++}`,
            name: cand.name,
            cover: (cand.coverImgUrl || result.coverImgUrl || '').replace(/^http:/, 'https:'),
            description: (cand.description || '').replace(/\s+/g, ' ').slice(0, 200),
            creator: cand.creator ? cand.creator.nickname : '',
            tags: (cand.tags || []).join(' / '),
            playCount: cand.playCount || 0,
            trackCount: cand.trackCount || tracks.length,
            tracks,
          });
          added++;
        } catch {
          /* 跳过 */
        }
        await sleep(150);
      }
      console.log(`${added} lists`);
    } catch (err) {
      console.log(`FAILED (${err.message})`);
    }
    await sleep(300);
  }

  // ---------- 汇总索引 ----------
  const songMap = new Map();
  for (const list of [...charts, ...playlists]) {
    for (const t of list.tracks) {
      if (!songMap.has(t.id)) songMap.set(t.id, t);
    }
  }
  const songs = [...songMap.values()];

  // ---------- 歌手聚合 ----------
  const singerMap = new Map();
  for (const t of songs) {
    (t.artistIds || []).forEach((id, i) => {
      const name = t.artists[i];
      if (!id || !name) return;
      if (!singerMap.has(id)) {
        singerMap.set(id, { id, name, pic: '', songIds: [], hotSongId: t.id });
      }
      const s = singerMap.get(id);
      s.songIds.push(t.id);
      if (!s.pic) s.pic = t.pic;
    });
  }

  // ---------- 热门歌手（官方接口，补齐封面和热门歌曲） ----------
  const HOT_ARTISTS = 40;
  try {
    const d = await api(
      `https://music.163.com/api/artist/list?type=-1&categoryCode=5001&offset=0&limit=${HOT_ARTISTS}`
    );
    for (const a of (d.artists || []).slice(0, HOT_ARTISTS)) {
      if (!singerMap.has(a.id)) {
        singerMap.set(a.id, {
          id: a.id,
          name: a.name,
          alias: a.alias || [],
          pic: (a.picUrl || a.img1v1Url || '').replace(/^http:/, 'https:'),
          songIds: [],
          hotSongId: null,
        });
      } else if (!singerMap.get(a.id).pic) {
        singerMap.get(a.id).pic = (a.picUrl || a.img1v1Url || '').replace(/^http:/, 'https:');
      }
    }
    console.log(`  hot artists: ${(d.artists || []).length}`);
  } catch (err) {
    console.log(`  hot artists FAILED (${err.message})`);
  }

  // 给热门歌手补充各自的热门单曲（让歌手页能真的播）
  const artistList = [...singerMap.values()].filter((s) => !s.songIds.length).slice(0, 24);
  for (const s of artistList) {
    try {
      const d = await api(
        `https://music.163.com/api/artist/${s.id}?limit=30&offset=0`
      );
      const hot = d.hotSongs || [];
      const ids = hot.map((t) => t.id);
      for (const t of hot) {
        if (!songMap.has(t.id)) {
          const trimmed = trimSong(t, 0);
          songMap.set(t.id, trimmed);
        }
      }
      s.songIds = ids;
      s.hotSongId = ids[0] || null;
    } catch {
      /* 跳过 */
    }
    await sleep(200);
  }
  console.log(`  artists with hot songs: ${artistList.length}`);

  // ---------- 补充语料：热门歌手的代表作（让搜索覆盖主流华语歌） ----------
  const SEED_ARTISTS = [
    '周杰伦', '林俊杰', '陈奕迅', '王菲', '孙燕姿', '薛之谦', '张杰', '李荣浩',
    '邓紫棋', 'G.E.M.邓紫棋', '薛凯琪', '容祖儿', '梁静茹', '蔡依林', '五月天',
    '许嵩', '汪苏泷', '毛不易', '华晨宇', '张艺兴', '易烊千玺', '周深', '刘惜君',
    '许飞', '郑润泽', '颜人中', '任然', '陈雪凝', '张碧晨', '程响', '阿兰',
    '李宇春', '周深', '胡夏', '金志文', '赵雷', '宋冬野', '马頔', '房东的猫',
    '告五人', '苏打绿', '五月天', '逃跑计划', '新裤子', '痛仰', '海龟先生',
  ];
  console.log(`==> seeding ${SEED_ARTISTS.length} artists' hot songs`);
  let seedAdded = 0;
  const seedQueue = SEED_ARTISTS.slice();
  async function seedWorker() {
    while (seedQueue.length) {
      const name = seedQueue.shift();
      try {
        const d = await api(
          `https://music.163.com/api/search/get?s=${encodeURIComponent(name)}&type=100&limit=20`
        );
        const list = (d.result && d.result.artists) || [];
        for (const a of list.slice(0, 2)) {
          try {
            const ad = await api(`https://music.163.com/api/artist/${a.id}?limit=30&offset=0`);
            const hot = ad.hotSongs || [];
            for (const t of hot) {
              if (!songMap.has(t.id)) {
                songMap.set(t.id, trimSong(t, 0));
                seedAdded++;
              }
            }
            if (!singerMap.has(a.id)) {
              singerMap.set(a.id, {
                id: a.id,
                name: a.name,
                alias: a.alias || [],
                pic: (a.picUrl || a.img1v1Url || '').replace(/^http:/, 'https:'),
                songIds: hot.map((t) => t.id),
                hotSongId: hot[0] ? hot[0].id : null,
              });
            }
          } catch {
            /* 跳过 */
          }
        }
      } catch {
        /* 跳过 */
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, seedWorker));
  console.log(`  seeded ${seedAdded} songs`);

  // 重新汇总（语料已扩充）
  const allSongs = [...songMap.values()];
  const finalSingers = [...singerMap.values()]
    .map((s) => ({ ...s, songIds: s.songIds.slice(0, 50) }))
    .sort((a, b) => b.songIds.length - a.songIds.length)
    .slice(0, 48);

  // ---------- MV（专用接口，含真实播放地址） ----------
  const mvs = [];
  try {
    const mvList = await api('https://music.163.com/api/mv/all?limit=40&offset=0');
    for (const mv of (mvList.data || []).slice(0, 30)) {
      mvs.push({
        id: mv.id,
        name: mv.name,
        artists: (mv.artists || []).map((a) => a.name),
        artistId: mv.artistId,
        cover: (mv.cover || '').replace(/^http:/, 'https:'),
        playCount: mv.playCount || 0,
        duration: mv.duration || 0,
        desc: (mv.briefDesc || '').replace(/\s+/g, ' ').slice(0, 150),
      });
    }
    console.log(`  mv: ${mvs.length}`);
  } catch (err) {
    console.log(`  mv FAILED (${err.message})`);
  }

  // ---------- MV 播放地址（构建时抓取并内联，避免运行时跨域） ----------
  const mvUrls = {};
  for (const m of mvs.slice(0, 12)) {
    try {
      const d = await api(`https://music.163.com/api/mv/detail/?id=${m.id}`);
      const brs = d.data && d.data.brs;
      if (brs) {
        const pick = brs['1080'] || brs['720'] || brs['480'] || brs['240'];
        if (pick) mvUrls[m.id] = pick.replace(/^http:/, 'https:');
      }
    } catch {
      /* 跳过 */
    }
    await sleep(200);
  }
  console.log(`  mv urls: ${Object.keys(mvUrls).length}`);

  // ---------- 歌曲播放直链（构建时解析 outer/url 的 302 目标） ----------
  // outer/url 本身在浏览器里可用，但它 302 到 http:// CDN，
  // 在 HTTPS 页面（GitHub Pages / Safari）会被浏览器按混合内容拦截。
  // 所以在构建时把重定向目标解析出来并改成 https://，运行时直接用。
  console.log(`==> resolving playback urls (${allSongs.length} songs)`);
  const playback = {};
  let resolved = 0;

  // 并发解析，避免串行等待过久
  const CONCURRENCY = 12;
  const queue = allSongs.slice();
  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      try {
        const loc = await resolvePlayback(s.id);
        if (loc) {
          playback[s.id] = loc;
          resolved++;
        }
      } catch {
        /* 跳过 */
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`  resolved: ${resolved}/${allSongs.length}`);

  writeJSON('playback.json', playback);

  writeJSON('charts.json', { updatedAt: new Date().toISOString(), charts });
  writeJSON('playlists.json', { updatedAt: new Date().toISOString(), playlists });
  writeJSON('songs.json', { updatedAt: new Date().toISOString(), songs: allSongs });
  writeJSON('singers.json', { updatedAt: new Date().toISOString(), singers: finalSingers });
  writeJSON('mvs.json', { updatedAt: new Date().toISOString(), mvs, urls: mvUrls });

  // ---------- 歌词 ----------
  console.log(`==> lyrics (${Math.min(allSongs.length, LYRIC_LIMIT)} songs)`);
  const lyrics = {};
  let ok = 0;
  const targets = allSongs.slice(0, LYRIC_LIMIT);
  const lrcQueue = targets.slice();
  async function lrcWorker() {
    while (lrcQueue.length) {
      const s = lrcQueue.shift();
      try {
        const d = await api(
          `https://music.163.com/api/song/lyric?id=${s.id}&lv=1&kv=1&tv=-1`,
          { timeout: 12000, retries: 2 }
        );
        const lrc = d.lrc && d.lrc.lyric;
        const tlyric = d.tlyric && d.tlyric.lyric;
        if (lrc && lrc.trim()) {
          lyrics[s.id] = { lrc: parseLrc(lrc), t: tlyric ? parseLrc(tlyric) : [] };
          ok++;
        }
      } catch {
        /* 跳过失败的 */
      }
    }
  }
  await Promise.all(
    Array.from({ length: 10 }, async () => {
      while (lrcQueue.length) {
        await lrcWorker();
        break;
      }
    })
  );
  writeJSON('lyrics.json', lyrics);
  console.log(`==> done: ${allSongs.length} songs, ${ok} lyrics, ${finalSingers.length} singers`);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
