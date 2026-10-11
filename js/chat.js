/* ZaiChat v16 — чат: стриминг без блокировки других чатов, рендер, вложения, агент-панель */
import { zaiStream, uploadFile, saveChat, isAgentModel, isNetworkError } from './api.js';
import { renderMarkdown, plainExcerpt } from './md.js';
import { buildPptx } from './ppt.js';
import { getActive as activePlugins } from './plugins.js';
import * as store from './store.js';

const $ = id => document.getElementById(id);

export const state = {
  chatId: null, title: 'Новый чат', model: 'glm-5.3', mode: 'chat',
  messages: [], zaiId: null, dirty: false
};
export const pptMode = { on: false };

const running = new Map(); // chatId -> {abort, elapsed}
let thinkLevel = 'off';
let imgMode = false;
let renderTimer = null;
let pinnedBottom = true;
const IMG_RE = /(нарисуй|нарисовать|сгенерируй\s*(картин|изображени|фото|логотип|арт)|сделай\s*(картин|фото|изображени)|нарисуйте|draw\s|generate\s.*(image|picture|photo)|picture of|imagine|image of)/i;

/* ================= утилиты ================= */
export function toast(msg, ms = 2600) {
  const box = $('toast-box');
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, ms);
}

export function setThink(v) { thinkLevel = v; store.setThinkLevel(v); }
export function getThink() { return thinkLevel; }
export function setImgMode(v) { imgMode = v; store.setImgMode(v); updateFoot(); }
export function getImgMode() { return imgMode; }

export function updateFoot() {
  const badge = $('mode-badge');
  let m = (state.model && isAgentModel(state.model)) ? 'AGENT' : 'CHAT';
  if (pptMode.on) m = 'PPT';
  if (imgMode) m = 'IMAGE';
  badge.textContent = m;
  const hint = $('send-hint');
  const th = { off: '', low: 'LOW · быстрые размышления', medium: 'MEDIUM · глубокие размышления', high: 'HIGH · максимум качества' }[thinkLevel] || '';
  const parts = [];
  if (th) parts.push('🧠 ' + th);
  if (imgMode) parts.push('🎨 генерация изображений');
  if (pptMode.on) parts.push('📊 AI PPT');
  hint.textContent = parts.join(' · ');
}

/* ================= рендер сообщений ================= */
function msgEl(m, idx) {
  const div = document.createElement('div');
  div.className = 'msg ' + (m.role === 'user' ? 'user' : 'ai');
  div.dataset.idx = idx;
  if (m.role === 'user') {
    const b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = m.content || '(вложение)';
    div.appendChild(b);
    if (m.files && m.files.length) {
      const strip = document.createElement('div');
      strip.className = 'sources';
      for (const f of m.files) {
        const a = document.createElement('a');
        a.href = f.url.startsWith('/') ? 'https://chat.z.ai' + f.url : f.url;
        a.target = '_blank'; a.rel = 'noopener'; a.textContent = '📎 ' + (f.name || 'файл');
        strip.appendChild(a);
      }
      div.appendChild(strip);
    }
    return div;
  }
  // AI
  if (m.thinking) {
    const tb = document.createElement('div');
    tb.className = 'think-block';
    tb.innerHTML = '<div class="th-head">🧠 Размышления <span style="opacity:.6">▾</span></div><div class="think-body"></div>';
    tb.querySelector('.think-body').textContent = m.thinking;
    tb.querySelector('.th-head').addEventListener('click', () => tb.querySelector('.think-body').classList.toggle('collapsed'));
    div.appendChild(tb);
  }
  if (m.segments) {
    const log = document.createElement('div');
    log.className = 'tools-log';
    for (const seg of m.segments) {
      if (seg.t === 'tools') for (const tl of seg.v) {
        const c = document.createElement('div');
        c.className = 'tool-chip';
        c.innerHTML = '<b></b>';
        c.querySelector('b').textContent = tl.name;
        if (tl.detail) c.appendChild(document.createTextNode(' · ' + tl.detail));
        log.appendChild(c);
      }
    }
    if (log.children.length) div.appendChild(log);
  }
  if (m.sources && m.sources.length) {
    const s = document.createElement('div');
    s.className = 'sources';
    for (const src of m.sources.slice(0, 10)) {
      const a = document.createElement('a');
      a.href = src.url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = (src.host_name || 'источник') + (src.name && src.name !== src.host_name ? ' · ' + src.name : '');
      s.appendChild(a);
    }
    div.appendChild(s);
  }
  const b = document.createElement('div');
  b.className = 'bubble';
  const { html, slides } = renderMarkdown(m.content || '');
  b.innerHTML = html || '<p style="opacity:.5">…</p>';
  for (const holder of b.querySelectorAll('[data-slides]')) {
    try { holder.replaceWith(slidesView(JSON.parse(slides[+holder.dataset.slides]))); } catch (_) {}
  }
  for (const pre of b.querySelectorAll('pre')) {
    pre.addEventListener('long-press', () => {});
  }
  div.appendChild(b);
  if (m.usage && m.usage.total) {
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `токены: ${m.usage.total} (вход ${m.usage.prompt} / ответ ${m.usage.completion})`;
    div.appendChild(meta);
  }
  if (m.error) {
    const e = document.createElement('div');
    e.className = 'meta'; e.style.color = '#ff8080';
    e.textContent = '⚠ ' + m.error;
    div.appendChild(e);
  }
  if (m.done) {
    const act = document.createElement('div');
    act.className = 'msg-actions';
    const copy = document.createElement('button');
    copy.textContent = 'Копировать';
    copy.addEventListener('click', () => { copyText(m.content || ''); toast('Скопировано'); });
    act.appendChild(copy);
    const regen = document.createElement('button');
    regen.textContent = 'Переспросить';
    regen.addEventListener('click', () => regenerateFrom(idx));
    act.appendChild(regen);
    div.appendChild(act);
    if (m.followups && m.followups.length) {
      const fu = document.createElement('div');
      fu.className = 'followup-chips';
      for (const q of m.followups.slice(0, 3)) {
        const btn = document.createElement('button');
        btn.textContent = q;
        btn.addEventListener('click', () => window.__sendFromChip && window.__sendFromChip(q));
        fu.appendChild(btn);
      }
      div.appendChild(fu);
    }
  }
  return div;
}

function slidesView(deck) {
  const v = document.createElement('div');
  v.className = 'slides-view';
  const t = document.createElement('div');
  t.className = 'slide-title'; t.textContent = deck.title || 'Презентация';
  v.appendChild(t);
  for (const s of (deck.slides || []).slice(0, 12)) {
    const d = document.createElement('div');
    d.className = 'slide';
    d.innerHTML = '<h4></h4><ul></ul>';
    d.querySelector('h4').textContent = s.title || '';
    const ul = d.querySelector('ul');
    for (const b of (s.bullets || []).slice(0, 6)) { const li = document.createElement('li'); li.textContent = b; ul.appendChild(li); }
    v.appendChild(d);
  }
  const dl = document.createElement('button');
  dl.className = 'btn btn-secondary'; dl.style.marginTop = '6px';
  dl.textContent = '⬇ Скачать .pptx';
  dl.addEventListener('click', () => {
    const bytes = buildPptx({ title: deck.title || 'Презентация', slides: deck.slides || [], author: 'ZaiChat' });
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    downloadBlob(blob, (deck.title || 'presentation').replace(/[^\w\u0400-\u04FF -]/g, '').trim().slice(0, 60) + '.pptx');
    toast('PPTX сохраняется в «Загрузки»…');
  });
  v.appendChild(dl);
  return v;
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

function copyText(s) {
  try { navigator.clipboard.writeText(s); } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = s; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (_) {} ta.remove();
  }
}

export function renderAll() {
  const box = $('messages');
  box.innerHTML = '';
  state.messages.forEach((m, i) => box.appendChild(msgEl(m, i)));
  scrollToBottom(true);
  $('btn-scroll-down').hidden = true;
}

function relinkLast() {
  const box = $('messages');
  const last = box.lastElementChild;
  if (last && last.classList.contains('msg')) { last.remove(); }
  box.appendChild(msgEl(state.messages[state.messages.length - 1], state.messages.length - 1));
}

function scrollToBottom(instant) {
  const box = $('messages');
  pinnedBottom = true;
  box.scrollTo({ top: box.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
}

/* ================= вложения ================= */
export const pendingFiles = [];

async function compressImage(file) {
  try {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
    const bmp = await createImageBitmap(file);
    const max = 1600;
    let { width: w, height: h } = bmp;
    if (Math.max(w, h) > max) { const k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
    if (blob && blob.size < file.size) return new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    return file;
  } catch (_) { return file; }
}

export async function addFiles(fileList) {
  const arr = Array.from(fileList || []);
  if (!arr.length) return;
  for (const f of arr) {
    if (pendingFiles.length >= 6) { toast('Максимум 6 файлов'); break; }
    const item = { file: f, ready: false, uploaded: null, uploading: false };
    pendingFiles.push(item);
    renderAttachStrip();
    const cf = await compressImage(f);       // сжатие — устраняет лаги фото
    item.file = cf;
    const token = store.getUser()?.token;
    if (token) {
      item.uploading = true; renderAttachStrip();
      try { item.uploaded = await uploadFile(token, cf, cf.name || 'file', cf.type); }
      catch (e) { toast('Не удалось загрузить: ' + (cf.name || 'файл')); }
      item.uploading = false;
    }
    item.ready = true; renderAttachStrip();
  }
}

function renderAttachStrip() {
  const strip = $('attach-strip');
  strip.innerHTML = '';
  strip.hidden = pendingFiles.length === 0;
  pendingFiles.forEach((item, i) => {
    const d = document.createElement('div');
    d.className = 'attach-item';
    if (item.file && item.file.type && item.file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(item.file);
      d.appendChild(img);
    } else {
      d.textContent = '📄 ' + ((item.file && item.file.name) || 'файл').slice(0, 18);
    }
    if (item.uploading) { const u = document.createElement('div'); u.textContent = '…'; u.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);color:#fff'; d.appendChild(u); }
    const rm = document.createElement('button');
    rm.className = 'rm'; rm.textContent = '✕';
    rm.addEventListener('click', (e) => { e.stopPropagation(); pendingFiles.splice(i, 1); renderAttachStrip(); });
    d.appendChild(rm);
    strip.appendChild(d);
  });
}

/* ================= отправка ================= */
function systemPrompts() {
  const sys = [];
  for (const p of activePlugins()) if (p.systemPrompt) sys.push(String(p.systemPrompt));
  if (pptMode.on) sys.push('Ты — конструктор презентаций. Выдай презентацию СТРОГО одним блоком кода ```zai-slides с JSON {"title":"Название","slides":[{"title":"…","bullets":["…"],"notes":"…"}]}. 5-8 слайдов, 3-5 коротких тезисов на слайд.');
  return sys.join('\n\n');
}

export function isBusy(chatId) { return running.has(chatId || state.chatId); }

export function stopGeneration(chatId) {
  const r = running.get(chatId || state.chatId);
  if (r) { try { r.abort(); } catch (_) {} }
}

export async function send(text, { silent } = {}) {
  const chatId = state.chatId;
  if (!chatId) return;
  if (running.has(chatId)) { toast('В этом чате уже идёт генерация — можно писать в других чатах'); return; }

  text = String(text || '').trim();
  if (!text && !pendingFiles.length) return;

  // плагины: onBeforeSend (async-хуки, например погода/вики)
  let working = text;
  for (const p of activePlugins()) {
    if (typeof p.onBeforeSend === 'function') {
      try { const out = await p.onBeforeSend(working); if (typeof out === 'string' && out) working = out; } catch (_) {}
    }
  }
  for (const p of activePlugins()) {
    if (typeof p.transformInput === 'function') {
      try { const out = p.transformInput(working); if (typeof out === 'string' && out) working = out; } catch (_) {}
    }
  }

  const files = pendingFiles.map(f => f.uploaded).filter(Boolean);
  pendingFiles.length = 0;
  renderAttachStrip();
  $('imggen-tip').hidden = true;

  state.messages.push({ role: 'user', content: text, files, createdAt: Date.now() });
  const aiMsg = { role: 'ai', content: '', thinking: '', done: false, createdAt: Date.now() };
  state.messages.push(aiMsg);
  renderAll();
  persist();
  $('btn-send').disabled = true;

  const useCustom = store.getSettings().customApi && store.getSettings().apiKey;
  const runner = useCustom ? customStream(aiMsg) : zaiRunner(aiMsg, working, files);

  running.set(chatId, runner);
  updateSendButtons(chatId);
  startAgentPanel();
  try {
    await runner.promise;
  } finally {
    running.delete(chatId);
    updateSendButtons(chatId);
    stopAgentPanel();
    aiMsg.done = true;
    aiMsg.followups = makeFollowups(aiMsg.content);
    if (state.chatId === chatId) relinkLast();
    persist();
    notifyReady(aiMsg);
    $('btn-send').disabled = false;
    saveToAccount();
  }
}

function updateSendButtons(chatId) {
  const busy = running.has(chatId);
  $('btn-send').hidden = busy;
  $('btn-stop').hidden = !busy;
  $('btn-send').disabled = false;
}

function zaiRunner(aiMsg, text, files) {
  const history = state.messages.slice(0, -1).map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content || '' }));
  if (text) history[history.length - 1] = { role: 'user', content: text };
  const sys = systemPrompts();
  const msgs = sys ? [{ role: 'system', content: sys }, ...history] : history;

  let buf = '';
  let flushTimer = null;
  const chatId = state.chatId;
  const flush = (force) => {
    if (renderTimer && !force) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      aiMsg.content = buf;
      if (state.chatId === chatId) relinkLast();
      if (pinnedBottom) scrollToBottom(false);
    }, 110);
  };

  let statusEl = null;
  const runner = zaiStream({
    token: store.getUser()?.token,
    model: state.model,
    messages: msgs,
    files,
    thinking: thinkLevel,
    image: imgMode,
    search: false,
    chatId: state.zaiId || chatId
  }, {
    onDelta(v) { buf += v; flush(); },
    onReplace(v) { buf = v; flush(true); },
    onStatus(v) {
      statusEl = v;
      agentStatus(v);
      aiMsg.status = v;
      if (!buf) { aiMsg.content = ''; }
    },
    onTitle(v) { state.title = v.slice(0, 120); window.__onTitle && window.__onTitle(state.title); },
    onUsage(u) {
      aiMsg.usage = u;
      store.addUsage('zai', u);
      agentTokens(u);
      window.__onUsage && window.__onUsage();
    },
    onQuestions(qs) {
      if (Array.isArray(qs) && qs.length) aiMsg._questions = qs.map(String);
    },
    onError(msg) {
      aiMsg.error = msg;
      if (!buf) aiMsg.content = '';
      busyBanner(msg);
      flush(true);
    },
    onDone() { flush(true); }
  });

  const origPromise = runner.promise;
  runner.promise = origPromise.then(() => { aiMsg.content = buf; if (aiMsg._questions) aiMsg.followups = aiMsg._questions; });
  return runner;
}

/* --- свой API (OpenAI-совместимый) --- */
async function customStream(aiMsg) {
  const s = store.getSettings();
  const base = (s.apiBase || 'https://api.z.ai/api/paas/v4').replace(/\/+$/, '');
  const sys = systemPrompts();
  const msgs = [
    ...(sys ? [{ role: 'system', content: sys }] : []),
    ...state.messages.slice(0, -1).map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content || '' }))
  ];
  let buf = '';
  agentStatus('Запрос к своему API…');
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.apiKey },
      body: JSON.stringify({
        model: s.apiModel || 'glm-4.6',
        messages: msgs,
        stream: true,
        ...(thinkLevel !== 'off' ? { thinking: { type: thinkLevel } } : {})
      })
    });
    if (!res.ok) {
      let d = '';
      try { d = (await res.json()).error?.message || ''; } catch (_) {}
      aiMsg.error = 'Мой API: ошибка ' + res.status + (d ? ' — ' + d : '');
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let lb = '';
    const handle = line => {
      const t = line.trim();
      if (!t.startsWith('data:')) return;
      const p = t.slice(5).trim();
      if (!p || p === '[DONE]') return;
      try {
        const ev = JSON.parse(p);
        const d = ev.choices && ev.choices[0] && (ev.choices[0].delta || ev.choices[0].message);
        if (d && d.content) { buf += d.content; aiMsg.content = buf; if (state.chatId) relinkLast(); if (pinnedBottom) scrollToBottom(false); }
        if (ev.usage) { const u = { prompt: ev.usage.prompt_tokens || 0, completion: ev.usage.completion_tokens || 0, total: ev.usage.total_tokens || 0 }; aiMsg.usage = u; store.addUsage('custom', u); agentTokens(u); }
      } catch (_) {}
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lb += dec.decode(value, { stream: true });
      const lines = lb.split('\n'); lb = lines.pop() || '';
      for (const l of lines) handle(l);
    }
    if (lb) handle(lb);
    if (!buf) aiMsg.error = aiMsg.error || 'Пустой ответ от своего API';
  } catch (e) {
    aiMsg.error = 'Свой API: ' + (e.message || 'нет соединения');
  }
}

/* --- регенерация --- */
export function regenerateFrom(idx) {
  if (running.has(state.chatId)) { toast('Дождитесь окончания генерации'); return; }
  // удаляем всё с idx (ответ) и повторяем предыдущий вопрос
  const user = state.messages[idx - 1];
  if (!user || user.role !== 'user') return;
  state.messages.splice(idx - 1, 2);
  renderAll();
  persist();
  send(user.content);
}

/* --- followup-вопросы (как у агента на офф сайте) --- */
function makeFollowups(content) {
  const topic = plainExcerpt(content, 42).replace(/[?!.]+$/, '');
  return [
    'Подробнее про ' + (topic || 'это'),
    'Как применить на практике?',
    'Дай пример кода'
  ];
}

/* ================= агент-панель ================= */
let agentTimerInt = null, agentStart = 0, agentProg = 8;
function startAgentPanel() {
  const panel = $('agent-panel');
  const agent = isAgentModel(state.model);
  if (!agent) { panel.hidden = true; return; }
  panel.hidden = false;
  agentStart = Date.now(); agentProg = 8;
  $('agent-bar-fill').style.width = '8%';
  agentTimerInt = setInterval(() => {
    const sec = Math.floor((Date.now() - agentStart) / 1000);
    $('agent-timer').textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    const eta = agentProg < 40 ? '≈ ' + Math.max(1, Math.round((100 - agentProg) / 22)) + ' мин до готовности' : agentProg < 80 ? '≈ ' + Math.max(1, Math.round((100 - agentProg) / 45)) + ' мин до готовности' : 'скоро завершится';
    $('agent-eta').textContent = eta;
  }, 1000);
}
function agentStatus(text) {
  if ($('agent-panel').hidden) { $('agent-panel').hidden = !isAgentModel(state.model); }
  const st = $('agent-status');
  st.textContent = text.length > 90 ? text.slice(0, 90) + '…' : text;
  agentProg = Math.min(92, agentProg + 3.5 + Math.random() * 4);
  $('agent-bar-fill').style.width = agentProg + '%';
}
function agentTokens(u) {
  $('agent-tokens').textContent = 'токены: ' + u.total + ' (→' + u.completion + ')';
}
function stopAgentPanel() {
  clearInterval(agentTimerInt); agentTimerInt = null;
  $('agent-panel').hidden = true;
  if (isAgentModel(state.model)) $('agent-bar-fill').style.width = '100%';
}

/* ================= баннеры/уведомления ================= */
let busyTimer = null;
function busyBanner(msg) {
  const b = $('busy-banner');
  b.textContent = '⚠ ' + msg + ' — повторите отправку или смените модель';
  b.hidden = false;
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => { b.hidden = true; }, 6000);
}

function notifyReady(msg) {
  const s = store.getSettings();
  if (!s.notify) return;
  if (document.visibilityState === 'visible' && !s.notifyAlways) return;
  const variants = ['Ответ готов ✓', 'Завершено — заходи!', 'Есть новый ответ', 'Модель закончила печатать', 'Готово! Забирай ответ'];
  const v = variants[Math.floor(Math.random() * variants.length)];
  const body = state.title + ' — ' + plainExcerpt(msg.content, 60);
  try {
    if (window.ZaiApp && window.ZaiApp.notify) window.ZaiApp.notify(v, body);
    else if (typeof window.__zaiToastNotify === 'function') window.__zaiToastNotify(v, body);
  } catch (_) {}
}

/* ================= сохранение ================= */
export function persist() {
  if (!state.chatId) return;
  store.saveMessages(state.chatId, state.messages.slice(-120));
  store.upsertChatMeta({ id: state.chatId, title: state.title, updatedAt: Date.now(), zaiId: state.zaiId, model: state.model, mode: state.mode });
}

let saveAccTimer = null;
function saveToAccount() {
  if (!store.getUser()?.token || !state.zaiId && !state.messages.some(m => m.role === 'ai' && m.done)) return;
  clearTimeout(saveAccTimer);
  saveAccTimer = setTimeout(async () => {
    const token = store.getUser()?.token;
    if (!token) return;
    const msgs = state.messages.filter(m => (m.role === 'user' && (m.content || m.files)) || (m.role === 'ai' && m.content))
      .map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.role === 'user' ? (m.content || '(вложение)') : m.content }));
    if (!msgs.length) return;
    const id = await saveChat(token, { zaiId: state.zaiId, title: state.title, model: state.model, messages: msgs });
    if (id && !state.zaiId) { state.zaiId = id; persist(); }
  }, 1800);
}

/* ================= новый/открытый чат ================= */
export async function openChat(meta) {
  stopGeneration(state.chatId);
  state.chatId = meta.id;
  state.title = meta.title || 'Чат';
  state.model = meta.model || store.getModelId();
  state.mode = meta.mode || (isAgentModel(state.model) ? 'agent' : 'chat');
  state.zaiId = meta.zaiId || null;
  state.messages = await store.loadMessages(meta.id);
  store.setActiveChatId(meta.id);
  renderAll();
  updateFoot();
}

export function newChat(id, model) {
  stopGeneration(state.chatId);
  state.chatId = id;
  state.title = 'Новый чат';
  state.model = model || store.getModelId();
  state.mode = isAgentModel(state.model) ? 'agent' : 'chat';
  state.zaiId = null;
  state.messages = [];
  store.setActiveChatId(id);
  renderAll();
  updateFoot();
}

export function setModel(id, name) {
  state.model = id;
  store.setModelId(id);
  state.mode = isAgentModel(id) ? 'agent' : 'chat';
  $('model-name').textContent = name || id;
  updateFoot();
}

/* ================= превью картинки → подсказка ================= */
export function checkImgIntent(text) {
  const tip = $('imggen-tip');
  if (!text || !text.trim()) { tip.hidden = true; return; }
  tip.hidden = !(IMG_RE.test(text) && !imgMode);
}

export function initChat(opts) {
  thinkLevel = store.getThinkLevel();
  imgMode = store.getImgMode();
  const box = $('messages');
  box.addEventListener('scroll', () => {
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 130;
    pinnedBottom = nearBottom;
    $('btn-scroll-down').hidden = nearBottom || box.scrollHeight < box.clientHeight + 60;
  }, { passive: true });
  $('btn-scroll-down').addEventListener('click', () => scrollToBottom(false));
  window.__sendFromChip = (q) => { $('input').value = ''; send(q); };
  updateFoot();
}
