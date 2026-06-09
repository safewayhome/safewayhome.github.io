/**
 * Klientsidans spegel av OR-Tools-optimeraren i api_server/uplift.py (reference_allocation, som i sin tur
 * är byte-exakt lika med den auktoritativa pywraplp-MILP-lösaren solve_allocation).
 *
 * Varför en spegel: de tunga ML-beroendena (econml + ortools) ligger MEDVETET utanför den slimmade
 * Cloud Run-imagen, så backend-endpointen svarar 503 i drift. För att sidan ska räkna om allokeringen
 * direkt när man drar i reglagen (utan nätverksrundtur) löser vi samma problem här.
 *
 * MODELL:
 *  - Effektiviteten per broschyrtyp HÄRLEDS ur dess styckkostnad via en responskurva med avtagande
 *    avkastning: resp(c) = M·(1 − e^(−c/τ)). En gratis broschyr övertygar ingen, en dyrare övertygar mer
 *    men varje extra krona ger mindre. Därför finns ett INRE optimalt pris: att sänka styckkostnaden gör
 *    inte automatiskt kampanjen mer lönsam.
 *  - FRAKTIONELL täckning: varje stadsdel kan täckas helt eller delvis (en andel av hushållen), högst en
 *    typ per stadsdel. Då gör även små budgetar något (en bråkdel av det bästa området).
 *
 * ALGORITM (exakt, speglar reference_allocation): uttömmande över de 3^7 valen av typ per stadsdel; för
 * varje fast tilldelning är stadsdelarna delbara poster med konstant netto/kostnad per hushåll, så optimal
 * täckning under budget ges av en fraktionell knapsack (girigt efter täthet = netto/kr). Bästa över alla
 * tilldelningar = globalt optimum. Samma flyttalsmatematik som Python -> identiska beslut och siffror.
 */

export const TREATMENTS = ['none', 'standard', 'premium']

// Responskurvans konstanter MÅSTE matcha api_server/uplift.py (RESPONSE_CEILING / RESPONSE_SCALE).
const RESPONSE_CEILING = 2.2
const RESPONSE_SCALE = 22.0

export function response(cost) {
  if (cost <= 0) return 0
  return RESPONSE_CEILING * (1 - Math.exp(-cost / RESPONSE_SCALE))
}

/** Per stadsdel och typ: netto/hushåll, kostnad/hushåll, effektivitet. */
function perHousehold(districts, uplift, econ) {
  const multS = response(econ.costStandard)
  const multP = response(econ.costPremium)
  const per = {}
  for (const d of districts) {
    // Robust mot trasig indata: ett icke-ändligt eller negativt lyft behandlas som 0.
    const raw = uplift[d.key]
    const u = Number.isFinite(raw) && raw > 0 ? raw : 0
    per[d.key] = {
      standard: { net: u * multS - econ.costStandard, cost: econ.costStandard, mult: multS },
      premium: { net: u * multP - econ.costPremium, cost: econ.costPremium, mult: multP },
    }
  }
  return per
}

function decisionReason(decision, coverage, bestNetFull) {
  const partial = coverage > 0 && coverage < 0.999
  let base
  if (decision === 'premium') base = 'Premium: den dyrare broschyren maximerar nettovinsten här.'
  else if (decision === 'standard') base = 'Standard: bäst nettovinst per krona här.'
  else {
    if (bestNetFull <= 0) return 'Avstår: ett utskick skulle gå med förlust (lyftet täcker inte kostnaden).'
    return 'Avstår: budgeten räcker till högre nettovinst i andra områden.'
  }
  if (partial) return `${base} Budgeten räcker till ${Math.round(coverage * 100)}% täckning.`
  return base
}

/**
 * Lös den fördelningsoptimala kampanjen (exakt: uttömmande typval + fraktionell knapsack).
 * @param districts [{key,name,households}] i SAMMA ordning som backendens DISTRICTS
 * @param uplift    {key: kr/hushåll}
 * @param econ      {budget, costStandard, costPremium, rideCost}
 * @returns samma form som backendens solution-payload (kpis + districts, med coverage/effectiveness)
 */
export function optimize(districts, uplift, econ) {
  const per = perHousehold(districts, uplift, econ)
  const n = districts.length
  let bestNet = null
  let bestAlloc = null
  const total = 3 ** n
  for (let combo = 0; combo < total; combo++) {
    const assign = new Array(n)
    let c = combo
    for (let i = 0; i < n; i++) { assign[i] = TREATMENTS[c % 3]; c = Math.floor(c / 3) }

    const items = []   // [täthet, netto/hh, kostnad/hh, hushåll, index, typ]: bara positivt netto/hushåll
    for (let i = 0; i < n; i++) {
      const t = assign[i]
      if (t === 'none') continue
      const o = per[districts[i].key][t]
      if (o.net > 0 && o.cost > 0) items.push([o.net / o.cost, o.net, o.cost, districts[i].households, i, t])
    }
    items.sort((a, b) => (b[0] - a[0]) || (a[4] - b[4]))   // täthet fallande, tie-break: stadsdelsindex

    let rem = econ.budget
    let net = 0
    const alloc = {}
    for (const d of districts) alloc[d.key] = ['none', 0]
    for (const [, nph, cph, hh, i, t] of items) {
      if (rem <= 0) break
      const full = cph * hh
      if (full <= rem) { net += nph * hh; rem -= full; alloc[districts[i].key] = [t, 1] }
      else { const f = rem / full; net += nph * hh * f; alloc[districts[i].key] = [t, f]; rem = 0; break }
    }
    if (bestNet === null || net > bestNet + 1e-9) { bestNet = net; bestAlloc = alloc }   // tidigaste vinner vid lika
  }
  return buildResult(districts, uplift, econ, bestAlloc)
}

function buildResult(districts, uplift, econ, alloc) {
  const per = perHousehold(districts, uplift, econ)
  const multS = response(econ.costStandard)
  const multP = response(econ.costPremium)
  let totalNet = 0, totalCost = 0, totalGross = 0
  let unitsStandard = 0, unitsPremium = 0
  const out = districts.map((d) => {
    let [t, cov] = alloc[d.key]
    cov = Math.max(0, Math.min(1, cov))
    const hh = d.households
    const raw = uplift[d.key]
    const u = Number.isFinite(raw) && raw > 0 ? raw : 0
    let mult = 0, cost = 0
    if (t === 'standard') { mult = multS; cost = econ.costStandard }
    else if (t === 'premium') { mult = multP; cost = econ.costPremium }
    else { cov = 0 }
    const covered = hh * cov
    const gross = covered * u * mult
    const spend = covered * cost
    const net = gross - spend
    const units = Math.round(covered)
    const decision = cov > 1e-9 ? t : 'none'
    const bestNetFull = Math.max(per[d.key].standard.net, per[d.key].premium.net)
    totalNet += net; totalCost += spend; totalGross += gross
    if (decision === 'standard') unitsStandard += units
    if (decision === 'premium') unitsPremium += units
    return {
      key: d.key,
      name: d.name,
      households: hh,
      uplift_sek: round2(u),
      decision,
      coverage: round4(cov),
      effectiveness: round3(mult),
      units,
      cost_sek: round2(spend),
      gross_sek: round2(gross),
      net_sek: round2(net),
      roi: spend > 0 ? round3(net / spend) : null,
      reason: decisionReason(decision, cov, bestNetFull),
    }
  })

  const freeRides = econ.rideCost > 0 ? Math.floor(totalNet / econ.rideCost) : 0
  return {
    ok: true,
    solver: 'klient (uttömmande + fraktionell knapsack, speglar OR-Tools)',
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
      districts_partial: out.filter((p) => p.coverage > 0 && p.coverage < 0.999).length,
      districts_skipped: out.filter((p) => p.decision === 'none').length,
    },
    districts: out,
  }
}

const round2 = (x) => Math.round(x * 100) / 100
const round3 = (x) => Math.round(x * 1000) / 1000
const round4 = (x) => Math.round(x * 10000) / 10000
