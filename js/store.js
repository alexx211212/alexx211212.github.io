/* ZaiChat v16 — хранилище: настройки в localStorage, сообщения в IndexedDB */

const LS = {
  user: 'zc_user',            // {token,id,name,email,role,avatar}
  settings: 'zc_settings',    // объект настроек
  chats: 'zc_chatlist',      // [{id,title,updatedAt,zaiId,model,mode}]
  active: 'zc_active_chat',
  stats: 'zc_stats',          // {days:{'YYYY-MM-DD':{req,prompt,completion}}, custom:{...}}
  plugins: 'zc_plugins',      // {enabled:{id:true}}
  think: 'zc_think',
  model: 'zc_model',
  imgMode: 'zc_imgmode',
  anim: 'zc_anim'
};

export function lsGet(key, def) {
  try { const v = localStorage.getItem(key); return v == null ? def : JSON.parse(v); } catch (_) { return def; }
}
export function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
}

/* ---------- настройки ---------- */
export const defaultSettings = {
  customApi: false, apiBase: 'https://api.z.ai/api/paas/v4', apiKey: '', apiModel: 'glm-4.6',
  notify: true, notifyAlways: false, nativeAsr: true, glow: true, anim: true
};
export function getSettings() { return { ...defaultSettings, ...lsGet(LS.settings, {}) }; }
export function setSettings(patch) { lsSet(LS.settings, { ...getSettings(), ...patch }); }

/* ---------- пользователь ---------- */
export const getUser = () => lsGet(LS.user, null);
export const setUser = u => lsSet(LS.user, u);
export const clearUser = () => { try { localStorage.removeItem(LS.user); } catch (_) {} };

/* ---------- список чатов ---------- */
export const getChatList = () => lsGet(LS.chats, []);
export const setChatList = l => lsSet(LS.chats, l.slice(0, 300));
export function upsertChatMeta(meta) {
  const list = getChatList().filter(c => c.id !== meta.id);
  list.unshift(meta); setChatList(list);
}
export function removeChatMeta(id) { setChatList(getChatList().filter(c => c.id !== id)); }
export const getActiveChatId = () => lsGet(LS.active, null);
export const setActiveChatId = id => lsSet(LS.active, id);

/* ---------- статистика ---------- */
export function addUsage(source, usage) {
  if (!usage || !usage.total) return;
  const all = lsGet(LS.stats, { days: {}, custom: { req: 0, prompt: 0, completion: 0, total: 0 } });
  if (source === 'custom') {
    const c = all.custom || { req: 0, prompt: 0, completion: 0, total: 0 };
    c.req++; c.prompt += usage.prompt || 0; c.completion += usage.completion || 0; c.total += usage.total || 0;
    all.custom = c;
  } else {
    const day = new Date().toISOString().slice(0, 10);
    const d = all.days[day] || { req: 0, prompt: 0, completion: 0, total: 0 };
    d.req++; d.prompt += usage.prompt || 0; d.completion += usage.completion || 0; d.total += usage.total || 0;
    all.days[day] = d;
    const keys = Object.keys(all.days).sort();
    while (keys.length > 30) delete all.days[keys.shift()];
  }
  lsSet(LS.stats, all);
}
export const getStats = () => lsGet(LS.stats, { days: {}, custom: { req: 0, prompt: 0, completion: 0, total: 0 } });
export function resetStats() { lsSet(LS.stats, { days: {}, custom: { req: 0, prompt: 0, completion: 0, total: 0 } }); }

/* ---------- плагины ---------- */
export const getEnabledPlugins = () => lsGet(LS.plugins, {});
export const setEnabledPlugins = o => lsSet(LS.plugins, o);

/* ---------- режимы ---------- */
export const getThinkLevel = () => lsGet(LS.think, 'off');
export const setThinkLevel = v => lsSet(LS.think, v);
export const getModelId = () => lsGet(LS.model, 'glm-5.3');
export const setModelId = v => lsSet(LS.model, v);
export const getImgMode = () => lsGet(LS.imgMode, false);
export const setImgMode = v => lsSet(LS.imgMode, !!v);

/* ---------- IndexedDB для сообщений ---------- */
const DB_NAME = 'zc-db', DB_STORE = 'msgs';
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(DB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
export async function saveMessages(chatId, messages) {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({ m: messages, t: Date.now() }, chatId);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch (_) {}
}
export async function loadMessages(chatId) {
  try {
    const d = await db();
    return await new Promise((res) => {
      const tx = d.transaction(DB_STORE, 'readonly');
      const r = tx.objectStore(DB_STORE).get(chatId);
      r.onsuccess = () => res((r.result && r.result.m) || []);
      r.onerror = () => res([]);
    });
  } catch (_) { return []; }
}
export async function deleteMessages(chatId) {
  try {
    const d = await db();
    await new Promise((res) => {
      const tx = d.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(chatId);
      tx.oncomplete = res; tx.onerror = res;
    });
  } catch (_) {}
}
