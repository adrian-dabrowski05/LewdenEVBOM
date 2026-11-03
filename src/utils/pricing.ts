// ── Sell price from factory cost ─────────────────────────────
// Factory cost = materials + hardware uplift + labour + rep-priced extras.
// Carriage is NOT in the factory cost: gross profit and rebate never touch it.
// It is added at face value after the rebate.
// In the database, quotes.grand_total still holds factory cost + carriage (as it always has),
// so old quotes read the same way: factory cost = grand_total - carriage.
//
// Gross profit % is read as MARGIN: the profit is that % of the quote price.
//   quote price = factory cost / (1 - GP% / 100)
//   e.g. £1,000 factory cost at 25% GP = £1,333.33 quote price (£333.33 profit)
// If you want MARKUP instead (profit is that % of factory cost, so 25% on £1,000 = £1,250),
// set GP_MODE below to 'markup'. Nothing else needs changing.
//
// Rebate % comes off the quote price:
//   total quote = quote price - (quote price × rebate% / 100) + carriage

export const GP_MODE: 'margin' | 'markup' = 'margin'

export interface QuotePricing {
  factoryCost: number
  gpPct: number
  grossProfit: number
  quotePrice: number
  rebatePct: number
  rebateAmount: number
  carriage: number
  totalQuote: number
}

// Read a % box: blank or invalid = 0, clamped to a sensible range
export function parsePct(value: string | number | null | undefined, max = 100): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  if (!isFinite(n) || n < 0) return 0
  return Math.min(n, max)
}

// Margin can't reach 100% (the price would be infinite)
export const MAX_GP_PCT = GP_MODE === 'margin' ? 99.9 : 1000

export function quotePricing(factoryCost: number, gpPctIn: number | string | null | undefined, rebatePctIn: number | string | null | undefined, carriageIn: number | null | undefined = 0): QuotePricing {
  const carriage = Math.max(0, Number(carriageIn) || 0)
  const gpPct = parsePct(gpPctIn, MAX_GP_PCT)
  const rebatePct = parsePct(rebatePctIn, 100)
  const quotePrice = GP_MODE === 'margin'
    ? factoryCost / (1 - gpPct / 100)
    : factoryCost * (1 + gpPct / 100)
  const grossProfit = quotePrice - factoryCost
  const rebateAmount = quotePrice * rebatePct / 100
  const totalQuote = quotePrice - rebateAmount + carriage
  return { factoryCost, gpPct, grossProfit, quotePrice, rebatePct, rebateAmount, carriage, totalQuote }
}

// Pricing for a saved quote (grand_total in the database includes carriage)
export function savedQuotePricing(q: { grand_total: number | null; carriage?: number | null; gross_profit_pct?: number | null; rebate_pct?: number | null }): QuotePricing {
  const carriage = Math.max(0, Number(q.carriage) || 0)
  const factoryCost = (Number(q.grand_total) || 0) - carriage
  return quotePricing(factoryCost, q.gross_profit_pct, q.rebate_pct, carriage)
}

// Keeps a % box within range while typing; returns false to reject the keystroke
export function pctInputOk(value: string, max: number): boolean {
  if (value.trim() === '') return true
  const n = parseFloat(value)
  return isNaN(n) || (n >= 0 && n <= max)
}
