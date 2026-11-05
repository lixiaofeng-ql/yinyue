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
- **深色 / 浅色主题**：日间夜���切换，记忆到 localStorage
- **PWA**：可安装到手机主屏幕，像原生 App 一样全屏运行；Service Worker 缓存静态资源，离线可用

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
│   └── playback.json       歌曲 -> HTTPS CDN 直链
├── scripts/
│   ├── fetch-data.mjs      抓取全部数据
│   ├── make-icons.mjs      生成 PWA 图标（手写 PNG，无依赖）
│   └── pack-www.mjs        打包到 www/
└── .github/workflows/
    └── deploy-pages.yml    自动部署到 Pages
```

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
- 约 40% 的歌曲是 VIP 曲目，构建时解析不到直链，运行时自动回退到 `outer/url` 跳转接口；这类歌曲可能提示需要会员
- 歌词为 LRC 格式，已解析为 `{时间, 文本}` 数组供前端做滚动高亮

## 免责声明

本项目仅供学习与技术演示使用。曲库内容、封面、歌词的版权归网易云音乐及相应权利人所有；播放链接指向网易云官方 CDN，不存储、不转存任何音频文件。请勿用于商业用途。
