import { useState, useMemo } from 'react'
import type {
  Product, ProductVariant, ProductPrerequisite, Preset,
  QuantityMap, VariantSelectionMap, AutoAddedMap,
  QuoteFormData, AppSettings, Extra, BuildContext, ExtraCostMap,
} from '../types'
import { EXTRAS_CATEGORY } from '../types'
import { printQuote } from '../utils/printQuote'
import type { ExtrasResult } from '../utils/extras'
import { toQuoteExtras } from '../utils/extras'
import { quotePricing } from '../utils/pricing'
import type { EditingQuote } from '../App'
import { Stepper, PresetsBar, ExtraRow, BuildContextFields, getDisplayPartNumber, fmt, MoveButtons, ReorderToggle, ReorderBanner, ProfitRebateRows } from './QuoteBuilder'

// Step-by-step quote builder. Uses the same BOM, extras and quote details as the
// full Quote builder, so a rep can switch between the two at any time.

interface Props {
  products: Product[]
  loading: boolean
  variants: ProductVariant[]
  prerequisites: ProductPrerequisite[]
  autoAdded: AutoAddedMap
  quantities: QuantityMap
  setQty: (id: string, qty: number) => void
  variantSelections: VariantSelectionMap
  setVariantSelection: (productId: string, variantId: string) => void
  quoteForm: QuoteFormData
  setQuoteForm: (f: QuoteFormData) => void
  onSave: (f: QuoteFormData, asNew?: boolean) => Promise<boolean>
  showToast: (msg: string, type?: 'success' | 'error') => void
  presets: Preset[]
  onApplyPreset: (preset: Preset, configurationId?: string) => void
  settings: AppSettings
  extras: Extra[]
  selectedExtras: Set<string>
  onToggleExtra: (extraId: string) => void
  onSetExtraCount: (extraId: string, count: number) => void
  extraCosts: ExtraCostMap
  onSetExtraCost: (extraId: string, value: string) => void
  onClearExtras: () => void
  extrasResult: ExtrasResult
  buildContext: BuildContext
  setBuildContext: (ctx: BuildContext) => void
  editingQuote: EditingQuote | null
  onCancelEdit: () => void
  isAdmin: boolean
  onMoveProduct: (productId: string, groupIds: string[], dir: -1 | 1) => void
  onMoveExtra: (extraId: string, groupIds: string[], dir: -1 | 1) => void
  reordering: boolean
}

// ── Where every part and extra goes ────────────────────────────

type SectionKey = 'steelwork' | 'incomer' | 'distribution' | 'outgoing' | 'accessories' | 'review'
type SteelKey = 'material' | 'internals' | 'gasket' | 'label' | 'root' | 'other'

const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: 'steelwork', label: 'Steelwork', hint: 'The cabinet, step by step.' },
  { key: 'incomer', label: 'Incomer', hint: 'Incoming supply, surge protection, PEN fault protection and metering.' },
  { key: 'distribution', label: 'Distribution', hint: 'Copper bars and busbar assemblies, then the insulators for them.' },
  { key: 'outgoing', label: 'Outgoing', hint: 'MCBs and RCDs for the outgoing circuits.' },
  { key: 'accessories', label: 'Accessories', hint: 'Everything else.' },
  { key: 'review', label: 'Review & save', hint: 'Check the quote details, labour and totals, then save.' },
]

const STEEL_STEPS: { key: SteelKey; label: string; hint: string }[] = [
  { key: 'material', label: 'Material', hint: 'Pick the cabinet and its colour (the variant). Start from a preset if you like, and set the rating, material and size so the right extras are offered.' },
  { key: 'internals', label: 'Internals', hint: 'Gear trays, mounting plates, brackets and DIN rail.' },
  { key: 'label', label: 'Danger label', hint: 'Danger and warning labels.' },
  { key: 'root', label: 'Root', hint: 'The root (base) the pillar stands in.' },
  { key: 'other', label: 'Other steelwork', hint: 'Steelwork parts that did not fit one of the steps above.' },
]

// Steelwork parts are sorted into steps by words in their description, part number
// or notes. Checked in this order, so "Stainless root" lands in Root, not Material.
const STEEL_RULES: [SteelKey, RegExp][] = [
  // Gaskets are prerequisites of the cabinets, so they have no step of their own:
  // they are caught here and not listed (they still show on the Review page)
  ['gasket', /gasket|rubber|seal/i],
  ['label', /label|danger|warning|sticker|sign\b/i],
  ['root', /\broots?\b|plinth|ground|buried|base frame/i],
  ['internals', /internal|gear ?tray|mounting plate|back ?plate|chassis|din ?rail|bracket|gland/i],
  ['material', /cabinet|enclosure|pillar|\bsize ?\d|housing|body|zintec|stainless|mild steel|door|kiosk/i],
]

// Copper bars first: busbar assemblies, and copper/busbar parts that aren't
// supports or shrouds. Everything else goes under "Other insulators".
const DISTRIBUTION_GROUPS: [string, RegExp][] = [
  ['Copper bars', /assembl|^(?!.*(support|insulator|shroud|stand ?-?off|cover|guard|barrier)).*(copper|bus ?bar|\bbar\b|link)/i],
]

const OUTGOING_GROUPS: [string, RegExp][] = [
  ['RCDs', /\brcd|rccb|rcbo|residual/i],
  ['MCBs', /\bmcb|miniature circuit|circuit breaker/i],
]

// Which (sub)step each extra's tick box sits in, by extra number.
// Anything not listed here goes by name (see placeOfExtra below).
const EXTRA_PLACES: Record<number, string> = {
  11: 'steelwork.material',   // Brushed stainless finish
  10: 'steelwork.material',   // Non-standard colour (colour is picked as the cabinet's variant)
  13: 'steelwork.material',   // Zinc rich base coat primer
  2: 'incomer',               // Type 1 surge protection
  3: 'incomer',               // MCCB incomer
  4: 'incomer',               // Open PEN fault protection
  9: 'incomer',               // MID meter
  1: 'outgoing',              // Number and mix of outgoing circuits
  5: 'outgoing',              // Type B RCD
  6: 'outgoing',              // 13A RCBO socket
  8: 'outgoing',              // Photocell external lighting circuit
  7: 'accessories',           // Internal cabinet light
  12: 'accessories',          // Future proofing
}

// Extras not listed above go by their name: surge extras sit in Incomer (after the
// others there), busbar extras at the bottom of Distribution, anything else in Accessories
function placeOfExtra(e: Extra): string {
  if (EXTRA_PLACES[e.number]) return EXTRA_PLACES[e.number]
  const text = `${e.name} ${e.description ?? ''}`
  if (/surge/i.test(text)) return 'incomer'
  if (/bus ?-?bar|\bbar\b|copper/i.test(text)) return 'distribution'   // shown under the Distribution parts
  return 'accessories'
}

const SECTION_CATEGORIES: Partial<Record<SectionKey, string[]>> = {
  steelwork: ['Steelworks'],
  incomer: ['Incomers', 'PEN Fault Protection'],
  distribution: ['Distribution'],
  outgoing: ['Outgoing'],
}

// Sorting looks at the part's name (description + part number) first. Notes are only
// used when the name matches nothing, so a note like "includes internals" on a
// pillar doesn't pull the pillar into the Internals step.
const nameOf = (p: Product) => `${p.description} ${p.part_number ?? ''}`

function firstMatch<K>(p: Product, rules: [K, RegExp][]): K | null {
  for (const text of [nameOf(p), p.notes ?? '']) {
    if (!text.trim()) continue
    for (const [key, re] of rules) if (re.test(text)) return key
  }
  return null
}

function sectionOf(p: Product): SectionKey {
  for (const [key, cats] of Object.entries(SECTION_CATEGORIES)) {
    if (cats?.includes(p.category)) return key as SectionKey
  }
  return 'accessories'
}

function steelStepOf(p: Product): SteelKey {
  return firstMatch(p, STEEL_RULES) ?? 'other'
}

function groupBy(items: Product[], rules: [string, RegExp][], otherLabel: string) {
  const groups: { label: string; items: Product[] }[] = [...rules.map(([label]) => ({ label, items: [] as Product[] })), { label: otherLabel, items: [] }]
  items.forEach((p) => {
    const label = firstMatch(p, rules)
    const i = label == null ? -1 : rules.findIndex(([l]) => l === label)
    groups[i === -1 ? groups.length - 1 : i].items.push(p)
  })
  return groups.filter((g) => g.items.length > 0)
}

const sectionTitleStyle = { fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 10 } as const

export default function StepBuilder({
  products, loading, variants, prerequisites, autoAdded,
  quantities, setQty, variantSelections, setVariantSelection,
  quoteForm, setQuoteForm, onSave, showToast,
  presets, onApplyPreset, settings,
  extras, selectedExtras, onToggleExtra, onSetExtraCount, extraCosts, onSetExtraCost, onClearExtras, extrasResult, buildContext, setBuildContext,
  editingQuote, onCancelEdit,
  isAdmin, onMoveProduct, onMoveExtra, reordering,
}: Props) {
  const [sectionIdx, setSectionIdx] = useState(0)
  const [reorderToggle, setReorderToggle] = useState(false)
  const reorderMode = isAdmin && reorderToggle
  const [steelKey, setSteelKey] = useState<SteelKey>('material')
  const [saving, setSaving] = useState(false)

  const section = SECTIONS[sectionIdx].key

  const productsById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])) as Record<string, Product>, [products])
  const variantsById = useMemo(() => Object.fromEntries(variants.map((v) => [v.id, v])) as Record<string, ProductVariant>, [variants])
  const prereqsByProduct = useMemo(() => {
    const map: Record<string, ProductPrerequisite[]> = {}
    prerequisites.forEach((pr) => { (map[pr.product_id] ??= []).push(pr) })
    return map
  }, [prerequisites])

  const variantsByProduct = useMemo(() => {
    const map: Record<string, ProductVariant[]> = {}
    variants.forEach((v) => { (map[v.product_id] ??= []).push(v) })
    return map
  }, [variants])

  // Extras-only parts are added through the extras tick boxes, not picked from a list
  const catalogue = useMemo(() => products.filter((p) => p.category !== EXTRAS_CATEGORY), [products])

  const bySection = useMemo(() => {
    const map: Record<SectionKey, Product[]> = { steelwork: [], incomer: [], distribution: [], outgoing: [], accessories: [], review: [] }
    catalogue.forEach((p) => map[sectionOf(p)].push(p))
    return map
  }, [catalogue])

  const bySteelStep = useMemo(() => {
    const map: Record<SteelKey, Product[]> = { material: [], internals: [], gasket: [], label: [], root: [], other: [] }
    bySection.steelwork.forEach((p) => map[steelStepOf(p)].push(p))
    return map
  }, [bySection])

  // "Other steelwork" only shows when something lands there
  const steelSteps = STEEL_STEPS.filter((s) => s.key !== 'other' || bySteelStep.other.length > 0)
  const steelIdx = Math.max(0, steelSteps.findIndex((s) => s.key === steelKey))

  const extrasByPlace = useMemo(() => {
    const map: Record<string, Extra[]> = {}
    // Placed extras first, then the ones placed by name, so new ones sit at the bottom
    const known = extras.filter((e) => EXTRA_PLACES[e.number] != null)
    const added = extras.filter((e) => EXTRA_PLACES[e.number] == null)
    ;[...known, ...added].forEach((e) => { (map[placeOfExtra(e)] ??= []).push(e) })
    return map
  }, [extras])

  const appliedById = Object.fromEntries(extrasResult.applied.map((a) => [a.extra.id, a]))

  // ── Totals (same sums as the full builder) ──
  const finalQty = extrasResult.effectiveQty
  const activeItems = products.filter((p) => (finalQty[p.id] ?? 0) > 0)
  const activeCount = activeItems.length
  const materialsSubtotal = activeItems.reduce((sum, p) => sum + (p.factory_cost != null ? p.factory_cost * (finalQty[p.id] ?? 0) : 0), 0)
    + extrasResult.repHardwareCost   // rep-entered extra costs that count as hardware
  const defaultUpliftPct = settings.hardware_uplift_pct
  const upliftPct = quoteForm.uplift_pct.trim() === '' ? defaultUpliftPct : (parseFloat(quoteForm.uplift_pct) || 0)
  const hardwareUpliftAmount = materialsSubtotal * upliftPct / 100
  const extrasLabourMinutes = extrasResult.labourMinutes
  const labourMinutes = (parseFloat(quoteForm.labour_minutes) || 0) + extrasLabourMinutes
  const labourRate = settings.labour_rate_per_min
  const labourTotal = labourMinutes * labourRate
  // Rep-entered extra costs (e.g. non-standard colour) go on at face value, after uplift and labour
  const costedExtras = extrasResult.applied.filter((a) => a.cost > 0 && !a.extra.rep_cost_uplift)   // hardware ones are already in materials
  const carriage = Math.max(0, parseFloat(quoteForm.carriage) || 0)
  const factoryCost = materialsSubtotal + hardwareUpliftAmount + labourTotal + extrasResult.repCost
  // Carriage stays out of the factory cost: no profit or rebate on it, added after the rebate
  const pricing = quotePricing(factoryCost, quoteForm.gp_pct, quoteForm.rebate_pct, carriage)

  const missingVariants = activeItems.filter((p) => (variantsByProduct[p.id]?.length ?? 0) > 0 && !variantSelections[p.id])

  const countIn = (items: Product[]) => items.filter((p) => (quantities[p.id] ?? 0) > 0).length
  const tickedIn = (place: string) => (extrasByPlace[place] ?? []).filter((e) => appliedById[e.id]).length
  const sectionCount = (key: SectionKey) => {
    if (key === 'review') return 0
    const extrasTicked = key === 'steelwork'
      ? STEEL_STEPS.reduce((n, s) => n + tickedIn(`steelwork.${s.key}`), 0)
      : tickedIn(key)
    return countIn(bySection[key]) + extrasTicked
  }

  // ── Navigation ──
  const goToSection = (idx: number) => {
    setSectionIdx(idx)
    if (SECTIONS[idx].key === 'steelwork') setSteelKey('material')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const next = () => {
    if (section === 'steelwork' && steelIdx < steelSteps.length - 1) { setSteelKey(steelSteps[steelIdx + 1].key); window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    if (sectionIdx < SECTIONS.length - 1) goToSection(sectionIdx + 1)
  }
  const back = () => {
    if (section === 'steelwork' && steelIdx > 0) { setSteelKey(steelSteps[steelIdx - 1].key); window.scrollTo({ top: 0, behavior: 'smooth' }); return }
    if (sectionIdx > 0) {
      const prevIdx = sectionIdx - 1
      setSectionIdx(prevIdx)
      if (SECTIONS[prevIdx].key === 'steelwork') setSteelKey(steelSteps[steelSteps.length - 1].key)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }
  const isFirst = sectionIdx === 0 && steelIdx === 0
  const isLast = section === 'review'
  const nextLabel = section === 'steelwork' && steelIdx < steelSteps.length - 1
    ? `Next: ${steelSteps[steelIdx + 1].label}`
    : sectionIdx < SECTIONS.length - 1 ? `Next: ${SECTIONS[sectionIdx + 1].label}` : ''

  // ── Actions ──
  const handleClear = () => {
    if (activeCount === 0 && selectedExtras.size === 0) return
    if (confirm('Clear all quantities and extras?')) { products.forEach((p) => setQty(p.id, 0)); onClearExtras() }
  }

  const handleSave = async (asNew = false) => {
    if (activeCount === 0) { showToast('Add at least one item first', 'error'); return }
    if (!quoteForm.project_name.trim()) { showToast('Project name is required', 'error'); return }
    setSaving(true)
    const ok = await onSave(quoteForm, asNew)
    setSaving(false)
    if (ok) { setSectionIdx(0); setSteelKey('material') }
  }

  const setUplift = (value: string) => {
    if (value.trim() !== '') {
      const n = parseFloat(value)
      if (!isNaN(n) && (n < 0 || n > 100)) return
    }
    setQuoteForm({ ...quoteForm, uplift_pct: value })
  }

  const setCarriage = (value: string) => {
    if (value.trim() !== '') {
      const n = parseFloat(value)
      if (!isNaN(n) && n < 0) return
    }
    setQuoteForm({ ...quoteForm, carriage: value })
  }

  const handlePdf = () => {
    if (activeCount === 0) { showToast('Add at least one item first', 'error'); return }
    printQuote({
      form: { project_name: quoteForm.project_name, customer_name: quoteForm.customer_name, mo_number: quoteForm.mo_number, notes: quoteForm.notes },
      items: activeItems.map((p) => {
        const selectedVariant = variantSelections[p.id] ? variantsById[variantSelections[p.id]] : null
        return {
          description: p.description,
          part_number: getDisplayPartNumber(p, selectedVariant ?? null),
          factory_cost: p.factory_cost,
          quantity: finalQty[p.id],
          line_total: p.factory_cost != null ? p.factory_cost * finalQty[p.id] : null,
          variant_label: selectedVariant?.label ?? null,
        }
      }),
      extras: toQuoteExtras(extrasResult.applied),
      materialsSubtotal, hardwareUpliftPct: upliftPct, hardwareUpliftAmount,
      labourMinutes, labourRatePerMin: labourRate, labourTotal, carriage, pricing,
      baseUrl: (import.meta as any).env.BASE_URL,
    })
  }

  // ── Pieces ──
  const renderPart = (p: Product, idx: number, group: Product[]) => {
    const qty = quantities[p.id] ?? 0
    const onQuote = finalQty[p.id] ?? 0
    const lineTotal = p.factory_cost != null && onQuote > 0 ? p.factory_cost * onQuote : null
    const pvs = variantsByProduct[p.id] ?? []
    const selectedId = variantSelections[p.id] ?? ''
    const selectedVariant = selectedId ? variantsById[selectedId] : null
    const displayPN = getDisplayPartNumber(p, selectedVariant ?? null)
    const autoParents = Object.keys(autoAdded[p.id] ?? {}).map((id) => productsById[id]?.description ?? 'another part')
    const diff = extrasResult.delta[p.id]
    return (
      <div key={p.id} style={{ padding: '10px 12px', border: `1.5px solid ${qty > 0 ? 'var(--brand)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', background: qty > 0 ? 'var(--brand-light)' : 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {reorderMode && (
          <MoveButtons index={idx} count={group.length} disabled={reordering} onMove={(dir) => onMoveProduct(p.id, group.map((g) => g.id), dir)} />
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: qty > 0 ? 600 : 500 }}>{p.description}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              {displayPN && <span className="part-number">{displayPN}</span>}
              <span style={{ fontSize: 13 }}>{p.factory_cost != null ? fmt(p.factory_cost) : <span className="cost-tbc">TBC</span>}<span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 3 }}>each</span></span>
            </div>
            {p.notes && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{p.notes}</div>}
            {qty > 0 && (prereqsByProduct[p.id]?.length ?? 0) > 0 && (
              <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--success-bg)', border: '1px solid var(--success)', borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--success)', fontWeight: 500, maxWidth: 420 }}>
                <span style={{ marginRight: 4 }}>✓</span>Auto-included:&nbsp;
                {prereqsByProduct[p.id].map((pr, i) => {
                  const prereqProduct = productsById[pr.prerequisite_product_id]
                  const label = pr.note || `${prereqProduct?.description ?? 'Unknown'} ×${pr.quantity}`
                  return <span key={pr.id}>{i > 0 ? ', ' : ''}<strong>{label}</strong></span>
                })}
              </div>
            )}
            {autoParents.length > 0 && qty > 0 && (
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--success)', marginTop: 4 }}>✓ Auto-added via {autoParents.slice(0, 2).join(', ')}{autoParents.length > 2 ? ` +${autoParents.length - 2} more` : ''}</div>
            )}
            {diff ? (
              <div style={{ fontSize: 11, fontWeight: 600, color: diff < 0 ? 'var(--danger)' : 'var(--brand)', marginTop: 4 }}>{diff < 0 ? diff : `+${diff}`} via extras · {onQuote} on quote</div>
            ) : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <Stepper value={qty} onChange={(n) => setQty(p.id, n)} />
            <div style={{ minWidth: 72, textAlign: 'right', fontWeight: 600, fontSize: 14 }}>
              {lineTotal != null ? fmt(lineTotal) : onQuote > 0 ? <span className="cost-tbc">TBC</span> : <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>—</span>}
            </div>
          </div>
        </div>
        </div>
        {pvs.length > 0 && qty > 0 && (
          <div style={{ marginTop: 8 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: selectedId ? 'var(--brand)' : 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              {selectedId ? 'Variant' : '⚠ Select variant'}
            </label>
            <select className="input input-sm" style={{ maxWidth: 280, borderColor: selectedId ? 'var(--brand)' : 'var(--danger)' }} value={selectedId} onChange={(e) => setVariantSelection(p.id, e.target.value)}>
              <option value="">Select an option…</option>
              {pvs.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
        )}
      </div>
    )
  }

  const renderParts = (items: Product[], emptyText: string) => (
    items.length === 0
      ? <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-3)' }}>{emptyText}</div>
      : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{items.map((p, idx) => renderPart(p, idx, items))}</div>
  )

  const renderGroups = (groups: { label: string; items: Product[] }[], emptyText: string) => (
    groups.length === 0
      ? renderParts([], emptyText)
      : groups.map((g) => (
          <div key={g.label} style={{ marginBottom: 14 }}>
            <div style={{ ...sectionTitleStyle, marginBottom: 8 }}>{g.label}</div>
            {renderParts(g.items, '')}
          </div>
        ))
  )

  const renderExtras = (place: string) => {
    const list = extrasByPlace[place] ?? []
    if (list.length === 0) return null
    return (
      <div className="card" style={{ padding: '14px 16px', marginTop: 16 }}>
        <div style={sectionTitleStyle}>Extras</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.map((extra, idx) => (
            <ExtraRow key={extra.id} extra={extra} ctx={buildContext} isTicked={selectedExtras.has(extra.id)} applied={appliedById[extra.id]} onToggle={onToggleExtra} onSetCount={onSetExtraCount} costValue={extraCosts[extra.id] ?? ''} onSetCost={onSetExtraCost} productsById={productsById}
              move={reorderMode ? { index: idx, count: list.length, disabled: reordering, onMove: (dir) => onMoveExtra(extra.id, list.map((e) => e.id), dir) } : undefined} />
          ))}
        </div>
      </div>
    )
  }

  const renderReview = () => (
    <>
      <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
        <div style={sectionTitleStyle}>Quote details</div>
        <div className="quote-info-grid">
          <input className="input" placeholder="Project name *" value={quoteForm.project_name} onChange={(e) => setQuoteForm({ ...quoteForm, project_name: e.target.value })} />
          <input className="input" placeholder="Customer name" value={quoteForm.customer_name} onChange={(e) => setQuoteForm({ ...quoteForm, customer_name: e.target.value })} />
          <input className="input" placeholder="MO number" value={quoteForm.mo_number} onChange={(e) => setQuoteForm({ ...quoteForm, mo_number: e.target.value })} style={{ fontFamily: 'var(--mono)' }} />
        </div>
        <input className="input" placeholder="Notes (optional)" value={quoteForm.notes} onChange={(e) => setQuoteForm({ ...quoteForm, notes: e.target.value })} style={{ marginTop: 10 }} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ flex: '1 1 160px' }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Labour (minutes)</label>
            <input className="input" type="number" min="0" step="1" placeholder="0" value={quoteForm.labour_minutes} onChange={(e) => setQuoteForm({ ...quoteForm, labour_minutes: e.target.value })} />
            {extrasLabourMinutes > 0 && <div style={{ fontSize: 12, color: 'var(--brand)', marginTop: 4 }}>+{extrasLabourMinutes} min from extras</div>}
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Hardware uplift (%)</label>
            <input className="input" type="number" min="0" max="100" step="0.1" placeholder={String(defaultUpliftPct)} value={quoteForm.uplift_pct} onChange={(e) => setUplift(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              {quoteForm.uplift_pct.trim() === '' ? `Using the default ${defaultUpliftPct}%` : <>Default is {defaultUpliftPct}% · <button className="btn btn-ghost btn-sm" style={{ padding: '0 4px', height: 'auto' }} onClick={() => setQuoteForm({ ...quoteForm, uplift_pct: '' })}>use default</button></>}
            </div>
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Carriage (£)</label>
            <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={quoteForm.carriage} onChange={(e) => setCarriage(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Added after the rebate: no profit or rebate</div>
          </div>
        </div>
      </div>

      {missingVariants.length > 0 && (
        <div style={{ padding: '10px 14px', background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', marginBottom: 12, fontSize: 13, color: 'var(--danger)', fontWeight: 500 }}>
          {missingVariants.length} item{missingVariants.length !== 1 ? 's' : ''} need a variant: {missingVariants.map((p) => p.description).join(', ')}
        </div>
      )}

      <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
        <div style={sectionTitleStyle}>Bill of materials</div>
        {activeCount === 0 && <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Nothing added yet. Go back through the steps to add parts.</div>}
        {SECTIONS.filter((s) => s.key !== 'review').map((s, idx) => {
          const items = activeItems.filter((p) => p.category !== EXTRAS_CATEGORY && sectionOf(p) === s.key)
          if (items.length === 0) return null
          return (
            <div key={s.key} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => goToSection(idx)}>Edit</button>
              </div>
              {items.map((p) => <BomLine key={p.id} p={p} qty={finalQty[p.id]} variant={variantSelections[p.id] ? variantsById[variantSelections[p.id]] : null} />)}
            </div>
          )
        })}
        {(() => {
          const items = activeItems.filter((p) => p.category === EXTRAS_CATEGORY)
          if (items.length === 0) return null
          return (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Parts added by extras</div>
              {items.map((p) => <BomLine key={p.id} p={p} qty={finalQty[p.id]} variant={null} />)}
            </div>
          )
        })()}
        {extrasResult.applied.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-2)', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
            Extras ticked: {extrasResult.applied.map(({ extra, count }) => `${extra.number}. ${extra.name}${extra.scales_with_bom ? ` (×${count})` : ''}`).join(' · ')}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
        <div style={sectionTitleStyle}>Cost breakdown</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-2)' }}>Materials subtotal</span><span style={{ fontWeight: 500 }}>£{materialsSubtotal.toFixed(2)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-2)' }}>Hardware uplift ({upliftPct}%)</span><span style={{ fontWeight: 500 }}>£{hardwareUpliftAmount.toFixed(2)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-2)' }}>Labour <span style={{ fontSize: 12, color: 'var(--text-3)' }}>({labourMinutes} min{extrasLabourMinutes > 0 ? `, incl. ${extrasLabourMinutes} for extras` : ''}{labourRate > 0 ? ` @ £${labourRate.toFixed(4)}/min` : ''})</span></span>
            <span style={{ fontWeight: 500 }}>£{labourTotal.toFixed(2)}</span>
          </div>
          {costedExtras.map(({ extra, cost }) => <div key={extra.id} style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-2)' }}>{extra.name}</span><span style={{ fontWeight: 500 }}>£{cost.toFixed(2)}</span></div>)}
          <ProfitRebateRows
            pricing={pricing}
            gpValue={quoteForm.gp_pct}
            rebateValue={quoteForm.rebate_pct}
            onGpChange={(v) => setQuoteForm({ ...quoteForm, gp_pct: v })}
            onRebateChange={(v) => setQuoteForm({ ...quoteForm, rebate_pct: v })}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 16 }}>
          <button className="btn" onClick={handlePdf}>PDF</button>
          {editingQuote && <button className="btn" onClick={() => handleSave(true)} disabled={saving}>Save as new quote</button>}
          <button className="btn btn-primary" onClick={() => handleSave()} disabled={saving}>{saving ? 'Saving…' : editingQuote ? 'Update quote' : 'Save quote'}</button>
        </div>
      </div>
    </>
  )

  if (loading) return <div className="loading"><div className="spinner" /> Loading catalogue…</div>

  const currentSteel = steelSteps[steelIdx]
  const heading = section === 'steelwork' ? `Steelwork · ${currentSteel.label}` : SECTIONS[sectionIdx].label
  const hint = section === 'steelwork' ? currentSteel.hint : SECTIONS[sectionIdx].hint

  return (
    <>
      {editingQuote && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 16, background: 'var(--warning-bg)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--warning)', fontWeight: 500 }}>
          <span>Editing saved quote: <strong>{editingQuote.project_name}</strong></span>
          <button className="btn btn-sm" onClick={onCancelEdit}>Cancel edit</button>
        </div>
      )}

      {/* Section progress */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 12 }}>
        {SECTIONS.map((s, idx) => {
          const active = idx === sectionIdx
          const count = sectionCount(s.key)
          return (
            <button key={s.key} onClick={() => goToSection(idx)} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: '8px 12px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, border: `1.5px solid ${active ? 'var(--brand)' : 'var(--border-strong)'}`, background: active ? 'var(--brand)' : 'var(--surface)', color: active ? '#fff' : 'var(--text-2)' }}>
              <span style={{ width: 20, height: 20, borderRadius: 99, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, background: active ? 'rgba(255,255,255,0.2)' : count > 0 ? 'var(--success-bg)' : 'var(--surface-3)', color: active ? '#fff' : count > 0 ? 'var(--success)' : 'var(--text-3)' }}>
                {count > 0 && !active ? '✓' : idx + 1}
              </span>
              {s.label}
              {count > 0 && <span style={{ fontSize: 11, opacity: 0.75 }}>({count})</span>}
            </button>
          )
        })}
      </div>

      {/* Steelwork sub-steps */}
      {section === 'steelwork' && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
          {steelSteps.map((s, idx) => {
            const active = s.key === currentSteel.key
            const count = countIn(bySteelStep[s.key]) + tickedIn(`steelwork.${s.key}`)
            return (
              <button key={s.key} onClick={() => setSteelKey(s.key)} className="btn btn-sm" style={{ background: active ? 'var(--brand-light)' : 'var(--surface)', borderColor: active ? 'var(--brand)' : 'var(--border-strong)', color: active ? 'var(--brand)' : 'var(--text-2)', fontWeight: active ? 600 : 500 }}>
                {idx + 1}. {s.label}{count > 0 ? ' ✓' : ''}
              </button>
            )
          })}
        </div>
      )}

      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 19 }}>{heading}</h2>
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3 }}>{hint}</p>
        </div>
        {isAdmin && section !== 'review' && <ReorderToggle on={reorderToggle} onChange={setReorderToggle} />}
      </div>

      {reorderMode && section !== 'review' && <ReorderBanner />}

      {section === 'steelwork' && currentSteel.key === 'material' && (
        <>
          <PresetsBar presets={presets} products={catalogue} onApply={onApplyPreset} />
          <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
            <div style={sectionTitleStyle}>Pillar</div>
            <BuildContextFields ctx={buildContext} setCtx={setBuildContext} />
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>Filled in from the preset or the steelwork you pick. Change them if needed; they decide which extras can be ticked.</div>
          </div>
        </>
      )}

      {section === 'steelwork' && renderParts(bySteelStep[currentSteel.key], 'No steelwork parts match this step yet.')}
      {section === 'steelwork' && renderExtras(`steelwork.${currentSteel.key}`)}

      {section === 'incomer' && renderParts(bySection.incomer, 'No incomer parts in the catalogue yet.')}
      {section === 'distribution' && renderGroups(groupBy(bySection.distribution, DISTRIBUTION_GROUPS, 'Other insulators'), 'No distribution parts in the catalogue yet.')}
      {section === 'outgoing' && renderGroups(groupBy(bySection.outgoing, OUTGOING_GROUPS, 'Other outgoing'), 'No outgoing parts in the catalogue yet.')}
      {section === 'accessories' && renderGroups(groupBy(bySection.accessories, [], 'Accessories'), 'No accessories in the catalogue yet.')}
      {section !== 'steelwork' && section !== 'review' && renderExtras(section)}

      {section === 'review' && renderReview()}

      <div className="total-bar" style={{ marginTop: 20 }}>
        <div>
          <div className="total-bar-label">Total quote</div>
          <div className="total-bar-amount">£{pricing.totalQuote.toFixed(2)}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>Factory cost £{factoryCost.toFixed(2)}</div>
          {activeCount > 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{activeCount} line item{activeCount !== 1 ? 's' : ''}</div>}
        </div>
        <div className="total-bar-actions">
          {(activeCount > 0 || selectedExtras.size > 0) && <button className="btn btn-ghost hide-mobile" style={{ color: 'rgba(255,255,255,0.65)' }} onClick={handleClear}>Clear</button>}
          {!isFirst && <button className="btn" style={{ background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.25)', color: '#fff' }} onClick={back}>Back</button>}
          {!isLast && <button className="btn btn-secondary" onClick={next}>{nextLabel}</button>}
          {isLast && <button className="btn btn-secondary" onClick={() => handleSave()} disabled={saving}>{saving ? 'Saving…' : editingQuote ? 'Update quote' : 'Save quote'}</button>}
        </div>
      </div>
    </>
  )
}

function BomLine({ p, qty, variant }: { p: Product; qty: number; variant: ProductVariant | null }) {
  const pn = getDisplayPartNumber(p, variant)
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '3px 0' }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, marginRight: 6 }}>{qty}×</span>
        {p.description}
        {variant && <span style={{ color: 'var(--text-3)' }}> · {variant.label}</span>}
        {pn && <span style={{ color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 11, marginLeft: 6 }}>{pn}</span>}
      </span>
      <span style={{ flexShrink: 0, fontWeight: 500 }}>{p.factory_cost != null ? fmt(p.factory_cost * qty) : <span className="cost-tbc">TBC</span>}</span>
    </div>
  )
}
