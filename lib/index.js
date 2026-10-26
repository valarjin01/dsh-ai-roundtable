/**
 * DSH 工具插件：多模型圆桌
 *
 * 一次工具调用只走一步（调度员点名 → 某人发言），这样每句话都能立刻回到对话里，
 * 而不是憋两分钟吐出一大段。典型用法：
 *   roundtable({action:"open", topic:"…"})
 *   roundtable({action:"next", roomId:"rt-ab12"})   ← 反复调用
 *   roundtable({action:"say",  roomId:"rt-ab12", text:"…"})
 *   roundtable({action:"close",roomId:"rt-ab12"})
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { loadStore } from './store.js'
import { makeHandler } from './routes.js'
import {
  normalizeConfig,
  openRoom,
  STYLES,
  getRoom,
  nextTurn,
  sayInRoom,
  closeRoom,
  listRoomIds,
  currentRound,
} from './core.js'

/** 插件身份。 */
export const name = 'roundtable'

/** 只依赖工具注册表，别的服务一概不碰。 */
export const inject = ['tools']

const ACTIONS = new Set(['open', 'next', 'say', 'close', 'list', 'config'])

const USAGE = [
  '多模型圆桌：把 ChatGPT / 豆包 / DeepSeek 等模型拉进同一场讨论，由一个中立调度员决定谁发言。',
  '',
  '用法（一次调用走一步）：',
  '1. action="open" + topic 开场，拿到 roomId —— 返回参与者、调度员、最大轮数',
  '2. action="next" + roomId 反复调用：调度员点名 → 被点名者发言，每次只返回一位',
  '3. action="say" + roomId + text 插话，下一轮所有人都会看到',
  '4. action="close" + roomId 收场，返回纪要 + 全文',
  '5. action="list" 列出进行中的房间',
  '6. action="config" 查看当前配置（席位、调度员、风格、预算）',
  '',
  '建议节奏：open → next ×3 → say → next ×3 → close。',
  '每一步都要把发言原话转述给用户，不要只报"已完成"。',
].join('\n')

/** 只保留真正配好 key 的席位；圆桌至少要两个人。 */
function readyParticipants(cfg) {
  const ready = cfg.participants.filter((p) => p.apiKey)
  const missing = cfg.participants.filter((p) => !p.apiKey).map((p) => p.name)
  if (ready.length < 2) {
    return {
      error:
        `至少需要 2 个配好 apiKey 的席位。` +
        (missing.length ? `当前缺少：${missing.join('、')}。` : '当前一个都没有。') +
        '请在 DSH 插件配置的 participants 里填 apiKey 或 apiKeyEnv。',
    }
  }
  const moderator = ready.find((p) => p.name === cfg.moderator?.name) ?? ready[0]
  return { cfg: { ...cfg, participants: ready, moderator } }
}

function renderValue(_args, v) {
  if (v.error) return [{ type: 'text', text: `⚠️ ${v.error}` }]

  if (v.roomId && v.status === 'open') {
    return [
      {
        type: 'text',
        text: `圆桌「${v.topic ?? ''}」已开场，房间 ${v.roomId}。\n${v.text ?? ''}`,
      },
    ]
  }
  if (v.status === 'said') {
    return [{ type: 'text', text: `已插话（房间 ${v.roomId}）。下一轮所有人都会看到。` }]
  }
  if (v.summary) {
    return [{ type: 'text', text: `${v.summary}\n\n---\n\n${v.text ?? ''}` }]
  }
  if (Array.isArray(v.rooms)) {
    return [
      {
        type: 'text',
        text: v.rooms.length ? `进行中的房间：${v.rooms.join('、')}` : '当前没有进行中的圆桌。',
      },
    ]
  }
  if (v.done) {
    return [{ type: 'text', text: `⏹ 讨论结束：${v.reason ?? ''}` }]
  }
  if (v.speaker) {
    const head = v.reason ? `【${v.speaker}】（调度理由：${v.reason}）` : `【${v.speaker}】`
    return [{ type: 'text', text: `${head}\n\n${v.text ?? ''}` }]
  }
  return [{ type: 'text', text: v.text ?? '（无输出）' }]
}

export function apply(ctx, config) {
  // 开机留痕：宿主侧到底有没有加载本插件，看这个文件就知道（排障用，可随时删）。
  try {
    mkdirSync(join(homedir(), '.dsh'), { recursive: true })
    appendFileSync(join(homedir(), '.dsh', 'roundtable-boot.log'), `${new Date().toISOString()} host apply() ran\n`)
  } catch {
    /* 留痕失败不影响插件 */
  }

  // apply 阶段永不抛异常：配置为空也要能加载成功，问题留到调用时给提示。
  const base = config ?? {}
  const stored = loadStore()
  // store 存在就以它为准（设置页保存过），否则用 Loader 里的种子配置
  let raw = stored ? { ...base, ...stored } : base
  let cfg = normalizeConfig(raw)

  // 设置页的后端路由。
  // 必须用 ctx.inject 声明依赖：ctx.get() 拿不到未声明的服务，路由会被静默跳过（就是上一版的 404）。
  const handler = makeHandler({
    getRaw: () => raw,
    onSave: (next) => {
      next.participants = (next.participants ?? []).map((p) => ({
        ...p,
        baseUrl: String(p.baseUrl ?? '').replace(/\/chat\/completions\/?$/i, ''),
      }))
      raw = next
      cfg = normalizeConfig(next) // 保存后立即生效，不重启
    },
  })
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'prefix', path: '/dsh-roundtable', handler }),
      'roundtable: settings routes',
    )
    try {
      appendFileSync(join(homedir(), '.dsh', 'roundtable-boot.log'), `${new Date().toISOString()} routes registered on webServer\n`)
    } catch {
      /* 留痕失败不影响功能 */
    }
  })
  const cancelSignal = (exec) => exec?.signal

  ctx.tools.register(
    defineTool({
      name: 'roundtable',
      description: USAGE,
      parameters: {
        action: {
          type: 'string',
          required: true,
          description: 'open 开场 / next 走一步 / say 插话 / close 收场 / list 列出房间',
        },
        topic: { type: 'string', description: '议题，仅 open 时需要' },
        roomId: { type: 'string', description: '房间 id，open 之外都需要' },
        text: { type: 'string', description: 'say 时要插入的话' },
        rounds: { type: 'number', description: 'open 时覆盖最大轮数（1-6，默认取配置值）' },
        style: {
          type: 'string',
          description: 'open 时覆盖讨论风格：debate / brainstorm / redteam / postmortem / socratic / decision',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            roomId: { type: 'string' },
            topic: { type: 'string' },
            status: { type: 'string' },
            done: { type: 'boolean' },
            speaker: { type: 'string' },
            text: { type: 'string' },
            reason: { type: 'string' },
            summary: { type: 'string' },
            round: { type: 'number' },
            rooms: { type: 'array', items: { type: 'string' } },
            error: { type: 'string' },
          },
        },
        render: renderValue,
      },
      timeoutMs: 180000,
      async execute(args, exec) {
        // 每次调用都重新读一次 store：这样外部编辑器（或设置页）改完立刻生效，不用重启。
        const fresh = loadStore()
        if (fresh) cfg = normalizeConfig({ ...base, ...fresh })
        const action = String(args.action ?? '').trim().toLowerCase()

        // 先校验 action：否则未知动作会被下面的"房间不存在"拦住，模型会反复去开房。
        if (!ACTIONS.has(action)) {
          return { error: `不认识的 action：${action || '(空)'}。可用：${[...ACTIONS].join(' / ')}` }
        }

        if (action === 'list') return { rooms: listRoomIds() }

        if (action === 'config') {
          const lines = [
            '当前配置',
            `风格：${STYLES[cfg.style].label}（${cfg.style}）`,
            `调度员：${cfg.moderator?.name ?? '（自动：第一个有 key 的席位）'}`,
            `轮数上限：${cfg.maxRounds}　单次字数：${cfg.maxWordsPerTurn}　温度：${cfg.temperature}`,
            '',
            '席位：',
          ]
          cfg.participants.forEach((p, i) => {
            const key = p.apiKey ? '✓ 已配 key' : '✗ 缺 key'
            lines.push(`  ${i + 1}. ${p.name}  ${key}  ${p.baseUrl} · ${p.model}`)
          })
          const ready = cfg.participants.filter((p) => p.apiKey).length
          lines.push('', ready >= 2 ? `可开场（${ready} 个席位就绪）` : `还不能开场：至少需要 2 个配好 key 的席位，当前 ${ready} 个`)
          return { status: 'config', text: lines.join('\n') }
        }

        if (action === 'open') {
          const topic = String(args.topic ?? '').trim()
          if (!topic) return { error: 'open 需要 topic（议题）。' }
          const picked = readyParticipants(cfg)
          if (picked.error) return { error: picked.error }
          try {
            const room = openRoom(picked.cfg, topic, { maxRounds: args.rounds, style: args.style })
            return {
              roomId: room.id,
              topic: room.topic,
              status: 'open',
              text: [
                `参与者：${room.participants.map((p) => p.name).join('、')}`,
                `调度员：${room.moderator.name}`,
                `最多 ${room.maxRounds} 轮（每人最多说 ${room.maxRounds} 次）`,
                `下一步：roundtable({action:"next", roomId:"${room.id}"})`,
              ].join('\n'),
            }
          } catch (e) {
            return { error: e.message }
          }
        }

        const room = getRoom(args.roomId)
        if (!room) {
          return {
            error: `找不到房间 ${args.roomId ?? '(空)'}。先用 action:"open" 开场，或 action:"list" 看现有房间。`,
          }
        }

        if (action === 'next') {
          try {
            const step = await nextTurn(cfg, room, fetch, cancelSignal(exec))
            return {
              roomId: room.id,
              done: Boolean(step.done),
              speaker: step.speaker ?? '',
              text: step.text ?? '',
              reason: step.reason ?? '',
              round: step.round ?? currentRound(room),
            }
          } catch (e) {
            return { roomId: room.id, error: `这一步失败了：${e.message}` }
          }
        }

        if (action === 'say') {
          try {
            if (!String(args.text ?? '').trim()) return { roomId: room.id, error: 'say 需要 text。' }
            sayInRoom(room, args.text)
            return { roomId: room.id, status: 'said' }
          } catch (e) {
            return { roomId: room.id, error: e.message }
          }
        }

        if (action === 'close') {
          try {
            const { summary, transcript } = await closeRoom(cfg, room, fetch, cancelSignal(exec))
            return { roomId: room.id, summary, text: transcript }
          } catch (e) {
            return { roomId: room.id, error: `收场失败：${e.message}` }
          }
        }

        return { error: `action ${action} 没有对应的处理分支（不应到达）。` }
      },
    }),
  )
}
