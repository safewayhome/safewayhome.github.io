-- LedMig Team Board: backend-schema (Supabase Postgres + Realtime)
-- =================================================================
-- Kör HELA den här filen EN gång i Supabase: Dashboard -> SQL Editor -> klistra in -> Run.
-- Den är idempotent (går att köra om utan att förstöra data).
--
-- Vad den sätter upp:
--   board_tasks     : ett kort per rad. Källan till sanning för hela tavlan.
--   board_activity  : redigeringshistorik (ett "vem gjorde vad, när" per ändring) per kort.
--   board_meta      : små nyckel/värde-flaggor (t.ex. "seeded" så seed inte återuppstår).
-- Plus Row Level Security (RLS) och Realtime så att en ändring direkt syns hos alla.
--
-- SÄKERHETSMODELL: LÄSNING är öppen (vem som helst kan se tavlan/changelog/data), men ÄNDRINGAR
-- (skapa/flytta/redigera/radera kort) kräver att man är INLOGGAD. Det räcker att skapa ett konto:
-- alla inloggade får full tillgång till korten. Utan konto är tavlan skrivskyddad. Tavlan har en
-- Supabase-inloggning (email+lösen).

-- ── tasks ──────────────────────────────────────────────────────────────────
create table if not exists public.board_tasks (
  id          text primary key,                       -- klient-genererat stabilt id (t_xxx / seed_xxx)
  title       text        not null default 'Ny uppgift',
  description text        not null default '',
  approach    text        not null default '',
  category    text        not null default 'dev',      -- team-kategori (dev/backend/data/mkt)
  sub         text        not null default '',         -- underkategori
  status      text        not null default 'todo',     -- todo | doing | done
  difficulty  text        not null default 'medel',    -- enkel | medel | svar | extrem
  sort_order  double precision not null default 0,     -- "order" är reserverat ord -> sort_order
  x           double precision,                        -- fri whiteboard-position (null = auto-flöde i kolumn)
  y           double precision,
  deps        jsonb       not null default '[]'::jsonb, -- id:n den här uppgiften beror på (pilar)
  created_by  jsonb,                                   -- {id,name,color} på den som skapade kortet
  updated_by  text,                                    -- namn på senaste redigeraren
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Full replica identity så att Realtime-UPDATE/DELETE-payloads bär hela raden (inte bara PK).
alter table public.board_tasks replica identity full;

-- ── activity (redigeringshistorik, likt Google Drive-historik) ──────────────
create table if not exists public.board_activity (
  id          bigint generated always as identity primary key,
  cid         text unique,                             -- klient-id för dedup (optimistisk lokal rad == DB-eko)
  task_id     text not null references public.board_tasks(id) on delete cascade,
  at          timestamptz not null default now(),
  actor_id    text,
  actor_name  text,
  actor_color text,
  kind        text not null default 'update',          -- created | update | edit
  summary     text not null                            -- människoläsbar svensk rad: 'flyttade till "Klar"'
);
-- Historik hämtas alltid per kort, nyast först: matchande index.
create index if not exists ix_board_activity_task_at on public.board_activity (task_id, at desc);

-- ── meta (små flaggor) ──────────────────────────────────────────────────────
create table if not exists public.board_meta (
  key   text primary key,
  value jsonb
);

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Slå på RLS. LÄS: anon + authenticated. SKRIV: alla inloggade (authenticated). Det räcker att
-- skapa ett konto för att få full tillgång till korten; utan konto är tavlan skrivskyddad.
alter table public.board_tasks    enable row level security;
alter table public.board_activity enable row level security;
alter table public.board_meta     enable row level security;

-- Idempotent: släpp ev. gamla policys (inkl. den tidigare mejl-listans) och (åter)skapa läs/skriv.
drop policy if exists board_tasks_all      on public.board_tasks;
drop policy if exists board_tasks_read     on public.board_tasks;
drop policy if exists board_tasks_write    on public.board_tasks;
drop policy if exists board_activity_all    on public.board_activity;
drop policy if exists board_activity_read   on public.board_activity;
drop policy if exists board_activity_insert on public.board_activity;
drop policy if exists board_meta_all   on public.board_meta;
drop policy if exists board_meta_read  on public.board_meta;
drop policy if exists board_meta_write on public.board_meta;
-- Tidigare mejl-allowlist är borttagen: full tillgång för alla inloggade.
drop function if exists public.is_board_editor();

-- board_tasks: alla får läsa, alla inloggade får skapa/ändra/radera.
create policy board_tasks_read  on public.board_tasks for select to anon, authenticated using (true);
create policy board_tasks_write on public.board_tasks for all    to authenticated using (true) with check (true);

-- board_activity: alla får läsa historiken, alla inloggade får skriva nya rader.
create policy board_activity_read   on public.board_activity for select to anon, authenticated using (true);
create policy board_activity_insert on public.board_activity for insert to authenticated with check (true);

-- board_meta: alla får läsa, alla inloggade får skriva (seed-flaggan m.m.).
create policy board_meta_read  on public.board_meta for select to anon, authenticated using (true);
create policy board_meta_write on public.board_meta for all    to authenticated using (true) with check (true);

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Lägg tabellerna i Supabase Realtime-publikationen så postgres_changes broadcastar
-- INSERT/UPDATE/DELETE till alla anslutna klienter. (Hoppar tyst om de redan ligger i.)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='board_tasks') then
    alter publication supabase_realtime add table public.board_tasks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='board_activity') then
    alter publication supabase_realtime add table public.board_activity;
  end if;
end $$;
