-- Run once in the existing Supabase SQL Editor before deploying the new server.
-- Safe to run again: existing settings are preserved.
CREATE TABLE IF NOT EXISTS public.buzzer_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'ds18b20'
    CHECK (source IN ('ds18b20', 'amg_max', 'amg_center', 'amg_min')),
  on_c numeric(6,2) NOT NULL DEFAULT 50,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  stop_revision integer NOT NULL DEFAULT 0 CHECK (stop_revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'ds18b20' AND on_c >= -55 AND on_c <= 125)
      OR (source <> 'ds18b20' AND on_c >= 0 AND on_c <= 80))
);
ALTER TABLE public.buzzer_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.buzzer_settings FROM anon, authenticated;
GRANT ALL ON TABLE public.buzzer_settings TO service_role;
INSERT INTO public.buzzer_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
