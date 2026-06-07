-- LedMig Team Chat: backend-schema (Supabase Postgres + Realtime)
-- =================================================================
-- Kör HELA filen EN gång (Dashboard -> SQL Editor) eller via Management API. Idempotent.
--
-- Tabellen är loggen för flerspelarchatten + AI-pipelinens svar. Varje rad är ETT meddelande:
-- antingen från en inloggad människa (is_ai=false) eller det slutgiltiga svaret från den
-- molnhostade 3-stegs-LLM-kedjan (is_ai=true, skrivet av backend med service_role).
--
-- SÄKERHETSMODELL: chatten är PRIVAT för teamet. Till skillnad från whiteboarden (där läsning är
-- öppen) är BÅDE läsning och skrivning här låst till inloggade (authenticated). Utan konto ser man
-- ingenting: frontenden visar en låsvy med inloggningsknapp i stället.

create extension if not exists pgcrypto;   -- ger gen_random_uuid()

create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete set null, -- vem som skrev (null för AI)
  user_email      text,                                              -- denormaliserat: visa avsändare utan join mot auth
  message_text    text not null default '',
  image_url       text,                                              -- publik URL till bifogad skärmdump (null = ingen)
  is_ai           boolean not null default false,                    -- true = svar från LLM-kedjan
  thinking_process text,                                             -- AI:ns tänkande-process (synlig för ALLA i chatten)
  created_at      timestamptz not null default now()
);
-- thinking_process: AI:ns resonemang (steg 1+2 i tänkande-läget) sparas så att HELA teamet ser det via
-- Realtime, inte bara avsändaren. Idempotent ALTER så befintliga tabeller (utan kolumnen) uppgraderas.
alter table public.chat_messages add column if not exists thinking_process text;
-- Historik hämtas alltid i tidsordning -> index på created_at.
create index if not exists ix_chat_messages_created on public.chat_messages (created_at);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Allt låst till inloggade. AI-raderna skrivs av backend med service_role som kringgår RLS helt,
-- så insert-policyn nedan gäller bara människornas egna meddelanden.
--
-- OWASP A01 (Broken Access Control / identitetsspoofing): insert-policyn binder raden till den
-- autentiserade sessionen: user_id = auth.uid() OCH user_email = JWT:ns e-post. Utan den (with
-- check (true)) kunde en inloggad användare via ett rått PostgREST-anrop lagra ett meddelande i
-- någon annans namn (avsändaren visas i UI:t). Frontenden skickar redan me.id/me.email, så normal-
-- flödet är oförändrat; AI-inserts berörs inte (service_role kringgår RLS).
alter table public.chat_messages enable row level security;

drop policy if exists chat_read  on public.chat_messages;
drop policy if exists chat_write on public.chat_messages;
create policy chat_read  on public.chat_messages for select to authenticated using (true);
create policy chat_write on public.chat_messages for insert to authenticated
  with check (user_id = auth.uid() and user_email = (auth.jwt() ->> 'email'));

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Lägg tabellen i realtime-publikationen så att INSERT broadcastas till alla inloggade klienter
-- direkt (RLS gäller även här: bara authenticated får payloaderna). Hoppar tyst om den redan ligger i.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- ── Storage: bilduppladdning (skärmdumpar) ───────────────────────────────────
-- Bucketen 'chat-images' skapas via Storage-API:t (se setup-skriptet). Här sätter vi bara
-- RLS-policyn på storage.objects: vem som helst får LÄSA en bild (bucketen är publik så att
-- både frontenden och Gemini kan hämta URL:en), men bara inloggade får LADDA UPP.
drop policy if exists chat_img_read   on storage.objects;
drop policy if exists chat_img_insert on storage.objects;
create policy chat_img_read   on storage.objects for select using (bucket_id = 'chat-images');
create policy chat_img_insert on storage.objects for insert to authenticated with check (bucket_id = 'chat-images');
