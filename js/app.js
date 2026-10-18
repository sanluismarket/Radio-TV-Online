// ================================================
// APP.JS — Lógica del Reproductor Público
// Radio TV Online
// ================================================

// ── Estado de la App ──
const state = {
  isPlaying: false,
  streamUrl: '',
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

function togglePlay() {
  const player = document.getElementById('audioPlayer');
  const btn    = document.getElementById('playBtn');

  if (!state.streamUrl) {
    showToast('⚠️ El locutor aún no ha configurado el stream', 'warning');
    return;
  }

  if (state.isPlaying) {
    player.pause();
    player.src = '';
    state.isPlaying = false;
    btn.textContent = '▶';
    pauseWave();
    state.listenerCount = Math.max(0, state.listenerCount - 1);
    updateListenerUI();
    showToast('Reproducción pausada', 'info');
  } else {
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
        showToast('No se pudo conectar al stream. Verificá la URL.', 'error');
      });
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
