/*! ZaiChat v19 — слой исправлений поверх v15.4/v16–v18.
 *  Новое в v19 (по жалобам владельца):
 *  1) Уровни размышлений называются «Быстрое / Глубокое / Ультра» — и в меню,
 *     и на пилюле после выбора (раньше меню писало Низкое/Среднее/Высокое,
 *     а пилюля прыгала на Высокое/Среднее).
 *  2) Панель ввода крупнее (поле ~2 строки вместо одной), текст ВСЕХ кнопок
 *     одного размера (12px) — раньше поиск/плагины были 9px, остальные 12–16px.
 *  3) Подменю «Другие модели»: открывается СРАЗУ вниз под пунктом (без
 *     «сначала вправо, потом вниз» — сдвиг теперь в том же кадре, до отрисовки),
 *     повторный тап по «Другие модели» сворачивает подменю обратно.
 *  4) Вход: гостевой токен отсекается на всех путях (кнопка гостя скрыта,
 *     мост токена и опрос localStorage игнорируют роль guest).
 *  Сохранено из v16–v18: 4 подсказки, «Перенести», меню вниз, автономный APK.
 *  Работает поверх приложения и не мешает ему: всё в try/catch. */
(function () {
  'use strict';
  if (window.__z16x) return;
  window.__z16x = { v: '19' };

  /* ================= утилиты ================= */
  function $(s, r) { try { return (r || document).querySelector(s); } catch (_) { return null; } }
  function $$(s, r) { try { return Array.prototype.slice.call((r || document).querySelectorAll(s)); } catch (_) { return []; } }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} }
  function directText(el) {
    var out = [];
    for (var i = 0; i < el.childNodes.length; i++) if (el.childNodes[i].nodeType === 3) out.push(el.childNodes[i]);
    return out;
  }
  function allText(el) {
    var out = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false), n;
    while ((n = w.nextNode())) out.push(n);
    return out;
  }
  function setNativeValue(el, value) {
    try {
      var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var d = Object.getOwnPropertyDescriptor(proto, 'value');
      if (d && d.set) d.set.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (_) { try { el.value = value; } catch (_2) {} }
  }

  /* ================= язык: Русский по умолчанию, EN по желанию ================= */
  var lang = 'ru';
  try { lang = localStorage.getItem('z16lang') === 'en' ? 'en' : 'ru'; } catch (_) {}
  function isEn() { return lang === 'en'; }
  function setLang(l) {
    lang = (l === 'en') ? 'en' : 'ru';
    try { localStorage.setItem('z16lang', lang); } catch (_) {}
    curSet = []; /* подсказки перерисуются под язык */
    sweep();
  }
  window.__z16setLang = setLang;
  /* словарь видимых надписей (только то, что трогает слой; нативный интерфейс русский) */
  var DICT_EN = {
    'Уровень размышлений': 'Thinking level',
    'Размышления': 'Think',
    'Быстрое': 'Fast', 'Глубокое': 'Deep', 'Ультра': 'Ultra', 'Выключить': 'Off',
    'Поделиться чатом': 'Share chat', 'Перенести в новый чат': 'Continue in new chat',
    'Плагины': 'Plugins', 'Поиск': 'Search', 'Настройки': 'Settings',
    'Аккаунт Z.ai': 'Z.ai account', 'Чаты': 'Chats', 'Задачи': 'Tasks',
    'Новый чат': 'New chat', 'Новая задача': 'New task',
    'Загрузить ещё': 'Load more', 'Установить': 'Install', 'Удалить': 'Delete',
    'Переименовать': 'Rename', 'Меню чата': 'Chat menu'
  };

  /* ================= тосты ================= */
  var toastBox = null, lastToastText = '', lastToastAt = 0;
  function ensureBox() {
    if (toastBox && document.contains(toastBox)) return toastBox;
    toastBox = document.createElement('div');
    toastBox.id = 'z16-toasts';
    (document.body || document.documentElement).appendChild(toastBox);
    return toastBox;
  }
  function toast(msg, ms) {
    try {
      var now = Date.now();
      if (msg === lastToastText && now - lastToastAt < 4000) return; /* без спама */
      lastToastText = msg; lastToastAt = now;
      var box = ensureBox();
      var t = document.createElement('div');
      t.className = 'z16-toast';
      t.textContent = msg;
      box.appendChild(t);
      requestAnimationFrame(function () { t.classList.add('z16-show'); });
      setTimeout(function () {
        t.classList.remove('z16-show');
        setTimeout(function () { t.remove(); }, 260);
      }, ms || 3200);
      while (box.children.length > 2) box.removeChild(box.firstChild);
    } catch (_) {}
  }
  window.__z16toast = toast; /* для тестов */

  /* ================= 1. fetch: само-починка + сбор токена/chat_id + фильтры ================= */
  var ZAI = 'https://chat.z.ai';
  var lastToken = '', lastChat = '';
  try {
    lastToken = sessionStorage.getItem('z16tok') || '';
    lastChat = sessionStorage.getItem('z16chat') || '';
  } catch (_) {}
  var realFetch = window.fetch.bind(window);

  /* гостевой JWT? payload.role === 'guest' у chat.z.ai — такой токен входом не считается */
  function isGuestJwt(tok) {
    try {
      var p = String(tok || '').split('.')[1];
      if (!p) return false;
      p = p.replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      var j = JSON.parse(decodeURIComponent(escape(atob(p))));
      return String(j && j.role || '').toLowerCase() === 'guest';
    } catch (_) { return false; }
  }

  function rememberToken(hs) {
    try {
      if (!hs) return;
      var a = '';
      if (typeof hs.get === 'function') a = hs.get('Authorization') || hs.get('authorization') || '';
      else a = hs.Authorization || hs.authorization || '';
      if (a) {
        lastToken = String(a).replace(/^Bearer\s+/i, '').trim();
        try { sessionStorage.setItem('z16tok', lastToken); } catch (_) {}
      }
    } catch (_) {}
  }
  function rememberChat(id) {
    if (id && /^[0-9a-f-]{8,36}$/i.test(String(id)) && id !== lastChat) {
      lastChat = String(id);
      try { sessionStorage.setItem('z16chat', lastChat); } catch (_) {}
    }
  }
  var warmed = false;
  function warmup(force) {
    if (warmed && !force) return Promise.resolve();
    warmed = true;
    /* прогрев WAF: получаем/обновляем acw_tc-куки браузерным запросом */
    return realFetch(ZAI + '/api/v1/auths/', { mode: 'no-cors', credentials: 'include' }).catch(function () {}).then(function () {});
  }
  warmup();

  /* сервер проверяет версию клиента: без этого заголовка стрим отвечает 426 «client outdated» */
  var FE_VERSION = 'prod-fe-1.1.98';
  function cfgWithFe(init) {
    var obj = {};
    try {
      var hs = init && init.headers;
      if (hs) {
        if (typeof hs.forEach === 'function') hs.forEach(function (v, k) { obj[k] = v; });
        else for (var k in hs) if (Object.prototype.hasOwnProperty.call(hs, k)) obj[k] = hs[k];
      }
    } catch (_) {}
    var has = false;
    for (var k2 in obj) if (String(k2).toLowerCase() === 'x-fe-version') has = true;
    if (!has) obj['X-FE-Version'] = FE_VERSION;
    var c = {};
    if (init) for (var k3 in init) if (Object.prototype.hasOwnProperty.call(init, k3)) c[k3] = init[k3];
    c.headers = obj;
    return c;
  }

  /* --- RAM-кэш медленных GET (модели/список чатов): переоткрытие мгновенно --- */
  var ramCache = new Map(); /* url -> {t, body} */
  var RAM_TTL_MODELS = 300000, RAM_TTL_CHATS = 60000, RAM_MAX = 16;
  function ramGet(url) {
    var e = ramCache.get(url);
    if (!e) return null;
    var ttl = url.indexOf('/models') !== -1 ? RAM_TTL_MODELS : RAM_TTL_CHATS;
    if (Date.now() - e.t > ttl) { ramCache.delete(url); return null; }
    return e.body;
  }
  function ramPut(url, body) {
    try {
      if (ramCache.size >= RAM_MAX) { /* LRU без утечек: удаляем самый старый */
        var oldest = null, ot = Infinity;
        ramCache.forEach(function (v, k) { if (v.t < ot) { ot = v.t; oldest = k; } });
        if (oldest) ramCache.delete(oldest);
      }
      ramCache.set(url, { t: Date.now(), body: body });
    } catch (_) {}
  }

  /* --- каталог плагинов: убираем дурацкие (презентации/время/счёт) из любого источника --- */
  var PLUGIN_BLOCK = /(презентац|\.pptx?|\bppt\b|калькулятор|конвертер|знание времени|точное время|секундомер|таймер|часы[ ,]|будильн)/i;
  function filterRegistry(text) {
    try {
      var j = JSON.parse(text);
      if (j && Array.isArray(j.plugins)) {
        var before = j.plugins.length;
        j.plugins = j.plugins.filter(function (p) { return !PLUGIN_BLOCK.test((p && p.name || '') + ' ' + (p && p.description || '')); });
        if (j.plugins.length !== before) {
          j.$note = 'ZaiChat: убраны плагины, дублирующие способности модели (презентации, счёт, время)';
          return JSON.stringify(j);
        }
      }
    } catch (_) {}
    return text;
  }

  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || String(input || '');
      var method = 'GET';
      try { method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase(); } catch (_) {}
      try { rememberToken(init && init.headers); } catch (_) {}
      if (typeof input === 'object' && input && input.headers) { try { rememberToken(input.headers); } catch (_) {} }

      /* лечим мёртвый прокси-фолбэк v15: /api/zai/* -> chat.z.ai/* (без двойного /api) */
      var mProxy = /^\/api\/zai\/(.*)$/.exec(url);
      if (mProxy) { url = ZAI + '/' + mProxy[1]; input = url; }

      /* каталог плагинов: фильтруем и основной (GitHub), и локальный источник */
      if (method === 'GET' && /registry\.json/.test(url)) {
        return realFetch(input, init).then(function (res) {
          try {
            return res.clone().text().then(function (t) {
              var ft = filterRegistry(t);
              if (ft !== t) return new Response(ft, { status: res.status, headers: res.headers });
              return res;
            }).catch(function () { return res; });
          } catch (_) { return res; }
        });
      }

      /* RAM-кэш: модели и страницы списка чатов */
      var cacheable = method === 'GET' && (url.indexOf('/api/v1/models') !== -1 ||
        /^https?:\/\/[^/]+\/api\/v1\/chats\/\?page=\d+$/.test(url));
      if (cacheable) {
        var hit = ramGet(url);
        if (hit) {
          try { return Promise.resolve(new Response(hit, { status: 200, headers: { 'Content-Type': 'application/json' } })); } catch (_) {}
        }
      }

      /* запоминаем id текущего чата (для «Поделиться» и «Перенести») */
      if (url.indexOf('/chat/completions') !== -1 && init && typeof init.body === 'string') {
        try {
          var bj = JSON.parse(init.body);
          rememberChat(bj && bj.chat_id);
        } catch (_) {}
      }
      var mCh = /\/api\/v[12]\/chats\/([0-9a-f-]{8,36})/i.exec(url);
      if (mCh) rememberChat(mCh[1]);

      var isZaiApi = url.indexOf(ZAI + '/api/') === 0 ||
        (/^\/api\//.test(url) && url.indexOf('/api/asr') !== 0);
      if (!isZaiApi || method === 'OPTIONS') return realFetch(input, init);

      /* --- движок ретраев: WAF 403/405 и перегрузка 429/5xx ---
         WAF-узлы отвечают по-разному (часть 405, часть 200) — вылечивается
         упорными повторами: каждый заход бьёт в другой узел балансера. */
      var attempt = 0;
      var MAX_TRY = 7;
      var DELAYS = [400, 700, 1200, 1800, 2600, 3800];
      var creds = (init && init.credentials) || 'same-origin';
      function cfgCopy() {
        var c = cfgWithFe(init);
        c.credentials = creds;
        return c;
      }
      function flip() { creds = creds === 'include' ? 'omit' : 'include'; }
      function wafRetry() {
        if (attempt >= MAX_TRY) return null;
        attempt++;
        toast(isEn() ? 'Server protection triggered — reconnecting (' + attempt + '/' + MAX_TRY + ")…" : 'Защита сервера сработала — переподключаюсь (' + attempt + '/' + MAX_TRY + ')…');
        flip();
        return warmup(true).then(function () { return sleep(DELAYS[Math.min(attempt - 1, DELAYS.length - 1)]); });
      }
      function run() {
        return realFetch(input, cfgCopy()).then(function (res) {
          var st = res.status;
          /* «ответ готов»/перегрузка по телу стрима — в фоне, не мешая приложению */
          if (res.ok && String(url).indexOf('/chat/completions') !== -1) {
            try {
              res.clone().text().then(function (body) {
                var tail = body.slice(-4000);
                if (/outdated|client version/i.test(tail)) {
                  toast(isEn() ? 'The server updated — restart the app to refresh compatibility' : 'Сервер обновился — перезапустите приложение, чтобы обновить совместимость');
                } else if (/перегруж|overloaded|too many|высокий спрос|high demand|попробуйте позже/i.test(tail)) {
                  toast(isEn() ? 'The model is overloaded — retry in a minute' : 'Модель сейчас перегружена — повторите запрос через минуту');
                } else {
                  answerReady();
                }
              }).catch(function () {});
            } catch (_) {}
          }
          if (res.ok && cacheable) {
            try { res.clone().text().then(function (t) { ramPut(url, t); }).catch(function () {}); } catch (_) {}
          }
          if (st < 400 || attempt >= MAX_TRY) {
            if (attempt >= MAX_TRY && (st === 429 || st === 502 || st === 503)) {
              toast(isEn() ? 'Model overloaded. Wait a minute and retry.' : 'Модель перегружена. Подождите минуту и повторите запрос.');
            }
            return res;
          }
          if (st === 403) {
            /* отличаем WAF-403 от честного «нужен аккаунт выше уровнем» */
            return res.clone().text().then(function (t) {
              if (/level|permission|уровень|token|auth|доступ/i.test(t)) return res;
              var p = wafRetry();
              return p ? p.then(run) : res;
            }).catch(function () { return res; });
          }
          if (st === 405 || st === 429 || st === 502 || st === 503 || st === 504) {
            if (st === 429 || st >= 502) {
              attempt++;
              toast(isEn() ? 'Model overloaded — retrying automatically (' + attempt + '/' + MAX_TRY + ')…' : 'Модель перегружена — автоматически повторяю (' + attempt + '/' + MAX_TRY + ')…');
              return sleep(900 + Math.floor(Math.random() * 600)).then(run);
            }
            var p2 = wafRetry();
            return p2 ? p2.then(run) : res;
          }
          return res;
        }, function (err) {
          if (err && err.name === 'AbortError') throw err;
          if (attempt >= MAX_TRY) throw err;
          attempt++;
          return sleep(DELAYS[Math.min(attempt - 1, DELAYS.length - 1)]).then(run);
        });
      }
      return run();
    } catch (e) {
      return realFetch(input, init);
    }
  };

  /* ================= 2. оповещения «ответ готов» ================= */
  var READY_RU = ['Ответ готов ✅', 'Модель ответила — глянь 📩', 'Готово! Ответ ждёт в чате', 'Ответ сформирован ✨', 'Есть результат — заходи 🙌'];
  var READY_EN = ['Reply is ready ✅', 'The model answered — take a look 📩', 'Done! The answer is in the chat', 'Response generated ✨', 'Result is here — check it 🙌'];
  function answerReady() {
    var pool = isEn() ? READY_EN : READY_RU;
    var msg = pool[Math.floor(Math.random() * pool.length)];
    toast(msg, 2600);
    vibrate([60, 40, 60]);
    /* приложение свёрнуто — уведомление как в ChatGPT (несколько вариантов фраз) */
    try {
      if (document.hidden && window.ZaiApp && typeof window.ZaiApp.notifyReady === 'function') {
        window.ZaiApp.notifyReady(isEn() ? 'Reply is ready' : 'Ответ готов', msg);
      }
    } catch (_) {}
  }

  /* ================= 3. рассуждения: Быстрое/Глубокое/Ультра + вниз + автозакрытие ================= */
  /* нативные подписи v15: Лоу/Медиум/Хай/Выключить — меняем на шкалу владельца:
     быстрое = Лоу, глубокое = Медиум, ультра = Хай (v19: и в меню, и на пилюле). */
  var THINK_RU = [
    { from: 'Лоу', to: 'Быстрое', desc: 'Минимум размышлений — отвечает быстрее всех' },
    { from: 'Медиум', to: 'Глубокое', desc: 'Тщательнее и точнее' },
    { from: 'Хай', to: 'Ультра', desc: 'Максимум качества' },
    { from: 'Выключить', to: 'Выключить', desc: 'Отвечает сразу, без размышлений' }
  ];
  var THINK_EN = [
    { from: 'Лоу', to: 'Fast', desc: 'Minimal reasoning — fastest answers' },
    { from: 'Медиум', to: 'Deep', desc: 'More thorough and precise' },
    { from: 'Хай', to: 'Ultra', desc: 'Maximum quality' },
    { from: 'Выключить', to: 'Off', desc: 'Answers instantly, no reasoning' }
  ];
  /* нативная пилюля: Ультра/Глубокие/Размышления(low&off) — помним, что выбрано */
  var PILL_RU = { 'Ультра': 'Высокое', 'Глубокие': 'Среднее' };
  var PILL_EN = { 'Ультра': 'High', 'Глубокие': 'Medium', 'Размышления': 'Think' };
  var thinkChosen = '';
  try { thinkChosen = sessionStorage.getItem('z16think') || ''; } catch (_) {}

  function closeThink() {
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); } catch (_) {}
    setTimeout(function () {
      try {
        var b = $('button[aria-label="Уровень размышлений"]');
        if (b && b.getAttribute('data-state') === 'open') b.click();
      } catch (_) {}
    }, 90);
  }
  /* меню размышлений ищем строго по триггеру: aria-controls -> контент -> обёртка.
     Никаких «первого попавшегося» поппера — раньше из-за этого меню съезжали. */
  function wrapperForTrigger(trigLabel) {
    var trig = $('button[aria-label="' + trigLabel + '"]');
    if (!trig) return null;
    var cid = trig.getAttribute('aria-controls');
    var content = cid ? document.getElementById(cid) : null;
    var wr = content ? content.closest('[data-radix-popper-content-wrapper]') : null;
    if (!wr) {
      /* запасной путь: открытый поппер рядом с триггером по подсказке текста */
      var hint = trigLabel === 'Выбрать модель' ? /Флагман|GLM|Баланс|свой API|fast/i
        : /Уровень размышлений|Лоу|Медиум|Хай|Выключить|Thinking level|Low|Medium|High|Off/i;
      var wrs = $$('[data-radix-popper-content-wrapper]');
      for (var i = 0; i < wrs.length; i++) {
        var r = wrs[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && hint.test(wrs[i].textContent || '')) { wr = wrs[i]; break; }
      }
    }
    if (!wr) return null;
    var state = trig.getAttribute('data-state') || trig.getAttribute('aria-expanded') || '';
    var open = state === 'open' || state === 'true';
    var rect = wr.getBoundingClientRect();
    if (!open || !(rect.width > 0)) return null;
    return { trig: trig, wr: wr };
  }
  function fixThinkMenu() {
    var pair = wrapperForTrigger('Уровень размышлений');
    if (!pair) return;
    var wr = pair.wr;
    var btns = $$('button', wr);
    var touched = false;
    btns.forEach(function (b) {
      var t = (b.textContent || '').trim();
      var map = isEn() ? THINK_EN : THINK_RU;
      for (var i = 0; i < map.length; i++) {
        if (t.indexOf(map[i].from) === 0) {
          touched = true;
          if (!b.__z16w) {
            b.__z16w = true;
            b.addEventListener('click', function () {
              try { thinkChosen = ['low', 'medium', 'high', 'off'][i]; sessionStorage.setItem('z16think', thinkChosen); } catch (_) {}
              vibrate(8);
              setTimeout(closeThink, 140); /* меню закрывается само после выбора */
            }, true);
          }
          /* заменяем и подпись, и описание (анти-мигание: меняем точечно текстовые узлы) */
          var texts = allText(b).filter(function (tn) { return tn.nodeValue.trim(); });
          if (texts[0] && texts[0].nodeValue.trim() === map[i].from) texts[0].nodeValue = map[i].to;
          if (texts[1]) {
            var cur = texts[1].nodeValue.trim();
            var isNativeDesc = /^Быстрые размышления|^Глубокие размышления|^Ультра: максимум|^Отвечает сразу/.test(cur) ||
              /^Fast|^Deep|^Ultra|^Answers instantly/.test(cur);
            if (isNativeDesc || b.__z16d !== map[i].to + '|' + map[i].desc) {
              texts[1].nodeValue = map[i].desc;
              b.__z16d = map[i].to + '|' + map[i].desc;
            }
          }
          break;
        }
      }
    });
    kickPin(); /* позицию держит rAF-пиннинг, не текстовые эвристики */
  }
  /* --- пилюля уровня: мгновенно, без дублей и без «неправильного названия» ---
     Нативные метки пилюли: Ультра / Глубокие / Размышления (и Лоу/Медиум/Хай).
     После выбора сайт сначала копирует подпись из нашего меню (правильную), потом
     перерисовывает нативную (неправильную) — лечим в кадре мутации, а не по таймеру. */
  var PILL_KNOWN = ['Ультра', 'Глубокие', 'Глубокое', 'Лоу', 'Медиум', 'Хай', 'Быстрые', 'Быстрое',
    'Размышления', 'Высокое', 'Среднее', 'Низкое', 'High', 'Medium', 'Low', 'Think', 'Off', 'Выключить'];
  /* v19: пилюля показывает то же, что выбрали в меню: Быстрое/Глубокое/Ультра.
     «Размышления» в выключенном состоянии остаётся как есть (нативная подпись off). */
  function pillWant(t) {
    if (isEn()) {
      if (t === 'Ультра' || t === 'Высокое' || t === 'Хай') return 'Ultra';
      if (t === 'Глубокие' || t === 'Глубокое' || t === 'Среднее' || t === 'Медиум') return 'Deep';
      if (t === 'Лоу' || t === 'Низкое' || t === 'Быстрые' || t === 'Быстрое') return 'Fast';
      if (t === 'Размышления' || t === 'Think') {
        if (thinkChosen === 'low') return 'Fast';
        if (thinkChosen === 'medium') return 'Deep';
        if (thinkChosen === 'high') return 'Ultra';
        return 'Think';
      }
      if (t === 'Выключить') return 'Off';
      return null;
    }
    if (t === 'Ультра' || t === 'High' || t === 'Высокое' || t === 'Хай') return 'Ультра';
    if (t === 'Глубокие' || t === 'Medium' || t === 'Среднее' || t === 'Медиум') return 'Глубокое';
    if (t === 'Лоу' || t === 'Low' || t === 'Низкое' || t === 'Быстрые') return 'Быстрое';
    if (t === 'Размышления' || t === 'Think') {
      if (thinkChosen === 'low') return 'Быстрое';
      if (thinkChosen === 'medium') return 'Глубокое';
      if (thinkChosen === 'high') return 'Ультра';
      return 'Размышления';
    }
    return null;
  }
  function splitDoubled(t) {
    for (var i = 0; i < PILL_KNOWN.length; i++) {
      var k = PILL_KNOWN[i];
      if (t.length === k.length * 2 && t.slice(0, k.length) === k && t.slice(k.length) === k) return k;
    }
    return null;
  }
  function fixThinkPill() {
    var b = $('footer button[aria-label="Уровень размышлений"]');
    if (!b) return;
    var t = (b.textContent || '').trim();
    if (!t) return;
    var half = splitDoubled(t); /* «ВысокоеВысокое» — подпись прописана 2 раза */
    var nodes = allText(b).filter(function (tn) { return tn.nodeValue.trim(); });
    var spans = $$('span', b).filter(function (sp) { return sp.textContent.trim(); });
    var placed = false;
    if (half) {
      var wantD = pillWant(half) || half;
      nodes.forEach(function (tn) {
        var v = tn.nodeValue.trim();
        if (v === half || v === t) {
          if (!placed) { tn.nodeValue = wantD; placed = true; } else tn.nodeValue = '';
        }
      });
      if (!placed) spans.forEach(function (sp) {
        var v = sp.textContent.trim();
        if (v === half || v === t) {
          if (!placed) { sp.textContent = wantD; placed = true; } else sp.textContent = '';
        }
      });
      return;
    }
    var want = pillWant(t);
    if (!want || want === t) return;
    nodes.forEach(function (tn) {
      if (tn.nodeValue.trim() === t) {
        if (!placed) { tn.nodeValue = want; placed = true; } else tn.nodeValue = '';
      }
    });
    if (!placed) spans.forEach(function (sp) {
      if (sp.textContent.trim() === t) {
        if (!placed) { sp.textContent = want; placed = true; } else sp.textContent = '';
      }
    });
  }

  /* --- меню моделей и размышлений: строго ВНИЗ от триггера, без прыжков и «багованности» ---
     Раньше позиция ставилась один раз по текстовой эвристике: меню успевало открыться
     в кривом месте и потом «прыгало». Теперь: триггер -> aria-controls -> его контент,
     позиция применяется rAF-циклом каждый кадр, пока меню открыто; при закрытии
     наши inline-стили снимаются, и Radix сам решает, как рисовать меню в следующий раз. */
  function pinPair(trigLabel, textHint) {
    var trig = $('button[aria-label="' + trigLabel + '"]');
    if (!trig) return null;
    var cid = trig.getAttribute('aria-controls');
    var content = cid ? document.getElementById(cid) : null;
    var wr = content ? content.closest('[data-radix-popper-content-wrapper]') : null;
    if (!wr && textHint) {
      var wrs = $$('[data-radix-popper-content-wrapper]');
      for (var i = 0; i < wrs.length; i++) {
        var rc = wrs[i].getBoundingClientRect();
        if (rc.width > 0 && textHint.test(wrs[i].textContent || '')) { wr = wrs[i]; break; }
      }
    }
    if (!wr) return null;
    return { trig: trig, wr: wr };
  }
  function isOpen(trig) {
    var state = trig.getAttribute('data-state') || trig.getAttribute('aria-expanded') || '';
    return state === 'open' || state === 'true';
  }
  function applyBelow(pair) {
    try {
      var r = pair.trig.getBoundingClientRect();
      var vw = window.innerWidth, vh = window.innerHeight;
      var wr = pair.wr;
      var cw = wr.offsetWidth || 260;
      var ch = wr.offsetHeight || 200;
      var left = Math.round(Math.max(8, Math.min(r.left, vw - cw - 8)));
      var top = Math.round(r.bottom + 8);
      var maxH = vh - top - 12;
      if (maxH < 140) {
        /* снизу не влезает (клавиатура/низ экрана) — открываем ВВЕРХ от триггера,
           а не прижимаем к низу поверх поля ввода (v19) */
        var bottom = Math.round(r.top - 6);
        maxH = Math.max(140, bottom - 12);
        top = Math.max(8, bottom - Math.min(ch, maxH));
      }
      var st = wr.style;
      st.setProperty('top', top + 'px', 'important');
      st.setProperty('left', left + 'px', 'important');
      st.setProperty('transform', 'none', 'important');
      st.setProperty('max-height', Math.round(Math.min(maxH, vh - 16)) + 'px', 'important');
      st.setProperty('overflow-y', 'auto', 'important');
      wr.classList.add('z16-pinned');
    } catch (_) {}
  }
  function releasePins() {
    $$('.z16-pinned').forEach(function (wr) {
      wr.classList.remove('z16-pinned');
      ['top', 'left', 'transform', 'max-height', 'overflow-y'].forEach(function (p) {
        try { wr.style.removeProperty(p); } catch (_) {}
      });
    });
  }
  /* --- v19: подменю открывается СРАЗУ в финальной позиции, без «сначала вправо, потом вниз» ---
     v18 ждал 120мс и сдвигал трансформом — пользователь ВИДЕЛ этот прыжок.
     Теперь: в кадре появления меню прячем (visibility:hidden), в следующем кадре
     (Radix уже всё расставил) ставим финальное место ПОД якорем и показываем.
     Наведённого прыжка нет: виден только финальный кадр. */
  function placeWr(wr) {
    try {
      var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      if (!vw || !vh) return;
      var w = wr.offsetWidth || wr.getBoundingClientRect().width || 260;
      var h = wr.offsetHeight || wr.getBoundingClientRect().height || 200;
      var left = null, top = null;
      /* якорь: у контента есть id, у триггера — aria-controls на этот id */
      var content = wr.firstElementChild;
      var cid = content && content.id;
      var anchor = cid ? $('[aria-controls="' + cid + '"]') : null;
      if (anchor && wr.classList.contains('z16-pinned')) return; /* пиннит pinFrame */
      if (anchor) {
        var ar = anchor.getBoundingClientRect();
        if (ar.width > 0) {
          left = Math.round(Math.max(8, Math.min(ar.left, vw - w - 8)));
          top = Math.round(ar.bottom + 6);
          var maxH = vh - top - 12;
          if (maxH < 140) { /* снизу не влезает — раскрываем ВВЕРХ от якоря */
            var bottom = Math.round(ar.top - 6);
            maxH = Math.max(140, bottom - 12);
            top = Math.max(8, bottom - Math.min(h, maxH));
          }
          if (top + h > vh - 8) h = vh - 8 - top;
          wr.style.setProperty('max-height', Math.round(Math.max(140, Math.min(h, maxH, vh - 16))) + 'px', 'important');
          wr.style.setProperty('overflow-y', 'auto', 'important');
        }
      }
      if (left === null) {
        var r = wr.getBoundingClientRect();
        left = Math.round(Math.min(Math.max(r.left, 8), vw - 8 - w));
        top = Math.round(Math.min(Math.max(r.top, 8), vh - 8 - h));
      }
      var st = wr.style;
      st.setProperty('left', left + 'px', 'important');
      st.setProperty('top', top + 'px', 'important');
      st.setProperty('transform', 'none', 'important');
    } catch (_) {}
  }
  function ensurePlaced(wr) {
    try {
      var r = wr.getBoundingClientRect();
      if (!(r.width > 0) || !(r.height > 0)) return;
      if (!wr.__z16seen) {
        /* первый кадр жизни меню: прячем, ставим финальное место, показываем */
        wr.__z16seen = true;
        wr.style.setProperty('visibility', 'hidden', 'important');
        requestAnimationFrame(function () {
          try {
            placeWr(wr);
            wr.style.setProperty('visibility', 'visible', 'important');
          } catch (_) { try { wr.style.setProperty('visibility', 'visible', 'important'); } catch (_2) {} }
        });
        return;
      }
      /* повторные вызовы (скролл и т.п.): зажимаем, если снова вылезло за экран */
      var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      if (r.left < 8 || r.right > vw - 8 || r.top < 8 || r.bottom > vh - 8) placeWr(wr);
    } catch (_) {}
  }
  function clampPoppers() {
    var wrs = $$('[data-radix-popper-content-wrapper]');
    for (var i = 0; i < wrs.length; i++) {
      if (wrs[i].classList && wrs[i].classList.contains('z16-pinned')) continue;
      ensurePlaced(wrs[i]);
    }
  }
  /* при скролле меню могло снова выехать за край — перезажимаем */
  try { window.addEventListener('scroll', function () { try { clampPoppers(); } catch (_) {} }, { capture: true, passive: true }); } catch (_) {}
  /* --- v19: повторный тап по открытому подменю-пункту («Другие модели») сворачивает его ---
     Radix на тач-экране не закрывает подменю по повторному тапу (только весь список) —
     синтезируем уход курсора, на который Radix реагирует сворачиванием. */
  function subToggleGuard() {
    if (window.__z16subT) return;
    window.__z16subT = true;
    document.addEventListener('pointerdown', function (e) {
      try {
        var el = e.target && e.target.closest ? e.target.closest('[role="menuitem"]') : null;
        if (!el || !el.closest('[data-radix-popper-content-wrapper]')) return;
        var open = el.getAttribute('aria-expanded') === 'true' || el.getAttribute('data-state') === 'open';
        if (!open) return;
        var o = { bubbles: true, pointerId: e.pointerId || 1, pointerType: 'mouse', isPrimary: true, clientX: e.clientX, clientY: e.clientY };
        el.dispatchEvent(new PointerEvent('pointerout', o));
        el.dispatchEvent(new PointerEvent('pointerleave', o));
        /* Radix закрывает подменю с задержкой-грацией — даём ему кадр */
        setTimeout(function () {
          try {
            var o2 = { bubbles: true, pointerId: e.pointerId || 1, pointerType: 'mouse', isPrimary: true, clientX: e.clientX, clientY: e.clientY };
            el.dispatchEvent(new PointerEvent('pointerout', o2));
            el.dispatchEvent(new PointerEvent('pointerleave', o2));
          } catch (_) {}
        }, 60);
        e.stopImmediatePropagation();
        e.preventDefault();
        vibrate(6);
      } catch (_) {}
    }, true);
  }
  /* --- v19: страховка закрытия — тап мимо меню, если Radix сам не закрыл за 150мс --- */
  function outsideCloseGuard() {
    if (window.__z16outC) return;
    window.__z16outC = true;
    document.addEventListener('pointerdown', function (e) {
      try {
        var wrs = $$('[data-radix-popper-content-wrapper]');
        if (!wrs.length) return;
        for (var i = 0; i < wrs.length; i++) {
          if (wrs[i].getBoundingClientRect().width > 0 && wrs[i].contains(e.target)) return;
        }
        var t = e.target;
        if (t && t.closest && t.closest('button, [role="menuitem"], [aria-haspopup], [aria-expanded], textarea, input')) return;
        setTimeout(function () {
          try {
            var still = $$('[data-radix-popper-content-wrapper]').filter(function (w) { return w.getBoundingClientRect().width > 0; });
            if (still.length) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
          } catch (_) {}
        }, 150);
      } catch (_) {}
    }, true);
  }
  var pinRaf = 0, pinIdle = 0;
  function pinFrame() {
    pinRaf = 0;
    var any = false;
    try {
      var modelPair = pinPair('Выбрать модель', /Флагман|GLM|Баланс|свой API|fast/i);
      if (modelPair && isOpen(modelPair.trig) && modelPair.wr.getBoundingClientRect().width > 0) {
        applyBelow(modelPair);
        any = true;
      }
      var thinkPair = pinPair('Уровень размышлений', null);
      if (thinkPair && isOpen(thinkPair.trig) && thinkPair.wr.getBoundingClientRect().width > 0) {
        applyBelow(thinkPair);
        any = true;
      }
      try { clampPoppers(); } catch (_) {} /* подменю и прочие попперы — в экран */
    } catch (_) {}
    if (any) {
      pinIdle = 0;
      pinRaf = requestAnimationFrame(pinFrame);
    } else if (pinIdle < 8) { /* пара кадров на случай, когда состояние ещё обновляется */
      pinIdle++;
      pinRaf = requestAnimationFrame(pinFrame);
    } else {
      releasePins();
    }
  }
  function kickPin() {
    if (!pinRaf) {
      pinIdle = 0;
      pinRaf = requestAnimationFrame(pinFrame);
    }
  }

  /* ================= 4. «Поделиться чатом» вместо «Новый чат» (справа сверху) ================= */
  function fixShareBtn() {
    /* после первой переименования aria-label уже не «Новый чат» — ищем по всем трём состояниям */
    var b = $('header button[aria-label="Новый чат"], header button[aria-label="Поделиться чатом"], header button[aria-label="Share chat"]');
    if (!b) return;
    var lbl = isEn() ? 'Share chat' : 'Поделиться чатом';
    if (b.getAttribute('aria-label') !== lbl) b.setAttribute('aria-label', lbl);
    b.setAttribute('title', lbl);
    var svg = $('svg', b);
    if (svg && !svg.__z16i) {
      svg.__z16i = true;
      svg.innerHTML = '<circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle>' +
        '<circle cx="18" cy="19" r="3"></circle><path d="m8.59 13.51 6.83 3.98"></path><path d="m15.41 6.51-6.82 3.98"></path>';
    }
    if (!b.__z16c) {
      b.__z16c = true;
      b.addEventListener('click', function (e) {
        e.stopImmediatePropagation();
        e.preventDefault();
        doShare();
      }, true);
    }
  }
  function doShare() {
    Promise.resolve().then(function () {
      if (!lastChat) {
        toast(isEn() ? 'Send a message first — then you can share the chat' : 'Сначала отправьте сообщение в чат — после этого чатом можно поделиться');
        return;
      }
      if (!lastToken) {
        toast(isEn() ? 'A link requires signing in — opening the login window…' : 'Для ссылки нужен вход в аккаунт — открываю окно входа…');
        try { window.dispatchEvent(new CustomEvent('zai-open-dialog', { detail: 'account' })); } catch (_) {}
        return;
      }
      toast(isEn() ? 'Preparing the link…' : 'Готовлю ссылку…', 1600);
      return window.fetch(ZAI + '/api/v1/chats/' + lastChat + '/share', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lastToken },
        body: '{}'
      }).then(function (res) {
        if (!res.ok) { toast(isEn() ? 'Could not create the link (' + res.status + '). Try again.' : 'Не удалось создать ссылку (' + res.status + '). Попробуйте ещё раз.'); return; }
        return res.json().catch(function () { return {}; }).then(function (d) {
          var sid = d && (d.share_id || d.id || d.slug);
          var link = 'https://chat.z.ai/s/' + (sid || lastChat);
          shareOut(link);
        });
      }).catch(function () { toast(isEn() ? 'Sharing failed — check the internet' : 'Не удалось поделиться — проверьте интернет'); });
    }).catch(function () {});
  }
  function shareOut(link) {
    try {
      if (navigator.share) {
        navigator.share({ title: 'Чат Z.ai', url: link }).then(function () {
          toast(isEn() ? 'Chat link sent ✅' : 'Ссылка на чат отправлена ✅');
        }).catch(function () {});
        return;
      }
    } catch (_) {}
    var ok = false;
    try { navigator.clipboard.writeText(link).then(function () { toast(isEn() ? 'Link copied — opens on the site and in the app' : 'Ссылка скопирована — откроется и на сайте, и в приложении', 4500); }, function () { copyFallback(link); }); ok = true; } catch (_) {}
    if (!ok) copyFallback(link);
  }
  function copyFallback(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      toast(ok ? (isEn() ? 'Link copied — opens on the site and in the app' : 'Ссылка скопирована — откроется и на сайте, и в приложении') : text, 6000);
    } catch (_) { toast(text, 8000); }
  }

  /* ================= 4b. «Перенести в новый чат» — полная картина для нового агента ================= */
  function addTransferBtn() {
    var header = $('header');
    if (!header) return;
    var share = $('header button[aria-label="Поделиться чатом"], header button[aria-label="Share chat"], header button[aria-label="Новый чат"]');
    if (!share || !share.parentElement) return;
    var mine = $('header button[aria-label="Перенести в новый чат"], header button[aria-label="Continue in new chat"]');
    if (mine) { if (isEn() && mine.getAttribute('aria-label') !== 'Continue in new chat') { mine.setAttribute('aria-label', 'Continue in new chat'); mine.title = 'Continue in new chat'; } return; }
    var b = document.createElement('button');
    b.type = 'button';
    b.className = share.className || '';
    b.setAttribute('aria-label', isEn() ? 'Continue in new chat' : 'Перенести в новый чат');
    b.title = isEn() ? 'Continue in new chat' : 'Перенести в новый чат';
    b.style.cssText = 'display:flex;align-items:center;justify-content:center;flex-shrink:0;width:36px;height:36px;padding:0'; /* не сжимает шапку */
    b.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4c5 0 7 2.2 7 6 0 4.6-2.6 7.8-8.1 7.8H9"/><path d="m12 14-4 4 4 4"/><path d="M9 14H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1"/></svg>';
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      transferChat();
    }, true);
    try { share.parentElement.insertBefore(b, share); } catch (_) { share.parentElement.appendChild(b); }
  }

  function msgText(c) {
    try {
      if (typeof c === 'string') return c;
      if (Array.isArray(c)) return c.map(function (p) {
        if (typeof p === 'string') return p;
        return (p && (p.text || p.content)) || '';
      }).join('\n');
      if (c && typeof c === 'object') return c.text || c.content || '';
    } catch (_) {}
    return String(c || '');
  }

  function buildHandoff(msgs) {
    var head = isEn()
      ? 'Chat handoff from ZaiChat. Continue this conversation from where it stopped, keeping full context. History:'
      : 'Перенос чата из приложения ZaiChat. Продолжи этот диалог с того места, где он остановился, сохранив весь контекст. История:';
    var lines = [head, ''];
    var n = 0;
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i] || {};
      var role = m.role === 'user' ? (isEn() ? 'User' : 'Пользователь') : (isEn() ? 'AI' : 'ИИ');
      var txt = msgText(m.content).trim();
      if (!txt) continue;
      n++;
      lines.push(n + '. ' + role + ': ' + txt);
    }
    var out = lines.join('\n');
    if (out.length > 14000) out = '…' + out.slice(-13800);
    return { text: out, count: n };
  }

  function transferChat() {
    Promise.resolve().then(function () {
      if (!lastToken) {
        toast(isEn() ? 'Transfer requires signing in (menu → Z.ai account)' : 'Для переноса нужен вход в аккаунт (меню → Аккаунт Z.ai)');
        return;
      }
      if (!lastChat) {
        toast(isEn() ? 'Send a message first — then the chat can be transferred' : 'Сначала отправьте сообщение в чат — после этого его можно перенести');
        return;
      }
      toast(isEn() ? 'Collecting the chat…' : 'Собираю чат…', 1500);
      return window.fetch(ZAI + '/api/v1/chats/' + lastChat, {
        credentials: 'include',
        headers: { 'Authorization': 'Bearer ' + lastToken }
      }).then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        return res.json();
      }).then(function (d) {
        var msgs = (d && (d.messages || (d.chat && d.chat.messages) || d.history)) || [];
        if (!Array.isArray(msgs) || !msgs.length) throw new Error('empty');
        var h = buildHandoff(msgs);
        if (!h.count) throw new Error('empty');
        deliverHandoff(h.text);
      }).catch(function () {
        /* запасной путь — собираем видимые сообщения прямо из DOM */
        var h = buildHandoffFromDom();
        if (h.count < 2) {
          toast(isEn() ? 'Could not collect the chat — try again in a moment' : 'Не удалось собрать чат — попробуйте ещё раз через мгновение');
          return;
        }
        deliverHandoff(h.text);
      });
    }).catch(function () {});
  }

  function buildHandoffFromDom() {
    /* сообщения в v15: блоки внутри main; пользовательские — с классом пузыря, ИИ — длинные */
    var msgs = [];
    try {
      var main = $('main');
      var nodes = $$('main div[class*="whitespace-pre-wrap"], main .markdown-body, main [data-message]');
      nodes.forEach(function (el) {
        var t = (el.textContent || '').trim();
        if (t.length < 2) return;
        var isUser = !!el.closest('div[class*="justify-end"], div[class*="ml-auto"], div[class*="bg-primary"]');
        msgs.push({ role: isUser ? 'user' : 'assistant', content: t });
      });
      if (msgs.length > 40) msgs = msgs.slice(-40);
    } catch (_) {}
    return buildHandoff(msgs);
  }

  function deliverHandoff(text) {
    /* копия в буфер — страховка */
    try { navigator.clipboard.writeText(text).catch(function () {}); } catch (_) {}
    /* открываем новый чат кнопкой сайдбара и вставляем текст переноса */
    var opened = false;
    try {
      var btns = $$('aside button, div[class*="bg-sidebar"] button');
      for (var i = 0; i < btns.length; i++) {
        if ((btns[i].textContent || '').trim() === (isEn() ? 'New chat' : 'Новый чат')) {
          btns[i].click();
          opened = true;
          break;
        }
      }
    } catch (_) {}
    setTimeout(function () {
      var ta = $('footer textarea');
      if (ta) {
        setNativeValue(ta, text);
        ta.focus();
        toast(isEn()
          ? 'Transfer ready: the whole history is in the input — press send'
          : 'Перенос готов: вся история в поле ввода — отправьте сообщение', 5200);
      } else {
        copyFallback(text);
        toast(isEn() ? 'Transfer text copied — paste it into a new chat' : 'Текст переноса скопирован — вставьте его в новый чат', 5200);
      }
    }, opened ? 450 : 0);
  }

  /* ================= 5. микрофон: независимый голосовой ввод ================= */
  var micState = 'idle', mediaRec = null, micChunks = [], micStream = null, recog = null;
  function micBtn() { return $('footer button[aria-label="Голосовой ввод"]'); }
  function fixMic() {
    var b = micBtn();
    if (!b || b.__z16m) return;
    b.__z16m = true;
    b.addEventListener('click', function (e) {
      e.stopImmediatePropagation();
      e.preventDefault();
      micClick(b);
    }, true);
  }
  function micClick(btn) {
    if (micState === 'recording') { stopMic(); return; }
    if (micState !== 'idle') return;
    /* 1) нативное распознавание Android (Google) — не зависит от хостинга и работает точнее;
       2) Web Speech API; 3) запись + ASR Z.ai */
    try {
      if (window.ZaiApp && typeof window.ZaiApp.nativeSpeechAvailable === 'function'
          && typeof window.ZaiApp.startNativeSpeech === 'function' && window.ZaiApp.nativeSpeechAvailable()) {
        startNative(btn);
        return;
      }
    } catch (_) {}
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) startSpeechAPI(btn); else startRecorder(btn);
  }
  function startNative(btn) {
    try {
      var got = false;
      window.__z16Speech = function (text, isFinal, kind) {
        try {
          if (kind === 'started') {
            micState = 'recording'; micVisual(true);
            toast(isEn() ? 'Listening… tap the mic again to stop' : 'Слушаю… нажмите на микрофон ещё раз, чтобы остановить', 2400);
            return;
          }
          if (kind === 'error') {
            if (!got) { toast(isEn() ? 'Native speech failed — falling back' : 'Нативная речь не сработала — включаю запасной способ', 3000); micState = 'idle'; micVisual(false); var SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (SR) startSpeechAPI(btn); else startRecorder(btn); }
            return;
          }
          if (text && text.trim()) { got = true; fillInput(text.trim()); }
          if (isFinal) {
            micState = 'idle'; micVisual(false);
            try { window.ZaiApp.stopNativeSpeech(); } catch (_) {}
            if (!got) toast(isEn() ? 'Speech not recognized — try again' : 'Речь не распознана — попробуйте ещё раз');
          }
        } catch (_) {}
      };
      window.ZaiApp.startNativeSpeech();
    } catch (_) {
      var SR2 = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR2) startSpeechAPI(btn); else startRecorder(btn);
    }
  }
  function micVisual(on) {
    var b = micBtn();
    if (b) b.classList[on ? 'add' : 'remove']('z16-rec');
  }
  function fillInput(text) {
    var ta = $('footer textarea');
    if (ta) { setNativeValue(ta, text); ta.focus(); }
  }
  function startSpeechAPI(btn) {
    try {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      recog = new SR();
      recog.lang = isEn() ? 'en-US' : 'ru-RU';
      recog.interimResults = true;
      recog.maxAlternatives = 1;
      var finalText = '';
      recog.onresult = function (ev) {
        var interim = '', fin = '';
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) fin += ev.results[i][0].transcript;
          else interim += ev.results[i][0].transcript;
        }
        if (fin) finalText += fin;
        fillInput((finalText + interim).trim());
      };
      recog.onend = function () {
        micState = 'idle'; micVisual(false);
        recog = null; /* без утечек */
        if (!finalText && !$('footer textarea').value) toast(isEn() ? 'Speech not recognized — try again' : 'Речь не распознана — попробуйте ещё раз');
      };
      recog.onerror = function () { micState = 'idle'; micVisual(false); recog = null; };
      micState = 'recording'; micVisual(true);
      toast(isEn() ? 'Listening… tap the mic again to stop' : 'Слушаю… нажмите на микрофон ещё раз, чтобы остановить', 2400);
      recog.start();
    } catch (_) { startRecorder(btn); }
  }
  function startRecorder(btn) {
    try {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        micStream = stream;
        var mt = MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
        mediaRec = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined);
        micChunks = [];
        mediaRec.ondataavailable = function (ev) { if (ev.data && ev.data.size) micChunks.push(ev.data); };
        mediaRec.onstop = function () {
          micState = 'idle'; micVisual(false);
          try { micStream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
          try { micStream = null; } catch (_) {}
          var blob = new Blob(micChunks, { type: (mediaRec && mediaRec.mimeType) || 'audio/webm' });
          micChunks = []; /* освобождаем память */
          try { mediaRec = null; } catch (_) {}
          if (blob.size < 1200) return;
          transcribeBlob(blob);
        };
        mediaRec.start(400);
        micState = 'recording'; micVisual(true);
        toast(isEn() ? 'Recording… tap the mic again to stop' : 'Записываю… нажмите на микрофон ещё раз, чтобы остановить', 2400);
      }).catch(function () {
        toast(isEn() ? 'No microphone access. Allow it in app/browser settings.' : 'Нет доступа к микрофону. Разрешите его в настройках приложения/браузера.');
      });
    } catch (_) { toast(isEn() ? 'Microphone is unavailable in this browser' : 'Микрофон недоступен в этом браузере'); }
  }
  function stopMic() {
    try { if (window.ZaiApp && window.ZaiApp.stopNativeSpeech) window.ZaiApp.stopNativeSpeech(); } catch (_) {}
    try { window.__z16Speech = null; } catch (_) {}
    try { recog && recog.stop && recog.stop(); } catch (_) {}
    try { mediaRec && mediaRec.state !== 'inactive' && mediaRec.stop(); } catch (_) {}
  }
  function transcribeBlob(blob) {
    if (!lastToken) {
      toast(isEn()
        ? 'Speech recognition works after signing in to a Z.ai account (menu → Account).'
        : 'Распознавание речи работает после входа в аккаунт Z.ai (меню → Аккаунт).', 5200);
      return;
    }
    toast(isEn() ? 'Transcribing…' : 'Распознаю речь…', 9000);
    var fd = new FormData();
    fd.append('file', blob, 'speech.webm');
    window.fetch(ZAI + '/api/v1/audio/transcriptions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Authorization': 'Bearer ' + lastToken },
      body: fd
    }).then(function (res) {
      if (!res.ok) { toast(isEn() ? 'Could not transcribe (' + res.status + '). Type it manually.' : 'Распознать не удалось (' + res.status + '). Введите текст вручную.'); return; }
      return res.json().catch(function () { return {}; }).then(function (d) {
        var t = d && (d.text || d.transcript || (d.data && d.text)) || '';
        if (t) { fillInput(String(t).trim()); toast(isEn() ? 'Done — text is in the input' : 'Готово — текст в поле ввода'); }
        else toast(isEn() ? 'The service returned no text' : 'Сервис не вернул текст');
      });
    }).catch(function () { toast(isEn() ? 'Transcription unavailable — check the internet' : 'Распознавание недоступно — проверьте интернет'); });
  }

  /* ================= 6. подсказки: база 36, ротация со временем ================= */
  var POOL_RU = [
    'Придумай 5 идей для поста в блог о путешествиях',
    'Объясни квантовую физику простыми словами',
    'Составь план тренировок на неделю дома без оборудования',
    'Напиши вежливое письмо начальнику про отпуск',
    'Что приготовить из курицы и риса на ужин?',
    'Придумай сказку про дракона, который боялся огня',
    'Как выучить английский самостоятельно за 3 месяца?',
    'Придумай слоган для новой кофейни',
    'Чем ИИ отличается от нейросети — объясни как другу',
    'Составь маршрут по Санкт-Петербургу на 3 дня',
    'Проведи тренировочное собеседование на менеджера',
    'Напиши скрипт на Python, который сортирует файлы в папке',
    'Придумай имя коту — вредному и рыжему',
    'Как экономить на продуктах без потери качества?',
    'Сделай краткий конспект теории относительности',
    'Подбери 10 идей подарков другу до 2000 рублей',
    'Объясни разницу между HTTP и HTTPS на примере delivery',
    'Составь чек-лист для поездки в горы на 5 дней',
    'Придумай 7 заголовков для статьи про здоровый сон',
    'Напиши функцию, которая проверяет палиндром — с тестами',
    'Разбери плюсы и минусы удалённой работы',
    'Составь недельное меню на 2000 рублей на одного',
    'Объясни, как работают проценты по кредиту — с примером',
    'Придумай сценарий короткого видео про утреннюю рутину',
    'Сделай таблицу сравления iPhone и Android для пенсионера',
    'Напиши поздравление коллеге с повышением — с юмором',
    'Как начать бегать с нуля и не бросить — план на месяц',
    'Придумай 10 названий для телеграм-канала про книги',
    'Объясни ребёнку, почему небо голубое',
    'Составь план изучения Python с нуля до первой работы',
    'Помоги составить резюме для первой работы в IT',
    'Придумай легенду для вымышленного города в горах',
    'Напиши отзыв о кафе так, чтобы это было смешно',
    'Составь список из 10 вопросов для интервью с предпринимателем',
    'Объясни, что такое блокчейн, на примере тетрадки',
    'Придумай 5 вариантов досуга для дождливых выходных дома'
  ];
  var POOL_EN = [
    'Give me 5 blog post ideas about travel',
    'Explain quantum physics in simple words',
    'Make a 1-week home workout plan, no equipment',
    'Write a polite vacation request email to my boss',
    'What can I cook from chicken and rice for dinner?',
    'Write a fairy tale about a dragon afraid of fire',
    'How to learn English on my own in 3 months?',
    'Come up with a slogan for a new coffee shop',
    'Explain the difference between AI and a neural network',
    'Plan a 3-day route around San Francisco',
    'Run a mock job interview for a manager role',
    'Write a Python script that sorts files in a folder',
    'Suggest a name for a grumpy orange cat',
    'How to save on groceries without losing quality?',
    'Summarize the theory of relativity briefly',
    'Suggest 10 gift ideas for a friend under $50',
    'Explain HTTP vs HTTPS with a delivery-service analogy',
    'Make a 5-day mountain trip checklist',
    'Suggest 7 headlines for an article on healthy sleep',
    'Write a palindrome checker function — with tests',
    'List pros and cons of remote work',
    'Plan a week of meals on a tight budget',
    'Explain how loan interest works — with an example',
    'Write a short-video script about a morning routine',
    'Write a funny yet positive review of a cafe',
    'How to start running and not quit — a 1-month plan',
    'Suggest 10 names for a book-themed Telegram channel',
    'Explain to a child why the sky is blue',
    'Plan learning Python from zero to a first job',
    'Help me write a resume for a first IT job',
    'Invent a legend for a fictional mountain town',
    'Explain blockchain using a notebook analogy',
    'Suggest 5 rainy-weekend activities at home',
    'Write 10 interview questions for an entrepreneur',
    'Compare iPhone vs Android in a simple table',
    'Brainstorm weekend project ideas for a developer'
  ];
  var curSet = [];
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function findWelcomeGrid() {
    var gs = $$('main div.grid');
    for (var i = 0; i < gs.length; i++) {
      if ($$('button', gs[i]).length >= 4 && $('.line-clamp-2', gs[i])) return gs[i];
    }
    return null;
  }
  function reapplySuggestions(grid) {
    var bs = $$('button', grid);
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (i < curSet.length) {
        var want = curSet[i];
        if (b.getAttribute('data-z16t') !== want) {
          b.setAttribute('data-z16t', want);
          var sp = $('.line-clamp-2', b);
          if (sp && sp.textContent !== want) sp.textContent = want;
        }
      } else if (b.getAttribute('data-z16t')) {
        b.removeAttribute('data-z16t'); /* лишних кнопок больше нет — но на всякий случай */
      }
    }
  }
  function fixSuggestions() {
    var grid = findWelcomeGrid();
    if (!grid) return;
    if (!grid.__z16g) {
      grid.__z16g = true;
      /* КЛОНОВ БОЛЬШЕ НЕТ: ровно 4 нативные подсказки — сетка не растягивается,
         как раньше (8 клонов = «съезжают менюшки и кнопки»), и подсказок ровно 4. */
      grid.addEventListener('click', function (e) {
        var b = e.target && e.target.closest && e.target.closest('button');
        if (!b || !grid.contains(b)) return;
        var t = b.getAttribute('data-z16t');
        if (!t) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        fillInput(t);
        vibrate(6);
      }, true);
    }
    if (!curSet.length) curSet = shuffle((isEn() ? POOL_EN : POOL_RU).slice()).slice(0, 4);
    reapplySuggestions(grid);
  }
  function rotateSuggestions() {
    try {
      var g = findWelcomeGrid();
      if (g && g.__z16g && g.getBoundingClientRect().height > 0) {
        curSet = shuffle((isEn() ? POOL_EN : POOL_RU).slice()).slice(0, 4);
        reapplySuggestions(g);
      }
    } catch (_) {}
  }
  setInterval(rotateSuggestions, 120000); /* ротация раз в 2 минуты */
  try {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) rotateSuggestions();
    });
  } catch (_) {}

  /* ================= 7. плагины: каталог виден ЦЕЛИКОМ, без дурацких =================
     v18: раньше показывали 6 карточек, а остальные 9 прятали за «Загрузить ещё» —
     владелец не находил свои плагины и решал, что их «не добавили». Теперь весь
     список виден сразу (диалог скроллится), глупые карточки по-прежнему прячем. */
  function fixPlugins() {
    var hs = $$('h2');
    var h = null;
    for (var i = 0; i < hs.length; i++) if (hs[i].textContent.trim() === (isEn() ? 'Plugins' : 'Плагины')) { h = hs[i]; break; }
    if (!h) return;
    var root = h.closest('[role="dialog"]') || h.parentElement;
    if (!root) return;
    /* карточки «презентации/счёт/время» прячем в самом диалоге (страховка к фильтру fetch) */
    if (root.__z16hide) return;
    root.__z16hide = true;
    setTimeout(function () {
      try {
        var cards = $$('button', root).map(function (b) {
          return b.closest('div[class*="rounded-2xl"], div[class*="rounded-xl"]');
        }).filter(function (c, i, arr) { return c && arr.indexOf(c) === i; });
        cards.forEach(function (c) {
          var t = (c.textContent || '');
          if (PLUGIN_BLOCK.test(t)) c.style.display = 'none';
        });
      } catch (_) {}
    }, 60);
  }

  /* ================= 8. вход: без гостя, понятнее и безопаснее ================= */
  /* ГОСТЯ БОЛЬШЕ НЕТ: кнопка «Быстрый вход (гость Z.ai)» убирается, а гостевой
     токен, снятый со страницы входа на полпути, отбрасывается (guard ниже). */
  function fixLogin() {
    var hs = $$('h2');
    var h = null;
    for (var i = 0; i < hs.length; i++) if (hs[i].textContent.trim() === (isEn() ? 'Z.ai account' : 'Аккаунт Z.ai')) { h = hs[i]; break; }
    if (!h) return;
    var root = h.closest('[role="dialog"]') || h.parentElement;
    if (!root) return;
    if (!root.__z16l) {
      root.__z16l = true;
      /* 1) удаляем кнопку гостевого входа — смысла в нём нет */
      $$('button', root).forEach(function (b) {
        var t = (b.textContent || '').trim();
        if (/Быстрый вход \(гость|guest/i.test(t)) { b.style.display = 'none'; }
        if (t.indexOf('Войти на сайте Z.ai') === 0) {
          allText(b).forEach(function (tn) {
            if (tn.nodeValue.indexOf('Войти на сайте Z.ai') !== -1) {
              tn.nodeValue = tn.nodeValue.replace('Войти на сайте Z.ai (Google / email)',
                isEn() ? 'Sign in via Z.ai — automatic (in the app)' : 'Войти через Z.ai — автоматически (в приложении)');
            }
          });
        }
      });
      /* 2) пояснение про безопасность */
      var note = document.createElement('p');
      note.className = 'z16-note';
      note.style.cssText = 'margin-top:12px;font-size:11px;line-height:1.5;opacity:.55';
      note.textContent = window.ZaiApp
        ? (isEn()
          ? 'Sign-in happens inside the app: the Z.ai page opens, the token is captured automatically. Guest mode is disabled. The token stays on this device and is sent only to Z.ai servers.'
          : 'Вход проходит внутри приложения: откроется страница Z.ai, токен подхватится автоматически. Гостевого режима больше нет. Токен хранится только на этом устройстве и отправляется только серверам Z.ai.')
        : (isEn()
          ? 'Tip: in the ZaiChat app signing in takes one tap. Here: sign in on chat.z.ai and paste the token. The token stays on this device and is sent only to Z.ai servers.'
          : 'Совет: в приложении ZaiChat вход происходит в один тап. Здесь же: войдите на chat.z.ai и вставьте токен. Токен хранится только на этом устройстве и отправляется только серверам Z.ai.');
      var acc = $$('button', root).filter(function (b) { return (b.textContent || '').indexOf('Как получить токен') === 0; })[0];
      var anchor = acc || $$('button', root).filter(function (b) { return (b.textContent || '').indexOf('Войти по токену') === 0; })[0];
      try {
        if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(note, anchor);
        else root.appendChild(note);
      } catch (_) { try { root.appendChild(note); } catch (_2) {} }
    }
  }
  /* сайдбар: вместо «Гость» — честная подпись (в обе стороны при смене языка) */
  function fixGuestLabel() {
    var want = isEn() ? 'Not signed in' : 'Вход не выполнен';
    $$('aside p, div[class*="bg-sidebar"] p').forEach(function (p) {
      var t = p.textContent.trim();
      if ((t === 'Гость' || t === 'Not signed in' || t === 'Вход не выполнен') && t !== want) {
        p.textContent = want;
      }
    });
  }
  /* гвардия: гостевой токен с чужой страницы входа не считается входом */
  function guardTokenBridge() {
    try {
      if (window.__z16TokGuard) return;
      window.__z16TokGuard = true;
      var wrap = function (fn) {
        return function (token) {
          try {
            if (isGuestJwt(token)) {
              toast(isEn() ? 'Guest token ignored — finish signing in to your account' : 'Гостевой токен проигнорирован — завершите вход в свой аккаунт', 4200);
              return;
            }
          } catch (_) {}
          return fn.apply(null, arguments);
        };
      };
      if (typeof window.__onZaiToken === 'function') {
        window.__onZaiToken = wrap(window.__onZaiToken);
      } else {
        var val = null;
        try {
          Object.defineProperty(window, '__onZaiToken', {
            configurable: false,
            get: function () { return val && wrap(val); },
            set: function (v) { val = v; }
          });
        } catch (_) { window.__onZaiToken = null; }
      }
    } catch (_) {}
  }

  /* ================= 9. переименование чата ================= */
  function renameChatApi(chatId, title) {
    var doFallback = function () {
      return window.fetch(ZAI + '/api/v1/chats/' + chatId, {
        credentials: 'include', headers: { 'Authorization': 'Bearer ' + lastToken }
      }).then(function (r) {
        if (!r.ok) throw new Error('get ' + r.status);
        return r.json();
      }).then(function (chat) {
        chat.title = title;
        return window.fetch(ZAI + '/api/v1/chats/' + chatId, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lastToken },
          body: JSON.stringify(chat)
        });
      });
    };
    return window.fetch(ZAI + '/api/v1/chats/' + chatId, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lastToken },
      body: JSON.stringify({ title: title })
    }).then(function (r) {
      if (r.ok) return r;
      return doFallback();
    });
  }

  function showRenameDialog(currentTitle, onOk) {
    try {
      var old = $('.z16-rename-wrap');
      if (old) old.remove();
      var wrap = document.createElement('div');
      wrap.className = 'z16-rename-wrap';
      wrap.innerHTML = '<div class="z16-rename-card" role="dialog" aria-modal="true">' +
        '<p class="z16-rename-title"></p>' +
        '<input class="z16-rename-input" type="text" maxlength="120" />' +
        '<div class="z16-rename-row">' +
        '<button type="button" class="z16-rename-ok"></button>' +
        '<button type="button" class="z16-rename-cancel"></button>' +
        '</div></div>';
      $('.z16-rename-title', wrap).textContent = isEn() ? 'Rename chat' : 'Переименовать чат';
      $('.z16-rename-ok', wrap).textContent = isEn() ? 'Save' : 'Сохранить';
      $('.z16-rename-cancel', wrap).textContent = isEn() ? 'Cancel' : 'Отмена';
      var inp = $('.z16-rename-input', wrap);
      inp.value = currentTitle || '';
      document.body.appendChild(wrap);
      setTimeout(function () { inp.focus(); inp.select(); }, 50);
      var close = function () { try { wrap.remove(); } catch (_) {} };
      $('.z16-rename-cancel', wrap).addEventListener('click', close);
      wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
      var ok = $('.z16-rename-ok', wrap);
      ok.addEventListener('click', function () {
        var v = inp.value.trim();
        if (v) { close(); onOk(v); }
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); ok.click(); }
        if (e.key === 'Escape') close();
      });
    } catch (_) {}
  }

  function fixChatMenu() {
    /* в «Меню чата» (у каждого чата в сайдбаре) добавляем «Переименовать» */
    var menus = $$('[data-radix-popper-content-wrapper] [role="menu"], [data-radix-popper-content-wrapper] > div');
    menus.forEach(function (m) {
      if (m.__z16r) return;
      var del = $$('button', m).filter(function (b) { return (b.textContent || '').trim() === (isEn() ? 'Delete' : 'Удалить'); })[0];
      if (!del || !m.contains(del)) return;
      m.__z16r = true;
      var item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.className = del.className;
      item.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>' +
        '<span></span>';
      $('span', item).textContent = isEn() ? 'Rename' : 'Переименовать';
      item.addEventListener('click', function (e) {
        try {
          e.preventDefault();
          e.stopPropagation();
          /* чат, которому принадлежит меню: ищем item сайдбара рядом с открытой позицией */
          var itemEl = del.closest('[data-radix-popper-content-wrapper]');
          var chatId = lastChat;
          var curTitle = '';
          /* приоритет: подсвеченный (активный) чат в сайдбаре */
          var active = $('div[class*="bg-sidebar"] [class*="bg-sidebar-accent"], aside [class*="bg-sidebar-accent"]');
          var host = active || null;
          var label = '';
          if (host) {
            var p = host.querySelector('p, span');
            label = (host.textContent || '').trim();
          }
          if (!label) label = (del.closest('div') && document.querySelector('main h1, main [class*="truncate"]') || {}).textContent || '';
          showRenameDialog(label.replace(/Удалить|Delete|Переименовать|Rename/g, '').trim(), function (newTitle) {
            onRenamed(chatId, newTitle, active);
          });
          try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); } catch (_) {}
        } catch (_) {}
      }, true);
      try { del.parentElement.insertBefore(item, del); } catch (_) { m.appendChild(item); }
    });
  }
  function onRenamed(chatId, newTitle, sideItem) {
    vibrate(8);
    /* мгновенно обновляем подпись в сайдбаре */
    try {
      if (sideItem) {
        var tn = sideItem.querySelector('span, p');
        var target = null;
        var sps = sideItem.querySelectorAll('span, p');
        for (var i = 0; i < sps.length; i++) if (sps[i].textContent.trim().length > 1) { target = sps[i]; break; }
        if (target) target.textContent = newTitle;
      }
    } catch (_) {}
    if (chatId && lastToken) {
      renameChatApi(chatId, newTitle).then(function () {
        toast(isEn() ? 'Chat renamed ✅' : 'Чат переименован ✅');
      }).catch(function () {
        toast(isEn() ? 'Could not rename on the server — the title will update locally' : 'Сервер не смог переименовать — название изменено локально');
      });
    } else {
      toast(isEn() ? 'Chat renamed locally' : 'Название изменено локально');
    }
  }

  /* ================= 10. переключатель языка в настройках и в аккаунте ================= */
  function addLangRow(root) {
    if (!root || root.__z16lang) return;
    root.__z16lang = true;
    var row = document.createElement('div');
    row.className = 'z16-lang-row';
    row.innerHTML = '<p class="z16-lang-label"></p>' +
      '<div class="z16-lang-seg">' +
      '<button type="button" data-l="ru">Русский</button>' +
      '<button type="button" data-l="en">English</button>' +
      '</div>' +
      '<p class="z16-lang-hint"></p>';
    $('.z16-lang-label', row).textContent = isEn() ? 'Interface language' : 'Язык интерфейса';
    $('.z16-lang-hint', row).textContent = isEn() ? 'Applies immediately' : 'Применяется сразу';
    var mark = function () {
      $$('button', row).forEach(function (b) {
        var on = b.getAttribute('data-l') === lang;
        b.className = 'z16-lang-btn' + (on ? ' z16-lang-on' : '');
      });
    };
    mark();
    row.addEventListener('click', function (e) {
      var b = e.target && e.target.closest && e.target.closest('button[data-l]');
      if (!b) return;
      setLang(b.getAttribute('data-l'));
      vibrate(6);
      mark();
      $('.z16-lang-label', row).textContent = isEn() ? 'Interface language' : 'Язык интерфейса';
      $('.z16-lang-hint', row).textContent = isEn() ? 'Applies immediately' : 'Применяется сразу';
    });
    var anchor = root.querySelector('.space-y-5');
    try {
      if (anchor) anchor.appendChild(row); else root.appendChild(row);
    } catch (_) { try { root.appendChild(row); } catch (_2) {} }
  }
  function fixSettingsLang() {
    $$('h2').forEach(function (h) {
      var t = h.textContent.trim();
      if (t === (isEn() ? 'Settings' : 'Настройки') || t === (isEn() ? 'Z.ai account' : 'Аккаунт Z.ai')) {
        addLangRow(h.closest('[role="dialog"]') || h.parentElement);
      }
    });
  }

  /* --- v19: единый вид пилюль — «Поиск» в снапшоте без aria-label, помечаем классом --- */
  function fixPills() {
    var fb = $$('footer button');
    for (var i = 0; i < fb.length; i++) {
      var t = (fb[i].textContent || '').trim();
      if ((t === 'Поиск' || t === 'Search') && !fb[i].classList.contains('z16-pill')) {
        fb[i].classList.add('z16-pill');
      }
    }
  }

  /* ================= движок наблюдения ================= */
  try { subToggleGuard(); } catch (_) {}
  try { outsideCloseGuard(); } catch (_) {}
  var moT = null;
  function sweep() {
    try { fixPills(); } catch (_) {}
    try { fixThinkMenu(); } catch (_) {}
    try { fixThinkPill(); } catch (_) {}
    try { kickPin(); } catch (_) {}
    try { clampPoppers(); } catch (_) {}
    try { fixShareBtn(); } catch (_) {}
    try { addTransferBtn(); } catch (_) {}
    try { fixMic(); } catch (_) {}
    try { fixSuggestions(); } catch (_) {}
    try { fixPlugins(); } catch (_) {}
    try { fixLogin(); } catch (_) {}
    try { fixGuestLabel(); } catch (_) {}
    try { fixChatMenu(); } catch (_) {}
    try { fixSettingsLang(); } catch (_) {}
  }
  function onMut(muts) {
    /* анти-мигание: меню, пилюлю и позиции обрабатываем немедленно, до отрисовки кадра */
    for (var i = 0; i < muts.length; i++) {
      var n = muts[i].target;
      if (n && n.nodeType === 1) {
        var el = n.matches && (n.matches('[data-radix-popper-content-wrapper]') || n.matches('[role="menu"]')) ? n : (n.closest && n.closest('[data-radix-popper-content-wrapper]'));
        if (el) {
          try { fixThinkMenu(); } catch (_) {}
          try { kickPin(); } catch (_) {}
          try { clampPoppers(); } catch (_) {} /* подменю зажимаем в тот же кадр */
          try { fixChatMenu(); } catch (_) {}
        }
        var isFooter = n.matches && n.matches('footer button') || (n.closest && n.closest('footer button[aria-label="Уровень размышлений"]'));
        if (isFooter) {
          try { fixThinkPill(); } catch (_) {}
        }
      }
    }
    if (moT) clearTimeout(moT);
    moT = setTimeout(sweep, 120);
  }
  try { guardTokenBridge(); } catch (_) {}
  try {
    var mo = new MutationObserver(onMut);
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
  setInterval(sweep, 1500);
  sweep();
})();
