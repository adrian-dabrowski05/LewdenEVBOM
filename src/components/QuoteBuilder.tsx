import { useState, useMemo } from 'react'
import type { CSSProperties } from 'react'
import type {
  Product, ProductVariant, ProductPrerequisite, Preset, PresetConfiguration,
  QuantityMap, VariantSelectionMap, AutoAddedMap,
  QuoteFormData, AppSettings, Extra, BuildContext, CabinetMaterial, ExtraCostMap,
} from '../types'
import { EXTRAS_CATEGORY } from '../types'
import SearchBar from './SearchBar'
import CapacityPanel, { CapacityNote } from './CapacityPanel'
import { WithPicture } from './PartPicture'
import RangeList from './RangeList'
import { useSectionConfig } from '../utils/sections'
import { capacityUsage } from '../utils/capacity'
import { printQuote } from '../utils/printQuote'
import type { ExtrasResult, AppliedExtra } from '../utils/extras'
import type { EditingQuote } from '../App'
import { quotePricing, pctInputOk, MAX_GP_PCT, GP_MODE } from '../utils/pricing'
import type { QuotePricing } from '../utils/pricing'
import { extraUnavailableReason, toQuoteExtras, MATERIAL_LABELS, RATING_OPTIONS, SIZE_OPTIONS } from '../utils/extras'
import type { IncompatMap } from '../utils/compatibility'
import { clashesFor, clashingPairs } from '../utils/compatibility'

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
}

export const fmt = (n: number | null) => n != null ? `£${n.toFixed(2)}` : null

const EMPTY_FORM: QuoteFormData = { project_name: '', customer_name: '', mo_number: '', notes: '', labour_minutes: '', uplift_pct: '', carriage: '', gp_pct: '', rebate_pct: '' }

export function getDisplayPartNumber(product: Product, variant: ProductVariant | null): string | null {
  if (!variant) return product.part_number
  if (!variant.part_number_suffix) return product.part_number
  return product.part_number ? `${product.part_number}${variant.part_number_suffix}` : variant.part_number_suffix
}

// disabled = the part can't be added (e.g. it clashes with something on the quote).
// It can still be taken off if it is already there.
// Smallest amount a part can be quoted in: whole units, or halves/quarters for
// parts that can be cut (set in Admin > Capacity)
export const qtyStep = (p: Product): number => (p.qty_step != null && p.qty_step > 0 && p.qty_step < 1 ? Number(p.qty_step) : 1)

// Rounds to the nearest step (0.25, 0.5…) without floating point dust
const snapQty = (n: number, step: number) => Math.max(0, Number((Math.round(n / step) * step).toFixed(4)))

export function Stepper({ value, onChange, disabled, step = 1 }: { value: number; onChange: (n: number) => void; disabled?: boolean; step?: number }) {
  const noAdd = !!disabled
  const whole = step >= 1
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (text: string) => {
    setDraft(null)
    const n = snapQty(parseFloat(text) || 0, step)
    if (noAdd && n > value) return
    if (n !== value) onChange(n)
  }
  return (
    <div className="stepper" style={noAdd && value <= 0 ? { opacity: 0.45 } : undefined} title={noAdd ? 'Not available with what is on the quote' : undefined}>
      <button className="stepper-btn" disabled={value <= 0} onPointerDown={(e) => { e.preventDefault(); if (value > 0) onChange(whole ? Math.max(0, value - 1) : snapQty(value - step, step)) }} aria-label="Decrease">−</button>
      {whole ? (
        <input className="stepper-input" type="number" min="0" max="999" value={value || ''} placeholder="0" disabled={noAdd && value <= 0}
          onChange={(e) => { const n = Math.max(0, parseInt(e.target.value) || 0); if (noAdd && n > value) return; onChange(n) }} />
      ) : (
        <input className="stepper-input" type="text" inputMode="decimal" value={draft ?? (value ? String(value) : '')} placeholder="0" disabled={noAdd && value <= 0}
          title={`Can be quoted in steps of ${step}`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      )}
      <button className="stepper-btn" disabled={noAdd} style={noAdd ? { cursor: 'not-allowed' } : undefined} onPointerDown={(e) => { e.preventDefault(); if (!noAdd) onChange(whole ? value + 1 : snapQty(value + step, step)) }} aria-label="Increase">+</button>
    </div>
  )
}

// ── Compatibility: what a part clashes with ──
// onQuote: the part is already on the quote (so it's a conflict to sort out),
// otherwise it is greyed out and can't be added.
export function IncompatNote({ clashIds, productsById, onQuote }: { clashIds: string[]; productsById: Record<string, Product>; onQuote: boolean }) {
  if (clashIds.length === 0) return null
  const names = clashIds.map((id) => productsById[id]?.description ?? 'another part')
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3} more` : '')
  return (
    <div style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: 'var(--danger)' }}>
      {onQuote ? <>⚠ Incompatible with {shown}. Remove one of them.</> : <>Not available: incompatible with {shown}</>}
    </div>
  )
}

// Red banner listing the incompatible pairs on the quote
export function IncompatBanner({ incompatMap, qty, productsById }: { incompatMap: IncompatMap; qty: QuantityMap; productsById: Record<string, Product> }) {
  const pairs = clashingPairs(incompatMap, qty)
  if (pairs.length === 0) return null
  const name = (id: string) => productsById[id]?.description ?? 'Unknown part'
  return (
    <div style={{ padding: '10px 14px', background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', marginBottom: 12, fontSize: 13, color: 'var(--danger)', fontWeight: 500 }}>
      <div>⚠ {pairs.length} incompatible pair{pairs.length !== 1 ? 's' : ''} on this quote:</div>
      <ul style={{ margin: '4px 0 0 18px', padding: 0, fontWeight: 400 }}>
        {pairs.slice(0, 6).map(([a, b]) => <li key={`${a}-${b}`}>{name(a)} + {name(b)}</li>)}
        {pairs.length > 6 && <li>+{pairs.length - 6} more</li>}
      </ul>
    </div>
  )
}

// ── Admin reorder: up / down arrows, and the switch that shows them ──
export function MoveButtons({ index, count, disabled, onMove }: {
  index: number
  count: number
  disabled?: boolean
  onMove: (dir: -1 | 1) => void
}) {
  const btn = (enabled: boolean) => ({ width: 26, height: 22, padding: 0, borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border-strong)', background: 'var(--surface)', color: 'var(--text-2)', fontSize: 11, lineHeight: 1, cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.3 })
  const canUp = !disabled && index > 0
  const canDown = !disabled && index < count - 1
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
      <button type="button" style={btn(canUp)} disabled={!canUp} onClick={(e) => { e.stopPropagation(); onMove(-1) }} aria-label="Move up" title="Move up">▲</button>
      <button type="button" style={btn(canDown)} disabled={!canDown} onClick={(e) => { e.stopPropagation(); onMove(1) }} aria-label="Move down" title="Move down">▼</button>
    </div>
  )
}

export function ReorderToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" className="btn btn-sm" onClick={() => onChange(!on)} style={on ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: '#fff' } : {}} title="Admin only: change the order parts and extras are listed in, for everyone">
      {on ? 'Done reordering' : 'Reorder'}
    </button>
  )
}

export function ReorderBanner() {
  return (
    <div style={{ padding: '8px 12px', marginBottom: 12, background: 'var(--brand-light)', border: '1px solid var(--brand)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--brand)' }}>
      Reorder mode: use ▲ ▼ to move parts and extras. The new order is saved straight away and everyone sees it.
    </div>
  )
}

// ── Preset preview modal ───────────────────────────────────────
function PresetModal({ preset, products, onApply, onClose }: {
  preset: Preset
  products: Product[]
  onApply: (preset: Preset, configId?: string) => void
  onClose: () => void
}) {
  const configs = preset.preset_configurations ?? []
  const commonItems = preset.preset_items ?? []
  const hasConfigs = configs.length > 0
  const [selectedConfigId, setSelectedConfigId] = useState<string>(configs[0]?.id ?? '')

  const selectedConfig = configs.find((c) => c.id === selectedConfigId) ?? null

  // All items that will be applied
  const configItems = selectedConfig?.preset_configuration_items ?? []
  const allItems = [
    ...commonItems.map((i) => ({ product_id: i.product_id, quantity: i.quantity, source: 'common' as const })),
    ...configItems.map((i) => ({ product_id: i.product_id, quantity: i.quantity, source: 'config' as const })),
  ]

  const handleApply = () => {
    onApply(preset, hasConfigs ? selectedConfigId : undefined)
    onClose()
  }

  // Build combined part number for selected config
  const configPN = selectedConfig?.part_number_suffix
    ? `${preset.name.match(/EV\w+/)?.[0] ?? ''}${selectedConfig.part_number_suffix}`
    : null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: '90dvh', overflowY: 'auto' }}>
        <div className="modal-handle" />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 17 }}>{preset.name}</h2>
            {preset.description && <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3 }}>{preset.description}</p>}
          </div>
          <span className="badge badge-preset">
            {allItems.length} item{allItems.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Configuration picker */}
        {hasConfigs && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-2)', marginBottom: 8 }}>
              Select configuration
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {configs.map((config) => {
                const isSelected = selectedConfigId === config.id
                return (
                  <button
                    key={config.id}
                    onClick={() => setSelectedConfigId(config.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: isSelected ? 'var(--brand)' : 'var(--surface)',
                      border: `1.5px solid ${isSelected ? 'var(--brand)' : 'var(--border-strong)'}`,
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s',
                      gap: 10,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: isSelected ? '#fff' : 'var(--text-1)' }}>
                        {config.label}
                      </div>
                      {config.part_number_suffix && (
                        <div style={{ fontSize: 11, color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--text-3)', marginTop: 2 }}>
                          Part no. suffix: <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{config.part_number_suffix}</span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--text-3)' }}>
                        {config.preset_configuration_items?.length ?? 0} items
                      </span>
                      {isSelected && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Items preview */}
        <div style={{ marginBottom: 16 }}>
          {commonItems.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 6 }}>
                Common items (all configurations)
              </div>
              {commonItems.map((item) => {
                const product = products.find((p) => p.id === item.product_id)
                return (
                  <div key={item.id} className="preset-preview-item">
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{product?.description ?? 'Unknown product'}</div>
                      {product?.part_number && <span className="part-number" style={{ marginTop: 3, display: 'inline-block' }}>{product.part_number}</span>}
                    </div>
                    <span className="preset-preview-qty">×{item.quantity}</span>
                  </div>
                )
              })}
            </>
          )}

          {selectedConfig && configItems.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--brand)', marginBottom: 6, marginTop: commonItems.length > 0 ? 12 : 0 }}>
                {selectedConfig.label}
              </div>
              {configItems.map((item) => {
                const product = products.find((p) => p.id === item.product_id)
                return (
                  <div key={item.id} className="preset-preview-item" style={{ borderLeftColor: 'var(--brand)', paddingLeft: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{product?.description ?? 'Unknown product'}</div>
                      {product?.part_number && <span className="part-number" style={{ marginTop: 3, display: 'inline-block' }}>{product.part_number}</span>}
                    </div>
                    <span className="preset-preview-qty" style={{ background: 'var(--brand)', color: '#fff' }}>×{item.quantity}</span>
                  </div>
                )
              })}
            </>
          )}

          {preset.default_labour_minutes != null && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--brand-light)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--brand)' }}>
              Labour default: {preset.default_labour_minutes} minutes
            </div>
          )}
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
          Quantities will be added to your current BOM. You can adjust them afterwards.
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {configPN && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, background: 'var(--brand-light)', color: 'var(--brand)', padding: '4px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--brand)' }}>
                {configPN}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-secondary"
              onClick={handleApply}
              disabled={hasConfigs && !selectedConfigId}
            >
              Apply preset
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Presets bar ────────────────────────────────────────────────
export function PresetsBar({ presets, products, onApply, compact = false }: {
  presets: Preset[]
  products: Product[]
  onApply: (preset: Preset, configId?: string) => void
  compact?: boolean   // long preset ranges (TopTer): the list scrolls instead of filling the page
}) {
  const [previewPreset, setPreviewPreset] = useState<Preset | null>(null)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return presets
    const q = search.toLowerCase()
    return presets.filter((p) => {
      if (p.name.toLowerCase().includes(q)) return true
      if ((p.description ?? '').toLowerCase().includes(q)) return true
      // Search inside configurations
      if (p.preset_configurations?.some((c) =>
        c.label.toLowerCase().includes(q) ||
        (c.part_number_suffix ?? '').toLowerCase().includes(q)
      )) return true
      // Search inside items
      if (p.preset_items?.some((i) => {
        const prod = products.find((pr) => pr.id === i.product_id)
        return prod?.description.toLowerCase().includes(q) || (prod?.part_number ?? '').toLowerCase().includes(q)
      })) return true
      // Search inside config items
      if (p.preset_configurations?.some((c) =>
        c.preset_configuration_items?.some((i) => {
          const prod = products.find((pr) => pr.id === i.product_id)
          return prod?.description.toLowerCase().includes(q) || (prod?.part_number ?? '').toLowerCase().includes(q)
        })
      )) return true
      return false
    })
  }, [presets, products, search])

  if (presets.length === 0) return null

  return (
    <>
      <div className="presets-bar">
        <div className="presets-bar-header">
          <span className="presets-bar-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
            Quick presets
          </span>
          <span style={{ fontSize: 12, color: 'var(--secondary-text)', opacity: 0.7 }}>Tap to configure &amp; apply</span>
        </div>

        {/* Preset search */}
        <div style={{ marginBottom: 10 }}>
          <div className="search-wrap">
            <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="6.5" cy="6.5" r="4.5" /><path d="M10 10l3.5 3.5" />
            </svg>
            <input
              type="search"
              className="search-input"
              style={{ height: 34, fontSize: 12 }}
              placeholder="Search presets, configurations, part numbers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && <button className="search-clear" onClick={() => setSearch('')}>✕</button>}
          </div>
        </div>

        {filtered.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--secondary-text)', opacity: 0.7, padding: '4px 0' }}>No presets match "{search}"</div>
        )}

        <div className="presets-list" style={compact ? { maxHeight: 156, overflowY: 'auto', paddingRight: 4 } : undefined}>
          {filtered.map((preset) => {
            const configCount = preset.preset_configurations?.length ?? 0
            return (
              <button key={preset.id} className="preset-chip" onClick={() => setPreviewPreset(preset)}>
                {preset.name}
                {configCount > 0 ? (
                  <span className="preset-chip-count">{configCount} configs</span>
                ) : (
                  <span className="preset-chip-count">{preset.preset_items?.length ?? 0}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {previewPreset && (
        <PresetModal
          preset={previewPreset}
          products={products}
          onApply={onApply}
          onClose={() => setPreviewPreset(null)}
        />
      )}
    </>
  )
}

// ── One extra as a tick box (used by the Extras panel and the step-by-step builder) ──
export function ExtraRow({ extra, ctx, isTicked, applied, onToggle, onSetCount, costValue, onSetCost, productsById, move }: {
  extra: Extra
  ctx: BuildContext
  isTicked: boolean
  applied: AppliedExtra | undefined
  onToggle: (extraId: string) => void
  onSetCount: (extraId: string, count: number) => void
  costValue: string
  onSetCost: (extraId: string, value: string) => void
  productsById: Record<string, Product>
  move?: { index: number; count: number; disabled?: boolean; onMove: (dir: -1 | 1) => void }
}) {
  const reason = extraUnavailableReason(extra, ctx)
  const disabled = reason != null && !isTicked
  const lines = (applied?.lines ?? []).filter((l) => l.requested > 0)
  return (
    <div style={{ padding: '8px 10px', border: `1.5px solid ${applied ? 'var(--brand)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', background: applied ? 'var(--brand-light)' : 'transparent', opacity: disabled ? 0.5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      {move && <MoveButtons {...move} />}
      <label style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer' }}>
        <input type="checkbox" checked={isTicked} disabled={disabled} onChange={() => onToggle(extra.id)} style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            <span style={{ color: 'var(--text-3)', marginRight: 6 }}>{extra.number}.</span>{extra.name}
            {Number(extra.labour_minutes) > 0 && <span style={{ fontSize: 12, color: 'var(--brand)', marginLeft: 8 }}>+{extra.labour_minutes} min labour</span>}
          </div>
          {extra.description && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{extra.description}</div>}
          {reason && <div style={{ fontSize: 12, color: isTicked ? 'var(--danger)' : 'var(--text-3)', marginTop: 2 }}>{isTicked ? `Not applied: ${reason}` : reason}</div>}
        </div>
      </label>
      </div>
      {applied && extra.scales_with_bom && (() => {
        const max = applied.maxCount
        const btn = (enabled: boolean) => ({ width: 28, height: 28, borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--border-strong)', background: 'var(--surface)', fontSize: 16, lineHeight: 1, cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.35 })
        const canDown = applied.count > 0
        const canUp = max == null || applied.count < max
        return (
          <div style={{ marginTop: 8, marginLeft: 26, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{max != null ? 'Replace' : 'Quantity'}</span>
            <button type="button" style={btn(canDown)} disabled={!canDown} onClick={() => onSetCount(extra.id, applied.count - 1)} aria-label="Fewer">−</button>
            <span style={{ minWidth: 24, textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 14 }}>{applied.count}</span>
            <button type="button" style={btn(canUp)} disabled={!canUp} onClick={() => onSetCount(extra.id, applied.count + 1)} aria-label="More">+</button>
            {max != null && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>of {max} in the BOM</span>}
          </div>
        )
      })()}
      {applied && extra.rep_priced && (
        <div style={{ marginTop: 8, marginLeft: 26, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label htmlFor={`extra-cost-${extra.id}`} style={{ fontSize: 13, color: 'var(--text-2)' }}>Cost (£)</label>
          <input
            id={`extra-cost-${extra.id}`}
            className="input input-sm"
            type="number" min="0" step="0.01" placeholder="0.00"
            value={costValue}
            onChange={(e) => { const n = parseFloat(e.target.value); if (e.target.value.trim() === '' || isNaN(n) || n >= 0) onSetCost(extra.id, e.target.value) }}
            style={{ width: 120, fontFamily: 'var(--mono)' }}
          />
          <span style={{ fontSize: 12, color: applied.cost > 0 ? 'var(--text-3)' : 'var(--danger)' }}>
            {applied.cost <= 0 ? 'Enter the cost for this extra' : extra.rep_cost_uplift ? 'Added to materials, gets the hardware uplift' : 'Added at face value: no uplift, no labour'}
          </span>
        </div>
      )}
      {lines.length > 0 && (
        <div style={{ marginTop: 6, marginLeft: 26, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {lines.map((l, i) => {
            const prod = productsById[l.product_id]
            const name = prod ? `${prod.part_number ? `${prod.part_number} · ` : ''}${prod.description}` : 'Unknown product'
            const skipped = l.quantity === 0
            return (
              <div key={i} style={{ fontSize: 12, color: skipped ? 'var(--text-3)' : l.action === 'remove' ? 'var(--danger)' : 'var(--success)', textDecoration: skipped ? 'line-through' : 'none' }}>
                {l.action === 'remove' ? '−' : '+'}{l.requested} {name}
                {!skipped && prod?.factory_cost != null && <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>{l.action === 'remove' ? '−' : ''}£{(prod.factory_cost * l.quantity).toFixed(2)}</span>}
                {skipped && <span style={{ textDecoration: 'none', marginLeft: 6 }}>({l.action === 'remove' ? 'not in BOM' : 'nothing to replace'})</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Current rating / cabinet / size pickers (decide which extras apply) ──
export function BuildContextFields({ ctx, setCtx }: { ctx: BuildContext; setCtx: (ctx: BuildContext) => void }) {
  const labelStyle = { display: 'block', fontSize: 12, color: 'var(--text-2)', marginBottom: 4 } as const
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 120px' }}>
        <label style={labelStyle}>Current rating</label>
        <select className="input input-sm" value={ctx.rating ?? ''} onChange={(e) => setCtx({ ...ctx, rating: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Not set</option>
          {RATING_OPTIONS.map((r) => <option key={r} value={r}>{r}A</option>)}
        </select>
      </div>
      <div style={{ flex: '1 1 160px' }}>
        <label style={labelStyle}>Cabinet</label>
        <select className="input input-sm" value={ctx.material ?? ''} onChange={(e) => setCtx({ ...ctx, material: (e.target.value || null) as CabinetMaterial | null })}>
          <option value="">Not set</option>
          {(Object.keys(MATERIAL_LABELS) as CabinetMaterial[]).map((m) => <option key={m} value={m}>{MATERIAL_LABELS[m]}</option>)}
        </select>
      </div>
      <div style={{ flex: '1 1 100px' }}>
        <label style={labelStyle}>Cabinet size</label>
        <select className="input input-sm" value={ctx.size ?? ''} onChange={(e) => setCtx({ ...ctx, size: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Not set</option>
          {SIZE_OPTIONS.map((n) => <option key={n} value={n}>Size {n}</option>)}
        </select>
      </div>
    </div>
  )
}

// ── Extras panel ───────────────────────────────────────────────
function ExtrasPanel({ extras, selected, onToggle, onSetCount, costs, onSetCost, result, ctx, setCtx, productsById, reorderMode, reordering, onMoveExtra, showContext = true }: {
  extras: Extra[]
  selected: Set<string>
  onToggle: (extraId: string) => void
  onSetCount: (extraId: string, count: number) => void
  costs: ExtraCostMap
  onSetCost: (extraId: string, value: string) => void
  result: ExtrasResult
  ctx: BuildContext
  setCtx: (ctx: BuildContext) => void
  productsById: Record<string, Product>
  reorderMode: boolean
  reordering: boolean
  onMoveExtra: (extraId: string, groupIds: string[], dir: -1 | 1) => void
  showContext?: boolean   // EV: current rating / cabinet / size pickers
}) {
  if (extras.length === 0) return null
  const ids = extras.map((e) => e.id)
  const appliedById = Object.fromEntries(result.applied.map((a) => [a.extra.id, a]))
  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' }}>Extras</div>
        {showContext && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Filled in from the preset or steelwork — change if needed</div>}
      </div>

      {showContext && <div style={{ marginBottom: 12 }}><BuildContextFields ctx={ctx} setCtx={setCtx} /></div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {extras.map((extra, i) => {
          const move = reorderMode ? { index: i, count: extras.length, disabled: reordering, onMove: (dir: -1 | 1) => onMoveExtra(extra.id, ids, dir) } : undefined
          return <ExtraRow key={extra.id} extra={extra} ctx={ctx} isTicked={selected.has(extra.id)} applied={appliedById[extra.id]} onToggle={onToggle} onSetCount={onSetCount} costValue={costs[extra.id] ?? ''} onSetCost={onSetCost} productsById={productsById} move={move} />
        })}
      </div>
    </div>
  )
}

// ── Factory cost → gross profit → quote price → rebate → total quote ──
// Shared by the full builder and the step-by-step builder (bottom of the cost breakdown).
export function ProfitRebateRows({ pricing, gpValue, rebateValue, onGpChange, onRebateChange }: {
  pricing: QuotePricing
  gpValue: string
  rebateValue: string
  onGpChange: (value: string) => void
  onRebateChange: (value: string) => void
}) {
  const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 14 }
  const pctBox = (value: string, onChange: (v: string) => void, max: number, label: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input className="input input-sm" type="number" min="0" max={max} step="0.1" placeholder="0" aria-label={label}
        value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: 80, fontFamily: 'var(--mono)', textAlign: 'right' }} />
      <span style={{ color: 'var(--text-3)', fontSize: 13 }}>%</span>
    </span>
  )
  return (
    <>
      <div style={{ ...row, borderTop: '1.5px solid var(--border)', paddingTop: 8, marginTop: 2, fontSize: 16, fontWeight: 700 }}>
        <span>Factory cost</span><span>£{pricing.factoryCost.toFixed(2)}</span>
      </div>
      <div style={row}>
        <span style={{ color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          Gross profit {pctBox(gpValue, (v) => { if (pctInputOk(v, MAX_GP_PCT)) onGpChange(v) }, MAX_GP_PCT, 'Gross profit percentage')}
        </span>
        <span style={{ fontWeight: 500, color: 'var(--success)' }}>+£{pricing.grossProfit.toFixed(2)}</span>
      </div>
      <div style={{ ...row, fontSize: 15, fontWeight: 600 }}>
        <span>Quote price</span><span>£{pricing.quotePrice.toFixed(2)}</span>
      </div>
      <div style={row}>
        <span style={{ color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          Rebate {pctBox(rebateValue, (v) => { if (pctInputOk(v, 100)) onRebateChange(v) }, 100, 'Rebate percentage')}
        </span>
        <span style={{ fontWeight: 500, color: 'var(--danger)' }}>−£{pricing.rebateAmount.toFixed(2)}</span>
      </div>
      {pricing.carriage > 0 && (
        <div style={row}>
          <span style={{ color: 'var(--text-2)' }}>Carriage <span style={{ fontSize: 12, color: 'var(--text-3)' }}>(no profit or rebate)</span></span>
          <span style={{ fontWeight: 500 }}>+£{pricing.carriage.toFixed(2)}</span>
        </div>
      )}
      <div style={{ ...row, borderTop: '1.5px solid var(--border)', paddingTop: 8, marginTop: 2, fontSize: 17, fontWeight: 700, color: 'var(--brand)' }}>
        <span>Total quote</span><span>£{pricing.totalQuote.toFixed(2)}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
        {GP_MODE === 'margin' ? 'Gross profit is a margin: it is that % of the quote price.' : 'Gross profit is a markup: it is that % of the factory cost.'} Rebate comes off the quote price. Carriage is added after the rebate.
      </div>
    </>
  )
}

export default function QuoteBuilder({
  products, loading, variants, prerequisites, incompatMap, autoAdded,
  quantities, setQty, variantSelections, setVariantSelection,
  quoteForm, setQuoteForm, onSave, showToast,
  presets, onApplyPreset, settings,
  extras, selectedExtras, onToggleExtra, onSetExtraCount, extraCosts, onSetExtraCost, onClearQuote, canClear, extrasResult, buildContext, setBuildContext,
  editingQuote, onCancelEdit,
  isAdmin, onMoveProduct, onMoveExtra, reordering,
}: Props) {
  const cfg = useSectionConfig()
  const [search, setSearch] = useState('')
  const [reorderToggle, setReorderToggle] = useState(false)
  const reorderMode = isAdmin && reorderToggle
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveForm, setSaveForm] = useState<QuoteFormData>(EMPTY_FORM)

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => { const next = new Set(prev); next.has(cat) ? next.delete(cat) : next.add(cat); return next })
  }

  const variantsByProduct = useMemo(() => {
    const map: Record<string, ProductVariant[]> = {}
    variants.forEach((v) => { if (!map[v.product_id]) map[v.product_id] = []; map[v.product_id].push(v) })
    return map
  }, [variants])

  const prereqsByProduct = useMemo(() => {
    const map: Record<string, typeof prerequisites[number][]> = {}
    prerequisites.forEach((p) => { if (!map[p.product_id]) map[p.product_id] = []; map[p.product_id].push(p) })
    return map
  }, [prerequisites])

  const productsById = useMemo(() => {
    const map: Record<string, Product> = {}
    products.forEach((p) => { map[p.id] = p })
    return map
  }, [products])

  const variantsById = useMemo(() => {
    const map: Record<string, ProductVariant> = {}
    variants.forEach((v) => { map[v.id] = v })
    return map
  }, [variants])

  const autoAddedProductIds = useMemo(() => new Set(Object.keys(autoAdded)), [autoAdded])

  const autoAddedParents = useMemo(() => {
    const map: Record<string, string[]> = {}
    Object.entries(autoAdded).forEach(([prereqId, parents]) => {
      map[prereqId] = Object.keys(parents).map((parentId) => productsById[parentId]?.description ?? parentId)
    })
    return map
  }, [autoAdded, productsById])

  // Extras-only parts are added through the Extras panel, not picked from the list
  const catalogue = useMemo(() => products.filter((p) => p.category !== EXTRAS_CATEGORY), [products])

  const filtered = useMemo(() => {
    if (!search.trim()) return catalogue
    const q = search.toLowerCase()
    return catalogue.filter((p) =>
      p.description.toLowerCase().includes(q) ||
      (p.part_number ?? '').toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      (p.range_name ?? '').toLowerCase().includes(q),
    )
  }, [catalogue, search])

  const byCategory = useMemo(() => {
    const map: Record<string, Product[]> = {}
    cfg.categories.forEach((c) => { map[c] = [] })
    filtered.forEach((p) => { if (map[p.category]) map[p.category].push(p) })
    return map
  }, [filtered, cfg])

  // Quantities after extras — used for totals, PDF and save
  const finalQty = extrasResult.effectiveQty
  const extrasDelta = extrasResult.delta
  const activeItems = products.filter((p) => (finalQty[p.id] ?? 0) > 0)
  const activeCount = activeItems.length
  const searchActive = search.trim().length > 0

  const missingVariants = activeItems.filter((p) => {
    const pvs = variantsByProduct[p.id]
    return pvs && pvs.length > 0 && !variantSelections[p.id]
  })

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

  // TopTer: slots used beyond what the boards on the quote provide
  const overCapacity = cfg.usesCapacity ? capacityUsage(products, finalQty).filter((l) => l.over) : []

  const openSaveModal = () => {
    if (activeCount === 0) { showToast('Add at least one item first', 'error'); return }
    setSaveForm(quoteForm)
    setShowSaveModal(true)
  }

  const handleSave = async (asNew = false) => {
    if (!saveForm.project_name.trim()) { showToast('Project name is required', 'error'); return }
    setSaving(true)
    const ok = await onSave(saveForm, asNew)
    setSaving(false)
    if (ok) { setShowSaveModal(false); setSaveForm(EMPTY_FORM) }
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
        const selectedVariantId = variantSelections[p.id]
        const selectedVariant = selectedVariantId ? variantsById[selectedVariantId] : null
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
      section: cfg.key,
    })
  }

  const renderPrereqNote = (p: Product, isMobile = false) => {
    const qty = quantities[p.id] ?? 0
    if (qty === 0) return null
    const prereqs = prereqsByProduct[p.id]
    if (!prereqs || prereqs.length === 0) return null
    return (
      <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--success-bg)', border: '1px solid var(--success)', borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--success)', fontWeight: 500, maxWidth: isMobile ? '100%' : 340 }}>
        <span style={{ marginRight: 4 }}>✓</span>Auto-included:&nbsp;
        {prereqs.map((pr, i) => {
          const prereqProduct = productsById[pr.prerequisite_product_id]
          const label = pr.note || `${prereqProduct?.description ?? 'Unknown'} ×${pr.quantity}`
          return <span key={pr.id}>{i > 0 ? ', ' : ''}<strong>{label}</strong></span>
        })}
      </div>
    )
  }

  const renderAutoAddedNote = (p: Product) => {
    if (!autoAddedProductIds.has(p.id)) return null
    const parents = autoAddedParents[p.id]
    if (!parents || parents.length === 0) return null
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, padding: '2px 8px', background: 'var(--success-bg)', border: '1px solid var(--success)', borderRadius: 99, fontSize: 10, fontWeight: 600, color: 'var(--success)', whiteSpace: 'nowrap' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        Auto-added via {parents.slice(0, 2).join(', ')}{parents.length > 2 ? ` +${parents.length - 2} more` : ''}
      </div>
    )
  }

  const renderExtrasNote = (p: Product) => {
    const diff = extrasDelta[p.id]
    if (!diff) return null
    const removed = diff < 0
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, marginLeft: 4, padding: '2px 8px', background: removed ? 'var(--danger-bg)' : 'var(--brand-light)', border: `1px solid ${removed ? 'var(--danger)' : 'var(--brand)'}`, borderRadius: 99, fontSize: 10, fontWeight: 600, color: removed ? 'var(--danger)' : 'var(--brand)', whiteSpace: 'nowrap' }}>
        {removed ? `${diff}` : `+${diff}`} via extras · {finalQty[p.id] ?? 0} on quote
      </div>
    )
  }

  const renderVariantDropdown = (p: Product, isMobile = false) => {
    const pvs = variantsByProduct[p.id]
    const qty = quantities[p.id] ?? 0
    if (!pvs || pvs.length === 0 || qty === 0) return null
    const selectedId = variantSelections[p.id] ?? ''
    const selectedVariant = selectedId ? variantsById[selectedId] : null
    const missing = !selectedId
    const combinedPN = selectedVariant ? getDisplayPartNumber(p, selectedVariant) : null

    return (
      <div style={{ marginTop: isMobile ? 8 : 6 }}>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: missing ? 'var(--danger)' : 'var(--brand)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
          {missing ? '⚠ Select variant' : 'Variant'}
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="input input-sm" style={{ borderColor: missing ? 'var(--danger)' : 'var(--brand)', maxWidth: isMobile ? '100%' : 240, flex: '1 1 auto' }} value={selectedId} onChange={(e) => setVariantSelection(p.id, e.target.value)}>
            <option value="">Select an option…</option>
            {pvs.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          {combinedPN && combinedPN !== p.part_number && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Part no.</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, background: 'var(--brand-light)', color: 'var(--brand)', padding: '2px 7px', borderRadius: 4, border: '1px solid var(--brand)' }}>{combinedPN}</span>
            </div>
          )}
          {selectedVariant && !selectedVariant.part_number_suffix && p.part_number && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Part no.</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-2)', padding: '2px 7px', background: 'var(--surface-3)', borderRadius: 4 }}>{p.part_number}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (loading) return <div className="loading"><div className="spinner" /> Loading catalogue…</div>

  return (
    <>
      {editingQuote && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 16, background: 'var(--warning-bg)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--warning)', fontWeight: 500 }}>
          <span>Editing saved quote: <strong>{editingQuote.project_name}</strong></span>
          <button className="btn btn-sm" onClick={onCancelEdit}>Cancel edit</button>
        </div>
      )}

      <PresetsBar presets={presets} products={catalogue} onApply={onApplyPreset} compact={cfg.usesCapacity} />

      {/* Quote info */}
      <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 10 }}>Quote details</div>
        <div className="quote-info-grid">
          <input className="input" placeholder="Project name *" value={quoteForm.project_name} onChange={(e) => setQuoteForm({ ...quoteForm, project_name: e.target.value })} />
          <input className="input" placeholder="Customer name" value={quoteForm.customer_name} onChange={(e) => setQuoteForm({ ...quoteForm, customer_name: e.target.value })} />
          <input className="input" placeholder="MO number" value={quoteForm.mo_number} onChange={(e) => setQuoteForm({ ...quoteForm, mo_number: e.target.value })} style={{ fontFamily: 'var(--mono)' }} />
        </div>
        <input className="input" placeholder="Notes (optional)" value={quoteForm.notes} onChange={(e) => setQuoteForm({ ...quoteForm, notes: e.target.value })} style={{ marginTop: 10 }} />
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 8 }}>Labour</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Duration (minutes)</label>
              <input className="input" type="number" min="0" step="1" placeholder="0" value={quoteForm.labour_minutes} onChange={(e) => setQuoteForm({ ...quoteForm, labour_minutes: e.target.value })} />
            </div>
            {labourRate > 0 && (
              <div style={{ paddingBottom: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>Rate</div>
                <div style={{ height: 42, display: 'flex', alignItems: 'center', padding: '0 12px', background: 'var(--surface-3)', borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--text-2)', border: '1.5px solid var(--border)' }}>£{labourRate.toFixed(4)}/min</div>
              </div>
            )}
            {labourTotal > 0 && (
              <div style={{ paddingBottom: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>Labour total</div>
                <div style={{ height: 42, display: 'flex', alignItems: 'center', padding: '0 14px', background: 'var(--brand-light)', border: '1px solid var(--brand)', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, color: 'var(--brand)', whiteSpace: 'nowrap' }}>£{labourTotal.toFixed(2)}</div>
              </div>
            )}
          </div>
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 8 }}>Hardware uplift</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Uplift (%)</label>
              <input className="input" type="number" min="0" max="100" step="0.1" placeholder={String(defaultUpliftPct)} value={quoteForm.uplift_pct} onChange={(e) => setUplift(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
            </div>
            <div style={{ paddingBottom: 1, fontSize: 12, color: 'var(--text-3)', minHeight: 42, display: 'flex', alignItems: 'center', gap: 8 }}>
              {quoteForm.uplift_pct.trim() === ''
                ? <span>Using the default {defaultUpliftPct}%</span>
                : <>
                    <span>Default is {defaultUpliftPct}%</span>
                    <button className="btn btn-sm" onClick={() => setQuoteForm({ ...quoteForm, uplift_pct: '' })}>Use default</button>
                  </>}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 8 }}>Carriage</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Carriage (£)</label>
              <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={quoteForm.carriage} onChange={(e) => setCarriage(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
            </div>
            <div style={{ paddingBottom: 1, fontSize: 12, color: 'var(--text-3)', minHeight: 42, display: 'flex', alignItems: 'center' }}>
              <span>Added after the rebate: no uplift, profit or rebate</span>
            </div>
          </div>
        </div>
      </div>

      {cfg.usesCapacity && <CapacityPanel products={products} qty={finalQty} />}

      {reorderMode && <ReorderBanner />}

      <ExtrasPanel extras={extras} selected={selectedExtras} onToggle={onToggleExtra} onSetCount={onSetExtraCount} costs={extraCosts} onSetCost={onSetExtraCost} result={extrasResult} ctx={buildContext} setCtx={setBuildContext} productsById={productsById} reorderMode={reorderMode} reordering={reordering} onMoveExtra={onMoveExtra} showContext={cfg.usesBuildContext} />

      <div className="toolbar" style={isAdmin ? { display: 'flex', gap: 8, alignItems: 'center' } : undefined}>
        <div style={{ flex: 1, minWidth: 0 }}><SearchBar value={search} onChange={setSearch} placeholder="Search parts, part numbers, categories…" /></div>
        {isAdmin && <ReorderToggle on={reorderToggle} onChange={setReorderToggle} />}
      </div>

      {reorderMode && searchActive && (
        <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 12 }}>Clear the search to move parts.</div>
      )}

      {missingVariants.length > 0 && (
        <div style={{ padding: '10px 14px', background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', marginBottom: 12, fontSize: 13, color: 'var(--danger)', fontWeight: 500 }}>
          {missingVariants.length} item{missingVariants.length !== 1 ? 's' : ''} need a variant selection before saving
        </div>
      )}

      <IncompatBanner incompatMap={incompatMap} qty={finalQty} productsById={productsById} />

      {searchActive && filtered.length === 0 && (
        <div className="empty-state"><div className="empty-state-icon">🔍</div><h3>No parts found</h3><p>Try a different search term or part number</p></div>
      )}

      {cfg.categories.map((cat) => {
        const items = byCategory[cat] ?? []
        if (items.length === 0) return null
        const isOpen = searchActive || !collapsed.has(cat)
        const catQty = items.reduce((s, p) => s + (quantities[p.id] ?? 0), 0)
        const itemIds = items.map((p) => p.id)
        const canMove = reorderMode && !searchActive
        const moveProps = (idx: number) => ({ index: idx, count: items.length, disabled: reordering, onMove: (dir: -1 | 1) => onMoveProduct(items[idx].id, itemIds, dir) })

        return (
          <div className="category-section" key={cat}>
            <div className="category-header" onClick={() => !searchActive && toggleCategory(cat)}>
              <span className="category-label">{cat}</span>
              <span className="category-count">
                {catQty > 0 && <span style={{ background: 'var(--brand)', color: '#fff', borderRadius: 99, padding: '1px 8px', fontSize: 10, fontWeight: 700 }}>{catQty} selected</span>}
                {items.length} items
                {!searchActive && <svg className={`category-chevron ${isOpen ? 'open' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6l4 4 4-4" /></svg>}
              </span>
            </div>

            {isOpen && cfg.usesRanges && !canMove && (
              <RangeList
                items={items}
                all={products}
                qtyOf={(id) => quantities[id] ?? 0}
                onQuoteOf={(id) => finalQty[id] ?? 0}
                setQty={setQty}
                blockedOf={(p) => (finalQty[p.id] ?? 0) <= 0 && clashesFor(p.id, incompatMap, finalQty).length > 0}
                clashOf={(p) => (finalQty[p.id] ?? 0) > 0 && clashesFor(p.id, incompatMap, finalQty).length > 0}
                partNumberOf={(p) => getDisplayPartNumber(p, variantSelections[p.id] ? variantsById[variantSelections[p.id]] ?? null : null)}
                renderDetails={(p) => (
                  <>
                    <IncompatNote clashIds={clashesFor(p.id, incompatMap, finalQty)} productsById={productsById} onQuote={(finalQty[p.id] ?? 0) > 0} />
                    {renderAutoAddedNote(p)}
                    {renderExtrasNote(p)}
                    {renderPrereqNote(p, true)}
                    {renderVariantDropdown(p, true)}
                  </>
                )}
                openAll={searchActive}
              />
            )}

            {isOpen && !(cfg.usesRanges && !canMove) && (
              <>
                <div className="card" style={{ marginBottom: 4 }}>
                  <table className="product-table">
                    <thead>
                      <tr>
                        {canMove && <th style={{ width: 40 }}></th>}
                        <th>Description</th>
                        <th style={{ width: 130 }}>Part no.</th>
                        <th className="right" style={{ width: 90 }}>Unit cost</th>
                        <th className="right" style={{ width: 130 }}>Quantity</th>
                        <th className="right" style={{ width: 90 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((p, idx) => {
                        const qty = quantities[p.id] ?? 0
                        const onQuote = finalQty[p.id] ?? 0
                        const lineTotal = p.factory_cost != null && onQuote > 0 ? p.factory_cost * onQuote : null
                        const isAutoAdded = autoAddedProductIds.has(p.id)
                        const selectedVariantId = variantSelections[p.id]
                        const selectedVariant = selectedVariantId ? variantsById[selectedVariantId] : null
                        const displayPN = getDisplayPartNumber(p, selectedVariant ?? null)
                        const clashIds = clashesFor(p.id, incompatMap, finalQty)
                        const blocked = clashIds.length > 0 && onQuote <= 0
                        return (
                          <tr key={p.id} style={blocked ? { background: 'var(--surface-3)', color: 'var(--text-3)' } : isAutoAdded && qty > 0 ? { background: 'rgba(5,150,105,0.04)' } : {}}>
                            {canMove && <td style={{ verticalAlign: 'middle' }}><MoveButtons {...moveProps(idx)} /></td>}
                            <td>
                              <WithPicture product={p} size={44}>
                              <div style={{ fontWeight: qty > 0 ? 500 : 400 }}>{p.description}</div>
                              {p.notes && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{p.notes}</div>}
                              {cfg.usesCapacity && <CapacityNote product={p} />}
                              <IncompatNote clashIds={clashIds} productsById={productsById} onQuote={onQuote > 0} />
                              {renderAutoAddedNote(p)}
                              {renderExtrasNote(p)}
                              {renderPrereqNote(p)}
                              {renderVariantDropdown(p)}
                              </WithPicture>
                            </td>
                            <td>
                              {displayPN ? (
                                <span className="part-number" style={selectedVariant?.part_number_suffix ? { color: 'var(--brand)', background: 'var(--brand-light)', fontWeight: 600 } : {}}>{displayPN}</span>
                              ) : <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>}
                            </td>
                            <td className="right">{p.factory_cost != null ? <span style={{ fontWeight: 500 }}>{fmt(p.factory_cost)}</span> : <span className="cost-tbc">TBC</span>}</td>
                            <td className="right"><div style={{ display: 'flex', justifyContent: 'flex-end' }}><Stepper value={qty} onChange={(n) => setQty(p.id, n)} disabled={blocked} step={qtyStep(p)} /></div></td>
                            <td className="right" style={{ fontWeight: onQuote > 0 ? 600 : 400 }}>{lineTotal != null ? fmt(lineTotal) : onQuote > 0 ? <span className="cost-tbc">TBC</span> : <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="product-cards">
                  {items.map((p, idx) => {
                    const qty = quantities[p.id] ?? 0
                    const onQuote = finalQty[p.id] ?? 0
                    const lineTotal = p.factory_cost != null && onQuote > 0 ? p.factory_cost * onQuote : null
                    const isAutoAdded = autoAddedProductIds.has(p.id)
                    const selectedVariantId = variantSelections[p.id]
                    const selectedVariant = selectedVariantId ? variantsById[selectedVariantId] : null
                    const displayPN = getDisplayPartNumber(p, selectedVariant ?? null)
                    const clashIds = clashesFor(p.id, incompatMap, finalQty)
                    const blocked = clashIds.length > 0 && onQuote <= 0
                    return (
                      <div key={p.id} className="product-card" style={blocked ? { background: 'var(--surface-3)', opacity: 0.7 } : qty > 0 ? { borderColor: isAutoAdded ? 'var(--success)' : 'var(--brand)', borderWidth: '1.5px' } : {}}>
                        {canMove && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Position {idx + 1} of {items.length}</span>
                            <MoveButtons {...moveProps(idx)} />
                          </div>
                        )}
                        <div className="product-card-header">
                          <WithPicture product={p} size={52}>
                          <div>
                            <div className="product-card-desc">{p.description}</div>
                            {displayPN && <span className="part-number" style={{ marginTop: 4, display: 'inline-block', ...(selectedVariant?.part_number_suffix ? { color: 'var(--brand)', background: 'var(--brand-light)', fontWeight: 600 } : {}) }}>{displayPN}</span>}
                            {cfg.usesCapacity && <CapacityNote product={p} />}
                            <IncompatNote clashIds={clashIds} productsById={productsById} onQuote={onQuote > 0} />
                            {renderAutoAddedNote(p)}
                            {renderExtrasNote(p)}
                          </div>
                          </WithPicture>
                          <div style={{ flexShrink: 0 }}><Stepper value={qty} onChange={(n) => setQty(p.id, n)} disabled={blocked} step={qtyStep(p)} /></div>
                        </div>
                        {renderPrereqNote(p, true)}
                        {renderVariantDropdown(p, true)}
                        <div className="product-card-meta">
                          <span className="product-card-cost">{p.factory_cost != null ? fmt(p.factory_cost) : <span className="cost-tbc">TBC</span>}<span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400, marginLeft: 4 }}>each</span></span>
                          {onQuote > 0 && <span className="product-card-total">Total: {lineTotal != null ? <strong>{fmt(lineTotal)}</strong> : <span className="cost-tbc">TBC</span>}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )
      })}

      {activeCount > 0 && (
        <div className="card" style={{ marginTop: 16, padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 10 }}>Cost breakdown</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
              <span style={{ color: 'var(--text-2)' }}>Materials subtotal</span>
              <span style={{ fontWeight: 500 }}>£{materialsSubtotal.toFixed(2)}</span>
            </div>
            {hardwareUpliftAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'var(--secondary-text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ background: 'var(--secondary)', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>+{upliftPct}%</span>
                  Hardware uplift
                </span>
                <span style={{ fontWeight: 500, color: 'var(--secondary-text)' }}>£{hardwareUpliftAmount.toFixed(2)}</span>
              </div>
            )}
            {labourTotal > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: 6 }}>Labour <span style={{ fontSize: 12, color: 'var(--text-3)' }}>({labourMinutes} min{extrasLabourMinutes > 0 ? `, incl. ${extrasLabourMinutes} for extras` : ''} @ £{labourRate.toFixed(4)}/min)</span></span>
                <span style={{ fontWeight: 500, color: 'var(--brand)' }}>£{labourTotal.toFixed(2)}</span>
              </div>
            )}
            {costedExtras.map(({ extra, cost }) => (
              <div key={extra.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'var(--text-2)' }}>{extra.name}</span>
                <span style={{ fontWeight: 500 }}>£{cost.toFixed(2)}</span>
              </div>
            ))}
            <ProfitRebateRows
              pricing={pricing}
              gpValue={quoteForm.gp_pct}
              rebateValue={quoteForm.rebate_pct}
              onGpChange={(v) => setQuoteForm({ ...quoteForm, gp_pct: v })}
              onRebateChange={(v) => setQuoteForm({ ...quoteForm, rebate_pct: v })}
            />
          </div>
        </div>
      )}

      <div className="total-bar">
        <div>
          <div className="total-bar-label">Total quote</div>
          <div className="total-bar-amount">{`£${pricing.totalQuote.toFixed(2)}`}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>Factory cost £{factoryCost.toFixed(2)}</div>
          {activeCount > 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{activeCount} line item{activeCount !== 1 ? 's' : ''}</div>}
          {overCapacity.length > 0 && <div style={{ fontSize: 11, color: 'var(--secondary)', fontWeight: 600, marginTop: 2 }}>⚠ Over board capacity: {overCapacity.map((l) => l.label.toLowerCase()).join(', ')}</div>}
        </div>
        <div className="total-bar-actions">
          {canClear && <button className="btn btn-ghost" style={{ color: 'rgba(255,255,255,0.65)' }} onClick={onClearQuote}>Clear</button>}
          <button className="btn" style={{ background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.25)', color: '#fff' }} onClick={handlePdf}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
            PDF
          </button>
          <button className="btn btn-secondary" onClick={openSaveModal}>{editingQuote ? 'Update quote' : 'Save quote'}</button>
        </div>
      </div>

      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <h2 style={{ marginBottom: 4 }}>{editingQuote ? 'Update quote' : 'Save quote'}</h2>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: missingVariants.length > 0 || overCapacity.length > 0 ? 10 : 20 }}>
              {activeCount} item{activeCount !== 1 ? 's' : ''} · factory cost £{factoryCost.toFixed(2)} · total quote £{pricing.totalQuote.toFixed(2)}
            </p>
            {missingVariants.length > 0 && (
              <div style={{ padding: '8px 12px', background: 'var(--warning-bg)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--warning)', marginBottom: 16 }}>
                Note: {missingVariants.length} item{missingVariants.length !== 1 ? 's' : ''} still need a variant selected.
              </div>
            )}
            {overCapacity.length > 0 && (
              <div style={{ padding: '8px 12px', background: 'var(--warning-bg)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--warning)', marginBottom: 16 }}>
                Note: more {overCapacity.map((l) => l.label.toLowerCase()).join(', ')} are used than the boards on the quote provide.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <input className="input" placeholder="Project name *" value={saveForm.project_name} onChange={(e) => setSaveForm({ ...saveForm, project_name: e.target.value })} autoFocus />
              <input className="input" placeholder="Customer name" value={saveForm.customer_name} onChange={(e) => setSaveForm({ ...saveForm, customer_name: e.target.value })} />
              <input className="input" placeholder="MO number" value={saveForm.mo_number} onChange={(e) => setSaveForm({ ...saveForm, mo_number: e.target.value })} style={{ fontFamily: 'var(--mono)' }} />
              <input className="input" placeholder="Notes (optional)" value={saveForm.notes} onChange={(e) => setSaveForm({ ...saveForm, notes: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => setShowSaveModal(false)}>Cancel</button>
              {editingQuote && <button className="btn" onClick={() => handleSave(true)} disabled={saving}>Save as new quote</button>}
              <button className="btn btn-primary" onClick={() => handleSave()} disabled={saving}>{saving ? 'Saving…' : editingQuote ? 'Update quote' : 'Save quote'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
