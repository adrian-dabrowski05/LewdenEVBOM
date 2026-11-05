import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { Product, QuantityMap, QuoteFormData, AppSettings, TopterDesign, DesignBox, DesignRow, DesignItem } from '../types'
import { EXTRAS_CATEGORY } from '../types'
import type { ExtrasResult } from '../utils/extras'
import { quotePricing } from '../utils/pricing'
import { capacityUsage, capacityText, readCapacity } from '../utils/capacity'
import {
  JOIN_PARTS, isBox, isJoinable, designCounts, missingJoinParts, jointCount, assemblies, newUid,
  boxShape, allSeats, occupancy, spanAt, fitOf, fitHint, withChildren, dinSpace, partSeats,
  voltColour, ampsOf, dinLabel,
} from '../utils/design'
import type { Seat, BoxShape } from '../utils/design'
import { qtyStep, fmt } from './QuoteBuilder'
import CapacityPanel from './CapacityPanel'
import { PartThumb } from './PartPicture'
import type { EditingQuote } from '../App'

// ── TopTer box designer ───────────────────────────────────────
// A third way to build a TopTer quote, next to the simple list and the step
// builder. Drag boxes onto the wall, then drag sockets, flanges and DIN devices
// into them. Two boxes placed side by side ask whether to join them into one
// assembly; joined boxes add the joining parts (JOIN_PARTS in utils/design.ts).
// Everything placed goes onto the same quote, so the other two modes, the
// capacity check, the totals and saving all see it. On a phone, tap a part to
// pick it up and tap a box to put it in.

interface Props {
  products: Product[]
  loading: boolean
  quantities: QuantityMap
  setQty: (id: string, qty: number) => void
  design: TopterDesign
  setDesign: (d: TopterDesign) => void
  quoteForm: QuoteFormData
  settings: AppSettings
  extrasResult: ExtrasResult
  showToast: (msg: string, type?: 'success' | 'error') => void
  editingQuote: EditingQuote | null
  onCancelEdit: () => void
  onReview: () => void   // opens Review & save in the step builder
}

type Payload =
  | { kind: 'part'; productId: string }                     // new part from the list
  | { kind: 'loose'; productId: string }                    // part already on the quote but not in a box
  | { kind: 'box'; uid: string }                            // a box already on the wall
  | { kind: 'item'; boxUid: string; itemUid: string }       // a part already in a box

// Where a box can be dropped: into a row at a position, or as a new row
type Spot = { rowId: string; index: number } | { newRow: true }

// A joint waiting for the rep's answer: the box on the right of the joint
interface JoinAsk { boxUid: string }

const PALETTE: { key: string; label: string; test: (p: Product) => boolean }[] = [
  { key: 'boxes', label: 'Boxes', test: (p) => isBox(p) },
  { key: 'fixed', label: 'Fixed sockets', test: (p) => p.category === 'Fixed sockets' },
  { key: 'interlocked', label: 'Interlocked', test: (p) => p.category === 'Interlocked sockets' },
  { key: 'domestic', label: 'Domestic', test: (p) => p.category === 'Domestic sockets' },
  { key: 'flanges', label: 'Flanges & covers', test: (p) => p.category === 'Flanges & covers' || (p.category === 'Enclosures' && !isBox(p)) },
  { key: 'protection', label: 'Circuit protection', test: (p) => p.category === 'Circuit protection' },
  { key: 'accessories', label: 'Accessories', test: (p) => !['Enclosures', 'Fixed sockets', 'Interlocked sockets', 'Domestic sockets', 'Flanges & covers', 'Circuit protection'].includes(p.category) },
]

const titleStyle = { fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' } as const

const round2 = (n: number) => Math.round(n * 100) / 100

// Short name for a box or part on the drawing
const shortName = (p: Product) => p.option_label?.trim() || p.description
  .replace(/^topTER\s+/i, '')
  .replace(/^distribution board,?\s*(for\s+)?/i, '')
  .replace(/transparent window,?\s*/i, '')
  .replace(/,?\s*IP\d+(\/IP\d+)?$/i, '')

export default function TopterDesigner({
  products, loading, quantities, setQty, design, setDesign,
  quoteForm, settings, extrasResult, showToast, editingQuote, onCancelEdit, onReview,
}: Props) {
  const [tab, setTab] = useState('boxes')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Payload | null>(null)     // tap to place
  const [dragging, setDragging] = useState<Payload | null>(null)
  const [overSpot, setOverSpot] = useState<string | null>(null)   // highlighted drop target
  const [asks, setAsks] = useState<JoinAsk[]>([])
  const [selected, setSelected] = useState<string | null>(null)   // item uid tapped in a box (shows its remove button)
  const dragRef = useRef<Payload | null>(null)

  const productsById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])) as Record<string, Product>, [products])
  const catalogue = useMemo(() => products.filter((p) => p.category !== EXTRAS_CATEGORY), [products])

  // ── What's on the quote ──
  const counts = useMemo(() => designCounts(design, products), [design, products])
  const finalQty = extrasResult.effectiveQty
  const loose = useMemo(() => catalogue
    .map((p) => ({ p, n: round2((quantities[p.id] ?? 0) - (counts[p.id] ?? 0)) }))
    .filter((x) => x.n > 0), [catalogue, quantities, counts])
  const missingJoins = useMemo(() => missingJoinParts(products), [products])
  const joints = jointCount(design)
  const boxCount = design.rows.reduce((n, r) => n + r.boxes.length, 0)
  const assemblyCount = assemblies(design).length

  // Totals, the same sums as the other two modes
  const activeItems = products.filter((p) => (finalQty[p.id] ?? 0) > 0)
  const materialsSubtotal = activeItems.reduce((sum, p) => sum + (p.factory_cost != null ? p.factory_cost * (finalQty[p.id] ?? 0) : 0), 0) + extrasResult.repHardwareCost
  const upliftPct = quoteForm.uplift_pct.trim() === '' ? settings.hardware_uplift_pct : (parseFloat(quoteForm.uplift_pct) || 0)
  const labourMinutes = (parseFloat(quoteForm.labour_minutes) || 0) + extrasResult.labourMinutes
  const factoryCost = materialsSubtotal + materialsSubtotal * upliftPct / 100 + labourMinutes * settings.labour_rate_per_min + extrasResult.repCost
  const carriage = Math.max(0, parseFloat(quoteForm.carriage) || 0)
  const pricing = quotePricing(factoryCost, quoteForm.gp_pct, quoteForm.rebate_pct, carriage)
  const overCapacity = capacityUsage(products, finalQty).filter((l) => l.over)

  // ── Saving a change: the design, then the quote quantities by the difference ──
  // absorb: parts that were already on the quote (dragged in from "not in a box"),
  // so placing them doesn't add them a second time
  const commit = (next: TopterDesign, absorb?: QuantityMap) => {
    const after = designCounts(next, products)
    setDesign(next)
    const ids = new Set([...Object.keys(counts), ...Object.keys(after)])
    ids.forEach((id) => {
      const diff = round2((after[id] ?? 0) - (counts[id] ?? 0) - (absorb?.[id] ?? 0))
      if (diff === 0) return
      setQty(id, Math.max(0, round2((quantities[id] ?? 0) + diff)))
    })
  }

  // ── Helpers on the design ──
  const findBox = (d: TopterDesign, uid: string): { row: DesignRow; index: number; box: DesignBox } | null => {
    for (const row of d.rows) {
      const index = row.boxes.findIndex((b) => b.uid === uid)
      if (index !== -1) return { row, index, box: row.boxes[index] }
    }
    return null
  }
  const clone = (d: TopterDesign): TopterDesign => ({ rows: d.rows.map((r) => ({ id: r.id, boxes: r.boxes.map((b) => ({ ...b, items: b.items.map((i) => ({ ...i })) })) })) })
  const tidy = (d: TopterDesign): TopterDesign => ({
    rows: d.rows.filter((r) => r.boxes.length > 0).map((r) => ({ ...r, boxes: r.boxes.map((b, i) => (i === 0 && b.joinedLeft ? { ...b, joinedLeft: false } : b)) })),
  })

  // Joints that need asking: both boxes can be joined
  const askable = (d: TopterDesign, rightUid: string): boolean => {
    const at = findBox(d, rightUid)
    if (!at || at.index === 0) return false
    const left = at.row.boxes[at.index - 1]
    return isJoinable(productsById[left.productId]) && isJoinable(productsById[at.box.productId])
  }

  // Put a box at a spot. The neighbours it now touches are asked about.
  const placeBox = (d: TopterDesign, box: DesignBox, spot: Spot): { next: TopterDesign; ask: string[] } => {
    const next = clone(d)
    const fresh: DesignBox = { ...box, joinedLeft: false }
    const ask: string[] = []
    if ('newRow' in spot) {
      next.rows.push({ id: newUid(), boxes: [fresh] })
      return { next: tidy(next), ask }
    }
    const row = next.rows.find((r) => r.id === spot.rowId)
    if (!row) { next.rows.push({ id: newUid(), boxes: [fresh] }); return { next: tidy(next), ask } }
    const index = Math.max(0, Math.min(spot.index, row.boxes.length))
    row.boxes.splice(index, 0, fresh)
    if (index > 0) ask.push(fresh.uid)
    const right = row.boxes[index + 1]
    if (right) { right.joinedLeft = false; ask.push(right.uid) }
    return { next: tidy(next), ask }
  }

  // Take a box off the wall. The two boxes either side now touch, so ask about them.
  const liftBox = (d: TopterDesign, uid: string): { next: TopterDesign; box: DesignBox | null; ask: string[] } => {
    const next = clone(d)
    const at = findBox(next, uid)
    if (!at) return { next: d, box: null, ask: [] }
    const [box] = at.row.boxes.splice(at.index, 1)
    const ask: string[] = []
    const right = at.row.boxes[at.index]
    if (right) { right.joinedLeft = false; if (at.index > 0) ask.push(right.uid) }
    return { next: tidy(next), box, ask }
  }

  const queueAsks = (d: TopterDesign, uids: string[]) => {
    const list = uids.filter((u) => askable(d, u)).map((boxUid) => ({ boxUid }))
    if (list.length > 0) setAsks((prev) => [...prev.filter((a) => !list.some((l) => l.boxUid === a.boxUid)), ...list])
  }

  // ── Dropping ──
  const dropBox = (payload: Payload, spot: Spot) => {
    if (payload.kind === 'box') {
      const lifted = liftBox(design, payload.uid)
      if (!lifted.box) return
      // Dropping a box right back where it was changes nothing
      let dest: Spot = spot
      const before = findBox(design, payload.uid)
      if (before && 'rowId' in dest && dest.rowId === before.row.id) {
        const index = dest.index > before.index ? dest.index - 1 : dest.index
        if (index === before.index) return
        dest = { rowId: dest.rowId, index }
      }
      // A lifted box may have emptied its row
      if ('rowId' in dest) {
        const rowId = dest.rowId
        if (!lifted.next.rows.some((r) => r.id === rowId)) dest = { newRow: true }
      }
      const placed = placeBox(lifted.next, lifted.box, dest)
      commit(placed.next)
      queueAsks(placed.next, [...lifted.ask, ...placed.ask])
      return
    }
    if (payload.kind === 'part' || payload.kind === 'loose') {
      const p = productsById[payload.productId]
      if (!p) return
      if (!isBox(p)) { showToast('Drop sockets and devices into a box', 'error'); return }
      const placed = placeBox(design, { uid: newUid(), productId: p.id, joinedLeft: false, items: [] }, spot)
      commit(placed.next, payload.kind === 'loose' ? { [p.id]: 1 } : undefined)
      queueAsks(placed.next, placed.ask)
      return
    }
    if (payload.kind === 'item') showToast('Drop it into a box, or on Remove to take it off', 'error')
  }

  // ── Putting parts into boxes ──
  // seatIds: the seats to try, in order (null = the first free seat the part fits).
  // moveUid: an item already in a box that is being moved (it brings what sits on it).
  type PlaceResult = { next: TopterDesign } | { error: string }
  const placePart = (d: TopterDesign, boxUid: string, p: Product, seatIds: string[] | null, moveUid?: string, qty?: number): PlaceResult => {
    const next = clone(d)
    let moved: DesignItem[] = []
    if (moveUid) {
      next.rows.forEach((r) => r.boxes.forEach((b) => {
        if (!b.items.some((i) => i.uid === moveUid)) return
        const ids = withChildren(b.items, moveUid)
        moved = b.items.filter((i) => ids.has(i.uid))
        b.items = b.items.filter((i) => !ids.has(i.uid))
      }))
    }
    const head = moved.find((i) => i.uid === moveUid)
    const at = findBox(next, boxUid)
    const bp = at ? productsById[at.box.productId] : undefined
    if (!at || !bp) return { error: 'That box is no longer on the wall' }
    const box = at.box
    const shape = boxShape(bp)
    const fit = fitOf(p)

    // DIN devices go on the rail behind the window
    if (fit.kind === 'din') {
      const space = dinSpace(shape, box.items, productsById)
      const n = head?.qty ?? qty ?? qtyStep(p)
      const need = round2((readCapacity(p.capacity).uses?.din ?? 0) * n)
      if (space.total === 0) return { error: shape.top === 'blind' ? 'This board has a blind cover: drop a window cover (P579451/2/3) on it first for a DIN rail' : 'This box has no DIN rail' }
      if (space.used + need > space.total + 0.001) return { error: `Not enough DIN space: ${space.used} of ${space.total} modules used, this needs ${need}` }
      if (head) { head.seat = 'din'; box.items.push(...moved); return { next } }
      const same = box.items.find((i) => i.productId === p.id && i.seat === 'din')
      if (same) same.qty = round2(same.qty + n)
      else box.items.push({ uid: newUid(), productId: p.id, qty: n, seat: 'din' })
      return { next }
    }
    // Anything that doesn't sit in a seat (handles, earth bars...) goes with the box
    if (fit.kind === 'none') {
      const n = head?.qty ?? qty ?? qtyStep(p)
      if (head) { head.seat = null; box.items.push(...moved); return { next } }
      const same = box.items.find((i) => i.productId === p.id && !i.seat)
      if (same) same.qty = round2(same.qty + n)
      else box.items.push({ uid: newUid(), productId: p.id, qty: n, seat: null })
      return { next }
    }
    const seats = allSeats(shape, box.items, productsById)
    const occ = occupancy(seats, box.items, productsById)
    const candidates = seatIds ? seatIds.map((id) => seats.find((s) => s.id === id)).filter((s): s is Seat => !!s) : seats
    for (const s of candidates) {
      if (!spanAt(seats, occ, s, fit)) continue
      if (head) { head.seat = s.id; head.qty = 1; box.items.push(...moved) }
      else box.items.push({ uid: newUid(), productId: p.id, qty: 1, seat: s.id })
      return { next }
    }
    if (seatIds && seatIds.length === 1 && candidates[0] && occ[candidates[0].id]) return { error: 'That place is taken. Remove what is there first.' }
    return { error: seatIds ? fitHint(fit.kind) : `No free place for it in this box. ${fitHint(fit.kind)}` }
  }

  const productOf = (payload: Payload): { product: Product | undefined; moveUid?: string } => {
    if (payload.kind === 'part' || payload.kind === 'loose') return { product: productsById[payload.productId] }
    if (payload.kind === 'item') {
      for (const r of design.rows) for (const b of r.boxes) {
        const it = b.items.find((i) => i.uid === payload.itemUid)
        if (it) return { product: productsById[it.productId], moveUid: it.uid }
      }
    }
    return { product: undefined }
  }

  // Drop on a box (seatIds null), on one seat, or on a part (its free seats)
  const dropInto = (payload: Payload, boxUid: string, seatIds: string[] | null) => {
    const at = findBox(design, boxUid)
    if (!at) return
    if (payload.kind === 'box') {
      if (payload.uid !== boxUid) dropBox(payload, { rowId: at.row.id, index: at.index + 1 })
      return
    }
    const { product: p, moveUid } = productOf(payload)
    if (!p) return
    if (isBox(p)) { dropBox(payload, { rowId: at.row.id, index: at.index + 1 }); return }
    const fit = fitOf(p)
    const looseQty = payload.kind === 'loose' ? (loose.find((x) => x.p.id === p.id)?.n ?? 0) : 0
    if (payload.kind === 'loose' && looseQty <= 0) return
    const qty = payload.kind === 'loose' ? (fit.kind === 'din' || fit.kind === 'none' ? looseQty : 1) : undefined
    const res = placePart(design, boxUid, p, seatIds, moveUid, qty)
    if ('error' in res) { showToast(res.error, 'error'); return }
    commit(res.next, payload.kind === 'loose' ? { [p.id]: qty ?? 1 } : undefined)
    setSelected(null)
  }

  const removeBox = (uid: string) => {
    const lifted = liftBox(design, uid)
    commit(lifted.next)
    queueAsks(lifted.next, lifted.ask)
  }

  // Take a part off (with whatever sits on it)
  const removeItem = (boxUid: string, itemUid: string) => {
    const next = clone(design)
    const at = findBox(next, boxUid)
    if (!at) return
    const ids = withChildren(at.box.items, itemUid)
    at.box.items = at.box.items.filter((i) => !ids.has(i.uid))
    commit(next)
    setSelected(null)
  }

  // DIN devices and loose parts can change amount; parts in seats are one each
  const setItemQty = (boxUid: string, itemUid: string, qty: number) => {
    if (qty <= 0) { removeItem(boxUid, itemUid); return }
    const next = clone(design)
    const at = findBox(next, boxUid)
    if (!at) return
    const item = at.box.items.find((i) => i.uid === itemUid)
    const p = item ? productsById[item.productId] : undefined
    const bp = productsById[at.box.productId]
    if (!item || !p || !bp) return
    if (item.seat === 'din') {
      const space = dinSpace(boxShape(bp), at.box.items, productsById)
      const extra = (readCapacity(p.capacity).uses?.din ?? 0) * (qty - item.qty)
      if (extra > 0 && space.used + extra > space.total + 0.001) { showToast(`Not enough DIN space: ${space.used} of ${space.total} modules used`, 'error'); return }
    }
    item.qty = round2(qty)
    commit(next)
  }

  const setJoined = (boxUid: string, joined: boolean) => {
    const next = clone(design)
    const at = findBox(next, boxUid)
    if (!at || at.index === 0) return
    at.box.joinedLeft = joined
    commit(next)
  }

  const answerAsk = (joined: boolean) => {
    const [first, ...rest] = asks
    setAsks(rest)
    if (first && joined) setJoined(first.boxUid, true)
  }

  const clearDesign = () => {
    if (boxCount === 0) return
    if (!confirm('Take every box off the designer? Their parts come off the quote too.')) return
    commit({ rows: [] })
    setAsks([])
  }

  const dropRemove = (payload: Payload) => {
    if (payload.kind === 'box') removeBox(payload.uid)
    else if (payload.kind === 'item') removeItem(payload.boxUid, payload.itemUid)
  }

  // ── Drag and tap plumbing ──
  const startDrag = (e: DragEvent, payload: Payload) => {
    dragRef.current = payload
    setDragging(payload)
    setPicked(null)
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', JSON.stringify(payload)) } catch { /* some browsers */ }
  }
  const endDrag = () => { dragRef.current = null; setDragging(null); setOverSpot(null) }
  const current = (e?: DragEvent): Payload | null => {
    if (dragRef.current) return dragRef.current
    try { const raw = e?.dataTransfer.getData('text/plain'); return raw ? JSON.parse(raw) as Payload : null } catch { return null }
  }
  const target = (key: string, onDrop: (p: Payload) => void) => ({
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; if (overSpot !== key) setOverSpot(key) },
    onDragLeave: (e: DragEvent) => { e.stopPropagation(); if (overSpot === key) setOverSpot(null) },
    onDrop: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); const p = current(e); endDrag(); if (p) onDrop(p) },
    onClick: (e: React.MouseEvent) => { if (!picked) return; e.stopPropagation(); const p = picked; if (p.kind !== 'part' && p.kind !== 'loose') setPicked(null); onDrop(p) },
  })

  const moving = dragging ?? picked
  const movingProduct = moving && (moving.kind === 'part' || moving.kind === 'loose') ? productsById[moving.productId] : null
  const movingIsBox = moving?.kind === 'box' || (movingProduct ? isBox(movingProduct) : false)
  const movingIntoBox = moving?.kind === 'item' || (movingProduct ? !isBox(movingProduct) : false)

  // ── Palette ──
  const paletteItems = useMemo(() => {
    const t = PALETTE.find((x) => x.key === tab) ?? PALETTE[0]
    const q = search.trim().toLowerCase()
    return catalogue.filter((p) => (q ? `${p.description} ${p.part_number ?? ''} ${p.range_name ?? ''} ${p.option_label ?? ''}`.toLowerCase().includes(q) : t.test(p)))
  }, [catalogue, tab, search])

  const paletteGroups = useMemo(() => {
    const groups: { name: string; items: Product[] }[] = []
    const byName: Record<string, { name: string; items: Product[] }> = {}
    paletteItems.forEach((p) => {
      const name = p.range_name?.trim() || ''
      if (!byName[name]) { byName[name] = { name, items: [] }; groups.push(byName[name]) }
      byName[name].items.push(p)
    })
    return groups
  }, [paletteItems])

  const ask = asks[0]
  const askAt = ask ? findBox(design, ask.boxUid) : null
  const askLeft = askAt && askAt.index > 0 ? productsById[askAt.row.boxes[askAt.index - 1].productId] : null
  const askRight = askAt ? productsById[askAt.box.productId] : null
  // An ask for a joint that no longer exists (a box moved away) is skipped
  const askStale = !!ask && !(askLeft && askRight)
  useEffect(() => { if (askStale) setAsks((prev) => prev.slice(1)) }, [askStale, ask])

  if (loading) return <div className="loading"><div className="spinner" /> Loading catalogue…</div>

  // ── Drawing ──
  const renderGap = (rowId: string, index: number, touching: boolean) => {
    const key = `gap:${rowId}:${index}`
    const active = movingIsBox
    const hot = overSpot === key
    return (
      <div
        key={key}
        {...target(key, (p) => dropBox(p, { rowId, index }))}
        title={active ? 'Drop the box here' : undefined}
        style={{ alignSelf: 'stretch', flexShrink: 0, width: active ? 34 : touching ? 0 : 16, minHeight: 120, borderRadius: 8, border: active ? `2px dashed ${hot ? 'var(--brand)' : 'var(--border-strong)'}` : 'none', background: hot ? 'var(--brand-light)' : 'transparent', transition: 'width 0.12s', cursor: picked && active ? 'copy' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand)', fontSize: 18, fontWeight: 700 }}
      >
        {active && hot ? '+' : ''}
      </div>
    )
  }

  const renderJoint = (left: DesignBox, right: DesignBox) => {
    const canJoin = isJoinable(productsById[left.productId]) && isJoinable(productsById[right.productId])
    const joined = right.joinedLeft
    const plate = (top: string) => (
      <span aria-hidden style={{ position: 'absolute', top, left: 0, transform: 'translateX(-50%)', width: 22, height: 12, borderRadius: 2, background: 'linear-gradient(#e9ecef, #b5bbc1)', border: '1px solid #8d9399', boxShadow: '0 1px 2px rgba(0,0,0,0.25)' }} />
    )
    return (
      <div style={{ position: 'relative', width: 0, alignSelf: 'stretch', zIndex: 2 }}>
        {joined && plate('14%')}
        {joined && plate('min(72%, 220px)')}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (canJoin) setJoined(right.uid, !joined) }}
          title={!canJoin ? "63A interlock boxes can't be joined" : joined ? 'Joined into one assembly. Click to keep them separate.' : 'Separate boxes. Click to join them.'}
          style={{ position: 'absolute', top: -9, left: 0, transform: 'translateX(-50%)', whiteSpace: 'nowrap', padding: '2px 7px', borderRadius: 99, fontSize: 10, fontWeight: 700, fontFamily: 'inherit', cursor: canJoin ? 'pointer' : 'default', border: `1.5px solid ${joined ? 'var(--brand)' : 'var(--border-strong)'}`, background: joined ? 'var(--brand)' : 'var(--surface)', color: joined ? '#fff' : 'var(--text-3)', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
        >
          {joined ? '⛓ Joined' : canJoin ? 'Separate' : '—'}
        </button>
      </div>
    )
  }

  // ── Drawing a box like the real thing ──
  // RAL 7035 grey body, screw caps in the corners, the smoked window with the DIN
  // rail on top, and the socket compartments below. Sizes are to scale.
  const PX_PER_MM = 0.6

  const movingFit = (() => {
    if (!moving) return null
    const { product } = productOf(moving)
    return product && !isBox(product) ? fitOf(product) : null
  })()

  const renderBox = (box: DesignBox) => {
    const p = productsById[box.productId]
    if (!p) {
      return (
        <div style={{ width: 150, padding: 10, border: '1.5px dashed var(--danger)', borderRadius: 10, fontSize: 12, color: 'var(--danger)' }}>
          This box is no longer in the catalogue.
          <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => removeBox(box.uid)}>Remove</button>
        </div>
      )
    }
    const shape: BoxShape = boxShape(p)
    const seats = allSeats(shape, box.items, productsById)
    const occ = occupancy(seats, box.items, productsById)
    const itemsByUid = Object.fromEntries(box.items.map((i) => [i.uid, i])) as Record<string, DesignItem>
    const din = dinSpace(shape, box.items, productsById)
    const cover = box.items.find((i) => i.seat === 'top')
    const dinItems = box.items.filter((i) => i.seat === 'din')
    const extras = box.items.filter((i) => !i.seat || (i.seat !== 'din' && i.seat !== 'top' && !seats.some((s) => s.id === i.seat)))
    const W = Math.round(Math.max(96, shape.wMm * PX_PER_MM))
    const H = Math.round(Math.max(96, shape.hMm * PX_PER_MM))
    const hasCols = shape.columns.length > 0
    const topH = hasCols ? Math.round(Math.min(96, Math.max(42, H * 0.25))) : undefined

    // This box's own capacity check (65x83 / 88x100 limits and so on)
    const localQty: QuantityMap = { [p.id]: 1 }
    box.items.forEach((it) => { localQty[it.productId] = (localQty[it.productId] ?? 0) + it.qty })
    const localProducts = [p, ...box.items.map((i) => productsById[i.productId]).filter((x): x is Product => !!x && x.id !== p.id)].filter((x, i, a) => a.indexOf(x) === i)
    const over = capacityUsage(localProducts, localQty).filter((l) => l.over)

    const boxKey = `box:${box.uid}`
    const isDragged = dragging?.kind === 'box' && dragging.uid === box.uid

    // An empty seat: shows where the part being moved can go
    const emptySeat = (seat: Seat) => {
      const key = `seat:${box.uid}:${seat.id}`
      const ok = !!movingFit && !!spanAt(seats, occ, seat, movingFit)
      const hot = overSpot === key
      const tall = seat.kind === 'switched' || seat.kind === 'seat115' || seat.kind === 'col63'
      return (
        <div key={seat.id} {...target(key, (pl) => dropInto(pl, box.uid, [seat.id]))}
          title={SEAT_NAMES[seat.kind]}
          style={{ flex: 1, minHeight: 0, minWidth: 0, borderRadius: seat.kind === 'domo' ? 2 : 5, border: `1.5px dashed ${hot ? 'var(--brand)' : ok ? '#3d8b40' : 'rgba(0,0,0,0.22)'}`, background: hot ? 'rgba(0,86,179,0.15)' : ok ? 'rgba(61,139,64,0.12)' : tall ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ok ? '#3d8b40' : 'rgba(0,0,0,0.25)', fontSize: 14, fontWeight: 700, cursor: picked ? 'copy' : undefined }}>
          {ok ? '+' : ''}
        </div>
      )
    }

    // What sits on a part: its own seats, laid out like the real flange or cap
    const childSeats = (item: DesignItem, part: Product) => {
      const kids = partSeats(part, item.uid)
      if (kids.length === 0) return null
      const kidOcc = kids.map((s) => renderSeatContent(s))
      if (kids[0].kind === 'f63') {
        // 63A flange: the socket sits low down; the space above it is blocked
        return (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minHeight: 0 }}>
            <div style={{ flex: 0.75, borderRadius: 3, background: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.05) 0 4px, transparent 4px 8px)' }} title="Blocked by the 63A flange" />
            <div style={{ flex: 1.25, display: 'flex', minHeight: 0 }}>{kidOcc[0]}</div>
          </div>
        )
      }
      const row = kids[0].kind === 'domo'
      return <div style={{ flex: 1, display: 'flex', flexDirection: row ? 'row' : 'column', gap: 3, minHeight: 0, minWidth: 0, padding: row ? '18% 8%' : 0 }}>{kidOcc}</div>
    }

    // A seat with whatever sits in it
    const renderSeatContent = (seat: Seat): JSX.Element | null => {
      const uid = occ[seat.id]
      if (!uid) return emptySeat(seat)
      const item = itemsByUid[uid]
      if (!item || item.seat !== seat.id) return null   // the rest of a spanning part
      const part = productsById[item.productId]
      if (!part) return emptySeat(seat)
      const span = fitOf(part).span
      const isSel = selected === item.uid
      const key = `item:${item.uid}`
      return (
        <div key={seat.id}
          draggable
          onDragStart={(e) => { e.stopPropagation(); startDrag(e, { kind: 'item', boxUid: box.uid, itemUid: item.uid }) }}
          onDragEnd={endDrag}
          {...target(key, (pl) => { const free = partSeats(part, item.uid).map((s) => s.id); if (free.length > 0) dropInto(pl, box.uid, free); else showToast('That place is taken. Remove what is there first.', 'error') })}
          onClick={(e) => { e.stopPropagation(); if (picked) { const free = partSeats(part, item.uid).map((s) => s.id); if (free.length > 0) dropInto(picked, box.uid, free); return } setSelected(isSel ? null : item.uid) }}
          title={`${part.part_number ?? ''} ${part.description}`}
          style={{ flex: span, position: 'relative', minHeight: 0, minWidth: 0, display: 'flex', cursor: 'grab', outline: isSel ? '2px solid var(--brand)' : overSpot === key ? '2px dashed var(--brand)' : 'none', outlineOffset: 1, borderRadius: 4, opacity: dragging?.kind === 'item' && dragging.itemUid === item.uid ? 0.4 : 1 }}>
          <PartDrawing part={part}>{childSeats(item, part)}</PartDrawing>
          {isSel && (
            <button type="button" aria-label="Remove" title="Remove (and what sits on it)" onClick={(e) => { e.stopPropagation(); removeItem(box.uid, item.uid) }}
              style={{ position: 'absolute', top: -7, right: -7, width: 20, height: 20, borderRadius: 99, border: 'none', background: 'var(--danger)', color: '#fff', fontSize: 13, lineHeight: '20px', cursor: 'pointer', zIndex: 5, padding: 0 }}>×</button>
          )}
        </div>
      )
    }

    // The window with the DIN rail: devices left to right, blank covers after
    const renderWindow = () => {
      const units: { item: DesignItem; part: Product; width: number }[] = []
      dinItems.forEach((it) => {
        const part = productsById[it.productId]
        if (!part) return
        const w = readCapacity(part.capacity).uses?.din ?? 0
        const whole = Math.floor(it.qty)
        for (let k = 0; k < whole; k++) units.push({ item: it, part, width: w })
        const frac = round2(it.qty - whole)
        if (frac > 0) units.push({ item: it, part, width: w * frac })
      })
      const total = Math.max(din.total, din.used)
      const modPx = (W - 16 - 16) / Math.max(1, total)   // width of one module on screen
      const key = `din:${box.uid}`
      const ok = movingFit?.kind === 'din'
      return (
        <div {...target(key, (pl) => dropInto(pl, box.uid, null))}
          title={`DIN rail: ${din.used} of ${din.total} modules used`}
          style={{ height: topH, flex: hasCols ? undefined : 1, position: 'relative', borderRadius: 6, border: `2px solid ${overSpot === key ? 'var(--brand)' : ok ? '#3d8b40' : '#9a9b96'}`, background: 'linear-gradient(170deg, rgba(150,166,180,0.6), rgba(52,63,76,0.82))', overflow: 'hidden', display: 'flex', alignItems: 'center', padding: '0 6px' }}>
          <div style={{ position: 'absolute', left: 4, right: 4, top: '50%', height: 5, transform: 'translateY(-50%)', background: 'linear-gradient(#e2e5e8, #9ea4aa)', borderRadius: 1 }} />
          <div style={{ position: 'relative', display: 'flex', width: '100%', height: '64%', maxHeight: 46 }}>
            {units.map((u, i) => {
              const start = units.slice(0, i).reduce((n, x) => n + x.width, 0)
              const bad = start + u.width > din.total + 0.001
              const label = dinLabel(u.part)
              const blank = label === '' && /cover|blank/i.test(u.part.description)
              return (
                <div key={i}
                  draggable onDragStart={(e) => { e.stopPropagation(); startDrag(e, { kind: 'item', boxUid: box.uid, itemUid: u.item.uid }) }} onDragEnd={endDrag}
                  onClick={(e) => { e.stopPropagation(); setSelected(selected === u.item.uid ? null : u.item.uid) }}
                  title={`${u.part.part_number ?? ''} ${u.part.description}`}
                  style={{ width: `${(u.width / total) * 100}%`, flexShrink: 0, background: bad ? '#f3c4c4' : blank ? '#e6e6e2' : '#fbfbf8', border: `1px solid ${bad ? 'var(--danger)' : '#8f908b'}`, borderRadius: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '3px 0 2px', overflow: 'hidden', cursor: 'grab', outline: selected === u.item.uid ? '2px solid var(--brand)' : 'none' }}>
                  {!blank && <div style={{ width: '42%', minWidth: 3, height: '34%', background: /rcbo|rccb|rcd/i.test(u.part.description) ? '#1d4f91' : '#2b2e33', borderRadius: 1 }} />}
                  {!blank && <div style={{ fontSize: 7, fontWeight: 700, color: '#333', whiteSpace: 'nowrap', lineHeight: 1 }}>{u.width * modPx >= 18 ? label : ''}</div>}
                </div>
              )
            })}
            {din.total - din.used > 0.001 && (
              <div style={{ flex: 1, borderRadius: 2, background: `repeating-linear-gradient(90deg, #dcdcd7 0 calc(100% / ${Math.max(1, Math.round(din.total - din.used))} - 1px), #b9bab4 calc(100% / ${Math.max(1, Math.round(din.total - din.used))} - 1px) calc(100% / ${Math.max(1, Math.round(din.total - din.used))}))`, opacity: 0.85 }} title="Free modules (module covers)" />
            )}
          </div>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(255,255,255,0.32) 0 16%, rgba(255,255,255,0) 30%)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)', width: 14, height: 4, borderRadius: 2, background: '#7d7e79', pointerEvents: 'none' }} />
        </div>
      )
    }

    const renderBlind = () => {
      const key = `seat:${box.uid}:top`
      const ok = movingFit?.kind === 'top'
      return (
        <div {...target(key, (pl) => dropInto(pl, box.uid, ['top']))}
          title="Blind cover. Drop a window cover with DIN rail here (P579451 / P579452 / P579453)."
          style={{ height: topH, borderRadius: 6, background: 'linear-gradient(#d4d5d0, #c6c7c2)', border: `2px ${ok ? 'dashed #3d8b40' : 'solid #a9aaa4'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: ok ? '#3d8b40' : '#7a7b76', fontWeight: 600, textAlign: 'center', padding: 4 }}>
          {ok ? '+ Window cover' : 'Blind cover'}
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: W, flexShrink: 0, opacity: isDragged ? 0.45 : 1 }}>
        <div {...target(boxKey, (pl) => dropInto(pl, box.uid, null))}
          data-box={p.part_number ?? ''}
          onClick={(e) => { if (picked) { e.stopPropagation(); dropInto(picked, box.uid, null) } else setSelected(null) }}
          style={{ position: 'relative', width: W, height: H, borderRadius: 10, background: 'linear-gradient(180deg, #ededea, #d6d7d2)', border: `1px solid ${overSpot === boxKey ? 'var(--brand)' : over.length > 0 ? 'var(--danger)' : '#a6a7a1'}`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -2px 0 rgba(0,0,0,0.06), 0 4px 10px rgba(0,0,0,0.18)${overSpot === boxKey ? ', 0 0 0 3px var(--brand-light)' : ''}`, padding: 8, display: 'flex', flexDirection: 'column', gap: 6, cursor: picked ? 'copy' : undefined }}>
          {[[5, 5], [5, null], [null, 5], [null, null]].map(([t, l], i) => (
            <span key={i} aria-hidden style={{ position: 'absolute', width: 7, height: 7, borderRadius: 99, background: 'radial-gradient(circle at 35% 35%, #f6f6f3, #bdbeb9)', border: '1px solid #a3a49e', top: t ?? undefined, bottom: t == null ? 5 : undefined, left: l ?? undefined, right: l == null ? 5 : undefined }} />
          ))}
          {shape.top === 'window' || cover ? renderWindow() : shape.top === 'blind' ? renderBlind() : null}
          {hasCols && (
            <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${shape.columns.length}, 1fr)`, gap: 5 }}>
              {shape.columns.map((col, c) => {
                const colSeats = seats.filter((s) => s.parent === null && s.id.startsWith(`c${c}`) && (s.id === `c${c}` || s.id.startsWith(`c${c}r`)))
                return (
                  <div key={c} style={{ minHeight: 0, minWidth: 0, borderRadius: 6, background: '#c3c4bf', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.28)', padding: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {col.kind === 'col63' && <div style={{ flex: 0.9, borderRadius: 4, background: '#e9e9e6', border: '1px solid #b0b1ab' }} title="Blocked by the 63A socket below" />}
                    {colSeats.map((s) => <div key={s.id} style={{ flex: col.kind === 'col63' ? 1.1 : 1, display: 'flex', minHeight: 0 }}>{renderSeatContent(s)}</div>)}
                  </div>
                )
              })}
            </div>
          )}
          {!hasCols && shape.top === 'none' && <div style={{ flex: 1, borderRadius: 6, background: '#c3c4bf', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.28)' }} />}
        </div>

        {/* Name and the parts list (tap a part to remove it, change DIN amounts) */}
        <div draggable onDragStart={(e) => startDrag(e, { kind: 'box', uid: box.uid })} onDragEnd={endDrag}
          title="Drag to move this box"
          style={{ display: 'flex', alignItems: 'flex-start', gap: 6, cursor: 'grab' }}>
          <span aria-hidden style={{ color: 'var(--text-3)', fontSize: 12, letterSpacing: -2, marginTop: 1 }}>⋮⋮</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="part-number" style={{ fontSize: 11 }}>{p.part_number}</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.25 }} title={p.description}>{shortName(p)}</div>
          </div>
          <button type="button" aria-label="Remove this box" title="Remove this box and its parts" onClick={(e) => { e.stopPropagation(); removeBox(box.uid) }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-3)', fontSize: 16, lineHeight: 1, padding: 2 }}>×</button>
        </div>
        {box.items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[...box.items].sort((a, b) => Number(a.seat === 'din') - Number(b.seat === 'din')).map((it) => {
              const part = productsById[it.productId]
              if (!part) return null
              const adjustable = it.seat === 'din' || !it.seat
              const step = qtyStep(part)
              return (
                <div key={it.uid} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: 'var(--text-2)', background: selected === it.uid ? 'var(--brand-light)' : undefined, borderRadius: 4 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={part.description}>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--text-1)' }}>{it.qty}×</span> {part.part_number} {shortName(part)}
                  </span>
                  {adjustable && <button type="button" className="btn btn-ghost btn-sm" style={{ height: 18, padding: '0 4px' }} aria-label="One fewer" onClick={() => setItemQty(box.uid, it.uid, round2(it.qty - step))}>−</button>}
                  {adjustable && <button type="button" className="btn btn-ghost btn-sm" style={{ height: 18, padding: '0 4px' }} aria-label="One more" onClick={() => setItemQty(box.uid, it.uid, round2(it.qty + step))}>+</button>}
                  <button type="button" className="btn btn-ghost btn-sm" style={{ height: 18, padding: '0 4px', color: 'var(--text-3)' }} aria-label="Remove" onClick={() => removeItem(box.uid, it.uid)}>×</button>
                </div>
              )
            })}
          </div>
        )}
        {extras.length > 0 && <div style={{ fontSize: 10.5, color: 'var(--text-3)' }}>{extras.length} part{extras.length !== 1 ? 's' : ''} with this box, not in a position</div>}
        {over.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 500 }}>
            {over.map((l) => <div key={l.key}>⚠ {l.label}: {l.used} / {l.provided}</div>)}
          </div>
        )}
      </div>
    )
  }

  const renderRow = (row: DesignRow, rowIdx: number) => {
    const runs = assemblies({ rows: [row] })
    const label = runs.length === 1 && row.boxes.length > 1 ? 'One assembly' : runs.length === row.boxes.length ? (row.boxes.length === 1 ? 'Single box' : `${row.boxes.length} separate boxes`) : `${runs.length} assemblies`
    return (
      <div key={row.id} style={{ marginBottom: 14 }}>
        <div style={{ ...titleStyle, fontSize: 11, marginBottom: 6 }}>Row {rowIdx + 1} · {label}</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', overflowX: 'auto', padding: '14px 4px 10px', userSelect: 'none' }}>
          {renderGap(row.id, 0, false)}
          {row.boxes.map((box, i) => (
            <div key={box.uid} style={{ display: 'flex', alignItems: 'stretch' }}>
              {i > 0 && renderJoint(row.boxes[i - 1], box)}
              {renderBox(box)}
              {renderGap(row.id, i + 1, !!row.boxes[i + 1]?.joinedLeft)}
            </div>
          ))}
        </div>
      </div>
    )
  }


  const pickedName = picked && (picked.kind === 'part' || picked.kind === 'loose') ? productsById[picked.productId]?.description : picked?.kind === 'box' ? 'the box' : picked?.kind === 'item' ? 'the part' : null

  return (
    <>
      {editingQuote && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 16, background: 'var(--warning-bg)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--warning)', fontWeight: 500 }}>
          <span>Editing saved quote: <strong>{editingQuote.project_name}</strong></span>
          <button className="btn btn-sm" onClick={onCancelEdit}>Cancel edit</button>
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 19 }}>Box designer</h2>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3 }}>
          Drag a box onto the wall, then drag parts into it. Each part only goes where it really fits: fixed sockets in socket positions, interlocked sockets and 103x230 flanges in the switched-socket holes, sockets onto flanges and caps, and DIN devices onto the rail behind the window. Green outlines show where the part you're holding can go. Put boxes side by side to join them, or start a new row for a separate box. On a phone, tap a part and then tap where it goes. Tap a placed part to remove it.
        </p>
      </div>

      {missingJoins.length > 0 && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--warning)', borderColor: 'var(--warning)' }}>
          The joining part{missingJoins.length > 1 ? 's' : ''} {missingJoins.join(' and ')} {missingJoins.length > 1 ? 'are' : 'is'} not in the TopTer catalogue, so joined boxes can't add {missingJoins.length > 1 ? 'them' : 'it'}.
        </div>
      )}

      {picked && (
        <div style={{ position: 'sticky', top: 8, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 12px', marginBottom: 12, background: 'var(--brand)', color: '#fff', borderRadius: 'var(--radius-md)', fontSize: 13 }}>
          <span>Placing <strong>{pickedName}</strong>: tap {movingIsBox ? 'a + gap on the wall, or New row' : 'a box'} to put it there.</span>
          <button className="btn btn-sm" onClick={() => setPicked(null)}>Done</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', userSelect: moving ? 'none' : undefined }}>
        {/* Parts to drag */}
        <div className="card designer-palette" style={{ flex: '1 1 280px', minWidth: 0, padding: 12, display: 'flex', flexDirection: 'column' }}>
          <div style={{ ...titleStyle, marginBottom: 8 }}>Parts</div>
          <input className="input input-sm" type="search" placeholder="Search all parts…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
          {!search.trim() && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {PALETTE.map((t) => (
                <button key={t.key} type="button" onClick={() => setTab(t.key)} style={{ border: `1px solid ${tab === t.key ? 'var(--brand)' : 'var(--border-strong)'}`, background: tab === t.key ? 'var(--brand)' : 'var(--surface)', color: tab === t.key ? '#fff' : 'var(--text-2)', borderRadius: 99, padding: '3px 9px', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>{t.label}</button>
              ))}
            </div>
          )}
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {paletteGroups.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Nothing matches.</div>}
            {paletteGroups.map((g) => (
              <div key={g.name || '_'}>
                {g.name && <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>{g.name}</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {g.items.map((p) => {
                    const isPicked = picked?.kind === 'part' && picked.productId === p.id
                    const cap = readCapacity(p.capacity)
                    return (
                      <div key={p.id} draggable onDragStart={(e) => startDrag(e, { kind: 'part', productId: p.id })} onDragEnd={endDrag}
                        onClick={() => setPicked(isPicked ? null : { kind: 'part', productId: p.id })}
                        title={`${p.description}${cap.uses ? ` · uses ${capacityText(cap.uses)}` : ''}${cap.provides ? ` · room for ${capacityText(cap.provides)}` : ''}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 7px', border: `1.5px solid ${isPicked ? 'var(--brand)' : 'var(--border)'}`, borderRadius: 8, background: isPicked ? 'var(--brand-light)' : 'var(--surface)', cursor: 'grab', userSelect: 'none' }}>
                        <PartThumb product={p} size={34} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{p.option_label?.trim() || p.description}</div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                            <span className="part-number" style={{ fontSize: 10 }}>{p.part_number}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{p.factory_cost != null ? fmt(p.factory_cost) : 'TBC'}</span>
                          </div>
                        </div>
                        {(counts[p.id] ?? 0) > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand)' }}>{counts[p.id]}</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* The wall */}
        <div style={{ flex: '3 1 420px', minWidth: 0 }}>
          <div className="card" style={{ padding: 14, marginBottom: 16, background: 'repeating-linear-gradient(0deg, transparent 0 23px, var(--surface-2) 23px 24px), repeating-linear-gradient(90deg, transparent 0 23px, var(--surface-2) 23px 24px), var(--surface)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={titleStyle}>Wall</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-2)' }}>
                {boxCount > 0 && <span>{boxCount} box{boxCount !== 1 ? 'es' : ''} · {assemblyCount} assembl{assemblyCount !== 1 ? 'ies' : 'y'}{joints > 0 ? ` · ${joints} joint${joints !== 1 ? 's' : ''}` : ''}</span>}
                {boxCount > 0 && <button className="btn btn-ghost btn-sm" onClick={clearDesign}>Clear designer</button>}
              </div>
            </div>

            {design.rows.length === 0 && !movingIsBox && (
              <div style={{ padding: '36px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-3)', border: '2px dashed var(--border-strong)', borderRadius: 12 }}>
                Drag a box from <strong>Boxes</strong> here to start.
              </div>
            )}

            {design.rows.map(renderRow)}

            {/* New row: a separate box, not side by side with anything */}
            {movingIsBox && (
              <div {...target('newrow', (p) => dropBox(p, { newRow: true }))}
                style={{ padding: '22px 16px', textAlign: 'center', fontSize: 13, fontWeight: 500, color: overSpot === 'newrow' ? 'var(--brand)' : 'var(--text-2)', border: `2px dashed ${overSpot === 'newrow' ? 'var(--brand)' : 'var(--border-strong)'}`, background: overSpot === 'newrow' ? 'var(--brand-light)' : 'transparent', borderRadius: 12, cursor: picked ? 'copy' : undefined }}>
                {design.rows.length === 0 ? 'Drop the box here' : 'New row: a separate box on its own'}
              </div>
            )}

            {(dragging?.kind === 'box' || dragging?.kind === 'item') && (
              <div {...target('remove', dropRemove)}
                style={{ marginTop: 10, padding: '14px 16px', textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--danger)', border: `2px dashed var(--danger)`, background: overSpot === 'remove' ? 'var(--danger-bg)' : 'transparent', borderRadius: 12 }}>
                🗑 Drop here to remove
              </div>
            )}
          </div>

          {joints > 0 && (
            <div className="card" style={{ padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--text-2)' }}>
              <strong style={{ color: 'var(--text-1)' }}>Joining parts added:</strong>{' '}
              {JOIN_PARTS.map((jp) => `${jp.perJoint * joints}× ${jp.partNumber} (${jp.label})`).join(', ')}
              <span style={{ color: 'var(--text-3)' }}> · {JOIN_PARTS.map((jp) => `${jp.perJoint}× ${jp.partNumber}`).join(' + ')} per joint</span>
            </div>
          )}

          {loose.length > 0 && (
            <div className="card" style={{ padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ ...titleStyle, marginBottom: 4 }}>On the quote, not in a box</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>Added in the list, the step builder or a preset. Drag them into a box to place them; they stay on the quote either way.</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {loose.map(({ p, n }) => {
                  const isPicked = picked?.kind === 'loose' && picked.productId === p.id
                  return (
                    <div key={p.id} draggable onDragStart={(e) => startDrag(e, { kind: 'loose', productId: p.id })} onDragEnd={endDrag}
                      onClick={() => setPicked(isPicked ? null : { kind: 'loose', productId: p.id })}
                      title={p.description}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', border: `1.5px solid ${isPicked ? 'var(--brand)' : 'var(--border-strong)'}`, borderRadius: 99, background: isPicked ? 'var(--brand-light)' : 'var(--surface)', fontSize: 12, cursor: 'grab', userSelect: 'none' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{n}×</span>
                      <span className="part-number" style={{ fontSize: 10 }}>{p.part_number}</span>
                      <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-2)' }}>{shortName(p)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <CapacityPanel products={products} qty={finalQty} />
        </div>
      </div>

      <div className="total-bar" style={{ marginTop: 20 }}>
        <div>
          <div className="total-bar-label">Total quote</div>
          <div className="total-bar-amount">£{pricing.totalQuote.toFixed(2)}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>Factory cost £{factoryCost.toFixed(2)}</div>
          {activeItems.length > 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{activeItems.length} line item{activeItems.length !== 1 ? 's' : ''}</div>}
          {overCapacity.length > 0 && <div style={{ fontSize: 11, color: 'var(--secondary)', fontWeight: 600, marginTop: 2 }}>⚠ Over board capacity</div>}
        </div>
        <div className="total-bar-actions">
          <button className="btn btn-secondary" onClick={onReview}>Review & save</button>
        </div>
      </div>

      {/* Two boxes now side by side: join them or keep them separate? */}
      {ask && askLeft && askRight && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Join these boxes?">
          <div className="modal-box" style={{ maxWidth: 460 }}>
            <h3 style={{ fontSize: 17, marginBottom: 6 }}>Join these boxes?</h3>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>
              These two boxes are side by side. Join them into one assembly, or keep them as separate boxes on the same quote.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 14 }}>
              {[askLeft, askRight].map((p, i) => (
                <div key={i} style={{ flex: 1, maxWidth: 170, padding: 8, border: '2px solid var(--border-strong)', borderRadius: 10, textAlign: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}><PartThumb product={p} size={44} /></div>
                  <div className="part-number" style={{ fontSize: 11 }}>{p.part_number}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>{shortName(p)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px', marginBottom: 16 }}>
              Joining adds {JOIN_PARTS.map((jp) => `${jp.perJoint}× ${jp.partNumber} (${jp.label.toLowerCase()})`).join(' and ')} to the quote.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => answerAsk(false)}>Keep separate</button>
              <button className="btn btn-primary" onClick={() => answerAsk(true)}>Join them</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


// ── Part drawings ─────────────────────────────────────────────
// Simple to-scale-ish pictures of each kind of part, in IEC voltage colours.

const SEAT_NAMES: Record<string, string> = {
  fixed: 'Socket position (65x83 / 88x100)',
  col63: '63A socket position (takes 2 positions)',
  switched: 'Switched-socket seat (103x230)',
  seat115: '63A series seat (115x290)',
  int50: '50x50 socket',
  domo: 'domoTER module',
  f63: '63A socket on the flange',
  top: 'Blind cover',
}

const svgFill = { width: '100%', height: '100%', display: 'block' } as const

// A plain grey flange plate with its 4 screws
function Plate({ children, label }: { children?: React.ReactNode; label?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', borderRadius: 4, background: 'linear-gradient(#f2f2ef, #e2e2de)', border: '1px solid #a5a6a0', padding: '7% 8%', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {[[2, 2], [2, null], [null, 2], [null, null]].map(([t, l], i) => (
        <span key={i} aria-hidden style={{ position: 'absolute', width: 3, height: 3, borderRadius: 99, background: '#9c9d97', top: t ?? undefined, bottom: t == null ? 2 : undefined, left: l ?? undefined, right: l == null ? 2 : undefined }} />
      ))}
      {children}
      {label && <span style={{ margin: 'auto', fontSize: 8, color: '#8a8b86', fontWeight: 600 }}>{label}</span>}
    </div>
  )
}

function FixedSocketSvg({ colour, amps, big }: { colour: string; amps: string; big?: boolean }) {
  const r = big ? 40 : 33
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={svgFill} aria-hidden>
      <rect x="3" y="3" width="94" height="94" rx="9" fill="#f2f2ef" stroke="#a5a6a0" strokeWidth="2" />
      <rect x={50 - r * 0.55} y={54 - r - 7} width={r * 1.1} height="9" rx="3" fill={colour} />
      <circle cx="50" cy="55" r={r} fill={colour} stroke="rgba(0,0,0,0.3)" strokeWidth="2" />
      <circle cx="50" cy="55" r={r * 0.72} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" />
      <text x="50" y="61" textAnchor="middle" fontSize={big ? 20 : 17} fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">{amps ? `${amps}A` : ''}</text>
    </svg>
  )
}

function InterlockedSvg({ colour, amps }: { colour: string; amps: string }) {
  return (
    <svg viewBox="0 0 100 210" preserveAspectRatio="xMidYMid meet" style={svgFill} aria-hidden>
      <rect x="3" y="3" width="94" height="204" rx="10" fill="#f3f3f0" stroke="#a5a6a0" strokeWidth="2" />
      <rect x="28" y="16" width="44" height="9" rx="3" fill={colour} />
      <circle cx="50" cy="64" r="36" fill={colour} stroke="rgba(0,0,0,0.3)" strokeWidth="2" />
      <text x="50" y="71" textAnchor="middle" fontSize="18" fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">{amps ? `${amps}A` : ''}</text>
      <circle cx="50" cy="152" r="30" fill="#3a3d42" stroke="#24262a" strokeWidth="2" />
      <rect x="43" y="118" width="14" height="68" rx="7" fill="#c62828" transform="rotate(-35 50 152)" />
      <circle cx="50" cy="152" r="7" fill="#24262a" />
    </svg>
  )
}

function DomesticSvg({ colour }: { colour: string }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={svgFill} aria-hidden>
      <rect x="6" y="6" width="88" height="88" rx="8" fill={colour} stroke="rgba(0,0,0,0.3)" strokeWidth="2" />
      <circle cx="50" cy="50" r="28" fill="rgba(0,0,0,0.55)" />
      <circle cx="40" cy="50" r="5" fill="#ddd" /><circle cx="60" cy="50" r="5" fill="#ddd" />
    </svg>
  )
}

function DomoModuleSvg() {
  return (
    <svg viewBox="0 0 45 70" preserveAspectRatio="none" style={svgFill} aria-hidden>
      <rect x="1" y="1" width="43" height="68" rx="3" fill="#fbfbf9" stroke="#9a9a96" strokeWidth="1.5" />
      <circle cx="22.5" cy="35" r="10" fill="#d9d9d5" stroke="#9a9a96" />
    </svg>
  )
}

// One part, drawn by what it is. children = the seats it offers (flanges, caps)
function PartDrawing({ part, children }: { part: Product; children: React.ReactNode }) {
  const colour = voltColour(part)
  const amps = ampsOf(part)
  const d = part.description
  const prov = readCapacity(part.capacity).provides ?? {}
  if (part.category === 'Interlocked sockets') return <InterlockedSvg colour={colour} amps={amps} />
  if (part.category === 'Fixed sockets') return <FixedSocketSvg colour={colour} amps={amps} big={amps === '63'} />
  if (prov.domo) {
    // domoTER cap: smoked lid over 2 module spaces
    return (
      <div style={{ flex: 1, minWidth: 0, borderRadius: 5, background: 'linear-gradient(170deg, #9aa3ab, #59626b)', border: '1px solid #4a5158', display: 'flex', position: 'relative' }}>
        {children}
      </div>
    )
  }
  if (readCapacity(part.capacity).uses?.domo) return <DomoModuleSvg />
  if (readCapacity(part.capacity).uses?.int50 || /50x50/i.test(d) && part.category === 'Domestic sockets') return <DomesticSvg colour={/BS1363|United Kingdom/i.test(d) ? '#f4f4f1' : '#1c62c4'} />
  if (part.category === 'Domestic sockets') return <DomesticSvg colour="#f4f4f1" />
  if (/closing flange/i.test(d)) return <Plate label="Closing" />
  if (/extra low voltage/i.test(d)) return <Plate><svg viewBox="0 0 100 100" style={svgFill} aria-hidden><circle cx="50" cy="50" r="28" fill="none" stroke="#7b3fb8" strokeWidth="6" /></svg></Plate>
  if (/adapter/i.test(d)) return <Plate>{children}</Plate>
  return <Plate label={children ? undefined : (part.part_number ?? '')}>{children}</Plate>
}

// ── TopTer: simple list, step-by-step or the box designer ──
export type TopterMode = 'list' | 'steps' | 'designer'

const MODES: { key: TopterMode; label: string; short: string }[] = [
  { key: 'list', label: 'Simple list', short: 'List' },
  { key: 'steps', label: 'Step-by-step', short: 'Steps' },
  { key: 'designer', label: 'Box designer', short: 'Designer' },
]

export function TopterModeSwitch({ mode, onChange }: { mode: TopterMode; onChange: (m: TopterMode) => void }) {
  return (
    <div role="tablist" aria-label="How to build the quote" style={{ display: 'inline-flex', background: 'var(--surface-3)', borderRadius: 99, padding: 3, gap: 2, marginBottom: 14 }}>
      {MODES.map((m) => {
        const active = m.key === mode
        return (
          <button key={m.key} role="tab" aria-selected={active} onClick={() => onChange(m.key)}
            style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 600 : 500, padding: '6px 14px', borderRadius: 99, background: active ? 'var(--surface)' : 'transparent', color: active ? 'var(--brand)' : 'var(--text-2)', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none', whiteSpace: 'nowrap' }}>
            <span className="hide-mobile">{m.label}</span>
            <span className="show-mobile">{m.short}</span>
          </button>
        )
      })}
    </div>
  )
}
