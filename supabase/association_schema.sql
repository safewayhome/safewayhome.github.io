-- LedMig: Ideell förening (intervju-/berättelseanmälningar från /ideel)
-- =================================================================
-- Kör HELA filen EN gång i Supabase: Dashboard -> SQL Editor -> klistra in -> Run. Idempotent.
--
-- Tabellen association_interviews lagrar en rad per person som vill bli intervjuad eller dela sin
-- berättelse via det publika formuläret på ledmig.nu/ideel.
--
-- SÄKERHETSMODELL (GDPR, dataminimering, försvar på djupet):
--   * Formuläret är ÖPPET (ingen inloggning) -> anon får INSERT.
--   * Det finns medvetet INGEN SELECT/UPDATE/DELETE-policy -> RLS nekar all läsning/ändring via
--     anon- och authenticated-nyckeln. Tabellen är alltså WRITE-ONLY för klienten: insamlade
--     kontaktuppgifter kan INTE läsas tillbaka via den publika nyckeln. Endast service_role
--     (Supabase Dashboard / backend) kan administrera raderna. Det är den verkliga åtkomstgränsen.
--   * with check binder varje rad till uttryckligt SAMTYCKE (consent = true) och rimliga längder,
--     så ingen rad kan sparas utan samtycke och fältlängderna kan inte missbrukas.
--   * Dataminimering: bara namn (valfritt), e-post (valfritt), meddelande och samtycke + tidsstämpel.
--     Ingen IP, ingen user-agent. Postgres krypterar data i vila (at rest); TLS skyddar i transit.

create extension if not exists pgcrypto;   -- ger gen_random_uuid()

create table if not exists public.association_interviews (
  id          uuid primary key default gen_random_uuid(),
  name        text,                                  -- valfritt: tomt = anonymt
  email       text,                                  -- valfritt: behövs bara om man vill bli kontaktad
  message     text not null default '',              -- berättelsen / vad man vill dela eller fråga
  consent     boolean not null default false,        -- uttryckligt GDPR-samtycke (krävs av RLS nedan)
  created_at  timestamptz not null default now()
);

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.association_interviews enable row level security;

drop policy if exists assoc_interviews_insert on public.association_interviews;
-- INSERT öppet för anon + authenticated, men bara med samtycke och rimliga längder.
create policy assoc_interviews_insert on public.association_interviews
  for insert to anon, authenticated
  with check (
    consent = true
    and char_length(message) between 1 and 4000
    and char_length(coalesce(email, '')) <= 320
    and char_length(coalesce(name, '')) <= 200
  );
-- Ingen SELECT/UPDATE/DELETE-policy med flit: write-only via publika nyckeln. service_role kringgår RLS
-- och används för att läsa/administrera anmälningarna i Dashboard.

-- OBS: tabellen läggs MEDVETET inte i Realtime-publikationen (kontaktuppgifter ska inte broadcastas).
