/* ZaiChat v16 — безопасный markdown-рендер (escape-first) */

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

export function renderMarkdown(src) {
  if (typeof src !== 'string') src = String(src || '');
  const blocks = [];
  const slides = [];
  // вырезаем код-блоки
  let text = src.replace(/```([\w-]*)\n?([\s\S]*?)(?:```|$)/g, (m, lang, code) => {
    if (lang === 'zai-slides') {
      slides.push(code);
      return '\u0000SLIDES' + (slides.length - 1) + '\u0000';
    }
    blocks.push({ lang, code });
    return '\u0000CODE' + (blocks.length - 1) + '\u0000';
  });
  text = esc(text);

  // таблицы (простые): строки с |
  text = text.replace(/(^\|.+\|\s*$\n?)+/gm, (tbl) => {
    const rows = tbl.trim().split('\n').filter(r => r.trim());
    if (rows.length < 2) return tbl;
    const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const head = cells(rows[0]);
    let html = '<table><thead><tr>' + head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>';
    for (let i = 1; i < rows.length; i++) {
      if (/^[\s:|-]+$/.test(rows[i])) continue;
      html += '<tr>' + cells(rows[i]).map(c => '<td>' + c + '</td>').join('') + '</tr>';
    }
    return html + '</tbody></table>';
  });

  // заголовки
  text = text.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>').replace(/^##\s+(.+)$/gm, '<h2>$1</h2>').replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  // жирный/курсив
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<i>$2</i>');
  // ссылки [t](url)
  text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  // картинки
  text = text.replace(/!\[([^\]\n]*)\]\((https?:\/\/[^)\s]+|\/api\/[^)\s]+)\)/g, (m, t, u) => `\n<img src="${u}" alt="${t}" loading="lazy">\n`);
  // инлайн-код
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // списки
  text = text.replace(/(?:^|\n)((?:[ \t]*(?:[-*•]|\d+\.)[ \t]+.+(?:\n|$))+)/g, (m, list) => {
    const ordered = /^\s*\d+\./.test(list);
    const items = list.trim().split('\n').map(l => l.replace(/^\s*(?:[-*•]|\d+\.)\s+/, '')).filter(Boolean);
    return '\n<' + (ordered ? 'ol' : 'ul') + '>' + items.map(i => '<li>' + i + '</li>').join('') + '</' + (ordered ? 'ol' : 'ul') + '>\n';
  });

  // параграфы: разделяем по \n\n, одиночные \n — br
  const parts = text.split(/\n{2,}/).map(p => {
    const t = p.trim();
    if (!t) return '';
    if (/^<(h\d|ul|ol|table|pre|blockquote|img|div)/.test(t) || /^<img/.test(t)) return t;
    return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
  });
  let html = parts.filter(Boolean).join('');

  // возвращаем код-блоки
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => {
    const b = blocks[+i];
    return `<pre data-code="1"><code>${esc(b.code)}</code></pre>`;
  });
  html = html.replace(/\u0000SLIDES(\d+)\u0000/g, (m, i) => `<div data-slides="${i}"></div>`);

  return { html, codeBlocks: blocks, slides };
}

/** Первые строки без markdown — для превью/уведомлений */
export function plainExcerpt(src, n = 120) {
  return String(src || '')
    .replace(/```[\s\S]*?```/g, ' [код] ')
    .replace(/[#*`>_\[\]!|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
}
