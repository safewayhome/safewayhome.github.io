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
-- (skapa/flytta/redigera/radera kort) kräver inloggning OCH att mejladressen finns på teamets
-- tillåtna lista (se is_board_editor() nedan). Även om en utomstående registrerar ett konto kan
-- den alltså inte redigera: bara teamets tre mejl släpps igenom av write-policyerna. Tavlan har en
-- Supabase-inloggning (email+lösen). Vill ni lägga till/ta bort en redigerare: ändra listan i
-- funktionen is_board_editor() och kör om den här filen (idempotent).

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
-- Slå på RLS. LÄS: anon + authenticated. SKRIV: bara teamets tillåtna mejl (is_board_editor).
alter table public.board_tasks    enable row level security;
alter table public.board_activity enable row level security;
alter table public.board_meta     enable row level security;

-- Vem får redigera: teamets mejladresser. Ändra listan här för att lägga till/ta bort en redigerare.
-- (auth.jwt()->>'email' = den inloggades mejl; tom sträng för anon/utloggad -> nekas.)
create or replace function public.is_board_editor()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') in (
    't@langstrom.se',
    'dv23tlm@cs.umu.se',
    'hampuswidebo04@gmail.com'
  )
$$;

-- Idempotent: släpp ev. gamla/öppna policys och (åter)skapa de uppdelade läs/skriv-policyerna.
drop policy if exists board_tasks_all      on public.board_tasks;
drop policy if exists board_tasks_read     on public.board_tasks;
drop policy if exists board_tasks_write    on public.board_tasks;
drop policy if exists board_activity_all    on public.board_activity;
drop policy if exists board_activity_read   on public.board_activity;
drop policy if exists board_activity_insert on public.board_activity;
drop policy if exists board_meta_all   on public.board_meta;
drop policy if exists board_meta_read  on public.board_meta;
drop policy if exists board_meta_write on public.board_meta;

-- board_tasks: alla får läsa, bara teamets mejl får skapa/ändra/radera.
create policy board_tasks_read  on public.board_tasks for select to anon, authenticated using (true);
create policy board_tasks_write on public.board_tasks for all    to authenticated using (public.is_board_editor()) with check (public.is_board_editor());

-- board_activity: alla får läsa historiken, bara teamets mejl får skriva nya rader.
create policy board_activity_read   on public.board_activity for select to anon, authenticated using (true);
create policy board_activity_insert on public.board_activity for insert to authenticated with check (public.is_board_editor());

-- board_meta: alla får läsa, bara teamets mejl får skriva (seed-flaggan m.m.).
create policy board_meta_read  on public.board_meta for select to anon, authenticated using (true);
create policy board_meta_write on public.board_meta for all    to authenticated using (public.is_board_editor()) with check (public.is_board_editor());

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
