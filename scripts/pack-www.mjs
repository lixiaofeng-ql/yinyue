/**
 * 把站点打包进 www/ 目录（GitHub Pages 部署产物）。
 * 先打包到临时目录，再替换，避免旧目录被占用导致失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, 'www');
const TMP = path.join(ROOT, '.www-tmp');

function copy(srcRel, destRel = srcRel) {
  const from = path.join(ROOT, srcRel);
  const to = path.join(TMP, destRel);
  if (!fs.existsSync(from)) {
    console.warn(`  skip (missing): ${srcRel}`);
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

for (const file of [
  'index.html',
  'styles.css',
  'app.js',
  'sw.js',
  'manifest.webmanifest',
]) {
  copy(file);
}

copy('icons');
copy('data');
// 本地导入的音乐文件（可选，目录不存在时跳过）
copy('media');

let total = 0;
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else total += fs.statSync(p).size;
  }
};
walk(TMP);

// 替换目标目录（被占用时重试）
function rmWithRetry(target, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
      return true;
    } catch (err) {
      if (i === attempts - 1) throw err;
      // 同步等待再试
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  return false;
}

rmWithRetry(DEST);
fs.renameSync(TMP, DEST);

console.log(`packed ${DEST}  (${(total / 1024 / 1024).toFixed(2)} MB)`);
