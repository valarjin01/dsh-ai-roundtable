/**
 * 客户端半侧：设置 → 多AI圆桌会议
 *
 * 这是浏览器 bundle，必须遵守 DSH 的模块契约：
 *   - 顶层不能有 import / export
 *   - 加载时调用 window.__ModuleLoader__.load({ id, factory })
 *   - react 只能从 factory(require) 拿
 *
 * 页面本身用原生 DOM 渲染（不写 JSX，也就不需要构建工具）。
 */
;(function () {
  // 第一行就打印：能证明 bundle 至少被浏览器取到了
  console.info('[roundtable] client bundle fetched')
  const CSS = `
.rt-wrap{max-width:720px;padding:4px 0 40px;font-size:13px}
.rt-banner{padding:10px 14px;border-radius:10px;background:rgba(77,107,254,.06);border:1px solid rgba(77,107,254,.16);color:var(--dsw-alias-label-secondary);line-height:1.7;margin-bottom:16px}
.rt-banner strong{color:var(--dsw-alias-label-primary)}
.rt-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;margin-bottom:14px}
.rt-card.plain{background:var(--dsw-alias-bg-layer-2);border-color:transparent}
.rt-title{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;margin-bottom:12px}
.rt-title .grow{flex:1}
.rt-btn{height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.rt-btn:hover{background:var(--dsw-alias-bg-hover)}
.rt-btn.pri{background:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:transparent;color:#fff;font-weight:500}
.rt-btn.pri:hover{filter:brightness(1.06)}
.rt-btn.danger{color:var(--dsw-alias-state-danger,#e5484d)}
.rt-btn:disabled{opacity:.5;cursor:default}
.rt-row{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:10px 12px;margin-bottom:10px}
.rt-row.two{grid-template-columns:1fr 1fr}
.rt-f{display:flex;flex-direction:column;gap:4px;min-width:0}
.rt-f label{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.rt-f input,.rt-f select{width:100%;height:28px;padding:0 8px;font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base,transparent);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none}
.rt-f input:focus,.rt-f select:focus{border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.rt-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.6;margin-top:6px}
.rt-seat{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;margin-bottom:10px}
.rt-shead{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.rt-sname{font-weight:600;font-size:12.5px}
.rt-badge{font-size:10.5px;padding:1px 7px;border-radius:999px;line-height:16px}
.rt-badge.ok{color:#0f7b3f;background:rgba(18,161,80,.1)}
.rt-badge.miss{color:#a15c00;background:rgba(224,150,0,.12)}
.rt-think{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.rt-think select{height:22px;width:auto;padding:0 4px;font-size:11px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}
.rt-keyrow{display:flex;gap:6px}
.rt-keyrow input{flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.rt-styles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.rt-style{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:9px 10px;cursor:pointer}
.rt-style:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-style.on{border-color:var(--dsw-alias-state-business-primary,#4d6bfe);background:rgba(77,107,254,.05)}
.rt-style .t{font-weight:600;font-size:12px}
.rt-style .d{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px;line-height:1.5}
.rt-style .m{font-size:10.5px;color:var(--dsw-alias-label-tertiary);margin-top:5px}
.rt-lock{margin-top:10px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.rt-lock span{color:var(--dsw-alias-label-tertiary);margin-left:6px}
.rt-checks{display:grid;grid-template-columns:1fr 1fr;gap:6px 14px}
.rt-check{display:flex;align-items:center;gap:7px;font-size:12px}
.rt-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.rt-msg{font-size:11.5px;margin-left:8px}
.rt-msg.ok{color:#0f7b3f}
.rt-msg.err{color:var(--dsw-alias-state-danger,#e5484d)}
.rt-empty{padding:24px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px}
`

  const STYLES = [
    { id: 'debate', t: '辩论', d: '两方对垒，逼出最强论证，不许和稀泥', temp: 0.7 },
    { id: 'brainstorm', t: '头脑风暴', d: '先求量，禁止否定，最后才排序', temp: 1.0 },
    { id: 'redteam', t: '红队', d: '只找失败路径、隐藏假设和滥用场景', temp: 0.8 },
    { id: 'postmortem', t: '复盘', d: '还原时间线，分清根因和诱因', temp: 0.6 },
    { id: 'socratic', t: '苏格拉底', d: '只提问和澄清定义，不给结论', temp: 0.7 },
    { id: 'decision', t: '决策', d: '收敛到可执行选项，给出取舍判据', temp: 0.7 },
  ]

  function injectCss() {
    if (document.querySelector('style[data-plugin-css="dsh-roundtable"]')) return
    const el = document.createElement('style')
    el.setAttribute('data-plugin-css', 'dsh-roundtable')
    el.textContent = CSS
    document.head.appendChild(el)
  }

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

  async function api(path, options) {
    const res = await fetch('/dsh-roundtable' + path, options)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status)
    return data
  }

  /** 把服务端配置变成可编辑草稿：apiKey 永远从空开始，靠 placeholder 说明已配置。 */
  function toDraft(config) {
    return JSON.parse(
      JSON.stringify({
        ...config,
        participants: config.participants.map((p) => ({ ...p, apiKey: '' })),
      }),
    )
  }

  function render(root, state) {
    const d = state.draft
    const cfg = state.config
    root.innerHTML = `
<div class="rt-wrap">
  <div class="rt-banner">
    <strong>这里没有主持人兜底。</strong><br>
    AI 们会吵架，会互相拆台，最后谁也不服谁。<br>
    <strong>那正好。</strong>
  </div>

  <div class="rt-card">
    <div class="rt-title">席位 <span class="grow"></span>
      <button class="rt-btn" data-act="add-seat">+ 添加席位</button>
    </div>
    ${d.participants
      .map(
        (p, i) => `
      <div class="rt-seat">
        <div class="rt-shead">
          <span class="rt-sname">${esc(p.name || '未命名')}</span>
          <span class="rt-badge ${p.hasKey || p.apiKey ? 'ok' : 'miss'}">${p.hasKey || p.apiKey ? '已配置' : '缺 key'}</span>
          <span class="rt-think">协议
            <select data-i="${i}" data-f="kind">
              <option value="auto"${(p.kind ?? 'auto') === 'auto' ? ' selected' : ''}>自动</option>
              <option value="openai"${p.kind === 'openai' ? ' selected' : ''}>OpenAI</option>
              <option value="anthropic"${p.kind === 'anthropic' ? ' selected' : ''}>Claude</option>
            </select>
          </span>
          <span class="rt-think">思考
            <select data-i="${i}" data-f="thinking">
              <option value="auto"${p.thinking === 'auto' ? ' selected' : ''}>自动</option>
              <option value="on"${p.thinking === 'on' ? ' selected' : ''}>开启</option>
              <option value="off"${p.thinking === 'off' ? ' selected' : ''}>关闭</option>
            </select>
          </span>
          <span class="grow" style="flex:1"></span>
          <button class="rt-btn" data-act="test" data-i="${i}">测试连接</button>
          <button class="rt-btn danger" data-act="del" data-i="${i}">删除</button>
        </div>
        <div class="rt-row">
          <div class="rt-f"><label>名称</label><input data-i="${i}" data-f="name" value="${esc(p.name)}"></div>
          <div class="rt-f"><label>接口地址</label><input data-i="${i}" data-f="baseUrl" value="${esc(p.baseUrl)}"></div>
          <div class="rt-f"><label>模型</label><input data-i="${i}" data-f="model" value="${esc(p.model)}"></div>
        </div>
        <div class="rt-row two">
          <div class="rt-f"><label>API Key</label>
            <div class="rt-keyrow">
              <input type="password" data-i="${i}" data-f="apiKey" value="" placeholder="${p.hasKey ? '已配置 ' + esc(p.keyHint) + '，留空不修改' : 'sk-... 或 ark-...'}">
            </div>
          </div>
          <div class="rt-f"><label>人设（写进系统提示词）</label><input data-i="${i}" data-f="persona" value="${esc(p.persona)}"></div>
        </div>
        <div class="rt-hint" data-status="${i}"></div>
      </div>`,
      )
      .join('')}
    <div class="rt-hint">留空 key 的席位会自动跳过。<strong>思考</strong>关闭后这条回复通常快 3–4 倍、省一半 token，代价是推理深度下降。</div>
  </div>

  <div class="rt-card">
    <div class="rt-title">探讨规则</div>
    <div class="rt-row">
      <div class="rt-f"><label>调度员</label>
        <select data-f="moderator">
          ${d.participants
            .filter((p) => p.hasKey || p.apiKey)
            .map((p) => `<option${p.name === d.moderator ? ' selected' : ''}>${esc(p.name)}</option>`)
            .join('') || '<option>（还没有可用席位）</option>'}
        </select>
      </div>
      <div class="rt-f"><label>最多几轮</label><input type="number" min="1" max="6" data-f="maxRounds" value="${d.maxRounds}"></div>
      <div class="rt-f"><label>单次字数上限</label><input type="number" min="80" max="1200" data-f="maxWordsPerTurn" value="${d.maxWordsPerTurn}"></div>
    </div>
    <label class="rt-check"><input type="checkbox" data-f="blindFirstRound"${d.blindFirstRound !== false ? ' checked' : ''}> 首轮互不可见</label>
    <div class="rt-hint">开着的时候，每人第一次开口前都看不到别人，避免观点趋同。关掉就按顺序接力——更快，但容易互相附和。</div>
    <div class="rt-lock">🔒 模型不许替我下结论 <span>这条写在提示词里，不提供开关</span></div>
  </div>

  <div class="rt-card">
    <div class="rt-title">讨论风格</div>
    <div class="rt-styles">
      ${STYLES.map(
        (s) => `
        <div class="rt-style ${d.style === s.id ? 'on' : ''}" data-act="style" data-id="${s.id}">
          <div class="t">${s.t}</div>
          <div class="d">${s.d}</div>
          <div class="m">推荐温度 ${s.temp}</div>
        </div>`,
      ).join('')}
    </div>
  </div>

  <div class="rt-card plain">
    <div class="rt-title">预算与安全</div>
    <div class="rt-row two">
      <div class="rt-f"><label>温度</label><input type="number" step="0.1" min="0" max="2" data-f="temperature" value="${d.temperature}"></div>
      <div class="rt-f"><label>单次超时（秒）</label><input type="number" min="10" data-f="timeoutSec" value="${Math.round(d.timeoutMs / 1000)}"></div>
    </div>
    <div class="rt-hint">预估：${(() => {
      const n = d.participants.filter((p) => p.hasKey || p.apiKey).length
      return `${n} 席位 × ${d.maxRounds} 轮 + 1 次记录 = ${n * d.maxRounds + 1} 次调用`
    })()}</div>
    <div class="rt-hint">密钥存在 <code>~/.dsh/roundtable.json</code>（权限 600），只在本机使用；页面拿到的永远是掩码，不会回显明文。</div>
  </div>

  <div class="rt-foot">
    <span class="rt-msg" id="rt-msg"></span>
    <button class="rt-btn" data-act="reload">还原</button>
    <button class="rt-btn pri" data-act="save">保存</button>
  </div>
</div>`
  }

  function mount(root) {
    let state = null
    let busy = false

    const msg = (text, kind) => {
      const el = root.querySelector('#rt-msg')
      if (el) {
        el.textContent = text
        el.className = 'rt-msg ' + (kind || '')
      }
    }

    const paint = () => render(root, state)

    const load = async () => {
      root.innerHTML = '<div class="rt-empty">读取配置…</div>'
      try {
        const { config } = await api('/config')
        state = { config, draft: toDraft(config) }
        paint()
      } catch (e) {
        root.innerHTML = `<div class="rt-empty">读取失败：${esc(e.message)}</div>`
      }
    }

    root.addEventListener('input', (e) => {
      const t = e.target
      const f = t.dataset && t.dataset.f
      if (!f || !state) return
      if (t.type === 'checkbox') {
        state.draft[f] = t.checked
        return
      }
      if (t.dataset.i !== undefined) {
        const idx = Number(t.dataset.i)
        const seat = state.draft.participants[idx]
        if (seat) seat[f] = t.value
        if (f === 'apiKey') {
          const head = t.closest('.rt-seat')?.querySelector('.rt-badge')
          if (head) {
            const filled = String(t.value).trim().length > 0 || seat?.hasKey
            head.textContent = filled ? (seat?.hasKey ? '已配置' : '待保存') : '缺 key'
            head.className = 'rt-badge ' + (filled ? 'ok' : 'miss')
          }
        }
      } else if (f === 'timeoutSec') {
        state.draft.timeoutMs = Number(t.value) * 1000
      } else if (f === 'maxRounds' || f === 'maxWordsPerTurn' || f === 'temperature') {
        state.draft[f] = Number(t.value)
      } else {
        state.draft[f] = t.value
      }
    })

    root.addEventListener('change', (e) => {
      const t = e.target
      if (t.dataset && t.dataset.f && t.dataset.i !== undefined && state) {
        state.draft.participants[Number(t.dataset.i)][t.dataset.f] = t.value
      }
    })

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]')
      if (!btn || !state || busy) return
      const act = btn.dataset.act
      const i = btn.dataset.i !== undefined ? Number(btn.dataset.i) : -1

      if (act === 'add-seat') {
        state.draft.participants.push({ name: '新席位', baseUrl: 'https://', model: '', persona: '', apiKey: '', thinking: 'auto', hasKey: false })
        return paint()
      }
      if (act === 'del') {
        state.draft.participants.splice(i, 1)
        return paint()
      }
      if (act === 'style') {
        const id = btn.dataset.id
        state.draft.style = id
        const s = STYLES.find((x) => x.id === id)
        if (s) state.draft.temperature = s.temp
        return paint()
      }
      if (act === 'reload') return load()

      if (act === 'test') {
        const slot = root.querySelector(`[data-status="${i}"]`)
        if (slot) {
          slot.textContent = '连接中…'
          slot.className = 'rt-hint'
        }
        try {
          const seat = state.draft.participants[i] ?? {}
          const r = await api('/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              index: i,
              apiKey: seat.apiKey ?? '',
              baseUrl: seat.baseUrl ?? '',
              model: seat.model ?? '',
              thinking: seat.thinking ?? 'auto',
            }),
          })
          if (slot) {
            slot.textContent = r.ok ? `连接正常，${r.ms} ms` : `失败：${r.error}`
            slot.className = 'rt-hint ' + (r.ok ? 'rt-msg ok' : 'rt-msg err')
          }
        } catch (err) {
          if (slot) {
            slot.textContent = '失败：' + err.message
            slot.className = 'rt-hint rt-msg err'
          }
        }
        return
      }

      if (act === 'save') {
        busy = true
        btn.disabled = true
        msg('保存中…')
        try {
          const { config } = await api('/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.draft),
          })
          state = { config, draft: toDraft(config) }
          paint()
          msg('已保存，立即生效', 'ok')
        } catch (err) {
          msg('保存失败：' + err.message, 'err')
        } finally {
          busy = false
        }
      }
    })

    load()
  }


// ── 设置导航图标 ─────────────────────────────────────────────
// DSH 的设置导航图标是按分区 id 硬编码的白名单 + 兜底齿轮，第三方分区没有图标入口。
// 所以只能在 DOM 层补：给目标行打一个 React 从不 diff 的 data-* 标记，
// 再用 CSS 盖住齿轮、用 mask 画出我们的字形。不替换任何节点（换节点会让 React 卸载时崩）。
const NAV_STYLE = 'dsh-roundtable/nav-icon.css'
const NAV_MARK = 'data-dsh-roundtable-nav'
const NAV_PANEL = '[data-shortcut-modal="settings"]'
const NAV_GLYPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <circle cx="8" cy="8.6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="8" cy="1.9" r="1.5" fill="currentColor"/>
  <circle cx="2.9" cy="12.3" r="1.5" fill="currentColor"/>
  <circle cx="13.1" cy="12.3" r="1.5" fill="currentColor"/>
</svg>`

function svgMaskUri(svg) {
  const src = String(svg || '').trim()
  if (!src) return ''
  const namespaced = /<svg[^>]*\sxmlns=/i.test(src)
    ? src
    : src.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  return 'url("data:image/svg+xml,' + encodeURIComponent(namespaced.split('currentColor').join('#000')) + '")'
}

function installNavIcon(labelText) {
  const doc = typeof document === 'undefined' ? undefined : document
  const Observer = typeof MutationObserver === 'undefined' ? undefined : MutationObserver
  if (!doc || !Observer || !doc.body) return () => {}

  const glyph = svgMaskUri(NAV_GLYPH)
  if (!glyph) return () => {}

  if (!doc.querySelector('style[data-plugin-css="' + NAV_STYLE + '"]')) {
    const tag = doc.createElement('style')
    tag.dataset.plugin = 'dsh-roundtable'
    tag.dataset.pluginCss = NAV_STYLE
    tag.textContent = [
      '[' + NAV_MARK + '] [class*="navIcon"]{display:none}',
      '[' + NAV_MARK + ']::before{content:"";flex:none;width:16px;height:16px;background-color:currentColor;' +
        '-webkit-mask:' + glyph + ' center/16px 16px no-repeat;' +
        'mask:' + glyph + ' center/16px 16px no-repeat}',
    ].join('\n')
    doc.head.appendChild(tag)
  }

  const mark = (panel) => {
    const list = panel.querySelector('[class*="navList"]')
    if (!list) return
    for (const cell of list.querySelectorAll('[class*="navCell"]')) {
      if (cell.getAttribute(NAV_MARK) !== null) continue
      if (cell.querySelector('[class*="navLabel"]')?.textContent === labelText) cell.setAttribute(NAV_MARK, '')
    }
  }

  let panelObserver
  let watched
  const sync = () => {
    const panel = doc.querySelector(NAV_PANEL)
    if (!panel) {
      panelObserver?.disconnect()
      panelObserver = undefined
      watched = undefined
      return
    }
    mark(panel)
    if (panel === watched) return
    panelObserver?.disconnect()
    watched = panel
    panelObserver = new Observer(() => mark(panel))
    panelObserver.observe(panel, { childList: true, subtree: true })
  }

  sync()
  const bodyObserver = new Observer(sync)
  bodyObserver.observe(doc.body, { childList: true })

  return () => {
    bodyObserver.disconnect()
    panelObserver?.disconnect()
  }
}

  window.__ModuleLoader__.load({
    id: 'dsh-ai-roundtable',
    factory: function (require) {
      const React = require('react')

      // 必须定义在 factory 内：React 是从 require 拿的，外层作用域看不到。
      function Section() {
        const ref = React.useRef(null)
        React.useEffect(() => {
          if (!ref.current) return
          if (!ref.current.dataset.mounted) {
            ref.current.dataset.mounted = '1'
            mount(ref.current)
          }
        }, [])
        return React.createElement('div', { ref, className: 'rt-root' })
      }

      function apply(ctx) {
        // 这两行是排障用的：加载成功/失败都能在 DevTools Console 里看到。
        console.info('[roundtable] client bundle loaded')
        try {
          injectCss()
          ctx.slots.inject('settings.section', function* () {
            yield ctx.slots.register(
              { name: 'settings.section', id: 'roundtable-config', order: 40, label: () => '多AI圆桌会议' },
              Section,
            )
          })
          console.info('[roundtable] settings section registered')
          ctx.effect(() => installNavIcon('多AI圆桌会议'), 'roundtable: 设置导航图标')
        } catch (e) {
          console.error('[roundtable] 注册设置分区失败', e)
        }
      }

      return { name: 'roundtable-config', inject: ['slots'], apply }
    },
  })
})()
