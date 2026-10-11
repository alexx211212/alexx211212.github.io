/* ZaiChat v16 — Z.ai API: прямые запросы к chat.z.ai, ретраи, автоисправление */
export const ZAI_BASE = 'https://chat.z.ai';
export const FE_VERSION = 'prod-fe-1.1.98';
export const AGENT_MODELS = ['general_agent', 'write', 'analysis', 'web_dev', 'intern', 'ppt_agent'];

export const FALLBACK_MODELS = [
  { id: 'glm-5.3', name: 'GLM 5.3' },
  { id: 'x-preview-l', name: 'GLM 5.3 Flash' },
  { id: 'glm-5.2', name: 'GLM 5.2' },
  { id: 'glm-4.7', name: 'GLM 4.7' },
  { id: 'GLM-5-Turbo', name: 'GLM 5-Turbo' },
  { id: 'glm-4.6v', name: 'GLM 4.6V' },
  { id: 'deep-research', name: 'Z1-Rumination' },
  { id: 'zero', name: 'Z1-32B' }
];

function headers(token, extra) {
  const h = { Accept: 'application/json', 'X-FE-Version': FE_VERSION, ...(extra || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

export function isNetworkError(e) {
  return !!e && (e.name === 'TypeError' || /network|failed|fetch|timeout/i.test(String(e.message || '')));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Прогрев WAF-защиты chat.z.ai (Aliyun): без cookies acw_tc POST-запросы
   блокируются с 405 («сервер не отвечает»). Лёгкий GET с credentials:'include'
   получает и сохраняет cookies — после этого POST проходит. */
let warmed = false;
export async function warmup(force) {
  if (warmed && !force) return;
  warmed = true;
  try {
    await fetch(ZAI_BASE + '/api/v1/auths/', { credentials: 'include', headers: headers(null) });
  } catch (_) {}
}

/** fetch с ретраями: 3 попытки, задержки 0.8s/2s. Бросает {overloaded:true} при 429/503 */
export async function zaiFetch(path, opts = {}, token = null, retries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let ctrl = null, timer = null;
    try {
      ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort('timeout'), opts.timeoutMs || 25000);
      const res = await fetch(ZAI_BASE + path, { ...opts, credentials: 'include', headers: headers(token, opts.headers), signal: opts.signal || ctrl.signal });
      if (res.status === 429 || res.status === 503 || res.status === 502) {
        const e = new Error('overloaded'); e.overloaded = true; e.status = res.status;
        if (attempt < retries) { await sleep(1200 * (attempt + 1) * (attempt + 1)); continue; }
        throw e;
      }
      if (res.status === 403 || res.status === 405) { const e = new Error('waf ' + res.status); e.waf = true; throw e; }
      return res;
    } catch (e) {
      if (opts.signal && opts.signal.aborted) throw e;
      lastErr = e;
      if (e.overloaded) throw e;
      if (attempt < retries) { await sleep(800 + attempt * 1200); continue; }
    } finally { try { if (timer) clearTimeout(timer); } catch (_) {} }
  }
  throw lastErr || new Error('network');
}

export async function jsonOrThrow(res) {
  if (!res.ok) {
    let msg = 'Z.ai ответил ошибкой ' + res.status;
    try { const d = await res.json(); if (d && d.detail) msg = typeof d.detail === 'string' ? d.detail : msg; } catch (_) {}
    const e = new Error(msg); e.status = res.status;
    if (res.status === 401) e.auth = true;
    throw e;
  }
  return res.json();
}

/** Вход по токену ИЛИ гостевой вход (token=null) */
export async function tokenLogin(token = null) {
  const d = await jsonOrThrow(await zaiFetch('/api/v1/auths/', {}, token));
  if (!d || !d.token) throw new Error('Z.ai не вернул токен сеанса');
  return { token: d.token, id: d.id || '', name: d.name || 'Пользователь', email: d.email || '', role: d.role || 'guest', avatar: d.profile_image_url || null };
}

export async function fetchModels(token) {
  try {
    const d = await jsonOrThrow(await zaiFetch('/api/models', {}, token));
    const list = Array.isArray(d) ? d : (d && d.data) || [];
    const clean = list.filter(m => m && m.id && m.name).map(m => ({ id: m.id, name: m.name }));
    return clean.length ? clean : FALLBACK_MODELS;
  } catch (_) { return FALLBACK_MODELS; }
}

export async function fetchChats(token, maxPages = 8) {
  const out = []; const seen = new Set();
  for (let p = 1; p <= maxPages; p++) {
    let arr = [];
    try {
      const d = await jsonOrThrow(await zaiFetch('/api/v1/chats/?page=' + p, {}, token));
      arr = Array.isArray(d) ? d : [];
    } catch (e) { if (p === 1) throw e; break; }
    let fresh = 0;
    for (const c of arr) if (c && c.id && !seen.has(c.id)) { seen.add(c.id); out.push(c); fresh++; }
    if (!fresh) break;
  }
  out.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
  return out;
}

export async function deleteChat(token, id) {
  try { await zaiFetch('/api/v1/chats/' + id, { method: 'DELETE' }, token); } catch (_) {}
}

export async function fetchChat(token, id) {
  const d = await jsonOrThrow(await zaiFetch('/api/v1/chats/' + id, {}, token, 1));
  return d;
}

export async function uploadFile(token, blob, name, mime) {
  const fd = new FormData();
  fd.append('file', blob, name);
  const res = await zaiFetch('/api/v1/files/', { method: 'POST', body: fd, headers: {} }, token, 1);
  if (!res.ok) throw new Error('Не удалось загрузить файл (' + res.status + ')');
  const d = await res.json();
  if (!d || !d.id) throw new Error('Z.ai не принял файл');
  return { id: d.id, name: d.filename || name, type: (mime || '').startsWith('image/') ? 'image' : 'file', url: '/api/v1/files/' + d.id + '/content' };
}

/** Создать/обновить чат в аккаунте (для синхронизации и шеринга) */
export async function saveChat(token, { zaiId = null, title, model, messages }) {
  const body = {
    chat: {
      title: String(title || 'Новый чат').slice(0, 120),
      models: [model],
      messages: messages.slice(-60).map((m, i) => ({
        id: 'm' + i, role: m.role, content: m.content,
        parentId: i === 0 ? null : 'm' + (i - 1), childrenIds: [], timestamp: 0
      }))
    }
  };
  try {
    const res = await zaiFetch(zaiId ? '/api/v1/chats/' + zaiId : '/api/v1/chats/new', {
      method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }
    }, token, 0);
    if (!res.ok) return zaiId || null;
    const d = await res.json();
    return (d && d.id) || zaiId || null;
  } catch (_) { return zaiId || null; }
}

/** Поделиться чатом ссылкой (работает на офф сайте и в приложении) */
export async function shareChat(token, chatId) {
  const res = await zaiFetch('/api/v1/chats/' + chatId + '/share', {
    method: 'POST', body: JSON.stringify({}), headers: { 'Content-Type': 'application/json' }
  }, token, 0);
  if (!res.ok) { const e = new Error('share failed ' + res.status); e.status = res.status; throw e; }
  let d = null; try { d = await res.json(); } catch (_) {}
  const sid = (d && (d.share_id || d.id || d.slug)) || null;
  if (sid) return 'https://chat.z.ai/s/' + sid;
  return 'https://chat.z.ai/s/' + chatId;
}

/* ================= стриминг ================= */

export function isAgentModel(model) { return AGENT_MODELS.includes(model); }

/**
 * Стриминг ответа модели. thinking: 'off'|'low'|'medium'|'high'
 * cb: {onDelta(v), onReplace(v), onStatus(v), onTitle(v), onUsage({prompt,completion,total}), onError(msg), onEvent(seg)}
 * Возвращает {abort()}
 */
export function zaiStream({ token, model, messages, files, thinking, image, search, chatId }, cb) {
  const ctrl = new AbortController();
  const msgId = crypto.randomUUID();
  const body = {
    stream: true, model,
    messages: messages.map((m, i) => {
      const o = {
        id: i === messages.length - 1 ? msgId : 'h' + i,
        role: m.role, content: m.content,
        parentId: i === 0 ? null : 'h' + (i - 1), childrenIds: []
      };
      if (files && files.length && i === messages.length - 1) o.files = files;
      return o;
    }),
    params: {},
    features: {
      image_generation: image === true,
      web_search: search === true,
      auto_web_search: false,
      preview_mode: false,
      enable_thinking: thinking !== 'off',
      ...(thinking !== 'off' ? { reasoning_effort: thinking } : {})
    },
    variables: {},
    session_id: crypto.randomUUID(),
    chat_id: chatId || crypto.randomUUID(),
    id: msgId,
    current_user_message_id: null,
    current_user_message_parent_id: null,
    background_tasks: { title_generation: true, tags_generation: false }
  };

  (async () => {
    let attempt = 0, gotText = false, failMsg = null;
    await warmup(); // прогрев: cookies WAF, чтобы POST не получил 405
    while (attempt <= 2) {
      try {
        const res = await fetch(ZAI_BASE + '/api/v2/chat/completions', {
          method: 'POST', signal: ctrl.signal, credentials: 'include',
          headers: headers(token, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          let detail = 'Z.ai ответил ошибкой ' + res.status;
          let overloaded = false;
          try {
            const d = await res.json();
            if (d && d.detail) detail = typeof d.detail === 'string' ? d.detail : detail;
          } catch (_) {}
          if (res.status === 401) detail = 'Сессия Z.ai истекла. Войдите заново в настройках.';
          if (res.status === 403 && detail === 'Z.ai ответил ошибкой 403') detail = 'Модель недоступна для вашего уровня аккаунта.';
          if (res.status === 429 || res.status === 503 || res.status === 502) overloaded = true;
          if (res.status === 405) { // WAF: нет cookies — прогреваем и повторяем (само чинится)
            if (attempt < 2 && !ctrl.signal.aborted) {
              cb.onStatus && cb.onStatus('Защита сервера сработала — переподключаюсь (попытка ' + (attempt + 1) + '/3)…');
              await warmup(true); await sleep(700); attempt++; continue;
            }
          }
          if (/overload|busy|высокая нагрузка|too many|per-minute/i.test(detail)) overloaded = true;
          if (overloaded && attempt < 2 && !ctrl.signal.aborted) {
            cb.onStatus && cb.onStatus('Модель перегружена — пробую снова (попытка ' + (attempt + 1) + '/3)…');
            await sleep(2500 + attempt * 4000); attempt++; continue;
          }
          cb.onError && cb.onError(detail); return;
        }
        if (!res.body) { cb.onError && cb.onError('Стриминг не поддерживается браузером'); return; }

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '', sawAny = false, finished = false, hadErrorDetail = null;
        const handle = (line) => {
          const s = line.trim();
          if (!s.startsWith('data:')) return;
          const payload = s.slice(5).trim();
          if (!payload || payload === '[DONE]') return;
          let ev; try { ev = JSON.parse(payload); } catch (_) { return; }
          const type = ev.type || '', d = ev.data || {};
          if (type === 'chat:message:delta' || type === 'message') {
            if (typeof d.content === 'string' && d.content) { sawAny = true; gotText = true; cb.onDelta && cb.onDelta(d.content); }
          } else if (type === 'chat:message' || type === 'replace') {
            if (typeof d.content === 'string' && d.content) { sawAny = true; gotText = true; cb.onReplace && cb.onReplace(d.content); }
          } else if (type === 'status') {
            const v = (typeof d.description === 'string' && d.description) || (typeof d.content === 'string' && d.content) || (typeof d.message === 'string' && d.message) || '';
            if (v) { sawAny = true; cb.onStatus && cb.onStatus(v); }
          } else if (type === 'chat:title') {
            if (typeof d.title === 'string' && d.title) cb.onTitle && cb.onTitle(d.title);
          } else if (type === 'chat:completion' || type === 'chat:finish') {
            const err = d.error || (d.data && d.data.error) || null;
            if (err && err.detail) { hadErrorDetail = err.detail; sawAny = true; }
            const u = d.usage || null;
            if (u && typeof u === 'object') {
              const usage = {
                prompt: Number(u.prompt_tokens || 0),
                completion: Number(u.completion_tokens || 0),
                total: Number(u.total_tokens || (u.prompt_tokens || 0) + (u.completion_tokens || 0))
              };
              if (usage.total > 0) cb.onUsage && cb.onUsage(usage);
            }
          } else if (d && (d.questions || d.followup_questions || d.follow_up_questions)) {
            cb.onQuestions && cb.onQuestions(d.questions || d.followup_questions || d.follow_up_questions);
          } else if (type.indexOf('question') >= 0 || type.indexOf('follow') >= 0) {
            const q = d.questions || d.items || null;
            if (q) cb.onQuestions && cb.onQuestions(q);
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) handle(line);
        }
        if (buf) handle(buf);
        if (hadErrorDetail) { cb.onError && cb.onError(hadErrorDetail); return; }
        if (!gotText) {
          if (!sawAny && attempt < 2 && !ctrl.signal.aborted) {
            cb.onStatus && cb.onStatus('Сервер не ответил — переподключаюсь (попытка ' + (attempt + 1) + '/3)…');
            await sleep(1500 + attempt * 2500); attempt++; continue;
          }
          cb.onError && cb.onError(sawAny ? 'Z.ai не вернул текст ответа. Попробуйте другую модель.' : 'Сервер не отвечает. Попробуйте ещё раз — приложение повторит автоматически.');
          return;
        }
        finished = true; cb.onDone && cb.onDone(); return;
      } catch (e) {
        if (ctrl.signal.aborted) { cb.onDone && cb.onDone(); return; }
        if (attempt < 2) {
          cb.onStatus && cb.onStatus('Соединение прервалось — восстанавливаю (попытка ' + (attempt + 1) + '/3)…');
          await sleep(1500 + attempt * 3000); attempt++; continue;
        }
        cb.onError && cb.onError('Не удалось подключиться к chat.z.ai. Проверьте интернет и попробуйте ещё раз.');
        return;
      }
    }
  })();

  return { abort: () => ctrl.abort('user') };
}
