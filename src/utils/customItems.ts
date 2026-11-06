import type { CustomItem } from '../types'

// ── One-off items (not in the catalogue) ─────────────────────
// The rep types these in on the Review & save step. Each one is a line on the
// bill of materials: its cost goes in the materials subtotal (so it gets the
// hardware uplift, like any part), it is printed with the parts, and it is saved
// as a quote line with no product. A line only counts once it has a description
// or a part number.

export interface CustomLine {
  id: string
  description: string
  part_number: string | null
  factory_cost: number
  quantity: number
  line_total: number
}

export function newCustomItem(): CustomItem {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(36).slice(2, 8)}`
  return { id, description: '', part_number: '', cost: '', quantity: '1' }
}

// The lines that go on the quote (blank rows are left out)
export function customLines(items: CustomItem[] | null | undefined): CustomLine[] {
  return (items ?? []).flatMap((item) => {
    const description = (item.description ?? '').trim()
    const partNumber = (item.part_number ?? '').trim()
    if (!description && !partNumber) return []
    const cost = Math.max(0, parseFloat(item.cost) || 0)
    const q = parseFloat(item.quantity)
    const quantity = isNaN(q) ? 1 : Math.max(0, q)
    if (quantity <= 0) return []
    return [{
      id: item.id,
      description: description || partNumber,
      part_number: partNumber || null,
      factory_cost: cost,
      quantity,
      line_total: cost * quantity,
    }]
  })
}

export function customLinesTotal(lines: CustomLine[]): number {
  return lines.reduce((sum, l) => sum + l.line_total, 0)
}

// Rows from a saved quote, tidied up in case anything is missing
export function readCustomItems(items: unknown): CustomItem[] {
  if (!Array.isArray(items)) return []
  return items.map((i) => ({
    id: String(i?.id ?? newCustomItem().id),
    description: String(i?.description ?? ''),
    part_number: String(i?.part_number ?? ''),
    cost: i?.cost == null ? '' : String(i.cost),
    quantity: i?.quantity == null ? '1' : String(i.quantity),
  }))
}
