-- ================================================
-- RADIO TV ONLINE — Supabase Database Setup
-- Ejecutar en: Supabase → SQL Editor
-- ================================================

-- 1. Tabla principal de configuración de la estación
CREATE TABLE IF NOT EXISTS station_config (
  id            BIGINT PRIMARY KEY DEFAULT 1,
  name          TEXT    DEFAULT 'Radio TV Online',
  tagline       TEXT    DEFAULT 'Tu música, sin interrupciones',
  description   TEXT    DEFAULT 'Bienvenido a nuestra estación de radio online.',
  stream_url    TEXT    DEFAULT '',
  is_live       BOOLEAN DEFAULT false,
  quality       TEXT    DEFAULT 'HD',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar registro inicial
INSERT INTO station_config (id, name) VALUES (1, 'Radio TV Online')
ON CONFLICT (id) DO NOTHING;

-- 2. Tabla de "Ahora Suena"
CREATE TABLE IF NOT EXISTS now_playing (
  id         BIGINT PRIMARY KEY DEFAULT 1,
  title      TEXT DEFAULT 'Sin información',
  artist     TEXT DEFAULT '',
  album      TEXT DEFAULT '',
  emoji      TEXT DEFAULT '🎵',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar registro inicial
INSERT INTO now_playing (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- 3. Tabla de mensajes del chat
CREATE TABLE IF NOT EXISTS chat_messages (
  id         BIGSERIAL PRIMARY KEY,
  username   TEXT DEFAULT 'Anónimo',
  message    TEXT NOT NULL,
  session_id TEXT,
  is_broadcaster BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para consultas rápidas por fecha
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);

-- ================================================
-- ROW LEVEL SECURITY (RLS) — Seguridad
-- ================================================

-- station_config: solo lectura pública, escritura autenticada
ALTER TABLE station_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "station_config_read_public"
  ON station_config FOR SELECT USING (true);

CREATE POLICY "station_config_write_auth"
  ON station_config FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "station_config_insert_auth"
  ON station_config FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- now_playing: solo lectura pública, escritura autenticada
ALTER TABLE now_playing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "now_playing_read_public"
  ON now_playing FOR SELECT USING (true);

CREATE POLICY "now_playing_write_auth"
  ON now_playing FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "now_playing_insert_auth"
  ON now_playing FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- chat_messages: lectura pública, escritura pública (con rate limit recomendado)
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_messages_read_public"
  ON chat_messages FOR SELECT USING (true);

CREATE POLICY "chat_messages_insert_public"
  ON chat_messages FOR INSERT WITH CHECK (true);

-- ================================================
-- REALTIME — Habilitar para las tablas
-- ================================================
-- Ejecutar en SQL Editor de Supabase:
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE now_playing;
ALTER PUBLICATION supabase_realtime ADD TABLE station_config;

-- ================================================
-- CREAR USUARIO LOCUTOR
-- ================================================
-- Ir a: Supabase → Authentication → Users → Add User
-- Email: locutor@turadio.com
-- Password: (la que quieras, mínimo 8 caracteres)
-- Luego configurar ese email en la app
