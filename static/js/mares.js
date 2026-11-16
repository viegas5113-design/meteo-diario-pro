/**
 * Tabela das Marés - Harmónicas Astronómicas Calibradas para Lagos / Costa Algarvia
 * Funciona 100% offline usando constituintes M2, S2, N2, K1, O1.
 */
(function (global) {
  'use strict';

  const RAD = Math.PI / 180;
  // Época J2000.0: 2000-01-01 12:00:00 UTC
  const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

  // Constituintes harmónicos calibrados para o Porto de Lagos (Z0 = 2.00 m)
  // Velocidades em graus/hora, amplitudes em metros, fases locais (G) em graus
  const Z0 = 2.00;
  const CONSTITUENTS = [
    { name: 'M2', speed: 28.9841042, amp: 1.02, lag: 58.0 },   // Semidiurna lunar principal
    { name: 'S2', speed: 30.0000000, amp: 0.36, lag: 84.0 },   // Semidiurna solar principal
    { name: 'N2', speed: 28.4397295, amp: 0.21, lag: 42.0 },   // Elíptica lunar maior
    { name: 'K1', speed: 15.0410686, amp: 0.08, lag: 52.0 },   // Diurna lunissolar
    { name: 'O1', speed: 13.9430356, amp: 0.06, lag: 305.0 }   // Diurna lunar principal
  ];

  /**
   * Argumentos astronómicos fundamentais (graus) para um instante t (Date)
   */
  function astroAngles(date) {
    const d = (date.getTime() - J2000_MS) / 86400000; // dias desde J2000
    const T = d / 36525;
    // Longitude média da Lua (s), Sol (h), perigeu lunar (p)
    const s = (218.3164477 + 481267.88123421 * T) % 360;
    const h = (280.46646 + 36000.76983 * T) % 360;
    const p = (83.3532465 + 4069.0137287 * T) % 360;
    const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
    const tau = (15 * utcHours - s + h + 180) % 360;

    return {
      M2: (2 * tau) % 360,
      S2: (2 * (15 * utcHours + 180)) % 360,
      N2: (2 * tau - s + p) % 360,
      K1: (tau + s - 90) % 360,
      O1: (tau - s + 90) % 360
    };
  }

  /**
   * Altura da maré (metros acima do Zero Hidrográfico) num instante Date.
   * Ajusta ligeiramente a fase consoante a longitude (para GPS fora de Lagos).
   */
  function getTideHeight(date, lonDeg = -8.6730) {
    const lonShiftHours = (lonDeg - (-8.6730)) / 15;
    const adjDate = new Date(date.getTime() + lonShiftHours * 3600000);
    const V = astroAngles(adjDate);

    let h = Z0;
    for (const c of CONSTITUENTS) {
      const angle = (V[c.name] - c.lag) * RAD;
      h += c.amp * Math.cos(angle);
    }
    return h;
  }

  /**
   * Estado atual da maré: altura, tendência (a encher / a vazar) e variação.
   */
  function getCurrentTideState(now = new Date(), lonDeg = -8.6730) {
    const hNow = getTideHeight(now, lonDeg);
    const hNext = getTideHeight(new Date(now.getTime() + 10 * 60000), lonDeg);
    const rising = hNext >= hNow;
    return {
      height: hNow,
      rising,
      label: rising ? 'A encher' : 'A vazar',
      icon: rising ? '🌊 ↗️' : '🌊 ↘️'
    };
  }

  /**
   * Encontra todos os extremos (Preia-Mar e Baixa-Mar) de um dia civil local.
   */
  function getDayExtremes(dateObj, lonDeg = -8.6730) {
    const y = dateObj.getFullYear();
    const m = dateObj.getMonth();
    const d = dateObj.getDate();
    const start = new Date(y, m, d, 0, 0, 0);
    const stepMin = 5;
    const samples = [];

    for (let min = -stepMin; min <= 24 * 60 + stepMin; min += stepMin) {
      const t = new Date(start.getTime() + min * 60000);
      samples.push({ t, h: getTideHeight(t, lonDeg) });
    }

    const extremes = [];
    for (let i = 1; i < samples.length - 1; i++) {
      const prev = samples[i - 1].h;
      const cur = samples[i].h;
      const next = samples[i + 1].h;
      const t = samples[i].t;
      if (t.getDate() !== d) continue;

      if (cur > prev && cur >= next) {
        extremes.push({ type: 'Preia-Mar', isHigh: true, time: t, height: cur });
      } else if (cur < prev && cur <= next) {
        extremes.push({ type: 'Baixa-Mar', isHigh: false, time: t, height: cur });
      }
    }

    // Calcular amplitude e coeficiente aproximado (20..120)
    const highs = extremes.filter((e) => e.isHigh).map((e) => e.height);
    const lows = extremes.filter((e) => !e.isHigh).map((e) => e.height);
    const maxH = highs.length ? Math.max(...highs) : Z0 + 1.0;
    const minH = lows.length ? Math.min(...lows) : Z0 - 1.0;
    const range = maxH - minH; // típico em Lagos: ~1.2m (morta) a ~3.2m (viva)
    const coef = Math.max(20, Math.min(120, Math.round(((range - 0.8) / 2.6) * 85 + 25)));

    let tipoMare = 'Maré Média';
    if (coef >= 75) tipoMare = 'Maré Viva';
    else if (coef <= 45) tipoMare = 'Maré Morta';

    return {
      date: start,
      extremes,
      range,
      coef,
      tipoMare
    };
  }

  function getMultiDayTides(days = 5, lonDeg = -8.6730) {
    const out = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = 0; i < days; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      out.push(getDayExtremes(d, lonDeg));
    }
    return out;
  }

  global.MaresLagos = {
    getTideHeight,
    getCurrentTideState,
    getDayExtremes,
    getMultiDayTides
  };
})(window);
