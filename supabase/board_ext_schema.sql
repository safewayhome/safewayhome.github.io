-- LedMig Team Board: utbyggnad (Undo-historik + Diskussionstrådar)
-- =================================================================
-- Kör HELA filen EN gång i Supabase: Dashboard -> SQL Editor -> klistra in -> Run.
-- Den är idempotent (går att köra om utan att förstöra data). Den kompletterar schema.sql.
--
-- Vad den sätter upp:
--   board_ops             : global, ångringsbar operationslogg (skapa/ändra/radera kort med
--                           before/after) så att "Global ångra" kan backa teamets senaste ändring,
--                           flera steg bakåt. Lokal ångra (per användare) behöver INGEN tabell.
--   board_threads         : diskussionstrådar inuti ett kort (titel/syfte + arkiveringsstatus).
--   board_thread_messages : meddelanden i en tråd, med parent_id för Twitch-liknande svar (reply).
-- Plus Row Level Security (RLS) och Realtime så att trådar/svar syns direkt hos alla.
--
-- SÄKERHETSMODELL:
--   board_ops: LÄS öppet (för transparens), SKRIV/uppdatera kräver inloggning (authenticated).
--   Trådar: BÅDE läsning och skrivning kräver inloggning (intern teamdiskussion, likt chatten).
--   Insert binds till den autentiserade sessionen (user_id/created_by_id = auth.uid()) så att
--   ingen kan posta i någon annans namn (OWASP A01: Broken Access Control / identitetsspoofing).

create extension if not exists pgcrypto;   -- ger gen_random_uuid()

-- ── board_ops: global ångra-historik ────────────────────────────────────────
create table if not exists public.board_ops (
  id          uuid primary key default gen_random_uuid(),
  seq         bigint generated always as identity,        -- total ordning: senaste op har högst seq
  board_id    text not null,                              -- vilken tavla operationen hör till
  op_kind     text not null,                              -- create | update | delete
  task_id     text not null,                              -- kortet som ändrades
  before      jsonb,                                      -- kort-raden (snake_case kolumner) FÖRE, null vid create
  after       jsonb,                                      -- kort-raden EFTER, null vid delete
  actor_id    text,
  actor_name  text,
  created_at  timestamptz not null default now(),
  undone      boolean not null default false,             -- true = redan ångrad (hoppas över av nästa ångra)
  undone_at   timestamptz,
  undone_by   text
);
-- Nästa op att ångra hämtas som "högsta seq där undone=false" per tavla: matchande index.
create index if not exists ix_board_ops_board_seq on public.board_ops (board_id, undone, seq desc);

-- ── board_threads: diskussionstrådar i ett kort ─────────────────────────────
create table if not exists public.board_threads (
  id              uuid primary key default gen_random_uuid(),
  board_id        text not null,
  task_id         text not null references public.board_tasks(id) on delete cascade,
  title           text not null default '',               -- valfritt syfte/titel på tråden
  created_by_id   uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_by_color text,
  archived        boolean not null default false,         -- arkiverad = dold från huvudvyn, kvar i DB
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists ix_board_threads_task on public.board_threads (task_id, created_at);
alter table public.board_threads replica identity full;   -- så UPDATE-payloads (arkivering) bär hela raden

-- ── board_thread_messages: meddelanden + Twitch-svar (parent_id) ────────────
create table if not exists public.board_thread_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.board_threads(id) on delete cascade,
  parent_id   uuid references public.board_thread_messages(id) on delete set null, -- svar pekar på sitt original
  user_id     uuid references auth.users(id) on delete set null,
  user_name   text,
  user_color  text,
  body        text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists ix_thread_messages_thread on public.board_thread_messages (thread_id, created_at);

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.board_ops             enable row level security;
alter table public.board_threads         enable row level security;
alter table public.board_thread_messages enable row level security;

-- Idempotent: släpp ev. gamla policys och (åter)skapa.
drop policy if exists board_ops_read   on public.board_ops;
drop policy if exists board_ops_insert on public.board_ops;
drop policy if exists board_ops_update on public.board_ops;
drop policy if exists threads_read   on public.board_threads;
drop policy if exists threads_insert on public.board_threads;
drop policy if exists threads_update on public.board_threads;
drop policy if exists thread_msgs_read   on public.board_thread_messages;
drop policy if exists thread_msgs_insert on public.board_thread_messages;

-- board_ops: läs öppet (transparens), skapa/uppdatera (markera ångrad) kräver inloggning.
-- Insert binds till den inloggade: actor_id måste vara den egna sessionens uid (auth.uid()), så att
-- ingen kan logga en operation i någon annans namn (OWASP A01). actor_id är text -> casta uid till text.
create policy board_ops_read   on public.board_ops for select to anon, authenticated using (true);
create policy board_ops_insert on public.board_ops for insert to authenticated with check (actor_id = auth.uid()::text);
create policy board_ops_update on public.board_ops for update to authenticated using (true) with check (true);

-- board_threads: intern teamdiskussion -> bara inloggade får läsa OCH skriva. Insert binds till
-- den inloggade (created_by_id = auth.uid()) så ingen kan starta en tråd i någon annans namn.
create policy threads_read   on public.board_threads for select to authenticated using (true);
create policy threads_insert on public.board_threads for insert to authenticated with check (created_by_id = auth.uid());
create policy threads_update on public.board_threads for update to authenticated using (true) with check (true);

-- board_thread_messages: bara inloggade läser/skriver. Insert binds till avsändaren (user_id = auth.uid()).
create policy thread_msgs_read   on public.board_thread_messages for select to authenticated using (true);
create policy thread_msgs_insert on public.board_thread_messages for insert to authenticated with check (user_id = auth.uid());

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Trådar + svar broadcastas så att en ny tråd/svar/arkivering syns direkt hos hela teamet.
-- (board_ops hålls UTANFÖR realtime: before/after-blobbar behöver inte strömmas till alla.)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='board_threads') then
    alter publication supabase_realtime add table public.board_threads;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='board_thread_messages') then
    alter publication supabase_realtime add table public.board_thread_messages;
  end if;
end $$;
