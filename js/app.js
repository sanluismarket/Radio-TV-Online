// ================================================
// APP.JS — Lógica del Reproductor Público
// Radio TV Online
// ================================================

// ── Estado de la App ──
const state = {
  isPlaying: false,
  streamUrl: '',
  playbackMode: null, // 'url' | 'web'
  stationConfig: null,
  chatMessages: [],
  demoMessages: [],
  listenerCount: Math.floor(Math.random() * 15) + 3,
  messageCount: 0,
};

// ── Inicialización ──
document.addEventListener('DOMContentLoaded', async () => {
  await loadStationConfig();
  await loadNowPlaying();
  await loadChatMessages();
  setupRealtimeListeners();
  startListenerCountSimulator();
  updateListenerUI();
});

// ─────────────────────────────────────────────
// CONFIGURACIÓN DE ESTACIÓN
// ─────────────────────────────────────────────

async function loadStationConfig() {
  const config = await getStationConfig();
  if (!config) return;

  state.stationConfig = config;
  state.streamUrl = config.stream_url || '';

  // Actualizar UI
  const fields = {
    stationName:        config.name || 'Radio TV Online',
    heroStationName:    config.name || 'Radio TV Online',
    footerBrand:        config.name || 'Radio TV Online',
    heroTagline:        config.tagline || 'Tu música, sin interrupciones',
    stationDescription: config.description || 'Bienvenido a nuestra estación.',
    statQuality:        config.quality || 'HD',
  };

  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });

  // Estado live
  setLiveStatus(config.is_live || false);

  // Título de la página
  if (config.name) {
    document.title = `${config.name} — En Vivo`;
  }
}

// ─────────────────────────────────────────────
// NOW PLAYING
// ─────────────────────────────────────────────

async function loadNowPlaying() {
  const np = await getNowPlaying();
  if (!np) return;
  updatePlayerUI(np);
}

function updatePlayerUI(np) {
  const song   = document.getElementById('playerSong');
  const artist = document.getElementById('playerArtist');
  const artwork = document.getElementById('playerArtwork');

  if (song)   song.textContent   = np.title   || 'Sin información';
  if (artist) artist.textContent = np.artist  || '';
  if (artwork) {
    artwork.textContent = np.emoji || '🎵';
    artwork.style.fontSize = '3rem';
    artwork.style.display = 'flex';
    artwork.style.alignItems = 'center';
    artwork.style.justifyContent = 'center';
  }

  // Agregar al historial
  if (np.title && np.title !== 'Sin información' && np.title !== 'Conectando...') {
    addToHistory(np);
  }
}

// Historial de canciones
let songHistory = [];
function addToHistory(np) {
  // Evitar duplicados consecutivos
  if (songHistory.length > 0 && songHistory[0].title === np.title) return;
  songHistory.unshift({ ...np, timestamp: new Date() });
  if (songHistory.length > 10) songHistory.pop();
  renderSongHistory();
}

function renderSongHistory() {
  const list = document.getElementById('songList');
  if (!list) return;

  if (songHistory.length === 0) {
    list.innerHTML = `
      <div style="text-align:center; color:var(--text-muted); padding:30px 0;">
        <div style="font-size:2rem; margin-bottom:8px;">🎵</div>
        <p>Sin historial aún. ¡Esperando transmisión!</p>
      </div>`;
    return;
  }

  list.innerHTML = songHistory.map((song, i) => `
    <div class="song-item">
      <div class="song-num">${i + 1}</div>
      <div class="song-thumb">${song.emoji || '🎵'}</div>
      <div class="song-details">
        <div class="song-name">${escapeHtml(song.title)}</div>
        <div class="song-artist">${escapeHtml(song.artist || '')}</div>
      </div>
      <div class="song-time">${formatTimeAgo(song.timestamp)}</div>
    </div>
  `).join('');
}

function formatTimeAgo(date) {
  const mins = Math.floor((Date.now() - date) / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins}m`;
  return `Hace ${Math.floor(mins/60)}h`;
}

// ─────────────────────────────────────────────
// PLAYER CONTROLS
// ─────────────────────────────────────────────

function togglePlay(refreshed) {
  const player = document.getElementById('audioPlayer');
  const btn    = document.getElementById('playBtn');

  const isLive   = state.stationConfig?.is_live;
  const hasUrl   = !!state.streamUrl;
  const canWebLive = !hasUrl && isLive && !DEMO_MODE;

  if (state.isPlaying) {
    if (state.playbackMode === 'web') {
      stopWebPlayback();
    } else {
      player.pause();
      player.src = '';
    }
    state.isPlaying = false;
    state.playbackMode = null;
    btn.textContent = '▶';
    pauseWave();
    state.listenerCount = Math.max(0, state.listenerCount - 1);
    updateListenerUI();
    showToast('Reproducción pausada', 'info');
    return;
  }

  if (hasUrl) {
    // ── Stream externo (Icecast / Shoutcast) ──
    state.playbackMode = 'url';
    player.src = state.streamUrl;
    player.volume = document.getElementById('volumeSlider').value / 100;
    player.play()
      .then(() => {
        state.isPlaying = true;
        btn.textContent = '⏸';
        playWave();
        state.listenerCount++;
        updateListenerUI();
        showToast('¡Conectado al stream! 🎶', 'success');
      })
      .catch(err => {
        console.error('Error reproduciendo:', err);
        state.playbackMode = null;
        showToast('No se pudo conectar al stream. Verificá la URL.', 'error');
      });
    return;
  }

  if (canWebLive) {
    // ── Transmisión web en vivo (Supabase Realtime) ──
    state.playbackMode = 'web';
    state.isPlaying = true;
    btn.textContent = '⏸';
    playWave();
    state.listenerCount++;
    updateListenerUI();
    player.volume = document.getElementById('volumeSlider').value / 100;
    startWebPlayback();
    showToast('📡 Conectado a la radio en vivo', 'success');
    return;
  }

  if (!isLive) {
    // Estado posiblemente desactualizado → consultamos la base una vez
    // antes de decirle al oyente que la radio está apagada
    if (!refreshed && !DEMO_MODE) {
      getStationConfig().then(cfg => {
        if (cfg && cfg.is_live) {
          state.stationConfig = cfg;
          state.streamUrl = cfg.stream_url || '';
          setLiveStatus(true);
          togglePlay(true);
        } else {
          showToast('📴 La radio aún no está en el aire. Esperá a que el locutor transmita.', 'warning');
        }
      }).catch(() => {
        showToast('📴 La radio aún no está en el aire. Esperá a que el locutor transmita.', 'warning');
      });
      return;
    }
    showToast('📴 La radio aún no está en el aire. Esperá a que el locutor transmita.', 'warning');
  } else {
    showToast('⚠️ El locutor aún no ha configurado el stream', 'warning');
  }
}

// ─────────────────────────────────────────────
// 📡 RECEPCIÓN DE TRANSMISIÓN WEB (oyente)
// ─────────────────────────────────────────────

const rx = {
  channel: null,
  ms: null,
  sb: null,
  mime: '',
  epoch: null,
  initialized: false,
  headerB64: null,
  headerAppended: false,
  queue: [],
  lastChunkAt: 0,
  watchdog: null,
  playRequested: false,
};

function base64ToUint8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function startWebPlayback() {
  if (rx.channel) return;
  rx.playRequested = true;
  rx.lastChunkAt = Date.now();

  const ch = db.channel('radio_audio');
  rx.channel = ch;
  ch
    .on('broadcast', { event: 'meta' },   (m) => handleRxMeta(m.payload))
    .on('broadcast', { event: 'header' }, (m) => handleRxHeader(m.payload))
    .on('broadcast', { event: 'chunk' },  (m) => handleRxChunk(m.payload))
    .on('broadcast', { event: 'end' },    (m) => handleRxEnd(m.payload))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED' && rx.channel) {
        rx.channel.send({ type: 'broadcast', event: 'need_header', payload: {} });
        startRxWatchdog();
      }
    });
}

function handleRxMeta(p) {
  if (!p || !p.m) return;
  rx.lastChunkAt = Date.now();

  // Misma transmisión ya en curso o inicializando → no recrear nada
  if (rx.epoch === p.e && rx.ms) return;

  // Nuevo ciclo de transmisión (primera vez o el locutor reinició)
  rx.mime = p.m;
  rx.epoch = p.e;
  rx.initialized = false;
  rx.headerB64 = null;
  rx.headerAppended = false;
  rx.queue = [];

  const player = document.getElementById('audioPlayer');
  if (!player) return;

  // Recrear MediaSource
  try {
    if (rx.ms && rx.ms.readyState === 'open') { try { rx.ms.endOfStream(); } catch (e) {} }
    if (player.src && player.src.startsWith('blob:')) URL.revokeObjectURL(player.src);
  } catch (e) { /* ignore */ }

  const myMs = new MediaSource();
  rx.ms = myMs;
  player.src = URL.createObjectURL(myMs);

  myMs.addEventListener('sourceopen', () => {
    if (rx.ms !== myMs || rx.sb) return; // fue reemplazado
    try {
      rx.sb = myMs.addSourceBuffer(rx.mime);
      rx.sb.mode = 'segments';
      rx.sb.addEventListener('updateend', onRxUpdateEnd);
      rx.sb.addEventListener('error', (e) => console.error('SourceBuffer error:', e));
      rx.initialized = true;
      if (rx.channel) rx.channel.send({ type: 'broadcast', event: 'need_header', payload: {} });
      flushRxQueue();
    } catch (e) {
      console.error('No se pudo abrir el buffer de audio:', e);
      showToast('⚠️ Tu navegador no puede reproducir esta transmisión', 'error', 6000);
      stopWebPlayback();
      resetPlayUI();
    }
  }, { once: true });
}

function handleRxHeader(p) {
  if (!p || !p.d) return;
  rx.lastChunkAt = Date.now();

  if (rx.epoch !== null && p.e !== rx.epoch) return; // encabezado de otra transmisión

  // Ya tenemos este encabezado (en cola o ya agregado) → ignorar
  if (rx.headerB64 === p.d && (rx.headerAppended || rx.queue.includes(p.d))) return;

  rx.headerB64 = p.d;
  rx.headerAppended = false;
  rx.queue = rx.queue.filter(x => x !== p.d);
  rx.queue.unshift(p.d); // el encabezado SIEMPRE va primero
  if (rx.initialized && rx.sb) flushRxQueue();
}

function handleRxChunk(p) {
  if (!p || !p.d) return;
  rx.lastChunkAt = Date.now();

  if (rx.epoch !== null && p.e !== rx.epoch) return;

  if (!rx.initialized || !rx.sb) {
    rx.queue.push(p.d);
    if (rx.queue.length > 60) rx.queue.shift();
    return;
  }
  rx.queue.push(p.d);
  if (rx.queue.length > 60) rx.queue.shift();
  flushRxQueue();
}

function resetPlayUI() {
  const btn = document.getElementById('playBtn');
  if (btn) btn.textContent = '▶';
  pauseWave();
  state.isPlaying = false;
  state.playbackMode = null;
}

function handleRxEnd(p) {
  if (rx.epoch !== null && p && p.e !== rx.epoch) return;
  showToast('⏹️ El locutor finalizó la transmisión', 'info');
  stopWebPlayback();
  resetPlayUI();
}

function flushRxQueue() {
  if (!rx.sb || rx.sb.updating || !rx.queue.length) return;
  const b64 = rx.queue[0];
  try {
    rx.sb.appendBuffer(base64ToUint8(b64));
    rx.queue.shift();
    if (b64 === rx.headerB64) rx.headerAppended = true;
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      trimRxBuffer();
      setTimeout(flushRxQueue, 400);
    } else {
      console.error('Error al agregar audio al buffer:', e);
      rx.queue.shift();
      showToast('⚠️ Error de reproducción del stream', 'error');
    }
  }
}

function trimRxBuffer() {
  const player = document.getElementById('audioPlayer');
  if (!rx.sb || !player) return;
  try {
    const b = rx.sb.buffered;
    if (!b.length) return;
    const target = Math.max(0, player.currentTime - 45);
    if (target > b.start(0)) rx.sb.remove(b.start(0), target);
  } catch (e) { /* ignore */ }
}

function onRxUpdateEnd() {
  flushRxQueue();

  const player = document.getElementById('audioPlayer');
  if (!player || !rx.sb) return;
  try {
    const b = rx.sb.buffered;
    if (!b.length) return;
    const end = b.end(b.length - 1);
    const start = b.start(0);

    // Empezar / reanudar reproducción
    if (rx.playRequested && player.paused) {
      player.play().catch(() => {});
    }

    // Mantener cerca del vivo (saltar huecos o atrasos)
    const liveEdge = Math.max(start, end - 3);
    if (player.currentTime < start - 0.5 || player.currentTime < liveEdge - 25) {
      try { player.currentTime = liveEdge; } catch (e) { /* ignore */ }
    }

    // Recortar buffer viejo
    if (player.currentTime - start > 60) {
      rx.sb.remove(start, player.currentTime - 45);
    }
  } catch (e) { /* ignore */ }
}

function startRxWatchdog() {
  if (rx.watchdog) clearInterval(rx.watchdog);
  rx.watchdog = setInterval(() => {
    if (!rx.channel) { clearInterval(rx.watchdog); rx.watchdog = null; return; }
    if (Date.now() - rx.lastChunkAt > 20000) {
      showToast('⚠️ La transmisión se interrumpió', 'error');
      stopWebPlayback();
      resetPlayUI();
    }
  }, 5000);
}

function stopWebPlayback() {
  if (rx.watchdog) { clearInterval(rx.watchdog); rx.watchdog = null; }
  if (rx.channel) {
    try { db.removeChannel(rx.channel); } catch (e) { /* ignore */ }
    rx.channel = null;
  }
  try {
    if (rx.sb && rx.ms && rx.ms.readyState === 'open') rx.ms.endOfStream();
  } catch (e) { /* ignore */ }
  rx.sb = null;
  rx.ms = null;
  rx.initialized = false;
  rx.headerB64 = null;
  rx.headerAppended = false;
  rx.queue = [];
  rx.epoch = null;
  rx.mime = '';
  rx.playRequested = false;

  const player = document.getElementById('audioPlayer');
  if (player) {
    try {
      player.pause();
      if (player.src && player.src.startsWith('blob:')) URL.revokeObjectURL(player.src);
      player.removeAttribute('src');
      player.load();
    } catch (e) { /* ignore */ }
  }
}

function setVolume(value) {
  const player = document.getElementById('audioPlayer');
  player.volume = value / 100;
}

function playWave() {
  document.getElementById('audioWave')?.classList.remove('paused');
}

function pauseWave() {
  document.getElementById('audioWave')?.classList.add('paused');
}

function setLiveStatus(isLive) {
  const badges = ['liveStatusBadge', 'playerLiveBadge'];
  const statusText = document.getElementById('liveStatusText');

  badges.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isLive) {
      el.classList.remove('offline');
    } else {
      el.classList.add('offline');
    }
  });

  if (statusText) statusText.textContent = isLive ? 'EN VIVO' : 'Offline';

  // Si va offline, pausar
  if (!isLive && state.isPlaying) {
    togglePlay();
  }
}

// ─────────────────────────────────────────────
// OYENTES SIMULATOR
// ─────────────────────────────────────────────

function startListenerCountSimulator() {
  setInterval(() => {
    if (state.stationConfig?.is_live) {
      const delta = Math.floor(Math.random() * 3) - 1;
      state.listenerCount = Math.max(0, state.listenerCount + delta);
      updateListenerUI();
    }
  }, 5000);
}

function updateListenerUI() {
  const num = document.getElementById('listenerNum');
  const stat = document.getElementById('statListeners');
  if (num) num.textContent = state.listenerCount;
  if (stat) stat.textContent = state.listenerCount;
}

// ─────────────────────────────────────────────
// CHAT
// ─────────────────────────────────────────────

async function loadChatMessages() {
  const messages = await getChatMessages(30);
  const container = document.getElementById('chatMessages');
  if (!container) return;

  if (messages.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px 0; font-size:0.85rem;">¡Sé el primero en comentar! 👋</div>`;
    return;
  }

  container.innerHTML = '';
  messages.forEach(msg => appendChatMessage(msg, false));
  scrollChatToBottom();

  state.messageCount = messages.length;
  updateMessageCount();
}

function appendChatMessage(msg, animate = true) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  // Limpiar placeholder
  const placeholder = container.querySelector('[style*="Sé el primero"]');
  if (placeholder) placeholder.remove();

  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `
    <div class="chat-avatar" style="background: ${getAvatarColor(msg.username)};">
      ${getInitials(msg.username)}
    </div>
    <div class="chat-message-content">
      <div class="chat-name">${escapeHtml(msg.username || 'Anónimo')}</div>
      <div class="chat-text">${escapeHtml(msg.message)}</div>
    </div>
  `;
  if (animate) div.style.animation = 'slide-in 0.3s ease';
  container.appendChild(div);
  scrollChatToBottom();
}

function scrollChatToBottom() {
  const container = document.getElementById('chatMessages');
  if (container) container.scrollTop = container.scrollHeight;
}

function getAvatarColor(name) {
  const colors = [
    'linear-gradient(135deg,#7c3aed,#06b6d4)',
    'linear-gradient(135deg,#ec4899,#7c3aed)',
    'linear-gradient(135deg,#06b6d4,#10b981)',
    'linear-gradient(135deg,#f59e0b,#ef4444)',
    'linear-gradient(135deg,#10b981,#06b6d4)',
  ];
  let hash = 0;
  for (let c of (name || '')) hash += c.charCodeAt(0);
  return colors[hash % colors.length];
}

async function sendChatMessage() {
  const nicknameInput = document.getElementById('chatNickname');
  const messageInput  = document.getElementById('chatInputField');

  const nickname = (nicknameInput?.value || '').trim() || 'Oyente';
  const message  = (messageInput?.value || '').trim();

  if (!message) return;

  const msg = await sendChatMessageDB(nickname, message);
  if (msg) {
    // En modo demo, agregar localmente
    if (DEMO_MODE) {
      appendChatMessage(msg, true);
      state.messageCount++;
      updateMessageCount();
    }
    messageInput.value = '';
  }
}

function handleChatKey(event) {
  if (event.key === 'Enter') sendChatMessage();
}

function updateMessageCount() {
  const el = document.getElementById('statMessages');
  if (el) el.textContent = state.messageCount;
}

// ─────────────────────────────────────────────
// REALTIME LISTENERS
// ─────────────────────────────────────────────

function setupRealtimeListeners() {
  // Chat messages
  subscribeToChatRealtime((newMsg) => {
    appendChatMessage(newMsg, true);
    state.messageCount++;
    updateMessageCount();
  });

  // Now playing
  subscribeToNowPlayingRealtime((np) => {
    updatePlayerUI(np);
    showToast(`🎵 Ahora suena: ${np.title} — ${np.artist}`, 'info');
  });

  // Station config
  subscribeToStationRealtime((config) => {
    state.stationConfig = config;
    state.streamUrl = config.stream_url || '';
    setLiveStatus(config.is_live || false);

    const nameEl = document.getElementById('stationName');
    if (nameEl && config.name) nameEl.textContent = config.name;
  });
}

// ─────────────────────────────────────────────
// MODAL LOGIN LOCUTOR
// ─────────────────────────────────────────────

function openBroadcastModal() {
  document.getElementById('broadcastModal').classList.add('active');
  setTimeout(() => document.getElementById('modalEmail')?.focus(), 100);
}

function closeBroadcastModal() {
  document.getElementById('broadcastModal').classList.remove('active');
}

async function loginBroadcaster() {
  const email    = document.getElementById('modalEmail')?.value?.trim();
  const password = document.getElementById('modalPassword')?.value;
  const btn      = document.getElementById('loginBtn');

  if (!email || !password) {
    showToast('Completá email y contraseña', 'warning');
    return;
  }

  btn.textContent = 'Ingresando...';
  btn.disabled = true;

  try {
    const { user, error } = await signIn(email, password);
    if (error || !user) {
      showToast(error?.message || 'Credenciales incorrectas', 'error');
      return;
    }

    // Redirigir al panel
    if (DEMO_MODE) {
      sessionStorage.setItem('demo_user', JSON.stringify({ email }));
    }
    showToast('¡Bienvenido! Redirigiendo...', 'success');
    setTimeout(() => {
      window.location.href = 'broadcast.html';
    }, 1000);
  } finally {
    btn.textContent = 'Ingresar →';
    btn.disabled = false;
  }
}

// Cerrar modal al hacer click afuera
document.getElementById('broadcastModal')?.addEventListener('click', function(e) {
  if (e.target === this) closeBroadcastModal();
});

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text || ''));
  return div.innerHTML;
}

// Actualizar "hace X minutos" del historial cada minuto
setInterval(renderSongHistory, 60000);
