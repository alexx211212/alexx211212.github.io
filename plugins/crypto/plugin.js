zai.register({
  name: 'Курс криптовалют',
  async onBeforeSend(text) {
    if (!/(биткоин|bitcoin|btc|эфириум|ethereum|eth|криптовал|курс\s+(btc|eth)|солана|solana|догикоин|doge)/i.test(text)) return text;
    const ids = 'bitcoin,ethereum,solana,cardano,dogecoin,toncoin';
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + ids + '&vs_currencies=usd,eur&include_24hr_change=true').then(r => r.json());
      if (!r || r.status) return text;
      const N = {bitcoin:'Bitcoin (BTC)',ethereum:'Ethereum (ETH)',solana:'Solana (SOL)',cardano:'Cardano (ADA)',dogecoin:'Dogecoin (DOGE)',toncoin:'Toncoin (TON)'};
      let out = '[КУРСЫ КРИПТОВАЛЮТ СЕЙЧАС:\n';
      for (const k of Object.keys(N)) if (r[k]) out += N[k] + ': $' + r[k].usd + ' (' + (r[k].usd_24h_change >= 0 ? '+' : '') + (r[k].usd_24h_change || 0).toFixed(2) + '% за 24ч)\n';
      out += ']\nИспользуй эти данные.';
      return text + '\n\n' + out;
    } catch (e) { return text; }
  }
});
