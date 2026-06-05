import { CATEGORIES, CAT } from './theme'

/** Fraction of a task considered complete (estimate-weighted). */
export function fraction(t) {
  if (t.status === 'done') return 1
  if (t.status === 'doing') {
    const e = Math.max(Number(t.estimateH) || 0, 0.001)
    return Math.min((Number(t.spentH) || 0) / e, 0.95) // cap so "doing" never reads as 100%
  }
  return 0
}

/** Roll up progress for a set of tasks: estimate-weighted completion + time accounting. */
export function computeProgress(tasks) {
  let estTotal = 0
  let weightedDone = 0
  let spent = 0
  let remaining = 0
  const counts = { todo: 0, doing: 0, done: 0 }
  for (const t of tasks) {
    const e = Number(t.estimateH) || 0
    const sp = Number(t.spentH) || 0
    estTotal += e
    weightedDone += e * fraction(t)
    spent += sp
    // remaining is spent-consistent: done = 0 left; otherwise estimate minus what's been logged.
    // This makes spent + remaining a coherent "projected total" the narrative can rely on.
    remaining += t.status === 'done' ? 0 : Math.max(e - sp, 0)
    counts[t.status] = (counts[t.status] || 0) + 1
  }
  const pct = estTotal > 0 ? Math.round((weightedDone / estTotal) * 100) : 0
  return { estTotal, weightedDone, spent, remaining, projected: spent + remaining, pct, counts, n: tasks.length }
}

/** Per-category progress breakdown (only over the given, possibly filtered, tasks). */
export function progressByCategory(tasks) {
  return CATEGORIES.map((c) => ({
    cat: c,
    ...computeProgress(tasks.filter((t) => t.category === c.key)),
  }))
}

export const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10
export const catOf = (key) => CAT[key] || { label: key, color: '#aaa', glyph: '•' }

/** Human-friendly "edited 3 min ago". */
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
