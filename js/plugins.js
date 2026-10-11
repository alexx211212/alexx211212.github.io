/* ZaiChat v16 — плагины: каталог (GitHub + локальный), установка, вкл/выкл как в ChatGPT */
import { getEnabledPlugins, setEnabledPlugins } from './store.js';

const LOCAL_REGISTRY = '/plugins/registry.json';
const REMOTE_REGISTRY = 'https://raw.githubusercontent.com/hegr121/zai-plugins/main/registry.json';
const PAGE = 6;

let catalog = [];        // [{name, description, author, icon, url, manifest}]
let shown = 0;
let activeDefs = [];     // загруженные определения включённых плагинов
const codeCache = new Map();

async function fetchJson(url, timeout = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort('t'), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Каталог: первичный источник — GitHub, локальный файл — фолбэк/база */
export async function loadCatalog() {
  const out = [];
  const seen = new Set();
  const add = (arr, origin) => {
    for (const p of (arr || [])) {
      if (!p || !p.name || !p.url || seen.has(p.name)) continue;
      seen.add(p.name);
      out.push({ ...p, _origin: origin });
    }
  };
  try { const r = await fetchJson(REMOTE_REGISTRY, 5000); add(r && r.plugins, 'github'); } catch (_) {}
  try { const r = await fetchJson(LOCAL_REGISTRY); add(r && r.plugins, 'local'); } catch (_) {}
  catalog = out;
  return out;
}

/** Загрузить код плагина (манифест + entry) */
async function loadPluginCode(entryUrl) {
  if (codeCache.has(entryUrl)) return codeCache.get(entryUrl);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort('t'), 8000);
  try {
    const r = await fetch(entryUrl, { signal: ctrl.signal });
    if (!r.ok) throw new Error('plugin load ' + r.status);
    const code = await r.text();
    codeCache.set(entryUrl, code);
    return code;
  } finally { clearTimeout(t); }
}

function runPluginCode(code) {
  const defs = [];
  const shim = { register: (def) => { if (def && typeof def === 'object') defs.push(def); } };
  try { new Function('zai', '"use strict";\n' + code)(shim); } catch (e) { console.warn('plugin eval', e); }
  return defs;
}

/** Собрать активные (включённые) плагины для пайплайна чата */
export async function refreshActive() {
  const enabled = getEnabledPlugins();
  activeDefs = [];
  for (const item of catalog) {
    const key = item.url;
    if (!enabled[key]) continue;
    try {
      const manifest = await fetchJson(item.url, 6000).catch(() => null);
      const base = item.url.replace(/[^/]*$/, '');
      const entry = base + ((manifest && manifest.entry) || 'plugin.js');
      const defs = runPluginCode(await loadPluginCode(entry));
      for (const d of defs) activeDefs.push({ ...d, _url: key, _name: (manifest && manifest.name) || d.name || item.name });
    } catch (e) { console.warn('plugin fail', item.name, e); }
  }
  return activeDefs;
}

export function getActive() { return activeDefs; }
export function isEnabled(url) { return !!getEnabledPlugins()[url]; }
export function setEnabled(url, on) {
  const e = getEnabledPlugins();
  if (on) e[url] = true; else delete e[url];
  setEnabledPlugins(e);
}

/* ================= UI ================= */
export function renderList(container, onLoadDone) {
  const slice = catalog.slice(shown, shown + PAGE);
  const enabled = getEnabledPlugins();
  for (const item of slice) {
    const on = !!enabled[item.url];
    const card = document.createElement('div');
    card.className = 'plugin-card';
    const icon = item.icon || '🧩';
    card.innerHTML = `
      <div class="plugin-ico">${/^[\\u2190-\\u2BFF\\u2600-\\u27BF\\u1F000-\\u1FAFF]/.test(icon) ? icon : '🧩'}</div>
      <div class="info">
        <b>${escapeHtml(item.name)}</b>
        <p>${escapeHtml(item.description || '')}</p>
        <div class="author">${escapeHtml(item.author || 'сообщество')} · ${item._origin === 'github' ? 'GitHub' : 'каталог'}</div>
      </div>
      <label class="switch"><input type="checkbox" ${on ? 'checked' : ''}><i></i></label>`;
    const cb = card.querySelector('input');
    cb.addEventListener('change', async () => {
      setEnabled(item.url, cb.checked);
      await refreshActive();
      if (onLoadDone) onLoadDone(cb.checked, item.name);
    });
    container.appendChild(card);
  }
  shown += slice.length;
  return catalog.length - shown;
}

export function resetPager() { shown = 0; }
export function totalCount() { return catalog.length; }
export function hasMore() { return shown < catalog.length; }

function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
