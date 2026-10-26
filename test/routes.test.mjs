/**
 * 设置页后端路由的测试：不动真实 profile，HOME 指到临时目录。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.HOME = mkdtempSync(join(tmpdir(), 'rt-home-'))

const { makeHandler, STORE_PATH } = await import('../lib/routes.js')
const { STORE_PATH: PATH_CHECK } = await import('../lib/store.js')

function mkReq(method, url, body) {
  const req = { method, url }
  req[Symbol.asyncIterator] = async function* () {
    if (body !== undefined) yield Buffer.from(JSON.stringify(body))
  }
  return req
}

function mkRes() {
  const r = { status: 0, body: null }
  r.writeHead = (s) => {
    r.status = s
  }
  r.end = (b) => {
    r.body = JSON.parse(b)
  }
  return r
}

function baseConfig() {
  return {
    moderator: 'DeepSeek',
    style: 'debate',
    maxRounds: 2,
    participants: [
      { name: '豆包', baseUrl: 'https://ark.test/api/v3', model: 'doubao', persona: '落地', thinking: 'off', apiKey: 'ark-secret-1234567890' },
      { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', persona: '收敛', thinking: 'auto', apiKey: '' },
    ],
  }
}

function handlerWith(config) {
  let raw = config
  return {
    h: makeHandler({ getRaw: () => raw, onSave: (next) => (raw = next) }),
    get: () => raw,
  }
}

async function call(h, method, url, body) {
  const res = mkRes()
  await h(mkReq(method, url, body), res)
  return res
}

test('GET 返回配置，但 key 只有掩码', async () => {
  const { h } = handlerWith(baseConfig())
  const res = await call(h, 'GET', '/dsh-roundtable/config')

  assert.equal(res.status, 200)
  const seat = res.body.config.participants[0]
  assert.equal(seat.hasKey, true)
  assert.match(seat.keyHint, /^ark-s…/)
  assert.equal(seat.apiKey, undefined, '绝不能把明文发到浏览器')
  assert.doesNotMatch(JSON.stringify(res.body), /1234567890/)
})

test('POST 留空 key 表示不修改', async () => {
  const { h, get } = handlerWith(baseConfig())
  const res = await call(h, 'POST', '/dsh-roundtable/config', {
    ...baseConfig(),
    participants: [
      { name: '豆包', baseUrl: 'https://ark.test/api/v3', model: 'doubao-x', persona: '落地', thinking: 'off', apiKey: '' },
      { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', persona: '收敛', thinking: 'auto', apiKey: '' },
    ],
  })

  assert.equal(res.status, 200)
  assert.equal(get().participants[0].apiKey, 'ark-secret-1234567890', '旧 key 应保留')
  assert.equal(get().participants[0].model, 'doubao-x', '其余字段应更新')
})

test('POST 带新 key 会替换，并落盘 0600', async () => {
  const { h, get } = handlerWith(baseConfig())
  await call(h, 'POST', '/dsh-roundtable/config', {
    ...baseConfig(),
    participants: [
      { name: '豆包', baseUrl: 'https://ark.test/api/v3', model: 'doubao', persona: '落地', thinking: 'off', apiKey: 'ark-new-key-abcdef' },
      { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', persona: '收敛', thinking: 'off', apiKey: 'sk-new' },
    ],
  })

  assert.equal(get().participants[0].apiKey, 'ark-new-key-abcdef')
  assert.equal(get().participants[1].thinking, 'off')
  assert.equal(PATH_CHECK, STORE_PATH)
  assert.ok(existsSync(STORE_PATH), '应该写了 store 文件')
  const mode = statSync(STORE_PATH).mode & 0o777
  assert.equal(mode, 0o600, '密钥文件必须是 0600')
})

test('POST 一个席位都不剩时拒绝', async () => {
  const { h } = handlerWith(baseConfig())
  const res = await call(h, 'POST', '/dsh-roundtable/config', { ...baseConfig(), participants: [] })
  assert.equal(res.status, 400)
  assert.match(res.body.error, /至少/)
})

test('试连接：成功返回耗时', async () => {
  const { h } = handlerWith(baseConfig())
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })
  const res = await call(h, 'POST', '/dsh-roundtable/test', { index: 0 })

  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(typeof res.body.ms, 'number')
})

test('试连接：失败把原始错误带回来', async () => {
  const { h } = handlerWith(baseConfig())
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'invalid api key' })
  const res = await call(h, 'POST', '/dsh-roundtable/test', { index: 0 })

  assert.equal(res.body.ok, false)
  assert.match(res.body.error, /401/)
  assert.match(res.body.error, /invalid api key/)
})

test('没 key 的席位不发试连接请求', async () => {
  const { h } = handlerWith(baseConfig())
  let called = false
  globalThis.fetch = async () => {
    called = true
    return { ok: true, json: async () => ({}) }
  }
  const res = await call(h, 'POST', '/dsh-roundtable/test', { index: 1 })
  assert.equal(res.status, 400)
  assert.equal(called, false)
})

test('未知路由 404', async () => {
  const { h } = handlerWith(baseConfig())
  const res = await call(h, 'GET', '/dsh-roundtable/nope')
  assert.equal(res.status, 404)
})
