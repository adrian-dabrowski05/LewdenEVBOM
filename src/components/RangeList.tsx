import { useMemo, useState, type ReactNode } from 'react'
import type { Product } from '../types'
import { Stepper, fmt } from './QuoteBuilder'
import { CapacityNote } from './CapacityPanel'
import { PartThumb } from './PartPicture'
import { useSectionConfig } from '../utils/sections'
import { partBlocks, rangeSizes, optionLabel, voltageColour, type PartBlock } from '../utils/ranges'

// TopTer: parts listed by range. Variants of one product sit under one card with
// the range's picture; everything else is a card of its own. Used by both the
// simple list and the step-by-step builder.

export interface RangeListProps {
  items: Product[]                              // the parts to show, in order
  all: Product[]                                // every part in the section (for range sizes)
  qtyOf: (id: string) => number                 // quantity the rep entered
  onQuoteOf: (id: string) => number             // quantity on the quote (after extras)
  setQty: (id: string, n: number) => void
  blockedOf: (p: Product) => boolean            // can't be added: clashes with the quote
  clashOf: (p: Product) => boolean              // on the quote and clashing
  partNumberOf: (p: Product) => string | null
  renderDetails: (p: Product) => ReactNode      // prerequisites, clashes, variant pickers…
  openAll?: boolean                             // searching or filtering: show every match
}

export default function RangeList(props: RangeListProps) {
  const sizes = useMemo(() => rangeSizes(props.all), [props.all])
  const blocks = useMemo(() => partBlocks(props.items, sizes), [props.items, sizes])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {blocks.map((b) => b.kind === 'range'
        ? <RangeCard key={`range:${b.key}`} block={b} {...props} />
        : <SingleCard key={b.part.id} p={b.part} {...props} />)}
    </div>
  )
}

// Coloured dot for the voltage of a CEE socket (yellow 110V, blue 230V, red 400V…)
export function VoltageDot({ product }: { product: Product }) {
  const v = voltageColour(product)
  if (!v) return null
  return (
    <span
      role="img"
      aria-label={`${v.name}: ${v.volts}`}
      title={`${v.name}: ${v.volts}`}
      style={{ width: 12, height: 12, borderRadius: 99, background: v.colour, border: '1px solid rgba(0,0,0,0.28)', display: 'inline-block', flexShrink: 0, marginTop: 4 }}
    />
  )
}

// Notes split into sentences, so sentences every variant shares can be shown once
const sentences = (notes?: string | null): string[] =>
  (notes ?? '').replace(/\.\s+/g, '.\u0000').split('\u0000').map((x) => x.trim()).filter(Boolean)

function PartNumberAndCost({ p, pn, inline = false }: { p: Product; pn: string | null; inline?: boolean }) {
  return (
    <div style={inline
      ? { display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto', minWidth: 160 }
      : { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
      {pn && <span className="part-number">{pn}</span>}
      <span style={{ fontSize: 13 }}>{p.factory_cost != null ? fmt(p.factory_cost) : <span className="cost-tbc">TBC</span>}<span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 3 }}>each</span></span>
    </div>
  )
}

function QuantityAndTotal({ p, props }: { p: Product; props: RangeListProps }) {
  const qty = props.qtyOf(p.id)
  const onQuote = props.onQuoteOf(p.id)
  const lineTotal = p.factory_cost != null && onQuote > 0 ? p.factory_cost * onQuote : null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
      <Stepper value={qty} onChange={(n) => props.setQty(p.id, n)} disabled={props.blockedOf(p)} />
      <div className={onQuote > 0 ? undefined : 'hide-mobile'} style={{ minWidth: 72, textAlign: 'right', fontWeight: 600, fontSize: 14 }}>
        {lineTotal != null ? fmt(lineTotal) : onQuote > 0 ? <span className="cost-tbc">TBC</span> : <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>—</span>}
      </div>
    </div>
  )
}

function SingleCard({ p, ...props }: RangeListProps & { p: Product }) {
  const cfg = useSectionConfig()
  const qty = props.qtyOf(p.id)
  const blocked = props.blockedOf(p)
  return (
    <div style={{ padding: '10px 12px', border: `1.5px solid ${props.clashOf(p) ? 'var(--danger)' : qty > 0 ? 'var(--brand)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', background: blocked ? 'var(--surface-3)' : qty > 0 ? 'var(--brand-light)' : 'var(--surface)', opacity: blocked ? 0.7 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <PartThumb product={p} size={56} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <VoltageDot product={p} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: qty > 0 ? 600 : 500 }}>{p.description}</div>
              <PartNumberAndCost p={p} pn={props.partNumberOf(p)} />
              {cfg.usesCapacity && <CapacityNote product={p} />}
              {p.notes && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{p.notes}</div>}
              {props.renderDetails(p)}
            </div>
          </div>
          <QuantityAndTotal p={p} props={props} />
        </div>
      </div>
    </div>
  )
}

function RangeCard({ block, ...props }: RangeListProps & { block: Extract<PartBlock, { kind: 'range' }> }) {
  const [open, setOpen] = useState(false)
  const { parts, total, name } = block
  const short = total <= 3
  const showAll = open || !!props.openAll || short
  const chosen = parts.filter((p) => props.qtyOf(p.id) > 0 || props.onQuoteOf(p.id) > 0)
  const rows = showAll ? parts : chosen
  const lead = parts.find((p) => p.image_url?.trim()) ?? parts[0]
  const leadPicture = lead.image_url?.trim() || null
  const clash = parts.some((p) => props.clashOf(p))
  const canToggle = !short && !props.openAll
  const toggle = () => { if (canToggle) setOpen((o) => !o) }
  const shared = parts.length > 1 ? sentences(parts[0].notes).filter((x) => parts.every((p) => sentences(p.notes).includes(x))) : []
  const ownNote = (p: Product) => sentences(p.notes).filter((x) => !shared.includes(x)).join(' ')

  return (
    <div style={{ border: `1.5px solid ${clash ? 'var(--danger)' : chosen.length > 0 ? 'var(--brand)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', background: 'var(--surface)', overflow: 'hidden' }}>
      <div
        onClick={toggle}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', cursor: canToggle ? 'pointer' : 'default', background: chosen.length > 0 ? 'var(--brand-light)' : undefined }}
      >
        <PartThumb product={lead} size={64} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 3, fontSize: 12, color: 'var(--text-3)' }}>
            <span>{parts.length < total ? `${parts.length} of ${total} variants match` : `${total} variants`}</span>
            {chosen.length > 0 && (
              <span style={{ background: 'var(--brand)', color: '#fff', borderRadius: 99, padding: '1px 8px', fontSize: 10, fontWeight: 700 }}>{chosen.length} on quote</span>
            )}
          </div>
          {shared.length > 0 && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{shared.join(' ')}</div>}
        </div>
        {canToggle && (
          <button
            type="button"
            className="btn btn-sm"
            aria-expanded={showAll}
            onClick={(e) => { e.stopPropagation(); toggle() }}
            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            {showAll ? 'Hide' : 'Show all'}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ transform: showAll ? 'rotate(180deg)' : undefined }}><path d="M4 6l4 4 4-4" /></svg>
          </button>
        )}
      </div>
      {rows.map((p) => {
        const qty = props.qtyOf(p.id)
        const blocked = props.blockedOf(p)
        const ownPicture = p.image_url?.trim() || null
        const note = ownNote(p)
        return (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderTop: '1px solid var(--border)', background: props.clashOf(p) ? 'var(--danger-bg)' : blocked ? 'var(--surface-3)' : qty > 0 ? 'var(--brand-light)' : undefined, opacity: blocked ? 0.7 : 1 }}>
            {ownPicture && ownPicture !== leadPicture && <PartThumb product={p} size={40} />}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px 14px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <VoltageDot product={p} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: qty > 0 ? 600 : 500 }}>{optionLabel(p)}</div>
                  {note && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{note}</div>}
                  {props.renderDetails(p)}
                </div>
              </div>
              <PartNumberAndCost p={p} pn={props.partNumberOf(p)} inline />
              <QuantityAndTotal p={p} props={props} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
