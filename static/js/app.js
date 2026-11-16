/**
 * Meteo Diário Pro - Aplicação Principal (PWA Móvel)
 */
(function () {
  'use strict';

  const {
    kmhToKnots,
    windCardinalPT,
    pressureTrend,
    moonPhasePT,
    weatherCodePT,
    compressImageFile,
    buildCSV
  } = window.MeteoUtils;

  const LAGOS = { lat: 37.1028, lon: -8.6730, name: 'Lagos' };
  const STORAGE_THEME = 'meteo_diario_theme_v1';

  const state = {
    mode: 'lagos', // 'gps' | 'lagos'
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

  // --- Localização: GPS Atual vs Lagos ---
  function updateLocationUI() {
    $('locTitle').textContent = state.mode === 'gps' ? '📡 Localização GPS Atual' : '⚓ Lagos (Algarve)';
    const latStr = `${Math.abs(state.lat).toFixed(4)}° ${state.lat >= 0 ? 'N' : 'S'}`;
    const lonStr = `${Math.abs(state.lon).toFixed(4)}° ${state.lon >= 0 ? 'E' : 'O'}`;
    $('locCoords').textContent = `${latStr}, ${lonStr}`;
    $('btnUseGps').classList.toggle('active', state.mode === 'gps');
    $('btnUseLagos').classList.toggle('active', state.mode === 'lagos');
  }

  function useLagos() {
    state.mode = 'lagos';
    state.lat = LAGOS.lat;
    state.lon = LAGOS.lon;
    state.locationName = LAGOS.name;
    updateLocationUI();
    fetchWeatherAndMarine();
  }

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
  $('btnUseGps').addEventListener('click', useGPS);
  $('btnRefresh').addEventListener('click', fetchWeatherAndMarine);

  // --- Open-Meteo API (Tempo + Mar) ---
  async function fetchWeatherAndMarine() {
    $('statusLine').textContent = 'A atualizar meteorologia...';
    const lat = state.lat.toFixed(4);
    const lon = state.lon.toFixed(4);

    const forecastUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
      `&hourly=surface_pressure&past_days=1&forecast_days=1&timezone=auto`;

    const marineUrl =
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
      `&current=wave_height,wave_direction,wave_period,sea_surface_temperature&timezone=auto`;

    const moon = moonPhasePT(new Date());
    $('moonIcon').textContent = moon.icon;
    $('moonName').textContent = moon.name;
    $('moonIllum').textContent = `${moon.illum}% iluminada`;

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

      const snapshot = {
        tempC: cur.temperature_2m != null ? Math.round(cur.temperature_2m * 10) / 10 : null,
        humidity: cur.relative_humidity_2m ?? null,
        weatherText: wCode.text,
        weatherIcon: wCode.icon,
        windKmh: windKmh != null ? Math.round(windKmh) : null,
        windKnots,
        gustsKmh: gustsKmh != null ? Math.round(gustsKmh) : null,
        windDirDeg: windDirDeg != null ? Math.round(windDirDeg) : null,
        windDirCard,
        pressureHpa: pressure != null ? Math.round(pressure) : null,
        pressureTrend: `${trend.arrow} ${trend.label}`,
        pressureTrendCls: trend.cls,
        waveHeightM: mar.wave_height != null ? mar.wave_height.toFixed(1) : null,
        wavePeriodS: mar.wave_period != null ? Math.round(mar.wave_period) : null,
        waveDirCard: mar.wave_direction != null ? windCardinalPT(mar.wave_direction) : null,
        seaTempC: mar.sea_surface_temperature != null ? mar.sea_surface_temperature.toFixed(1) : null,
        moonPhase: `${moon.icon} ${moon.name} (${moon.illum}%)`
      };

      state.currentMeteo = snapshot;
      renderWeatherUI(snapshot);
      $('statusLine').textContent = 'Dados atualizados';
    } catch (err) {
      $('statusLine').textContent = 'Modo offline / erro de rede';
      showToast('Não foi possível atualizar. Verifique a ligação.');
    }
  }

  function renderWeatherUI(s) {
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
    const nowStr = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    $('mUpdatedAt').textContent = `Atualizado: ${nowStr}`;

    $('mWaveHeight').textContent = s.waveHeightM != null ? `${s.waveHeightM} m` : '-- m';
    $('mWavePeriod').textContent = `Período: ${s.wavePeriodS ?? '--'} s`;

    $('mSeaTemp').textContent = s.seaTempC != null ? `${s.seaTempC}°C` : '--°C';
    $('mWaveDir').textContent = `Dir. onda: ${s.waveDirCard || '--'}`;

    $('regSnapshotSummary').textContent =
      `Anexo automático: ${state.locationName} · ${s.tempC ?? '--'}°C · Vento ${s.windKmh ?? '--'} km/h (${s.windDirCard}) · Mar ${s.waveHeightM ?? '--'} m`;
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

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Arranque: tenta GPS ou inicia com Lagos
  updateLocationUI();
  loadRecords();
  useGPS();
})();
