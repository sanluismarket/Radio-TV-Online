// ================================================
// SUPABASE CONFIGURATION
// ================================================
// 🔧 INSTRUCCIONES DE CONFIGURACIÓN:
// 1. Ir a https://supabase.com y crear una cuenta gratuita
// 2. Crear un nuevo proyecto
// 3. Ir a Project Settings → API
// 4. Copiar "Project URL" y "anon public key" aquí abajo
// ================================================

const SUPABASE_URL = 'https://jglhqfwervwuidgunobt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5wLJTr60u0q-CNNjr2xggA_BnX-OCxS';

// Versión de la app — si cambia en el servidor, la página se recarga sola
const APP_VERSION = '2026-10-18.3';

// Inicializar cliente de Supabase
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ================================================
// DEMO MODE: Si no hay Supabase configurado,
// funciona igual con datos de prueba en memoria
// ================================================
const DEMO_MODE = (SUPABASE_URL.includes('TU_PROYECTO'));

if (DEMO_MODE) {
  console.warn('⚠️ Modo Demo activo. Configura Supabase en js/supabase.js para funcionalidad completa.');
}

// ================================================
// HELPERS
// ================================================

/**
 * Mostrar notificación toast
 */
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const icons = { success: '✅', error: '❌', info: '📢', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || '📢'}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'none';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.4s ease';
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

/**
 * Obtener/generar session ID de oyente
 */
function getSessionId() {
  let sid = localStorage.getItem('radio_session_id');
  if (!sid) {
    sid = 'sess_' + Math.random().toString(36).substr(2, 12) + '_' + Date.now();
    localStorage.setItem('radio_session_id', sid);
  }
  return sid;
}

/**
 * Formatear tiempo en HH:MM:SS
 */
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

/**
 * Obtener iniciales para avatar de chat
 */
function getInitials(name) {
  return (name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().substr(0, 2);
}

// ================================================
// SUPABASE DB HELPERS
// ================================================

/**
 * Obtener configuración de la estación
 */
async function getStationConfig() {
  if (DEMO_MODE) {
    return {
      name: 'Radio TV Online',
      tagline: 'Tu música, sin interrupciones',
      description: 'Bienvenido a nuestra estación de radio online. Compartimos la mejor música las 24 horas del día.',
      stream_url: '',
      is_live: false,
      quality: 'HD'
    };
  }
  try {
    const { data, error } = await db.from('station_config').select('*').eq('id', 1).single();
    if (error) throw error;
    return data;
  } catch(e) {
    console.error('Error obteniendo config:', e);
    return null;
  }
}

/**
 * Guardar configuración de la estación
 */
async function saveStationConfigDB(config) {
  if (DEMO_MODE) {
    showToast('Modo demo: configura Supabase para guardar datos', 'warning');
    return true;
  }
  try {
    const { error } = await db.from('station_config').upsert({ id: 1, ...config, updated_at: new Date().toISOString() });
    if (error) throw error;
    return true;
  } catch(e) {
    console.error('Error guardando config:', e);
    showToast('Error al guardar configuración', 'error');
    return false;
  }
}

/**
 * Obtener "Ahora Suena"
 */
async function getNowPlaying() {
  if (DEMO_MODE) {
    return { title: 'Seleccionando tema...', artist: 'Esperando al locutor', album: '', emoji: '🎵' };
  }
  try {
    const { data, error } = await db.from('now_playing').select('*').eq('id', 1).single();
    if (error) throw error;
    return data;
  } catch(e) {
    return { title: 'Sin información', artist: '', emoji: '🎵' };
  }
}

/**
 * Actualizar "Ahora Suena"
 */
async function updateNowPlayingDB(np) {
  if (DEMO_MODE) {
    showToast('Modo demo: configura Supabase para actualizar en vivo', 'warning');
    return true;
  }
  try {
    const { error } = await db.from('now_playing').upsert({
      id: 1, ...np, updated_at: new Date().toISOString()
    });
    if (error) throw error;
    return true;
  } catch(e) {
    console.error('Error actualizando now playing:', e);
    showToast('Error al actualizar canción', 'error');
    return false;
  }
}

/**
 * Obtener mensajes del chat
 */
async function getChatMessages(limit = 50) {
  if (DEMO_MODE) {
    return [
      { id: 1, username: 'María', message: '¡Qué buena música! 🎵', created_at: new Date().toISOString() },
      { id: 2, username: 'Carlos', message: '¡Felicitaciones por la radio!', created_at: new Date().toISOString() },
    ];
  }
  try {
    const { data, error } = await db.from('chat_messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch(e) {
    console.error('Error obteniendo chat:', e);
    return [];
  }
}

/**
 * Enviar mensaje al chat
 */
async function sendChatMessageDB(username, message) {
  if (DEMO_MODE) {
    // En modo demo, simular localmente
    return {
      id: Date.now(),
      username,
      message,
      created_at: new Date().toISOString()
    };
  }
  try {
    const { data, error } = await db.from('chat_messages').insert([{
      username: username || 'Anónimo',
      message,
      session_id: getSessionId(),
      created_at: new Date().toISOString()
    }]).select().single();
    if (error) throw error;
    return data;
  } catch(e) {
    console.error('Error enviando mensaje:', e);
    showToast('Error al enviar mensaje', 'error');
    return null;
  }
}

/**
 * Suscribirse a cambios en tiempo real del chat
 */
function subscribeToChatRealtime(callback) {
  if (DEMO_MODE) return null;
  return db.channel('chat_channel')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'chat_messages'
    }, (payload) => callback(payload.new))
    .subscribe();
}

/**
 * Suscribirse a cambios en now_playing
 */
function subscribeToNowPlayingRealtime(callback) {
  if (DEMO_MODE) return null;
  return db.channel('nowplaying_channel')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'now_playing'
    }, (payload) => callback(payload.new))
    .subscribe();
}

/**
 * Suscribirse a cambios en station_config
 */
function subscribeToStationRealtime(callback) {
  if (DEMO_MODE) return null;
  return db.channel('station_channel')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'station_config'
    }, (payload) => callback(payload.new))
    .subscribe();
}

// ================================================
// SUPABASE AUTH
// ================================================

async function signIn(email, password) {
  if (DEMO_MODE) {
    // En modo demo: contraseña de demos es "radio2024"
    if (password === 'radio2024') {
      return { user: { email }, error: null };
    }
    return { user: null, error: { message: 'Contraseña incorrecta (demo: usa "radio2024")' } };
  }
  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    return { user: data?.user, error };
  } catch(e) {
    return { user: null, error: e };
  }
}

async function signOut() {
  if (DEMO_MODE) return;
  try {
    await db.auth.signOut();
  } catch(e) {
    console.error('Error cerrando sesión:', e);
  }
}

async function getCurrentUser() {
  if (DEMO_MODE) {
    const demoUser = sessionStorage.getItem('demo_user');
    return demoUser ? JSON.parse(demoUser) : null;
  }
  try {
    const { data: { user } } = await db.auth.getUser();
    return user;
  } catch(e) {
    return null;
  }
}

// ================================================
// AUTO-ACTUALIZACIÓN: si el servidor tiene una
// versión más nueva, la página se recarga sola
// (evita problemas de caché con código viejo)
// ================================================
(async function checkForUpdates() {
  try {
    const r = await fetch('version.txt', { cache: 'no-store' });
    if (!r.ok) return;
    const remote = (await r.text()).trim();
    if (remote && remote !== APP_VERSION) {
      console.warn('🔄 Nueva versión:', remote, '(actual:', APP_VERSION + ') — recargando...');
      setTimeout(() => {
        location.href = location.pathname + '?v=' + encodeURIComponent(remote) + '&t=' + Date.now();
      }, 1500);
    }
  } catch (e) { /* sin red o archivo no existe: seguir */ }
})();
