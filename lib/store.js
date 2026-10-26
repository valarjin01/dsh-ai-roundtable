/**
 * 配置存储：~/.dsh/roundtable.json
 *
 * 为什么不用 profile 的 cordis.patch.yml：
 *   - 那是 YAML，改写容易破坏注释与其它插件的配置
 *   - 设置页每次保存都动它，风险不对等
 * 所以：Loader 的 config 只当"初始种子"，用户在设置页改的东西落在自己的 JSON 里。
 * 一旦 store 存在，就以 store 为准（YAML 后续改动不再生效，README 里写明）。
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

// RT_STORE_PATH 只用于测试：让集成测试能把存储指到临时目录
/**
 * 新用户第一次打开设置页时的默认席位：只有骨架，没有 key。
 * 不给这个，别人装完看到的是一个空页面，不知道该填什么。
 */
export const DEFAULT_PARTICIPANTS = [
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    persona: '结构化拆解与收敛：把模糊争论拆成可验证的判断',
    thinking: 'auto',
    kind: 'auto',
    apiKey: '',
  },
  {
    name: '豆包',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-1-pro-260915',
    persona: '中文语境与落地细节：国内用户习惯、合规、执行阻力',
    thinking: 'off',
    kind: 'auto',
    apiKey: '',
  },
]

/** 配置为空时补上默认席位，避免新用户面对空白页。 */
export function withDefaults(cfg) {
  const base = cfg && typeof cfg === 'object' ? cfg : {}
  const participants = Array.isArray(base.participants) && base.participants.length
    ? base.participants
    : DEFAULT_PARTICIPANTS
  return {
    moderator: 'DeepSeek',
    style: 'debate',
    maxRounds: 2,
    maxWordsPerTurn: 300,
    maxTokens: 800,
    temperature: 0.8,
    timeoutMs: 180000,
    blindFirstRound: true,
    ...base,
    participants,
  }
}

export const STORE_PATH = process.env.RT_STORE_PATH || join(homedir(), '.dsh', 'roundtable.json')

export function loadStore() {
  try {
    const raw = readFileSync(STORE_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** 原子写：先写临时文件再 rename，避免写一半断电留下坏 JSON。 */
export function saveStore(config) {
  mkdirSync(dirname(STORE_PATH), { recursive: true })
  const tmp = `${STORE_PATH}.tmp`
  writeFileSync(tmp, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, STORE_PATH)
  return STORE_PATH
}

/**
 * 对外只暴露"有没有 key"，绝不把 key 发到浏览器。
 * 前端拿不到原文，也就无法通过页面脚本或扩展读走。
 */
export function publicView(cfg) {
  return {
    moderator: cfg.moderator ?? '',
    style: cfg.style ?? 'debate',
    maxRounds: cfg.maxRounds ?? 2,
    maxWordsPerTurn: cfg.maxWordsPerTurn ?? 300,
    maxTokens: cfg.maxTokens ?? 800,
    temperature: cfg.temperature ?? 0.8,
    timeoutMs: cfg.timeoutMs ?? 180000,
    participants: (cfg.participants ?? []).map((p) => ({
      name: p.name,
      baseUrl: p.baseUrl,
      model: p.model,
      persona: p.persona,
      thinking: p.thinking ?? 'auto',
      kind: p.kind ?? 'auto',
      hasKey: Boolean(p.apiKey),
      keyHint: p.apiKey ? maskKey(p.apiKey) : '',
    })),
  }
}

/** sk-abcd...wxyz：够认出来是哪把，又不足以复用。 */
export function maskKey(key) {
  const s = String(key)
  if (s.length <= 10) return '••••'
  return `${s.slice(0, 5)}…${s.slice(-4)}`
}

/**
 * 把设置页提交的表单合并成新配置。
 * 规则：前端留空的 apiKey = 不修改（这样页面永远不需要回显明文）。
 */
export function mergeForm(prev, form) {
  const before = Array.isArray(prev?.participants) ? prev.participants : []
  const participants = (Array.isArray(form?.participants) ? form.participants : []).map((p, i) => {
    const old = before[i] ?? before.find((x) => x.name === p.name) ?? {}
    const typed = String(p.apiKey ?? '').trim()
    return {
      name: String(p.name ?? '').trim(),
      baseUrl: String(p.baseUrl ?? '').trim(),
      model: String(p.model ?? '').trim(),
      persona: String(p.persona ?? '').trim(),
      thinking: ['auto', 'on', 'off'].includes(p.thinking) ? p.thinking : 'auto',
      kind: ['auto', 'openai', 'anthropic'].includes(p.kind) ? p.kind : 'auto',
      apiKey: typed || old.apiKey || '',
    }
  })
  return {
    ...prev,
    moderator: String(form?.moderator ?? prev?.moderator ?? ''),
    style: String(form?.style ?? prev?.style ?? 'debate'),
    maxRounds: Number(form?.maxRounds) || prev?.maxRounds || 2,
    maxWordsPerTurn: Number(form?.maxWordsPerTurn) || prev?.maxWordsPerTurn || 300,
    maxTokens: Number(form?.maxTokens) || prev?.maxTokens || 800,
    temperature: Number.isFinite(Number(form?.temperature)) ? Number(form.temperature) : (prev?.temperature ?? 0.8),
    timeoutMs: Number(form?.timeoutMs) || prev?.timeoutMs || 180000,
    blindFirstRound: form?.blindFirstRound !== false,
    participants,
  }
}
