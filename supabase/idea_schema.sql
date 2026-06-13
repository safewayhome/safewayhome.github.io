-- LedMig Idea Web (/idea): delad realtidskarta för internt brainstorm
-- =================================================================
-- Kör HELA filen EN gång i Supabase: Dashboard -> SQL Editor -> klistra in -> Run. Idempotent.
-- (Är redan applicerad i projektet ryctrgvoimxcwwxchhvi via MCP-migrationen idea_web_nodes_edges;
--  filen finns här som committad referens och för att kunna återskapa schemat i ett nytt projekt.)
--
-- Speglar board_tasks-modellen (se schema.sql): Postgres som sanningskälla + Realtime så en ändring
-- syns för hela teamet direkt. idea_nodes = ett idéblock per rad, idea_edges = en tråd per rad.
--
-- SÄKERHETSMODELL: LÄSNING är öppen (vem som helst kan se kartan), ÄNDRINGAR kräver INLOGGNING.
-- Det räcker att skapa ett konto (samma Supabase-projekt som appen/tavlan). Identisk med tavlan.

-- ── nodes ────────────────────────────────────────────────────────────────────
create table if not exists public.idea_nodes (
  id         text primary key,                          -- klient-genererat stabilt id
  board_id   text not null default 'ledmig-ideas-v1',
  x          double precision not null default 0,
  y          double precision not null default 0,
  title      text not null default '',
  category   text not null default 'core',              -- core | marketing | tech | ux
  image_url  text,                                      -- PUBLIK URL i bucketen idea-images (aldrig en dataURL)
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Full replica identity: Realtime-UPDATE/DELETE bär hela raden (positions-merge per fält i klienten).
alter table public.idea_nodes replica identity full;
create index if not exists ix_idea_nodes_board on public.idea_nodes (board_id);

-- ── edges (trådar): oföränderliga, bara insert/delete. ON DELETE CASCADE städar trådar när en
--    nod raderas (samma mönster som board_activity mot board_tasks). ─────────────
create table if not exists public.idea_edges (
  id         text primary key,
  board_id   text not null default 'ledmig-ideas-v1',
  from_id    text not null references public.idea_nodes(id) on delete cascade,
  to_id      text not null references public.idea_nodes(id) on delete cascade,
  created_by text,
  created_at timestamptz not null default now()
);
alter table public.idea_edges replica identity full;
create index if not exists ix_idea_edges_board on public.idea_edges (board_id);
create index if not exists ix_idea_edges_from on public.idea_edges (from_id);
create index if not exists ix_idea_edges_to on public.idea_edges (to_id);

-- ── meta (seed-flagga, så startväven inte återuppstår) ───────────────────────
create table if not exists public.idea_meta (
  key   text primary key,
  value jsonb
);

-- ── Row Level Security: läs öppen, skriv inloggad (alla authenticated) ────────
alter table public.idea_nodes enable row level security;
alter table public.idea_edges enable row level security;
alter table public.idea_meta  enable row level security;

drop policy if exists idea_nodes_read  on public.idea_nodes;
drop policy if exists idea_nodes_write on public.idea_nodes;
drop policy if exists idea_edges_read  on public.idea_edges;
drop policy if exists idea_edges_write on public.idea_edges;
drop policy if exists idea_meta_read   on public.idea_meta;
drop policy if exists idea_meta_write  on public.idea_meta;

create policy idea_nodes_read  on public.idea_nodes for select to anon, authenticated using (true);
create policy idea_nodes_write on public.idea_nodes for all    to authenticated using (true) with check (true);
create policy idea_edges_read  on public.idea_edges for select to anon, authenticated using (true);
create policy idea_edges_write on public.idea_edges for all    to authenticated using (true) with check (true);
create policy idea_meta_read   on public.idea_meta  for select to anon, authenticated using (true);
create policy idea_meta_write  on public.idea_meta  for all    to authenticated using (true) with check (true);

-- ── Realtime ─────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='idea_nodes') then
    alter publication supabase_realtime add table public.idea_nodes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='idea_edges') then
    alter publication supabase_realtime add table public.idea_edges;
  end if;
end $$;

-- ── Storage: bucket för idébilder (publik läsning, inloggad uppladdning) ──────
-- Bilderna laddas upp hit; bara den korta publika URL:en sparas i idea_nodes.image_url.
insert into storage.buckets (id, name, public) values ('idea-images', 'idea-images', true)
on conflict (id) do nothing;

drop policy if exists idea_img_read   on storage.objects;
drop policy if exists idea_img_insert on storage.objects;
create policy idea_img_read   on storage.objects for select to public        using (bucket_id = 'idea-images');
create policy idea_img_insert on storage.objects for insert to authenticated with check (bucket_id = 'idea-images');
