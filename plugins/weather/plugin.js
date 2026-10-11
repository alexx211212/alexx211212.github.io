zai.register({
  name: 'Погода',
  async onBeforeSend(text) {
    const m = text.match(/погод[аыуе]\s*(?:в|во|на)?\s*([A-Za-zА-Яа-яЁё\-\s]{2,40})/i);
    if (!m) return text;
    let city = m[1].trim().replace(/[?!.]+$/, '');
    if (!city) return text;
    try {
      const g = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=ru&name=' + encodeURIComponent(city)).then(r => r.json());
      const c = g && g.results && g.results[0];
      if (!c) return text;
      const w = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + c.latitude + '&longitude=' + c.longitude + '&current=temperature_2m,apparent_temperature,wind_speed_10m,relative_humidity_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=3').then(r => r.json());
      const WCODES = {0:'ясно',1:'малооблачно',2:'переменная облачность',3:'пасмурно',45:'туман',48:'изморозь',51:'морось',53:'морось',55:'морось',61:'небольшой дождь',63:'дождь',65:'ливень',66:'ледяной дождь',71:'небольшой снег',73:'снег',75:'снегопад',77:'снежные зёрна',80:'ливень',81:'ливень',82:'сильный ливень',85:'снежные ливни',95:'гроза',96:'гроза с градом',99:'гроза с градом'};
      const cur = w.current, d = w.daily;
      let out = '[ДАННЫЕ ПОГОДЫ: ' + c.name + ', ' + (c.country || '') + '\n';
      out += 'Сейчас: ' + Math.round(cur.temperature_2m) + '°C (ощущается ' + Math.round(cur.apparent_temperature) + '°C), ' + (WCODES[cur.weather_code] || 'облачно') + ', ветер ' + Math.round(cur.wind_speed_10m) + ' км/ч, влажность ' + cur.relative_humidity_2m + '%\n';
      for (let i = 0; i < Math.min(3, d.time.length); i++) out += d.time[i] + ': ' + Math.round(d.temperature_2m_min[i]) + '…' + Math.round(d.temperature_2m_max[i]) + '°C, ' + (WCODES[d.weather_code[i]] || '') + '\n';
      out += ']\n\nИспользуй эти данные для ответа.';
      return text + '\n\n' + out;
    } catch (e) { return text; }
  }
});
