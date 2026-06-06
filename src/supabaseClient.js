// Supabase-klient för team-boarden (browser).
// Tavlans hela datalager (kort + historik + presence) körs på den här instansen via collab.js.
//
// Anon-/publishable-nyckeln är publik by design och hamnar i bundlen: skyddet ligger i
// Postgres RLS på Supabase-sidan, inte i att gömma nyckeln. Vi läser i första hand env
// (VITE_SUPABASE_*) men faller tillbaka på de inbyggda publika defaultvärdena så att en
// ren `npm run build` i CI alltid kopplar upp sig, även utan .env-fil.
//
// Mjuk degradering (samma filosofi som resten av LedMig): går Supabase inte att nå, eller
// är tabellerna inte skapade än, kör collab.js vidare i ett lokalt läge (localStorage) i
// stället för att krascha. Tavlan funkar då lokalt och uppgraderas automatiskt till delad
// DB-synk så fort backend svarar.
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://ryctrgvoimxcwwxchhvi.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Ablx00EBgsqR3iTE-Xn89A_MdaGGTRc'

export const supabaseEnabled = Boolean(url && key)
export const SUPABASE_URL = url

// Ingen auth-session behövs (boarden använder inte login): vi stänger av session-persistens
// och URL-tolkning så klienten håller sig till data + realtime. realtime-takten höjs lite
// så muspekar-broadcasts inte stryps.
export const supabase = supabaseEnabled
  ? createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 30 } },
    })
  : null
