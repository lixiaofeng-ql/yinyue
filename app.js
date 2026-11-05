/* ============================================================
 *  音乐馆 —— 纯静态前端
 *  数据：本地 JSON（构建时抓取）
 *  播放：网易云 outer/url 跳转接口
 * ============================================================ */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const audio = $('audio');

  /* ---------------- 状态 ---------------- */
  const state = {
    charts: [],
    playlists: [],
    songs: [],
    singers: [],
    mvs: [],
    mvUrls: {},
    playback: {},
    lyrics: {},

    // 本地导入的音乐（data/local.json + media/）
    localSongs: [],
    localSrc: {},

    tab: 'recommend',
    stack: [], // 详情页栈

    queue: [],
    qIndex: -1,
    shuffleMode: false,

    searchIndex: null,
    theme: localStorage.getItem('yy-theme') || 'dark',
    liked: new Set(JSON.parse(localStorage.getItem('yy-liked') || '[]')),
    history: JSON.parse(localStorage.getItem('yy-history') || '[]'),
  };

  /* ---------------- 工具 ---------------- */
  /**
   * 时长格式化。数据源（网易云 API / 本地 ffprobe）的 duration 单位是**毫秒**，
   * 这里统一按毫秒处理；只有极小的值（< 1000）才视为已经是秒，防止个别来源用秒。
   */
  const fmtTime = (ms) => {
    if (!ms && ms !== 0) return '';
    const sec = ms < 1000 ? Math.round(ms) : Math.round(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };
  const fmtCount = (n) => {
    if (!n) return '';
    if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
    if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
    return String(n);
  };
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  function setTheme(t) {
    state.theme = t;
    document.documentElement.dataset.theme = t;
    localStorage.setItem('yy-theme', t);
    $('btn-theme').textContent = t === 'dark' ? '◐' : '☀';
  }

  /* ---------------- 播放 ---------------- */
  /**
   * 播放地址解析顺序：
   *  1. 本地导入的歌曲 —— 站点内相对路径（data/local.json 的 src）
   *  2. 运行时 outer/url 跳转 —— 首选
   *
   * 说明：网易云 CDN 直链（构建时解析并存在 data/playback.json 里）
   * 路径里带时间戳，**有效期很短**，过期后返回 403，
   * 所以这里不再直接用缓存的直链，统一走 outer/url 实时拿新地址。
   */
  function songUrl(s) {
    if (s.local && s.src) return s.src;
    const id = typeof s === 'object' ? s.id : s;
    return `https://music.163.com/song/media/outer/url?id=${id}`;
  }

  /** 歌曲封面（本地歌没有封面时给占位图） */
  const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">' +
      '<rect width="120" height="120" fill="%2326262e"/>' +
      '<text x="60" y="72" font-size="46" fill="%236a6a74" text-anchor="middle">♪</text></svg>'
  );

  function coverOf(s) {
    return s.pic || PLACEHOLDER;
  }

  function playQueue(list, startIndex) {
    if (!list.length) return;
    state.queue = list;
    state.qIndex = startIndex;
    loadCurrent();
  }
  function loadCurrent() {
    const s = state.queue[state.qIndex];
    if (!s) return;
    audio.src = songUrl(s);
    audio.play().catch(() => {
      /* 自动播放被拦截，等用户交互 */
    });
    updatePlayerBar();
    markPlayingRow();
    saveHistory(s);
  }

  function togglePlay() {
    if (state.qIndex < 0) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function nextSong(auto = false) {
    if (!state.queue.length) return;
    if (auto && state.shuffleMode) {
      // 随机模式下避免连续重复同一首
      if (state.queue.length > 1) {
        let n;
        do {
          n = Math.floor(Math.random() * state.queue.length);
        } while (n === state.qIndex);
        state.qIndex = n;
      }
    } else {
      state.qIndex = (state.qIndex + 1) % state.queue.length;
    }
    loadCurrent();
  }

  function prevSong() {
    if (!state.queue.length) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    state.qIndex = (state.qIndex - 1 + state.queue.length) % state.queue.length;
    loadCurrent();
  }

  function saveHistory(s) {
    state.history = [s.id, ...state.history.filter((id) => id !== s.id)].slice(0, 100);
    localStorage.setItem('yy-history', JSON.stringify(state.history));
  }

  function updatePlayerBar() {
    const s = state.queue[state.qIndex];
    if (!s) {
      $('player-bar').hidden = true;
      return;
    }
    $('player-bar').hidden = false;
    $('pb-cover').src = coverOf(s);
    $('pb-name').textContent = s.name;
    $('pb-artist').textContent = (s.artists || []).join(' / ');
  }

  function markPlayingRow() {
    const cur = state.queue[state.qIndex];
    document.querySelectorAll('.song').forEach((el) => {
      el.classList.toggle('playing', !!cur && String(el.dataset.id) === String(cur.id));
    });
  }

  audio.addEventListener('play', () => {
    $('pb-play').textContent = '⏸';
    markPlayingRow();
  });
  audio.addEventListener('pause', () => {
    $('pb-play').textContent = '▶';
    markPlayingRow();
  });
  audio.addEventListener('error', () => {
    $('pb-play').textContent = '▶';
  });
  audio.addEventListener('ended', () => nextSong(true));
  audio.addEventListener('timeupdate', () => {
    if (state.lyricTimer) updateLyricHighlight();
  });

  /* ---------------- 歌词 ---------------- */
  let lyricTimer = null;
  let currentLyricLines = [];

  function openLyric() {
    const s = state.queue[state.qIndex];
    if (!s) return;
    // 本地歌曲的歌词直接内嵌在条目里；在线歌曲从 lyrics.json 取
    const data = s.local
      ? { lrc: s.lrc || [] }
      : state.lyrics[s.id];
    const body = $('lyric-body');
    $('lyric-title').textContent = `${s.name} — ${(s.artists || []).join(' / ')}`;
    if (!data || !data.lrc || !data.lrc.length) {
      body.innerHTML = '<p class="empty">暂无歌词</p>';
    } else {
      currentLyricLines = data.lrc;
      body.innerHTML = data.lrc
        .map((l) => `<p class="lyric-line" data-t="${l.t}">${esc(l.text) || '&nbsp;'}</p>`)
        .join('');
      if (data.t && data.t.length) {
        body.insertAdjacentHTML(
          'beforeend',
          '<div class="section-head" style="margin-top:18px"><h2>翻译</h2></div>' +
            data.t
              .map((l) => `<p class="lyric-line meta" data-t="${l.t}">${esc(l.text) || '&nbsp;'}</p>`)
              .join('')
        );
      }
    }
    $('lyric-panel').hidden = false;
    startLyricSync();
  }

  function closeLyric() {
    $('lyric-panel').hidden = true;
    stopLyricSync();
  }

  function startLyricSync() {
    stopLyricSync();
    if (!currentLyricLines.length) return;
    const tick = () => {
      updateLyricHighlight();
      lyricTimer = setTimeout(tick, 300);
    };
    lyricTimer = setTimeout(tick, 300);
  }

  function stopLyricSync() {
    if (lyricTimer) clearTimeout(lyricTimer);
    lyricTimer = null;
  }

  function updateLyricHighlight() {
    const t = audio.currentTime;
    const lines = document.querySelectorAll('#lyric-body .lyric-line');
    if (!lines.length) return;
    let activeIdx = -1;
    for (let i = 0; i < currentLyricLines.length; i++) {
      if (currentLyricLines[i].t <= t + 0.15) activeIdx = i;
      else break;
    }
    lines.forEach((el) => el.classList.remove('active'));
    if (activeIdx < 0) return;
    const target = lines[activeIdx];
    if (target) {
      target.classList.add('active');
      const panel = $('lyric-panel');
      const panelTop = panel.getBoundingClientRect().top;
      const r = target.getBoundingClientRect();
      if (r.top < panelTop + 40 || r.bottom > window.innerHeight - 40) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }

  /* ---------------- 渲染 ---------------- */
  function songRow(s, i, opts = {}) {
    const dur = fmtTime(s.duration);
    const liked = state.liked.has(s.id);
    return `
      <div class="song" data-id="${s.id}" data-idx="${i}">
        <span class="idx ${opts.rank && i < 3 ? 'top3' : ''}">${opts.rank ? i + 1 : ''}</span>
        <img class="cover" src="${esc(coverOf(s))}" alt="" loading="lazy" />
        <div class="meta">
          <strong>${esc(s.name)}</strong>
          <small>${esc((s.artists || []).join(' / '))}${s.album ? ' · ' + esc(s.album) : ''}</small>
        </div>
        <span class="eq"><i></i><i></i><i></i></span>
        <span class="dur">${dur}${liked ? ' ♥' : ''}</span>
      </div>`;
  }

  function card(item, kind) {
    if (kind === 'singer') {
      return `
        <div class="card card-singer" data-singer="${item.id}">
          <div class="card-cover"><img src="${esc(item.pic)}" alt="" loading="lazy" /></div>
          <h3>${esc(item.name)}</h3>
        </div>`;
    }
    if (kind === 'mv') {
      return `
        <div class="card" data-mv="${item.id}">
          <div class="card-cover">
            <img src="${esc(item.cover)}" alt="" loading="lazy" />
            <span class="play-badge">▶</span>
          </div>
          <h3>${esc(item.name)}</h3>
          <p>${esc((item.artists || []).join(' / '))}</p>
        </div>`;
    }
    return `
      <div class="card" data-list="${item.key}">
        <div class="card-cover">
          <img src="${esc(item.cover)}" alt="" loading="lazy" />
          <span class="play-badge">▶</span>
        </div>
        <h3>${esc(item.name)}</h3>
        <p>${item.trackCount ? item.trackCount + ' 首' : ''}</p>
      </div>`;
  }

  function renderRecommend() {
    const hot = state.charts.find((c) => c.key === 'hot') || state.charts[0];
    const hero = $('hero');
    if (hot) {
      hero.querySelector('.hero-bg').style.backgroundImage = `url("${hot.cover}")`;
      $('hero-title').textContent = hot.name;
      $('hero-desc').textContent = `${hot.trackCount} 首 · ${fmtCount(hot.playCount)} 次播放`;
    }
    $('rec-playlists').innerHTML = state.playlists
      .slice(0, 12)
      .map((p) => card(p, 'list'))
      .join('');
    const songs = state.songs.slice(0, 20);
    $('rec-songs').innerHTML = songs.map((s, i) => songRow(s, i)).join('');
  }

  function renderCharts() {
    $('charts-grid').innerHTML = state.charts.map((c) => card(c, 'list')).join('');
  }

  function renderPlaylists() {
    $('playlists-grid').innerHTML = state.playlists.map((p) => card(p, 'list')).join('');
  }

  function renderSingers() {
    $('singer-grid').innerHTML = state.singers.map((s) => card(s, 'singer')).join('');
  }

  function renderMVs() {
    $('mv-grid').innerHTML = state.mvs.map((m) => card(m, 'mv')).join('');
  }

  function renderLocal() {
    const list = state.localSongs || [];
    $('local-count').textContent = `${list.length} 首`;
    $('local-songs').innerHTML = list.length
      ? list.map((s, i) => songRow(s, i, { rank: true })).join('')
      : '<p class="empty">还没有导入本地音乐。<br/>运行 <code>node scripts/add-local.mjs "你的音乐文件夹" --convert</code> 后提交即可。</p>';
  }

  /* ---------------- 页面切换 ---------------- */
  function showPage(id, push = true) {
    document.querySelectorAll('.page').forEach((p) => (p.hidden = true));
    const page = $(`page-${id}`);
    if (page) page.hidden = false;
    if (push) state.stack.push(id);
    $('btn-back').classList.toggle('show', state.stack.length > 1);
    document.querySelectorAll('.tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.tab === id)
    );
    window.scrollTo({ top: 0 });
  }

  function goBack() {
    if (state.stack.length <= 1) return;
    state.stack.pop();
    const prev = state.stack[state.stack.length - 1];
    state.stack.pop();
    showPage(prev, false);
    $('btn-back').classList.toggle('show', state.stack.length > 1);
  }

  /* ---------------- 详情页 ---------------- */
  function openList(list) {
    if (!list) return;
    $('detail-cover').src = list.cover || '';
    $('detail-name').textContent = list.name;
    $('detail-desc').textContent =
      [list.trackCount ? `${list.trackCount} 首` : '', list.creator || '']
        .filter(Boolean)
        .join(' · ');
    $('detail-songs').innerHTML = list.tracks
      .map((s, i) => songRow(s, i, { rank: true }))
      .join('');
    $('detail-songs').dataset.listKey = list.key;
    showPage('detail');
  }

  function openArtist(singer) {
    const songs = singer.songIds
      .map((id) => state.songs.find((s) => s.id === id))
      .filter(Boolean);
    state.singerSongIds = songs.map((s) => s.id);
    $('artist-head').innerHTML = `
      <img src="${esc(singer.pic)}" alt="" />
      <h2>${esc(singer.name)}</h2>
      <p>${songs.length} 首热门歌曲</p>`;
    $('artist-songs').innerHTML = songs.map((s, i) => songRow(s, i)).join('');
    showPage('artist');
  }

  /* ---------------- 搜索 ---------------- */
  function buildSearchIndex() {
    const idx = [];
    for (const s of state.songs) {
      idx.push({
        id: s.id,
        name: s.name,
        artists: s.artists,
        album: s.album,
        pic: s.pic,
        duration: s.duration,
        text: `${s.name} ${(s.artists || []).join(' ')} ${s.album}`.toLowerCase(),
      });
    }
    // 本地导入的歌也参与搜索
    for (const s of state.localSongs || []) {
      idx.push({
        id: s.id,
        name: s.name,
        artists: s.artists,
        album: s.album,
        pic: s.pic,
        duration: s.duration,
        local: true,
        src: s.src,
        lrc: s.lrc,
        text: `${s.name} ${(s.artists || []).join(' ')} ${s.album}`.toLowerCase(),
      });
    }
    state.searchIndex = idx;
  }

  function doSearch(q) {
    const query = q.trim().toLowerCase();
    if (!query) {
      $('search-title').textContent = '搜索结果';
      $('search-songs').innerHTML = '<p class="empty">输入歌名、歌手或专辑</p>';
      showPage('search');
      return;
    }
    const hits = (state.searchIndex || [])
      .filter((s) => s.text.includes(query))
      .slice(0, 100);
    $('search-title').textContent = `“${q}” — ${hits.length} 个结果`;
    $('search-songs').innerHTML = hits.length
      ? hits.map((s, i) => songRow(s, i)).join('')
      : '<p class="empty">没有找到相关歌曲</p>';
    showPage('search');
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    // 标签
    $('tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      state.stack = [];
      showPage(tab.dataset.tab);
    });

    $('btn-back').addEventListener('click', goBack);

    $('btn-theme').addEventListener('click', () => {
      setTheme(state.theme === 'dark' ? 'light' : 'dark');
    });

    // 搜索
    $('btn-search').addEventListener('click', () => doSearch($('search-input').value));
    $('search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch(e.target.value);
    });

    // "全部 ›"
    document.addEventListener('click', (e) => {
      const more = e.target.closest('[data-goto]');
      if (more) {
        state.stack = [];
        showPage(more.dataset.goto);
      }
    });

    // 列表卡片
    document.addEventListener('click', (e) => {
      const c = e.target.closest('[data-list]');
      if (c) {
        const key = c.dataset.list;
        const list =
          state.charts.find((x) => x.key === key) ||
          state.playlists.find((x) => x.key === key);
        openList(list);
      }
    });

    // 歌手
    document.addEventListener('click', (e) => {
      const c = e.target.closest('[data-singer]');
      if (c) {
        const s = state.singers.find((x) => String(x.id) === c.dataset.singer);
        if (s) openArtist(s);
      }
    });

    // MV
    document.addEventListener('click', (e) => {
      const c = e.target.closest('[data-mv]');
      if (c) {
        const m = state.mvs.find((x) => String(x.id) === c.dataset.mv);
        if (m) openMV(m);
      }
    });

    // 歌曲行
    document.addEventListener('click', (e) => {
      const row = e.target.closest('.song');
      if (!row) return;
      // id 可能是数字（网易云）或字符串（本地导入的 local-xxxx），统一按字符串比较
      const id = row.dataset.id;
      const container = row.closest('.song-list');
      let list = null;
      if (container.id === 'detail-songs') {
        const key = container.dataset.listKey;
        const src =
          state.charts.find((x) => x.key === key) ||
          state.playlists.find((x) => x.key === key);
        list = src ? src.tracks : null;
      } else if (container.id === 'artist-songs') {
        list = state.songs.filter((s) => state.singerSongIds.includes(s.id));
      } else if (container.id === 'local-songs') {
        list = state.localSongs;
      } else if (container.id === 'search-songs') {
        // 搜索结果混合了在线歌和本地歌，直接用搜索索引作为队列
        list = state.searchIndex || [];
      } else {
        list = state.songs;
      }
      const idx = list.findIndex((s) => String(s.id) === id);
      if (idx >= 0) playQueue(list, idx);
    });

    // 播放全部 / 随机
    $('btn-play-all').addEventListener('click', () => {
      const list = currentDetailTracks();
      if (list.length) playQueue(list, 0);
    });
    $('btn-random').addEventListener('click', () => {
      const list = currentDetailTracks().slice();
      if (!list.length) return;
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      state.shuffleMode = true;
      playQueue(list, 0);
    });

    // 我的音乐：播放全部 / 随机播放
    $('local-play-all').addEventListener('click', () => {
      if (state.localSongs.length) playQueue(state.localSongs, 0);
    });
    $('local-random').addEventListener('click', () => {
      const list = state.localSongs.slice();
      if (!list.length) return;
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      state.shuffleMode = true;
      playQueue(list, 0);
    });

    // 播放条
    $('pb-play').addEventListener('click', togglePlay);
    $('pb-next').addEventListener('click', () => nextSong());
    $('pb-lyric').addEventListener('click', openLyric);
    $('lyric-close').addEventListener('click', closeLyric);
    // 点击歌词面板的遮罩空白处也能关闭
    $('lyric-panel').addEventListener('click', (e) => {
      if (e.target === $('lyric-panel')) closeLyric();
    });

    // 安装条
    $('install-close').addEventListener('click', () => {
      $('install-bar').hidden = true;
    });
  }

  function currentDetailTracks() {
    const key = $('detail-songs').dataset.listKey;
    const src =
      state.charts.find((x) => x.key === key) ||
      state.playlists.find((x) => x.key === key);
    return src ? src.tracks : [];
  }

  /* ---------------- MV 播放 ---------------- */
  function openMV(m) {
    $('mv-title').textContent = m.name;
    $('mv-desc').textContent = `${(m.artists || []).join(' / ')} · ${fmtCount(m.playCount)} 次播放`;
    const v = $('mv-video');
    // 优先用构建时抓到的直链（有时效），否则退回歌曲源
    const direct = (state.mvUrls && state.mvUrls[m.id]) || '';
    v.src = direct || `https://music.163.com/song/media/outer/url?id=${m.id}&type=mp4`;
    showPage('mv-detail');
  }

  /* ---------------- PWA 安装 ---------------- */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('install-bar').hidden = false;
  });
  $('btn-install').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('install-bar').hidden = true;
  });

  /* ---------------- 数据加载 ---------------- */
  async function loadJSON(name) {
    const r = await fetch(`data/${name}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return r.json();
  }

  async function init() {
    setTheme(state.theme);
    bind();

    const results = await Promise.allSettled([
      loadJSON('charts'),
      loadJSON('playlists'),
      loadJSON('songs'),
      loadJSON('singers'),
      loadJSON('mvs'),
      loadJSON('lyrics'),
      loadJSON('playback'),
      loadJSON('local'),
    ]);
    const val = (i, fb) =>
      results[i].status === 'fulfilled' ? results[i].value : fb;
    const charts = val(0, { charts: [] });
    const playlists = val(1, { playlists: [] });
    const songs = val(2, { songs: [] });
    const singers = val(3, { singers: [] });
    const mvs = val(4, { mvs: [] });
    const lyrics = val(5, {});
    const playback = val(6, {});
    const local = val(7, { songs: [] });

    state.charts = charts.charts || [];
    state.playlists = playlists.playlists || [];
    state.songs = songs.songs || [];
    state.singers = singers.singers || [];
    state.mvs = mvs.mvs || [];
    state.mvUrls = mvs.urls || {};
    state.lyrics = lyrics || {};
    state.playback = playback || {};
    state.localSongs = local.songs || [];
    buildSearchIndex();

    if (!state.songs.length && !state.charts.length && !state.localSongs.length) {
      document.querySelectorAll('.page').forEach((p) => (p.hidden = true));
      $('content').innerHTML =
        '<p class="empty">还没有数据。请先运行 <code>npm run fetch</code> 生成 data/*.json。</p>';
      return;
    }

    renderRecommend();
    renderCharts();
    renderPlaylists();
    renderSingers();
    renderMVs();
    renderLocal();
    showPage('recommend', false);
    $('btn-back').classList.remove('show');

    // 注册 Service Worker
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }  }

  init();
})();
