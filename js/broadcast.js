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

  // Realtime
  setupBroadcastRealtime();
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

function getActiveAudioSource() {
  for (const s of [audioState.sysStream, audioState.micStream]) {
    if (!s) continue;
    const t = s.getAudioTracks().find(t => t.readyState === 'live');
    if (t) return s;
  }
  return null;
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

  // Buscar fuente de audio activa (sistema o micrófono)
  let source = getActiveAudioSource();
  if (!source) {
    showToast('🖥️ Compartí tu pantalla marcando "Compartir audio del sistema"...', 'info', 7000);
    try {
      await startSystemAudio();
    } catch (e) { /* cancelado */ }
    source = getActiveAudioSource();
  }
  if (!source) {
    showToast('❌ No se capturó audio. Activá "🖥️ Capturar Audio PC" (y marcá compartir audio) o el micrófono en la pestaña Audio, y volvé a probar.', 'error', 9000);
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

  // Si el navegador corta la fuente (ej: "Dejar de compartir")
  source.getAudioTracks().forEach(t => {
    t.addEventListener('ended', () => {
      if (webTx.active) forceEndBroadcast('❌ Se detuvo la fuente de audio — transmission finalizada');
    }, { once: true });
  });

  recorder.start(2500);
  return true;
}

function stopWebBroadcast() {
  webTx.active = false;
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

function setupBroadcastRealtime() {
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
};

async function startCamera() {
  try {
    const constraints = {
      video: {
        deviceId: cameraState.deviceId ? { exact: cameraState.deviceId } : undefined,
        width: { ideal: cameraState.quality === 1080 ? 1920 : cameraState.quality === 480 ? 640 : 1280 },
        height: { ideal: cameraState.quality === 1080 ? 1080 : cameraState.quality === 480 ? 480 : 720 },
      },
      audio: false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraState.stream = stream;

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
};

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
    showAudioMonitor('🎙️ Micrófono activo');
    showToast('🎙️ Micrófono activado', 'success');

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
  const wasTxSource = webTx.active && webTx.source === audioState.micStream;
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

  hideAudioMonitor();
  showToast('⏹️ Micrófono apagado', 'info');

  if (wasTxSource) forceEndBroadcast('⏹️ Micrófono apagado — transmission finalizada');
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

async function startSystemAudio() {
  try {
    // getDisplayMedia captura pantalla + audio del sistema
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,   // necesario para que Chrome lo permita
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: 44100,
      }
    });

    // Verificar si tiene pista de audio
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stream.getTracks().forEach(t => t.stop());
      showToast(
        '⚠️ No se capturó audio. Al compartir pantalla, asegurate de marcar "Compartir audio del sistema"',
        'warning',
        6000
      );
      return false;
    }

    audioState.sysStream = stream;

    // Cuando el usuario detiene desde el navegador
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      stopSystemAudio();
    });

    document.getElementById('startSysAudioBtn').style.display = 'none';
    document.getElementById('stopSysAudioBtn').style.display = 'inline-flex';

    showAudioMonitor('🖥️ Audio del sistema activo');
    showToast('🖥️ Audio del sistema capturado', 'success');
    return true;

  } catch(err) {
    if (err.name === 'NotAllowedError') {
      showToast('❌ Permiso denegado para compartir pantalla', 'error');
    } else {
      showToast('❌ Error: ' + err.message, 'error');
    }
    return false;
  }
}

function stopSystemAudio() {
  const wasTxSource = webTx.active && webTx.source === audioState.sysStream;
  if (audioState.sysStream) {
    audioState.sysStream.getTracks().forEach(t => t.stop());
    audioState.sysStream = null;
  }

  document.getElementById('startSysAudioBtn').style.display = 'inline-flex';
  document.getElementById('stopSysAudioBtn').style.display = 'none';

  hideAudioMonitor();
  showToast('⏹️ Captura de audio del sistema detenida', 'info');

  if (wasTxSource) forceEndBroadcast('⏹️ Audio del sistema apagado — transmission finalizada');
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

// Cargar micrófonos cuando se abre el tab de audio
const _origShowTab = showTab;
function showTab(tabId) {
  _origShowTab(tabId);
  if (tabId === 'tabAudio') {
    navigator.mediaDevices?.enumerateDevices().then(devices => {
      const mics = devices.filter(d => d.kind === 'audioinput');
      if (mics.length > 0 && mics[0].label) {
        // Ya tenemos permisos
        listMicrophones();
      } else {
        // Sin permisos aún — mostrar nombre genérico
        const sel = document.getElementById('micSelect');
        if (sel) sel.innerHTML = '<option value="">— Presioná "Activar Micrófono" para listar —</option>';
      }
    }).catch(() => {});
  }
  if (tabId === 'tabCamara') {
    refreshCameraList();
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
