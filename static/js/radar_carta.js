/**
 * Carta & Radar: Leaflet + RainViewer (Chuva) + Grelha Open-Meteo (Vento & Isóbaras)
 */
(function (global) {
  'use strict';

  const GRID_LATS = [35.8, 36.3, 36.8, 37.3, 37.8];
  const GRID_LONS = [-10.0, -9.4, -8.8, -8.2, -7.6, -7.0];

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

  // --- Grelha Open-Meteo (Vento + Isóbaras) ---
  async function loadWeatherGrid() {
    const statusEl = document.getElementById('cartaGridStatus');
    statusEl.textContent = 'A carregar vento e isóbaras...';

    const lats = [];
    const lons = [];
    for (let r = 0; r < GRID_LATS.length; r++) {
      for (let c = 0; c < GRID_LONS.length; c++) {
        lats.push(GRID_LATS[r]);
        lons.push(GRID_LONS[c]);
      }
    }

    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
      `&current=wind_speed_10m,wind_direction_10m,pressure_msl&timezone=auto`;

    try {
      const res = await fetch(url);
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [data];

      const rows = GRID_LATS.length;
      const cols = GRID_LONS.length;
      const pressureGrid = Array.from({ length: rows }, () => Array(cols).fill(null));

      windLayerGroup.clearLayers();
      isobarLayerGroup.clearLayers();

      let minP = Infinity, maxP = -Infinity;
      let minPt = null, maxPt = null;

      arr.forEach((item, idx) => {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const lat = GRID_LATS[r];
        const lon = GRID_LONS[c];
        const cur = item.current || {};
        const spd = cur.wind_speed_10m;
        const dir = cur.wind_direction_10m;
        const p = cur.pressure_msl;

        if (p != null) {
          pressureGrid[r][c] = p;
          if (p < minP) { minP = p; minPt = { lat, lon, p }; }
          if (p > maxP) { maxP = p; maxPt = { lat, lon, p }; }
        }

        if (spd != null && dir != null) {
          const col = windColor(spd);
          const kts = (spd * 0.539957).toFixed(0);
          // Círculo de intensidade
          L.circle([lat, lon], {
            radius: 19000,
            color: col,
            fillColor: col,
            fillOpacity: 0.22,
            weight: 0
          }).addTo(windLayerGroup);

          // Seta direcional (vento sopra PARA dir + 180)
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

      // Desenhar Isóbaras (Marching Squares a cada 2 hPa)
      if (isFinite(minP) && isFinite(maxP)) {
        const startLevel = Math.floor(minP / 2) * 2;
        const endLevel = Math.ceil(maxP / 2) * 2;
        for (let level = startLevel; level <= endLevel; level += 2) {
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

      statusEl.textContent = `Grelha atualizada (${Math.round(minP)}–${Math.round(maxP)} hPa)`;
    } catch (_) {
      statusEl.textContent = 'Erro ao carregar grelha (offline?)';
    }
  }

  /**
   * Marching Squares simples numa grelha regular para extrair segmentos de isóbara.
   */
  function drawIsobarLevel(grid, level) {
    const rows = GRID_LATS.length;
    const cols = GRID_LONS.length;
    let labelPlaced = false;

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

        const lat0 = GRID_LATS[r], lat1 = GRID_LATS[r + 1];
        const lon0 = GRID_LONS[c], lon1 = GRID_LONS[c + 1];

        const top = [lat0, interp(v0, v1, lon0, lon1)];
        const right = [interp(v1, v2, lat0, lat1), lon1];
        const bottom = [lat1, interp(v3, v2, lon0, lon1)];
        const left = [interp(v0, v3, lat0, lat1), lon0];

        const edges = [];
        if (mask === 1 || mask === 14) edges.push([left, top]);
        else if (mask === 2 || mask === 13) edges.push([top, right]);
        else if (mask === 4 || mask === 11) edges.push([right, bottom]);
        else if (mask === 8 || mask === 7) edges.push([bottom, left]);
        else if (mask === 3 || mask === 12) edges.push([left, right]);
        else if (mask === 6 || mask === 9) edges.push([top, bottom]);
        else if (mask === 5) { edges.push([left, top]); edges.push([right, bottom]); }
        else if (mask === 10) { edges.push([top, right]); edges.push([bottom, left]); }

        edges.forEach((seg) => {
          L.polyline(seg, {
            color: '#f8fafc',
            weight: 2,
            opacity: 0.85,
            dashArray: level % 4 === 0 ? null : '4,4'
          }).addTo(isobarLayerGroup);

          if (!labelPlaced) {
            labelPlaced = true;
            const midLat = (seg[0][0] + seg[1][0]) / 2;
            const midLon = (seg[0][1] + seg[1][1]) / 2;
            L.marker([midLat, midLon], {
              interactive: false,
              icon: L.divIcon({
                className: 'isobar-lbl',
                iconSize: [52, 18],
                iconAnchor: [26, 9],
                html: `<div style="background:rgba(15,23,42,0.82);color:#e2e8f0;border:1px solid rgba(255,255,255,0.35);border-radius:6px;font-size:10px;font-weight:800;text-align:center;line-height:16px;">${level} hPa</div>`
              })
            }).addTo(isobarLayerGroup);
          }
        });
      }
    }
  }

  global.CartaRadar = { initMap };
})(window);
