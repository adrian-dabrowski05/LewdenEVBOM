import type { Product, ProductCapacity, CapacityMap, QuantityMap } from '../types'

// ── TopTer capacity check ─────────────────────────────────────
// Every board, back box or flange says what it PROVIDES (socket positions, flange
// seats, DIN modules) and every socket, flange or DIN device says what it USES.
// The quote adds them all up, so two or three boards combined count as one bigger
// box. Set per part in Admin > Products > Capacity.

// The slots, in the order they are listed
export const SLOTS: { key: string; label: string; hint: string }[] = [
  { key: 'sockets', label: 'Socket positions', hint: 'Fixed sockets, caps and closing flanges on a board or back box' },
  { key: 'f65', label: '65x83 flange seats', hint: 'Sockets on a 65x83 flange (most 16A sockets, domestic caps)' },
  { key: 'f88', label: '88x100 flange seats', hint: 'Sockets on an 88x100 flange (32A, and 16A 3P+N+E)' },
  { key: 'f100', label: '100x100 flange seats (63A)', hint: '63A fixed sockets' },
  { key: 'switched', label: 'Switched socket seats', hint: '16A and 32A interlocked sockets, or a 103x230 flange' },
  { key: 'seat115', label: '115x290 seats (63A series boards)', hint: '63A interlocked sockets, or a 115x290 flange / adapter' },
  { key: 'int50', label: '50x50 domestic socket seats', hint: 'International 50x50 domestic sockets' },
  { key: 'domo', label: 'domoTER modules', hint: 'domoTER devices, in a domoTER cap (P579847 or P579860 hold 2 modules each)' },
  { key: 'din', label: 'DIN modules', hint: 'MCBs, RCBOs, RCCBs, main switches and other DIN rail devices' },
]

export const SLOT_LABELS: Record<string, string> = Object.fromEntries(SLOTS.map((s) => [s.key, s.label]))

// The database stores jsonb; tolerate a string or anything odd
export function readCapacity(raw: unknown): ProductCapacity {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) } catch { return {} }
  }
  if (!value || typeof value !== 'object') return {}
  const clean = (m: unknown): CapacityMap | undefined => {
    if (!m || typeof m !== 'object') return undefined
    const out: CapacityMap = {}
    Object.entries(m as Record<string, unknown>).forEach(([k, v]) => {
      const n = Number(v)
      if (isFinite(n) && n > 0) out[k] = n
    })
    return Object.keys(out).length > 0 ? out : undefined
  }
  const v = value as { provides?: unknown; uses?: unknown }
  return { provides: clean(v.provides), uses: clean(v.uses) }
}

export function hasCapacity(p: Product): boolean {
  const c = readCapacity(p.capacity)
  return !!(c.provides || c.uses)
}

export interface CapacityLine {
  key: string
  label: string
  provided: number
  used: number
  over: boolean
  // Seats of this flange size are left, but every socket position is taken, so
  // nothing more of this size can go in (e.g. a 2-socket flange that also has an
  // 88x100 seat, once both 65x83 seats are filled)
  full?: boolean
}

// Flange seat sizes that also need a socket position
const SEAT_KEYS = ['f65', 'f88', 'f100']

// Totals for the parts on the quote. Only slots something provides or uses are listed.
export function capacityUsage(products: Product[], qty: QuantityMap): CapacityLine[] {
  const provided: CapacityMap = {}
  const used: CapacityMap = {}
  products.forEach((p) => {
    const n = qty[p.id] ?? 0
    if (n <= 0) return
    const c = readCapacity(p.capacity)
    Object.entries(c.provides ?? {}).forEach(([k, v]) => { provided[k] = (provided[k] ?? 0) + v * n })
    Object.entries(c.uses ?? {}).forEach(([k, v]) => { used[k] = (used[k] ?? 0) + v * n })
  })
  const keys = Array.from(new Set([...Object.keys(provided), ...Object.keys(used)]))
  const order = (k: string) => { const i = SLOTS.findIndex((s) => s.key === k); return i === -1 ? SLOTS.length : i }
  keys.sort((a, b) => order(a) - order(b) || a.localeCompare(b))
  const socketsLeft = (provided.sockets ?? 0) - (used.sockets ?? 0)
  return keys.map((key) => {
    const p = provided[key] ?? 0
    const u = used[key] ?? 0
    const full = SEAT_KEYS.includes(key) && 'sockets' in provided && socketsLeft <= 0 && u < p
    return { key, label: SLOT_LABELS[key] ?? key, provided: p, used: u, over: u > p, ...(full ? { full } : {}) }
  })
}

// Short wording for one part, e.g. "4 socket positions, 4× 65x83, 10 DIN modules"
const SHORT: Record<string, [string, string]> = {
  sockets: ['socket position', 'socket positions'],
  f65: ['65x83 seat', '65x83 seats'],
  f88: ['88x100 seat', '88x100 seats'],
  f100: ['100x100 seat', '100x100 seats'],
  switched: ['switched-socket seat', 'switched-socket seats'],
  seat115: ['115x290 seat', '115x290 seats'],
  int50: ['50x50 socket seat', '50x50 socket seats'],
  domo: ['domoTER module', 'domoTER modules'],
  din: ['DIN module', 'DIN modules'],
}

export function capacityText(map: CapacityMap | undefined): string {
  if (!map) return ''
  const order = (k: string) => { const i = SLOTS.findIndex((s) => s.key === k); return i === -1 ? SLOTS.length : i }
  return Object.keys(map)
    .sort((a, b) => order(a) - order(b))
    .map((k) => { const n = map[k]; const [one, many] = SHORT[k] ?? [k, k]; return `${n} ${n === 1 ? one : many}` })
    .join(', ')
}
