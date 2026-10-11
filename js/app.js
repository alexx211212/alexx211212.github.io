/* ZaiChat v16 — контроллер: вход, роутинг, панели, шеринг, голос, уведомления, иконки, чипы */
import * as api from './api.js';
import * as store from './store.js';
import * as chat from './chat.js';
import * as plugins from './plugins.js';
import { renderMarkdown } from './md.js';

const $ = id => document.getElementById(id);
const IN_APP = !!(window.ZaiApp && window.ZaiApp.isApp);

/* ================= ЧИПЫ-ПОДСКАЗКИ (много, ротация) ================= */
const SUGGESTIONS = [
  'Объясни квантовую запутанность простыми словами', 'Придумай план тренировок на неделю дома',
  'Напиши короткий рассказ про робота, который научился мечтать', 'Составь меню на день на 2000 ккал',
  'Как выучить английский до B2 за 3 месяца?', 'Придумай 10 идей для Telegram-канала про технологии',
  'Объясни разницу между REST и GraphQL', 'Помоги написать резюме для позиции аналитика',
  'Составь маршрут по Санкт-Петербургу на 3 дня', 'Почему небо голубое, а закат красный?',
  'Напиши SQL-запрос: топ-10 клиентов по выручке', 'Как работает блокчейн — объясни на примере переписки',
  'Придумай слоган для кофейни у метро', 'Сделай разбор ошибки: почему код падает с NPE',
  'Сравни iPhone и Android для учёбы', 'Составь чек-лист для первой поездки в горы',
  'Объясни теорию относительности на пальцах', 'Помоги подготовиться к собеседованию в IT',
  'Напиши письмо клиенту о переносе срока', 'Как накопить на квартиру с нулевыми сбережениями?',
  'Придумай заголовок для статьи про ИИ', 'Разбей проект «сделать сайт» на задачи',
  'Напиши функцию на Python для парсинга CSV', 'Какие книги почитать про продукт-менеджмент?',
  'Составь план запуска подкаста', 'Объясни, как устроены нейросети, ребенку 10 лет',
  'Перепиши текст формально и вежливо', 'Сделай конспект темы «фотосинтез»',
  'Как настроить автосохранение в VS Code?', 'Придумай 5 названий для приложения-дневника'
];
let chipTimer = null;

function showChips() {
  const box = $('chips');
  if (chat.state.messages.length || chat.isBusy()) { box.style.display = 'none'; return; }
  box.style.display = '';
  const pick = () => {
    const shuffled = [...SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 4);
    box.classList.add('rotating');
    setTimeout(() => {
      box.innerHTML = '';
      for (const s of shuffled) {
        const b = document.createElement('button');
        b.className = 'chip'; b.textContent = s;
        b.addEventListener('click', () => { $('input').value = s; $('input').focus(); chat.checkImgIntent(s); autosize(); updateSendEnabled(); });
        box.appendChild(b);
      }
      box.classList.remove('rotating');
    }, 240);
  };
  pick();
  clearInterval(chipTimer);
  chipTimer = setInterval(() => {
    if (chat.state.messages.length === 0 && !chat.isBusy() && document.visibilityState === 'visible') pick();
  }, 15000);
}

/* ================= ЛОГИН ================= */
async function enterApp(user) {
  store.setUser(user);
  $('screen-auth').hidden = true;
  $('screen-main').hidden = false;
  $('user-badge').textContent = (user.name || 'Пользователь') + (user.email ? ' · ' + user.email : '') + (user.role === 'guest' ? ' · гость' : '');
  await initMain();
}

async function tryAuth() {
  const saved = store.getUser();
  if (saved && saved.token) {
    try {
      const fresh = await api.tokenLogin(saved.token);
      await enterApp(fresh);
      return true;
    } catch (e) {
      if (e.auth) store.clearUser();
      else { await enterApp(saved); return true; } // сеть лежит — пускаем офлайн
    }
  }
  return false;
}

function wireAuth() {
  $('btn-login-zai').addEventListener('click', async () => {
    $('auth-note').textContent = 'Открываю вход Z.ai…';
    if (IN_APP && window.ZaiApp.beginZaiLogin) { window.ZaiApp.beginZaiLogin(); return; }
    // в браузере: инструкция + гостевой фолбэк
    $('auth-note').innerHTML = 'В браузере: откройте <a href="https://chat.z.ai" target="_blank" rel="noopener">chat.z.ai</a>, войдите, затем F12 → Console → <code>localStorage.token</code> → скопируйте токен в поле ниже. Или используйте гостевой вход.';
  });
  $('btn-login-guest').addEventListener('click', async () => {
    $('auth-note').textContent = 'Гостевой вход…';
    try { await enterApp(await api.tokenLogin(null)); $('auth-note').textContent = ''; }
    catch (e) { $('auth-note').textContent = 'Не удалось: ' + e.message; }
  });
  $('btn-login-token').addEventListener('click', async () => {
    const t = $('inp-token').value.trim();
    if (!t) return;
    $('auth-note').textContent = 'Проверяю токен…';
    try { await enterApp(await api.tokenLogin(t)); $('auth-note').textContent = ''; }
    catch (e) { $('auth-note').textContent = 'Ошибка: ' + e.message; }
  });
  // мост из нативного логина: __onZaiToken(token)
  window.__onZaiToken = async (token) => {
    try {
      const user = await api.tokenLogin(token);
      await enterApp(user);
      chat.toast('Вход выполнен: ' + (user.name || 'аккаунт Z.ai'));
    } catch (e) {
      chat.toast('Токен получен, но вход не удался: ' + e.message);
    }
  };
}

/* ================= ИНИЦИАЛИЗАЦИЯ ГЛАВНОГО ЭКРАНА ================= */
let mainInited = false;
async function initMain() {
  if (mainInited) return;
  mainInited = true;
  chat.initChat();
  wireSidebar();
  wireComposer();
  wireModelPanel();
  wireThinkSheet();
  wireSheets();
  wireShare();
  wireSettings();
  wireMic();
  wireShareIn();
  wireNet();
  chat.updateFoot();
  await restoreLastChat();
  showChips();
  plugins.loadCatalog().then(() => plugins.refreshActive());
}

async function restoreLastChat() {
  const list = store.getChatList();
  const activeId = store.getActiveChatId();
  const meta = list.find(c => c.id === activeId) || null;
  if (meta) {
    await chat.openChat(meta);
    $('model-name').textContent = modelLabel(chat.state.model);
  } else {
    newChatAction();
  }
  $('model-name').textContent = modelLabel(chat.state.model);
}

const modelLabel = (id) => (MODEL_CACHE.find(m => m.id === id) || {}).name || id;
let MODEL_CACHE = [
  { id: 'glm-5.3', name: 'GLM 5.3' }, { id: 'x-preview-l', name: 'GLM 5.3 Flash' }, { id: 'glm-5.2', name: 'GLM 5.2' }
];

async function refreshModels() {
  const token = store.getUser()?.token;
  MODEL_CACHE = await api.fetchModels(token);
}

/* ================= САЙДБАР ================= */
function renderChatList() {
  const box = $('chat-list');
  box.innerHTML = '';
  const list = store.getChatList();
  for (const c of list) {
    const item = document.createElement('button');
    item.className = 'chat-item' + (c.id === chat.state.chatId ? ' active' : '');
    const t = document.createElement('span');
    t.className = 't'; t.textContent = c.title || 'Без названия';
    item.appendChild(t);
    const del = document.createElement('span');
    del.className = 'del'; del.textContent = '🗑';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Удалить чат «' + (c.title || '') + '»?')) return;
      const token = store.getUser()?.token;
      const meta = store.getChatList().find(x => x.id === c.id);
      if (token && meta && meta.zaiId) api.deleteChat(token, meta.zaiId);
      await store.deleteMessages(c.id);
      store.removeChatMeta(c.id);
      if (chat.state.chatId === c.id) newChatAction();
      renderChatList();
      closeSidebar();
    });
    item.appendChild(del);
    item.addEventListener('click', async () => {
      closeSidebar();
      await chat.openChat(c);
      $('model-name').textContent = modelLabel(chat.state.model);
      showChips();
    });
    box.appendChild(item);
  }
}

function openSidebar() { $('sidebar').classList.add('open'); const b = $('sidebar-backdrop'); b.hidden = false; requestAnimationFrame(() => b.classList.add('show')); }
function closeSidebar() { $('sidebar').classList.remove('open'); const b = $('sidebar-backdrop'); b.classList.remove('show'); setTimeout(() => { b.hidden = true; }, 220); }

function wireSidebar() {
  $('btn-open-sidebar').addEventListener('click', () => { renderChatList(); openSidebar(); });
  $('btn-close-sidebar').addEventListener('click', closeSidebar);
  $('sidebar-backdrop').addEventListener('click', closeSidebar);
  $('btn-new-chat').addEventListener('click', () => { newChatAction(); closeSidebar(); });
  $('btn-plugins').addEventListener('click', () => { closeSidebar(); openSheet('plugins-sheet'); refreshPluginsUI(); });
  $('btn-settings').addEventListener('click', () => { closeSidebar(); openSheet('settings-sheet'); renderSettings(); });
  $('btn-about').addEventListener('click', () => { closeSidebar(); openAbout(); });
}

function newChatAction() {
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  chat.newChat(id, store.getModelId());
  store.upsertChatMeta({ id, title: 'Новый чат', updatedAt: Date.now(), model: chat.state.model });
  $('model-name').textContent = modelLabel(chat.state.model);
  renderChatList();
  showChips();
}

window.__onTitle = (t) => { store.upsertChatMeta({ id: chat.state.chatId, title: t, updatedAt: Date.now(), zaiId: chat.state.zaiId, model: chat.state.model }); };
window.__onUsage = () => {};

/* ================= КОМПОЗЕР ================= */
function autosize() {
  const ta = $('input');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 132) + 'px';
}
function updateSendEnabled() { $('btn-send').disabled = !$('input').value.trim() && chat.pendingFiles.length === 0; }

function wireComposer() {
  const input = $('input');
  input.addEventListener('input', () => { autosize(); updateSendEnabled(); chat.checkImgIntent(input.value); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && innerWidth >= 768) { e.preventDefault(); doSend(); }
  });
  $('btn-send').addEventListener('click', doSend);
  $('btn-stop').addEventListener('click', () => chat.stopGeneration());

  const plus = $('btn-plus'), menu = $('plus-menu');
  plus.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; menu.classList.toggle('show', !menu.hidden); });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== plus) { menu.hidden = true; menu.classList.remove('show'); }
  });
  menu.addEventListener('click', (e) => {
    // меню закрывается сразу после выбора (фикс «+»)
    menu.hidden = true; menu.classList.remove('show');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'photo') $('file-input').click();
    if (act === 'camera') $('camera-input').click();
    if (act === 'image-mode') { chat.setImgMode(!chat.getImgMode()); chat.toast(chat.getImgMode() ? 'Генерация изображений включена' : 'Выключено'); }
    if (act === 'ppt') { chat.pptMode.on = !chat.pptMode.on; chat.updateFoot(); chat.toast(chat.pptMode.on ? 'Режим AI-презентаций включён' : 'Режим PPT выключен'); }
  });
  $('file-input').addEventListener('change', (e) => { chat.addFiles(e.target.files); e.target.value = ''; });
  $('camera-input').addEventListener('change', (e) => { chat.addFiles(e.target.files); e.target.value = ''; });
  $('btn-enable-imggen').addEventListener('click', () => { chat.setImgMode(true); $('imggen-tip').hidden = true; });

  applyGlowSetting();
  document.addEventListener('focusin', () => $('composer').classList.add('active'));
  document.addEventListener('focusout', () => $('composer').classList.remove('active'));
}

function doSend() {
  const text = $('input').value.trim();
  if (!text && chat.pendingFiles.length === 0) return;
  $('input').value = ''; autosize(); updateSendEnabled();
  chat.send(text);
  setTimeout(showChips, 100);
}

/* ================= ПАНЕЛЬ МОДЕЛЕЙ (4 пункта) ================= */
function wireModelPanel() {
  $('btn-model').addEventListener('click', () => { buildModelList(); openSheet('model-sheet'); });
  refreshModels().then(() => { $('model-name').textContent = modelLabel(chat.state.model); });
}

function buildModelList() {
  const box = $('model-list');
  box.innerHTML = '';
  const main = ['glm-5.3', 'x-preview-l', 'glm-5.2'];
  const find = id => MODEL_CACHE.find(m => m.id === id) || { id, name: id };
  const row = (m, sub) => {
    const b = document.createElement('button');
    b.className = 'model-row';
    b.innerHTML = `<div class="nm"><b></b><small></small></div>${chat.state.model === m.id ? '<span class="check">✓</span>' : ''}`;
    b.querySelector('b').textContent = m.name;
    b.querySelector('small').textContent = sub || m.id;
    b.addEventListener('click', () => { chat.setModel(m.id, m.name); $('model-name').textContent = m.name; closeSheet('model-sheet'); renderChatList(); });
    box.appendChild(b);
  };
  const names = { 'glm-5.3': 'Флагман: умнейшая модель для сложных задач', 'x-preview-l': 'Самая быстрая — для повседневных вопросов', 'glm-5.2': 'Стабильная классика' };
  for (const id of main) row(find(id), names[id]);
  const rest = MODEL_CACHE.filter(m => !main.includes(m.id));
  const sub = document.createElement('div');
  sub.className = 'model-sub-title'; sub.textContent = 'Другие модели (' + rest.length + ')';
  box.appendChild(sub);
  for (const m of rest) row(m, m.id);
}

/* ================= РАЗМЫШЛЕНИЯ (EN: OFF/LOW/MEDIUM/HIGH) ================= */
function wireThinkSheet() {
  const btn = $('btn-think');
  const setLabel = () => {
    const lv = chat.getThink();
    $('think-label').textContent = lv.toUpperCase();
    btn.classList.toggle('on', lv !== 'off');
    chat.updateFoot();
  };
  btn.addEventListener('click', () => openSheet('think-sheet'));
  document.querySelectorAll('.think-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      // меню закрывается после выбора
      chat.setThink(opt.dataset.level);
      setLabel();
      closeSheet('think-sheet');
      chat.toast('Размышления: ' + opt.dataset.level.toUpperCase());
    });
  });
  setLabel();
}

/* ================= ШИРИНГ ================= */
function wireShare() {
  $('btn-share').addEventListener('click', async () => {
    const token = store.getUser()?.token;
    const hasContent = chat.state.messages.some(m => m.content);
    if (!hasContent) { chat.toast('Пока нечем делиться — отправьте сообщение'); return; }
    let link = null;
    if (token && chat.state.zaiId) {
      try { link = await api.shareChat(token, chat.state.zaiId); }
      catch (e) { link = null; }
    }
    if (!link) {
      // фолбэк: шеринг текста чата
      const text = chat.state.title + '\n\n' + chat.state.messages
        .filter(m => m.content).map(m => (m.role === 'user' ? '🧑: ' : '🤖: ') + m.content).join('\n\n').slice(0, 3500);
      await shareOut(text, null);
      return;
    }
    await shareOut(link, link);
  });
}

async function shareOut(text, link) {
  try {
    if (IN_APP && window.ZaiApp.shareText) { window.ZaiApp.shareText(text); return; }
    if (navigator.share) { await navigator.share(link ? { title: 'Чат Z.ai', url: link } : { text }); return; }
  } catch (_) {}
  if (link) {
    $('share-link').value = link;
    openSheet('share-result');
    try { await navigator.clipboard.writeText(link); chat.toast('Ссылка скопирована'); } catch (_) {}
  } else {
    try { await navigator.clipboard.writeText(text); chat.toast('Текст чата скопирован'); } catch (_) {}
  }
}

/* ================= ШИТЫ (bottom sheets) ================= */
const sheetBackdrop = document.createElement('div');
sheetBackdrop.className = 'sheet-backdrop';
sheetBackdrop.hidden = true; // фикс: без этого невидимый оверлей блокирует все нажатия на странице
document.body.appendChild(sheetBackdrop);
const openSheets = new Set();

function openSheet(id) {
  const el = $(id);
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  sheetBackdrop.hidden = false;
  requestAnimationFrame(() => sheetBackdrop.classList.add('show'));
  openSheets.add(id);
}
function closeSheet(id) {
  const el = $(id);
  if (!el || el.hidden) return;
  el.classList.remove('show');
  openSheets.delete(id);
  setTimeout(() => { el.hidden = true; if (!openSheets.size) sheetBackdrop.classList.remove('show'); if (!openSheets.size) setTimeout(() => sheetBackdrop.hidden = true, 200); }, 240);
}
sheetBackdrop.addEventListener('click', () => [...openSheets].forEach(closeSheet));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeSheet(b.dataset.close)));

function wireSheets() {
  $('btn-load-more-plugins').addEventListener('click', () => refreshPluginsUI(true));
}

/* ================= ПЛАГИНЫ UI ================= */
async function refreshPluginsUI(more) {
  const list = $('plugins-list');
  if (!more) { list.innerHTML = ''; plugins.resetPager(); }
  const left = plugins.renderList(list, (on, name) => chat.toast((on ? 'Плагин включён: ' : 'Плагин выключен: ') + name));
  $('btn-load-more-plugins').hidden = !plugins.hasMore();
  if (!more && plugins.totalCount() === 0) list.innerHTML = '<p class="hint">Каталог пуст. Проверьте сеть.</p>';
}

/* ================= НАСТРОЙКИ ================= */
function renderSettings() {
  const s = store.getSettings();
  const u = store.getUser();
  $('acc-info').innerHTML = u ? `<b></b><br><span style="color:var(--tx2);font-size:.8rem"></span>` : 'Не выполнен';
  if (u) {
    $('acc-info').querySelector('b').textContent = u.name || 'Пользователь';
    $('acc-info').querySelector('span').textContent = (u.email || '') + (u.role === 'guest' ? ' · гостевой режим' : '');
  }
  $('set-custom-api').checked = !!s.customApi;
  $('custom-api-box').hidden = !s.customApi;
  $('set-api-base').value = s.apiBase;
  $('set-api-key').value = s.apiKey;
  $('set-api-model').value = s.apiModel;
  $('set-notify').checked = !!s.notify;
  $('set-notify-always').checked = !!s.notifyAlways;
  $('set-native-asr').checked = !!s.nativeAsr;
  $('set-glow').checked = !!s.glow;
  $('set-anim').checked = !!s.anim;
  renderStats();
  renderIconGrid();
}

function renderStats() {
  const st = store.getStats();
  const days = Object.keys(st.days || {}).sort().reverse().slice(0, 7);
  const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n;
  let html = '<div class="row"><span>Свой API — всего</span><span>' + (st.custom ? st.custom.req + ' запросов · ' + fmt(st.custom.total) + ' токенов' : '—') + '</span></div>';
  for (const d of days) {
    const v = st.days[d];
    html += `<div class="row"><span>${d.slice(8)}.${d.slice(5, 7)}</span><span>${v.req} запр · ${fmt(v.total)} ток.</span></div>`;
  }
  if (!days.length) html += '<div class="row"><span>За последние дни</span><span>—</span></div>';
  $('stats-box').innerHTML = html;
}

function wireSettings() {
  const bind = (id, key, after) => $(id).addEventListener('change', (e) => {
    store.setSettings({ [key]: e.target.checked ?? e.target.value });
    if (after) after(e.target.checked ?? e.target.value);
  });
  $('set-custom-api').addEventListener('change', e => { store.setSettings({ customApi: e.target.checked }); $('custom-api-box').hidden = !e.target.checked; });
  $('set-api-base').addEventListener('change', e => store.setSettings({ apiBase: e.target.value.trim() }));
  $('set-api-key').addEventListener('change', e => store.setSettings({ apiKey: e.target.value.trim() }));
  $('set-api-model').addEventListener('change', e => store.setSettings({ apiModel: e.target.value.trim() }));
  bind('set-notify', 'notify');
  bind('set-notify-always', 'notifyAlways');
  bind('set-native-asr', 'nativeAsr');
  bind('set-glow', 'glow', applyGlowSetting);
  bind('set-anim', 'anim', v => document.body.classList.toggle('no-anim', !v));

  $('btn-api-test').addEventListener('click', async () => {
    const s = store.getSettings();
    const base = (s.apiBase || '').replace(/\/+$/, '');
    $('api-test-result').textContent = 'Проверяю…';
    try {
      const r = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.apiKey },
        body: JSON.stringify({ model: s.apiModel || 'glm-4.6', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 })
      });
      $('api-test-result').textContent = r.ok ? '✓ Соединение работает' : '✗ Ошибка ' + r.status;
      if (r.ok) {
        try {
          const lr = await fetch(base + '/models', { headers: { Authorization: 'Bearer ' + s.apiKey } });
          if (lr.ok) {
            const d = await lr.json();
            const dl = $('api-models-dl');
            dl.innerHTML = '';
            for (const m of (d.data || [])) { const o = document.createElement('option'); o.value = m.id; dl.appendChild(o); }
          }
        } catch (_) {}
      }
    } catch (e) { $('api-test-result').textContent = '✗ ' + e.message; }
  });

  $('btn-relogin').addEventListener('click', () => {
    if (IN_APP && window.ZaiApp.beginZaiLogin) window.ZaiApp.beginZaiLogin();
    else chat.toast('Откройте чат.z.ai в браузере и скопируйте токен');
  });
  $('btn-logout').addEventListener('click', () => {
    if (!confirm('Выйти из аккаунта?')) return;
    store.clearUser();
    location.reload();
  });
}

function applyGlowSetting() {
  $('composer').classList.toggle('glow-on', store.getSettings().glow);
}

/* ================= О ПРИЛОЖЕНИИ ================= */
const HISTORY = [
  { v: '16', date: '11 октября 2026', note: 'Размышления LOW/MEDIUM/HIGH (англ., меню закрывается); «Поделиться чатом» сверху — ссылка работает и на офф сайте, и в приложении; вход через Z.ai без токена вручную; плагины с кнопкой «Загрузить ещё»; нативный микрофон; найден и починен КОРЕНЬ «сервер не отвечает» (прогрев WAF-защиты chat.z.ai + автоповтор); оповещения «ответ готов»; модель перегружена — авторетрай; много подсказок с ротацией; иконки: выбор из нескольких; всё летает на телефоне' },
  { v: '15', date: '11 октября 2026', note: 'Размышления 3 уровней; чаты не блокируют друг друга; вложения через аккаунт; картинки рисует аккаунт; AI PPT — настоящий .pptx; агент с таймером, токенами и доп-вопросами; свои API-ключи; свечение ввода' },
  { v: '14', date: '11 октября 2026', note: 'Сайт переехал на GitHub Pages — постоянный бесплатный адрес. OTA с нового адреса' },
  { v: '13', date: '10 октября 2026', note: 'Таблицы и агентные шаги; быстрые длинные чаты; все модели аккаунта; браузер плагинов как в ChatGPT' },
  { v: '12', date: '10 октября 2026', note: 'Скачивание любых файлов из приложения' },
  { v: '11', date: '10 октября 2026', note: 'Единая нумерация версий; фикс кнопки скачивания на /apk' },
  { v: '8', date: '10 октября 2026', note: 'Синхронизация с сайтом, таблицы, агентные шаги, плагины с GitHub' },
  { v: '7', date: '10 октября 2026', note: 'Синхронизация ВСЕХ чатов, логин на телефоне' },
  { v: '5', date: '9 октября 2026', note: 'Агент: живые размышления, команды, файлы pptx/docx/xlsx/pdf/html' },
  { v: '4', date: '9 октября 2026', note: 'Вход в аккаунт Z.ai, вложения' },
  { v: '3', date: '8 октября 2026', note: 'Клон chat.z.ai: брендинг, GLM, режимы Chat/Agent' },
  { v: '2', date: '8 октября 2026', note: 'Размышления, веб-поиск, картинки, голос' },
  { v: '1', date: '8 октября 2026', note: 'Первый мобильный PWA-чат со стримингом' }
];
function openAbout() {
  $('about-version').textContent = 'v16';
  const h = $('about-history');
  h.innerHTML = HISTORY.map(x => `<div class="h-item"><b>v${x.v}</b><span>${x.date}</span><p>${x.note}</p></div>`).join('');
  openSheet('about-sheet');
}

/* ================= ГОЛОС (нативный приоритет) ================= */
let recNative = false;
function wireMic() {
  $('btn-mic').addEventListener('click', () => {
    if (recNative) { stopRec(); return; }
    const s = store.getSettings();
    if (IN_APP && window.ZaiApp.speechStart && s.nativeAsr) {
      recNative = true;
      $('btn-mic').classList.add('rec');
      window.ZaiApp.speechStart('ru-RU');
    } else {
      startWebRec();
    }
  });
  window.onZaiSpeechPartial = (text) => { $('input').value = text; autosize(); updateSendEnabled(); };
  window.onZaiSpeechFinal = (text) => { recNative = false; $('btn-mic').classList.remove('rec'); if (text) { $('input').value = text; autosize(); updateSendEnabled(); chat.checkImgIntent(text); } };
  window.onZaiSpeechError = (code) => { recNative = false; $('btn-mic').classList.remove('rec'); if (code !== 'client-stop') chat.toast('Микрофон: ' + code); };
}

function stopRec() {
  if (recNative && window.ZaiApp && window.ZaiApp.speechStop) { window.ZaiApp.speechStop(); }
  else if (webRec) { try { webRec.stop(); } catch (_) {} }
  recNative = false;
  $('btn-mic').classList.remove('rec');
}
let webRec = null;
function startWebRec() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { chat.toast('Распознавание речи недоступно в этом браузере'); return; }
  try {
    webRec = new SR();
    webRec.lang = 'ru-RU'; webRec.interimResults = true; webRec.continuous = false;
    webRec.onresult = (e) => {
      let fin = '', part = '';
      for (const r of e.results) (r.isFinal ? fin += r[0].transcript : part += r[0].transcript);
      $('input').value = fin || part; autosize(); updateSendEnabled();
    };
    webRec.onend = () => { $('btn-mic').classList.remove('rec'); };
    webRec.onerror = (e) => { $('btn-mic').classList.remove('rec'); chat.toast('Микрофон: ' + e.error); };
    webRec.start();
    $('btn-mic').classList.add('rec');
  } catch (_) { chat.toast('Не удалось запустить микрофон'); }
}

/* ================= ШЕРИНГ В ПРИЛОЖЕНИЕ (native SEND -> поле ввода) ================= */
function wireShareIn() {
  window.__onZaiShareText = (text) => {
    try {
      $('input').value = String(text || '').trim();
      autosize();
      updateSendEnabled();
      chat.toast('Текст из другого приложения — в поле ввода');
      try { $('input').focus(); } catch (_) {}
    } catch (_) {}
  };
}

/* ================= СЕТЬ: автоисправление ================= */
function wireNet() {
  const banner = $('net-banner');
  const upd = () => {
    banner.hidden = navigator.onLine;
    if (navigator.onLine) { banner.hidden = true; }
  };
  window.addEventListener('offline', upd);
  window.addEventListener('online', () => { upd(); chat.toast('Сеть восстановлена'); });
  upd();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') upd(); });
}

/* ================= ИКОНКИ (нативно) ================= */
async function renderIconGrid() {
  const grid = $('icon-grid');
  if (!IN_APP || !window.ZaiApp.getIcons) { grid.parentElement.hidden = true; return; }
  try {
    const icons = JSON.parse(window.ZaiApp.getIcons() || '[]');
    const cur = window.ZaiApp.currentIcon ? window.ZaiApp.currentIcon() : 'default';
    grid.innerHTML = '';
    for (const ic of icons) {
      const b = document.createElement('button');
      b.className = 'ic' + (ic.id === cur ? ' cur' : '');
      b.title = ic.label;
      const img = document.createElement('img');
      img.src = ic.preview || '/icons/icon-192.png';
      b.appendChild(img);
      b.addEventListener('click', () => {
        if (!confirm('Сменить иконку на «' + ic.label + '»? Приложение может закрыться — откройте его снова.')) return;
        window.ZaiApp.setIcon(ic.id);
      });
      grid.appendChild(b);
    }
  } catch (_) { grid.parentElement.hidden = true; }
}

/* ================= СТАРТ ================= */
async function boot() {
  document.body.classList.toggle('no-anim', !store.getSettings().anim);
  const shared = handleShareRoute();
  if (shared) return;
  wireAuth();
  const ok = await tryAuth();
  if (!ok) { $('screen-auth').hidden = false; }
  if (IN_APP) {
    // нативный мост готов: иконки/логин/уведомления доступны
  }
}

/** роут /s/<id> — ссылка шеринга: открываем официальный просмотрщик */
function handleShareRoute() {
  const path = location.pathname;
  const m = path.match(/^\/s\/([A-Za-z0-9_-]+)/);
  if (m) {
    location.replace('https://chat.z.ai/s/' + m[1]);
    return true;
  }
  return false;
}

boot();
