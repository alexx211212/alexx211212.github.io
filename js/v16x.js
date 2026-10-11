/*! ZaiChat v15.3 — слой улучшений поверх v15.
 *  Добавляет: само-починку «сервер не отвечает», оповещения (перегрузка/«ответ готов»),
 *  think-меню LOW/MEDIUM/HIGH/OFF с автозакрытием, кнопку «Поделиться чатом»,
 *  голосовой ввод без зависимости от хостинга, ротацию подсказок,
 *  «Загрузить ещё» в плагинах, аккуратный вход.
 *  Работает поверх приложения и не мешает ему: всё в try/catch. */
(function () {
  'use strict';
  if (window.__z16x) return;
  window.__z16x = { v: '15.3' };

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
      if (msg === lastToastText && now - lastToastAt < 4000) return; // без спама
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
  window.__z16toast = toast; // для тестов

  /* ================= 1. fetch: само-починка + сбор токена/chat_id ================= */
  var ZAI = 'https://chat.z.ai';
  var lastToken = '', lastChat = '';
  try {
    lastToken = sessionStorage.getItem('z16tok') || '';
    lastChat = sessionStorage.getItem('z16chat') || '';
  } catch (_) {}
  var realFetch = window.fetch.bind(window);

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

      /* запоминаем id текущего чата (для «Поделиться») */
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
        toast('Защита сервера сработала — переподключаюсь (' + attempt + '/' + MAX_TRY + ')…');
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
                  toast('Сервер обновился — перезапустите приложение, чтобы обновить совместимость');
                } else if (/перегруж|overloaded|too many|высокий спрос|high demand|попробуйте позже/i.test(tail)) {
                  toast('Модель сейчас перегружена — повторите запрос через минуту');
                } else {
                  answerReady();
                }
              }).catch(function () {});
            } catch (_) {}
          }
          if (st < 400 || attempt >= MAX_TRY) {
            if (attempt >= MAX_TRY && (st === 429 || st === 502 || st === 503)) {
              toast('Модель перегружена. Подождите минуту и повторите запрос.');
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
              toast('Модель перегружена — автоматически повторяю (' + attempt + '/' + MAX_TRY + ')…');
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
  var READY = ['Ответ готов ✅', 'Модель ответила — глянь 📩', 'Готово! Ответ ждёт в чате', 'Ответ сформирован ✨', 'Есть результат — заходи 🙌'];
  function answerReady() {
    toast(READY[Math.floor(Math.random() * READY.length)], 2600);
    vibrate([60, 40, 60]);
  }

  /* ================= 3. think-меню: EN + автозакрытие ================= */
  var THINK_MAP = { 'Лоу': 'LOW', 'Медиум': 'MEDIUM', 'Хай': 'HIGH', 'Выключить': 'OFF' };
  var PILL_MAP = { 'Быстрые': 'LOW', 'Глубокие': 'MEDIUM', 'Ультра': 'HIGH', 'Размышления': 'Think' };
  function closeThink() {
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); } catch (_) {}
    setTimeout(function () {
      try {
        var b = $('button[aria-label="Уровень размышлений"]');
        if (b && b.getAttribute('data-state') === 'open') b.click();
      } catch (_) {}
    }, 90);
  }
  function fixThinkMenu() {
    var wr = $('[data-radix-popper-content-wrapper]');
    if (!wr) return;
    var btns = $$('button', wr);
    var touched = false;
    btns.forEach(function (b) {
      var t = (b.textContent || '').trim();
      for (var ru in THINK_MAP) {
        if (t.indexOf(ru) === 0) {
          touched = true;
          if (!b.__z16w) {
            b.__z16w = true;
            b.addEventListener('click', function () { setTimeout(closeThink, 140); }, true);
          }
          allText(b).forEach(function (tn) {
            var tv = tn.nodeValue.trim();
            if (THINK_MAP[tv]) tn.nodeValue = tn.nodeValue.replace(tv, THINK_MAP[tv]);
          });
        }
      }
    });
    if (touched && !wr.__z16t) {
      wr.__z16t = true;
      wr.addEventListener('click', function (e) {
        var b = e.target && e.target.closest && e.target.closest('button');
        if (b) vibrate(8);
      }, true);
    }
  }
  function fixThinkPill() {
    var b = $('footer button[aria-label="Уровень размышлений"]');
    if (!b) return;
    var t = (b.textContent || '').trim();
    var en = PILL_MAP[t];
    if (!en) return;
    directText(b).forEach(function (tn) {
      if (tn.nodeValue.trim() === t) tn.nodeValue = tn.nodeValue.replace(t, en);
    });
  }

  /* ================= 4. «Поделиться чатом» вместо «Новый чат» (справа сверху) ================= */
  function fixShareBtn() {
    var b = $('header button[aria-label="Новый чат"]');
    if (!b) return;
    b.setAttribute('aria-label', 'Поделиться чатом');
    b.setAttribute('title', 'Поделиться чатом');
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
        toast('Сначала отправьте сообщение в чат — после этого чатом можно поделиться');
        return;
      }
      if (!lastToken) {
        toast('Для ссылки нужен вход в аккаунт — открываю окно входа…');
        try { window.dispatchEvent(new CustomEvent('zai-open-dialog', { detail: 'account' })); } catch (_) {}
        return;
      }
      toast('Готовлю ссылку…', 1600);
      return window.fetch(ZAI + '/api/v1/chats/' + lastChat + '/share', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lastToken },
        body: '{}'
      }).then(function (res) {
        if (!res.ok) { toast('Не удалось создать ссылку (' + res.status + '). Попробуйте ещё раз.'); return; }
        return res.json().catch(function () { return {}; }).then(function (d) {
          var sid = d && (d.share_id || d.id || d.slug);
          var link = 'https://chat.z.ai/s/' + (sid || lastChat);
          shareOut(link);
        });
      }).catch(function () { toast('Не удалось поделиться — проверьте интернет'); });
    }).catch(function () {});
  }
  function shareOut(link) {
    try {
      if (navigator.share) {
        navigator.share({ title: 'Чат Z.ai', url: link }).then(function () {
          toast('Ссылка на чат отправлена ✅');
        }).catch(function () {});
        return;
      }
    } catch (_) {}
    var ok = false;
    try { navigator.clipboard.writeText(link).then(function () { toast('Ссылка скопирована — откроется и на сайте, и в приложении', 4500); }, function () { copyFallback(link); }); ok = true; } catch (_) {}
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
      toast(ok ? 'Ссылка скопирована — откроется и на сайте, и в приложении' : text, 6000);
    } catch (_) { toast(text, 8000); }
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
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) startSpeechAPI(btn); else startRecorder(btn);
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
      recog.lang = 'ru-RU';
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
        if (!finalText && !$('footer textarea').value) toast('Речь не распознана — попробуйте ещё раз');
      };
      recog.onerror = function () { micState = 'idle'; micVisual(false); };
      micState = 'recording'; micVisual(true);
      toast('Слушаю… нажмите на микрофон ещё раз, чтобы остановить', 2400);
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
          var blob = new Blob(micChunks, { type: (mediaRec && mediaRec.mimeType) || 'audio/webm' });
          if (blob.size < 1200) return;
          transcribeBlob(blob);
        };
        mediaRec.start(400);
        micState = 'recording'; micVisual(true);
        toast('Записываю… нажмите на микрофон ещё раз, чтобы остановить', 2400);
      }).catch(function () {
        toast('Нет доступа к микрофону. Разрешите его в настройках приложения/браузера.');
      });
    } catch (_) { toast('Микрофон недоступен в этом браузере'); }
  }
  function stopMic() {
    try { recog && recog.stop && recog.stop(); } catch (_) {}
    try { mediaRec && mediaRec.state !== 'inactive' && mediaRec.stop(); } catch (_) {}
  }
  function transcribeBlob(blob) {
    if (!lastToken) {
      toast('Распознавание речи работает после входа в аккаунт Z.ai (меню → Аккаунт). Гостям и браузеру без поддержки распознавания — недоступно.', 5200);
      return;
    }
    toast('Распознаю речь…', 9000);
    var fd = new FormData();
    fd.append('file', blob, 'speech.webm');
    window.fetch(ZAI + '/api/v1/audio/transcriptions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Authorization': 'Bearer ' + lastToken },
      body: fd
    }).then(function (res) {
      if (!res.ok) { toast('Распознать не удалось (' + res.status + '). Введите текст вручную.'); return; }
      return res.json().catch(function () { return {}; }).then(function (d) {
        var t = d && (d.text || d.transcript || (d.data && d.text)) || '';
        if (t) { fillInput(String(t).trim()); toast('Готово — текст в поле ввода'); }
        else toast('Сервис не вернул текст');
      });
    }).catch(function () { toast('Распознавание недоступно — проверьте интернет'); });
  }

  /* ================= 6. подсказки: 16 вариантов + ротация ================= */
  var POOL = [
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
    'Подбери 10 идей подарков другу до 2000 рублей'
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
    for (var i = 0; i < bs.length && i < curSet.length; i++) {
      var b = bs[i], want = curSet[i];
      if (b.getAttribute('data-z16t') !== want) {
        b.setAttribute('data-z16t', want);
        var sp = $('.line-clamp-2', b);
        if (sp && sp.textContent !== want) sp.textContent = want;
      }
    }
  }
  function fixSuggestions() {
    var grid = findWelcomeGrid();
    if (!grid) return;
    if (!grid.__z16g) {
      grid.__z16g = true;
      var orig = $$('button', grid);
      for (var k = orig.length; k < 8; k++) {
        var c = orig[k % orig.length].cloneNode(true);
        grid.appendChild(c);
      }
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
    if (!curSet.length) curSet = shuffle(POOL.slice()).slice(0, 8);
    reapplySuggestions(grid);
  }
  setInterval(function () {
    try {
      var g = findWelcomeGrid();
      if (g && g.__z16g && g.getBoundingClientRect().height > 0) {
        curSet = shuffle(POOL.slice()).slice(0, 8);
        reapplySuggestions(g);
      }
    } catch (_) {}
  }, 90000); /* ротация раз в 90 секунд */

  /* ================= 7. плагины: «Загрузить ещё» ================= */
  function fixPlugins() {
    var hs = $$('h2');
    var h = null;
    for (var i = 0; i < hs.length; i++) if (hs[i].textContent.trim() === 'Плагины') { h = hs[i]; break; }
    if (!h) return;
    var root = h.closest('[role="dialog"]') || h.parentElement;
    var installBtns = $$('button', root).filter(function (b) { return (b.textContent || '').trim() === 'Установить'; });
    if (installBtns.length < 7) { /* мало карточек — пагинация не нужна */
      if (root.__z16p) { /* список изменился — сбросить */
        root.__z16p = false;
      }
      return;
    }
    if (root.__z16p) return;
    root.__z16p = true;
    var cards = installBtns.map(function (b) {
      return b.closest('div[class*="rounded-2xl"], div[class*="rounded-xl"]') || b.parentElement;
    }).filter(function (c, i, arr) { return c && arr.indexOf(c) === i; });
    var container = cards[0] && cards[0].parentElement;
    if (!container) return;
    var hidden = 0;
    cards.forEach(function (c, i) {
      if (i >= 6) { c.style.display = 'none'; hidden++; }
    });
    if (!hidden) return;
    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'z16-more';
    more.textContent = 'Загрузить ещё (' + hidden + ')';
    more.addEventListener('click', function () {
      cards.forEach(function (c) { c.style.display = ''; });
      more.remove();
      root.__z16p = false;
      vibrate(6);
    });
    if (cards[6]) container.insertBefore(more, cards[6]); else container.appendChild(more);
    /* при поиске показываем всё */
    var search = $('input[placeholder*="Поиск"]', root);
    if (search && !search.__z16s) {
      search.__z16s = true;
      search.addEventListener('input', function () {
        if (search.value) { cards.forEach(function (c) { c.style.display = ''; }); var m = $('.z16-more', container); if (m) m.remove(); root.__z16p = false; }
      });
    }
  }

  /* ================= 8. вход: понятнее и безопаснее ================= */
  function fixLogin() {
    var hs = $$('h2');
    var h = null;
    for (var i = 0; i < hs.length; i++) if (hs[i].textContent.trim() === 'Аккаунт Z.ai') { h = hs[i]; break; }
    if (!h) return;
    var root = h.closest('[role="dialog"]') || h.parentElement;
    if (!root.__z16l) {
      root.__z16l = true;
      $$('button', root).forEach(function (b) {
        var t = (b.textContent || '').trim();
        if (t.indexOf('Войти на сайте Z.ai') === 0) {
          allText(b).forEach(function (tn) {
            if (tn.nodeValue.indexOf('Войти на сайте Z.ai') !== -1) {
              tn.nodeValue = tn.nodeValue.replace('Войти на сайте Z.ai (Google / email)', 'Войти через Z.ai — автоматически (в приложении)');
            }
          });
        }
      });
      var note = document.createElement('p');
      note.className = 'z16-note';
      note.style.cssText = 'margin-top:12px;font-size:11px;line-height:1.5;opacity:.55';
      note.textContent = window.ZaiApp
        ? 'Вход проходит внутри приложения: откроется страница Z.ai, токен подхватится автоматически. Токен хранится только на этом устройстве и отправляется только серверам Z.ai.'
        : 'Совет: в приложении ZaiChat вход происходит в один тап. Здесь же: войдите на chat.z.ai и вставьте токен. Токен хранится только на этом устройстве и отправляется только серверам Z.ai.';
      var acc = $$('button', root).filter(function (b) { return (b.textContent || '').indexOf('Как получить токен') === 0; })[0];
      var anchor = acc || $$('button', root).filter(function (b) { return (b.textContent || '').indexOf('Войти по токену') === 0; })[0];
      try {
        if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(note, anchor);
        else root.appendChild(note);
      } catch (_) { try { root.appendChild(note); } catch (_2) {} }
    }
  }

  /* ================= движок наблюдения ================= */
  var moT = null;
  function sweep() {
    try { fixThinkMenu(); } catch (_) {}
    try { fixThinkPill(); } catch (_) {}
    try { fixShareBtn(); } catch (_) {}
    try { fixMic(); } catch (_) {}
    try { fixSuggestions(); } catch (_) {}
    try { fixPlugins(); } catch (_) {}
    try { fixLogin(); } catch (_) {}
  }
  function onMut() {
    if (moT) clearTimeout(moT);
    moT = setTimeout(sweep, 120);
  }
  try {
    var mo = new MutationObserver(onMut);
    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
  setInterval(sweep, 1500);
  sweep();
})();
