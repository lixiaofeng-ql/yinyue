/**
 * 通过 GitHub Git Data API 推送本地提交。
 * 用途：当 github.com:443 直连不通（网络抖动）时，用可达的 api.github.com 完成推送。
 *
 * 用法：node scripts/push-via-api.mjs <localBranch>
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OWNER = 'lixiaofeng-ql';
const REPO = 'yinyue';
const BRANCH = process.argv[2] || 'main';

const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

function git(...args) {
  return execSync(`git ${args.join(' ')}`, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 256,
  }).trim();
}

/** 从 git credential 取 token */
function getToken() {
  const out = execSync('git credential fill', {
    encoding: 'utf8',
    input: 'protocol=https\nhost=github.com\n\n',
  });
  const line = out.split('\n').find((l) => l.startsWith('password='));
  return line ? line.slice('password='.length).trim() : '';
}

const token = getToken();
if (!token) {
  console.error('没有找到 GitHub 凭据');
  process.exit(1);
}

const H = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'User-Agent': 'yinyue-push-via-api',
};

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${url} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`${method} ${url} -> HTTP ${res.status}: ${json.message || text.slice(0, 200)}`);
  }
  return json;
}

/** 把一个 blob 上传，返回 git blob sha */
async function uploadBlob(content) {
  const res = await fetch(`${API}/git/blobs`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ content, encoding: 'utf-8' }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`blob -> ${json.message}`);
  return json.sha;
}

/** 建一个 tree（基于 base tree） */
async function createTree(baseTree, entries) {
  return api('POST', `${API}/git/trees`, {
    base_tree: baseTree,
    tree: entries.map((e) => ({
      path: e.path,
      mode: '100644',
      type: 'blob',
      sha: e.sha,
    })),
  });
}

async function main() {
  const remoteRef = await api('GET', `${API}/git/ref/heads/${BRANCH}`);
  const baseSha = remoteRef.object.sha;
  const baseCommit = await api('GET', `${API}/git/commits/${baseSha}`);
  const baseTree = baseCommit.tree.sha;

  console.log(`远端 ${BRANCH} = ${baseSha.slice(0, 7)}`);

  // 收集本地相对远端的提交
  const localHead = git('rev-parse', 'HEAD');
  const behind = git('rev-list', `${baseSha}..${localHead}`).split('\n').filter(Boolean);
  if (!behind.length) {
    console.log('本地没有待推送的提交');
    return;
  }
  console.log(`待推送 ${behind.length} 个提交: ${behind.map((s) => s.slice(0, 7)).join(', ')}`);

  // 收集所有改动文件（相对远端基线的最终状态）
  const files = git('diff', '--name-only', baseSha, localHead).split('\n').filter(Boolean);
  console.log(`变更文件 ${files.length} 个`);

  const entries = [];
  for (const f of files) {
    const content = fs.readFileSync(f, 'utf8');
    const sha = await uploadBlob(content);
    entries.push({ path: f, sha });
    console.log(`  blob ${f}`);
  }

  const tree = await createTree(baseTree, entries);
  console.log(`tree = ${tree.sha.slice(0, 7)}`);

  // 用本地 HEAD 的提交信息建 commit
  const msg = git('log', '-1', '--format=%B', localHead).trim();
  const commit = await api('POST', `${API}/git/commits`, {
    message: msg || 'update',
    tree: tree.sha,
    parents: [baseSha],
  });
  console.log(`commit = ${commit.sha.slice(0, 7)}`);

  await api('PATCH', `${API}/git/refs/heads/${BRANCH}`, {
    sha: commit.sha,
    force: false,
  });
  console.log(`✓ 已推送到 ${BRANCH}（新 sha ${commit.sha.slice(0, 7)}）`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
