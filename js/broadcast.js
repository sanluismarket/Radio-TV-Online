// ================================================
// BROADCAST.JS — Panel del Locutor
// Radio TV Online
// ================================================

// ── Estado del panel ──
const broadcastState = {
  user: null,
  isLive: false,
  onAirStartTime: null,
  onAirTimer: null,
  currentConfig: null,
  demoMessages: [],
};

// ── Inicialización ──
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuth();
});

// ─────────────────────────────────────────────
// AUTENTICACIÓN
// ─────────────────────────────────────────────

async function checkAuth() {
  const user = await getCurrentUser();

  if (!user && !DEMO_MODE) {
    // No logueado → mostrar pantalla de login
    document.getElementById('loginScreen').classList.remove('hidden');
    return;
  }

  if (user) {
    broadcastState.user = user;
    initDashboard(user);
  } else {
    // Demo mode: verificar si hay sesión demo
    const demoUser = sessionStorage.getItem('demo_user');
    if (demoUser) {
      broadcastState.user = JSON.parse(demoUser);
      initDashboard(broadcastState.user);
    } else {
      document.getElementById('loginScreen').classList.remove('hidden');
    }
  }
}

async function doLogin() {
  const email    = document.getElementById('loginEmail')?.value?.trim();
  const password = document.getElementById('loginPassword')?.value;
  const btn      = document.getElementById('loginButton');

  if (!email || !password) {
    showToast('Completá email y contraseña', 'warning');
    return;
  }

  btn.textContent = '⏳ Ingresando...';
  btn.disabled = true;

  try {
    const { user, error } = await signIn(email, password);
    if (error || !user) {
      showToast(error?.message || 'Credenciales incorrectas', 'error');
      return;
    }

    if (DEMO_MODE) {
      sessionStorage.setItem('demo_user', JSON.stringify({ email }));
    }
    broadcastState.user = user;
    initDashboard(user);
  } finally {
    btn.textContent = '🔐 Ingresar al Panel';
    btn.disabled = false;
  }
}

async function doLogout() {
  if (confirm('¿Seguro que querés salir del panel?')) {
    if (broadcastState.isLive) {
      stopWebBroadcast();
      await setLiveDB(false);
    }
    await signOut();
    sessionStorage.removeItem('demo_user');
    window.location.href = 'index.html';
  }
}

// Al cerrar la pestaña estando en aire → cortar transmisión
window.addEventListener('pagehide', () => {
  if (broadcastState.isLive) {
    stopWebBroadcast();
    setLiveDB(false);
  }
});

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────

async function initDashboard(user) {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');

  // Mostrar email del locutor
  const loggedEl = document.getElementById('loggedAsText');
  if (loggedEl) loggedEl.textContent = user.email || 'Locutor';

  // Cargar datos
  await loadBroadcastConfig();
  await loadNowPlayingForm();
  await loadBroadcastChat();
  await loadStats();

  // Reproductor de música del panel (sin pantalla)
  initPanelPlayer();

  // Realtime (al final: si falla, no corta la inicialización)
  try { setupBroadcastRealtime(); } catch (e) { console.error('Realtime chat:', e); }
}

async function loadBroadcastConfig() {
  const config = await getStationConfig();
  if (!config) return;

  broadcastState.currentConfig = config;

  // Rellenar formulario de stream
  const urlInput = document.getElementById('streamUrlInput');
  if (urlInput && config.stream_url) urlInput.value = config.stream_url;

  // Rellenar config de estación
  setInputVal('configName',        config.name);
  setInputVal('configTagline',     config.tagline);
  setInputVal('configDescription', config.description);
  setSelectVal('configQuality',    config.quality || 'HD');

  // Estado live
  updateBroadcastStatus(config.is_live || false);
}

async function loadNowPlayingForm() {
  const np = await getNowPlaying();
  if (!np) return;

  setInputVal('npTitle',  np.title);
  setInputVal('npArtist', np.artist);
  setInputVal('npAlbum',  np.album);
  setInputVal('npEmoji',  np.emoji || '🎵');

  updatePreview(np);
}

// ─────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────

function showTab(tabId) {
  // Ocultar todos los tabs
  document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));

  // Desactivar todos los sidebar links
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));

  // Mostrar el tab seleccionado
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.remove('hidden');

  // Activar el link del sidebar
  const name = tabId.replace('tab', 'sidebar');
  const link = document.getElementById(name);
  if (link) link.classList.add('active');

  // Cargar datos según tab
  if (tabId === 'tabEstadísticas') loadStats();
  if (tabId === 'tabChat') scrollBroadcastChatToBottom();
  if (tabId === 'tabAudio') {
    navigator.mediaDevices?.enumerateDevices().then(devices => {
      const mics = devices.filter(d => d.kind === 'audioinput');
      if (mics.length > 0 && mics[0].label) {
        listMicrophones();
      } else {
        const sel = document.getElementById('micSelect');
        if (sel) sel.innerHTML = '<option value="">— Presioná "Activar Micrófono" para listar —</option>';
      }
    }).catch(() => {});
  }
  if (tabId === 'tabCamara') refreshCameraList();
}

// ─────────────────────────────────────────────
// TRANSMISIÓN
// ─────────────────────────────────────────────

async function toggleBroadcast() {
  if (!broadcastState.isLive) {
    // ── IR AL AIRE ──
    const config = broadcastState.currentConfig || {};
    const externalStream = (config.stream_url || '').trim();

    // Sin URL de stream externo → transmitir desde el navegador
    if (!DEMO_MODE && !externalStream) {
      const ok = await startWebBroadcast();
      if (!ok) return;
    }

    broadcastState.isLive = true;
    await setLiveDB(true);
    updateBroadcastStatus(true);
    broadcastState.onAirStartTime = Date.now();
    startOnAirTimer();

    if (webTx.active) {
      showToast('🔴 ¡En el aire! Transmitiendo desde este navegador — mantené la pestaña abierta', 'success', 6000);
    } else {
      showToast('🔴 ¡Ahora estás en el Aire!', 'success', 4000);
    }
  } else {
    // ── CORTAR TRANSMISIÓN ──
    broadcastState.isLive = false;
    stopWebBroadcast();
    await setLiveDB(false);
    updateBroadcastStatus(false);
    stopOnAirTimer();
    showToast('⏹️ Transmisión finalizada', 'info');
  }
}

// ─────────────────────────────────────────────
// 📡 TRANSMISIÓN WEB (audio del navegador → oyentes)
// ─────────────────────────────────────────────

const webTx = {
  channel: null,
  recorder: null,
  source: null,
  header: null,
  mimeType: '',
  epoch: 0,
  seq: 0,
  active: false,
};

function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
  ];
  for (const c of candidates) {
    try { if (MediaRecorder.isTypeSupported(c)) return c; } catch (e) { /* seguir */ }
  }
  return '';
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve((fr.result || '').split(',')[1] || '');
    fr.readAsDataURL(blob);
  });
}

async function startWebBroadcast() {
  const mimeType = pickRecorderMime();
  if (!mimeType) {
    showToast('❌ Tu navegador no soporta la transmisión de audio. Usá Chrome o Edge.', 'error', 6000);
    return false;
  }

  // Buscar fuente de audio activa (mezcla de todas las fuentes)
  let source = getBroadcastStream();
  if (!source) {
    showToast('🖥️ Compartí tu PANTALLA COMPLETA con audio (o activá música/micrófono)...', 'info', 7000);
    try {
      await startSystemAudio();
    } catch (e) { /* cancelado */ }
    source = getBroadcastStream();
  }
  if (!source) {
    showToast('❌ No hay audio activo. Opciones: 🎵 Música del panel, 🎙️ Micrófono o 🖥️ Audio de la PC (pestaña Audio).', 'error', 9000);
    return false;
  }

  let recorder;
  try {
    recorder = new MediaRecorder(source, { mimeType, audioBitsPerSecond: 64000 });
  } catch (e) {
    try {
      recorder = new MediaRecorder(source);
    } catch (e2) {
      showToast('❌ No se pudo iniciar la captura de audio: ' + e2.message, 'error');
      return false;
    }
  }

  webTx.recorder = recorder;
  webTx.source = source;
  webTx.mimeType = recorder.mimeType || mimeType;
  webTx.header = null;
  webTx.epoch += 1;
  webTx.seq = 0;
  webTx.active = true;

  // Canal realtime de audio
  const ch = db.channel('radio_audio');
  ch.on('broadcast', { event: 'need_header' }, () => {
    if (!webTx.active || !webTx.header) return;
    ch.send({ type: 'broadcast', event: 'meta', payload: { m: webTx.mimeType, e: webTx.epoch } });
    ch.send({ type: 'broadcast', event: 'header', payload: { e: webTx.epoch, d: webTx.header } });
  });
  await ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') console.log('📻 radio_audio: canal de transmisión activo');
  });
  webTx.channel = ch;

  recorder.ondataavailable = async (ev) => {
    if (!ev.data || ev.data.size === 0 || !webTx.active) return;
    try {
      const b64 = await blobToBase64(ev.data);
      if (!b64 || !webTx.active) return;
      if (!webTx.header) {
        webTx.header = b64;
        ch.send({ type: 'broadcast', event: 'meta', payload: { m: webTx.mimeType, e: webTx.epoch } });
        ch.send({ type: 'broadcast', event: 'header', payload: { e: webTx.epoch, d: b64 } });
      }
      ch.send({ type: 'broadcast', event: 'chunk', payload: { e: webTx.epoch, s: webTx.seq++, d: b64 } });
    } catch (e) {
      console.error('Error enviando chunk de audio:', e);
    }
  };

  recorder.onerror = () => {
    showToast('❌ Error en la captura de audio', 'error');
    forceEndBroadcast('❌ La captura de audio falló');
  };

  startSignalMonitor(source);

  recorder.start(2500);
  return true;
}

function stopWebBroadcast() {
  webTx.active = false;
  stopSignalMonitor();
  try {
    if (webTx.recorder && webTx.recorder.state !== 'inactive') webTx.recorder.stop();
  } catch (e) { /* ya detenido */ }
  webTx.recorder = null;
  webTx.source = null;
  if (webTx.channel) {
    try {
      webTx.channel.send({ type: 'broadcast', event: 'end', payload: { e: webTx.epoch } });
    } catch (e) { /* sin conexión */ }
    try { db.removeChannel(webTx.channel); } catch (e) { /* ignore */ }
    webTx.channel = null;
  }
  webTx.header = null;
}

async function forceEndBroadcast(reason) {
  if (!broadcastState.isLive && !webTx.active) return;
  broadcastState.isLive = false;
  stopWebBroadcast();
  try { await setLiveDB(false); } catch (e) { /* ignore */ }
  updateBroadcastStatus(false);
  stopOnAirTimer();
  showToast(reason, 'error', 7000);
}

async function setLiveDB(isLive) {
  if (DEMO_MODE) {
    showToast(isLive ? '🔴 En Air (demo)' : '⏹️ Off Air (demo)', isLive ? 'success' : 'info');
    return;
  }
  const config = broadcastState.currentConfig || {};
  await saveStationConfigDB({ ...config, is_live: isLive });
}

function updateBroadcastStatus(isLive) {
  broadcastState.isLive = isLive;

  const badge = document.getElementById('broadcastStatus');
  const badgeText = document.getElementById('broadcastStatusText');
  const goLiveBtn = document.getElementById('goLiveBtn');
  const bigBtn = document.getElementById('bigGoLiveBtn');

  if (badge) {
    badge.classList.toggle('offline', !isLive);
  }
  if (badgeText) badgeText.textContent = isLive ? 'EN VIVO' : 'Offline';

  if (goLiveBtn) {
    goLiveBtn.textContent = isLive ? '⏹️ Cortar Transmisión' : '📡 Ir al Aire';
    goLiveBtn.className = `btn ${isLive ? 'btn-danger' : 'btn-success'}`;
    goLiveBtn.style.fontSize = '0.85rem';
    goLiveBtn.style.padding = '8px 18px';
  }

  if (bigBtn) {
    bigBtn.textContent = isLive ? '⏹️ Cortar Transmisión' : '📡 Ir al Aire';
    bigBtn.className = `btn ${isLive ? 'btn-danger' : 'btn-primary'} btn-lg`;
  }
}

async function saveStreamUrl() {
  const url = document.getElementById('streamUrlInput')?.value?.trim();
  if (!url) {
    showToast('Ingresá una URL de stream', 'warning');
    return;
  }

  const config = broadcastState.currentConfig || {};
  const ok = await saveStationConfigDB({ ...config, stream_url: url });
  if (ok) {
    broadcastState.currentConfig = { ...config, stream_url: url };
    showToast('✅ URL guardada correctamente', 'success');
  }
}

async function clearStreamUrl() {
  const urlInput = document.getElementById('streamUrlInput');
  if (urlInput) urlInput.value = '';
  const config = broadcastState.currentConfig || {};
  const ok = await saveStationConfigDB({ ...config, stream_url: '' });
  if (ok) {
    broadcastState.currentConfig = { ...config, stream_url: '' };
    showToast('🧹 URL quitada — la radio ahora transmite desde esta web', 'success', 5000);
  }
}

async function testStream() {
  const url = document.getElementById('streamUrlInput')?.value?.trim();
  if (!url) {
    showToast('Primero ingresá la URL del stream', 'warning');
    return;
  }

  const audio = new Audio(url);
  audio.volume = 0.5;
  audio.play()
    .then(() => {
      showToast('🔊 Stream funciona correctamente!', 'success');
      setTimeout(() => audio.pause(), 3000);
    })
    .catch(() => showToast('⚠️ No se pudo conectar al stream. Verificá la URL.', 'error'));
}

// Timer de tiempo en aire
function startOnAirTimer() {
  broadcastState.onAirTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - broadcastState.onAirStartTime) / 1000);
    const el = document.getElementById('onAirTime');
    if (el) el.textContent = formatTime(elapsed);
  }, 1000);
}

function stopOnAirTimer() {
  if (broadcastState.onAirTimer) {
    clearInterval(broadcastState.onAirTimer);
    broadcastState.onAirTimer = null;
  }
  const el = document.getElementById('onAirTime');
  if (el) el.textContent = '00:00:00';
}

// ─────────────────────────────────────────────
// NOW PLAYING
// ─────────────────────────────────────────────

async function updateNowPlaying() {
  const np = {
    title:  document.getElementById('npTitle')?.value?.trim(),
    artist: document.getElementById('npArtist')?.value?.trim(),
    album:  document.getElementById('npAlbum')?.value?.trim(),
    emoji:  document.getElementById('npEmoji')?.value?.trim() || '🎵',
  };

  if (!np.title) {
    showToast('Ingresá el título de la canción', 'warning');
    return;
  }

  updatePreview(np);
  const ok = await updateNowPlayingDB(np);
  if (ok) {
    showToast(`✅ Actualizado: ${np.title}`, 'success');
  }
}

function updatePreview(np) {
  const artwork = document.getElementById('previewArtwork');
  const song    = document.getElementById('previewSong');
  const artist  = document.getElementById('previewArtist');

  if (artwork) { artwork.textContent = np.emoji || '🎵'; }
  if (song)    song.textContent = np.title || 'Título';
  if (artist)  artist.textContent = np.artist || 'Artista';
}

// Auto-preview al escribir
['npTitle','npArtist','npEmoji'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    const np = {
      title: document.getElementById('npTitle')?.value,
      artist: document.getElementById('npArtist')?.value,
      emoji: document.getElementById('npEmoji')?.value || '🎵',
    };
    updatePreview(np);
  });
});

// ─────────────────────────────────────────────
// CHAT DEL LOCUTOR
// ─────────────────────────────────────────────

async function loadBroadcastChat() {
  const messages = await getChatMessages(40);
  const container = document.getElementById('broadcastChatMessages');
  if (!container) return;

  if (messages.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px 0; font-size:0.85rem;">Sin mensajes aún...</div>`;
    return;
  }

  container.innerHTML = '';
  messages.forEach(msg => appendBroadcastMessage(msg, false));
  scrollBroadcastChatToBottom();

  // Actualizar contador
  updateCounters(messages.length);
}

function appendBroadcastMessage(msg, animate = true) {
  const container = document.getElementById('broadcastChatMessages');
  if (!container) return;

  const placeholder = container.querySelector('[style*="Sin mensajes"]');
  if (placeholder) placeholder.remove();

  const isLocutor = msg.is_broadcaster;
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.innerHTML = `
    <div class="chat-avatar" style="background: ${isLocutor ? 'linear-gradient(135deg,#7c3aed,#ec4899)' : getAvatarColor(msg.username)};">
      ${isLocutor ? '🎙️' : getInitials(msg.username)}
    </div>
    <div class="chat-message-content">
      <div class="chat-name" style="${isLocutor ? 'color:var(--pink)' : ''}">${escapeHtml(msg.username || 'Anónimo')} ${isLocutor ? '<span class="tag tag-purple">Locutor</span>' : ''}</div>
      <div class="chat-text">${escapeHtml(msg.message)}</div>
    </div>
  `;
  if (animate) div.style.animation = 'slide-in 0.3s ease';
  container.appendChild(div);
  scrollBroadcastChatToBottom();

  // Actualizar stats chat
  updateBroadcastChatOnline();
}

function scrollBroadcastChatToBottom() {
  const c = document.getElementById('broadcastChatMessages');
  if (c) c.scrollTop = c.scrollHeight;
}

async function sendBroadcastMessage() {
  const input = document.getElementById('broadcastChatInput');
  const nicknameInput = document.getElementById('broadcastNickname');
  const message = input?.value?.trim();
  const nickname = nicknameInput?.value?.trim() || '🎙️ Locutor';

  if (!message) return;

  const msg = await sendChatMessageDB(nickname, message);
  if (msg) {
    if (DEMO_MODE) {
      msg.is_broadcaster = true;
      appendBroadcastMessage(msg, true);
    }
    input.value = '';
  }
}

function handleBroadcastChatKey(e) {
  if (e.key === 'Enter') sendBroadcastMessage();
}

function quickMessage(text) {
  const input = document.getElementById('broadcastChatInput');
  if (input) input.value = text;
  sendBroadcastMessage();
}

function updateBroadcastChatOnline() {
  const count = Math.floor(Math.random() * 8) + 2;
  const el = document.getElementById('broadcastOnlineCount');
  if (el) el.textContent = `${count} en línea`;
}

// ─────────────────────────────────────────────
// ESTADÍSTICAS
// ─────────────────────────────────────────────

async function loadStats() {
  const messages = await getChatMessages(100);
  const count = messages.length;

  const today = new Date().toDateString();
  const todayMessages = messages.filter(m => new Date(m.created_at).toDateString() === today);

  updateEl('statsListenersNow', Math.floor(Math.random() * 20) + 1);
  updateEl('statsListenersToday', Math.floor(Math.random() * 80) + 10);
  updateEl('statsMsgsToday', todayMessages.length || count);
  updateEl('statsUptime', broadcastState.isLive ?
    formatTime(Math.floor((Date.now() - (broadcastState.onAirStartTime || Date.now())) / 1000)) : '0h');

  // Mensajes recientes en stats
  const recentContainer = document.getElementById('statsRecentMessages');
  if (recentContainer && messages.length > 0) {
    recentContainer.innerHTML = messages.slice(-8).reverse().map(m => `
      <div class="song-item">
        <div class="chat-avatar" style="background:${getAvatarColor(m.username)}; width:32px; height:32px;">
          ${getInitials(m.username)}
        </div>
        <div style="flex:1;">
          <div style="font-size:0.8rem; font-weight:700; color:var(--purple-light);">${escapeHtml(m.username)}</div>
          <div style="font-size:0.8rem; color:var(--text-secondary);">${escapeHtml(m.message)}</div>
        </div>
        <div style="font-size:0.72rem; color:var(--text-muted);">${new Date(m.created_at).toLocaleTimeString()}</div>
      </div>
    `).join('');
  }

  updateCounters(count);
}

function updateCounters(msgCount) {
  updateEl('currentMessages', msgCount);
  updateEl('currentListeners', Math.floor(Math.random() * 20) + 1);
}

// ─────────────────────────────────────────────
// CONFIGURACIÓN DE ESTACIÓN
// ─────────────────────────────────────────────

async function saveStationConfig() {
  const config = {
    name:        document.getElementById('configName')?.value?.trim(),
    tagline:     document.getElementById('configTagline')?.value?.trim(),
    description: document.getElementById('configDescription')?.value?.trim(),
    quality:     document.getElementById('configQuality')?.value || 'HD',
    stream_url:  broadcastState.currentConfig?.stream_url || '',
    is_live:     broadcastState.isLive,
  };

  if (!config.name) {
    showToast('Ingresá el nombre de la estación', 'warning');
    return;
  }

  const ok = await saveStationConfigDB(config);
  if (ok) {
    broadcastState.currentConfig = config;
    showToast('✅ Configuración guardada', 'success');
  }
}

async function changePassword() {
  const newPass = document.getElementById('newPassword')?.value;
  if (!newPass || newPass.length < 8) {
    showToast('La contraseña debe tener al menos 8 caracteres', 'warning');
    return;
  }

  if (DEMO_MODE) {
    showToast('Modo demo: configura Supabase para cambiar contraseña', 'warning');
    return;
  }

  try {
    const { error } = await db.auth.updateUser({ password: newPass });
    if (error) throw error;
    showToast('✅ Contraseña actualizada correctamente', 'success');
    document.getElementById('newPassword').value = '';
  } catch(e) {
    showToast('Error al cambiar contraseña: ' + e.message, 'error');
  }
}

// ─────────────────────────────────────────────
// REALTIME
// ─────────────────────────────────────────────

let _broadcastRealtimeReady = false;
function setupBroadcastRealtime() {
  if (_broadcastRealtimeReady) return;
  _broadcastRealtimeReady = true;
  // Chat en tiempo real
  subscribeToChatRealtime((newMsg) => {
    appendBroadcastMessage(newMsg, true);
    updateCounters(0);
  });
}

// ─────────────────────────────────────────────
// 📹 CÁMARA / VIDEO
// ─────────────────────────────────────────────

const cameraState = {
  stream: null,
  deviceId: null,
  quality: 720,
  mirrored: false,
  isScreen: false,
};

async function startCamera() {
  try {
    const constraints = {
      video: {
        deviceId: cameraState.deviceId ? { exact: cameraState.deviceId } : undefined,
        width: { ideal: cameraState.quality === 1080 ? 1920 : cameraState.quality === 480 ? 640 : 1280 },
        height: { ideal: cameraState.quality === 1080 ? 1080 : cameraState.quality === 480 ? 480 : 720 },
      },
      audio: true,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraState.stream = stream;
    cameraState.isScreen = false;

    const video = document.getElementById('cameraVideo');
    video.srcObject = stream;
    video.style.display = 'block';

    // Ocultar placeholder, mostrar overlay
    document.getElementById('cameraPlaceholder').style.display = 'none';
    document.getElementById('cameraOnAirOverlay').style.display = 'block';
    document.getElementById('mirrorBtn').style.display = 'block';

    // Alternar botones
    document.getElementById('startCameraBtn').style.display = 'none';
    document.getElementById('stopCameraBtn').style.display = 'inline-flex';
    document.getElementById('screenshotBtn').style.display = 'inline-flex';

    // Aplicar espejo si estaba activo
    if (cameraState.mirrored) video.style.transform = 'scaleX(-1)';

    showToast('📹 Cámara activada correctamente', 'success');

    // Listar cámaras disponibles
    await refreshCameraList();
  } catch (err) {
    console.error('Error de cámara:', err);
    if (err.name === 'NotAllowedError') {
      showToast('❌ Permiso de cámara denegado. Habilitalo en el navegador.', 'error', 5000);
    } else if (err.name === 'NotFoundError') {
      showToast('❌ No se encontró ninguna cámara', 'error');
    } else {
      showToast('❌ Error al iniciar cámara: ' + err.message, 'error');
    }
  }
}

function stopCamera() {
  if (cameraState.stream) {
    cameraState.stream.getTracks().forEach(t => t.stop());
    cameraState.stream = null;
  }
  cameraState.isScreen = false;

  if (typeof vidTx !== 'undefined' && vidTx.active) {
    stopVideoBroadcast('⏹️ Video detenido — se apagó la fuente de imagen');
  }

  const video = document.getElementById('cameraVideo');
  video.srcObject = null;

  document.getElementById('cameraPlaceholder').style.display = 'flex';
  document.getElementById('cameraOnAirOverlay').style.display = 'none';
  document.getElementById('mirrorBtn').style.display = 'none';
  document.getElementById('startCameraBtn').style.display = 'inline-flex';
  document.getElementById('stopCameraBtn').style.display = 'none';
  document.getElementById('screenshotBtn').style.display = 'none';

  showToast('⏹️ Cámara apagada', 'info');
}

async function refreshCameraList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === 'videoinput');
    const select = document.getElementById('cameraSelect');
    if (!select) return;

    select.innerHTML = cameras.map((cam, i) =>
      `<option value="${cam.deviceId}">${cam.label || `Cámara ${i + 1}`}</option>`
    ).join('');

    // Seleccionar la activa
    if (cameraState.stream) {
      const activeTrack = cameraState.stream.getVideoTracks()[0];
      const activeId = activeTrack?.getSettings()?.deviceId;
      if (activeId) select.value = activeId;
    }
  } catch(e) {
    console.error('Error listando cámaras:', e);
  }
}

async function switchCamera() {
  const select = document.getElementById('cameraSelect');
  cameraState.deviceId = select?.value;

  if (cameraState.stream) {
    // Reiniciar con nueva cámara
    stopCamera();
    await startCamera();
  }
}

function setCamQuality(value) {
  cameraState.quality = parseInt(value);
  if (cameraState.stream) {
    stopCamera();
    startCamera();
  }
}

function toggleMirror() {
  cameraState.mirrored = !cameraState.mirrored;
  const video = document.getElementById('cameraVideo');
  video.style.transform = cameraState.mirrored ? 'scaleX(-1)' : 'none';
  const btn = document.getElementById('mirrorBtn');
  if (btn) btn.textContent = cameraState.mirrored ? '↩️ Normal' : '🔄 Espejo';
}

function applyCamFilter(filter) {
  const video = document.getElementById('cameraVideo');
  if (video) video.style.filter = filter;
}

function takeScreenshot() {
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('screenshotCanvas');
  if (!video || !canvas || !cameraState.stream) {
    showToast('Activá la cámara primero', 'warning');
    return;
  }

  canvas.width  = video.videoWidth  || 1280;
  canvas.height = video.videoHeight || 720;

  const ctx = canvas.getContext('2d');

  // Aplicar espejo en captura también
  if (cameraState.mirrored) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/png');
  const img = document.getElementById('screenshotImg');
  const link = document.getElementById('screenshotDownload');
  const preview = document.getElementById('screenshotPreview');

  if (img) img.src = dataUrl;
  if (link) link.href = dataUrl;
  if (preview) preview.style.display = 'block';

  showToast('📸 Captura guardada', 'success');
}

// ─────────────────────────────────────────────
// 🎤 AUDIO — MICRÓFONO
// ─────────────────────────────────────────────

const audioState = {
  micStream: null,
  sysStream: null,
  audioCtx: null,
  analyser: null,
  animFrame: null,
  playerPlaying: false,
};

// ─────────────────────────────────────────────
// 🎛️ MEZCLADOR DE AUDIO (mezcla todas las fuentes activas)
// ─────────────────────────────────────────────

const mix = {
  ctx: null,
  dest: null,
  micSrc: null, micAttached: false,
  sysSrc: null, sysAttached: false,
};

const panelPlayer = {
  files: [],
  index: -1,
  el: null,
  elAttached: false,
  elSrc: null,
};

function ensureMixGraph() {
  if (!mix.ctx || mix.ctx.state === 'closed') {
    mix.ctx = new (window.AudioContext || window.webkitAudioContext)();
    mix.dest = mix.ctx.createMediaStreamDestination();
  }
  if (mix.ctx.state === 'suspended') mix.ctx.resume();
  return mix.ctx;
}

function getBroadcastStream() {
  const micLive  = !!(audioState.micStream  && audioState.micStream.getAudioTracks().some(t => t.readyState === 'live'));
  const sysLive  = !!(audioState.sysStream  && audioState.sysStream.getAudioTracks().some(t => t.readyState === 'live'));
  const playerLive = !!(panelPlayer.el && !panelPlayer.el.paused && panelPlayer.index >= 0);
  if (!micLive && !sysLive && !playerLive) return null;

  ensureMixGraph();
  if (micLive && !mix.micAttached) {
    mix.micSrc = mix.ctx.createMediaStreamSource(audioState.micStream);
    mix.micSrc.connect(mix.dest);
    mix.micAttached = true;
  }
  if (sysLive && !mix.sysAttached) {
    mix.sysSrc = mix.ctx.createMediaStreamSource(audioState.sysStream);
    mix.sysSrc.connect(mix.dest);
    mix.sysAttached = true;
  }
  return mix.dest.stream;
}

function detachMixSource(id) {
  if (id === 'mic' && mix.micAttached) {
    try { mix.micSrc.disconnect(); } catch (e) { /* ignore */ }
    mix.micSrc = null; mix.micAttached = false;
  }
  if (id === 'sys' && mix.sysAttached) {
    try { mix.sysSrc.disconnect(); } catch (e) { /* ignore */ }
    mix.sysSrc = null; mix.sysAttached = false;
  }
}

function updateAudioMonitorLabel() {
  const parts = [];
  if (panelPlayer.el && !panelPlayer.el.paused) parts.push('🎵 Música del panel');
  if (audioState.sysStream)     parts.push('🖥️ Audio de la PC');
  if (audioState.micStream)     parts.push('🎙️ Micrófono');
  if (parts.length) showAudioMonitor(parts.join(' + '));
  else hideAudioMonitor();
}

// Monitor de señal: avisa si realmente está llegando audio
let signalMon = null, signalMonCtx = null;

function startSignalMonitor(stream) {
  stopSignalMonitor();
  try {
    signalMonCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = signalMonCtx.createMediaStreamSource(stream);
    const an = signalMonCtx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const data = new Uint8Array(an.fftSize);
    signalMon = setInterval(() => {
      const label = document.getElementById('signalStatusLabel');
      if (!label || !signalMonCtx) return;
      an.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / data.length);
      if (rms > 0.012) {
        label.textContent = '🔊 Llegando audio a la radio';
        label.style.color = 'var(--green)';
      } else {
        label.textContent = '🔇 Sin audio — revisá que la fuente esté sonando';
        label.style.color = '#f59e0b';
      }
    }, 1000);
  } catch (e) { /* ignore */ }
}

function stopSignalMonitor() {
  if (signalMon) { clearInterval(signalMon); signalMon = null; }
  if (signalMonCtx) { signalMonCtx.close().catch(() => {}); signalMonCtx = null; }
  const label = document.getElementById('signalStatusLabel');
  if (label) { label.textContent = '✅ Capturando audio'; label.style.color = 'var(--green)'; }
}

// ─────────────────────────────────────────────
// 🎵 REPRODUCTOR DEL PANEL (música sin compartir pantalla)
// ─────────────────────────────────────────────

function initPanelPlayer() {
  panelPlayer.el = document.getElementById('panelAudioEl');
  const input = document.getElementById('musicFiles');
  if (input) input.addEventListener('change', onMusicFiles);
  if (panelPlayer.el) {
    panelPlayer.el.addEventListener('ended', () => playPanelTrack(panelPlayer.index + 1));
    panelPlayer.el.addEventListener('play', () => {
      audioState.playerPlaying = true;
      updatePanelPlayBtn();
      updateAudioMonitorLabel();
    });
    panelPlayer.el.addEventListener('pause', () => {
      audioState.playerPlaying = false;
      updatePanelPlayBtn();
      updateAudioMonitorLabel();
    });
  }
}

function onMusicFiles(e) {
  const list = Array.from(e.target.files || []);
  if (!list.length) return;
  list.forEach(f => panelPlayer.files.push({
    name: f.name.replace(/\.[^.]+$/, ''),
    url: URL.createObjectURL(f)
  }));
  renderPlaylist();
  showToast(`🎵 ${list.length} canción(es) agregada(s) a la lista`, 'success');
}

function renderPlaylist() {
  const box = document.getElementById('playlistBox');
  const list = document.getElementById('playlist');
  if (!box || !list) return;
  box.style.display = panelPlayer.files.length ? 'block' : 'none';
  list.innerHTML = panelPlayer.files.map((s, i) => `
    <div onclick="playPanelTrack(${i})" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer;${i === panelPlayer.index ? 'background:rgba(168,85,247,0.18);' : ''}">
      <span style="font-size:0.85rem;">${i === panelPlayer.index && audioState.playerPlaying ? '⏸' : '▶'}</span>
      <span style="font-size:0.85rem; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-primary);">${escapeHtml(s.name)}</span>
    </div>`).join('');
}

function attachPanelElement() {
  if (mix.elAttached || !panelPlayer.el) return;
  ensureMixGraph();
  mix.elSrc = mix.ctx.createMediaElementSource(panelPlayer.el);
  mix.elSrc.connect(mix.dest);              // → se transmite a los oyentes
  mix.elSrc.connect(mix.ctx.destination);   // → el locutor también la escucha
  mix.elAttached = true;
}

async function playPanelTrack(i) {
  if (!panelPlayer.el || !panelPlayer.files.length) return;
  if (i >= panelPlayer.files.length) {
    panelPlayer.index = -1;
    panelPlayer.el.removeAttribute('src');
    audioState.playerPlaying = false;
    updatePanelPlayBtn();
    updateAudioMonitorLabel();
    renderPlaylist();
    return;
  }
  attachPanelElement();
  panelPlayer.index = i;
  panelPlayer.el.src = panelPlayer.files[i].url;
  try {
    await panelPlayer.el.play();
  } catch (err) {
    showToast('❌ No se pudo reproducir: ' + err.message, 'error');
    return;
  }
  updatePanelPlayBtn();
  updateNowPlayingLabel();
  renderPlaylist();
}

function togglePanelMusic() {
  if (!panelPlayer.el) return;
  if (!panelPlayer.el.src || panelPlayer.index < 0) {
    playPanelTrack(0);
    return;
  }
  if (panelPlayer.el.paused) {
    attachPanelElement();
    panelPlayer.el.play().catch(err => showToast('❌ ' + err.message, 'error'));
  } else {
    panelPlayer.el.pause();
    setTimeout(() => {
      if (webTx.active && !getBroadcastStream()) {
        forceEndBroadcast('⏹️ Se detuvo la última fuente de audio');
      }
    }, 200);
  }
}

function updatePanelPlayBtn() {
  const btn = document.getElementById('playListBtn');
  if (!btn) return;
  const playing = panelPlayer.el && !panelPlayer.el.paused;
  btn.textContent = playing ? '⏸ Pausar' : '▶ Reproducir';
}

function updateNowPlayingLabel() {
  const el = document.getElementById('nowPlayingLabel');
  if (el && panelPlayer.index >= 0 && panelPlayer.files[panelPlayer.index]) {
    el.textContent = panelPlayer.files[panelPlayer.index].name;
  }
}

async function startMicrophone() {
  try {
    // Listar micrófonos disponibles
    await listMicrophones();

    const micId = document.getElementById('micSelect')?.value;
    const constraints = {
      audio: {
        deviceId: micId ? { exact: micId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100,
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    audioState.micStream = stream;

    // Nivel de audio con Web Audio API
    audioState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioState.audioCtx.createMediaStreamSource(stream);
    audioState.analyser = audioState.audioCtx.createAnalyser();
    audioState.analyser.fftSize = 256;
    source.connect(audioState.analyser);

    startMicLevelMeter();

    // UI
    document.getElementById('startMicBtn').style.display = 'none';
    document.getElementById('stopMicBtn').style.display = 'inline-flex';

    // Monitor general
    updateAudioMonitorLabel();
    showToast('🎙️ Micrófono activado', 'success');
    getBroadcastStream(); // si ya está al aire, se conecta al mezclador

    // Listar también al iniciar
    await listMicrophones();
  } catch(err) {
    console.error('Error micrófono:', err);
    if (err.name === 'NotAllowedError') {
      showToast('❌ Permiso de micrófono denegado', 'error', 5000);
    } else {
      showToast('❌ Error al activar micrófono: ' + err.message, 'error');
    }
  }
}

function stopMicrophone() {
  if (audioState.micStream) {
    audioState.micStream.getTracks().forEach(t => t.stop());
    audioState.micStream = null;
  }
  if (audioState.audioCtx) {
    audioState.audioCtx.close();
    audioState.audioCtx = null;
  }
  if (audioState.animFrame) {
    cancelAnimationFrame(audioState.animFrame);
    audioState.animFrame = null;
  }

  document.getElementById('startMicBtn').style.display = 'inline-flex';
  document.getElementById('stopMicBtn').style.display = 'none';

  const bar = document.getElementById('micLevelBar');
  if (bar) bar.style.width = '0%';

  detachMixSource('mic');
  updateAudioMonitorLabel();
  showToast('⏹️ Micrófono apagado', 'info');

  if (webTx.active && !getBroadcastStream()) {
    forceEndBroadcast('⏹️ Micrófono apagado — no queda ninguna fuente de audio');
  }
}

function startMicLevelMeter() {
  const analyser = audioState.analyser;
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  const bar = document.getElementById('micLevelBar');

  function tick() {
    if (!audioState.micStream) return;
    analyser.getByteFrequencyData(dataArray);
    const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const pct = Math.min(100, (avg / 128) * 100);
    if (bar) bar.style.width = pct + '%';

    // Color según nivel
    if (pct > 80) bar.style.background = 'linear-gradient(to right, #10b981, #ef4444)';
    else if (pct > 50) bar.style.background = 'linear-gradient(to right, #7c3aed, #10b981)';
    else bar.style.background = 'var(--gradient-main)';

    audioState.animFrame = requestAnimationFrame(tick);
  }
  tick();
}

async function listMicrophones() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === 'audioinput');
    const select = document.getElementById('micSelect');
    if (!select) return;

    select.innerHTML = mics.map((mic, i) =>
      `<option value="${mic.deviceId}">${mic.label || `Micrófono ${i + 1}`}</option>`
    ).join('');
  } catch(e) {
    console.error('Error listando micrófonos:', e);
  }
}

// ─────────────────────────────────────────────
// 🖥️ AUDIO DEL SISTEMA (Screen Share + audio)
// ─────────────────────────────────────────────

async function startSystemAudio(maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let stream;
    try {
      // getDisplayMedia captura pantalla + audio del sistema
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,   // necesario para que Chrome lo permita
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 44100,
        }
      });
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        showToast('❌ Permiso denegado para compartir pantalla', 'error');
      } else {
        showToast('❌ Error: ' + err.message, 'error');
      }
      return false;
    }

    // Verificar si tiene pista de audio
    const audioTracks = stream.getAudioTracks().filter(t => t.readyState === 'live');
    if (audioTracks.length > 0) {
      audioState.sysStream = stream;

      // Cuando el usuario detiene desde el navegador
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          stopSystemAudio();
        });
      }

      document.getElementById('startSysAudioBtn').style.display = 'none';
      document.getElementById('stopSysAudioBtn').style.display = 'inline-flex';

      updateAudioMonitorLabel();
      getBroadcastStream(); // si ya está al aire, se conecta al mezclador
      showToast('🖥️ Audio de la PC capturado', 'success');
      return true;
    }

    // Sin audio: Chrome NO captura audio al compartir una VENTANA
    stream.getTracks().forEach(t => t.stop());

    if (attempt === maxAttempts) {
      showToast(
        '❌ No se capturó audio. Compartí tu PANTALLA COMPLETA y marcá "Compartir audio del sistema".',
        'error',
        9000
      );
      return false;
    }
    showToast(
      '⚠️ No se captó audio. Reintentá: elegí PANTALLA COMPLETA y marcá la casilla "Compartir audio del sistema".',
      'warning',
      7000
    );
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

function stopSystemAudio() {
  if (audioState.sysStream) {
    audioState.sysStream.getTracks().forEach(t => t.stop());
    audioState.sysStream = null;
  }

  document.getElementById('startSysAudioBtn').style.display = 'inline-flex';
  document.getElementById('stopSysAudioBtn').style.display = 'none';

  detachMixSource('sys');
  updateAudioMonitorLabel();
  showToast('⏹️ Captura de audio de la PC detenida', 'info');

  if (webTx.active && !getBroadcastStream()) {
    forceEndBroadcast('⏹️ Audio de la PC apagado — no queda ninguna fuente de audio');
  }
}

function showAudioMonitor(label) {
  const card = document.getElementById('audioMonitorCard');
  const labelEl = document.getElementById('audioSourceLabel');
  if (card) card.style.display = 'block';
  if (labelEl) labelEl.textContent = label;
}

function hideAudioMonitor() {
  // Solo ocultar si no hay ninguna fuente activa
  if (!audioState.micStream && !audioState.sysStream) {
    const card = document.getElementById('audioMonitorCard');
    if (card) card.style.display = 'none';
  }
}

// ─────────────────────────────────────────────
// 🖥️ COMPARTIR PANTALLA COMO VIDEO
// ─────────────────────────────────────────────

async function startScreenVideo() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    if (cameraState.stream && cameraState.stream !== stream) {
      cameraState.stream.getTracks().forEach(t => t.stop());
    }
    cameraState.stream = stream;
    cameraState.deviceId = null;
    cameraState.isScreen = true;

    const video = document.getElementById('cameraVideo');
    video.srcObject = stream;
    video.style.display = 'block';
    video.style.transform = 'none';
    cameraState.mirrored = false;

    document.getElementById('cameraPlaceholder').style.display = 'none';
    document.getElementById('cameraOnAirOverlay').style.display = 'block';
    document.getElementById('mirrorBtn').style.display = 'none';
    document.getElementById('startCameraBtn').style.display = 'none';
    document.getElementById('stopCameraBtn').style.display = 'inline-flex';
    document.getElementById('screenshotBtn').style.display = 'inline-flex';

    const vt = stream.getVideoTracks()[0];
    if (vt) vt.addEventListener('ended', () => stopCamera(), { once: true });

    showToast('🖥️ Pantalla compartida — ya podés transmitir el video en vivo', 'success');
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      showToast('❌ Permiso denegado para compartir pantalla', 'error');
    } else {
      showToast('❌ ' + err.message, 'error');
    }
  }
}

// ─────────────────────────────────────────────
// 📹 TRANSMISIÓN DE VIDEO EN VIVO (WebRTC)
// ─────────────────────────────────────────────

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],
};

const vidTx = {
  channel: null,
  active: false,
  peers: new Map(), // viewerId → RTCPeerConnection
};

async function toggleVideoBroadcast() {
  if (!vidTx.active) {
    if (!cameraState.stream) {
      showToast('📹 Primero activá la cámara o compartí la pantalla (arriba)', 'warning');
      return;
    }

    const ch = db.channel('radio_video', {
      config: { presence: { key: 'locutor' }, broadcast: { self: false } }
    });
    ch.on('broadcast', { event: 'signal' }, ({ payload }) => hostOnSignal(payload));

    await ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') ch.track({ live: true });
    });

    vidTx.channel = ch;
    vidTx.active = true;
    updateVideoBtnUI();
    showToast('📹 Video en vivo activado — los oyentes ven "Ver en vivo"', 'success', 5000);
  } else {
    stopVideoBroadcast('⏹️ Transmisión de video finalizada');
  }
}

function stopVideoBroadcast(msg) {
  const wasActive = vidTx.active;
  vidTx.active = false;
  try { if (vidTx.channel) vidSend({ type: 'stop', from: 'locutor' }); } catch (e) { /* ignore */ }
  vidTx.peers.forEach(pc => { try { pc.close(); } catch (e) { /* ignore */ } });
  vidTx.peers.clear();
  if (vidTx.channel) {
    try { vidTx.channel.untrack(); } catch (e) { /* ignore */ }
    try { db.removeChannel(vidTx.channel); } catch (e) { /* ignore */ }
    vidTx.channel = null;
  }
  updateVideoBtnUI();
  if (msg && wasActive) showToast(msg, 'info');
}

function vidSend(payload) {
  if (vidTx.channel) vidTx.channel.send({ type: 'broadcast', event: 'signal', payload });
}

async function hostOnSignal(msg) {
  if (!msg || !vidTx.active) return;

  if (msg.type === 'request') {
    const viewer = msg.from;
    if (vidTx.peers.has(viewer)) {
      try { vidTx.peers.get(viewer).close(); } catch (e) { /* ignore */ }
      vidTx.peers.delete(viewer);
    }
    const pc = new RTCPeerConnection(RTC_CONFIG);
    vidTx.peers.set(viewer, pc);
    addHostTracks(pc);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) vidSend({ type: 'ice', to: viewer, from: 'locutor', candidate: ev.candidate });
    };
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      vidSend({ type: 'offer', to: viewer, from: 'locutor', sdp: pc.localDescription });
    } catch (e) {
      console.error('Error creando oferta de video:', e);
    }
    return;
  }

  if (msg.type === 'answer') {
    const pc = vidTx.peers.get(msg.from);
    if (pc) { try { await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)); } catch (e) { /* ignore */ } }
    return;
  }

  if (msg.type === 'ice') {
    const pc = vidTx.peers.get(msg.from);
    if (pc) { try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch (e) { /* ignore */ } }
    return;
  }

  if (msg.type === 'leave') {
    const pc = vidTx.peers.get(msg.from);
    if (pc) { try { pc.close(); } catch (e) { /* ignore */ } }
    vidTx.peers.delete(msg.from);
  }
}

function addHostTracks(pc) {
  const cam = cameraState.stream;
  if (!cam) return;

  const videoTrack = cam.getVideoTracks()[0];
  if (videoTrack) pc.addTrack(videoTrack, cam);

  // Audio: la mezcla de la radio (música + voz) si está activa, si no el de la fuente.
  // Siempre como parte del MISMO stream "cam" para que el oyente reciba todo junto.
  let audioStream = null;
  try { audioStream = getBroadcastStream(); } catch (e) { /* ignore */ }
  const mixAudio = audioStream && audioStream.getAudioTracks()[0];
  if (mixAudio) {
    pc.addTrack(mixAudio, cam);
  } else {
    const srcAudio = cam.getAudioTracks()[0];
    if (srcAudio) pc.addTrack(srcAudio, cam);
  }
}

function updateVideoBtnUI() {
  const btn = document.getElementById('videoGoLiveBtn');
  const status = document.getElementById('videoTxStatus');
  if (btn) {
    btn.textContent = vidTx.active ? '⏹️ Detener video en vivo' : '📹 Transmitir video en vivo';
    btn.className = `btn ${vidTx.active ? 'btn-danger' : 'btn-primary'}`;
  }
  if (status) {
    status.textContent = vidTx.active ? '🔴 En vivo para los oyentes' : '';
    status.style.color = vidTx.active ? 'var(--green)' : 'var(--text-secondary)';
  }
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function setInputVal(id, value) {
  const el = document.getElementById(id);
  if (el && value !== undefined && value !== null) el.value = value;
}

function setSelectVal(id, value) {
  const el = document.getElementById(id);
  if (el && value) el.value = value;
}

function updateEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text || ''));
  return div.innerHTML;
}

function getInitials(name) {
  return (name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().substr(0, 2);
}
