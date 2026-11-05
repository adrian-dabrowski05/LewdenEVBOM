import type { Product, QuantityMap, TopterDesign, DesignBox, DesignItem } from '../types'
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
            ? b.items.filter((it) => it && typeof it.productId === 'string' && Number(it.qty) > 0).map((it) => ({ uid: String(it.uid ?? newUid()), productId: it.productId, qty: Number(it.qty), seat: typeof it.seat === 'string' ? it.seat : null }))
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

// ── What sits on what (Palazzoli catalogue 2023-2024 pp. 44-47, 82-87) ──
// A box offers seats. A part goes in a seat it fits, and some parts (flanges,
// caps, adapters, window covers) offer seats of their own:
//   • socket positions (65x83 / 88x100) on fixed-socket boards and back boxes:
//     16A/32A fixed sockets, closing flanges, the 50x50 flange P579848, the ELV
//     flange P579849, domoTER caps P579847/P579860
//   • the 63A column of P579863/P579865: one 63A fixed socket, over 2 positions
//   • switched-socket seats (103x230, tall): a 16A/32A interlocked socket, or the
//     103x230 flanges P579714 (2 socket positions), P579716 (3 50x50 sockets),
//     P579717 (one 63A fixed socket, low down, blocking the position above it)
//     and the closing flange P579713
//   • 63A series seats (115x290, tall): a 63A interlocked socket, or P579719
//     (2 socket positions), P579910 (one 63A socket), P579920 (adapter for one
//     16A/32A interlocked socket), P579902 (closing)
//   • the DIN rail behind the window above the sockets: DIN devices
//   • a blind cover: a window cover with DIN rail (P579451/2/3)

export type FitKind = 'din' | 'switched' | 'seat115' | 'int50' | 'domo' | 'f63' | 'fixed' | 'top' | 'none'
export type SeatKind = 'fixed' | 'col63' | 'switched' | 'seat115' | 'int50' | 'domo' | 'f63' | 'top'

// Where a part goes. span = how many seats side by side it takes (only domoTER
// devices span: a 2-module device takes both modules of a cap)
export function fitOf(p: Product): { kind: FitKind; span: number } {
  const c = readCapacity(p.capacity)
  const u = c.uses ?? {}
  if (u.din) return { kind: 'din', span: 1 }
  if (u.switched) return { kind: 'switched', span: 1 }   // every 103x230 part fills one seat
  if (u.seat115) return { kind: 'seat115', span: 1 }
  if (u.int50) return { kind: 'int50', span: 1 }
  if (u.domo) return { kind: 'domo', span: Math.max(1, Math.round(u.domo)) }
  if (u.f100) return { kind: 'f63', span: 1 }
  if (u.sockets) return { kind: 'fixed', span: 1 }
  if (c.provides?.din && /^cover\b/i.test(p.description)) return { kind: 'top', span: 1 }
  return { kind: 'none', span: 1 }
}

export function accepts(seat: SeatKind, fit: FitKind): boolean {
  if (seat === 'col63') return fit === 'f63'
  return seat === fit
}

// Why a part can't go somewhere, in words
export function fitHint(fit: FitKind): string {
  switch (fit) {
    case 'switched': return 'Interlocked sockets and 103x230 flanges go in a switched-socket seat (or a 63A series seat with adapter P579920)'
    case 'seat115': return 'This goes in a 63A series board or a 63A bottom box (115x290 seat)'
    case 'f63': return 'A 63A fixed socket needs the 63A column of P579863/P579865, or a 63A flange (P579717 on a switched board, P579910 on a 63A series board)'
    case 'fixed': return 'This needs a free socket position, or a flange that gives one (P579714, P579719)'
    case 'int50': return 'A 50x50 socket needs flange P579848 or P579716'
    case 'domo': return 'domoTER devices go in a domoTER cap (P579847 / P579860) with free modules'
    case 'top': return 'A window cover goes on a board with a blind cover'
    default: return 'It does not fit there'
  }
}

export interface Seat {
  id: string            // box seats 'c0r1', 'c2', 'top'; seats on a part '<item uid>.0'
  kind: SeatKind
  parent: string | null // item uid of the part that offers it
  group: string         // seats a spanning part can run across, in order
  index: number
}

export interface BoxColumn { kind: 'fixed' | 'col63' | 'switched' | 'seat115'; rows: number }
export interface BoxShape {
  wMm: number
  hMm: number
  top: 'window' | 'blind' | 'none'   // the window (DIN rail) is always above the sockets
  din: number                        // DIN modules of the box itself
  columns: BoxColumn[]
}

// Width and height of a box in mm, from its notes ("239x456mm") or, for the
// fixed-socket boards that give none, from the board's size class (wattage)
const WATT_SIZE: Record<string, [number, number]> = {
  '20': [122, 158], '22': [122, 395], '40': [239, 456], '56': [350, 456], '70': [461, 456],
}
const WATT_COLS: Record<string, number> = { '22': 1, '40': 2, '56': 3, '70': 4 }

export function boxSizeMm(p: Product): [number, number] {
  const m = `${p.notes ?? ''} ${p.description}`.match(/(\d{2,3})\s*x\s*(\d{2,3})\s*mm/i)
  if (m) return [Number(m[1]), Number(m[2])]
  const w = (p.notes ?? '').match(/\b(\d{2})W\b/)
  if (w && WATT_SIZE[w[1]]) {
    const [ww, hh] = WATT_SIZE[w[1]]
    const sockets = readCapacity(p.capacity).provides?.sockets ?? 0
    return [ww, sockets >= 3 && w[1] === '22' ? 456 : hh]   // the narrow 3-socket board is taller
  }
  return [160, 260]
}

// The shape of a box: window or blind cover on top, socket columns below
export function boxShape(p: Product): BoxShape {
  const prov = readCapacity(p.capacity).provides ?? {}
  const [wMm, hMm] = boxSizeMm(p)
  const din = prov.din ?? 0
  const columns: BoxColumn[] = []
  if (prov.switched) for (let i = 0; i < prov.switched; i++) columns.push({ kind: 'switched', rows: 1 })
  if (prov.seat115) for (let i = 0; i < prov.seat115; i++) columns.push({ kind: 'seat115', rows: 1 })
  if (prov.sockets) {
    const watt = (p.notes ?? '').match(/\b(\d{2})W\b/)?.[1] ?? ''
    const cols = Math.max(1, WATT_COLS[watt] ?? 1)
    if (prov.f100 && cols > 1) {
      // Boards with one 63A socket: normal columns, then a 63A column two positions tall
      const rows = Math.max(1, Math.ceil((prov.sockets - 1) / (cols - 1)))
      for (let i = 0; i < cols - 1; i++) columns.push({ kind: 'fixed', rows })
      columns.push({ kind: 'col63', rows })
    } else {
      const rows = Math.max(1, Math.ceil(prov.sockets / cols))
      for (let i = 0; i < cols; i++) columns.push({ kind: 'fixed', rows })
    }
  }
  const top: BoxShape['top'] = din > 0 ? 'window' : /blind cover/i.test(p.description) && (prov.switched || prov.seat115) ? 'blind' : 'none'
  return { wMm, hMm, top, din, columns }
}

// The box's own seats, in drawing order
export function boxSeats(shape: BoxShape): Seat[] {
  const out: Seat[] = []
  if (shape.top === 'blind') out.push({ id: 'top', kind: 'top', parent: null, group: 'top', index: 0 })
  let sw = 0
  shape.columns.forEach((col, c) => {
    if (col.kind === 'fixed') for (let r = 0; r < col.rows; r++) out.push({ id: `c${c}r${r}`, kind: 'fixed', parent: null, group: `c${c}`, index: r })
    else out.push({ id: `c${c}`, kind: col.kind, parent: null, group: col.kind === 'col63' ? `c${c}` : 'tall', index: sw++ })
  })
  return out
}

// Seats a part offers once it is in place
export function partSeats(p: Product, uid: string): Seat[] {
  const prov = readCapacity(p.capacity).provides ?? {}
  const out: Seat[] = []
  const add = (kind: SeatKind, n: number) => { for (let i = 0; i < n; i++) out.push({ id: `${uid}.${out.length}`, kind, parent: uid, group: uid, index: out.length }) }
  if (prov.f100) add('f63', 1)
  else if (prov.sockets) add('fixed', prov.sockets)
  if (prov.switched) add('switched', prov.switched)
  if (prov.int50) add('int50', prov.int50)
  if (prov.domo) add('domo', prov.domo)
  return out
}

// How the parts in seats offer more seats. A missing parent leaves its children unseated.
export function allSeats(shape: BoxShape, items: DesignItem[], productsById: Record<string, Product>): Seat[] {
  const seats = boxSeats(shape)
  const ids = new Set(seats.map((s) => s.id))
  let added = true
  while (added) {
    added = false
    items.forEach((it) => {
      if (!it.seat || !ids.has(it.seat)) return
      const p = productsById[it.productId]
      if (!p) return
      partSeats(p, it.uid).forEach((s) => { if (!ids.has(s.id)) { ids.add(s.id); seats.push(s); added = true } })
    })
  }
  return seats
}

// Which item fills each seat (a spanning item fills several)
export function occupancy(seats: Seat[], items: DesignItem[], productsById: Record<string, Product>): Record<string, string> {
  const out: Record<string, string> = {}
  items.forEach((it) => {
    if (!it.seat) return
    const start = seats.find((s) => s.id === it.seat)
    const p = productsById[it.productId]
    if (!start || !p) return
    const span = fitOf(p).span
    seats.filter((s) => s.group === start.group && s.index >= start.index && s.index < start.index + span).forEach((s) => { out[s.id] = it.uid })
  })
  return out
}

// The run of seats a part would take starting at a seat, or null if it doesn't fit there
export function spanAt(seats: Seat[], occ: Record<string, string>, start: Seat, fit: { kind: FitKind; span: number }, ignore?: Set<string>): Seat[] | null {
  if (!accepts(start.kind, fit.kind)) return null
  const run = seats.filter((s) => s.group === start.group && s.index >= start.index && s.index < start.index + fit.span)
  if (run.length < fit.span) return null
  if (run.some((s) => s.kind !== start.kind || (occ[s.id] && !ignore?.has(occ[s.id])))) return null
  return run
}

// An item and everything sitting on it
export function withChildren(items: DesignItem[], uid: string): Set<string> {
  const out = new Set([uid])
  let grew = true
  while (grew) {
    grew = false
    items.forEach((it) => {
      if (out.has(it.uid) || !it.seat) return
      const parent = it.seat.split('.')[0]
      if (it.seat.includes('.') && out.has(parent)) { out.add(it.uid); grew = true }
    })
  }
  return out
}

// DIN modules a box has (its own window, or a window cover on its blind cover) and uses
export function dinSpace(shape: BoxShape, items: DesignItem[], productsById: Record<string, Product>): { total: number; used: number } {
  let total = shape.din
  let used = 0
  items.forEach((it) => {
    const p = productsById[it.productId]
    if (!p) return
    const c = readCapacity(p.capacity)
    if (it.seat === 'top') total += c.provides?.din ?? 0
    if (it.seat === 'din') used += (c.uses?.din ?? 0) * it.qty
  })
  return { total, used: Math.round(used * 100) / 100 }
}

// ── Drawing helpers ──
// IEC colours for socket voltages
export function voltColour(p: Product): string {
  const v = p.description.match(/\b(\d{2,3}(?:\/\d{2,3})?)\s?V\b/)?.[1] ?? ''
  if (/^(20|24|25|42|48|50)$/.test(v) || /\/24$/.test(v)) return '#7b3fb8'
  if (/^(100|110|120|130)$/.test(v)) return '#e8b400'
  if (/^(200|220|230|240|250)$/.test(v)) return '#1c62c4'
  if (/^(380|400|415|440|380\/440)$/.test(v)) return '#cf2020'
  if (/^(480|500|690)$/.test(v)) return '#222222'
  return '#8a8d91'
}

export const ampsOf = (p: Product) => p.description.match(/\b(\d{1,3})A\b/)?.[1] ?? ''

// Short label on a DIN device: C16, RCBO 16, RCD 40, MS 100, SPD
export function dinLabel(p: Product): string {
  const d = p.description
  const a = ampsOf(p)
  if (/rcbo/i.test(d)) return `RCBO${a ? ` ${a}` : ''}`
  if (/rccb|\brcd\b/i.test(d)) return `RCD${a ? ` ${a}` : ''}`
  if (/main switch|isolator/i.test(d)) return `MS${a ? ` ${a}` : ''}`
  if (/surge|\bspd\b/i.test(d)) return 'SPD'
  const curve = d.match(/\b([BCD]) curve\b/)?.[1]
  if (curve) return `${curve}${a}`
  if (/contactor/i.test(d)) return `KM${a ? ` ${a}` : ''}`
  if (/module cover|blank/i.test(d)) return ''
  return (p.part_number ?? '').replace(/^[PB]/, '').slice(0, 6)
}
