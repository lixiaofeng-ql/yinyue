# 音乐馆

一个纯静态的音乐播放器 PWA，界面参考 [QQ音乐](https://y.qq.com/) 的信息架构：推荐 / 排行榜 / 歌单 / 歌手 / MV 五个板块，带在线播放、滚动歌词和移动端全屏体验。

**线上地址：https://lixiaofeng-ql.github.io/yinyue/**

---

## 功能

- **五个标签页**：推荐（今日榜单 + 推荐歌单 + 热门歌曲）、排行榜（11 个榜）、歌单（39 个精选歌单）、歌手（48 位热门歌手）、MV（30 支）
- **在线播放**：点击任意歌曲直接播放，走网易云 CDN 直链，HTTPS 无混合内容问题
- **滚动歌词**：350+ 首歌曲带逐字时间轴歌词，高亮跟随播放进度自动滚动，附翻译字幕
- **本地搜索**：1000+ 首歌曲的离线索引，搜歌名 / 歌手 / 专辑，瞬时出结果，无需联网
- **随机播放**：每个歌单一键随机 shuffle
- **MV 播放**：内置 MV 播放器，构建时抓取真实视频直链
- **深色 / 浅色主题**：日间夜间切换，记忆到 localStorage
- **PWA**：可安装到手机主屏幕，像原生 App 一样全屏运行；Service Worker 缓存静态资源，离线可用
- **上传本地音乐**：一键把自己的歌单导入仓库并部署上线，见下方「导入本地音乐」

## 技术栈

零运行时依赖，纯原生：

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | 原生 HTML / CSS / JS | 无框架，无构建工具链，git clone 即可跑 |
| 数据 | 构建时抓取 → 静态 JSON | `scripts/fetch-data.mjs` |
| 播放 | 网易云 CDN 直链 | 构建时解析 `outer/url` 的 302 目标 |
| 部署 | GitHub Actions → GitHub Pages | 推 `main` 自动发布 |
| 打包 | Capacitor（可选） | 可生成安卓 APK |

## 目录结构

```
yinyue/
├── index.html              页面骨架
├── styles.css              样式（深/浅主题变量）
├── app.js                  全部前端逻辑
├── sw.js                   Service Worker（离线缓存）
├── manifest.webmanifest    PWA 清单
├── icons/                  应用图标（脚本生成）
├── data/                   构建产物：静态 JSON
│   ├── charts.json         11 个排行榜
│   ├── playlists.json      39 个精选歌单
│   ├── songs.json          歌曲总索引（搜索用）
│   ├── singers.json        歌手 + 其热门歌曲
│   ├── mvs.json            MV 列表 + 视频直链
│   ├── lyrics.json         LRC 时间轴歌词
│   ├── playback.json       歌曲 -> HTTPS CDN 直链
│   └── local.json          本地导入的音乐清单（手动生成，CI 不会覆盖）
├── media/                  本地导入的音乐文件（手动生成）
│   ├── *.mp3               音频文件
│   └── covers/             封面图
├── scripts/
│   ├── fetch-data.mjs      抓取全部数据
│   ├── add-local.mjs       导入本地音乐（新增）
│   ├── make-icons.mjs      生成 PWA 图标（手写 PNG，无依赖）
│   └── pack-www.mjs        打包到 www/
└── .github/workflows/
    └── deploy-pages.yml    自动部署到 Pages
```

## 导入本地音乐

把你电脑上的歌曲上传到这个项目，部署后手机就能直接播放。

### 前置条件

- **ffmpeg**（必需，用于读取标签、时长、转码）：<https://ffmpeg.org/download.html>
  下载后把 `bin` 目录加进系统 `PATH`，验证：

  ```bash
  ffmpeg -version
  ```

### 一条命令导入

```bash
npm run add:local -- "D:\我的音乐" --convert
```

脚本会：

1. 递归扫描文件夹里所有音频（`.mp3` `.flac` `.m4a` `.wav` `.ogg` …）
2. 用 ffprobe 读取歌名 / 歌手 / 专辑 / 时长
3. 用 ffmpeg **统一转码为 192kbps mp3**（浏览器兼容最好、体积最小）
4. 同目录的 `cover.jpg` / `folder.jpg` / `同名.jpg` 自动识别为封面
5. 同名 `.lrc` 文件自动解析为滚动歌词
6. 生成 `media/`（音频 + 封面）和 `data/local.json`（清单）

### 选项

| 选项 | 作用 |
|---|---|
| `--convert` | 转码为 mp3 192k（**推荐**，兼容性最好） |
| `--bitrate 320` | 指定转码码率（配合 `--convert`） |
| `--prune` | 删除清单里已不存在的音乐文件和封面 |
| `--no-lyrics` | 忽略同名 `.lrc` 歌词 |
| 不加 `--convert` | 原样复制，保留 FLAC 等原始格式（浏览器不一定能播） |

### 目录结构建议

```
我的音乐/
├── 华语/
│   ├── cover.jpg          ← 整张专辑的封面（可选）
│   ├── 晴天.mp3
│   ├── 晴天.lrc          ← 同名歌词（可选）
│   └── 稻香.mp3
└── 纯音乐/
    └── ...
```

### 提交并部署

```bash
git add media data/local.json
git commit -m "feat: 导入本地音乐"
git push
```

push 后 GitHub Actions 会自动重新构建并发布，约 1-2 分钟后线上就能听到你的歌。
在 App 里切到 **「我的音乐」** 标签页即可播放，也能通过顶部搜索框搜到。

### 重要限制

| 限制 | 说明 |
|---|---|
| **单文件 ≤ 100 MB** | GitHub 硬限制。单曲超过 100MB 请用 `--convert` 压缩（192kbps 下 4 分钟约 6MB） |
| **仓库体积** | GitHub 建议仓库 ≤ 1GB。几百首 192kbps 的歌约 300-600MB，属于可接受范围 |
| **不能用 Git LFS** | Pages 不支持 LFS，LFS 文件在页面上只会返回指针文本 |
| **CI 不会覆盖本地歌** | 本地歌存放在 `data/local.json`（独立文件），`npm run fetch` 只重写 `charts/playlists/songs/singers/mvs/lyrics/playback`，不会动你的歌 |
| **首次加载要下载音频** | 音频不进 Service Worker 缓存（文件大，会撑爆缓存配额），每次播放走网络，手机上建议用 Wi-Fi |

### 批量更新

重复运行 `npm run add:local` 即可增量更新：

- 音频没变的 → 直接复用已转码的文件，不重复转码（快）
- 音频变了 → 重新转码
- 只改了歌词 / 封面 → 只更新清单，音频复用
- 加了 `--prune` → 清掉已删除歌曲的文件

---

## 本地运行

```bash
npm install          # 只有 Capacitor 相关，可跳过
npm run fetch        # 抓数据，生成 data/*.json（首次必须）
npm run build        # 生成图标 + 打包到 www/
npm run serve        # http://localhost:8080
```

或直接用任意静态服务器（**不要双击 `index.html`**，浏览器会拦截本地 JSON 请求）：

```bash
python -m http.server 8080 --bind 0.0.0.0
```

手机连同一 Wi-Fi，访问 `http://电脑局域网IP:8080`。

## 部署

### GitHub Pages（已启用）

仓库内置 `.github/workflows/deploy-pages.yml`，推到 `main` 即自动抓数据、构建、发布：

```bash
git add -A
git commit -m "更新内容"
git push
```

访问 https://lixiaofeng-ql.github.io/yinyue/

Pages 设置：Settings → Pages → Source = GitHub Actions。

> 每次推送都会重新抓取榜单数据，所以线上的排行榜始终是最新���。
> 如果接口临时抽风，`npm run fetch` 那一步带 `continue-on-error`，构建会用仓库里已提交的 `data/*.json` 继续，不会整个挂掉。

### Netlify Drop（最快，零配置）

把本地 `www/` 文件夹整个拖进 <https://app.netlify.com/drop>，立刻得到网址。

### 安卓 APK

```bash
npm install @capacitor/cli @capacitor/core @capacitor/android
npx cap init 音乐馆 com.example.yinyue --web-dir=www
npm run pack:www && npx cap sync android
cd android && gradlew.bat assembleDebug
```

产物在 `android/app/build/outputs/apk/debug/`。

### iOS

无法在 Windows 上打出 `.ipa`。用 **Safari** 打开线上地址 → 分享 → **添加到主屏幕**。

## 手机端使用

1. 用手机浏览器打开 https://lixiaofeng-ql.github.io/yinyue/
2. **安卓（Chrome）**：地址栏出现「安装」图标，或菜单 →「安装应用 / 添加到主屏幕」
3. **苹果（必须用 Safari）**：底部分享按钮 →「添加到主屏幕」
4. 装好后从主屏幕图标打开，全屏运行

## 数据来源与说明

- 榜单 / 歌单 / 歌手 / 歌词 / MV 来自网易云音乐公开接口
- 播放地址由构建时请求 `music.163.com/song/media/outer/url` 跟随 302 得到 CDN 直链，并统一改写为 `https://`，同时去掉时效性 query 参数（实测 CDN 路径不带 token 也能正常播放）
- **约 40% 的歌曲是 VIP 曲目**，运行时自动回退到 `outer/url` 跳转接口；这类歌曲可能提示需要会员
- **「VIP」标记**：网易云 `fee=1`（VIP）和 `fee=4`（买断）的曲目在列表里带橙色 VIP 标签，搜索页右上角可切「只看可播」一键过滤
- 实测可播率约 **41%**（4356 首中约 1770 首可播），其余为会员专享或无版权
- 播放失败会自动跳过下一首，并弹出提示，不会静默卡住
- 歌词为 LRC 格式，已解析为 `{时间, 文本}` 数组供前端做滚动高亮

> 想知道某个时段真实可播率，跑 `node scripts/probe-playable.mjs 15` 抽样实测。

## 免责声明

本项目仅供学习与技术演示使用。曲库内容、封面、歌词的版权归网易云音乐及相应权利人所有；播放链接指向网易云官方 CDN，不存储、不转存任何音频文件。请勿用于商业用途。
