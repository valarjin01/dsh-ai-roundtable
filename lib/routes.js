/**
 * 设置页的后端：两个端点，一个前缀。
 *
 *   GET  /dsh-roundtable/config  → 当前配置（key 只给掩码）
 *   POST /dsh-roundtable/config  → 保存（留空的 key 表示不修改）
 *   POST /dsh-roundtable/test    → 用已存的 key 试连一次，返回耗时
 *
 * 同源、无 CORS、不出本机。
 */
import { publicView, saveStore, mergeForm, withDefaults, STORE_PATH } from './store.js'
import { requestUrl, isAnthropic } from './core.js'

export { STORE_PATH }

function send(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

/** 试连：只要一个 token 的输出，失败也把原始错误带回去。 */
async function probe(seat) {
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20000)
  try {
    const claude = isAnthropic(seat)
    const res = await fetch(requestUrl(seat), {
      method: 'POST',
      headers: claude
        ? { 'Content-Type': 'application/json', 'x-api-key': seat.apiKey, 'anthropic-version': '2023-06-01' }
        : { 'Content-Type': 'application/json', Authorization: `Bearer ${seat.apiKey}` },
      body: JSON.stringify({
        model: seat.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 4,
        ...(seat.thinking === 'off'
          ? /volces\.com/.test(seat.baseUrl)
            ? { thinking: { type: 'disabled' } }
            : {}
          : {}),
      }),
      signal: ctrl.signal,
    })
    const ms = Date.now() - started
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, ms, error: `HTTP ${res.status} ${text.slice(0, 200)}` }
    }
    await res.json().catch(() => ({}))
    return { ok: true, ms }
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: e?.message ?? String(e) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param getRaw - 取当前原始配置
 * @param onSave - 保存后的回调（把新配置装回插件实例）
 */
export function makeHandler({ getRaw, onSave }) {
  return async function handler(req, res) {
    const url = String(req.url ?? '/')
    const path = url.split('?')[0].replace(/^\/dsh-roundtable/, '') || '/'

    try {
      if (path === '/config' && req.method === 'GET') {
        return send(res, 200, { config: publicView(withDefaults(getRaw())) })
      }

      if (path === '/config' && req.method === 'POST') {
        const body = await readBody(req)
        const next = mergeForm(withDefaults(getRaw()), body)
        if (!Array.isArray(next.participants) || next.participants.length === 0) {
          return send(res, 400, { error: '至少要保留一个席位' })
        }
        saveStore(next)
        onSave(next)
        return send(res, 200, { config: publicView(next) })
      }

      if (path === '/test' && req.method === 'POST') {
        const body = await readBody(req)
        const stored = (getRaw().participants ?? [])[Number(body.index)]
        if (!stored) return send(res, 404, { error: '没有这个席位' })
        // 表单里刚敲的 key 还没保存：优先用它，否则测的永远是旧配置。
        const seat = {
          ...stored,
          ...(body.baseUrl ? { baseUrl: String(body.baseUrl) } : {}),
          ...(body.model ? { model: String(body.model) } : {}),
          ...(body.thinking ? { thinking: String(body.thinking) } : {}),
          ...(body.apiKey ? { apiKey: String(body.apiKey) } : {}),
        }
        if (!seat.apiKey) {
          return send(res, 400, { error: '这个席位还没有 key（输入后直接点测试即可，不必先保存）' })
        }
        return send(res, 200, await probe(seat))
      }

      return send(res, 404, { error: `unknown route ${path}` })
    } catch (e) {
      return send(res, 500, { error: e?.message ?? String(e) })
    }
  }
}
