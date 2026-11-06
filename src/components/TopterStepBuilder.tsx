import { useState, useMemo } from 'react'
import type {
  Product, ProductVariant, ProductPrerequisite, Preset,
  QuantityMap, VariantSelectionMap, AutoAddedMap,
  QuoteFormData, AppSettings, Extra, BuildContext, ExtraCostMap, CustomItem,
} from '../types'
import { EXTRAS_CATEGORY } from '../types'
import { printQuote } from '../utils/printQuote'
import type { ExtrasResult } from '../utils/extras'
import { toQuoteExtras } from '../utils/extras'
import { quotePricing } from '../utils/pricing'
import { capacityUsage, readCapacity } from '../utils/capacity'
import type { EditingQuote } from '../App'
import { CustomItemsCard, CustomBomLines, customPrintItems } from './CustomItems'
import { Stepper, qtyStep, PresetsBar, ExtraRow, getDisplayPartNumber, fmt, MoveButtons, ReorderToggle, ReorderBanner, ProfitRebateRows, IncompatNote, IncompatBanner } from './QuoteBuilder'
import CapacityPanel, { CapacityNote } from './CapacityPanel'
import { PartThumb } from './PartPicture'
import RangeList from './RangeList'
import type { IncompatMap } from '../utils/compatibility'
import { clashesFor } from '../utils/compatibility'

// Step-by-step builder for TopTer boxes. Same quote, BOM, extras and totals as the
// simple list, so a rep can switch between the two at any time. The capacity check
// adds up every board, box and flange on the quote, so combined boards count together.

interface Props {
  products: Product[]
  loading: boolean
  variants: ProductVariant[]
  prerequisites: ProductPrerequisite[]
  incompatMap: IncompatMap
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
  onClearQuote: () => void   // clears the whole quote back to the section's defaults
  canClear: boolean
  extrasResult: ExtrasResult
  buildContext: BuildContext
  setBuildContext: (ctx: BuildContext) => void
  editingQuote: EditingQuote | null
  onCancelEdit: () => void
  isAdmin: boolean
  onMoveProduct: (productId: string, groupIds: string[], dir: -1 | 1) => void
  onMoveExtra: (extraId: string, groupIds: string[], dir: -1 | 1) => void
  reordering: boolean
  customItems: CustomItem[]   // rep's one-off items, typed in on Review & save
  setCustomItems: (items: CustomItem[]) => void
  startAtReview?: boolean   // opened from the box designer's "Review & save"
}

// ── Steps ─────────────────────────────────────────────────────

type StepKey = 'enclosure' | 'sockets' | 'protection' | 'accessories' | 'review'

const STEPS: { key: StepKey; label: string; hint: string }[] = [
  { key: 'enclosure', label: 'Board & enclosure', hint: 'Start from a preset, or pick one or more boards, back boxes or control units. Combined boards are added together in the capacity check.' },
  { key: 'sockets', label: 'Sockets', hint: 'Fixed, interlocked and domestic sockets, plus the flanges and closing flanges for the board.' },
  { key: 'protection', label: 'Circuit protection', hint: 'Main switches, RCCBs, RCBOs, MCBs and surge protection for the DIN rail.' },
  { key: 'accessories', label: 'Accessories', hint: 'DIN rail kits, earth bars, stands and everything else.' },
  { key: 'review', label: 'Review & save', hint: 'Check the quote details, labour, capacity and totals, then save.' },
]

// Which step each category sits in. Anything else goes in Accessories.
const STEP_CATEGORIES: Partial<Record<StepKey, string[]>> = {
  enclosure: ['Enclosures'],
  sockets: ['Fixed sockets', 'Interlocked sockets', 'Domestic sockets', 'Flanges & covers'],
  protection: ['Circuit protection'],
}

function stepOf(p: Product): StepKey {
  for (const [key, cats] of Object.entries(STEP_CATEGORIES)) {
    if (cats?.includes(p.category)) return key as StepKey
  }
  return 'accessories'
}

// Groups inside a step, matched on the part's description and part number, in this order
const ENCLOSURE_GROUPS: [string, RegExp][] = [
  ['Boards for fixed sockets', /fixed sockets?/i],
  ['Boards for switched (interlocked) sockets', /switched/i],
  ['Covers', /^cover\b/i],
  ['Back boxes', /back ?box|bottom box|box with cover/i],
  ['Control units', /control unit/i],
]

const PROTECTION_GROUPS: [string, RegExp][] = [
  ['Protection accessories', /padlock|auxiliary|shunt trip/i],
  ['Main switches', /main switch|isolator/i],
  ['RCCBs', /\brccb|\brcd\b/i],
  ['RCBOs', /\brcbo|afdd/i],
  ['MCBs', /\bmcb\b/i],
  ['Surge protection', /surge|\bspd\b/i],
  ['Contactors', /contactor/i],
]

// Sockets are grouped by category first, then fixed sockets by how they mount
const SOCKET_GROUPS: [string, (p: Product) => boolean][] = [
  ['Fixed sockets for boards', (p) => p.category === 'Fixed sockets' && !/wall-mounted|compact panel/i.test(p.description)],
  ['Interlocked sockets', (p) => p.category === 'Interlocked sockets'],
  ['domoTER devices (fit in a domoTER cap)', (p) => p.category === 'Domestic sockets' && (!!readCapacity(p.capacity).uses?.domo || /^domoTER (?!caps)/i.test(p.range_name ?? ''))],
  ['Domestic sockets', (p) => p.category === 'Domestic sockets'],
  ['Flanges & covers', (p) => p.category === 'Flanges & covers'],
  ['Wall-mounted sockets', (p) => p.category === 'Fixed sockets' && /wall-mounted/i.test(p.description)],
  ['Compact panel sockets', (p) => p.category === 'Fixed sockets' && /compact panel/i.test(p.description)],
]

// Extras are placed by their name: sockets and flanges with Sockets, protection
// devices with Circuit protection, board and box items with the enclosure,
// anything else in Accessories
function placeOfExtra(e: Extra): StepKey {
  const text = `${e.name} ${e.description ?? ''}`
  if (/socket|flange|plug/i.test(text)) return 'sockets'
  if (/\brcd|rccb|rcbo|mcb|breaker|surge|protection|isolat|main switch|afdd/i.test(text)) return 'protection'
  if (/board|box|enclosure|cover|window|door|lock|stand|bracket/i.test(text)) return 'enclosure'
  return 'accessories'
}

const nameOf = (p: Product) => `${p.description} ${p.part_number ?? ''}`

function groupBy(items: Product[], rules: [string, RegExp][], otherLabel: string) {
  const groups: { label: string; items: Product[] }[] = [...rules.map(([label]) => ({ label, items: [] as Product[] })), { label: otherLabel, items: [] }]
  items.forEach((p) => {
    const i = rules.findIndex(([, re]) => re.test(nameOf(p)))
    groups[i === -1 ? groups.length - 1 : i].items.push(p)
  })
  return groups.filter((g) => g.items.length > 0)
}

function groupByTest(items: Product[], rules: [string, (p: Product) => boolean][], otherLabel: string) {
  const groups: { label: string; items: Product[] }[] = [...rules.map(([label]) => ({ label, items: [] as Product[] })), { label: otherLabel, items: [] }]
  items.forEach((p) => {
    const i = rules.findIndex(([, test]) => test(p))
    groups[i === -1 ? groups.length - 1 : i].items.push(p)
  })
  return groups.filter((g) => g.items.length > 0)
}

// ── Filters (read from the description) ───────────────────────

type FilterKey = 'amps' | 'volts' | 'poles' | 'ip' | 'curve' | 'ka'
type Filters = Partial<Record<FilterKey, string>>

const READERS: Record<FilterKey, (p: Product) => string | null> = {
  amps: (p) => p.description.match(/\b(\d+)A\b/)?.[1] ?? null,
  volts: (p) => p.description.match(/\b(110|230|400|380\/440|230\/24)V\b/)?.[1] ?? null,
  poles: (p) => p.description.match(/(?:^|\s)(2P\+E|3P\+E|3P\+N\+E)(?=[\s,]|$)/)?.[1] ?? null,
  ip: (p) => /\bIP44\b/.test(p.description) ? 'IP44' : /\bIP6[5-7]\b/.test(p.description) ? 'IP65 and above' : null,
  curve: (p) => p.description.match(/\b([BCD]) curve\b/)?.[1] ?? null,
  ka: (p) => p.description.match(/\b(6|10)kA\b/)?.[1] ?? null,
}

const FILTER_LABELS: Record<FilterKey, string> = {
  amps: 'Current', volts: 'Voltage', poles: 'Poles', ip: 'Protection', curve: 'Curve', ka: 'Breaking capacity',
}

const formatValue = (key: FilterKey, v: string) =>
  key === 'amps' ? `${v}A` : key === 'volts' ? `${v}V` : key === 'curve' ? `${v} curve` : key === 'ka' ? `${v}kA` : v

const STEP_FILTERS: Partial<Record<StepKey, FilterKey[]>> = {
  sockets: ['amps', 'volts', 'poles', 'ip'],
  protection: ['amps', 'curve', 'ka'],
}

const sectionTitleStyle = { fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 10 } as const

export default function TopterStepBuilder({
  products, loading, variants, prerequisites, incompatMap, autoAdded,
  quantities, setQty, variantSelections, setVariantSelection,
  quoteForm, setQuoteForm, onSave, showToast,
  presets, onApplyPreset, settings,
  extras, selectedExtras, onToggleExtra, onSetExtraCount, extraCosts, onSetExtraCost, onClearQuote, canClear, extrasResult, buildContext,
  editingQuote, onCancelEdit,
  isAdmin, onMoveProduct, onMoveExtra, reordering, customItems, setCustomItems, startAtReview = false,
}: Props) {
  const [stepIdx, setStepIdx] = useState(startAtReview ? STEPS.length - 1 : 0)
  const [reorderToggle, setReorderToggle] = useState(false)
  const reorderMode = isAdmin && reorderToggle
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Filters>({})

  const step = STEPS[stepIdx].key

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

  const byStep = useMemo(() => {
    const map: Record<StepKey, Product[]> = { enclosure: [], sockets: [], protection: [], accessories: [], review: [] }
    catalogue.forEach((p) => map[stepOf(p)].push(p))
    return map
  }, [catalogue])

  const extrasByPlace = useMemo(() => {
    const map: Record<string, Extra[]> = {}
    extras.forEach((e) => { (map[placeOfExtra(e)] ??= []).push(e) })
    return map
  }, [extras])

  const appliedById = Object.fromEntries(extrasResult.applied.map((a) => [a.extra.id, a]))

  // ── Totals (same sums as the simple list) ──
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
  const costedExtras = extrasResult.applied.filter((a) => a.cost > 0 && !a.extra.rep_cost_uplift)   // hardware ones are already in materials
  const carriage = Math.max(0, parseFloat(quoteForm.carriage) || 0)
  const factoryCost = materialsSubtotal + hardwareUpliftAmount + labourTotal + extrasResult.repCost
  const pricing = quotePricing(factoryCost, quoteForm.gp_pct, quoteForm.rebate_pct, carriage)

  const missingVariants = activeItems.filter((p) => (variantsByProduct[p.id]?.length ?? 0) > 0 && !variantSelections[p.id])
  const overCapacity = capacityUsage(products, finalQty).filter((l) => l.over)

  const countIn = (items: Product[]) => items.filter((p) => (quantities[p.id] ?? 0) > 0).length
  const tickedIn = (place: string) => (extrasByPlace[place] ?? []).filter((e) => appliedById[e.id]).length
  const stepCount = (key: StepKey) => key === 'review' ? 0 : countIn(byStep[key]) + tickedIn(key)

  // ── Search and filters for the current step ──
  // A part already on the quote always shows, so it can be changed or taken off.
  const filterKeys = STEP_FILTERS[step] ?? []
  const stepItems = byStep[step]
  const filterOptions = useMemo(() => {
    const out: Partial<Record<FilterKey, string[]>> = {}
    filterKeys.forEach((key) => {
      const values = Array.from(new Set(stepItems.map(READERS[key]).filter((v): v is string => v != null)))
      values.sort((a, b) => (parseFloat(a) - parseFloat(b)) || a.localeCompare(b))
      if (values.length > 1) out[key] = values
    })
    return out
  }, [stepItems, filterKeys])
  const activeFilters = filterKeys.filter((k) => filters[k])
  const narrowing = search.trim() !== '' || activeFilters.length > 0
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return stepItems.filter((p) => {
      if ((quantities[p.id] ?? 0) > 0) return true
      if (q && !`${p.description} ${p.part_number ?? ''} ${p.notes ?? ''} ${p.range_name ?? ''}`.toLowerCase().includes(q)) return false
      // A filter only applies to parts it says something about (flanges have no current, etc.)
      return activeFilters.every((k) => { const v = READERS[k](p); return v == null || v === filters[k] })
    })
  }, [stepItems, search, activeFilters, filters, quantities])

  // ── Navigation ──
  const goToStep = (idx: number) => {
    setStepIdx(idx)
    setSearch('')
    setFilters({})
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const isFirst = stepIdx === 0
  const isLast = step === 'review'
  const next = () => { if (!isLast) goToStep(stepIdx + 1) }
  const back = () => { if (!isFirst) goToStep(stepIdx - 1) }

  // ── Actions ──
  const handleSave = async (asNew = false) => {
    if (activeCount === 0 && extrasResult.customLines.length === 0) { showToast('Add at least one item first', 'error'); return }
    if (!quoteForm.project_name.trim()) { showToast('Project name is required', 'error'); return }
    setSaving(true)
    const ok = await onSave(quoteForm, asNew)
    setSaving(false)
    if (ok) goToStep(0)
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
    if (activeCount === 0 && extrasResult.customLines.length === 0) { showToast('Add at least one item first', 'error'); return }
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
      }).concat(customPrintItems(extrasResult.customLines)),   // rep's one-off items
      extras: toQuoteExtras(extrasResult.applied),
      materialsSubtotal, hardwareUpliftPct: upliftPct, hardwareUpliftAmount,
      labourMinutes, labourRatePerMin: labourRate, labourTotal, carriage, pricing,
      baseUrl: (import.meta as any).env.BASE_URL,
      section: 'topter',
    })
  }

  // ── Pieces ──
  const canMove = reorderMode && !narrowing

  const partNumberOf = (p: Product) => {
    const selectedId = variantSelections[p.id] ?? ''
    return getDisplayPartNumber(p, selectedId ? variantsById[selectedId] ?? null : null)
  }

  // Notes under a part: clashes, prerequisites, auto-added, extras, variant picker
  const renderDetails = (p: Product) => {
    const qty = quantities[p.id] ?? 0
    const onQuote = finalQty[p.id] ?? 0
    const pvs = variantsByProduct[p.id] ?? []
    const selectedId = variantSelections[p.id] ?? ''
    const autoParents = Object.keys(autoAdded[p.id] ?? {}).map((id) => productsById[id]?.description ?? 'another part')
    const diff = extrasResult.delta[p.id]
    const clashIds = clashesFor(p.id, incompatMap, finalQty)
    return (
      <>
        <IncompatNote clashIds={clashIds} productsById={productsById} onQuote={onQuote > 0} />
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
      </>
    )
  }

  // Reorder mode: one card per part, as before ranges
  const renderPart = (p: Product, idx: number, group: Product[]) => {
    const qty = quantities[p.id] ?? 0
    const onQuote = finalQty[p.id] ?? 0
    const lineTotal = p.factory_cost != null && onQuote > 0 ? p.factory_cost * onQuote : null
    const displayPN = partNumberOf(p)
    const clashIds = clashesFor(p.id, incompatMap, finalQty)
    const blocked = clashIds.length > 0 && onQuote <= 0
    return (
      <div key={p.id} style={{ padding: '10px 12px', border: `1.5px solid ${clashIds.length > 0 && onQuote > 0 ? 'var(--danger)' : qty > 0 ? 'var(--brand)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', background: blocked ? 'var(--surface-3)' : qty > 0 ? 'var(--brand-light)' : 'var(--surface)', opacity: blocked ? 0.7 : 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          {canMove && (
            <MoveButtons index={idx} count={group.length} disabled={reordering} onMove={(dir) => onMoveProduct(p.id, group.map((g) => g.id), dir)} />
          )}
          <PartThumb product={p} size={56} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: qty > 0 ? 600 : 500 }}>{p.description}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                {displayPN && <span className="part-number">{displayPN}</span>}
                <span style={{ fontSize: 13 }}>{p.factory_cost != null ? fmt(p.factory_cost) : <span className="cost-tbc">TBC</span>}<span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 3 }}>each</span></span>
              </div>
              <CapacityNote product={p} />
              {p.notes && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{p.notes}</div>}
              {renderDetails(p)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <Stepper value={qty} onChange={(n) => setQty(p.id, n)} disabled={blocked} step={qtyStep(p)} />
              <div style={{ minWidth: 72, textAlign: 'right', fontWeight: 600, fontSize: 14 }}>
                {lineTotal != null ? fmt(lineTotal) : onQuote > 0 ? <span className="cost-tbc">TBC</span> : <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>—</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderParts = (items: Product[], emptyText: string) => (
    items.length === 0
      ? <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-3)' }}>{emptyText}</div>
      : canMove
        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{items.map((p, idx) => renderPart(p, idx, items))}</div>
        : (
          <RangeList
            items={items}
            all={products}
            qtyOf={(id) => quantities[id] ?? 0}
            onQuoteOf={(id) => finalQty[id] ?? 0}
            setQty={setQty}
            blockedOf={(p) => (finalQty[p.id] ?? 0) <= 0 && clashesFor(p.id, incompatMap, finalQty).length > 0}
            clashOf={(p) => (finalQty[p.id] ?? 0) > 0 && clashesFor(p.id, incompatMap, finalQty).length > 0}
            partNumberOf={partNumberOf}
            renderDetails={renderDetails}
            openAll={narrowing}
          />
        )
  )

  const renderGroups = (groups: { label: string; items: Product[] }[], emptyText: string) => (
    groups.length === 0
      ? renderParts([], emptyText)
      : groups.map((g) => (
          <div key={g.label} style={{ marginBottom: 14 }}>
            <div style={{ ...sectionTitleStyle, marginBottom: 8 }}>{g.label} <span style={{ fontWeight: 500 }}>({g.items.length})</span></div>
            {renderParts(g.items, '')}
          </div>
        ))
  )

  const renderExtras = (place: StepKey) => {
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

  const renderFinder = () => {
    if (step === 'review') return null
    const keys = filterKeys.filter((k) => filterOptions[k])
    return (
      <div className="card" style={{ padding: '12px 14px', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '2 1 200px', minWidth: 0 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Search this step</label>
            <input className="input input-sm" type="search" placeholder="Description or part number…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {keys.map((k) => (
            <div key={k} style={{ flex: '1 1 110px', minWidth: 0 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>{FILTER_LABELS[k]}</label>
              <select className="input input-sm" value={filters[k] ?? ''} onChange={(e) => setFilters({ ...filters, [k]: e.target.value || undefined })}>
                <option value="">Any</option>
                {(filterOptions[k] ?? []).map((v) => <option key={v} value={v}>{formatValue(k, v)}</option>)}
              </select>
            </div>
          ))}
          {narrowing && <button className="btn btn-sm" onClick={() => { setSearch(''); setFilters({}) }}>Show all</button>}
        </div>
        {narrowing && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
            Showing {visible.length} of {stepItems.length}. Parts already on the quote always show.{reorderMode ? ' Click Show all to move parts.' : ''}
          </div>
        )}
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

      <CapacityPanel products={products} qty={finalQty} />

      <CustomItemsCard items={customItems} setItems={setCustomItems} />

      <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
        <div style={sectionTitleStyle}>Bill of materials</div>
        {activeCount === 0 && extrasResult.customLines.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Nothing added yet. Go back through the steps to add parts.</div>}
        {STEPS.filter((s) => s.key !== 'review').map((s, idx) => {
          const items = activeItems.filter((p) => p.category !== EXTRAS_CATEGORY && stepOf(p) === s.key)
          if (items.length === 0) return null
          return (
            <div key={s.key} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => goToStep(idx)}>Edit</button>
              </div>
              {items.map((p) => <BomLine key={p.id} p={p} qty={finalQty[p.id]} variant={variantSelections[p.id] ? variantsById[variantSelections[p.id]] : null} />)}
            </div>
          )
        })}
        {(() => {
          const items = activeItems.filter((p) => p.category === EXTRAS_CATEGORY)
          // Rep-priced extras that count as hardware: their cost is in materials
          const costed = extrasResult.applied.filter((a) => a.extra.rep_cost_uplift && a.cost > 0)
          if (items.length === 0 && costed.length === 0) return null
          return (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Parts added by extras</div>
              {items.map((p) => <BomLine key={p.id} p={p} qty={finalQty[p.id]} variant={null} />)}
              {costed.map(({ extra, cost }) => (
                <div key={extra.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '3px 0' }}>
                  <span><span style={{ fontFamily: 'var(--mono)', fontWeight: 600, marginRight: 6 }}>1×</span>{extra.name}</span>
                  <span style={{ flexShrink: 0, fontWeight: 500 }}>{fmt(cost)}</span>
                </div>
              ))}
            </div>
          )
        })()}
        <CustomBomLines lines={extrasResult.customLines} />
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

  const current = STEPS[stepIdx]

  return (
    <>
      {editingQuote && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 16, background: 'var(--warning-bg)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--warning)', fontWeight: 500 }}>
          <span>Editing saved quote: <strong>{editingQuote.project_name}</strong></span>
          <button className="btn btn-sm" onClick={onCancelEdit}>Cancel edit</button>
        </div>
      )}

      {/* Step progress */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 12 }}>
        {STEPS.map((s, idx) => {
          const active = idx === stepIdx
          const count = stepCount(s.key)
          return (
            <button key={s.key} onClick={() => goToStep(idx)} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: '8px 12px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, border: `1.5px solid ${active ? 'var(--brand)' : 'var(--border-strong)'}`, background: active ? 'var(--brand)' : 'var(--surface)', color: active ? '#fff' : 'var(--text-2)' }}>
              <span style={{ width: 20, height: 20, borderRadius: 99, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, background: active ? 'rgba(255,255,255,0.2)' : count > 0 ? 'var(--success-bg)' : 'var(--surface-3)', color: active ? '#fff' : count > 0 ? 'var(--success)' : 'var(--text-3)' }}>
                {count > 0 && !active ? '✓' : idx + 1}
              </span>
              {s.label}
              {count > 0 && <span style={{ fontSize: 11, opacity: 0.75 }}>({count})</span>}
            </button>
          )
        })}
      </div>

      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 19 }}>{current.label}</h2>
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3 }}>{current.hint}</p>
        </div>
        {isAdmin && step !== 'review' && <ReorderToggle on={reorderToggle} onChange={setReorderToggle} />}
      </div>

      {reorderMode && step !== 'review' && <ReorderBanner />}

      <IncompatBanner incompatMap={incompatMap} qty={finalQty} productsById={productsById} />

      {step === 'enclosure' && <PresetsBar presets={presets} products={catalogue} onApply={onApplyPreset} compact />}

      {(step === 'enclosure' || step === 'sockets' || step === 'protection') && <CapacityPanel products={products} qty={finalQty} />}

      {renderFinder()}

      {step === 'enclosure' && renderGroups(groupBy(visible, ENCLOSURE_GROUPS, 'Other boxes'), narrowing ? 'Nothing matches the search.' : 'No boards or enclosures in the catalogue yet.')}
      {step === 'sockets' && renderGroups(groupByTest(visible, SOCKET_GROUPS, 'Other sockets'), narrowing ? 'Nothing matches the filters.' : 'No sockets in the catalogue yet.')}
      {step === 'protection' && renderGroups(groupBy(visible, PROTECTION_GROUPS, 'Other protection'), narrowing ? 'Nothing matches the filters.' : 'No circuit protection in the catalogue yet.')}
      {step === 'accessories' && renderGroups(groupBy(visible, [], 'Accessories'), narrowing ? 'Nothing matches the search.' : 'No accessories in the catalogue yet.')}
      {step !== 'review' && renderExtras(step)}

      {step === 'review' && renderReview()}

      <div className="total-bar" style={{ marginTop: 20 }}>
        <div>
          <div className="total-bar-label">Total quote</div>
          <div className="total-bar-amount">£{pricing.totalQuote.toFixed(2)}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>Factory cost £{factoryCost.toFixed(2)}</div>
          {activeCount > 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{activeCount} line item{activeCount !== 1 ? 's' : ''}</div>}
          {overCapacity.length > 0 && <div style={{ fontSize: 11, color: 'var(--secondary)', fontWeight: 600, marginTop: 2 }}>⚠ Over board capacity</div>}
        </div>
        <div className="total-bar-actions">
          {canClear && <button className="btn btn-ghost hide-mobile" style={{ color: 'rgba(255,255,255,0.65)' }} onClick={onClearQuote}>Clear</button>}
          {!isFirst && <button className="btn" style={{ background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.25)', color: '#fff' }} onClick={back}>Back</button>}
          {!isLast && <button className="btn btn-secondary" onClick={next}>Next: {STEPS[stepIdx + 1].label}</button>}
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
