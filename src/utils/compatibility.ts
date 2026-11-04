import type { ProductIncompatibility, QuantityMap } from '../types'

// Each part -> the parts it can't go on a quote with. Built both ways, so a rule
// set on either part greys out the other.
export type IncompatMap = Record<string, Set<string>>

export function buildIncompatMap(rows: ProductIncompatibility[]): IncompatMap {
  const map: IncompatMap = {}
  const add = (a: string, b: string) => { (map[a] ??= new Set()).add(b) }
  rows.forEach((r) => {
    if (r.product_id === r.incompatible_product_id) return
    add(r.product_id, r.incompatible_product_id)
    add(r.incompatible_product_id, r.product_id)
  })
  return map
}

// Parts on the quote that clash with this part (empty = fine)
export function clashesFor(productId: string, map: IncompatMap, qty: QuantityMap): string[] {
  const set = map[productId]
  if (!set) return []
  return [...set].filter((id) => id !== productId && (qty[id] ?? 0) > 0)
}

// The pair as it is stored: smaller id first, so a pair is only saved once
export function pairKey(a: string, b: string): { product_id: string; incompatible_product_id: string } {
  return a < b ? { product_id: a, incompatible_product_id: b } : { product_id: b, incompatible_product_id: a }
}

// Every incompatible pair that is on the quote together, each pair once
export function clashingPairs(map: IncompatMap, qty: QuantityMap): [string, string][] {
  const out: [string, string][] = []
  Object.keys(map).forEach((a) => {
    if ((qty[a] ?? 0) <= 0) return
    map[a].forEach((b) => { if (a < b && (qty[b] ?? 0) > 0) out.push([a, b]) })
  })
  return out
}
