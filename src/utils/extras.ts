import type { Extra, ExtraItem, BuildContext, CabinetMaterial, QuantityMap, Preset, Product, ExtraCountMap, ExtraCostMap, QuoteExtra } from '../types'
import type { CustomLine } from './customItems'

export const MATERIAL_LABELS: Record<CabinetMaterial, string> = {
  mild_steel: 'Mild steel (Zintec)',
  stainless: 'Stainless steel',
}

export const RATING_OPTIONS = [100, 125, 200, 400, 630]
export const SIZE_OPTIONS = [1, 2, 3, 4]

export const EMPTY_CONTEXT: BuildContext = { rating: null, material: null, size: null }

// EV10 → 100A, EV12 → 125A, EV20 → 200A, EV40 → 400A, EV63 → 630A
const RATING_BY_CODE: Record<string, number> = { '10': 100, '12': 125, '20': 200, '40': 400, '63': 630 }
const SIZE_BY_LETTER: Record<string, number> = { A: 1, B: 2, C: 3 }

// Read current rating + cabinet size from the preset name (e.g. "EV10A") and the
// cabinet material from the configuration suffix (ZD/ZM = Zintec, SD/SM = Stainless)
export function contextFromPreset(preset: Preset, configurationId?: string): BuildContext {
  const match = preset.name.match(/EV(\d{2})([A-C])?/i)
  const rating = match ? RATING_BY_CODE[match[1]] ?? null : null
  const size = match?.[2] ? SIZE_BY_LETTER[match[2].toUpperCase()] ?? null : null

  const config = configurationId ? preset.preset_configurations?.find((c) => c.id === configurationId) : null
  const code = (config?.part_number_suffix || config?.label || '').trim().toUpperCase()
  const material: CabinetMaterial | null = code.startsWith('Z') ? 'mild_steel' : code.startsWith('S') ? 'stainless' : null

  return { rating, material, size }
}

// ── Read the pillar from a steelwork part ──────────────────────
// Looks for the cabinet size ("Size 2"), the material ("Mild steel", "Zintec",
// "Stainless") and the current rating ("100A", "EV12") in a piece of text.
// Anything it can't find is left out, so it never clears what is already set.
export function contextFromText(text: string): Partial<BuildContext> {
  const out: Partial<BuildContext> = {}
  const size = text.match(/\bsize\s*-?\s*(\d)\b/i)
  if (size && SIZE_OPTIONS.includes(Number(size[1]))) out.size = Number(size[1])
  if (/stainless|\bs\/?s\b/i.test(text)) out.material = 'stainless'
  else if (/mild\s*steel|zintec|\bm\/?s\b/i.test(text)) out.material = 'mild_steel'
  const amps = text.match(/\b(100|125|200|400|630)\s*a(mps?)?\b/i)
  const code = text.match(/\bEV(10|12|20|40|63)(?![0-9])/i)
  if (amps) out.rating = Number(amps[1])
  else if (code) out.rating = RATING_BY_CODE[code[1]]
  return out
}

// What a steelwork part says about the pillar. The description, part number and
// chosen variant come first; the notes are only used for anything they don't say
// (notes often mention other parts, e.g. "fits the size 1 internals").
export function contextFromSteelwork(product: Product, variantLabel?: string | null): Partial<BuildContext> {
  if (product.category !== 'Steelworks') return {}
  const main = contextFromText([product.description, product.part_number, variantLabel].filter(Boolean).join(' '))
  const fromNotes = product.notes ? contextFromText(product.notes) : {}
  return { ...fromNotes, ...main }
}

// Fill in the fields a steelwork part gave, keep the rest as they are
export function mergeContext(ctx: BuildContext, found: Partial<BuildContext>): BuildContext {
  const next = { ...ctx }
  if (found.rating != null) next.rating = found.rating
  if (found.material != null) next.material = found.material
  if (found.size != null) next.size = found.size
  return next
}

// Why an extra can't be ticked for this build, or null if it can
export function extraUnavailableReason(extra: Extra, ctx: BuildContext): string | null {
  if (!extra.is_enabled) return 'Not available yet'
  const ratings = extra.allowed_ratings ?? []
  if (ratings.length > 0) {
    if (ctx.rating == null) return `Set the current rating (${ratings.map((r) => `${r}A`).join(' / ')} only)`
    if (!ratings.includes(ctx.rating)) return `Only for ${ratings.map((r) => `${r}A`).join(' / ')}`
  }
  const materials = extra.allowed_materials ?? []
  if (materials.length > 0) {
    const names = materials.map((m) => MATERIAL_LABELS[m] ?? m).join(' / ')
    if (ctx.material == null) return `Set the cabinet (${names} only)`
    if (!materials.includes(ctx.material)) return `Only for ${names} cabinets`
  }
  const sizes = Array.from(new Set((extra.extra_items ?? []).map((i) => i.condition_size).filter((s): s is number => s != null)))
  if (sizes.length > 0) {
    if (ctx.size == null) return 'Set the cabinet size'
    if (!sizes.includes(ctx.size)) return `No price for a size ${ctx.size} cabinet`
  }
  return null
}

function lineApplies(item: ExtraItem, ctx: BuildContext) {
  if (item.condition_rating != null && item.condition_rating !== ctx.rating) return false
  if (item.condition_size != null && item.condition_size !== ctx.size) return false
  return true
}

export interface ExtraLine {
  product_id: string
  action: 'add' | 'remove'
  quantity: number        // quantity actually added/removed
  requested: number       // quantity the extra asked for
}

export interface AppliedExtra {
  extra: Extra
  lines: ExtraLine[]
  count: number             // times applied (always 1 unless the extra scales with the BOM)
  maxCount: number | null   // most it could be applied, null = no limit
  cost: number              // rep-entered cost (rep-priced extras), 0 otherwise
}

export interface ExtrasResult {
  applied: AppliedExtra[]
  effectiveQty: QuantityMap   // final BOM quantities after extras
  delta: QuantityMap          // change made by extras per product (+/-)
  labourMinutes: number
  repCost: number             // rep-entered extra costs added at face value (no uplift, no labour)
  repHardwareCost: number     // rep-entered costs that count as hardware (in materials, so they get the uplift):
                              // hardware extras plus the rep's one-off items (App adds those, see customLines)
  customLines: CustomLine[]   // the rep's one-off items (not in the catalogue), filled in by App
}

// Turn a typed £ amount into a number (blank, bad or negative = 0)
export function parseCost(value: string | undefined): number {
  const n = parseFloat(value ?? '')
  return isNaN(n) ? 0 : Math.max(0, n)
}

// What is saved on the quote (and printed) for each applied extra
export function toQuoteExtras(applied: AppliedExtra[]): QuoteExtra[] {
  return applied.map(({ extra, count, cost }) => ({
    number: extra.number,
    name: extra.name,
    labour_minutes: Number(extra.labour_minutes) || 0,
    ...(extra.scales_with_bom ? { count } : {}),
    ...(extra.rep_priced ? { cost } : {}),
    ...(extra.rep_priced && extra.rep_cost_uplift ? { cost_in_materials: true } : {}),
  }))
}

// Apply the ticked extras, in number order, on top of the rep's BOM.
// Removals only take away what is actually there; an "only if removed" add is
// skipped when that extra's removals found nothing (so a swap never adds a part
// that wasn't replacing anything).
// An extra that scales with the BOM applies its lines `count` times. By default
// that is as many times as its Remove lines can be met (e.g. every Type A RCD
// in the BOM); the rep can lower it with the stepper in the Extras panel.
// A rep-priced extra (e.g. non-standard colour) carries the cost the rep typed in;
// that cost is added to the quote at face value, with no uplift and no labour, unless
// the extra is set to count it as hardware (rep_cost_uplift): then it goes in with the
// materials and gets the hardware uplift.
export function computeExtras(extras: Extra[], selected: Set<string>, ctx: BuildContext, baseQty: QuantityMap, counts: ExtraCountMap = {}, costs: ExtraCostMap = {}): ExtrasResult {
  const qty: QuantityMap = { ...baseQty }
  const applied: AppliedExtra[] = []
  let labourMinutes = 0
  let repCost = 0
  let repHardwareCost = 0

  const ticked = extras
    .filter((e) => selected.has(e.id) && extraUnavailableReason(e, ctx) == null)
    .sort((a, b) => a.number - b.number)

  ticked.forEach((extra) => {
    const items = (extra.extra_items ?? []).filter((i) => lineApplies(i, ctx)).sort((a, b) => a.sort_order - b.sort_order)
    const lines: ExtraLine[] = []
    let removedSomething = false
    const removedIds = new Set<string>()

    let count = 1
    let maxCount: number | null = null
    if (extra.scales_with_bom) {
      const removes = items.filter((i) => i.action === 'remove')
      if (removes.length > 0) maxCount = Math.min(...removes.map((i) => Math.floor((qty[i.product_id] ?? 0) / i.quantity)))
      const wanted = counts[extra.id] ?? maxCount ?? 1
      count = Math.max(0, maxCount != null ? Math.min(wanted, maxCount) : wanted)
    }

    items.filter((i) => i.action === 'remove').forEach((i) => {
      const have = qty[i.product_id] ?? 0
      const take = Math.min(have, i.quantity * count)
      if (take > 0) { qty[i.product_id] = have - take; removedSomething = true; removedIds.add(i.product_id) }
      lines.push({ product_id: i.product_id, action: 'remove', quantity: take, requested: i.quantity * count })
    })

    items.filter((i) => i.action === 'add').forEach((i) => {
      const skip = i.if_removed_product_id ? !removedIds.has(i.if_removed_product_id) : i.only_if_removed && !removedSomething
      const add = skip ? 0 : i.quantity * count
      if (add > 0) qty[i.product_id] = (qty[i.product_id] ?? 0) + add
      lines.push({ product_id: i.product_id, action: 'add', quantity: add, requested: i.quantity * count })
    })

    labourMinutes += Number(extra.labour_minutes) || 0
    const cost = extra.rep_priced ? parseCost(costs[extra.id]) : 0
    if (extra.rep_cost_uplift) repHardwareCost += cost
    else repCost += cost
    applied.push({ extra, lines, count, maxCount, cost })
  })

  const delta: QuantityMap = {}
  const effectiveQty: QuantityMap = {}
  new Set([...Object.keys(baseQty), ...Object.keys(qty)]).forEach((id) => {
    const finalQty = qty[id] ?? 0
    const diff = finalQty - (baseQty[id] ?? 0)
    if (diff !== 0) delta[id] = diff
    if (finalQty > 0) effectiveQty[id] = finalQty
  })

  return { applied, effectiveQty, delta, labourMinutes, repCost, repHardwareCost, customLines: [] }
}
