#!/usr/bin/env node
/**
 * 圆桌配置台（独立版）
 *
 * 不依赖 DSH 的客户端插件系统：起一个只监听 127.0.0.1 的小服务，
 * 直接读写 ~/.dsh/roundtable.json。插件每次调用都会重读这个文件，
 * 所以这里点保存之后立刻生效，不需要重启任何东西。
 *
 *   node tools/settings-server.mjs          # 默认 8766，自动打开浏览器
 *   node tools/settings-server.mjs 8800     # 指定端口
 */
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { loadStore } from '../lib/store.js'
import { publicView, saveStore, mergeForm } from '../lib/store.js'

const PORT = Number(process.argv[2]) || 8766
const SEED = {
  moderator: 'DeepSeek',
  style: 'debate',
  maxRounds: 2,
  maxWordsPerTurn: 300,
  maxTokens: 800,
  temperature: 0.8,
  timeoutMs: 180000,
  participants: [
    { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', persona: '结构化拆解与收敛', thinking: 'auto', apiKey: '' },
    { name: '豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-1-pro-260915', persona: '中文语境与落地细节', thinking: 'off', apiKey: '' },
  ],
}

const PROFILE = join(homedir(), '.dsh/profiles/desktop')

/** 没有 store 时，从 profile 的 patch 里读种子配置，这样第一次打开就能看到真实的席位和 key 状态。 */
function seedFromPatch() {
  try {
    const req = createRequire(join(PROFILE, 'package.json'))
    const yaml = req('js-yaml')
    const file = join(PROFILE, 'cordis.patch.yml')
    if (!existsSync(file)) return null
    const doc = yaml.load(readFileSync(file, 'utf8'))
    const entry = Array.isArray(doc) ? doc.find((e) => e && e.id === 'dsh-ai-roundtable') : null
    return entry?.config ?? null
  } catch {
    return null
  }
}

function readRaw() {
  return loadStore() ?? seedFromPatch() ?? SEED
}

function send(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

async function readJson(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

async function probe(seat) {
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const res = await fetch(`${String(seat.baseUrl).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seat.apiKey}` },
      body: JSON.stringify({ model: seat.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 4 }),
      signal: ctrl.signal,
    })
    const ms = Date.now() - started
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, ms, error: `HTTP ${res.status} ${t.slice(0, 200)}` }
    }
    await res.json().catch(() => ({}))
    return { ok: true, ms }
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: e?.message ?? String(e) }
  } finally {
    clearTimeout(timer)
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  try {
    if (url.pathname === '/' || url.pathname === '/settings') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(PAGE)
    }
    if (url.pathname === '/api/config' && req.method === 'GET') {
      return send(res, 200, { config: publicView(readRaw()) })
    }
    if (url.pathname === '/api/config' && req.method === 'POST') {
      const body = await readJson(req)
      const next = mergeForm(readRaw(), body)
      saveStore(next)
      return send(res, 200, { config: publicView(next) })
    }
    if (url.pathname === '/api/test' && req.method === 'POST') {
      const body = await readJson(req)
      const stored = readRaw().participants?.[Number(body.index)]
      if (!stored) return send(res, 404, { error: '没有这个席位' })
      const seat = {
        ...stored,
        ...(body.apiKey ? { apiKey: String(body.apiKey) } : {}),
        ...(body.baseUrl ? { baseUrl: String(body.baseUrl) } : {}),
        ...(body.model ? { model: String(body.model) } : {}),
      }
      if (!seat.apiKey) return send(res, 400, { error: '这个席位还没有 key（输入后直接点测试即可）' })
      return send(res, 200, await probe(seat))
    }
    return send(res, 404, { error: 'not found' })
  } catch (e) {
    return send(res, 500, { error: e?.message ?? String(e) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`
  console.log(`圆桌配置台：${url}`)
  console.log('Ctrl+C 结束')
  if (!process.env.RT_NO_OPEN) execFile('open', [url], () => {})
})

const PAGE = readFileSync(new URL('./settings-page.html', import.meta.url), 'utf8')
