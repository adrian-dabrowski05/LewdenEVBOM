import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { Product, QuantityMap, QuoteFormData, AppSettings, TopterDesign, DesignBox, DesignRow } from '../types'
import { EXTRAS_CATEGORY } from '../types'
import type { ExtrasResult } from '../utils/extras'
import { quotePricing } from '../utils/pricing'
import { capacityUsage, capacityText, readCapacity } from '../utils/capacity'
import { pictureUrl } from '../utils/pictures'
import {
  JOIN_PARTS, isBox, isJoinable, designCounts, missingJoinParts, jointCount, assemblies,
  boxSizeMm, boxLayout, tilesUsed, dinUsed, placeOf, newUid,
} from '../utils/design'
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

  // Joints that need asking: both boxes are distribution boards
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

  const dropOnBox = (payload: Payload, boxUid: string) => {
    const at = findBox(design, boxUid)
    if (!at) return
    if (payload.kind === 'box') {
      if (payload.uid === boxUid) return
      dropBox(payload, { rowId: at.row.id, index: at.index + 1 })
      return
    }
    if (payload.kind === 'item') {
      if (payload.boxUid === boxUid) return
      const next = clone(design)
      const from = findBox(next, payload.boxUid)
      const to = findBox(next, boxUid)
      if (!from || !to) return
      const idx = from.box.items.findIndex((i) => i.uid === payload.itemUid)
      if (idx === -1) return
      const [item] = from.box.items.splice(idx, 1)
      const same = to.box.items.find((i) => i.productId === item.productId)
      if (same) same.qty = round2(same.qty + item.qty)
      else to.box.items.push(item)
      commit(next)
      return
    }
    const p = productsById[payload.productId]
    if (!p) return
    if (isBox(p)) { dropBox(payload, { rowId: at.row.id, index: at.index + 1 }); return }
    // A part from "not in a box" brings all of it that wasn't placed yet, without adding to the quote
    const addQty = payload.kind === 'loose' ? (loose.find((x) => x.p.id === p.id)?.n ?? 0) : qtyStep(p)
    if (addQty <= 0) return
    const next = clone(design)
    const box = findBox(next, boxUid)!.box
    const same = box.items.find((i) => i.productId === p.id)
    if (same) same.qty = round2(same.qty + addQty)
    else box.items.push({ uid: newUid(), productId: p.id, qty: addQty })
    commit(next, payload.kind === 'loose' ? { [p.id]: addQty } : undefined)
  }

  const removeBox = (uid: string) => {
    const lifted = liftBox(design, uid)
    commit(lifted.next)
    queueAsks(lifted.next, lifted.ask)
  }

  const setItemQty = (boxUid: string, itemUid: string, qty: number) => {
    const next = clone(design)
    const at = findBox(next, boxUid)
    if (!at) return
    at.box.items = qty <= 0 ? at.box.items.filter((i) => i.uid !== itemUid) : at.box.items.map((i) => (i.uid === itemUid ? { ...i, qty: round2(qty) } : i))
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
    else if (payload.kind === 'item') setItemQty(payload.boxUid, payload.itemUid, 0)
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
    return (
      <div style={{ position: 'relative', width: 0, alignSelf: 'stretch', zIndex: 2 }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (canJoin) setJoined(right.uid, !joined) }}
          title={!canJoin ? 'Only distribution boards can be joined' : joined ? 'Joined into one assembly. Click to keep them separate.' : 'Separate boxes. Click to join them.'}
          style={{ position: 'absolute', top: '50%', left: 0, transform: 'translate(-50%, -50%)', whiteSpace: 'nowrap', padding: '3px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700, fontFamily: 'inherit', cursor: canJoin ? 'pointer' : 'default', border: `1.5px solid ${joined ? 'var(--brand)' : 'var(--border-strong)'}`, background: joined ? 'var(--brand)' : 'var(--surface)', color: joined ? '#fff' : 'var(--text-3)', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
        >
          {joined ? '⛓ Joined' : canJoin ? 'Separate' : '—'}
        </button>
      </div>
    )
  }

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
    const items = box.items.map((i) => ({ item: i, product: productsById[i.productId] })).filter((x): x is { item: typeof x.item; product: Product } => !!x.product)
    const layout = boxLayout(p, items.map((x) => ({ product: x.product, qty: x.item.qty })))
    const [wMm] = boxSizeMm(p)
    const width = Math.round(Math.max(150, Math.min(290, 110 + wMm * 0.36)))

    // Tiles: each socket / flange takes its tiles, in order
    const tileFill: Product[] = []
    items.forEach(({ product, item }) => { const n = tilesUsed(product) * Math.ceil(item.qty); for (let k = 0; k < n; k++) tileFill.push(product) })
    const tileCount = Math.max(layout.tiles, tileFill.length)
    // DIN rail: each device takes its modules
    const dinFill: { product: Product; width: number }[] = []
    items.forEach(({ product, item }) => { const w = dinUsed(product); if (w > 0) for (let k = 0; k < Math.ceil(item.qty); k++) dinFill.push({ product, width: w * (item.qty < 1 ? item.qty : 1) }) })
    const dinUsedTotal = dinFill.reduce((n, d) => n + d.width, 0)
    const dinCount = Math.max(layout.din, Math.ceil(dinUsedTotal))
    const others = items.filter(({ product }) => placeOf(product) === 'other')

    // This box's own capacity check
    const localQty: QuantityMap = { [p.id]: 1 }
    items.forEach(({ product, item }) => { localQty[product.id] = (localQty[product.id] ?? 0) + item.qty })
    const localProducts = [p, ...items.map((x) => x.product).filter((x, i, a) => x.id !== p.id && a.indexOf(x) === i)]
    const over = capacityUsage(localProducts, localQty).filter((l) => l.over)

    const key = `box:${box.uid}`
    const hot = overSpot === key
    const takes = movingIntoBox
    const isDragged = dragging?.kind === 'box' && dragging.uid === box.uid

    return (
      <div
        {...target(key, (pl) => dropOnBox(pl, box.uid))}
        style={{ width, flexShrink: 0, position: 'relative', background: 'var(--surface)', border: `2px solid ${hot ? 'var(--brand)' : over.length > 0 ? 'var(--danger)' : 'var(--border-strong)'}`, borderRadius: 12, boxShadow: hot ? '0 0 0 4px var(--brand-light)' : '0 2px 6px rgba(0,0,0,0.08)', opacity: isDragged ? 0.45 : 1, cursor: picked && takes ? 'copy' : undefined, transition: 'box-shadow 0.12s' }}
      >
        {/* Handle: drag the box by its top bar */}
        <div
          draggable
          onDragStart={(e) => startDrag(e, { kind: 'box', uid: box.uid })}
          onDragEnd={endDrag}
          title="Drag to move this box"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: 'var(--surface-3)', borderRadius: '10px 10px 0 0', cursor: 'grab', borderBottom: '1px solid var(--border)' }}
        >
          <span aria-hidden style={{ color: 'var(--text-3)', fontSize: 12, letterSpacing: -2 }}>⋮⋮</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="part-number" style={{ fontSize: 11 }}>{p.part_number}</div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }} title={p.description}>{shortName(p)}</div>
          </div>
          <button type="button" aria-label="Remove this box" title="Remove this box and its parts" onClick={(e) => { e.stopPropagation(); removeBox(box.uid) }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-3)', fontSize: 16, lineHeight: 1, padding: 2 }}>×</button>
        </div>

        <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tileCount > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(tileCount, Math.max(1, Math.floor((width - 16) / 50)))}, 1fr)`, gap: 4 }}>
              {Array.from({ length: tileCount }).map((_, i) => {
                const fill = tileFill[i]
                const extra = i >= layout.tiles
                const url = fill ? pictureUrl(fill.image_url) : null
                return (
                  <div key={i} title={fill ? `${fill.part_number ?? ''} ${fill.description}` : 'Free socket position'} style={{ aspectRatio: '1', borderRadius: 6, border: `1.5px ${fill ? 'solid' : 'dashed'} ${extra ? 'var(--danger)' : fill ? 'var(--brand)' : 'var(--border-strong)'}`, background: extra ? 'var(--danger-bg)' : fill ? '#fff' : 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text-2)', textAlign: 'center', padding: 2 }}>
                    {fill ? (url ? <img src={url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : (fill.part_number ?? '•')) : ''}
                  </div>
                )
              })}
            </div>
          )}

          {dinCount > 0 && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 2 }}>DIN rail · {round2(dinUsedTotal)} / {layout.din} modules</div>
              <div style={{ display: 'flex', height: 26, border: '1px solid var(--border-strong)', borderRadius: 4, overflow: 'hidden', background: 'repeating-linear-gradient(90deg, var(--surface-2) 0 calc(100% / ' + dinCount + ' - 1px), var(--border) calc(100% / ' + dinCount + ' - 1px) calc(100% / ' + dinCount + '))' }}>
                {dinFill.map((d, i) => {
                  const startAt = dinFill.slice(0, i).reduce((n, x) => n + x.width, 0)
                  const extra = startAt + d.width > layout.din
                  return (
                    <div key={i} title={`${d.product.part_number ?? ''} ${d.product.description}`} style={{ width: `${(d.width / dinCount) * 100}%`, flexShrink: 0, background: extra ? 'var(--danger)' : 'var(--brand)', borderRight: '1px solid #fff', color: '#fff', fontSize: 8, fontFamily: 'var(--mono)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {d.width >= 2 ? (d.product.part_number ?? '').replace(/^[PB]/, '') : ''}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {tileCount === 0 && dinCount === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', padding: '10px 4px', textAlign: 'center', border: '1.5px dashed var(--border-strong)', borderRadius: 6 }}>Drop parts here</div>
          )}

          {others.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {others.map(({ product, item }) => (
                <span key={item.uid} title={product.description} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 99, background: 'var(--surface-3)', color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>{item.qty}× {product.part_number}</span>
              ))}
            </div>
          )}

          {/* Parts in this box: drag to another box, or change the amount */}
          {items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
              {items.map(({ item, product }) => {
                const step = qtyStep(product)
                return (
                  <div key={item.uid} draggable onDragStart={(e) => { e.stopPropagation(); startDrag(e, { kind: 'item', boxUid: box.uid, itemUid: item.uid }) }} onDragEnd={endDrag}
                    title={`${product.description} · drag to another box`}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'grab' }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{item.qty}×</span> {product.part_number} <span style={{ color: 'var(--text-3)' }}>{shortName(product)}</span>
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ height: 20, padding: '0 5px' }} aria-label="One fewer" onClick={(e) => { e.stopPropagation(); setItemQty(box.uid, item.uid, round2(item.qty - step)) }}>−</button>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ height: 20, padding: '0 5px' }} aria-label="One more" onClick={(e) => { e.stopPropagation(); setItemQty(box.uid, item.uid, round2(item.qty + step)) }}>+</button>
                  </div>
                )
              })}
            </div>
          )}

          {over.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 500 }}>
              {over.map((l) => <div key={l.key}>⚠ {l.label}: {l.used} / {l.provided}</div>)}
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderRow = (row: DesignRow, rowIdx: number) => {
    const runs = assemblies({ rows: [row] })
    const label = runs.length === 1 && row.boxes.length > 1 ? 'One assembly' : runs.length === row.boxes.length ? (row.boxes.length === 1 ? 'Single box' : `${row.boxes.length} separate boxes`) : `${runs.length} assemblies`
    return (
      <div key={row.id} style={{ marginBottom: 14 }}>
        <div style={{ ...titleStyle, fontSize: 11, marginBottom: 6 }}>Row {rowIdx + 1} · {label}</div>
        <div style={{ display: 'flex', alignItems: 'stretch', overflowX: 'auto', padding: '4px 4px 10px', userSelect: 'none' }}>
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
          Drag a box onto the wall, then drag sockets, flanges and DIN devices into it. Put boxes side by side to join them into one assembly, or start a new row for a separate box. On a phone, tap a part and then tap where it goes.
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
