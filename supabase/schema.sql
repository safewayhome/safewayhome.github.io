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
-- SÄKERHETSMODELL: anon-nyckeln ligger i den publika bundlen, så policyerna nedan släpper
-- in vem som helst som har nyckeln (= alla som hittar sajten). Det matchar dagens "intern men
-- inte hemlig"-läge. Vill ni låsa till inloggade konton: byt "to anon, authenticated" mot
-- "to authenticated" i policyerna (kräver att team-boarden loggar in via Supabase Auth).

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
-- Slå på RLS och tillåt full åtkomst för anon (publik nyckel) + inloggade. Se säkerhetsnoten ovan.
alter table public.board_tasks    enable row level security;
alter table public.board_activity enable row level security;
alter table public.board_meta     enable row level security;

do $$
begin
  -- board_tasks
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='board_tasks' and policyname='board_tasks_all') then
    create policy board_tasks_all on public.board_tasks for all to anon, authenticated using (true) with check (true);
  end if;
  -- board_activity
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='board_activity' and policyname='board_activity_all') then
    create policy board_activity_all on public.board_activity for all to anon, authenticated using (true) with check (true);
  end if;
  -- board_meta
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='board_meta' and policyname='board_meta_all') then
    create policy board_meta_all on public.board_meta for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

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
