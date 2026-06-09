/**
 * Klientsidans spegel av OR-Tools-optimeraren i api_server/uplift.py (reference_allocation, som ger samma
 * optimum som den auktoritativa GLOP-LP-lösaren solve_allocation).
 *
 * Varför en spegel: de tunga ML-beroendena (econml + ortools) ligger MEDVETET utanför den slimmade Cloud
 * Run-imagen, så backend-endpointen svarar 503 i drift. För att sidan ska räkna om allokeringen direkt när
 * man drar i reglagen (utan nätverksrundtur) löser vi samma problem här. Det måste SKALA till 42 RegSO-
 * områden (en 3^N-uppräkning är omöjlig), så vi använder samma exakta O(N log N)-algoritm som backend.
 *
 * MODELL:
 *  - Effektiviteten per broschyrtyp HÄRLEDS ur dess styckkostnad via en responskurva med avtagande
 *    avkastning: resp(c) = M·(1 − e^(−c/τ)). Standard har därför ALLTID högre täthet (netto/kr) än Premium.
 *  - FRAKTIONELL täckning: varje område kan täckas helt eller delvis. Per område byggs ett KONKAVT
 *    (cost, net)-hölje: (0,0) -[Standard]-> (full Standard) -[uppgradering]-> (full Premium). Konkaviteten
 *    gör att en girig fyllning efter fallande täthet över ALLA områdens segment är exakt optimal (= LP:n).
 */

export const RESPONSE_CEILING = 2.2   // MÅSTE matcha api_server/uplift.py
export const RESPONSE_SCALE = 22.0

export function response(cost) {
  if (cost <= 0) return 0
  return RESPONSE_CEILING * (1 - Math.exp(-cost / RESPONSE_SCALE))
}

const KIND_ORDER = { std: 0, upgrade: 1, prem: 2 }

/**
 * Lös den fördelningsoptimala kampanjen (exakt, skalar till många områden).
 * @param districts [{key,name,households}] i SAMMA ordning som backendens DISTRICTS
 * @param uplift    {key: kr/hushåll}
 * @param econ      {budget, costStandard, costPremium}
 * @returns samma form som backendens solution-payload (kpis + districts)
 */
export function optimize(districts, uplift, econ) {
  const multS = response(econ.costStandard)
  const multP = response(econ.costPremium)
  const cS = econ.costStandard
  const cP = econ.costPremium

  const segments = []      // {density, cap, key, kind}
  const meta = {}          // key -> reconstruction state
  for (const d of districts) {
    const raw = uplift[d.key]
    const u = Number.isFinite(raw) && raw > 0 ? raw : 0   // robust mot trasig indata
    const nS = u * multS - cS
    const nP = u * multP - cP
    const hh = d.households
    const m = { hh, mode: null, std_cap: 0, std_take: 0, up_cap: 0, up_take: 0, prem_cap: 0, prem_take: 0 }
    const stdOk = nS > 0 && cS > 0
    const premOk = nP > 0 && cP > 0
    if (stdOk) {
      m.mode = 'std_base'
      m.std_cap = cS * hh
      segments.push({ density: nS / cS, cap: cS * hh, key: d.key, kind: 'std' })
      if (premOk && nP > nS && cP > cS) {
        m.up_cap = (cP - cS) * hh
        segments.push({ density: (nP - nS) / (cP - cS), cap: (cP - cS) * hh, key: d.key, kind: 'upgrade' })
      }
    } else if (premOk) {
      m.mode = 'prem_base'
      m.prem_cap = cP * hh
      segments.push({ density: nP / cP, cap: cP * hh, key: d.key, kind: 'prem' })
    }
    meta[d.key] = m
  }

  // Täthet fallande; tie-break: områdesnyckel (ASCII, samma ordning som Python), sedan segmenttyp.
  segments.sort((a, b) =>
    (b.density - a.density) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
    (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]),
  )

  let rem = econ.budget
  for (const s of segments) {
    if (rem <= 0) break
    const take = s.cap <= rem ? s.cap : rem
    rem -= take
    const m = meta[s.key]
    if (s.kind === 'std') m.std_take = take
    else if (s.kind === 'upgrade') m.up_take = take
    else m.prem_take = take
  }

  // Rekonstruera (täckning_standard, täckning_premium) per område.
  const alloc = {}
  for (const key in meta) {
    const m = meta[key]
    if (m.mode === 'std_base') {
      const mu = m.std_cap > 0 ? m.std_take / m.std_cap : 0
      const lam = m.up_cap > 0 ? m.up_take / m.up_cap : 0
      alloc[key] = [Math.max(0, mu - lam), lam]
    } else if (m.mode === 'prem_base') {
      const nu = m.prem_cap > 0 ? m.prem_take / m.prem_cap : 0
      alloc[key] = [0, nu]
    } else {
      alloc[key] = [0, 0]
    }
  }
  return buildResult(districts, uplift, econ, alloc, multS, multP)
}

function decisionReason(decision, coverage, bestNetFull, mixed) {
  const partial = coverage > 0 && coverage < 0.999
  let base
  if (decision === 'premium') {
    base = mixed
      ? 'Premium: lönar sig att uppgradera en del av området från Standard till Premium.'
      : 'Premium: den dyrare broschyren maximerar nettovinsten här.'
  } else if (decision === 'standard') {
    base = 'Standard: bäst nettovinst per krona här.'
  } else {
    if (bestNetFull <= 0) return 'Avstår: ett utskick skulle gå med förlust (lyftet täcker inte kostnaden).'
    return 'Avstår: budgeten räcker till högre nettovinst i andra områden.'
  }
  if (partial) return `${base} Budgeten räcker till ${Math.round(coverage * 100)}% täckning.`
  return base
}

function buildResult(districts, uplift, econ, alloc, multS, multP) {
  let totalNet = 0, totalCost = 0, totalGross = 0
  let unitsStandard = 0, unitsPremium = 0
  const out = districts.map((d) => {
    let [covS, covP] = alloc[d.key]
    covS = Math.max(0, Math.min(1, covS))
    covP = Math.max(0, Math.min(1 - covS, covP))
    const hh = d.households
    const raw = uplift[d.key]
    const u = Number.isFinite(raw) && raw > 0 ? raw : 0
    const stdHh = hh * covS
    const premHh = hh * covP
    const gross = stdHh * u * multS + premHh * u * multP
    const spend = stdHh * econ.costStandard + premHh * econ.costPremium
    const net = gross - spend
    const uStd = Math.round(stdHh)
    const uPrem = Math.round(premHh)
    const coverage = covS + covP
    let decision
    if (covP > covS) decision = 'premium'
    else if (covS > 1e-9) decision = 'standard'
    else decision = 'none'
    const mixed = covS > 1e-9 && covP > 1e-9
    const bestNetFull = Math.max(u * multS - econ.costStandard, u * multP - econ.costPremium)
    totalNet += net; totalCost += spend; totalGross += gross
    unitsStandard += uStd; unitsPremium += uPrem
    return {
      key: d.key,
      name: d.name,
      households: hh,
      uplift_sek: round2(u),
      decision,
      coverage: round4(coverage),
      units: uStd + uPrem,
      units_standard: uStd,
      units_premium: uPrem,
      cost_sek: round2(spend),
      gross_sek: round2(gross),
      net_sek: round2(net),
      roi: spend > 0 ? round3(net / spend) : null,
      reason: decisionReason(decision, coverage, bestNetFull, mixed),
    }
  })

  const householdsTotal = districts.reduce((s, d) => s + d.households, 0)
  const householdsReached = unitsStandard + unitsPremium
  return {
    ok: true,
    solver: 'klient (konkavt hölje, fraktionell knapsack, speglar OR-Tools)',
    kpis: {
      net_profit_sek: round2(totalNet),
      gross_donations_sek: round2(totalGross),
      spend_sek: round2(totalCost),
      budget_sek: econ.budget,
      budget_utilization: econ.budget > 0 ? round4(totalCost / econ.budget) : null,
      units_standard: unitsStandard,
      units_premium: unitsPremium,
      units_total: householdsReached,
      households_total: householdsTotal,
      households_reached: householdsReached,
      reach: householdsTotal > 0 ? round4(householdsReached / householdsTotal) : 0,
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
