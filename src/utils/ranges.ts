import type { Product } from '../types'

// ── Ranges (TopTer) ───────────────────────────────────────────
// Parts that are variants of one product (the same socket in 18 currents,
// voltages and pole counts, say) share products.range_name. The builders show
// one card per range with the variants listed underneath, instead of one card
// per part. Each part keeps its own part number, cost, capacity and picture.

export type PartBlock =
  | { kind: 'part'; part: Product }
  | { kind: 'range'; key: string; name: string; parts: Product[]; total: number }

export const rangeKey = (p: Product): string | null => {
  const name = p.range_name?.trim()
  return name ? name.toLowerCase() : null
}

// How many parts each range has in the whole section (not just the ones shown)
export function rangeSizes(all: Product[]): Record<string, number> {
  const sizes: Record<string, number> = {}
  all.forEach((p) => { const k = rangeKey(p); if (k) sizes[k] = (sizes[k] ?? 0) + 1 })
  return sizes
}

// Turns a list of parts into cards: a range card where the first of its parts
// would have been, and single parts as they are. A range of one part is shown
// as a single part.
export function partBlocks(items: Product[], sizes: Record<string, number>): PartBlock[] {
  const blocks: PartBlock[] = []
  const byKey: Record<string, Extract<PartBlock, { kind: 'range' }>> = {}
  items.forEach((p) => {
    const k = rangeKey(p)
    if (!k || (sizes[k] ?? 0) < 2) { blocks.push({ kind: 'part', part: p }); return }
    if (!byKey[k]) {
      byKey[k] = { kind: 'range', key: k, name: p.range_name!.trim(), parts: [], total: sizes[k] }
      blocks.push(byKey[k])
    }
    byKey[k].parts.push(p)
  })
  return blocks
}

export const optionLabel = (p: Product): string => p.option_label?.trim() || p.description

// ── Voltage colour of CEE (IEC 60309) sockets ─────────────────
export interface VoltageColour { colour: string; name: string; volts: string }

const VIOLET: VoltageColour = { colour: '#7C3AED', name: 'Violet', volts: '20-25V' }
const WHITE: VoltageColour = { colour: '#FFFFFF', name: 'White', volts: '40-50V' }
const YELLOW: VoltageColour = { colour: '#F5C400', name: 'Yellow', volts: '100-130V' }
const BLUE: VoltageColour = { colour: '#1F5FD1', name: 'Blue', volts: '200-250V' }
const RED: VoltageColour = { colour: '#D92D20', name: 'Red', volts: '380-480V' }
const BLACK: VoltageColour = { colour: '#1A1A1A', name: 'Black', volts: '500-690V' }

export function voltageColour(p: Product): VoltageColour | null {
  if (p.category !== 'Fixed sockets' && p.category !== 'Interlocked sockets') return null
  const d = p.description
  if (/SELV|\/24V\b/i.test(d)) return VIOLET
  const m = d.match(/\b(\d{2,3})(?:\/\d{2,3})?V\b/)
  if (!m) return null
  const v = Number(m[1])
  if (v <= 25) return VIOLET
  if (v <= 50) return WHITE
  if (v >= 100 && v <= 130) return YELLOW
  if (v >= 200 && v <= 250) return BLUE
  if (v >= 380 && v <= 480) return RED
  if (v >= 500 && v <= 690) return BLACK
  return null
}
