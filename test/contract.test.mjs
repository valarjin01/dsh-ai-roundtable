/**
 * 工具层契约测试：不启动 DSH，用桩模块替代 @deepseek-ai/dsh-tools，
 * 检查 apply 注册出来的定义形状、每个 action 的返回值是否落在 output.schema 里。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 隔离：插件启动会读 RT_STORE_PATH，不隔离就会读到用户真实配置，测试随环境飘。
process.env.RT_STORE_PATH = join(tmpdir(), `rt-test-store-${process.pid}.json`)

const stubUrl = new URL('./stub-tools.mjs', import.meta.url).href
const stubSchemaUrl = new URL('./stub-schemastery.mjs', import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: stubUrl, shortCircuit: true }
    }
    if (specifier === '@deepseek-ai/schemastery') {
      return { url: stubSchemaUrl, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const CONFIG = {
  participants: [
    { name: 'ChatGPT', baseUrl: 'https://a.test/v1', model: 'gpt', apiKey: 'k1', persona: '广度' },
    { name: '豆包', baseUrl: 'https://b.test/api/v3', model: 'db', apiKey: 'k2', persona: '落地' },
    { name: 'DeepSeek', baseUrl: 'https://c.test', model: 'ds', apiKey: 'k3', persona: '收敛' },
  ],
  moderator: 'DeepSeek',
  maxRounds: 2,
}

function json(content) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }), text: async () => '' }
}

/** 假 fetch：调度员按顺序点名，其他人发言。 */
function installFakeFetch(log = []) {
  const speakers = []
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    log.push({ url, body })
    const system = body.messages[0].content
    if (system.includes('调度员')) {
      const next = ['ChatGPT', '豆包', 'DeepSeek'].find((n) => !speakers.includes(n)) ?? 'ChatGPT'
      speakers.push(next)
      if (speakers.length > 3) speakers.length = 0
      return json(JSON.stringify({ next, reason: '该他回应' }))
    }
    if (system.includes('记录员')) return json('## 出现了哪些角度\n纪要内容')
    return json('我不同意上一条的结论，因为成本没算进去。')
  }
}

async function boot(config = CONFIG) {
  const mod = await import('../lib/index.js')
  let registered = null
  const ctx = {
    tools: { register: (def) => { registered = def } },
    // 模拟 Cordis：inject 就绪后回调，effect 立即执行并返回清理函数
    inject: (_deps, cb) =>
      cb({ effect: (fn) => { fn(); return () => {} }, webServer: { register: () => () => {} } }),
  }
  mod.apply(ctx, config)
  return { mod, def: registered }
}

function assertShape(schema, value) {
  const allowed = new Set(Object.keys(schema.properties ?? {}))
  for (const key of Object.keys(value)) {
    assert.ok(allowed.has(key), `返回值出现未声明字段 "${key}"，会被 ToolOutputError 打回`)
  }
  for (const [key, v] of Object.entries(value)) {
    const type = schema.properties[key]?.type
    if (type === 'string') assert.equal(typeof v, 'string', `${key} 应为 string`)
    if (type === 'boolean') assert.equal(typeof v, 'boolean', `${key} 应为 boolean`)
    if (type === 'number') assert.equal(typeof v, 'number', `${key} 应为 number`)
    if (type === 'array') assert.ok(Array.isArray(v), `${key} 应为 array`)
  }
}

test('apply 注册一个名为 roundtable 的工具', async () => {
  const { mod, def } = await boot()
  assert.equal(mod.name, 'roundtable')
  assert.deepEqual(mod.inject, ['tools'])
  assert.ok(def, '应该调用 ctx.tools.register')
  assert.equal(def.name, 'roundtable')
  assert.equal(def.parameters.action.required, true)
  assert.equal(typeof def.execute, 'function')
  assert.equal(typeof def.output.render, 'function')
  assert.ok(def.timeoutMs > 0, '长任务必须设 timeoutMs')
  assert.notEqual(def.isConcurrencySafe, true, '有共享状态，不能标并发安全')
})

test('空配置也能加载，不抛异常', async () => {
  const { def } = await boot({})
  assert.equal(def.name, 'roundtable')
  const res = await def.execute({ action: 'open', topic: '空配置' }, {})
  assert.match(res.error, /apiKey|席位/)
})

test('缺 key 的席位会被跳过，少于两人时明确报错', async () => {
  const { def } = await boot({
    participants: [
      { name: 'A', baseUrl: 'https://a', model: 'm', apiKey: 'k' },
      { name: 'B', baseUrl: 'https://b', model: 'm' },
    ],
  })
  const res = await def.execute({ action: 'open', topic: 'x' }, {})
  assert.match(res.error, /至少需要 2 个/)
  assert.match(res.error, /B/)
})

test('open → next ×3 → say → close 全链路，返回值全部符合 schema', async () => {
  installFakeFetch()
  const { def } = await boot()
  const schema = def.output.schema

  const open = await def.execute({ action: 'open', topic: '团队要不要上 AI 代码评审' }, {})
  assertShape(schema, open)
  assert.ok(open.roomId?.startsWith('rt-'))
  assert.equal(open.status, 'open')

  const speakers = new Set()
  for (let i = 0; i < 3; i++) {
    const step = await def.execute({ action: 'next', roomId: open.roomId }, {})
    assertShape(schema, step)
    assert.equal(step.done, false)
    speakers.add(step.speaker)
    assert.ok(step.text.length > 0)
    assert.equal(typeof step.round, 'number')
  }
  assert.equal(speakers.size, 3, '三个人都应该说过话')

  const said = await def.execute({ action: 'say', roomId: open.roomId, text: '成本呢？' }, {})
  assertShape(schema, said)
  assert.equal(said.status, 'said')

  const closed = await def.execute({ action: 'close', roomId: open.roomId }, {})
  assertShape(schema, closed)
  assert.match(closed.summary, /角度/)
  assert.match(closed.text, /已有发言/)
})

test('走到轮数上限后返回 done', async () => {
  installFakeFetch()
  const { def } = await boot({ ...CONFIG, maxRounds: 1 })
  const open = await def.execute({ action: 'open', topic: '上限' }, {})
  let last
  for (let i = 0; i < 4; i++) {
    last = await def.execute({ action: 'next', roomId: open.roomId }, {})
  }
  assert.equal(last.done, true)
  assert.ok(last.reason)
})

test('房间不存在时给出可操作的错误', async () => {
  const { def } = await boot()
  const res = await def.execute({ action: 'next', roomId: 'rt-zzzz' }, {})
  assert.match(res.error, /找不到房间/)
  assert.match(res.error, /open/)
})

test('未知 action 返回错误而不是抛异常', async () => {
  const { def } = await boot()
  const res = await def.execute({ action: 'dance' }, {})
  assert.match(res.error, /不认识的 action/)
})

test('render 返回内容块数组，且错误态可说人话', async () => {
  const { def } = await boot()
  const blocks = def.output.render({}, { error: '缺少 apiKey' })
  assert.ok(Array.isArray(blocks))
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /缺少 apiKey/)
})

test('外部取消信号会传到 fetch', async () => {
  const { def } = await boot()
  const open = await def.execute({ action: 'open', topic: '取消测试' }, {})
  const ac = new AbortController()
  ac.abort()
  let seenSignal = null
  globalThis.fetch = async (_url, init) => {
    seenSignal = init.signal
    throw new DOMException('aborted', 'AbortError')
  }
  const step = await def.execute({ action: 'next', roomId: open.roomId }, { signal: ac.signal })
  assert.ok(seenSignal, 'fetch 应该收到 signal')
  assert.match(step.text ?? step.error, /调用失败|失败|abort/i)
})

test('config 动作能读出当前配置与 key 状态', async () => {
  const { def } = await boot()
  const res = await def.execute({ action: 'config' }, {})
  assertShape(def.output.schema, res)
  assert.equal(res.status, 'config')
  assert.match(res.text, /风格：辩论/)
  assert.match(res.text, /调度员：DeepSeek/)
  assert.match(res.text, /ChatGPT\s+✓ 已配 key/)
  assert.match(res.text, /可开场/)
})

test('open 可以指定讨论风格，未知风格回落到配置值', async () => {
  installFakeFetch()
  const { def } = await boot()
  const a = await def.execute({ action: 'open', topic: 'A', style: 'brainstorm' }, {})
  assert.equal(a.status, 'open')
  assert.match(a.text, /参与者/)

  const b = await def.execute({ action: 'open', topic: 'B', style: '不存在的风格' }, {})
  assert.equal(b.status, 'open', '未知风格不应报错，而是回落')
})

test('入口不依赖 schemastery（它曾让整个插件加载失败）', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /schemastery/, '宿主入口不应再引入 schemastery')
  const mod = await import('../lib/index.js')
  assert.equal(mod.name, 'roundtable')
  assert.deepEqual(mod.inject, ['tools'])
  assert.equal(typeof mod.apply, 'function')
})
