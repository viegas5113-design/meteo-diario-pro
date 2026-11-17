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

  function calcSunTimes(lat, lon, date = new Date()) {
    const RAD = Math.PI / 180;
    const DEG = 180 / Math.PI;
    const start = new Date(date.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((date - start) / 86400000);
    const lngHour = lon / 15;

    function calcEvent(isSunrise) {
      const t = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;
      const M = 0.9856 * t - 3.289;
      let L = M + 1.916 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 282.634;
      L = ((L % 360) + 360) % 360;

      let RA = Math.atan(0.91764 * Math.tan(L * RAD)) * DEG;
      RA = ((RA % 360) + 360) % 360;
      RA = (RA + (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90)) / 15;

      const sinDec = 0.39782 * Math.sin(L * RAD);
      const cosDec = Math.cos(Math.asin(sinDec));
      const cosH = (Math.cos(90.833 * RAD) - sinDec * Math.sin(lat * RAD)) / (cosDec * Math.cos(lat * RAD));
      if (cosH > 1 || cosH < -1) return '--:--';

      let H = isSunrise ? 360 - Math.acos(cosH) * DEG : Math.acos(cosH) * DEG;
      H = H / 15;
      const T = H + RA - 0.06571 * t - 6.622;
      const UT = ((T - lngHour) % 24 + 24) % 24;
      const localT = ((UT - date.getTimezoneOffset() / 60) % 24 + 24) % 24;
      const hh = Math.floor(localT);
      const mm = Math.round((localT - hh) * 60);
      return `${String(mm === 60 ? (hh + 1) % 24 : hh).padStart(2, '0')}:${String(mm === 60 ? 0 : mm).padStart(2, '0')}`;
    }

    return { sunrise: calcEvent(true), sunset: calcEvent(false) };
  }

  function calcSolunarPeriods(date = new Date(), lonDeg = -8.6730) {
    // Calcula passagem lunar superior (trânsito) e inferior (nadir) a partir da fase sinódica
    const ref = Date.UTC(2000, 0, 6, 18, 14, 0);
    const synodic = 29.53058867 * 86400000;
    const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
    const phase = (((noon.getTime() - ref) % synodic) + synodic) % synodic / synodic;
    // Na Lua Nova (phase=0) o trânsito lunar é por volta das 12:00 solares; avança ~50 min/dia
    const solarNoonOffset = (12 - (lonDeg / 15) + (-noon.getTimezoneOffset() / 60)) % 24;
    const transitHour = (solarNoonOffset + phase * 24 + 24) % 24;
    const underfootHour = (transitHour + 12.42) % 24;

    const fmtRange = (centerH, halfWidthH) => {
      const toHHMM = (hVal) => {
        const h = ((hVal % 24) + 24) % 24;
        const hh = Math.floor(h);
        const mm = Math.round((h - hh) * 60);
        return `${String(mm === 60 ? (hh + 1) % 24 : hh).padStart(2, '0')}:${String(mm === 60 ? 0 : mm).padStart(2, '0')}`;
      };
      return `${toHHMM(centerH - halfWidthH)}–${toHHMM(centerH + halfWidthH)}`;
    };

    return {
      major1: fmtRange(transitHour, 1.0),
      major2: fmtRange(underfootHour, 1.0),
      minor1: fmtRange((transitHour + 6.21) % 24, 0.5),
      minor2: fmtRange((underfootHour + 6.21) % 24, 0.5)
    };
  }

  global.MeteoUtils = {
    kmhToKnots,
    windCardinalPT,
    pressureTrend,
    moonPhasePT,
    weatherCodePT,
    calcSunTimes,
    calcSolunarPeriods,
    compressImageFile,
    buildCSV
  };
})(window);
