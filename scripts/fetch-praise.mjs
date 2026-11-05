/**
 * 抓取「赞美诗歌 / 敬拜赞美」相关歌单与曲目，生成 data/praise.json。
 *
 * 独立的脚本，不影响主流程（scripts/fetch-data.mjs）。
 * 输出结构：
 *   data/praise.json  { updatedAt, playlists: [...], songs: [...] }
 *
 * 歌单来源：网易云「搜索歌单」接口（关键词）+ 已验证的高质量歌单 ID。
 * 曲目来源：/api/v6/playlist/detail（拿全部 trackIds）+ /api/song/detail（批量取歌曲详情）。
 * 播放地址：运行时走 outer/url（与主流程一致），构建时只做可播性探测，避免缓存过期直链。
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
const H = { 'User-Agent': UA, Referer: REFERER, Accept: '*/*' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 全局请求节流：网易云对短时间内的密集请求会返回
 * `{"code":405,"msg":"操作频繁，请稍候再试"}`（HTTP 仍是 200）。
 * 所有请求排队，保证任意两次请求之间至少间隔 MIN_GAP 毫秒。
 */
const MIN_GAP = 260;
let lastCall = 0;
async function throttle() {
  const wait = lastCall + MIN_GAP - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

async function api(url, { timeout = 20000, retries = 4 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    await throttle();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { headers: H, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('bad json');
      }
      // 网易云业务错误码（HTTP 200 但 body 里是错误）
      if (json && typeof json.code === 'number' && json.code !== 200) {
        const msg = json.msg || json.message || `code ${json.code}`;
        // 405/429 = 被限流，退避更久再重试
        if (json.code === 405 || json.code === 429 || json.code === -460) {
          throw new Error(`限流(${json.code})`);
        }
        throw new Error(msg);
      }
      return json;
    } catch (err) {
      lastErr = err;
      const isThrottle = /限流|429|460|abort|timeout/i.test(err.message);
      await sleep(isThrottle ? 2500 * (i + 1) : 700 * (i + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/* ============================================================
 * 歌单来源
 * ============================================================ */

/** 搜索歌单用的关键词（覆盖中文圣歌、英文敬拜、各类教派诗歌） */
const SEARCH_KEYWORDS = [
  '赞美诗', '圣歌', '敬拜赞美', '赞美之泉', '一切歌颂赞美', '恩典366',
  '教堂诗班', '英文诗歌', '基督徒歌曲', '信望爱', '齐来敬拜', '福音歌曲',
  '敬拜诗歌', '诗歌 敬拜', '主内诗歌', '迦南诗选', '小羊诗歌', '经典圣诗',
  '复活节英文赞美', '圣诞节诗歌', '经典灵修圣诗', '粤语诗歌', '诗篇歌颂',
  '天主圣歌', '赞美诗 中文',
];

/** 已人工验证的高质量歌单（关键词命中 + 内容确实为赞美诗歌） */
const CURATED_IDS = [
  6628469427, // 赞美之泉 Stream of Praise Music Ministri（358 首）
  18180293667, // 赞美之泉 ❤️（44 首）
  18221591888, // 赞美之泉（40 首）
  8158041699, // 赞美之泉（23 首）
  2861255859, // 赞美之泉（17 首）
  395582435, // 赞美之泉（13 首）
  18181491639, // 敬拜赞美乐（234 首）
  3194527502, // 一切歌颂赞美（73 首）
  2409632460, // 一切歌颂赞美（55 首）
  3080610650, // 恩典366☆敬拜赞美（17 首）
  2880263624, // 英文敬拜赞美诗歌（11 首）
  5449652820, // 适合敬拜的赞美诗（7 首）
  149369755, // 英文诗歌_敬拜（56 首）
  2068933342, // 圣歌（48 首）
  925741667, // 圣歌（141 首）
  828490823, // 圣歌｜空灵皎洁 温润飘渺（105 首）
  704442760, // 教堂诗班合唱精选（29 首）
  5068053748, // 路德宗《齐来敬拜》诗歌部分（30 首）
  899525422, // 经典灵修圣诗（17 首）
  2544459349, // 詩歌｜诗篇歌颂（295 首）
  6628305910, // 小羊诗歌（277 首）
  2730119175, // 主内诗歌【国度属于你】（20 首）
  5381385248, // 主内诗歌（33 首）
  2847066745, // 主内诗歌（English）（26 首）
  4981008064, // 经典圣诗（英文版）（73 首）
  2146589699, // 复活节英文赞美（38 首）
  149390553, // 圣诞节诗歌（75 首）
  9370927176, // 粤语诗歌（49 首）
  882330018, // 圣歌&赞美诗（13 首）
  13673568225, // 天主圣歌主题（44 首）
  4912350768, // 基督圣歌（16 首）
  6604875280, // 教堂圣歌.教皇合唱团（478 首）
  5167169378, // 圣歌教堂与祈祷（500 首）
  9715830002, // 不可小觑的当代基督教音乐（28 首）
  2901939474, // 圣乐-早期基督教音乐（37 首）
  2642747477, // 迦南诗选（10 首）
  3188398362, // 迦南诗选1016（12 首）
  5481072137, // 灵修诗歌（13 首）
  546485699, // 圣诞颂歌（18 首）
  6657468326, // 我愿为你去（Cover 小羊诗歌）（189 首）
  9370927176,
  13673568225,
];

/* ============================================================
 * 曲目筛选规则
 * ============================================================ */

/** 歌单名必须命中（确认是赞美诗歌歌单） */
const PLAYLIST_RE =
  /(赞美|讚美|聖歌|圣歌|敬拜|敬讚|福音|詩歌|诗歌|禮拜|礼拜|聖詩|圣诗|頌讚|颂赞|齊來敬拜|齐来敬拜|信望愛|信望爱|晨禱|晨祷|靈修|灵修|church|worship|hymn|gospel|praise|christian)/i;

/** 歌单名命中即排除（这些是"纯音乐/伴奏/朗诵/助眠"类，不是可以唱/听的赞美曲） */
const PLAYLIST_EXCLUDE_RE =
  /(纯音乐|純音樂|伴奏|輕音樂|轻音乐|钢琴|鋼琴|助眠|冥想|白噪音|朗诵|朗誦|吟诵|吟誦|环境音|環境音|背景音|情景|治愈|治癒|脑波|睡眠|guitar|lofi|piano|instrumental|relax|meditat|ambient|asmr|朗读|朗讀|对白|對白|台词|台詞|独白|獨白|散文诗|散文詩|背景音乐|背景音樂|音效|铃声|鈴聲|闹钟|鬧鐘|原声带|原聲帶|游戏|遊戲|动漫|動漫|纯音|純音|素材|音效)/i;

/** 曲目名 / 歌手 / 专辑命中即认为是赞美歌曲 */
const TRACK_RE =
  /(赞美|讚美|聖歌|圣歌|敬拜|敬讚|福音|詩歌|诗歌|禮拜|礼拜|聖詩|圣诗|頌讚|颂赞|齊來敬拜|齐来敬拜|信望愛|信望爱|晨禱|晨祷|神|主|耶穌|耶稣|基督|聖靈|圣灵|恩典|救贖|救赎|禱告|祷告|至高|榮耀|荣耀|福音|平安|喜樂|喜乐|平安|感恩|信望愛|amazing grace|worship|hallelujah|jesus|christ|lord|holy spirit|how great|beautiful|be with you|build my life|draw me near|bless|o lord|near you|lift.*(up|name)|praise|what a friend|worthy|king of|goodness of god|waymaker|this is my|peace be|breathe|good news|rescue|refuge|anchor|battle belongs|trust in you|fear is not|i am loved|every breath|great things|still|silent|holy|thy will|seek|first love|tell me|faithful|thankful|grateful|we belong|children of|kingdom|awesome|all i ask|here i am|baptized|invicta|burning|fire|perfect|son of god|love like|jesus my king|there is nothing|country|desert|waiting for|this kingdom|kingdom come|spirit of|wildest|love so|desire of|unstoppable|made for|you are for me|nothing else|all that i am|bulletproof|mother father|trust in the|river|burned|glory to glory)/i;

/** 曲目命中即排除（伴奏版、纯音乐、remix 伴奏、教程等） */
const TRACK_EXCLUDE_RE =
  /(伴奏|纯音乐|純音樂|钢琴版|钢琴演奏|鋼琴演奏|吉他版|演奏版|beat|伴奏带| karaoke|karaoke版|教学|教程|翻唱教程|谱|伴奏谱|练习|beats|instrumental|remix.*伴奏|piano cover| guitar cover|demo version|试听|铃声|闹钟|朗诵|朗誦|吟诵|吟誦|对白|對白|台词|台詞|独白|獨白|有声读物|有聲讀物|广播剧|廣播劇|广播|廣播|ASMR|助眠|白噪音|音效|纯音|純音|素材|Remix.*版|伴奏教程)/i;

/** 歌手命中即排除（不是敬拜团/教会歌手的账号，多半是搬运号） */
const ARTIST_EXCLUDE_RE = /(钢琴|鋼琴|轻音乐|純音樂|纯音乐|钢琴家|church bells|大自然|白噪音|助眠|冥想|relax|relaxing|lofi|asmr)/i;

/* ============================================================
 * 工具
 * ============================================================ */

/**
 * /api/v1/song/detail 的紧凑字段 → 统一成主流程的歌曲结构。
 *   ar → artists / al → album / dt → duration（毫秒）
 */
function normalizeSong(t) {
  return {
    id: t.id,
    name: t.name,
    alias: t.alia || [],
    artists: (t.ar || []).map((a) => a.name),
    artistIds: (t.ar || []).map((a) => a.id),
    album: t.al?.name || '',
    albumId: t.al?.id,
    pic: (t.al?.picUrl || '').replace(/^http:/, 'https:'),
    duration: t.dt,
    fee: t.fee,
    mv: t.mv || undefined,
  };
}

/**
 * 精简歌曲字段（与主流程 trimSong 的结构保持一致）。
 * 入参是 normalizeSong 的输出：artists 已是字符串数组，album 已是字符串。
 */
function trimSong(t, index) {
  return {
    id: t.id,
    name: t.name,
    alias: t.alias && t.alias.length ? t.alias : undefined,
    artists: t.artists || [],
    artistIds: t.artistIds || [],
    album: t.album || '',
    albumId: t.albumId,
    pic: t.pic || '',
    duration: t.duration || undefined,
    no: index + 1,
    fee: t.fee,
    mv: t.mv || undefined,
  };
}

/**
 * 探测歌曲是否真的能播：请求 outer/url 跟随 302 到 CDN，再发 Range 请求。
 * fee=1（VIP）在未登录时基本拿不到地址，探测结果为失败。
 */
async function probePlayable(id) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(
      `https://music.163.com/song/media/outer/url?id=${id}`,
      { redirect: 'follow', headers: H, signal: ctrl.signal }
    );
    const url = res.url;
    if (!url || !/\.(mp3|flac|m4a)/i.test(url)) return false;
    const r2 = await fetch(url, {
      headers: { Range: 'bytes=0-2047', 'User-Agent': UA, Referer: REFERER },
    });
    if (r2.status !== 200 && r2.status !== 206) return false;
    const buf = await r2.arrayBuffer();
    return buf.byteLength > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/* ============================================================
 * 主流程
 * ============================================================ */

async function main() {
  fs.mkdirSync(DATA, { recursive: true });

  // ---------- 1. 收集候选歌单 ----------
  console.log('==> collecting playlists');
  const candidates = new Map();

  for (const id of CURATED_IDS) {
    if (!candidates.has(id)) candidates.set(id, { id, source: 'curated' });
  }

  for (const kw of SEARCH_KEYWORDS) {
    try {
      const d = await api(
        `https://music.163.com/api/search/get?s=${encodeURIComponent(kw)}&type=1000&limit=20`
      );
      for (const p of d.result?.playlists || []) {
        if (candidates.has(p.id)) continue;
        if (!PLAYLIST_RE.test(p.name)) continue;
        if (PLAYLIST_EXCLUDE_RE.test(p.name)) continue;
        if ((p.trackCount || 0) < 6) continue;
        candidates.set(p.id, {
          id: p.id,
          name: p.name,
          creator: p.creator?.nickname || '',
          cover: (p.coverImgUrl || '').replace(/^http:/, 'https:'),
          playCount: p.playCount || 0,
          trackCount: p.trackCount || 0,
          source: 'search',
        });
      }
    } catch (err) {
      console.log(`  search "${kw}" FAILED (${err.message})`);
    }
    await sleep(180);
  }
  console.log(`  candidates: ${candidates.size}`);

  // ---------- 2. 逐个歌单取曲目 ----------
  console.log('==> fetching playlists');
  const playlists = [];
  const songMap = new Map();

  // 磁盘缓存：歌单曲目变化很慢，缓存 12 小时，避免每次重跑都打满接口（触发限流）
  const CACHE_DIR = path.join(ROOT, '.cache-praise');
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const CACHE_TTL = 12 * 3600 * 1000;

  for (const cand of candidates.values()) {
    const cacheFile = path.join(CACHE_DIR, `pl-${cand.id}.json`);
    let pl = null;
    let ids = [];

    // 1) 读缓存
    try {
      const st = fs.statSync(cacheFile);
      if (Date.now() - st.mtimeMs < CACHE_TTL) {
        const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        pl = c.pl;
        ids = c.ids || [];
      }
    } catch {
      /* 无缓存 */
    }

    // 2) 走接口
    if (!ids.length) {
      try {
        const v6 = await api(
          `https://music.163.com/api/v6/playlist/detail?id=${cand.id}&n=1000&s=0`
        );
        pl = v6.playlist;
        ids = (pl?.trackIds || []).map((t) => t.id);
      } catch (err) {
        console.log(`  ${cand.id} v6 FAILED (${err.message})`);
      }
      if (!ids.length) {
        // 回退到旧接口（部分歌单 v6 拿不到 trackIds）
        try {
          const d = await api(
            `https://music.163.com/api/playlist/detail?id=${cand.id}&n=200&s=0`
          );
          pl = d.result;
          ids = (pl?.tracks || []).map((t) => t.id);
        } catch (err) {
          console.log(`  ${cand.id} fallback FAILED (${err.message})`);
        }
      }
      if (ids.length) {
        try {
          fs.writeFileSync(
            cacheFile,
            JSON.stringify({ pl: { ...pl, trackIds: undefined }, ids }),
            'utf8'
          );
        } catch {
          /* 缓存写失败不影响主流程 */
        }
      }
    }
    if (!ids.length || !pl) continue;

    // 歌单名/简介二次过滤
    const pName = pl.name || cand.name || '';
    if (!PLAYLIST_RE.test(pName)) continue;
    if (PLAYLIST_EXCLUDE_RE.test(pName)) continue;

    // 批量取歌曲详情
    // 注意：/api/song/detail 会被网易云限流（code 405 操作频繁），
    // 改用 /api/v1/song/detail —— 不限流，且一次最多可取几百首。
    // 它的字段是紧凑格式：ar / al / dt / alia。
    const tracks = [];
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      try {
        const det = await api(
          `https://music.163.com/api/v1/song/detail?ids=${encodeURIComponent(JSON.stringify(batch))}`
        );
        for (const s of det.songs || []) tracks.push(normalizeSong(s));
      } catch (err) {
        console.log(`  ${cand.id} song/detail FAILED (${err.message})`);
      }
    }
    if (!tracks.length) continue;

    // 筛选：必须是赞美歌曲，且排除伴奏/纯音乐
    const kept = tracks.filter((t) => {
      const artists = t.artists || [];
      if (ARTIST_EXCLUDE_RE.test(artists.join(' '))) return false;
      const hit =
        TRACK_RE.test(t.name) ||
        TRACK_RE.test(t.album || '') ||
        artists.some((a) => TRACK_RE.test(a));
      if (!hit) return false;
      const full = `${t.name} ${t.album || ''} ${artists.join(' ')}`;
      if (TRACK_EXCLUDE_RE.test(full)) return false;
      return true;
    });

    if (kept.length < 4) continue;

    playlists.push({
      id: cand.id,
      key: `pr${playlists.length}`,
      name: pName,
      cover: (pl.coverImgUrl || cand.cover || '').replace(/^http:/, 'https:'),
      description: (pl.description || '').replace(/\s+/g, ' ').slice(0, 200),
      creator: pl.creator?.nickname || cand.creator || '',
      playCount: cand.playCount || pl.playCount || 0,
      trackCount: kept.length,
      totalTrackCount: ids.length,
      tracks: kept.map(trimSong),
    });

    for (const t of kept) {
      if (!songMap.has(t.id)) songMap.set(t.id, trimSong(t, 0));
    }
    console.log(`  ${pName} | ${kept.length}/${ids.length} 首保留`);
    await sleep(150);
  }

  // ---------- 3. 探测可播性（只探测全局去重后的歌曲） ----------
  const allSongs = [...songMap.values()];
  console.log(`==> probing playability (${allSongs.length} songs)`);
  const playable = new Set();

  // 可播性缓存（3 天）：网易云的版权状态基本不变，但探测很慢（每首要 2 次请求）
  const probeCacheFile = path.join(CACHE_DIR, 'playable.json');
  let probeCache = {};
  try {
    const st = fs.statSync(probeCacheFile);
    if (Date.now() - st.mtimeMs < 3 * 24 * 3600 * 1000) {
      probeCache = JSON.parse(fs.readFileSync(probeCacheFile, 'utf8'));
    }
  } catch {
    /* 无缓存 */
  }

  const probeQueue = [];
  for (const s of allSongs) {
    const cached = probeCache[s.id];
    if (cached === true) {
      playable.add(s.id);
    } else if (cached === false) {
      /* 已知不可播，跳过探测 */
    } else {
      probeQueue.push(s);
    }
  }
  console.log(`  cache hit: ${playable.size}, to probe: ${probeQueue.length}`);

  async function probeWorker() {
    while (probeQueue.length) {
      const s = probeQueue.shift();
      let ok = false;
      try {
        ok = await probePlayable(s.id);
      } catch {
        /* 忽略 */
      }
      probeCache[s.id] = ok;
      if (ok) playable.add(s.id);
    }
  }
  await Promise.all(Array.from({ length: 4 }, probeWorker));
  try {
    fs.writeFileSync(probeCacheFile, JSON.stringify(probeCache), 'utf8');
  } catch {
    /* 忽略 */
  }
  console.log(`  playable: ${playable.size}/${allSongs.length}`);

  // ---------- 4. 输出：只保留可播曲目 ----------
  // 同名歌单合并（网易云上「赞美之泉」有十几个搬运号，内容大同小异）
  const merged = new Map();
  for (const p of playlists) {
    const tracks = p.tracks.filter((t) => playable.has(t.id));
    if (tracks.length < 3) continue;
    const key = p.name.replace(/\s+/g, '').toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, { ...p, tracks: [], trackCount: 0 });
    }
    const m = merged.get(key);
    const have = new Set(m.tracks.map((t) => t.id));
    for (const t of tracks) {
      if (!have.has(t.id)) {
        m.tracks.push(t);
        have.add(t.id);
      }
    }
    m.trackCount = m.tracks.length;
    m.totalTrackCount = Math.max(m.totalTrackCount || 0, p.totalTrackCount || 0);
    // 保留信息量更大的封面/简介
    if (!m.cover && p.cover) m.cover = p.cover;
    if (!m.description && p.description) m.description = p.description;
    if (!m.creator && p.creator) m.creator = p.creator;
  }

  // 排序：曲目多的排前面（内容更全的歌单更有价值）
  const finalPlaylists = [...merged.values()]
    .sort((a, b) => b.trackCount - a.trackCount)
    .map((p, i) => ({ ...p, key: `pr${i}` }));

  const finalSongs = [];
  const seen = new Set();
  for (const p of finalPlaylists) {
    for (const t of p.tracks) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      finalSongs.push(t);
    }
  }

  const out = {
    updatedAt: new Date().toISOString(),
    totalPlayable: finalSongs.length,
    playlists: finalPlaylists,
    songs: finalSongs,
  };
  const file = path.join(DATA, 'praise.json');
  fs.writeFileSync(file, JSON.stringify(out), 'utf8');
  console.log(
    `  wrote data/praise.json (${(fs.statSync(file).size / 1024).toFixed(1)} KB) — ` +
      `${finalPlaylists.length} 个歌单 / ${finalSongs.length} 首可播`
  );

  // ---------- 5. 歌词 ----------
  console.log(`==> lyrics (${finalSongs.length} songs)`);
  const lyrics = {};
  let ok = 0;
  const lrcCacheFile = path.join(CACHE_DIR, 'lyrics.json');
  let lrcCache = {};
  try {
    const st = fs.statSync(lrcCacheFile);
    if (Date.now() - st.mtimeMs < 7 * 24 * 3600 * 1000) {
      lrcCache = JSON.parse(fs.readFileSync(lrcCacheFile, 'utf8'));
    }
  } catch {
    /* 无缓存 */
  }

  const lrcQueue = [];
  for (const s of finalSongs) {
    const cached = lrcCache[s.id];
    if (cached) {
      lyrics[s.id] = cached;
      ok++;
    } else {
      lrcQueue.push(s);
    }
  }
  console.log(`  cache hit: ${ok}, to fetch: ${lrcQueue.length}`);

  async function lrcWorker() {
    while (lrcQueue.length) {
      const s = lrcQueue.shift();
      try {
        const d = await api(
          `https://music.163.com/api/song/lyric?os=pc&id=${s.id}&lv=-1&kv=-1&tv=-1`,
          { timeout: 12000, retries: 2 }
        );
        const lrc = d.lrc?.lyric;
        const tlyric = d.tlyric?.lyric;
        if (lrc && lrc.trim()) {
          const parsed = { lrc: parseLrc(lrc), t: tlyric ? parseLrc(tlyric) : [] };
          lyrics[s.id] = parsed;
          lrcCache[s.id] = parsed;
          ok++;
        }
      } catch {
        /* 跳过 */
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, lrcWorker));
  try {
    fs.writeFileSync(lrcCacheFile, JSON.stringify(lrcCache), 'utf8');
  } catch {
    /* 忽略 */
  }
  fs.writeFileSync(path.join(DATA, 'praise-lyrics.json'), JSON.stringify(lyrics), 'utf8');
  console.log(`  lyrics: ${ok}/${finalSongs.length}`);
}

/** 解析 LRC 为 { t, text } 数组 */
function parseLrc(lrc) {
  const out = [];
  if (!lrc) return out;
  const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of lrc.split('\n')) {
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
    const text = line
      .replace(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g, '')
      .trim();
    for (const t of stamps) out.push({ t, text });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
