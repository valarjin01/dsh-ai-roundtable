#!/usr/bin/env node
/**
 * 用 GitHub API 发布插件（不需要本机 git）。
 *
 *   GITHUB_TOKEN=xxx node scripts/publish-github.mjs          # 真发布
 *   node scripts/publish-github.mjs --dry                     # 只看会传哪些文件
 *
 * 做的事：建仓库（已存在则复用）→ 上传全部文件 → 建一个 commit → 指向 main。
 * 仓库已有内容时，本次发布会用新历史覆盖 main（强制更新 ref）。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OWNER = 'valarjin01'
const REPO = 'dsh-ai-roundtable'
const BRANCH = 'main'
const TOKEN = process.env.GITHUB_TOKEN ?? ''
const DRY = process.argv.includes('--dry')

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.chrome'])
const SKIP_FILES = new Set(['.DS_Store'])
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.svg', '.html', '.css', '.txt', '.command', '.sh', '.py', ''])

const DESC =
  '多AI模型讨论_圆桌会议：几个 AI 就同一议题展开探讨，首轮互不可见，之后由中立调度员决定谁发言；只摊开角度与分歧，判断留给你。'
const HOMEPAGE = `https://github.com/${OWNER}/${REPO}`
const TOPICS = ['dsh', 'dsh-plugin', 'deepseek-harness', 'ai', 'multi-agent', 'roundtable', 'debate']

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name) || name.endsWith('.log')) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dsh-ai-roundtable-publisher',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    const msg = body?.message ?? text.slice(0, 300)
    const err = new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${msg}`)
    err.status = res.status
    throw err
  }
  return body
}

async function main() {
  const files = walk(ROOT)
  const total = files.reduce((n, f) => n + statSync(f).size, 0)

  console.log(`仓库：${OWNER}/${REPO}`)
  console.log(`文件：${files.length} 个，共 ${(total / 1024 / 1024).toFixed(2)} MB`)
  for (const f of files.slice(0, 12)) console.log('  ·', relative(ROOT, f))
  if (files.length > 12) console.log(`  … 还有 ${files.length - 12} 个`)

  if (DRY) {
    console.log('\n(--dry：未上传)')
    return
  }
  if (!TOKEN) {
    console.error('\n缺少 GITHUB_TOKEN。')
    process.exit(1)
  }

  // 1. 仓库
  let repo
  try {
    repo = await api(`/repos/${OWNER}/${REPO}`)
    console.log('仓库已存在，复用。')
  } catch (e) {
    if (e.status !== 404) throw e
    repo = await api('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: REPO,
        description: DESC,
        homepage: HOMEPAGE,
        private: false,
        has_issues: true,
        has_wiki: false,
        auto_init: false,
      }),
    })
    console.log('仓库已创建。')
  }

  // 1.5 空仓库不能用 Git Data API：先用 Contents API 造一个初始提交
  let parent = null
  try {
    const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`)
    parent = ref.object.sha
    console.log('已有 main 分支，基于它提交。')
  } catch {
    const init = await api(`/repos/${OWNER}/${REPO}/contents/.gitkeep`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'chore: initialise repository',
        content: Buffer.from('').toString('base64'),
      }),
    })
    parent = init.commit.sha
    console.log('空仓库，已创建初始提交。')
  }

  // 2. 上传 blob
  const tree = []
  for (const file of files) {
    const rel = relative(ROOT, file).split('\\').join('/')
    const buf = readFileSync(file)
    const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: buf.toString('base64'), encoding: 'base64' }),
    })
    const exec = rel.endsWith('.command') || rel.endsWith('.sh')
    tree.push({ path: rel, mode: exec ? '100755' : '100644', type: 'blob', sha: blob.sha })
    process.stdout.write(`\r上传中 ${tree.length}/${files.length}  ${rel.slice(0, 40).padEnd(40)}`)
  }
  console.log('\n文件已上传。')

  // 3. 树 + commit
  const treeRes = await api(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ tree }),
  })
  const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: 'feat: 多AI模型讨论_圆桌会议 v1.0.0', tree: treeRes.sha, parents: [parent] }),
  })

  // 4. 指向 main
  await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: true }),
  })

  // 5. 元信息
  await api(`/repos/${OWNER}/${REPO}`, {
    method: 'PATCH',
    body: JSON.stringify({ description: DESC, homepage: HOMEPAGE }),
  })
  await api(`/repos/${OWNER}/${REPO}/topics`, {
    method: 'PUT',
    headers: { Accept: 'application/vnd.github+json' },
    body: JSON.stringify({ names: TOPICS }),
  })

  console.log(`\n完成：${HOMEPAGE}`)
}

main().catch((e) => {
  console.error('\n发布失败：' + e.message)
  process.exit(1)
})
