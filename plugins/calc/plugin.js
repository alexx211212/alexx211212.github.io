zai.register({
  name: 'Калькулятор+',
  transformInput(text) {
    const m = text.match(/^\s*([\d\s()+\-*/.^%]+)\s*=\s*$/);
    if (!m) return text;
    const expr = m[1];
    if (!/^[-+*/%^().\d\s]+$/.test(expr)) return text;
    try {
      const js = expr.replace(/\^/g, '**');
      const val = Function('"use strict"; return (' + js + ')')();
      if (typeof val !== 'number' || !isFinite(val)) return text;
      this.__calc = { expr, val };
      return 'Не считай сам — просто ответь: ' + expr + ' = ' + (Math.round(val * 1e10) / 1e10);
    } catch (e) { return text; }
  }
});
