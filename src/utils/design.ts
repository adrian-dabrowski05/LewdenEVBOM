import type { Product, QuantityMap, TopterDesign, DesignBox } from '../types'
import { readCapacity } from './capacity'

// ── TopTer box designer ───────────────────────────────────────
// The designer lays boxes out in rows. Boxes next to each other in a row are
// side by side; each one says whether it is joined to the box on its left.
// Joined boxes make one assembly and need the joining parts below for every joint.
// Everything placed (boxes, the parts inside them, joining parts) is added to
// the quote, so the simple list, step builder, capacity check and totals all see it.

// Joining parts for each joint between two boxes. Palazzoli catalogue 2023-2024,
// p.85 "Use of accessories". Adrian (2026-11-05): one pair of stainless steel
// plates and two Pg21 coupling fittings per joint.
export const JOIN_PARTS: { partNumber: string; perJoint: number; label: string }[] = [
  { partNumber: 'P579012', perJoint: 1, label: 'Pair of stainless steel joining plates' },
  { partNumber: 'P580250', perJoint: 2, label: 'Pg21 coupling fittings' },
]

export const EMPTY_DESIGN: TopterDesign = { rows: [] }

let counter = 0
export const newUid = () => `d${Date.now().toString(36)}${(counter++).toString(36)}`

// A box is anything in Enclosures that is a box in its own right (not a cover
// that goes onto a board)
export function isBox(p: Product): boolean {
  return p.category === 'Enclosures' && !/^cover\b/i.test(p.description)
}

// Every box can be joined except the 63A switched (interlock) boxes (Adrian, 2026-11-05):
// the 63A series boards and the 63A interlocked bottom boxes
export const is63aInterlockBox = (p: Product) => /63A series|63A interlocked socket|\b1 63A socket/i.test(p.description)
export function isJoinable(p: Product | undefined): boolean {
  return !!p && isBox(p) && !is63aInterlockBox(p)
}

// Read an old or odd saved design safely
export function readDesign(raw: unknown): TopterDesign {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as TopterDesign).rows)) return EMPTY_DESIGN
  const rows = (raw as TopterDesign).rows
    .filter((r) => r && Array.isArray(r.boxes))
    .map((r) => ({
      id: String(r.id ?? newUid()),
      boxes: r.boxes
        .filter((b) => b && typeof b.productId === 'string')
        .map((b, i) => ({
          uid: String(b.uid ?? newUid()),
          productId: b.productId,
          joinedLeft: i > 0 && !!b.joinedLeft,
          items: Array.isArray(b.items)
            ? b.items.filter((it) => it && typeof it.productId === 'string' && Number(it.qty) > 0).map((it) => ({ uid: String(it.uid ?? newUid()), productId: it.productId, qty: Number(it.qty) }))
            : [],
        })),
    }))
    .filter((r) => r.boxes.length > 0)
  return { rows }
}

export function jointCount(design: TopterDesign): number {
  return design.rows.reduce((n, r) => n + r.boxes.filter((b, i) => i > 0 && b.joinedLeft).length, 0)
}

// What the design puts on the quote, by product id
export function designCounts(design: TopterDesign, products: Product[]): QuantityMap {
  const out: QuantityMap = {}
  const add = (id: string, n: number) => { if (n > 0) out[id] = Math.round(((out[id] ?? 0) + n) * 100) / 100 }
  design.rows.forEach((r) => r.boxes.forEach((b) => {
    add(b.productId, 1)
    b.items.forEach((it) => add(it.productId, it.qty))
  }))
  const joints = jointCount(design)
  if (joints > 0) {
    JOIN_PARTS.forEach((jp) => {
      const p = products.find((x) => (x.part_number ?? '').toUpperCase() === jp.partNumber)
      if (p) add(p.id, jp.perJoint * joints)
    })
  }
  return out
}

// The joining parts that are missing from the catalogue (so can't be added)
export function missingJoinParts(products: Product[]): string[] {
  return JOIN_PARTS.filter((jp) => !products.some((x) => (x.part_number ?? '').toUpperCase() === jp.partNumber)).map((jp) => jp.partNumber)
}

// Boxes joined together, as runs of boxes within each row
export function assemblies(design: TopterDesign): DesignBox[][] {
  const out: DesignBox[][] = []
  design.rows.forEach((r) => r.boxes.forEach((b, i) => {
    if (i > 0 && b.joinedLeft) out[out.length - 1].push(b)
    else out.push([b])
  }))
  return out
}

// ── Drawing sizes ─────────────────────────────────────────────
// Width and height of a box in mm, read from its notes ("239x456mm") or, for the
// fixed-socket boards that give none, from the board's size class (wattage).
const WATT_SIZE: Record<string, [number, number]> = {
  '20': [122, 158], '22': [122, 395], '40': [239, 456], '56': [350, 456], '70': [461, 456],
}

export function boxSizeMm(p: Product): [number, number] {
  const m = `${p.notes ?? ''} ${p.description}`.match(/(\d{2,3})\s*x\s*(\d{2,3})\s*mm/i)
  if (m) return [Number(m[1]), Number(m[2])]
  const w = (p.notes ?? '').match(/\b(\d{2})W\b/)
  if (w && WATT_SIZE[w[1]]) return WATT_SIZE[w[1]]
  return [160, 260]
}

// Slots that hold a socket, a flange or a cap (drawn as tiles). DIN modules are drawn as a rail.
const TILE_KEYS = ['sockets', 'switched', 'seat115', 'int50'] as const
const tileSum = (m: Record<string, number> | undefined) => TILE_KEYS.reduce((n, k) => n + (m?.[k] ?? 0), 0)

// Tiles and DIN modules a box offers, counting what its parts add (a flange in a
// switched seat gives room for its sockets, a cover adds a DIN rail)
export function boxLayout(p: Product, items: { product: Product; qty: number }[]): { tiles: number; din: number } {
  const own = readCapacity(p.capacity).provides
  let tiles = tileSum(own)
  let din = own?.din ?? 0
  items.forEach(({ product, qty }) => {
    const prov = readCapacity(product.capacity).provides
    tiles += tileSum(prov) * qty
    din += (prov?.din ?? 0) * qty
  })
  return { tiles, din }
}

// How many tiles / DIN modules one of this part takes
export function tilesUsed(p: Product): number { return tileSum(readCapacity(p.capacity).uses) }
export function dinUsed(p: Product): number { return readCapacity(p.capacity).uses?.din ?? 0 }

// Does a part sit in a socket tile or on the DIN rail?
export function placeOf(p: Product): 'tile' | 'din' | 'other' {
  if (dinUsed(p) > 0) return 'din'
  if (tilesUsed(p) > 0) return 'tile'
  return 'other'
}
