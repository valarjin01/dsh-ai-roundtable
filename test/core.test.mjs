import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  completionsUrl,
  requestUrl,
  isAnthropic,
  thinkingParams,
  STYLES,
  STYLE_IDS,
  normalizeConfig,
  checkConfig,
  openRoom,
  nextTurn,
  sayInRoom,
  closeRoom,
  parseDecision,
  getRoom,
} from '../lib/core.js'

const cfg = normalizeConfig({
  participants: [
    { name: 'ChatGPT', baseUrl: 'https://a.test/v1', model: 'gpt', apiKey: 'k1', persona: '广度' },
    { name: '豆包', baseUrl: 'https://b.test/api/v3', model: 'db', apiKey: 'k2', persona: '落地' },
    { name: 'DeepSeek', baseUrl: 'https://c.test', model: 'ds', apiKey: 'k3', persona: '收敛' },
  ],
  moderator: 'DeepSeek',
  maxRounds: 2,
})

function reply(content) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) }
}

/** 调度员按「还没说过的人」顺序点名，模拟理想情况。 */
function makeFetch(state) {
  return async (_url, init) => {
    const body = JSON.parse(init.body)
    const system = body.messages[0].content
    if (system.includes('调度员')) {
      const spoken = state.speakers
      const next = ['ChatGPT', '豆包', 'DeepSeek'].find((n) => !spoken.includes(n)) ?? 'ChatGPT'
      state.speakers = spoken.length >= 2 ? [] : [...spoken, next]
      return reply(JSON.stringify({ next, reason: '该他回应了' }))
    }
    if (system.includes('记录员')) return reply('## 出现了哪些角度\n测试角度')
    const n = ++state.speech
    return reply(`第 ${n} 条发言`)
  }
}

test('三方各说一轮后能推进到第二轮', async () => {
  const state = { speakers: [], speech: 0 }
  const fetchImpl = makeFetch(state)
  const room = openRoom(cfg, '测试议题')

  const seen = []
  for (let i = 0; i < 3; i++) {
    const step = await nextTurn(cfg, room, fetchImpl)
    assert.equal(step.done, false)
    assert.ok(step.speaker)
    seen.push(step.speaker)
  }

  assert.equal(new Set(seen).size, 3, '三个人都说过话')
  assert.equal(room.transcript.length, 3)
  assert.equal(room.transcript[2].round, 1)
})

test('说满轮数后返回 done', async () => {
  const state = { speakers: [], speech: 0 }
  const fetchImpl = makeFetch(state)
  const room = openRoom(cfg, '上限测试', { maxRounds: 1 })

  for (let i = 0; i < 3; i++) await nextTurn(cfg, room, fetchImpl)
  const step = await nextTurn(cfg, room, fetchImpl)

  assert.equal(step.done, true)
  assert.match(step.reason, /轮/)
})

test('调度员输出乱码时按轮换兜底，不中断', async () => {
  const fetchImpl = async (_url, init) => {
    const system = JSON.parse(init.body).messages[0].content
    if (system.includes('调度员')) return reply('我觉得该豆包说吧（不是 JSON）')
    return reply('兜底发言')
  }
  const room = openRoom(cfg, '兜底测试')
  const step = await nextTurn(cfg, room, fetchImpl)

  assert.equal(step.done, false)
  assert.equal(step.speaker, 'ChatGPT', '轮换取第一个没说过的人')
  assert.match(step.reason, /兜底|轮换/)
})

test('走完盲写首轮后，调度员说 end 就收场', async () => {
  const fetchImpl = async (_url, init) => {
    const system = JSON.parse(init.body).messages[0].content
    if (system.includes('调度员')) return reply('{"next":"end","reason":"已经收敛"}')
    return reply('盲写发言')
  }
  const room = openRoom(cfg, '收敛测试')
  for (let i = 0; i < cfg.participants.length; i++) await nextTurn(cfg, room, fetchImpl)

  const step = await nextTurn(cfg, room, fetchImpl)
  assert.equal(step.done, true)
  assert.equal(step.reason, '已经收敛')
})

test('单个模型 500 时记录失败但继续', async () => {
  const fetchImpl = async (_url, init) => {
    const system = JSON.parse(init.body).messages[0].content
    if (system.includes('调度员')) return reply('{"next":"ChatGPT","reason":"先问他"}')
    return { ok: false, status: 500, text: async () => 'boom' }
  }
  const room = openRoom(cfg, '故障测试')
  const step = await nextTurn(cfg, room, fetchImpl)

  assert.equal(step.done, false)
  assert.match(step.text, /调用失败/)
  assert.equal(room.transcript.length, 1, '失败也要进记录')
})

test('插话进入 transcript，后面的模型能看到', async () => {
  const state = { speakers: [], speech: 0 }
  const room = openRoom(cfg, '插话测试')
  sayInRoom(room, '你们都没提成本')
  assert.equal(room.transcript[0].role, 'human')

  let seenHistory = ''
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.messages[0].content.includes('调度员')) return reply('{"next":"豆包","reason":"回应主持"}')
    seenHistory = body.messages[1].content
    return reply('回应主持：成本这块我补')
  }
  await nextTurn(cfg, room, fetchImpl)
  assert.match(seenHistory, /成本/)
})

test('纪要正常返回', async () => {
  const state = { speakers: [], speech: 0 }
  const fetchImpl = makeFetch(state)
  const room = openRoom(cfg, '纪要测试')
  await nextTurn(cfg, room, fetchImpl)
  const { summary, transcript } = await closeRoom(cfg, room, fetchImpl)

  assert.match(summary, /角度/)
  assert.match(transcript, /已有发言/)
})

test('parseDecision 容忍代码块和多余空格', () => {
  const names = ['ChatGPT', '豆包', 'DeepSeek']
  assert.deepEqual(parseDecision('```json\n{"next":" 豆包 ","reason":"x"}\n```', names), { next: '豆包', reason: 'x' })
  assert.deepEqual(parseDecision('{"next":"END","reason":"收"}', names), { next: 'end', reason: '收' })
  assert.equal(parseDecision('没有 json', names), null)
  assert.equal(parseDecision('{"next":"无名氏"}', names), null)
})

test('缺 key 的配置能被体检出来', () => {
  const bad = normalizeConfig({
    participants: [{ name: 'X', baseUrl: 'https://x', model: 'm' }],
  })
  assert.match(checkConfig(bad) ?? '', /apiKey/)
  assert.equal(checkConfig(cfg), null)
})

test('房间查找', () => {
  const room = openRoom(cfg, '查找测试')
  assert.equal(getRoom(room.id)?.topic, '查找测试')
  assert.equal(getRoom('rt-nope'), undefined)
})

test('六种风格都带齐三处改写（调度/发言/纪要）', () => {
  assert.equal(STYLE_IDS.length, 6)
  for (const id of STYLE_IDS) {
    const s = STYLES[id]
    assert.ok(s.label && s.hint, `${id} 缺 label/hint`)
    assert.ok(s.schedule.length > 4, `${id} 缺调度规则`)
    assert.ok(s.speak.length > 4, `${id} 缺发言纪律`)
    assert.ok(s.shape.includes('##'), `${id} 的纪要形状不像 markdown`)
  }
})

test('未知风格回落到 debate，而不是报错', () => {
  assert.equal(normalizeConfig({ style: 'nope' }).style, 'debate')
  assert.equal(normalizeConfig({}).style, 'debate')
  assert.equal(normalizeConfig({ style: 'redteam' }).style, 'redteam')
})

test('openRoom 可以按场次覆盖风格', () => {
  const room = openRoom(cfg, '覆盖风格', { style: 'brainstorm' })
  assert.equal(room.style, 'brainstorm')
  const fallback = openRoom(cfg, '覆盖风格2', { style: 'bad' })
  assert.equal(fallback.style, cfg.style)
})

test('发言提示词真的随风格变化', async () => {
  const captured = []
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    captured.push(body.messages[0].content)
    if (body.messages[0].content.includes('调度员')) {
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"next":"ChatGPT","reason":"开场"}' } }] }) }
    }
    return { ok: true, json: async () => ({ choices: [{ message: { content: '发言' } }] }) }
  }

  for (const style of ['debate', 'redteam', 'socratic']) {
    const room = openRoom({ ...cfg, style }, `风格-${style}`)
    await nextTurn({ ...cfg, style }, room, fetchImpl)
  }

  const spoken = captured.filter((c) => !c.includes('调度员'))
  assert.match(spoken[0], /辩论/)
  assert.match(spoken[1], /红队/)
  assert.match(spoken[2], /苏格拉底/)
  assert.equal(new Set(spoken).size, 3, '三种风格的提示词应当不同')
})

test('第一个发言者不会被要求去反驳不存在的人', async () => {
  let userMsg = ''
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.messages[0].content.includes('调度员')) {
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"next":"豆包","reason":"开场"}' } }] }) }
    }
    userMsg = body.messages[1].content
    return { ok: true, json: async () => ({ choices: [{ message: { content: '开场发言' } }] }) }
  }
  const room = openRoom(cfg, '开场测试')
  await nextTurn(cfg, room, fetchImpl)
  assert.match(userMsg, /首轮互不可见/)
  assert.doesNotMatch(userMsg, /现在轮到你/)
})

test('首轮盲写：后发言者看不到先发言者的内容', async () => {
  const seen = []
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.messages[0].content.includes('调度员')) {
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"next":"ChatGPT","reason":"x"}' } }] }) }
    }
    seen.push(body.messages[1].content)
    return { ok: true, json: async () => ({ choices: [{ message: { content: '我的独有观点ABCD' } }] }) }
  }
  const room = openRoom(cfg, '盲写')
  for (let i = 0; i < cfg.participants.length; i++) await nextTurn(cfg, room, fetchImpl)

  assert.equal(seen.length, 3)
  for (const msg of seen) {
    assert.doesNotMatch(msg, /我的独有观点ABCD/, '首轮不该看到别人的发言')
  }
  assert.ok(seen.every((m) => m.includes('还没看到任何人的发言')))
})

test('首轮结束后，第二轮能看到全部发言', async () => {
  let last = ''
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.messages[0].content.includes('调度员')) {
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"next":"豆包","reason":"回应"}' } }] }) }
    }
    last = body.messages[1].content
    return { ok: true, json: async () => ({ choices: [{ message: { content: '第二轮发言' } }] }) }
  }
  const room = openRoom(cfg, '解除盲写')
  for (let i = 0; i < cfg.participants.length; i++) await nextTurn(cfg, room, fetchImpl)
  await nextTurn(cfg, room, fetchImpl)

  assert.match(last, /第二轮发言|已有发言/)
  assert.match(last, /现在轮到你/)
})

test('人类插话在盲写阶段也可见', async () => {
  let msg = ''
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    msg = body.messages[1].content
    return { ok: true, json: async () => ({ choices: [{ message: { content: '回应' } }] }) }
  }
  const room = openRoom(cfg, '人类可见')
  sayInRoom(room, '我先说一句：别忘了成本')
  await nextTurn(cfg, room, fetchImpl)
  assert.match(msg, /别忘了成本/)
})

test('席位的 extraBody 会合并进请求体，且能覆盖默认值', async () => {
  let body = null
  const fetchImpl = async (_url, init) => {
    body = JSON.parse(init.body)
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'r' } }] }) }
  }
  const withExtra = normalizeConfig({
    participants: [
      { name: 'A', baseUrl: 'https://a', model: 'm', apiKey: 'k', extraBody: { thinking: { type: 'disabled' } } },
      { name: 'B', baseUrl: 'https://b', model: 'm', apiKey: 'k' },
    ],
  })
  const room = openRoom(withExtra, '透传')
  await nextTurn(withExtra, room, fetchImpl)
  assert.deepEqual(body.thinking, { type: 'disabled' })
  assert.equal(body.max_tokens, 800)
})

test('没有 extraBody 时不额外塞字段', async () => {
  let body = null
  const fetchImpl = async (_url, init) => {
    body = JSON.parse(init.body)
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'r' } }] }) }
  }
  const room = openRoom(cfg, '干净请求体')
  await nextTurn(cfg, room, fetchImpl)
  assert.equal(body.thinking, undefined)
})

test('思考模式按供应商翻译成真实参数', () => {
  const ark = { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3' }
  const oai = { baseUrl: 'https://api.openai.com/v1' }
  const other = { baseUrl: 'https://api.deepseek.com' }

  assert.deepEqual(thinkingParams(ark, 'off'), { thinking: { type: 'disabled' } })
  assert.deepEqual(thinkingParams(ark, 'on'), { thinking: { type: 'enabled' } })
  assert.deepEqual(thinkingParams(oai, 'off'), { reasoning_effort: 'minimal' })
  assert.deepEqual(thinkingParams(oai, 'on'), { reasoning_effort: 'medium' })
  assert.deepEqual(thinkingParams(other, 'off'), {}, '未知网关不乱塞字段')
  assert.deepEqual(thinkingParams(ark, 'auto'), {}, 'auto 不干预')
})

test('thinking 进请求体，且 extraBody 能覆盖它', async () => {
  const bodies = []
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'r' } }] }) }
  }
  const c = normalizeConfig({
    participants: [
      { name: 'A', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'm', apiKey: 'k', thinking: 'off' },
      { name: 'B', baseUrl: 'https://b.test', model: 'm', apiKey: 'k', thinking: 'off', extraBody: { thinking: { type: 'enabled' } } },
    ],
  })
  const room = openRoom(c, '思考开关')
  await nextTurn(c, room, fetchImpl)
  await nextTurn(c, room, fetchImpl)

  assert.deepEqual(bodies[0].thinking, { type: 'disabled' })
  assert.deepEqual(bodies[1].thinking, { type: 'enabled' }, 'extraBody 优先')
})

test('接口地址容忍重复的 /chat/completions', () => {
  assert.equal(completionsUrl('https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions')
  assert.equal(completionsUrl('https://api.deepseek.com/'), 'https://api.deepseek.com/chat/completions')
  assert.equal(
    completionsUrl('https://open.bigmodel.cn/api/paas/v4/chat/completions'),
    'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  )
  assert.equal(
    completionsUrl('https://open.bigmodel.cn/api/paas/v4/chat/completions/'),
    'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  )
  assert.equal(
    completionsUrl('https://ark.cn-beijing.volces.com/api/v3'),
    'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
  )
})

test('关掉盲写后，第二轮之前就能看到前面的发言', async () => {
  let second = ''
  let call = 0
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.messages[0].content.includes('调度员')) {
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"next":"豆包","reason":"接力"}' } }] }) }
    }
    call += 1
    if (call === 2) second = body.messages[1].content
    return { ok: true, json: async () => ({ choices: [{ message: { content: '第一段' } }] }) }
  }
  const c = normalizeConfig({ ...cfg, blindFirstRound: false })
  const room = openRoom(c, '不盲写')
  await nextTurn(c, room, fetchImpl)
  await nextTurn(c, room, fetchImpl)
  assert.match(second, /第一段/, '关掉盲写后，第二个发言者应能看到第一段')
  assert.doesNotMatch(second, /还没看到任何人的发言/)
})

test('默认仍是盲写', () => {
  assert.equal(normalizeConfig({}).blindFirstRound, true)
  const room = openRoom(cfg, '默认盲写')
  assert.equal(room.blindFirstRound, true)
})

test('协议识别与地址拼接', () => {
  const claude = { baseUrl: 'https://api.anthropic.com/v1' }
  const claude2 = { baseUrl: 'https://api.anthropic.com/v1/messages' }
  const oai = { baseUrl: 'https://api.openai.com/v1' }
  const generic = { baseUrl: 'https://api.moonshot.cn/v1' }

  assert.equal(isAnthropic(claude), true)
  assert.equal(isAnthropic(oai), false)
  assert.equal(requestUrl(claude), 'https://api.anthropic.com/v1/messages')
  assert.equal(requestUrl(claude2), 'https://api.anthropic.com/v1/messages')
  assert.equal(requestUrl(oai), 'https://api.openai.com/v1/chat/completions')

  // kind 显式指定可以压过域名猜测（例如走代理）
  assert.equal(isAnthropic({ ...oai, kind: 'anthropic' }), true)
  assert.equal(isAnthropic({ ...claude, kind: 'openai' }), false)
  assert.equal(requestUrl({ baseUrl: 'https://proxy.test/v1', kind: 'anthropic' }), 'https://proxy.test/v1/messages')
})

test('Anthropic 席位用 Messages 协议：system 走顶层，返回取 content[] 文本', async () => {
  let seen = null
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    seen = { url, headers: init.headers, body }
    if (String(body.messages[0].content).includes('调度员')) {
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"next":"Claude","reason":"开场"}' }] }) }
    }
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: '这是 Claude 的发言' }] }) }
  }
  const c = normalizeConfig({
    participants: [
      { name: 'Claude', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', apiKey: 'sk-ant-x', kind: 'anthropic' },
      { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'k' },
    ],
  })
  const room = openRoom(c, '协议测试')
  const step = await nextTurn(c, room, fetchImpl)

  assert.equal(step.speaker, 'Claude')
  assert.equal(step.text, '这是 Claude 的发言')
  assert.match(seen.url, /\/v1\/messages$/)
  assert.equal(seen.headers['x-api-key'], 'sk-ant-x')
  assert.equal(seen.headers['anthropic-version'], '2023-06-01')
  assert.ok(seen.body.system, 'system 应该是顶层字段')
  assert.equal(seen.body.messages.every((m) => m.role !== 'system'), true)
})
