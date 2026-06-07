/**
 * Datalager för den ideella föreningens intervju-/berättelseanmälningar (/ideel-formuläret).
 *
 * Vi återanvänder tavlans Supabase-klient (anon-/publishable-nyckeln, publik by design). Formuläret är
 * ÖPPET (ingen inloggning), så vi gör en ren INSERT mot tabellen association_interviews.
 *
 * SÄKERHET/GDPR: skyddet ligger i Row Level Security på Postgres-sidan, inte i klienten:
 *   - INSERT är tillåtet för anon, men with check kräver samtycke och rimliga längder.
 *   - Det finns INGEN SELECT-policy -> ingen kan LÄSA tillbaka anmälningarna via anon-nyckeln
 *     (write-only). Bara service_role / Dashboard kan administrera dem. Se supabase/association_schema.sql.
 *   - Dataminimering: vi sparar bara namn (valfritt), e-post (valfritt), meddelande och samtycke.
 *     Ingen IP, ingen user-agent. Postgres krypterar i vila; TLS skyddar i transit.
 */
import { supabase } from '../supabaseClient'

const MAX = { name: 200, email: 320, message: 4000 }
// Enkel, tillåtande e-postkontroll (klientsidan är bekvämlighet: RLS + längdtak är den verkliga gränsen).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateInterview({ email, message, consent }) {
  const msg = (message || '').trim()
  if (msg.length < 5) return 'Skriv gärna någon rad om vad du vill dela eller fråga.'
  if (email && !EMAIL_RE.test(email.trim())) return 'Dubbelkolla e-postadressen (eller lämna fältet tomt).'
  if (!consent) return 'Vi behöver ditt samtycke för att få spara och kontakta dig.'
  return null
}

export async function submitInterview({ name, email, message, consent }) {
  if (!supabase) return { error: 'Ingen anslutning just nu. Försök igen om en stund.' }
  const row = {
    name: (name || '').trim().slice(0, MAX.name) || null,
    email: (email || '').trim().slice(0, MAX.email) || null,
    message: (message || '').trim().slice(0, MAX.message),
    consent: !!consent,
  }
  try {
    const { error } = await supabase.from('association_interviews').insert(row)
    if (error) return { error: error.message }
    return { error: null }
  } catch (e) {
    return { error: e.message || 'Något gick fel. Försök igen.' }
  }
}
