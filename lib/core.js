/**
 * 圆桌核心逻辑（零依赖，可脱离 DSH 单独测试）
 *
 * 与「轮流发言」的区别：每轮先问调度员「接下来谁最该说」，由它点名，
 * 而不是机械地按顺序来过一遍。
 */

const DEFAULTS = {
  style: 'debate',
  maxRounds: 2,
  maxTokens: 800,
  temperature: 0.8,
  timeoutMs: 180000,
  maxWordsPerTurn: 300,
  blindFirstRound: true,
};

const SCHEDULER_BASE = `你是多模型圆桌的调度员。你中立、不发表观点，只决定接下来谁发言。

判断依据（按优先级）：
0. 人类主持刚说过话 —— 优先让能接住这句话的人回应；没人接得住就选最可能不同意的人。
1. 上一条发言点到了谁的名字、或批评了谁的观点 —— 被点名的人优先回应。
2. 谁掌握还没被说出来的关键证据或反例。
3. 谁的观点正在被误读 —— 让本人澄清优先于让别人替他辩护。
4. 同一人不连续发言两次，除非只有他能回应。
5. 如果讨论已经收敛、或者开始重复空转 —— 直接收场。
{styleRule}
只输出一行 JSON，不要解释、不要代码块：
{"next":"<参与者名字>","reason":"<不超过20字>"}
要收场时输出：{"next":"end","reason":"<不超过20字>"}`;

const SPEAKER_BASE = `你正在参加一场多模型圆桌，同席还有另外两个不同的 AI 和一位人类主持。
议题：{topic}

发言纪律：
1. 第一句先表态：同意或不同意谁的具体哪一点，点名并引用对方的关键词。
2. 然后只讲别人没讲到的：新证据、新反例、被忽略的约束。不复述、不客套、不总结全场。
3. 要纠正事实错误，直接说「这条不对，因为……」。
4. 允许说「我不同意，但证据不足」。
5. {limit} 字以内，短段落，不要写大标题。
6. 关键断言前标 [事实] / [推测] / [偏好]。没有来源的不要标成 [事实]，标了 [事实] 就要能说出处。
{styleRule}
你的席位：{name}｜定位：{persona}`;

const NOTE_BASE = `你是这场探讨的记录员，不是裁判。不要打分、不要裁决、不要给"建议采用哪个方案"。
你只做一件事：把这场讨论摊开，让人自己做判断。

本次讨论风格：{style}

写作要求：
1. 角度按新颖程度从高到低排，每条一行并标出是谁提的，重复的合并成一条。
2. 分歧部分每条固定三行：分歧点 / 甲方最强理由 / 乙方最强理由，并标明是事实分歧、价值分歧还是定义分歧。
3. 未解问题 1-4 条，按重要性排序。
4. 最后的"三个方向"是给人类的提问建议，不是行动建议。
5. 只输出下面四个标题及内容，不要输出这些要求本身，也不要加开场白。

## 出现了哪些角度

## 真正的分歧

## 还没人回答的问题

## 可以接着问的三个方向`;

/**
 * 讨论风格。每种风格同时改三处：调度员挑人的偏好、发言者的纪律、纪要的形状。
 * 只改措辞不改结构，是为了让同一套状态机跑所有风格。
 */
export const STYLES = {
  debate: {
    label: '辩论',
    hint: '两方对垒，逼出最强论证，不许和稀泥',
    schedule: '优先让立场被挑战的人回应；没人被点名时，选与上一条观点最相反的人。',
    speak: '你必须站在一个明确立场上：先把对方观点的最强版本复述一遍（steelman），再反驳。禁止「各有道理」「取决于场景」式收尾。',
    shape: `## 一句话结论

## 双方最强论点
（正方一条 / 反方一条，各不超过两行）

## 分歧的真正来源
（事实分歧 / 价值分歧 / 定义分歧，指明是哪一种）

## 什么证据能判胜负
（1-2 条可查证的事实）`,
  },
  brainstorm: {
    label: '头脑风暴',
    hint: '先求量，禁止否定，最后才排序',
    schedule: '优先让方向与上一条最不重合的人发言；没人有明显差异时，选还没说过的人。',
    speak: '这一轮只加不否：给出一个别人没提过的方向，并说清它反直觉在哪。不许评价别人的想法好坏，不许说「但是」。',
    shape: `## 方向清单
（按疯狂程度从低到高排序，每条一行）

## 值得先试的三个
（说明为什么是这三个）

## 明显不可行的
（列出并给淘汰理由，避免下一轮重复讨论）`,
  },
  redteam: {
    label: '红队',
    hint: '只找失败路径、隐藏假设和滥用场景',
    schedule: '优先让最能攻击上一条结论的人发言；同一人连续攻击两次以内允许。',
    speak: '你的任务不是评价好坏，是找它怎么失败：给出触发条件、失败路径、以及谁会被这个失败伤到。每条都要能复现，或能举出真实案例。',
    shape: `## 最可能失败的三个点
（每条：触发条件 / 失败路径 / 影响面）

## 被默认成立但没被验证的假设
（逐条列出）

## 如果只能先堵一个洞
（选一个，说明理由）`,
  },
  postmortem: {
    label: '复盘',
    hint: '还原时间线，分清根因和诱因',
    schedule: '优先让掌握时间线细节的人发言；其次是能区分根因与诱因的人。',
    speak: '用时间线说话：发生了什么、什么时候、谁做的决定。区分根因与诱因，区分可控与不可控。不评价人，只评价机制。',
    shape: `## 时间线
（按时间顺序，每条一行）

## 根因 / 诱因
（各一条，说明区别）

## 机制上该改什么
（2-3 条，要能落到流程或检查项）

## 下次怎么尽早发现
（一个可观测的信号）`,
  },
  socratic: {
    label: '苏格拉底',
    hint: '只提问和澄清定义，不给结论',
    schedule: '优先让定义最模糊的那个概念的责任人发言；其次是前提最可疑的人。',
    speak: '这一轮不给结论，只提问：追问一个关键概念的定义、一个被跳过的前提、或一个反例。问题要具体到对方必须回答，不能是「你怎么看」。',
    shape: `## 被追问的核心概念
（列出并指出各自的定义分歧）

## 尚未回答的问题
（按重要性排序）

## 目前能确定的最小结论
（一句话，只写各方都不否认的部分）`,
  },
  decision: {
    label: '决策',
    hint: '收敛到可执行选项，给出取舍判据',
    schedule: '优先让能给出可执行方案的人发言；其次是能指出方案代价的人。',
    speak: '把讨论往可执行上拉：给出一个具体选项，写清代价、前置条件、以及什么情况下它会失败。不要停在原则层面。',
    shape: `## 可选方案
（2-3 个，每个一行：做什么 / 代价 / 前置条件）

## 判据
（按重要性排序）

## 建议
（选一个，说明为什么不是另外几个）

## 第一步
（明天就能做的一件事）`,
  },
};

export const STYLE_IDS = Object.keys(STYLES);

function styleOf(style) {
  return STYLES[style] ?? STYLES.debate;
}

function schedulerSystem(room) {
  const s = styleOf(room.style);
  return SCHEDULER_BASE.replace('{styleRule}', `\n本次风格：${s.label}（${s.hint}）\n${s.schedule}\n`);
}

function speakerSystem(room, seat, limit) {
  const s = styleOf(room.style);
  return SPEAKER_BASE.replace('{styleRule}', `\n本次风格：${s.label}（${s.hint}）\n${s.speak}\n`)
    .replace('{topic}', room.topic)
    .replace('{limit}', String(limit))
    .replace('{name}', seat.name)
    .replace('{persona}', seat.persona);
}

function noteSystem(room) {
  return NOTE_BASE.replace('{style}', styleOf(room.style).label);
}

/** 房间表：进程内保存，按房间 id 取用。 */
const rooms = new Map();
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;

function sweep() {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS) rooms.delete(id);
  }
}

/** 把插件配置规整成运行时结构；缺字段不抛错，留到调用时给提示。 */
export function normalizeConfig(raw = {}) {
  const participants = (Array.isArray(raw.participants) ? raw.participants : [])
    .map((p) => ({
      name: String(p.name ?? '').trim(),
      baseUrl: String(p.baseUrl ?? '').trim().replace(/\/+$/, ''),
      model: String(p.model ?? '').trim(),
      apiKey: String(p.apiKey ?? '').trim() || (p.apiKeyEnv ? String(process.env[p.apiKeyEnv] ?? '').trim() : ''),
      persona: String(p.persona ?? '').trim() || '独立判断者',
      thinking: ['auto', 'on', 'off'].includes(p.thinking) ? p.thinking : 'auto',
      kind: ['auto', 'openai', 'anthropic'].includes(p.kind) ? p.kind : 'auto',
      // 供应商私有参数的透传口：盖不住的情况从这里兜底。
      extraBody: p.extraBody && typeof p.extraBody === 'object' ? p.extraBody : undefined,
    }))
    .filter((p) => p.name && p.baseUrl && p.model);

  const moderator = participants.find((p) => p.name === raw.moderator) ?? participants[0];
  return {
    participants,
    moderator,
    style: STYLES[raw.style] ? raw.style : DEFAULTS.style,
    maxRounds: Number.isFinite(raw.maxRounds) ? Math.max(1, Math.min(6, raw.maxRounds)) : DEFAULTS.maxRounds,
    maxTokens: Number.isFinite(raw.maxTokens) ? raw.maxTokens : DEFAULTS.maxTokens,
    temperature: Number.isFinite(raw.temperature) ? raw.temperature : DEFAULTS.temperature,
    timeoutMs: Number.isFinite(raw.timeoutMs) ? raw.timeoutMs : DEFAULTS.timeoutMs,
    maxWordsPerTurn: Number.isFinite(raw.maxWordsPerTurn) ? Math.max(80, raw.maxWordsPerTurn) : DEFAULTS.maxWordsPerTurn,
    blindFirstRound: raw.blindFirstRound !== false,
  };
}

/** 配置体检：返回人话错误，全部通过则返回 null。 */
export function checkConfig(cfg) {
  if (!cfg.participants.length) return '还没有配置参与者。请在 DSH 插件配置里填 participants（name / baseUrl / model / apiKey）。';
  const missing = cfg.participants.filter((p) => !p.apiKey).map((p) => p.name);
  if (missing.length) return `这些席位缺少 apiKey：${missing.join('、')}。填 apiKey，或者设置 apiKeyEnv 指向环境变量。`;
  return null;
}

/**
 * 把「思考模式」翻译成各家真实参数。
 * 不同供应商的开关名字完全不一样，所以这层必须集中在一处，不能散到调用点。
 * auto = 不动，跟随供应商默认。
 */
export function thinkingParams(seat, mode) {
  if (!mode || mode === 'auto') return {};
  const url = String(seat.baseUrl ?? '');
  if (/volces\.com/.test(url)) {
    // 火山方舟：thinking 显式开关
    return { thinking: { type: mode === 'on' ? 'enabled' : 'disabled' } };
  }
  if (/api\.openai\.com/.test(url)) {
    // OpenAI 推理模型：没有布尔开关，只有强度
    return { reasoning_effort: mode === 'on' ? 'medium' : 'minimal' };
  }
  // 其它网关不猜，交给 extraBody
  return {};
}

/**
 * 拼出 completions 地址，并容忍用户把完整 endpoint 也填进 baseUrl 的情况。
 * 常见错误：baseUrl = https://open.bigmodel.cn/api/paas/v4/chat/completions
 * 直接拼会变成 .../chat/completions/chat/completions → 404。
 */
export function completionsUrl(baseUrl) {
  const clean = String(baseUrl ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
  return `${clean}/chat/completions`
}

/**
 * 协议识别：Anthropic 与 OpenAI 兼容接口的差别不是"地址不同"，是整套请求/响应形状不同。
 * kind 显式指定优先；否则按域名猜（api.anthropic.com）。
 */
export function isAnthropic(seat) {
  if (seat.kind === 'anthropic') return true;
  if (seat.kind === 'openai') return false;
  return /anthropic\.com/i.test(String(seat.baseUrl ?? ''));
}

/** 拼接请求地址：OpenAI 兼容是 /chat/completions，Anthropic 是 /messages。 */
export function requestUrl(seat) {
  if (!isAnthropic(seat)) return completionsUrl(seat.baseUrl);
  const clean = String(seat.baseUrl ?? '').trim().replace(/\/+$/, '').replace(/\/messages$/i, '');
  return `${clean}/messages`;
}

/** Anthropic Messages API：system 是顶层字段，不放在 messages 里。 */
async function anthropicChat(cfg, seat, messages, fetchImpl, externalSignal) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system');
  const body = {
    model: seat.model,
    max_tokens: cfg.maxTokens,
    temperature: cfg.temperature,
    messages: turns.length ? turns : [{ role: 'user', content: '……' }],
    ...(system ? { system } : {}),
  };

  const timeout = AbortSignal.timeout(cfg.timeoutMs);
  const signal =
    externalSignal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([externalSignal, timeout])
      : timeout;

  const res = await fetchImpl(requestUrl(seat), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': seat.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = Array.isArray(data?.content) ? data.content : [];
  const text = content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('模型返回了空内容');
  return text;
}

async function chat(cfg, seat, messages, fetchImpl, externalSignal) {
  if (isAnthropic(seat)) return anthropicChat(cfg, seat, messages, fetchImpl, externalSignal);
  const res = await fetchImpl(completionsUrl(seat.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${seat.apiKey}`,
    },
    body: JSON.stringify({
      model: seat.model,
      messages,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      ...thinkingParams(seat, seat.thinking),
      // 席位级透传：放最后，允许覆盖上面的默认值
      ...(seat.extraBody ?? {}),
    }),
    // 外部取消（工具被中断）与自身超时合并；AbortSignal.any 不存在时退回超时。
    signal:
      externalSignal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([externalSignal, AbortSignal.timeout(cfg.timeoutMs)])
        : AbortSignal.timeout(cfg.timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${body.slice(0, 180)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('模型返回了空内容');
  return text.trim();
}

/** 把记录渲染成给模型看的文本。 */
/**
 * 首轮互不可见：每人各说一次之前，AI 之间看不到彼此的发言，只能看到人类说的话。
 * 这是独立性保证 —— 先看别人再开口，观点必然趋同。
 */
export function visibleEntries(room) {
  if (room.blindFirstRound === false) return room.transcript;
  const aiTurns = room.transcript.filter((m) => m.role === 'ai').length;
  if (aiTurns < room.participants.length) return room.transcript.filter((m) => m.role === 'human');
  return room.transcript;
}

export function renderTranscript(room, perMsg = 900) {
  return renderEntries(room.transcript, perMsg);
}

export function renderEntries(entries, perMsg = 900) {
  if (!entries.length) return '【还没有人发言】';
  const lines = entries.map((m) => {
    const who = m.role === 'human' ? `${m.name}（人类主持）` : m.name;
    return `[第${m.round}轮] ${who}：${m.text.slice(0, perMsg)}`;
  });
  return `【已有发言】\n\n${lines.join('\n\n')}`;
}

function schedulerMessages(room) {
  const names = room.participants.map((p) => p.name).join('、');
  return [
    { role: 'system', content: schedulerSystem(room) },
    {
      role: 'user',
      content: `议题：${room.topic}\n参与者：${names}\n\n${renderEntries(visibleEntries(room))}\n\n请决定下一位发言者。`,
    },
  ];
}

/** 从调度员的自由文本里抠出 JSON（模型偶尔会包代码块或加解释）。 */
export function parseDecision(raw, names) {
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  let obj;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const next = String(obj?.next ?? '').trim();
  const reason = String(obj?.reason ?? '').trim().slice(0, 60);
  if (!next) return null;
  if (next.toLowerCase() === 'end') return { next: 'end', reason };
  const hit = names.find((n) => n.toLowerCase() === next.toLowerCase());
  return hit ? { next: hit, reason } : null;
}

/** 兜底轮换：调度员抽风时不要卡死整场讨论。 */
function rotate(room) {
  const spoken = new Set(room.transcript.filter((m) => m.role === 'ai').map((m) => m.name));
  return room.participants.find((p) => !spoken.has(p.name))?.name ?? room.participants[0].name;
}

/**
 * 开一间房。
 * @param cfg - normalizeConfig 的产物
 * @param topic - 议题
 * @param opts - { maxRounds }
 */
export function openRoom(cfg, topic, opts = {}) {
  sweep();
  const clean = String(topic ?? '').trim();
  if (!clean) throw new Error('议题不能为空');
  const id = `rt-${Math.random().toString(36).slice(2, 6)}`;
  const room = {
    id,
    topic: clean,
    participants: cfg.participants,
    moderator: cfg.moderator,
    maxRounds: Number.isFinite(opts.maxRounds) ? Math.max(1, Math.min(6, opts.maxRounds)) : cfg.maxRounds,
    style: STYLES[opts.style] ? opts.style : cfg.style,
    blindFirstRound: opts.blindFirstRound ?? cfg.blindFirstRound,
    transcript: [],
    createdAt: Date.now(),
  };
  rooms.set(id, room);
  return room;
}

export function getRoom(roomId) {
  sweep();
  return rooms.get(String(roomId ?? '').trim());
}

export function listRoomIds() {
  sweep();
  return [...rooms.keys()];
}

/** 当前轮次：每人各说一次算一轮。 */
export function currentRound(room) {
  const aiTurns = room.transcript.filter((m) => m.role === 'ai').length;
  return Math.floor(aiTurns / room.participants.length) + 1;
}

/**
 * 走一步：调度员点名 → 被点名者发言。
 * @returns {{done:boolean, speaker?:string, text?:string, reason?:string, round?:number, error?:string}}
 */
export async function nextTurn(cfg, room, fetchImpl = fetch, signal) {
  const aiTurns = room.transcript.filter((m) => m.role === 'ai').length;
  if (aiTurns >= room.participants.length * room.maxRounds) {
    return { done: true, reason: `已经说满 ${room.maxRounds} 轮` };
  }

  const names = room.participants.map((p) => p.name);
  const blind = aiTurns < room.participants.length;
  let decision = null;
  let schedulerNote = '';

  if (blind) {
    // 首轮：不调调度员。大家都看不到别人，点名没有意义，还白花一次调用。
    schedulerNote = '首轮互不可见，按轮换';
  } else {
    try {
      const raw = await chat(cfg, room.moderator, schedulerMessages(room), fetchImpl, signal);
      decision = parseDecision(raw, names);
      if (!decision) schedulerNote = '调度员输出无法解析，按轮换兜底';
    } catch (e) {
      schedulerNote = `调度员调用失败（${e.message}），按轮换兜底`;
    }
  }

  if (decision?.next === 'end') {
    return { done: true, reason: decision.reason || '调度员判断讨论已收敛' };
  }

  const speakerName = decision?.next ?? rotate(room);
  const seat = room.participants.find((p) => p.name === speakerName) ?? room.participants[0];

  const messages = [
    {
      role: 'system',
      content: speakerSystem(room, seat, cfg.maxWordsPerTurn ?? DEFAULTS.maxWordsPerTurn),
    },
    {
      role: 'user',
      content: (() => {
        const seen = visibleEntries(room);
        const head = renderEntries(seen);
        if (!seen.some((m) => m.role === 'ai')) {
          return `${head}\n\n首轮互不可见：你还没看到任何人的发言。直接给出你的判断、三条理由、以及你最可能错在哪。不要假设别人说过什么，也不要虚构反方观点。`;
        }
        return `${head}\n\n现在轮到你（${seat.name}）发言。直接输出发言内容，不要重复自己的席位名。`;
      })(),
    },
  ];

  const round = currentRound(room);
  let text;
  try {
    text = await chat(cfg, seat, messages, fetchImpl, signal);
  } catch (e) {
    // 失败也要进记录：后面的人才有机会针对这条说「这个数据存疑」。
    text = `[调用失败] ${e.message}`;
    room.transcript.push({ name: seat.name, role: 'ai', text, round });
    return {
      done: false,
      speaker: seat.name,
      text,
      reason: decision?.reason || schedulerNote || '按轮换',
      round,
      error: e.message,
    };
  }

  room.transcript.push({ name: seat.name, role: 'ai', text, round });
  return {
    done: false,
    speaker: seat.name,
    text,
    reason: decision?.reason || schedulerNote || '按轮换',
    round,
  };
}

/** 让人（或主持 AI）插一句话，下一轮所有人都会看到。 */
export function sayInRoom(room, text, name = '人类主持') {
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('插话内容不能为空');
  room.transcript.push({ name, role: 'human', text: clean, round: currentRound(room) });
  return room.transcript.length;
}

/** 收场：出纪要。 */
export async function closeRoom(cfg, room, fetchImpl = fetch, signal) {
  if (!room.transcript.length) return { summary: '还没有人发言。', transcript: renderTranscript(room) };
  const messages = [
    { role: 'system', content: noteSystem(room) },
    { role: 'user', content: `议题：${room.topic}\n\n${renderTranscript(room, 1200)}` },
  ];
  let summary;
  try {
    summary = await chat(cfg, room.moderator, messages, fetchImpl, signal);
  } catch (e) {
    summary = `[纪要生成失败] ${e.message}`;
  }
  return { summary, transcript: renderTranscript(room) };
}

export function dropRoom(roomId) {
  return rooms.delete(String(roomId ?? '').trim());
}
