import type { Extra, ExtraItem, BuildContext, CabinetMaterial, QuantityMap, Preset } from '../types'

export const MATERIAL_LABELS: Record<CabinetMaterial, string> = {
  mild_steel: 'Mild steel (Zintec)',
  stainless: 'Stainless steel',
}

export const RATING_OPTIONS = [100, 125, 200, 400, 630]
export const SIZE_OPTIONS = [1, 2, 3]

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
}

export interface ExtrasResult {
  applied: AppliedExtra[]
  effectiveQty: QuantityMap   // final BOM quantities after extras
  delta: QuantityMap          // change made by extras per product (+/-)
  labourMinutes: number
}

// Apply the ticked extras, in number order, on top of the rep's BOM.
// Removals only take away what is actually there; an "only if removed" add is
// skipped when that extra's removals found nothing (so a swap never adds a part
// that wasn't replacing anything).
export function computeExtras(extras: Extra[], selected: Set<string>, ctx: BuildContext, baseQty: QuantityMap): ExtrasResult {
  const qty: QuantityMap = { ...baseQty }
  const applied: AppliedExtra[] = []
  let labourMinutes = 0

  const ticked = extras
    .filter((e) => selected.has(e.id) && extraUnavailableReason(e, ctx) == null)
    .sort((a, b) => a.number - b.number)

  ticked.forEach((extra) => {
    const items = (extra.extra_items ?? []).filter((i) => lineApplies(i, ctx)).sort((a, b) => a.sort_order - b.sort_order)
    const lines: ExtraLine[] = []
    let removedSomething = false

    items.filter((i) => i.action === 'remove').forEach((i) => {
      const have = qty[i.product_id] ?? 0
      const take = Math.min(have, i.quantity)
      if (take > 0) { qty[i.product_id] = have - take; removedSomething = true }
      lines.push({ product_id: i.product_id, action: 'remove', quantity: take, requested: i.quantity })
    })

    items.filter((i) => i.action === 'add').forEach((i) => {
      const add = i.only_if_removed && !removedSomething ? 0 : i.quantity
      if (add > 0) qty[i.product_id] = (qty[i.product_id] ?? 0) + add
      lines.push({ product_id: i.product_id, action: 'add', quantity: add, requested: i.quantity })
    })

    labourMinutes += Number(extra.labour_minutes) || 0
    applied.push({ extra, lines })
  })

  const delta: QuantityMap = {}
  const effectiveQty: QuantityMap = {}
  new Set([...Object.keys(baseQty), ...Object.keys(qty)]).forEach((id) => {
    const finalQty = qty[id] ?? 0
    const diff = finalQty - (baseQty[id] ?? 0)
    if (diff !== 0) delta[id] = diff
    if (finalQty > 0) effectiveQty[id] = finalQty
  })

  return { applied, effectiveQty, delta, labourMinutes }
}
