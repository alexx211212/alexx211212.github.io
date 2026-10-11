zai.register({
  name: 'QR-коды',
  transformInput(text) {
    const m = text.match(/^\s*\/qr\s+([\s\S]+)$/i);
    if (!m) return text;
    this.__qr = m[1].trim();
    return 'Сгенерируй короткий ответ: QR-код готов.';
  },
  transformOutput(text) {
    if (this.__qr) {
      const data = this.__qr; this.__qr = null;
      return text + '\n\n![QR-код](https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data=' + encodeURIComponent(data) + ')\n\nСсылка на изображение: https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=' + encodeURIComponent(data);
    }
    return text;
  }
});
