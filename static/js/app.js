/**
 * Meteo Diário Pro - Aplicação Principal (PWA Móvel)
 */
(function () {
  'use strict';

  const {
    kmhToKnots,
    windCardinalPT,
    windLocalNamePT,
    pressureTrend,
    moonPhasePT,
    weatherCodePT,
    calcSunTimes,
    calcSolunarPeriods,
    compressImageFile,
    buildCSV
  } = window.MeteoUtils;

  const LAGOS = { lat: 37.1028, lon: -8.6730, name: 'Lagos' };
  const GIBRALTAR = { lat: 36.01, lon: -5.60, name: 'Estreito de Gibraltar (Tarifa)' };
  const STORAGE_THEME = 'meteo_diario_theme_v1';
  const STORAGE_METEO_CACHE = 'meteo_diario_offline_cache_v1';

  function saveOfflineCache(snapshot) {
    try {
      localStorage.setItem(STORAGE_METEO_CACHE, JSON.stringify({
        savedAt: new Date().toISOString(),
        mode: state.mode,
        lat: state.lat,
        lon: state.lon,
        locationName: state.locationName,
        snapshot
      }));
    } catch (_) {}
  }

  function loadOfflineCache() {
    try {
      const raw = localStorage.getItem(STORAGE_METEO_CACHE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.snapshot) return parsed;
    } catch (_) {}
    return null;
  }

  const state = {
    mode: 'lagos', // 'gps' | 'lagos' | 'gibraltar'
    lat: LAGOS.lat,
    lon: LAGOS.lon,
    locationName: LAGOS.name,
    currentMeteo: null,
    pendingPhotoDataUrl: null,
    records: [],
    deferredInstallPrompt: null
  };

  const $ = (id) => document.getElementById(id);

  function showToast(msg, ms = 2500) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  // --- Navegação por Separadores ---
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'tabHistorico') renderHistory();
      if (btn.dataset.tab === 'tabMares') renderTides();
      if (btn.dataset.tab === 'tabCarta' && window.CartaRadar) {
        window.CartaRadar.initMap(() => ({ lat: state.lat, lon: state.lon }));
      }
    });
  });

  // --- Modo Dia / Noite ---
  if (localStorage.getItem(STORAGE_THEME) === 'day') {
    document.body.classList.add('theme-day');
  }
  $('btnTheme').addEventListener('click', () => {
    const isDay = document.body.classList.toggle('theme-day');
    localStorage.setItem(STORAGE_THEME, isDay ? 'day' : 'night');
    $('btnTheme').textContent = isDay ? '☀️' : '🌙';
  });
  $('btnTheme').textContent = document.body.classList.contains('theme-day') ? '☀️' : '🌙';

  // --- Instalação PWA ---
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    $('btnInstallApp').classList.add('visible');
  });

  $('btnInstallApp').addEventListener('click', async () => {
    if (!state.deferredInstallPrompt) {
      showToast('No menu do browser escolha "Adicionar ao Ecrã Principal".');
      return;
    }
    state.deferredInstallPrompt.prompt();
    const res = await state.deferredInstallPrompt.userChoice;
    if (res.outcome === 'accepted') {
      $('btnInstallApp').classList.remove('visible');
      showToast('Meteo Diário Pro instalado!');
    }
    state.deferredInstallPrompt = null;
  });

  function renderAstroCard() {
    const now = new Date();
    const moon = moonPhasePT(now);
    const sun = calcSunTimes(state.lat, state.lon, now);
    const solunar = calcSolunarPeriods(now, state.lon);

    if ($('moonIcon')) $('moonIcon').textContent = moon.icon;
    if ($('moonName')) $('moonName').textContent = moon.name;
    if ($('moonIllum')) $('moonIllum').textContent = `${moon.illum}% iluminada`;
    if ($('astroMoon')) $('astroMoon').textContent = `${moon.icon} ${moon.name} (${moon.illum}%)`;
    if ($('astroSun')) $('astroSun').textContent = `🌅 ${sun.sunrise} · 🌇 ${sun.sunset}`;
    if ($('astroSolunar')) $('astroSolunar').textContent = `${solunar.major1} · ${solunar.major2}`;
    return moon;
  }

  // --- Localização: GPS Atual vs Locais Rápidos ---
  function updateLocationUI() {
    if (state.mode === 'gps') {
      $('locTitle').textContent = '📡 Localização GPS Atual';
    } else if (state.mode === 'gibraltar') {
      $('locTitle').textContent = '🌊 Estreito de Gibraltar (Tarifa)';
    } else {
      $('locTitle').textContent = '⚓ Lagos (Algarve)';
    }
    const latStr = `${Math.abs(state.lat).toFixed(4)}° ${state.lat >= 0 ? 'N' : 'S'}`;
    const lonStr = `${Math.abs(state.lon).toFixed(4)}° ${state.lon >= 0 ? 'E' : 'O'}`;
    $('locCoords').textContent = `${latStr}, ${lonStr}`;
    $('btnUseGps').classList.toggle('active', state.mode === 'gps');
    $('btnUseLagos').classList.toggle('active', state.mode === 'lagos');
    if ($('btnUseGibraltar')) {
      $('btnUseGibraltar').classList.toggle('active', state.mode === 'gibraltar');
    }
    renderAstroCard();
    renderTides();
  }

  function usePreset(mode, loc) {
    state.mode = mode;
    state.lat = loc.lat;
    state.lon = loc.lon;
    state.locationName = loc.name;
    updateLocationUI();
    fetchWeatherAndMarine();
  }

  const useLagos = () => usePreset('lagos', LAGOS);
  const useGibraltar = () => usePreset('gibraltar', GIBRALTAR);

  function useGPS() {
    if (!('geolocation' in navigator)) {
      showToast('Este dispositivo não suporta GPS. A usar Lagos.');
      return useLagos();
    }
    $('statusLine').textContent = 'A obter GPS...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.mode = 'gps';
        state.lat = pos.coords.latitude;
        state.lon = pos.coords.longitude;
        state.locationName = `GPS (${state.lat.toFixed(3)}, ${state.lon.toFixed(3)})`;
        updateLocationUI();
        fetchWeatherAndMarine();
      },
      () => {
        showToast('Sem sinal GPS ou permissão recusada. A usar Lagos.');
        useLagos();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  $('btnUseLagos').addEventListener('click', useLagos);
  if ($('btnUseGibraltar')) $('btnUseGibraltar').addEventListener('click', useGibraltar);
  $('btnUseGps').addEventListener('click', useGPS);
  $('btnRefresh').addEventListener('click', fetchWeatherAndMarine);
  if ($('btnTrafficRefresh')) $('btnTrafficRefresh').addEventListener('click', fetchWeatherAndMarine);

  // --- Open-Meteo API (Tempo + Mar) ---
  async function fetchWeatherAndMarine() {
    $('statusLine').textContent = 'A atualizar meteorologia...';
    const lat = state.lat.toFixed(4);
    const lon = state.lon.toFixed(4);

    const forecastUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,precipitation,rain,showers,cloud_cover,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
      `&hourly=surface_pressure,temperature_2m,precipitation_probability,precipitation,cloud_cover,weather_code,wind_speed_10m,wind_direction_10m&past_days=1&forecast_days=2&timezone=auto`;

    const marineUrl =
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
      `&current=wave_height,wave_direction,wave_period,sea_surface_temperature,ocean_current_velocity,ocean_current_direction` +
      `&hourly=ocean_current_velocity,ocean_current_direction&forecast_days=2&timezone=auto`;

    const moon = renderAstroCard();

    try {
      const [fRes, mRes] = await Promise.all([
        fetch(forecastUrl),
        fetch(marineUrl).catch(() => null)
      ]);
      if (!fRes.ok) throw new Error('Falha na API Open-Meteo');
      const fData = await fRes.json();
      const mData = mRes && mRes.ok ? await mRes.json() : null;

      const cur = fData.current || {};
      const hr = fData.hourly || {};
      const mar = (mData && mData.current) || {};

      const wCode = weatherCodePT(cur.weather_code);
      const windKmh = cur.wind_speed_10m;
      const windKnots = kmhToKnots(windKmh);
      const gustsKmh = cur.wind_gusts_10m;
      const windDirDeg = cur.wind_direction_10m;
      const windDirCard = windCardinalPT(windDirDeg);
      const pressure = cur.surface_pressure;
      const trend = pressureTrend(hr.time, hr.surface_pressure, pressure);

      // Próximas 24h de 3h em 3h
      const nowMs = Date.now();
      const times = hr.time || [];
      let curHourIdx = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < times.length; i++) {
        const d = Math.abs(new Date(times[i]).getTime() - nowMs);
        if (d < bestDiff) {
          bestDiff = d;
          curHourIdx = i;
        }
      }
      const precipProbNow = hr.precipitation_probability ? hr.precipitation_probability[curHourIdx] : 0;
      const todayIso = new Date().toISOString().slice(0, 10);
      const hourly3h = [];
      for (let i = 0; i < times.length; i++) {
        const tStr = times[i];
        if (!tStr || !tStr.startsWith(todayIso)) continue;
        const dt = new Date(tStr);
        const hNum = dt.getHours();
        if (hNum % 3 !== 0) continue;
        const wc = weatherCodePT(hr.weather_code ? hr.weather_code[i] : null);
        const wSpd = hr.wind_speed_10m ? hr.wind_speed_10m[i] : null;
        const wDeg = hr.wind_direction_10m ? Math.round(hr.wind_direction_10m[i]) : null;
        hourly3h.push({
          hourNum: hNum,
          timeStr: `${String(hNum).padStart(2, '0')}:00`,
          icon: wc.icon,
          temp: hr.temperature_2m && hr.temperature_2m[i] != null ? Math.round(hr.temperature_2m[i]) : '--',
          rainProb: hr.precipitation_probability && hr.precipitation_probability[i] != null ? Math.round(hr.precipitation_probability[i]) : 0,
          windKmh: wSpd != null ? Math.round(wSpd) : '--',
          windKnots: kmhToKnots(wSpd),
          windDirDeg: wDeg,
          windDirCard: wDeg != null ? windCardinalPT(wDeg) : '--',
          windLocal: wDeg != null ? windLocalNamePT(wDeg) : 'Variável'
        });
      }

      // Correntes marítimas (atual + próximas 24h de 3h em 3h)
      const marHr = (mData && mData.hourly) || {};
      const marTimes = marHr.time || [];
      let marCurIdx = 0;
      let marBestDiff = Infinity;
      for (let i = 0; i < marTimes.length; i++) {
        const d = Math.abs(new Date(marTimes[i]).getTime() - nowMs);
        if (d < marBestDiff) {
          marBestDiff = d;
          marCurIdx = i;
        }
      }
      const curVelKmh = mar.ocean_current_velocity != null ? Number(mar.ocean_current_velocity) : null;
      const curVelKts = curVelKmh != null ? curVelKmh * 0.539957 : null;
      const curDirDeg = mar.ocean_current_direction != null ? Math.round(mar.ocean_current_direction) : null;
      const curDirCard = curDirDeg != null ? windCardinalPT(curDirDeg) : '--';

      const currents24h = [];
      for (let step = 0; step < 8; step++) {
        const idx = marCurIdx + step * 3;
        if (idx >= marTimes.length) break;
        const cKmh = marHr.ocean_current_velocity && marHr.ocean_current_velocity[idx] != null
          ? Number(marHr.ocean_current_velocity[idx])
          : null;
        const cKts = cKmh != null ? cKmh * 0.539957 : null;
        const cDeg = marHr.ocean_current_direction && marHr.ocean_current_direction[idx] != null
          ? Math.round(marHr.ocean_current_direction[idx])
          : null;
        currents24h.push({
          timeStr: new Date(marTimes[idx]).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }),
          kts: cKts,
          kmh: cKmh,
          dirDeg: cDeg,
          card: cDeg != null ? windCardinalPT(cDeg) : '--'
        });
      }

      const snapshot = {
        tempC: cur.temperature_2m != null ? Math.round(cur.temperature_2m * 10) / 10 : null,
        humidity: cur.relative_humidity_2m ?? null,
        weatherCode: cur.weather_code != null ? Number(cur.weather_code) : null,
        weatherText: wCode.text,
        weatherIcon: wCode.icon,
        precipitationMm: Number(cur.precipitation || 0),
        rainMm: Number(cur.rain || 0),
        showersMm: Number(cur.showers || 0),
        cloudCover: cur.cloud_cover != null ? Number(cur.cloud_cover) : (hr.cloud_cover ? Number(hr.cloud_cover[curHourIdx] || 0) : 0),
        precipProbNow: precipProbNow ?? 0,
        windKmh: windKmh != null ? Math.round(windKmh) : null,
        windKnots,
        gustsKmh: gustsKmh != null ? Math.round(gustsKmh) : null,
        windDirDeg: windDirDeg != null ? Math.round(windDirDeg) : null,
        windDirCard,
        pressureHpa: pressure != null ? Math.round(pressure) : null,
        pressureTrend: `${trend.arrow} ${trend.label}`,
        pressureTrendCls: trend.cls,
        waveHeightNum: mar.wave_height != null ? Number(mar.wave_height) : null,
        waveHeightM: mar.wave_height != null ? mar.wave_height.toFixed(1) : null,
        wavePeriodS: mar.wave_period != null ? Math.round(mar.wave_period) : null,
        waveDirDeg: mar.wave_direction != null ? Math.round(mar.wave_direction) : null,
        waveDirCard: mar.wave_direction != null ? windCardinalPT(mar.wave_direction) : null,
        seaTempC: mar.sea_surface_temperature != null ? mar.sea_surface_temperature.toFixed(1) : null,
        curVelKmh,
        curVelKts,
        curDirDeg,
        curDirCard,
        currents24h,
        moonPhase: `${moon.icon} ${moon.name} (${moon.illum}%)`,
        hourly3h,
        savedAt: new Date().toISOString()
      };

      state.currentMeteo = snapshot;
      saveOfflineCache(snapshot);
      renderWeatherUI(snapshot, false);
      $('statusLine').textContent = '📡 Dados atualizados (cópia offline guardada)';
    } catch (err) {
      const cached = loadOfflineCache();
      if (cached && cached.snapshot) {
        state.currentMeteo = cached.snapshot;
        renderWeatherUI(cached.snapshot, true, cached.savedAt);
        const dt = new Date(cached.savedAt);
        const tsTxt = !isNaN(dt)
          ? `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
          : '--';
        $('statusLine').textContent = `📴 Offline · Cópia guardada (${tsTxt})`;
      } else {
        $('statusLine').textContent = 'Modo offline / sem cópia guardada';
        showToast('Sem internet e sem previsão guardada offline.');
      }
    }
  }

  function renderTrafficLight(s, isOffline = false, savedAt = null) {
    const card = $('trafficCard');
    const badge = $('trafficBadge');
    const advice = $('trafficAdvice');
    const updated = $('trafficUpdated');
    if (!card || !badge || !advice) return;

    const wind = s.windKmh || 0;
    const windKnots = s.windKnots != null && !isNaN(Number(s.windKnots)) ? Number(s.windKnots) : (wind * 0.539957);
    const gusts = s.gustsKmh || 0;
    const gustsKnots = gusts * 0.539957;
    const wave = s.waveHeightNum || 0;
    const period = s.wavePeriodS != null ? Number(s.wavePeriodS) : null;
    const rainProb = s.precipProbNow || 0;
    const code = s.weatherCode != null ? Number(s.weatherCode) : 0;
    const precip = s.precipitationMm || 0;
    const rain = s.rainMm || 0;
    const showers = s.showersMm || 0;

    const isStorm = code >= 95 && code <= 99;
    const isHeavyRain = (code >= 63 && code <= 67) || code === 82 || precip >= 3.0;
    const isRain = ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) || precip > 0 || rain > 0 || showers > 0;
    const isFog = code === 45 || code === 48;

    const redAlerts = [];
    const yellowAlerts = [];

    if (windKnots > 15) redAlerts.push(`Vento > 15 nós (${windKnots.toFixed(1)} kt)`);
    else if (windKnots >= 11) yellowAlerts.push(`Vento moderado (${windKnots.toFixed(1)} kt)`);

    if (gustsKnots > 22) redAlerts.push(`Rajadas fortes (${gustsKnots.toFixed(0)} kt)`);
    else if (gustsKnots >= 16) yellowAlerts.push(`Rajadas (${gustsKnots.toFixed(0)} kt)`);

    if (wave > 1.5) redAlerts.push(`Ondulação > 1,5 m (${wave.toFixed(1)} m)`);
    else if (wave >= 1.0) yellowAlerts.push(`Ondulação moderada (${wave.toFixed(1)} m)`);

    if (period !== null) {
      if (period < 5.5) redAlerts.push(`Período curto (${period} s — mar picado)`);
      else if (period < 7.5) yellowAlerts.push(`Período curto (${period} s)`);
    }

    if (isStorm) redAlerts.push('Trovoada');
    else if (isHeavyRain) redAlerts.push('Chuva forte');
    else if (isRain) yellowAlerts.push('Chuva / aguaceiros');
    else if (isFog) yellowAlerts.push('Nevoeiro');
    else if (rainProb >= 50) yellowAlerts.push(`Possibilidade de chuva (${rainProb}%)`);

    let cls = 'status-green';
    let badgeTxt = '🟢 Seguro · Barco Pequeno';
    let msg = '';

    if (redAlerts.length > 0) {
      cls = 'status-red';
      badgeTxt = '🔴 Perigo · Barco Pequeno';
      msg = `Desaconselhado sair em barco pequeno: ${redAlerts.join(' · ')}.`;
      if (yellowAlerts.length > 0) msg += ` Atenção ainda a: ${yellowAlerts.join(', ')}.`;
    } else if (yellowAlerts.length > 0) {
      cls = 'status-yellow';
      badgeTxt = '🟡 Atenção · Barco Pequeno';
      msg = `Precaução para barco pequeno: ${yellowAlerts.join(' · ')}.`;
    } else {
      msg = `Condições favoráveis para barco pequeno: vento ${windKnots.toFixed(1)} kt (${s.windDirCard || '--'}), vaga ${wave ? `${wave.toFixed(1)} m` : '--'}${period ? ` / ${period} s` : ''}.`;
    }

    card.className = `traffic-card ${cls}`;
    badge.textContent = badgeTxt;
    advice.textContent = msg;
    if (updated) {
      if (isOffline && savedAt) {
        const dt = new Date(savedAt);
        const ts = !isNaN(dt)
          ? `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
          : '--';
        updated.textContent = `📴 Offline (${ts})`;
      } else {
        updated.textContent = `Atualizado: ${new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`;
      }
    }
  }

  function renderHourlyStrip(items) {
    const strip = $('hourlyStrip');
    if (!strip) return;
    if (!items || !items.length) {
      strip.innerHTML = '<div class="loc-sub">Previsão horária indisponível.</div>';
      return;
    }

    const manha = items.filter((h) => (h.hourNum != null ? h.hourNum <= 12 : parseInt(h.timeStr, 10) <= 12));
    const tarde = items.filter((h) => (h.hourNum != null ? h.hourNum >= 15 : parseInt(h.timeStr, 10) >= 15));

    const renderGroup = (title, list) => {
      if (!list.length) return '';
      const cards = list.map((h) => {
        const rot = h.windDirDeg != null ? (h.windDirDeg + 180) % 360 : 0;
        const dirBadge = h.windDirDeg != null
          ? `<span style="display:inline-block;transform:rotate(${rot}deg);font-weight:900;">↑</span> ${h.windDirCard}`
          : '--';
        return `
          <div class="hour-card">
            <div class="hour-time">${h.timeStr}</div>
            <div class="hour-ico">${h.icon}</div>
            <div class="hour-temp">${h.temp}°C</div>
            <div class="hour-meta">💨 <strong>${h.windKnots} kt</strong> (${h.windKmh})</div>
            <div class="hour-meta">${dirBadge} · <small>${h.windLocal || ''}</small></div>
            <div class="hour-meta">💧 ${h.rainProb}%</div>
          </div>
        `;
      }).join('');
      return `
        <div class="hourly-period-block">
          <div class="hourly-period-title">${title}</div>
          <div class="hourly-strip">${cards}</div>
        </div>
      `;
    };

    strip.innerHTML =
      renderGroup('🌅 Manhã (00h – 12h)', manha) +
      renderGroup('🌇 Tarde / Noite (15h – 21h)', tarde);
  }

  function renderWeatherUI(s, isOffline = false, savedAt = null) {
    $('wIcon').textContent = s.weatherIcon;
    $('wTemp').textContent = s.tempC != null ? `${s.tempC}°C` : '--°C';
    $('wDesc').textContent = s.weatherText;

    $('mWindKmh').textContent = s.windKmh != null ? `${s.windKmh} km/h` : '-- km/h';
    $('mWindKnots').textContent = `${s.windKnots} nós · Raj: ${s.gustsKmh ?? '--'} km/h`;

    $('mWindDir').textContent = s.windDirCard || '--';
    $('mWindDeg').textContent = s.windDirDeg != null ? `${s.windDirDeg}°` : '---°';

    $('mPressure').textContent = s.pressureHpa != null ? `${s.pressureHpa} hPa` : '---- hPa';
    const pTrendEl = $('mPressureTrend');
    pTrendEl.textContent = s.pressureTrend;
    pTrendEl.className = `metric-sub ${s.pressureTrendCls || ''}`;

    $('mHumidity').textContent = s.humidity != null ? `${s.humidity}%` : '--%';
    if (isOffline && savedAt) {
      const dt = new Date(savedAt);
      const ts = !isNaN(dt)
        ? `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
        : '--';
      $('mUpdatedAt').textContent = `📴 Offline: ${ts}`;
    } else {
      const nowStr = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
      $('mUpdatedAt').textContent = `Atualizado: ${nowStr}`;
    }

    $('mWaveHeight').textContent = s.waveHeightM != null ? `${s.waveHeightM} m` : '-- m';
    $('mWavePeriod').textContent = s.wavePeriodS != null ? `${s.wavePeriodS} s` : '-- s';

    $('mSeaTemp').textContent = s.seaTempC != null ? `${s.seaTempC}°C` : '--°C';
    $('mWaveDir').textContent = s.waveDirCard ? `${s.waveDirCard}${s.waveDirDeg != null ? ` ${s.waveDirDeg}°` : ''}` : '--';
    if ($('mWaveArrow') && s.waveDirDeg != null) {
      $('mWaveArrow').style.transform = `rotate(${(s.waveDirDeg + 180) % 360}deg)`;
    }

    renderTrafficLight(s, isOffline, savedAt);
    renderHourlyStrip(s.hourly3h);
    renderCurrentsCard(s);

    $('regSnapshotSummary').textContent =
      `Anexo automático: ${state.locationName} · ${s.tempC ?? '--'}°C · Vento ${s.windKmh ?? '--'} km/h (${s.windDirCard}) · Mar ${s.waveHeightM ?? '--'} m`;
  }

  function classifyCurrent(kts) {
    if (kts == null || isNaN(kts)) return { label: 'Sem dados', cls: '' };
    if (kts < 0.5) return { label: 'Fraca', cls: 'badge-weak' };
    if (kts <= 1.5) return { label: 'Moderada', cls: 'badge-mod' };
    return { label: 'Forte', cls: 'badge-strong' };
  }

  function renderCurrentsCard(s) {
    const badge = $('curIntensityBadge');
    const spdEl = $('curSpeedMain');
    const kmhEl = $('curSpeedKmh');
    const arrowEl = $('curArrow');
    const dirTxt = $('curDirText');
    const dirSub = $('curDirSub');
    const tableWrap = $('currentsTableWrap');
    if (!spdEl || !tableWrap) return;

    if (s.curVelKts == null) {
      badge.textContent = 'Sem dados';
      badge.className = 'current-badge';
      spdEl.textContent = '-- kt';
      kmhEl.textContent = 'Ponto em terra ou offline';
      dirTxt.textContent = 'Corre para --';
      dirSub.textContent = 'Sentido do fluxo';
      arrowEl.style.transform = 'rotate(0deg)';
    } else {
      const info = classifyCurrent(s.curVelKts);
      badge.textContent = info.label;
      badge.className = `current-badge ${info.cls}`;
      spdEl.textContent = `${s.curVelKts.toFixed(1)} kt`;
      kmhEl.textContent = `${s.curVelKmh.toFixed(1)} km/h`;
      if (s.curDirDeg != null) {
        arrowEl.style.transform = `rotate(${s.curDirDeg}deg)`;
        dirTxt.textContent = `Corre para ${s.curDirCard} · ${s.curDirDeg}°`;
      } else {
        dirTxt.textContent = 'Corre para --';
      }
      dirSub.textContent = 'Sentido do fluxo marítimo';
    }

    const rows = s.currents24h || [];
    if (!rows.length || rows.every((r) => r.kts == null)) {
      tableWrap.innerHTML = '<div class="loc-sub" style="padding:10px;">Sem dados horários de corrente para esta coordenada.</div>';
      return;
    }

    const tbody = rows.map((r) => {
      const info = classifyCurrent(r.kts);
      const ktsStr = r.kts != null ? `${r.kts.toFixed(1)} kt` : '--';
      const rot = r.dirDeg != null ? r.dirDeg : 0;
      const rumo = r.dirDeg != null
        ? `<span style="display:inline-flex;align-items:center;gap:4px;"><span style="display:inline-block;transform:rotate(${rot}deg);font-weight:900;">↑</span> ${r.card} (${r.dirDeg}°)</span>`
        : '--';
      return `<tr>
        <td><strong>${r.timeStr}</strong></td>
        <td>${ktsStr}</td>
        <td>${rumo}</td>
        <td><span class="current-badge ${info.cls}">${info.label}</span></td>
      </tr>`;
    }).join('');

    tableWrap.innerHTML = `
      <table class="currents-table">
        <thead>
          <tr>
            <th>Hora</th>
            <th>Força (kt)</th>
            <th>Rumo</th>
            <th>Intensidade</th>
          </tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>`;
  }

  // --- Formulário Registo do Dia ---
  function bindChipGroup(groupId) {
    const grp = $(groupId);
    grp.querySelectorAll('.chip-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        grp.querySelectorAll('.chip-opt').forEach((x) => x.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
  }

  function getSelectedChip(groupId) {
    const sel = $(groupId).querySelector('.chip-opt.selected');
    return sel ? sel.dataset.val : '';
  }

  bindChipGroup('grpSeaState');
  bindChipGroup('grpWindFeel');
  bindChipGroup('grpVisibility');

  $('regPhotoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      showToast('A processar foto...');
      const dataUrl = await compressImageFile(file, 960, 0.72);
      state.pendingPhotoDataUrl = dataUrl;
      $('regPhotoPreview').src = dataUrl;
      $('regPhotoPreview').classList.add('visible');
      $('btnClearPhoto').style.display = 'inline-flex';
    } catch (_) {
      showToast('Não foi possível carregar a foto.');
    }
  });

  $('btnClearPhoto').addEventListener('click', () => {
    state.pendingPhotoDataUrl = null;
    $('regPhotoInput').value = '';
    $('regPhotoPreview').src = '';
    $('regPhotoPreview').classList.remove('visible');
    $('btnClearPhoto').style.display = 'none';
  });

  $('btnSaveEntry').addEventListener('click', async () => {
    const now = new Date();
    const record = {
      id: Date.now(),
      timestamp: now.getTime(),
      dateStr: now.toLocaleDateString('pt-PT'),
      timeStr: now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }),
      locationName: state.locationName,
      lat: state.lat,
      lon: state.lon,
      seaState: getSelectedChip('grpSeaState'),
      windFeel: getSelectedChip('grpWindFeel'),
      visibility: getSelectedChip('grpVisibility'),
      notes: $('regNotes').value.trim(),
      photoDataUrl: state.pendingPhotoDataUrl,
      meteo: state.currentMeteo || {}
    };

    await window.MeteoDB.saveRecord(record);
    state.records = await window.MeteoDB.getAllRecords();

    // Limpar notas e foto após guardar
    $('regNotes').value = '';
    $('btnClearPhoto').click();
    showToast('💾 Registo do dia guardado!');
  });

  // --- Histórico, Pesquisa e Exportação ---
  async function loadRecords() {
    state.records = await window.MeteoDB.getAllRecords();
    renderHistory();
  }

  function renderHistory() {
    const q = $('searchHistory').value.trim().toLowerCase();
    const filtered = !q
      ? state.records
      : state.records.filter((r) => {
          const blob = [
            r.dateStr,
            r.timeStr,
            r.locationName,
            r.seaState,
            r.windFeel,
            r.visibility,
            r.notes,
            r.meteo && r.meteo.moonPhase
          ].join(' ').toLowerCase();
          return blob.includes(q);
        });

    $('historyCount').textContent = `${filtered.length} de ${state.records.length} registos`;
    const list = $('historyList');
    if (!filtered.length) {
      list.innerHTML = '<div class="section-card"><div class="loc-sub">Nenhum registo encontrado.</div></div>';
      return;
    }

    list.innerHTML = '';
    filtered.forEach((r) => {
      const m = r.meteo || {};
      const card = document.createElement('div');
      card.className = 'history-card';
      card.innerHTML = `
        <div class="history-top">
          <div>
            <div class="history-date">📅 ${r.dateStr} · ${r.timeStr}</div>
            <div class="history-loc">📍 ${r.locationName} (${r.lat.toFixed(4)}, ${r.lon.toFixed(4)})</div>
          </div>
          <button class="btn btn-danger btn-sm" data-del="${r.id}">🗑️</button>
        </div>
        <div class="history-badges">
          <span class="badge">🌊 ${r.seaState}</span>
          <span class="badge">💨 ${r.windFeel}</span>
          <span class="badge">👁️ ${r.visibility}</span>
          ${m.tempC != null ? `<span class="badge">🌡️ ${m.tempC}°C</span>` : ''}
          ${m.windKmh != null ? `<span class="badge">🌬️ ${m.windKmh} km/h (${m.windKnots} nós) ${m.windDirCard || ''}</span>` : ''}
          ${m.pressureHpa != null ? `<span class="badge">📊 ${m.pressureHpa} hPa ${m.pressureTrend || ''}</span>` : ''}
          ${m.waveHeightM != null ? `<span class="badge">🌊 ${m.waveHeightM}m / ${m.wavePeriodS || '--'}s</span>` : ''}
          ${m.seaTempC != null ? `<span class="badge">💧 Mar ${m.seaTempC}°C</span>` : ''}
          ${m.moonPhase ? `<span class="badge">${m.moonPhase}</span>` : ''}
        </div>
        ${r.notes ? `<div style="font-size:13px;line-height:1.4;">${escapeHtml(r.notes)}</div>` : ''}
        ${r.photoDataUrl ? `<img class="history-photo" src="${r.photoDataUrl}" alt="Foto do registo">` : ''}
      `;
      card.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Apagar este registo?')) return;
        await window.MeteoDB.deleteRecord(r.id);
        state.records = await window.MeteoDB.getAllRecords();
        renderHistory();
        showToast('Registo apagado.');
      });
      list.appendChild(card);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  $('searchHistory').addEventListener('input', renderHistory);

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('btnExportJson').addEventListener('click', () => {
    if (!state.records.length) return showToast('Sem registos para exportar.');
    const dateTag = new Date().toISOString().slice(0, 10);
    downloadFile(`meteo_diario_backup_${dateTag}.json`, JSON.stringify(state.records, null, 2), 'application/json');
    showToast('Backup JSON exportado!');
  });

  $('btnExportCsv').addEventListener('click', () => {
    if (!state.records.length) return showToast('Sem registos para exportar.');
    const dateTag = new Date().toISOString().slice(0, 10);
    downloadFile(`meteo_diario_${dateTag}.csv`, buildCSV(state.records), 'text/csv;charset=utf-8');
    showToast('Ficheiro CSV exportado!');
  });

  $('importJsonInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed)) throw new Error('Formato inválido');
        await window.MeteoDB.importRecords(parsed);
        state.records = await window.MeteoDB.getAllRecords();
        renderHistory();
        showToast(`Importados ${parsed.length} registos!`);
      } catch (_) {
        showToast('Erro ao importar ficheiro JSON.');
      }
    };
    reader.readAsText(file);
  });

  function renderTideCurveSVG(now, lonDeg) {
    const box = $('tideCurveBox');
    if (!box || !window.MaresLagos) return;

    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const pts = [];
    for (let m = 0; m <= 24 * 60; m += 15) {
      const t = new Date(start.getTime() + m * 60000);
      pts.push({ m, h: window.MaresLagos.getTideHeight(t, lonDeg) });
    }
    const minH = Math.min(...pts.map((p) => p.h)) - 0.15;
    const maxH = Math.max(...pts.map((p) => p.h)) + 0.15;
    const W = 340, H = 120, padL = 8, padR = 8, padT = 16, padB = 22;
    const xOf = (m) => padL + (m / 1440) * (W - padL - padR);
    const yOf = (h) => padT + (1 - (h - minH) / (maxH - minH || 1)) * (H - padT - padB);

    const linePts = pts.map((p) => `${xOf(p.m).toFixed(1)},${yOf(p.h).toFixed(1)}`).join(' ');
    const areaPts = `${xOf(0).toFixed(1)},${H - padB} ${linePts} ${xOf(1440).toFixed(1)},${H - padB}`;

    const nowMin = now.getHours() * 60 + now.getMinutes();
    const nowH = window.MaresLagos.getTideHeight(now, lonDeg);
    const nowX = xOf(nowMin).toFixed(1);
    const nowY = yOf(nowH).toFixed(1);

    const ticks = [0, 6, 12, 18, 24].map((hr) => {
      const x = xOf(hr * 60).toFixed(1);
      return `<text x="${x}" y="${H - 5}" text-anchor="middle" fill="var(--muted)" font-size="10" font-weight="700">${String(hr).padStart(2, '0')}h</text>`;
    }).join('');

    box.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" aria-label="Curva da maré 24 horas">
        <defs>
          <linearGradient id="tideFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.45"/>
            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.04"/>
          </linearGradient>
        </defs>
        <polygon points="${areaPts}" fill="url(#tideFill)"/>
        <polyline points="${linePts}" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linejoin="round"/>
        <line x1="${nowX}" y1="${padT}" x2="${nowX}" y2="${H - padB}" stroke="rgba(251,191,36,0.5)" stroke-dasharray="3,3" stroke-width="1.2"/>
        <circle cx="${nowX}" cy="${nowY}" r="6" fill="rgba(251,191,36,0.35)"/>
        <circle cx="${nowX}" cy="${nowY}" r="3.5" fill="#fbbf24" stroke="#fff" stroke-width="1.2"/>
        <text x="${nowX}" y="${Math.max(11, Number(nowY) - 8)}" text-anchor="middle" fill="#fbbf24" font-size="10" font-weight="800">${nowH.toFixed(1).replace('.', ',')}m</text>
        ${ticks}
      </svg>
    `;
  }

  // --- Tabela das Marés (Lagos / GPS) ---
  function renderTides() {
    if (!window.MaresLagos) return;
    const now = new Date();
    const cur = window.MaresLagos.getCurrentTideState(now, state.lon);
    const days = window.MaresLagos.getMultiDayTides(5, state.lon);

    // Próxima Preia-Mar ou Baixa-Mar + contagem decrescente
    const allExtremes = days.flatMap((d) => d.extremes);
    const nextExt = allExtremes.find((e) => e.time.getTime() > now.getTime());
    let nextTxt = 'Próxima: --';
    if (nextExt) {
      const diffMin = Math.max(1, Math.round((nextExt.time.getTime() - now.getTime()) / 60000));
      const remH = Math.floor(diffMin / 60);
      const remM = diffMin % 60;
      const remStr = remH > 0 ? `${remH}h ${String(remM).padStart(2, '0')}m` : `${remM} min`;
      const hhmm = nextExt.time.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
      nextTxt = `Falta ${remStr} para ${nextExt.type} (${hhmm} · ${nextExt.height.toFixed(1).replace('.', ',')} m)`;
    }

    const dirLabel = cur.rising ? '⬆️ A Encher' : '⬇️ A Vazar';
    const hStr = `${cur.height.toFixed(1).replace('.', ',')} m`;
    const todayTide = days[0];
    $('mTideState').textContent = dirLabel;
    $('mTideHeight').textContent = hStr;
    $('mTideNext').textContent = nextTxt;
    if ($('mTideCoef') && todayTide) {
      $('mTideCoef').textContent = `Coef. ${todayTide.coef} · ${todayTide.tipoMare}`;
    }
    if ($('mTideTodayTable') && todayTide) {
      $('mTideTodayTable').innerHTML = todayTide.extremes.map((ex) => {
        const hhmm = ex.time.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
        const hVal = `${ex.height.toFixed(1).replace('.', ',')} m`;
        const cls = ex.isHigh ? 'high' : 'low';
        const lbl = ex.isHigh ? '⬆️ Preia-Mar' : '⬇️ Baixa-Mar';
        return `<div class="tide-today-pill ${cls}"><span>${lbl}</span><strong>${hhmm}</strong><small>${hVal}</small></div>`;
      }).join('');
    }

    $('tideTabNow').textContent = dirLabel;
    $('tideTabHeight').textContent = hStr;
    $('tideTabLoc').textContent = state.mode === 'lagos'
      ? 'Porto de Lagos'
      : `${state.locationName} (${state.lon.toFixed(2)}°)`;
    $('tideTabNext').textContent = nextTxt;
    renderTideCurveSVG(now, state.lon);

    const list = $('tideDaysList');
    if (!list) return;
    list.innerHTML = '';

    days.forEach((day, idx) => {
      let dayTitle = day.date.toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: '2-digit' });
      if (idx === 0) dayTitle = `Hoje · ${day.date.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })}`;
      else if (idx === 1) dayTitle = `Amanhã · ${day.date.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })}`;

      const rowsHtml = day.extremes.map((ex) => {
        const hhmm = ex.time.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
        const hVal = `${ex.height.toFixed(1).replace('.', ',')} m`;
        const ico = ex.isHigh ? '⬆️ Preia-Mar' : '⬇️ Baixa-Mar';
        const clr = ex.isHigh ? 'var(--accent)' : 'var(--muted)';
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);">
            <span style="font-weight:700;color:${clr};">${ico}</span>
            <span style="font-weight:800;font-variant-numeric:tabular-nums;">${hhmm}</span>
            <span style="font-weight:800;color:var(--text);">${hVal}</span>
          </div>
        `;
      }).join('');

      const card = document.createElement('div');
      card.className = 'section-card';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="text-transform:capitalize;">📅 ${dayTitle}</strong>
          <span class="badge">Coef. ${day.coef} · ${day.tipoMare}</span>
        </div>
        <div>${rowsHtml}</div>
      `;
      list.appendChild(card);
    });
  }

  // Service Worker com atualização automática (skipWaiting + clients.claim)
  let swRegistration = null;
  if ('serviceWorker' in navigator) {
    let swReloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swReloading) return;
      swReloading = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        swRegistration = reg;
        reg.update().catch(() => {});
      })
      .catch(() => {});
  }

  // Atualização automática assim que houver internet (casa / telemóvel / PC)
  window.addEventListener('online', () => {
    if (swRegistration) swRegistration.update().catch(() => {});
    fetchWeatherAndMarine();
    showToast('📡 Ligação restabelecida — a atualizar previsão...');
  });
  window.addEventListener('offline', () => {
    const cached = loadOfflineCache();
    if (cached && cached.snapshot) {
      renderWeatherUI(cached.snapshot, true, cached.savedAt);
      $('statusLine').textContent = '📴 Sem rede — a mostrar cópia offline';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      if (swRegistration) swRegistration.update().catch(() => {});
      const cached = loadOfflineCache();
      const lastTs = cached?.savedAt ? new Date(cached.savedAt).getTime() : 0;
      if (!lastTs || Date.now() - lastTs > 30 * 60 * 1000) {
        fetchWeatherAndMarine();
      }
    }
  });
  setInterval(() => {
    if (navigator.onLine) {
      if (swRegistration) swRegistration.update().catch(() => {});
      fetchWeatherAndMarine();
    }
  }, 30 * 60 * 1000);

  // Arranque: mostra cópia offline imediata se existir, depois tenta GPS/rede
  updateLocationUI();
  loadRecords();
  const initialCache = loadOfflineCache();
  if (initialCache && initialCache.snapshot) {
    state.currentMeteo = initialCache.snapshot;
    renderWeatherUI(initialCache.snapshot, !navigator.onLine, initialCache.savedAt);
  }
  useGPS();
})();
