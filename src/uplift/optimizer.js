/**
 * Klientsidans spegel av OR-Tools-optimeraren i api_server/uplift.py (solve_allocation / _build_result).
 *
 * Varför en spegel: de tunga ML-beroendena (econml + ortools) ligger MEDVETET utanför den slimmade
 * Cloud Run-imagen, så backend-endpointen svarar 503 i drift. För att sidan ska räkna om allokeringen
 * direkt när man drar i reglagen (utan nätverksrundtur) löser vi samma "multiple-choice knapsack" här.
 *
 * Problemet är litet (7 stadsdelar x 3 val = 3^7 = 2187 kombinationer), så vi gör en UTTÖMMANDE sökning:
 * exakt globalt optimum, identiskt med CP-SAT. Samma heltalsskalning (öre), samma målfunktion
 * (netto * 1000 minus kostnad som tie-break) och samma kombinations-/ordningskonvention som Python,
 * så facit (backend) och klientberäkning ger exakt samma beslut.
 *
 * Lyftet (donationskronor per hushåll) kommer från den TRÄNADE Causal Forest-modellen: antingen
 * den bakade ögonblicksbilden (baseline.json) eller en färsk hämtning från backend.
 */

export const TREATMENTS = ['none', 'standard', 'premium']

// Kronor -> öre, avrundat HALV UPPÅT. Speglar _to_ore i api_server/uplift.py (floor(x+0.5)) så att
// optimum aldrig kan skilja sig på en öre mellan backend-facit och den här klientberäkningen.
const toOre = (sek) => Math.round(sek * 100)

/**
 * Per stadsdel och val: brutto, kostnad, netto och antal enheter (i kr).
 * net = hushåll * (lyft * multiplikator − styckkostnad). cost = hushåll * styckkostnad.
 */
function optionEconomics(districts, uplift, econ) {
  const opt = (hh, gross, cost) => ({ gross, cost, net: gross - cost, units: hh })
  return districts.map((d) => {
    // Robust mot trasig indata: ett icke-ändligt eller negativt lyft (ska aldrig hända från baseline.json
    // eller den validerade backenden) behandlas som 0 så KPI:erna aldrig blir NaN och sidan inte blankar.
    const raw = uplift[d.key]
    const u = Number.isFinite(raw) && raw > 0 ? raw : 0
    const hh = d.households
    return {
      key: d.key,
      name: d.name,
      households: hh,
      uplift: u,
      opts: {
        none: { gross: 0, cost: 0, net: 0, units: 0 },
        standard: opt(hh, hh * u * econ.multStandard, hh * econ.costStandard),
        premium: opt(hh, hh * u * econ.multPremium, hh * econ.costPremium),
      },
    }
  })
}

function decisionReason(decision, bestProfitableNet) {
  if (decision === 'premium') return 'Premium: det dyrare utskicket maximerar nettovinsten här.'
  if (decision === 'standard') return 'Standard: ger bäst nettovinst per krona inom budget.'
  if (bestProfitableNet <= 0) return 'Avstår: ett utskick skulle gå med förlust (lyftet täcker inte kostnaden).'
  return 'Avstår: lönsamt i teorin, men budgeten räcker till högre nettovinst i andra områden.'
}

/**
 * Lös den fördelningsoptimala kampanjen (uttömmande sökning, exakt optimum).
 * @param districts [{key,name,households}] i SAMMA ordning som backendens DISTRICTS
 * @param uplift    {key: kr/hushåll}
 * @param econ      {budget, costStandard, costPremium, multStandard, multPremium, rideCost}
 * @returns samma form som backendens solution-payload (kpis + districts)
 */
export function optimize(districts, uplift, econ) {
  const rows = optionEconomics(districts, uplift, econ)
  const n = rows.length
  const budgetOre = toOre(econ.budget)

  let bestScore = null
  let bestChoice = null
  const total = 3 ** n
  for (let combo = 0; combo < total; combo++) {
    const choice = new Array(n)
    let c = combo
    for (let i = 0; i < n; i++) { choice[i] = TREATMENTS[c % 3]; c = Math.floor(c / 3) }

    let costOre = 0
    for (let i = 0; i < n; i++) costOre += toOre(rows[i].opts[choice[i]].cost)
    if (costOre > budgetOre) continue

    let score = 0
    for (let i = 0; i < n; i++) {
      score += toOre(rows[i].opts[choice[i]].net) * 1000 - toOre(rows[i].opts[choice[i]].cost)
    }
    // Strikt > behåller den TIDIGASTE kombinationen vid exakt lika (matchar Pythons brute_force).
    if (bestScore === null || score > bestScore) { bestScore = score; bestChoice = choice }
  }

  const chosen = {}
  rows.forEach((r, i) => { chosen[r.key] = bestChoice[i] })
  return buildResult(rows, chosen, econ)
}

function buildResult(rows, chosen, econ) {
  let totalNet = 0, totalCost = 0, totalGross = 0
  let unitsStandard = 0, unitsPremium = 0
  const out = rows.map((row) => {
    const t = chosen[row.key]
    const o = row.opts[t]
    const profitable = { standard: row.opts.standard.net, premium: row.opts.premium.net }
    const bestProfitableNet = Math.max(profitable.standard, profitable.premium)
    totalNet += o.net; totalCost += o.cost; totalGross += o.gross
    if (t === 'standard') unitsStandard += o.units
    if (t === 'premium') unitsPremium += o.units
    return {
      key: row.key,
      name: row.name,
      households: row.households,
      uplift_sek: round2(row.uplift),
      decision: t,
      units: o.units,
      cost_sek: round2(o.cost),
      gross_sek: round2(o.gross),
      net_sek: round2(o.net),
      roi: o.cost > 0 ? round3(o.net / o.cost) : null,
      reason: decisionReason(t, bestProfitableNet),
    }
  })

  const freeRides = econ.rideCost > 0 ? Math.floor(totalNet / econ.rideCost) : 0
  return {
    ok: true,
    solver: 'klient (uttömmande, speglar OR-Tools)',
    kpis: {
      net_profit_sek: round2(totalNet),
      gross_donations_sek: round2(totalGross),
      spend_sek: round2(totalCost),
      budget_sek: econ.budget,
      budget_utilization: econ.budget > 0 ? round4(totalCost / econ.budget) : null,
      units_standard: unitsStandard,
      units_premium: unitsPremium,
      units_total: unitsStandard + unitsPremium,
      free_rides_funded: freeRides,
      districts_premium: out.filter((p) => p.decision === 'premium').length,
      districts_standard: out.filter((p) => p.decision === 'standard').length,
      districts_skipped: out.filter((p) => p.decision === 'none').length,
    },
    districts: out,
  }
}

const round2 = (x) => Math.round(x * 100) / 100
const round3 = (x) => Math.round(x * 1000) / 1000
const round4 = (x) => Math.round(x * 10000) / 10000
