/**
 * Utilitários Meteorológicos, Fase da Lua, Tendência Barométrica e Exportação
 */
(function (global) {
  'use strict';

  function kmhToKnots(kmh) {
    if (kmh == null || isNaN(kmh)) return '--';
    return (kmh * 0.539957).toFixed(1);
  }

  function windCardinalPT(deg) {
    if (deg == null || isNaN(deg)) return '--';
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  }

  function pressureTrend(hourlyTimes, hourlyPressures, currentVal) {
    if (!Array.isArray(hourlyTimes) || !Array.isArray(hourlyPressures) || hourlyPressures.length < 4) {
      return { arrow: '➡️', label: 'Estável', cls: 'trend-flat', diff: 0 };
    }
    const nowMs = Date.now();
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < hourlyTimes.length; i++) {
      const d = Math.abs(new Date(hourlyTimes[i]).getTime() - nowMs);
      if (d < bestDiff) {
        bestDiff = d;
        bestIdx = i;
      }
    }
    const prevIdx = Math.max(0, bestIdx - 3);
    const cur = currentVal != null ? currentVal : hourlyPressures[bestIdx];
    const prev = hourlyPressures[prevIdx];
    if (cur == null || prev == null) {
      return { arrow: '➡️', label: 'Estável', cls: 'trend-flat', diff: 0 };
    }
    const diff = cur - prev;
    if (diff >= 0.8) return { arrow: '↗️', label: `A subir (+${diff.toFixed(1)})`, cls: 'trend-up', diff };
    if (diff <= -0.8) return { arrow: '↘️', label: `A descer (${diff.toFixed(1)})`, cls: 'trend-down', diff };
    return { arrow: '➡️', label: 'Estável', cls: 'trend-flat', diff };
  }

  function moonPhasePT(date = new Date()) {
    // Ciclo sinódico médio: 29.53058867 dias a partir de Lua Nova de referência (2000-01-06 18:14 UTC)
    const ref = Date.UTC(2000, 0, 6, 18, 14, 0);
    const synodic = 29.53058867 * 86400000;
    const phase = (((date.getTime() - ref) % synodic) + synodic) % synodic / synodic;
    const illum = Math.round((1 - Math.cos(phase * 2 * Math.PI)) * 50);

    let name = 'Lua Nova';
    let icon = '🌑';
    if (phase < 0.03 || phase >= 0.97) { name = 'Lua Nova'; icon = '🌑'; }
    else if (phase < 0.22) { name = 'Crescente Côncava'; icon = '🌒'; }
    else if (phase < 0.28) { name = 'Quarto Crescente'; icon = '🌓'; }
    else if (phase < 0.47) { name = 'Crescente Convexa'; icon = '🌔'; }
    else if (phase < 0.53) { name = 'Lua Cheia'; icon = '🌕'; }
    else if (phase < 0.72) { name = 'Minguante Convexa'; icon = '🌖'; }
    else if (phase < 0.78) { name = 'Quarto Minguante'; icon = '🌗'; }
    else { name = 'Minguante Côncava'; icon = '🌘'; }

    return { name, icon, illum, ageDays: (phase * 29.53).toFixed(1) };
  }

  function weatherCodePT(code) {
    if (code == null) return { icon: '🌤️', text: 'Sem dados' };
    if (code === 0) return { icon: '☀️', text: 'Céu limpo' };
    if (code <= 2) return { icon: '🌤️', text: 'Pouco nublado' };
    if (code === 3) return { icon: '☁️', text: 'Muito nublado' };
    if (code === 45 || code === 48) return { icon: '🌫️', text: 'Nevoeiro' };
    if (code >= 51 && code <= 57) return { icon: '🌦️', text: 'Chuvisco' };
    if (code >= 61 && code <= 67) return { icon: '🌧️', text: 'Chuva' };
    if (code >= 71 && code <= 77) return { icon: '❄️', text: 'Neve' };
    if (code >= 80 && code <= 82) return { icon: '🌦️', text: 'Aguaceiros' };
    if (code >= 95) return { icon: '⛈️', text: 'Trovoada' };
    return { icon: '🌤️', text: 'Variável' };
  }

  function compressImageFile(file, maxWidth = 960, quality = 0.72) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Erro ao ler imagem'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Imagem inválida'));
        img.onload = () => {
          const scale = Math.min(1, maxWidth / img.width);
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    if (/[";\n\r,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function buildCSV(records) {
    const headers = [
      'Data',
      'Hora',
      'Local',
      'Latitude',
      'Longitude',
      'Estado do Mar',
      'Sensacao Vento',
      'Visibilidade',
      'Temp Ar (C)',
      'Vento (km/h)',
      'Vento (nos)',
      'Rajadas (km/h)',
      'Dir Vento',
      'Pressao (hPa)',
      'Tendencia Pressao',
      'Humidade (%)',
      'Ondulacao (m)',
      'Periodo Onda (s)',
      'Temp Mar (C)',
      'Fase da Lua',
      'Tem Foto',
      'Notas'
    ];
    const rows = [headers.join(';')];
    for (const r of records) {
      const m = r.meteo || {};
      rows.push([
        r.dateStr,
        r.timeStr,
        r.locationName || '',
        r.lat != null ? r.lat.toFixed(5) : '',
        r.lon != null ? r.lon.toFixed(5) : '',
        r.seaState || '',
        r.windFeel || '',
        r.visibility || '',
        m.tempC ?? '',
        m.windKmh ?? '',
        m.windKnots ?? '',
        m.gustsKmh ?? '',
        m.windDirCard || '',
        m.pressureHpa ?? '',
        m.pressureTrend || '',
        m.humidity ?? '',
        m.waveHeightM ?? '',
        m.wavePeriodS ?? '',
        m.seaTempC ?? '',
        m.moonPhase || '',
        r.photoDataUrl ? 'Sim' : 'Nao',
        r.notes || ''
      ].map(csvEscape).join(';'));
    }
    return '\uFEFF' + rows.join('\r\n');
  }

  global.MeteoUtils = {
    kmhToKnots,
    windCardinalPT,
    pressureTrend,
    moonPhasePT,
    weatherCodePT,
    compressImageFile,
    buildCSV
  };
})(window);
