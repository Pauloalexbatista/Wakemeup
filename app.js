// WakeMeUp! - Core Application Logic
// State Management
const state = {
  userLocation: null,
  targetLocation: null,
  alarmRadius: 500, // in meters
  isTracking: false,
  isAlarmActive: false,
  soundType: 'synthesizer',
  customAudioUrl: null,
  watchId: null,
  timerId: null,
  pollingIntervalMs: 10000,
  wakeLock: null,
  silentAudioCtx: null,
  alarmAudioCtx: null,
  alarmIntervalId: null,
  vibrationIntervalId: null,
  lastKnownDistance: null
};

// DOM Elements
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const metricDistance = document.getElementById('metric-distance');
const metricEta = document.getElementById('metric-eta');
const metricPolling = document.getElementById('metric-polling');
const metricTargetStatus = document.getElementById('metric-target-status');
const radiusLabel = document.getElementById('radius-value-label');
const radiusChips = document.querySelectorAll('.chip');
const btnToggleTracking = document.getElementById('btn-toggle-tracking');
const addressInput = document.getElementById('address-input');
const btnSearch = document.getElementById('btn-search');
const btnMyLocation = document.getElementById('btn-my-location');
const soundSelect = document.getElementById('sound-select');
const customAudioInput = document.getElementById('custom-audio-input');
const btnTestSound = document.getElementById('btn-test-sound');
const alarmModal = document.getElementById('alarm-modal');
const btnStopAlarm = document.getElementById('btn-stop-alarm');
const btnPocketMode = document.getElementById('btn-pocket-mode');
const pocketOverlay = document.getElementById('pocket-overlay');
const pocketDistText = document.getElementById('pocket-dist-text');
const installPwaBadge = document.getElementById('install-pwa-badge');

// 1. Map Initialization
let map, userMarker, targetMarker, targetRadiusCircle;

function initMap() {
  // Default to Lisbon coordinates or user location
  const defaultPos = [38.7223, -9.1393];
  
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView(defaultPos, 14);

  // OpenStreetMap standard tiles (100% gratuito e sem necessidade de API key)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  // Add zoom control top-right
  L.control.zoom({ position: 'topright' }).addTo(map);

  // Map click to place target
  map.on('click', (e) => {
    setTargetLocation(e.latlng.lat, e.latlng.lng);
  });

  // Auto-centra imediatamente na localizacao do utilizador ao abrir
  locateUser(true);
}

// 2. Geolocation & Distance (Haversine formula)
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function locateUser(centerMap = true) {
  if (!navigator.geolocation) {
    alert('Geolocalização não é suportada pelo teu navegador.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      state.userLocation = { lat: latitude, lng: longitude };
      updateUserMarker(latitude, longitude);

      if (centerMap) {
        map.flyTo([latitude, longitude], 15);
      }
      updateMetrics();
    },
    (err) => {
      console.warn('Erro ao obter localização:', err.message);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function updateUserMarker(lat, lng) {
  if (!userMarker) {
    const userIcon = L.divIcon({
      className: 'user-location-marker',
      html: '<div style="width: 16px; height: 16px; background: #0284c7; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 0 14px #0284c7;"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
    userMarker = L.marker([lat, lng], { icon: userIcon }).addTo(map);
  } else {
    userMarker.setLatLng([lat, lng]);
  }
}

function setTargetLocation(lat, lng) {
  state.targetLocation = { lat, lng };

  if (!targetMarker) {
    const targetIcon = L.divIcon({
      className: 'target-marker',
      html: '<div style="font-size: 28px; line-height: 1; transform: translate(-50%, -100%);">🎯</div>',
      iconSize: [28, 28],
      iconAnchor: [14, 28]
    });
    targetMarker = L.marker([lat, lng], { icon: targetIcon, draggable: true }).addTo(map);
    targetMarker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      setTargetLocation(pos.lat, pos.lng);
    });
  } else {
    targetMarker.setLatLng([lat, lng]);
  }

  // Update or create radius circle
  if (!targetRadiusCircle) {
    targetRadiusCircle = L.circle([lat, lng], {
      radius: state.alarmRadius,
      color: '#0ea5e9',
      fillColor: '#0ea5e9',
      fillOpacity: 0.22,
      weight: 2
    }).addTo(map);
  } else {
    targetRadiusCircle.setLatLng([lat, lng]);
    targetRadiusCircle.setRadius(state.alarmRadius);
  }

  metricTargetStatus.textContent = 'Destino pronto';
  metricTargetStatus.style.color = '#34d399';
  updateMetrics();
}

// 3. Adaptive Polling & Tracking Loop
function calculatePollingInterval(distanceMeters) {
  // Adaptive rules:
  // > 10 km (~20-40 min em transporte): 3 minutos (poupa bateria)
  // 5 km - 10 km (~10-20 min): 60 segundos
  // 2 km - 5 km (~5-10 min): 30 segundos
  // 1 km - 2 km (~2-5 min): 15 segundos
  // < 1 km ou próximo do raio: 5 segundos
  if (distanceMeters > 10000) return 180000; // 3 min
  if (distanceMeters > 5000) return 60000;   // 1 min
  if (distanceMeters > 2000) return 30000;   // 30 seg
  if (distanceMeters > 1000) return 15000;   // 15 seg
  return 6000;                              // 6 seg
}

function updateMetrics() {
  if (!state.targetLocation || !state.userLocation) {
    metricDistance.textContent = '-- km';
    metricEta.textContent = 'Define o destino';
    metricPolling.textContent = '--';
    return;
  }

  const distance = calculateDistanceMeters(
    state.userLocation.lat,
    state.userLocation.lng,
    state.targetLocation.lat,
    state.targetLocation.lng
  );

  state.lastKnownDistance = distance;

  // Format distance
  if (distance >= 1000) {
    metricDistance.textContent = `${(distance / 1000).toFixed(1)} km`;
  } else {
    metricDistance.textContent = `${Math.round(distance)} m`;
  }

  if (pocketDistText) {
    pocketDistText.textContent = metricDistance.textContent;
  }

  // Estimate transit ETA (avg 35 km/h)
  const speedMetersPerSec = 35 * (1000 / 3600);
  const secondsLeft = distance / speedMetersPerSec;
  const minutesLeft = Math.ceil(secondsLeft / 60);

  if (minutesLeft > 60) {
    const hours = Math.floor(minutesLeft / 60);
    const mins = minutesLeft % 60;
    metricEta.textContent = `~${hours}h ${mins}m (estimado)`;
  } else {
    metricEta.textContent = `~${minutesLeft} min (estimado)`;
  }

  // Check if within alarm radius
  if (state.isTracking && distance <= state.alarmRadius) {
    triggerAlarm();
    return;
  }

  // Update dynamic polling display
  if (state.isTracking) {
    const intervalMs = calculatePollingInterval(distance);
    state.pollingIntervalMs = intervalMs;
    const intervalSec = Math.round(intervalMs / 1000);
    metricPolling.textContent = intervalSec >= 60 ? `${intervalSec / 60}m` : `${intervalSec}s`;
  }
}

function startTracking() {
  if (!state.targetLocation) {
    alert('Por favor, clica no mapa ou pesquisa para definir onde queres descer.');
    return;
  }

  state.isTracking = true;
  btnToggleTracking.classList.remove('activate');
  btnToggleTracking.classList.add('deactivate');
  btnToggleTracking.querySelector('span').textContent = '🛑 CANCELAR VIGILÂNCIA';

  statusBadge.className = 'status-pill active';
  statusText.textContent = 'A Vigiar Trajeto';

  // Keep background alive with silent loop & WakeLock
  startBackgroundKeepAlive();
  requestWakeLock();

  runAdaptiveCheck();
}

function stopTracking() {
  state.isTracking = false;
  if (state.timerId) clearTimeout(state.timerId);
  stopBackgroundKeepAlive();
  releaseWakeLock();

  btnToggleTracking.classList.remove('deactivate');
  btnToggleTracking.classList.add('activate');
  btnToggleTracking.querySelector('span').textContent = '🚀 ATIVAR ALARME DE CHEGADA';

  statusBadge.className = 'status-pill';
  statusText.textContent = 'Em Espera';
  metricPolling.textContent = '--';
}

function runAdaptiveCheck() {
  if (!state.isTracking) return;

  const highAccuracy = state.lastKnownDistance && state.lastKnownDistance < 2500;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      state.userLocation = { lat: latitude, lng: longitude };
      updateUserMarker(latitude, longitude);
      updateMetrics();

      if (state.isTracking && !state.isAlarmActive) {
        const nextInterval = calculatePollingInterval(state.lastKnownDistance || 5000);
        state.pollingIntervalMs = nextInterval;
        state.timerId = setTimeout(runAdaptiveCheck, nextInterval);
      }
    },
    (err) => {
      console.warn('Erro no ciclo de geolocalização:', err);
      // Retry in 10s on transient error
      if (state.isTracking && !state.isAlarmActive) {
        state.timerId = setTimeout(runAdaptiveCheck, 10000);
      }
    },
    { enableHighAccuracy: highAccuracy, timeout: 12000, maximumAge: 0 }
  );
}

// 4. Background Keep-Alive Audio Hack
// Plays silent sound every 25 seconds to keep the mobile browser audio session and JS alive
function startBackgroundKeepAlive() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!state.silentAudioCtx) {
      state.silentAudioCtx = new AudioContext();
    }
    if (state.silentAudioCtx.state === 'suspended') {
      state.silentAudioCtx.resume();
    }
    playSilentTick();
  } catch (e) {
    console.log('Background audio setup:', e);
  }
}

function playSilentTick() {
  if (!state.isTracking || !state.silentAudioCtx) return;
  try {
    const osc = state.silentAudioCtx.createOscillator();
    const gain = state.silentAudioCtx.createGain();
    gain.gain.value = 0.0001; // virtually silent
    osc.connect(gain);
    gain.connect(state.silentAudioCtx.destination);
    osc.start();
    osc.stop(state.silentAudioCtx.currentTime + 0.1);
  } catch (e) {}

  setTimeout(playSilentTick, 25000);
}

function stopBackgroundKeepAlive() {
  if (state.silentAudioCtx) {
    state.silentAudioCtx.close().catch(() => {});
    state.silentAudioCtx = null;
  }
}

// 5. Wake Lock API (keeps screen awake if desired)
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.log('Wake Lock denied:', err.message);
    }
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }
}

// 6. Sound & Alarm Synthesizer ("Wake Me Up Before You Go-Go" motif / Siren)
function playSynthesizerTune(type = 'synthesizer') {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContext();

  if (type === 'siren') {
    // High-low energetic siren
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1500, ctx.currentTime + 0.3);
    osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.6);
    gain.gain.setValueAtTime(0.8, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
    return;
  }

  if (type === 'chime') {
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.4, ctx.currentTime + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + idx * 0.12 + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.12);
      osc.stop(ctx.currentTime + idx * 0.12 + 0.3);
    });
    return;
  }

  // Upbeat 80s Synth Horns / Brass chords (Wake Me Up motif rhythm)
  const chords = [
    { time: 0, notes: [440, 554.37, 659.25] },     // A Major
    { time: 0.15, notes: [440, 554.37, 659.25] },
    { time: 0.35, notes: [493.88, 622.25, 739.99] }, // B Major
    { time: 0.55, notes: [554.37, 659.25, 830.61] }, // C#m
    { time: 0.80, notes: [493.88, 622.25, 739.99] }  // B Major
  ];

  chords.forEach(({ time, notes }) => {
    notes.forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.2, ctx.currentTime + time);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + time + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + time);
      osc.stop(ctx.currentTime + time + 0.18);
    });
  });
}

function startAlarmAudio() {
  if (state.customAudioUrl) {
    const audio = new Audio(state.customAudioUrl);
    audio.loop = true;
    audio.play().catch(e => console.log('Audio autoplay:', e));
    state.activeAudioElement = audio;
  } else {
    // Loop synth sound every 1.1s
    playSynthesizerTune(state.soundType);
    state.alarmIntervalId = setInterval(() => {
      playSynthesizerTune(state.soundType);
    }, 1100);
  }
}

function stopAlarmAudio() {
  if (state.alarmIntervalId) {
    clearInterval(state.alarmIntervalId);
    state.alarmIntervalId = null;
  }
  if (state.activeAudioElement) {
    state.activeAudioElement.pause();
    state.activeAudioElement = null;
  }
}

// 7. Vibration Alarm
function startAlarmVibration() {
  if ('vibrate' in navigator) {
    navigator.vibrate([1000, 300, 1000, 300, 1500]);
    state.vibrationIntervalId = setInterval(() => {
      navigator.vibrate([1000, 300, 1000, 300, 1500]);
    }, 4500);
  }
}

function stopAlarmVibration() {
  if (state.vibrationIntervalId) {
    clearInterval(state.vibrationIntervalId);
    state.vibrationIntervalId = null;
  }
  if ('vibrate' in navigator) {
    navigator.vibrate(0);
  }
}

// 8. Trigger Full Alarm
function triggerAlarm() {
  state.isAlarmActive = true;
  alarmModal.classList.add('show');
  pocketOverlay.classList.remove('show');
  statusBadge.className = 'status-pill alarm';
  statusText.textContent = '🚨 A ACORDAR!';

  startAlarmAudio();
  startAlarmVibration();
}

function dismissAlarm() {
  state.isAlarmActive = false;
  alarmModal.classList.remove('show');
  stopAlarmAudio();
  stopAlarmVibration();
  stopTracking();
}

// 9. Search Address / Stops via OpenStreetMap Nominatim
async function searchAddress(query) {
  if (!query || query.trim() === '') return;
  try {
    btnSearch.textContent = '...';
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
    const results = await resp.json();
    if (results && results.length > 0) {
      const { lat, lon, display_name } = results[0];
      const targetLat = parseFloat(lat);
      const targetLng = parseFloat(lon);
      setTargetLocation(targetLat, targetLng);
      map.flyTo([targetLat, targetLng], 16);
      addressInput.value = display_name.split(',')[0];
    } else {
      alert('Localização não encontrada. Tenta clicar diretamente no mapa.');
    }
  } catch (err) {
    console.error('Erro na pesquisa:', err);
    alert('Erro ao pesquisar morada. Clica diretamente no mapa para marcar.');
  } finally {
    btnSearch.textContent = 'Ir';
  }
}

// 10. Event Listeners & UI Binding
btnToggleTracking.addEventListener('click', () => {
  if (state.isTracking) {
    stopTracking();
  } else {
    startTracking();
  }
});

btnStopAlarm.addEventListener('click', dismissAlarm);

radiusChips.forEach(chip => {
  chip.addEventListener('click', () => {
    radiusChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const radius = parseInt(chip.getAttribute('data-radius'), 10);
    state.alarmRadius = radius;
    radiusLabel.textContent = radius >= 1000 ? `${radius / 1000} km` : `${radius} metros`;
    if (targetRadiusCircle) {
      targetRadiusCircle.setRadius(radius);
    }
    updateMetrics();
  });
});

btnSearch.addEventListener('click', () => {
  searchAddress(addressInput.value);
});

addressInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    searchAddress(addressInput.value);
  }
});

btnMyLocation.addEventListener('click', () => {
  locateUser(true);
});

soundSelect.addEventListener('change', (e) => {
  state.soundType = e.target.value;
  if (state.soundType === 'custom') {
    customAudioInput.click();
  }
});

customAudioInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    state.customAudioUrl = URL.createObjectURL(file);
    alert(`Áudio carregado com sucesso: ${file.name}`);
  }
});

btnTestSound.addEventListener('click', () => {
  if (state.customAudioUrl) {
    const audio = new Audio(state.customAudioUrl);
    audio.play();
  } else {
    playSynthesizerTune(state.soundType);
  }
});

// Pocket Mode
btnPocketMode.addEventListener('click', () => {
  pocketOverlay.classList.add('show');
});

pocketOverlay.addEventListener('dblclick', () => {
  pocketOverlay.classList.remove('show');
});

// PWA Install prompt
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installPwaBadge.style.display = 'inline';
});

installPwaBadge.addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      installPwaBadge.style.display = 'none';
    }
    deferredPrompt = null;
  }
});

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.log('SW registration failed:', err);
    });
  });
}

// Run on startup
window.addEventListener('DOMContentLoaded', () => {
  initMap();
});
