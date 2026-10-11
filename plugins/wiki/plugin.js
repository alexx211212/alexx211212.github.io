zai.register({
  name: 'Википедия',
  async onBeforeSend(text) {
    if (!/(что (такое|такой|такая|такие)|кто так|расскажи про|информация о|статья про)/i.test(text)) return text;
    let q = text.replace(/что (такое|такой|такая|такие) |кто так(ой|ая) |расскажи про |информация о |статья про /ig, '').replace(/[?!.]+$/, '').trim().slice(0, 80);
    if (!q) return text;
    try {
      const r = await fetch('https://ru.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(q)).then(r => r.json());
      if (r && r.extract) return text + '\n\n[ВИКИПЕДИЯ: ' + (r.title || q) + ' — ' + r.extract.slice(0, 700) + ']\nИспользуй это для точного ответа.';
      return text;
    } catch (e) { return text; }
  }
});
