/**
 * Carta & Radar: Leaflet + RainViewer (Chuva) + Grelha Open-Meteo (Vento & Isóbaras)
 */
(function (global) {
  'use strict';

  const GRID_LATS = [35.8, 36.3, 36.8, 37.3, 37.8];
  const GRID_LONS = [-10.0, -9.4, -8.8, -8.2, -7.6, -7.0];

  // Grelha alargada Atlântico + Península Ibérica para isóbaras contínuas (30°N–46°N, 20°O–2°E)
  const PRESS_LATS = [30, 32, 34, 36, 38, 40, 42, 44, 46];
  const PRESS_LONS = [-20, -18, -16, -14, -12, -10, -8, -6, -4, -2, 0, 2];

  let map = null;
  let initialized = false;
  let userMarker = null;

  // Camadas
  const rainLayerGroup = L.layerGroup();
  const windLayerGroup = L.layerGroup();
  const isobarLayerGroup = L.layerGroup();

  let rainTileLayer = null;
  let rainFrames = [];
  let rainHost = '';
  let rainIdx = 0;
  let rainTimer = null;

  const layersVisible = {
    rain: true,
    wind: true,
    isobar: true
  };

  function windColor(kmh) {
    if (kmh < 15) return '#38bdf8';      // Fraco (<8 nós)
    if (kmh < 30) return '#10b981';      // Moderado (8-16 nós)
    if (kmh < 45) return '#f59e0b';      // Fresco (16-24 nós)
    return '#ef4444';                    // Forte (>24 nós)
  }

  function initMap(getCurrentCoords) {
    if (initialized) {
      setTimeout(() => map && map.invalidateSize(), 120);
      return;
    }
    initialized = true;

    map = L.map('cartaMapa', {
      zoomControl: true,
      attributionControl: true
    }).setView([37.0, -8.67], 8);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© OpenStreetMap'
    }).addTo(map);

    rainLayerGroup.addTo(map);
    windLayerGroup.addTo(map);
    isobarLayerGroup.addTo(map);

    // Marcador inicial de Lagos
    L.circleMarker([37.1028, -8.6730], {
      radius: 5,
      color: '#ffffff',
      fillColor: '#0284c7',
      fillOpacity: 1,
      weight: 2
    }).addTo(map).bindPopup('⚓ Lagos');

    // Controlos de camadas
    document.getElementById('btnLayerRain').addEventListener('click', (e) => {
      layersVisible.rain = !layersVisible.rain;
      e.currentTarget.classList.toggle('active', layersVisible.rain);
      if (layersVisible.rain) rainLayerGroup.addTo(map);
      else map.removeLayer(rainLayerGroup);
    });

    document.getElementById('btnLayerWind').addEventListener('click', (e) => {
      layersVisible.wind = !layersVisible.wind;
      e.currentTarget.classList.toggle('active', layersVisible.wind);
      if (layersVisible.wind) windLayerGroup.addTo(map);
      else map.removeLayer(windLayerGroup);
    });

    document.getElementById('btnLayerIsobar').addEventListener('click', (e) => {
      layersVisible.isobar = !layersVisible.isobar;
      e.currentTarget.classList.toggle('active', layersVisible.isobar);
      if (layersVisible.isobar) isobarLayerGroup.addTo(map);
      else map.removeLayer(isobarLayerGroup);
    });

    document.getElementById('btnCartaCenterGps').addEventListener('click', () => {
      const pos = getCurrentCoords();
      if (!pos) return;
      if (!userMarker) {
        userMarker = L.circleMarker([pos.lat, pos.lon], {
          radius: 7,
          color: '#fff',
          fillColor: '#10b981',
          fillOpacity: 1,
          weight: 2
        }).addTo(map).bindPopup('📡 A minha posição');
      } else {
        userMarker.setLatLng([pos.lat, pos.lon]);
      }
      map.setView([pos.lat, pos.lon], 10);
    });

    document.getElementById('btnRainPlay').addEventListener('click', toggleRainPlay);
    document.getElementById('rainSlider').addEventListener('input', (e) => {
      stopRainPlay();
      setRainFrame(Number(e.target.value));
    });

    document.getElementById('btnRefreshCarta').addEventListener('click', () => {
      loadRainViewer();
      loadWeatherGrid();
    });

    loadRainViewer();
    loadWeatherGrid();
  }

  // --- RainViewer Radar ---
  async function loadRainViewer() {
    const timeEl = document.getElementById('rainFrameTime');
    timeEl.textContent = 'A carregar radar...';
    try {
      const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      const data = await res.json();
      rainHost = data.host || 'https://tilecache.rainviewer.com';
      rainFrames = (data.radar && data.radar.past) || [];
      if (!rainFrames.length) {
        timeEl.textContent = 'Sem frames de radar';
        return;
      }
      const slider = document.getElementById('rainSlider');
      slider.max = String(rainFrames.length - 1);
      setRainFrame(rainFrames.length - 1);
    } catch (_) {
      timeEl.textContent = 'Radar indisponível offline';
    }
  }

  function setRainFrame(idx) {
    if (!rainFrames.length) return;
    rainIdx = Math.max(0, Math.min(rainFrames.length - 1, idx));
    const frame = rainFrames[rainIdx];
    document.getElementById('rainSlider').value = String(rainIdx);
    const dt = new Date(frame.time * 1000);
    document.getElementById('rainFrameTime').textContent =
      `Radar: ${dt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`;

    if (rainTileLayer) rainLayerGroup.removeLayer(rainTileLayer);
    rainTileLayer = L.tileLayer(`${rainHost}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
      opacity: 0.65,
      maxZoom: 18,
      zIndex: 200
    });
    rainLayerGroup.addLayer(rainTileLayer);
  }

  function toggleRainPlay() {
    const btn = document.getElementById('btnRainPlay');
    if (rainTimer) {
      stopRainPlay();
      return;
    }
    if (!rainFrames.length) return;
    btn.textContent = '⏸';
    rainTimer = setInterval(() => {
      const next = (rainIdx + 1) % rainFrames.length;
      setRainFrame(next);
    }, 650);
  }

  function stopRainPlay() {
    if (rainTimer) {
      clearInterval(rainTimer);
      rainTimer = null;
    }
    const btn = document.getElementById('btnRainPlay');
    if (btn) btn.textContent = '▶';
  }

  // --- Grelhas Open-Meteo (Vento Algarve + Isóbaras Atlântico/Ibéria) ---
  function buildGridCoords(latArr, lonArr) {
    const lats = [];
    const lons = [];
    for (let r = 0; r < latArr.length; r++) {
      for (let c = 0; c < lonArr.length; c++) {
        lats.push(latArr[r]);
        lons.push(lonArr[c]);
      }
    }
    return { lats, lons };
  }

  async function loadWeatherGrid() {
    const statusEl = document.getElementById('cartaGridStatus');
    statusEl.textContent = 'A carregar vento e isóbaras...';

    const wCoords = buildGridCoords(GRID_LATS, GRID_LONS);
    const pCoords = buildGridCoords(PRESS_LATS, PRESS_LONS);

    const windUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${wCoords.lats.join(',')}&longitude=${wCoords.lons.join(',')}` +
      `&current=wind_speed_10m,wind_direction_10m&timezone=auto`;

    const pressUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${pCoords.lats.join(',')}&longitude=${pCoords.lons.join(',')}` +
      `&current=pressure_msl&timezone=auto`;

    try {
      const [wRes, pRes] = await Promise.all([fetch(windUrl), fetch(pressUrl)]);
      const wData = await wRes.json();
      const pData = await pRes.json();
      const wArr = Array.isArray(wData) ? wData : [wData];
      const pArr = Array.isArray(pData) ? pData : [pData];

      windLayerGroup.clearLayers();
      isobarLayerGroup.clearLayers();

      // 1. Vento (Costa Algarvia)
      const wCols = GRID_LONS.length;
      wArr.forEach((item, idx) => {
        const r = Math.floor(idx / wCols);
        const c = idx % wCols;
        const lat = GRID_LATS[r];
        const lon = GRID_LONS[c];
        const cur = item.current || {};
        const spd = cur.wind_speed_10m;
        const dir = cur.wind_direction_10m;

        if (spd != null && dir != null) {
          const col = windColor(spd);
          const kts = (spd * 0.539957).toFixed(0);
          L.circle([lat, lon], {
            radius: 19000,
            color: col,
            fillColor: col,
            fillOpacity: 0.22,
            weight: 0
          }).addTo(windLayerGroup);

          const rot = (dir + 180) % 360;
          const icon = L.divIcon({
            className: 'wind-arrow-icon',
            iconSize: [34, 34],
            iconAnchor: [17, 17],
            html: `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
              <svg width="22" height="22" viewBox="0 0 24 24" style="transform:rotate(${rot}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,0.8));">
                <path d="M12 2 L17 19 L12 15 L7 19 Z" fill="${col}" stroke="#ffffff" stroke-width="1.4"/>
              </svg>
              <span style="font-size:9.5px;font-weight:800;color:#fff;text-shadow:0 1px 3px #000;margin-top:-3px;">${kts}kt</span>
            </div>`
          });
          L.marker([lat, lon], { icon })
            .bindPopup(`💨 Vento: <b>${Math.round(spd)} km/h</b> (${kts} nós)<br>Direção: ${Math.round(dir)}°`)
            .addTo(windLayerGroup);
        }
      });

      // 2. Isóbaras (Atlântico + Península Ibérica, intervalo 1 hPa)
      const pRows = PRESS_LATS.length;
      const pCols = PRESS_LONS.length;
      const pressureGrid = Array.from({ length: pRows }, () => Array(pCols).fill(null));
      let minP = Infinity, maxP = -Infinity;
      let minPt = null, maxPt = null;

      pArr.forEach((item, idx) => {
        const r = Math.floor(idx / pCols);
        const c = idx % pCols;
        const lat = PRESS_LATS[r];
        const lon = PRESS_LONS[c];
        const p = item.current && item.current.pressure_msl;
        if (p != null) {
          pressureGrid[r][c] = p;
          if (p < minP) { minP = p; minPt = { lat, lon, p }; }
          if (p > maxP) { maxP = p; maxPt = { lat, lon, p }; }
        }
      });

      if (isFinite(minP) && isFinite(maxP)) {
        const startLevel = Math.floor(minP);
        const endLevel = Math.ceil(maxP);
        for (let level = startLevel; level <= endLevel; level += 1) {
          drawIsobarLevel(pressureGrid, level);
        }
        if (maxPt) {
          L.marker([maxPt.lat, maxPt.lon], {
            icon: L.divIcon({
              className: 'press-hl',
              iconSize: [34, 34],
              iconAnchor: [17, 17],
              html: `<div style="background:#0284c7;color:#fff;border:2px solid #fff;border-radius:50%;width:28px;height:28px;display:grid;place-items:center;font-weight:900;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,0.5);">A</div>`
            })
          }).bindPopup(`<b>Alta Pressão (A)</b><br>${maxPt.p.toFixed(1)} hPa`).addTo(isobarLayerGroup);
        }
        if (minPt) {
          L.marker([minPt.lat, minPt.lon], {
            icon: L.divIcon({
              className: 'press-hl',
              iconSize: [34, 34],
              iconAnchor: [17, 17],
              html: `<div style="background:#ef4444;color:#fff;border:2px solid #fff;border-radius:50%;width:28px;height:28px;display:grid;place-items:center;font-weight:900;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,0.5);">B</div>`
            })
          }).bindPopup(`<b>Baixa Pressão (B)</b><br>${minPt.p.toFixed(1)} hPa`).addTo(isobarLayerGroup);
        }
      }

      statusEl.textContent = `Grelha atualizada (${Math.round(minP)}–${Math.round(maxP)} hPa · 1 hPa)`;
    } catch (_) {
      statusEl.textContent = 'Erro ao carregar grelha (offline?)';
    }
  }

  /**
   * Suavização Chaikin para tornar as isóbaras curvas suaves e contínuas.
   */
  function smoothPolyline(pts, iterations = 2) {
    let cur = pts;
    for (let it = 0; it < iterations; it++) {
      if (cur.length < 3) break;
      const next = [cur[0]];
      for (let i = 0; i < cur.length - 1; i++) {
        const p0 = cur[i];
        const p1 = cur[i + 1];
        next.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]);
        next.push([0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
      }
      next.push(cur[cur.length - 1]);
      cur = next;
    }
    return cur;
  }

  /**
   * Encadeia segmentos soltos de Marching Squares em polilinhas contínuas.
   */
  function chainSegments(segments) {
    const key = (pt) => `${pt[0].toFixed(4)},${pt[1].toFixed(4)}`;
    const unused = segments.map((s) => ({ a: s[0], b: s[1], used: false }));
    const chains = [];

    for (let i = 0; i < unused.length; i++) {
      if (unused[i].used) continue;
      unused[i].used = true;
      const line = [unused[i].a, unused[i].b];

      let extended = true;
      while (extended) {
        extended = false;
        const tailKey = key(line[line.length - 1]);
        const headKey = key(line[0]);
        for (let j = 0; j < unused.length; j++) {
          if (unused[j].used) continue;
          const ak = key(unused[j].a);
          const bk = key(unused[j].b);
          if (ak === tailKey) {
            line.push(unused[j].b);
            unused[j].used = true;
            extended = true;
            break;
          } else if (bk === tailKey) {
            line.push(unused[j].a);
            unused[j].used = true;
            extended = true;
            break;
          } else if (bk === headKey) {
            line.unshift(unused[j].a);
            unused[j].used = true;
            extended = true;
            break;
          } else if (ak === headKey) {
            line.unshift(unused[j].b);
            unused[j].used = true;
            extended = true;
            break;
          }
        }
      }
      chains.push(line);
    }
    return chains;
  }

  /**
   * Marching Squares na grelha alargada (1 em 1 hPa) com encadeamento, suavização e rótulos repetidos.
   */
  function drawIsobarLevel(grid, level) {
    const rows = PRESS_LATS.length;
    const cols = PRESS_LONS.length;
    const rawSegments = [];

    function interp(v1, v2, p1, p2) {
      if (Math.abs(v2 - v1) < 1e-6) return (p1 + p2) / 2;
      const t = (level - v1) / (v2 - v1);
      return p1 + t * (p2 - p1);
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const v0 = grid[r][c];
        const v1 = grid[r][c + 1];
        const v2 = grid[r + 1][c + 1];
        const v3 = grid[r + 1][c];
        if (v0 == null || v1 == null || v2 == null || v3 == null) continue;

        const b0 = v0 >= level ? 1 : 0;
        const b1 = v1 >= level ? 2 : 0;
        const b2 = v2 >= level ? 4 : 0;
        const b3 = v3 >= level ? 8 : 0;
        const mask = b0 | b1 | b2 | b3;
        if (mask === 0 || mask === 15) continue;

        const lat0 = PRESS_LATS[r], lat1 = PRESS_LATS[r + 1];
        const lon0 = PRESS_LONS[c], lon1 = PRESS_LONS[c + 1];

        const top = [lat0, interp(v0, v1, lon0, lon1)];
        const right = [interp(v1, v2, lat0, lat1), lon1];
        const bottom = [lat1, interp(v3, v2, lon0, lon1)];
        const left = [interp(v0, v3, lat0, lat1), lon0];

        if (mask === 1 || mask === 14) rawSegments.push([left, top]);
        else if (mask === 2 || mask === 13) rawSegments.push([top, right]);
        else if (mask === 4 || mask === 11) rawSegments.push([right, bottom]);
        else if (mask === 8 || mask === 7) rawSegments.push([bottom, left]);
        else if (mask === 3 || mask === 12) rawSegments.push([left, right]);
        else if (mask === 6 || mask === 9) rawSegments.push([top, bottom]);
        else if (mask === 5) { rawSegments.push([left, top]); rawSegments.push([right, bottom]); }
        else if (mask === 10) { rawSegments.push([top, right]); rawSegments.push([bottom, left]); }
      }
    }

    const chains = chainSegments(rawSegments);
    const isMajor = level % 4 === 0;

    chains.forEach((chain) => {
      const smooth = smoothPolyline(chain, 2);
      L.polyline(smooth, {
        color: isMajor ? '#fef08a' : '#f8fafc',
        weight: isMajor ? 2.8 : 2.1,
        opacity: isMajor ? 0.95 : 0.82
      }).addTo(isobarLayerGroup);

      // Rótulos numéricos repetidos ao longo da linha (a cada ~6 vértices após suavização)
      const step = Math.max(5, Math.floor(smooth.length / 4));
      for (let i = Math.floor(step / 2); i < smooth.length; i += step) {
        const pt = smooth[i];
        L.marker(pt, {
          interactive: false,
          icon: L.divIcon({
            className: 'isobar-lbl',
            iconSize: [56, 18],
            iconAnchor: [28, 9],
            html: `<div style="background:rgba(15,23,42,0.88);color:${isMajor ? '#fef08a' : '#f8fafc'};border:1px solid ${isMajor ? '#fde047' : 'rgba(255,255,255,0.45)'};border-radius:6px;font-size:10px;font-weight:800;text-align:center;line-height:16px;">${level} hPa</div>`
          })
        }).addTo(isobarLayerGroup);
      }
    });
  }

  global.CartaRadar = { initMap };
})(window);
