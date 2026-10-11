zai.register({
  name: 'Кубик и монетка',
  transformInput(text) {
    const t = text.toLowerCase();
    const roll = (n) => 1 + Math.floor(Math.random() * n);
    if (/^\s*\/d20|брось d20|кинь d20/i.test(t)) return 'Ответь ровно одной строкой без пояснений: ' + roll(20);
    if (/^\s*\/d6|брось кубик|кинь кубик/i.test(t)) return 'Ответь ровно одной строкой без пояснений: ' + roll(6);
    if (/^\s*\/coin|монетк/i.test(t)) return 'Ответь ровно одной строкой без пояснений: ' + (Math.random() < 0.5 ? 'Орёл' : 'Решка');
    return text;
  }
});
