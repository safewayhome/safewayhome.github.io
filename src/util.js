import { CATEGORIES, DIFFICULTIES, DIFF, DEFAULT_DIFFICULTY } from './theme'

/** Svårighetsgrad för en uppgift, med fallback för äldre kort utan fältet. */
export const diffKey = (t) => (t && DIFF[t.difficulty] ? t.difficulty : DEFAULT_DIFFICULTY)
export const diffOf = (t) => DIFF[diffKey(t)]

/** Hur klar en uppgift är (statusbaserat, inga timmar): klar = 1, pågår = 0.5, att göra = 0. */
export function fraction(t) {
  return t.status === 'done' ? 1 : t.status === 'doing' ? 0.5 : 0
}

/**
 * Rulla ihop framsteg för en uppsättning uppgifter — rent ANTAL utförda av totalen
 * (status-/antalsbaserat, inte timmar). pct = andel klara uppgifter.
 */
export function computeProgress(tasks) {
  const counts = { todo: 0, doing: 0, done: 0 }
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1
  const n = tasks.length
  const done = counts.done
  const pct = n > 0 ? Math.round((done / n) * 100) : 0
  return { counts, n, done, pct }
}

/** Framsteg per team-kategori (endast över de givna, ev. filtrerade, uppgifterna). */
export function progressByCategory(tasks) {
  return CATEGORIES.map((c) => ({
    cat: c,
    ...computeProgress(tasks.filter((t) => t.category === c.key)),
  }))
}

/** Framsteg per svårighetsgrad: en post per fast svårighetsgrad (alltid alla fyra). */
export function progressByDifficulty(tasks) {
  return DIFFICULTIES.map((d) => ({
    diff: d,
    ...computeProgress(tasks.filter((t) => diffKey(t) === d.key)),
  }))
}

/** Mänskligt "redigerat för 3 min sedan". */
export function ago(ts) {
  if (!ts) return ''
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'nyss'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min sedan`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h sedan`
  return `${Math.floor(h / 24)} d sedan`
}
