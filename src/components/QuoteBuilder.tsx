import { useState, useMemo } from 'react'
import type {
  Product, ProductVariant, ProductPrerequisite,
  QuantityMap, VariantSelectionMap, AutoAddedMap,
  QuoteFormData, Preset, AppSettings,
} from '../types'
import { CATEGORIES } from '../types'
import SearchBar from './SearchBar'
import { printQuote } from '../utils/printQuote'

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
  onSave: (f: QuoteFormData) => Promise<boolean>
  showToast: (msg: string, type?: 'success' | 'error') => void
  presets: Preset[]
  onApplyPreset: (preset: Preset) => void
  settings: AppSettings
}

const fmt = (n: number | null) => n != null ? `£${n.toFixed(2)}` : null

// Returns the full part number for a product, including variant suffix if selected
function getDisplayPartNumber(product: Product, variant: ProductVariant | null): string | null {
  if (!variant) return product.part_number
  if (!variant.part_number_suffix) return product.part_number
  return product.part_number
    ? `${product.part_number}${variant.part_number_suffix}`
    : variant.part_number_suffix
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="stepper">
      <button className="stepper-btn" onPointerDown={(e) => { e.preventDefault(); onChange(Math.max(0, value - 1)) }} aria-label="Decrease">−</button>
      <input className="stepper-input" type="number" min="0" max="999" value={value || ''} placeholder="0" onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))} />
      <button className="stepper-btn" onPointerDown={(e) => { e.preventDefault(); onChange(value + 1) }} aria-label="Increase">+</button>
    </div>
  )
}

function PresetsBar({ presets, products, onApply }: { presets: Preset[]; products: Product[]; onApply: (p: Preset) => void }) {
  const [previewPreset, setPreviewPreset] = useState<Preset | null>(null)
  if (presets.length === 0) return null

  return (
    <>
      <div className="presets-bar">
        <div className="presets-bar-header">
          <span className="presets-bar-label">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
            Quick presets
          </span>
          <span style={{ fontSize: 12, color: 'var(--secondary-text)', opacity: 0.7 }}>Tap to preview &amp; apply</span>
        </div>
        <div className="presets-list">
          {presets.map((preset) => (
            <button key={preset.id} className="preset-chip" onClick={() => setPreviewPreset(preset)}>
              {preset.name}
              <span className="preset-chip-count">{preset.preset_items?.length ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {previewPreset && (
        <div className="modal-overlay" onClick={() => setPreviewPreset(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-handle" />
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 17 }}>{previewPreset.name}</h2>
                {previewPreset.description && <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3 }}>{previewPreset.description}</p>}
              </div>
              <span className="badge badge-preset">{previewPreset.preset_items?.length ?? 0} items</span>
            </div>
            <div style={{ marginBottom: 16 }}>
              {(previewPreset.preset_items ?? []).map((item) => {
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
              {previewPreset.default_labour_minutes != null && (
                <div style={{ marginTop: 10, padding: '8px 10px', background: 'var(--brand-light)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--brand)' }}>
                  Labour default: {previewPreset.default_labour_minutes} minutes
                </div>
              )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>Quantities will be added to your current BOM. You can adjust them afterwards.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setPreviewPreset(null)}>Cancel</button>
              <button className="btn btn-secondary" onClick={() => { onApply(previewPreset); setPreviewPreset(null) }}>Apply preset</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function QuoteBuilder({
  products, loading, variants, prerequisites, autoAdded,
  quantities, setQty, variantSelections, setVariantSelection,
  quoteForm, setQuoteForm, onSave, showToast,
  presets, onApplyPreset, settings,
}: Props) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveForm, setSaveForm] = useState<QuoteFormData>({
    project_name: '', customer_name: '', mo_number: '', notes: '', labour_minutes: '',
  })

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => { const next = new Set(prev); next.has(cat) ? next.delete(cat) : next.add(cat); return next })
  }

  const variantsByProduct = useMemo(() => {
    const map: Record<string, ProductVariant[]> = {}
    variants.forEach((v) => { if (!map[v.product_id]) map[v.product_id] = []; map[v.product_id].push(v) })
    return map
  }, [variants])

  const prereqsByProduct = useMemo(() => {
    const map: Record<string, ProductPrerequisite[]> = {}
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

  const filtered = useMemo(() => {
    if (!search.trim()) return products
    const q = search.toLowerCase()
    return products.filter((p) =>
      p.description.toLowerCase().includes(q) ||
      (p.part_number ?? '').toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q),
    )
  }, [products, search])

  const byCategory = useMemo(() => {
    const map: Record<string, Product[]> = {}
    CATEGORIES.forEach((c) => { map[c] = [] })
    filtered.forEach((p) => { if (map[p.category]) map[p.category].push(p) })
    return map
  }, [filtered])

  const activeItems = products.filter((p) => (quantities[p.id] ?? 0) > 0)
  const activeCount = activeItems.length
  const searchActive = search.trim().length > 0

  const missingVariants = activeItems.filter((p) => {
    const pvs = variantsByProduct[p.id]
    return pvs && pvs.length > 0 && !variantSelections[p.id]
  })

  const materialsSubtotal = activeItems.reduce((sum, p) => sum + (p.factory_cost != null ? p.factory_cost * (quantities[p.id] ?? 0) : 0), 0)
  const upliftPct = settings.hardware_uplift_pct
  const hardwareUpliftAmount = materialsSubtotal * upliftPct / 100
  const labourMinutes = parseFloat(quoteForm.labour_minutes) || 0
  const labourRate = settings.labour_rate_per_min
  const labourTotal = labourMinutes * labourRate
  const grandTotal = materialsSubtotal + hardwareUpliftAmount + labourTotal

  const handleClear = () => {
    if (activeCount === 0) return
    if (confirm('Clear all quantities?')) products.forEach((p) => setQty(p.id, 0))
  }

  const openSaveModal = () => {
    if (activeCount === 0) { showToast('Add at least one item first', 'error'); return }
    setSaveForm(quoteForm)
    setShowSaveModal(true)
  }

  const handleSave = async () => {
    if (!saveForm.project_name.trim()) { showToast('Project name is required', 'error'); return }
    setSaving(true)
    const ok = await onSave(saveForm)
    setSaving(false)
    if (ok) { setShowSaveModal(false); setSaveForm({ project_name: '', customer_name: '', mo_number: '', notes: '', labour_minutes: '' }) }
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
          quantity: quantities[p.id],
          line_total: p.factory_cost != null ? p.factory_cost * quantities[p.id] : null,
          variant_label: selectedVariant?.label ?? null,
        }
      }),
      materialsSubtotal, hardwareUpliftPct: upliftPct, hardwareUpliftAmount,
      labourMinutes, labourRatePerMin: labourRate, labourTotal, grandTotal,
      baseUrl: (import.meta as any).env.BASE_URL,
    })
  }

  // ── Prereq note ────────────────────────────────────────────
  const renderPrereqNote = (p: Product, isMobile = false) => {
    const qty = quantities[p.id] ?? 0
    if (qty === 0) return null
    const prereqs = prereqsByProduct[p.id]
    if (!prereqs || prereqs.length === 0) return null

    return (
      <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--success-bg)', border: '1px solid var(--success)', borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--success)', fontWeight: 500, maxWidth: isMobile ? '100%' : 340 }}>
        <span style={{ marginRight: 4 }}>✓</span>
        Auto-included:&nbsp;
        {prereqs.map((pr, i) => {
          const prereqProduct = productsById[pr.prerequisite_product_id]
          const label = pr.note || `${prereqProduct?.description ?? 'Unknown'} ×${pr.quantity}`
          return <span key={pr.id}>{i > 0 ? ', ' : ''}<strong>{label}</strong></span>
        })}
      </div>
    )
  }

  // ── Auto-added badge ───────────────────────────────────────
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

  // ── Variant dropdown with combined part number preview ─────
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
          <select
            className="input input-sm"
            style={{ borderColor: missing ? 'var(--danger)' : 'var(--brand)', maxWidth: isMobile ? '100%' : 240, flex: '1 1 auto' }}
            value={selectedId}
            onChange={(e) => setVariantSelection(p.id, e.target.value)}
          >
            <option value="">Select an option…</option>
            {pvs.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>

          {/* Show combined part number when variant with suffix is selected */}
          {combinedPN && combinedPN !== p.part_number && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Part no.</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, background: 'var(--brand-light)', color: 'var(--brand)', padding: '2px 7px', borderRadius: 4, border: '1px solid var(--brand)' }}>
                {combinedPN}
              </span>
            </div>
          )}
          {/* If no suffix, just confirm the base part number */}
          {selectedVariant && !selectedVariant.part_number_suffix && p.part_number && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Part no.</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-2)', padding: '2px 7px', background: 'var(--surface-3)', borderRadius: 4 }}>
                {p.part_number}
              </span>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (loading) return <div className="loading"><div className="spinner" /> Loading catalogue…</div>

  return (
    <>
      <PresetsBar presets={presets} products={products} onApply={onApplyPreset} />

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
                <div style={{ height: 42, display: 'flex', alignItems: 'center', padding: '0 12px', background: 'var(--surface-3)', borderRadius: 'var(--radius-md)', fontSize: 13, fontFamily: 'var(--mono)', color: 'var(--text-2)', border: '1.5px solid var(--border)' }}>
                  £{labourRate.toFixed(4)}/min
                </div>
              </div>
            )}
            {labourTotal > 0 && (
              <div style={{ paddingBottom: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>Labour total</div>
                <div style={{ height: 42, display: 'flex', alignItems: 'center', padding: '0 14px', background: 'var(--brand-light)', border: '1px solid var(--brand)', borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600, color: 'var(--brand)', whiteSpace: 'nowrap' }}>
                  £{labourTotal.toFixed(2)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search parts, part numbers, categories…" />
      </div>

      {missingVariants.length > 0 && (
        <div style={{ padding: '10px 14px', background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-md)', marginBottom: 12, fontSize: 13, color: 'var(--danger)', fontWeight: 500 }}>
          {missingVariants.length} item{missingVariants.length !== 1 ? 's' : ''} need a variant selection before saving
        </div>
      )}

      {searchActive && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <h3>No parts found</h3>
          <p>Try a different search term or part number</p>
        </div>
      )}

      {CATEGORIES.map((cat) => {
        const items = byCategory[cat] ?? []
        if (items.length === 0) return null
        const isOpen = searchActive || !collapsed.has(cat)
        const catQty = items.reduce((s, p) => s + (quantities[p.id] ?? 0), 0)

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

            {isOpen && (
              <>
                <div className="card" style={{ marginBottom: 4 }}>
                  <table className="product-table">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th style={{ width: 130 }}>Part no.</th>
                        <th className="right" style={{ width: 90 }}>Unit cost</th>
                        <th className="right" style={{ width: 130 }}>Quantity</th>
                        <th className="right" style={{ width: 90 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((p) => {
                        const qty = quantities[p.id] ?? 0
                        const lineTotal = p.factory_cost != null && qty > 0 ? p.factory_cost * qty : null
                        const isAutoAdded = autoAddedProductIds.has(p.id)
                        const selectedVariantId = variantSelections[p.id]
                        const selectedVariant = selectedVariantId ? variantsById[selectedVariantId] : null
                        const displayPN = getDisplayPartNumber(p, selectedVariant ?? null)

                        return (
                          <tr key={p.id} style={isAutoAdded && qty > 0 ? { background: 'rgba(5,150,105,0.04)' } : {}}>
                            <td>
                              <div style={{ fontWeight: qty > 0 ? 500 : 400 }}>{p.description}</div>
                              {p.notes && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{p.notes}</div>}
                              {renderAutoAddedNote(p)}
                              {renderPrereqNote(p)}
                              {renderVariantDropdown(p)}
                            </td>
                            <td>
                              {displayPN ? (
                                <span className="part-number" style={selectedVariant?.part_number_suffix ? { color: 'var(--brand)', background: 'var(--brand-light)', fontWeight: 600 } : {}}>
                                  {displayPN}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>
                              )}
                            </td>
                            <td className="right">{p.factory_cost != null ? <span style={{ fontWeight: 500 }}>{fmt(p.factory_cost)}</span> : <span className="cost-tbc">TBC</span>}</td>
                            <td className="right"><div style={{ display: 'flex', justifyContent: 'flex-end' }}><Stepper value={qty} onChange={(n) => setQty(p.id, n)} /></div></td>
                            <td className="right" style={{ fontWeight: qty > 0 ? 600 : 400 }}>
                              {lineTotal != null ? fmt(lineTotal) : qty > 0 ? <span className="cost-tbc">TBC</span> : <span style={{ color: 'var(--text-3)' }}>—</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="product-cards">
                  {items.map((p) => {
                    const qty = quantities[p.id] ?? 0
                    const lineTotal = p.factory_cost != null && qty > 0 ? p.factory_cost * qty : null
                    const isAutoAdded = autoAddedProductIds.has(p.id)
                    const selectedVariantId = variantSelections[p.id]
                    const selectedVariant = selectedVariantId ? variantsById[selectedVariantId] : null
                    const displayPN = getDisplayPartNumber(p, selectedVariant ?? null)

                    return (
                      <div key={p.id} className="product-card" style={qty > 0 ? { borderColor: isAutoAdded ? 'var(--success)' : 'var(--brand)', borderWidth: '1.5px' } : {}}>
                        <div className="product-card-header">
                          <div>
                            <div className="product-card-desc">{p.description}</div>
                            {displayPN && (
                              <span
                                className="part-number"
                                style={{ marginTop: 4, display: 'inline-block', ...(selectedVariant?.part_number_suffix ? { color: 'var(--brand)', background: 'var(--brand-light)', fontWeight: 600 } : {}) }}
                              >
                                {displayPN}
                              </span>
                            )}
                            {renderAutoAddedNote(p)}
                          </div>
                          <div style={{ flexShrink: 0 }}><Stepper value={qty} onChange={(n) => setQty(p.id, n)} /></div>
                        </div>
                        {renderPrereqNote(p, true)}
                        {renderVariantDropdown(p, true)}
                        <div className="product-card-meta">
                          <span className="product-card-cost">
                            {p.factory_cost != null ? fmt(p.factory_cost) : <span className="cost-tbc">TBC</span>}
                            <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400, marginLeft: 4 }}>each</span>
                          </span>
                          {qty > 0 && <span className="product-card-total">Total: {lineTotal != null ? <strong>{fmt(lineTotal)}</strong> : <span className="cost-tbc">TBC</span>}</span>}
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

      {/* Cost breakdown */}
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
                <span style={{ color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  Labour <span style={{ fontSize: 12, color: 'var(--text-3)' }}>({labourMinutes} min @ £{labourRate.toFixed(4)}/min)</span>
                </span>
                <span style={{ fontWeight: 500, color: 'var(--brand)' }}>£{labourTotal.toFixed(2)}</span>
              </div>
            )}
            <div style={{ borderTop: '1.5px solid var(--border)', paddingTop: 8, marginTop: 2, display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 700 }}>
              <span>Grand total</span>
              <span>£{grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Total bar */}
      <div className="total-bar">
        <div>
          <div className="total-bar-label">Grand total</div>
          <div className="total-bar-amount">{`£${grandTotal.toFixed(2)}`}</div>
          {activeCount > 0 && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{activeCount} line item{activeCount !== 1 ? 's' : ''}</div>}
        </div>
        <div className="total-bar-actions">
          {activeCount > 0 && <button className="btn btn-ghost" style={{ color: 'rgba(255,255,255,0.65)' }} onClick={handleClear}>Clear</button>}
          <button className="btn" style={{ background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.25)', color: '#fff' }} onClick={handlePdf}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
            </svg>
            PDF
          </button>
          <button className="btn btn-secondary" onClick={openSaveModal}>Save quote</button>
        </div>
      </div>

      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <h2 style={{ marginBottom: 4 }}>Save quote</h2>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: missingVariants.length > 0 ? 10 : 20 }}>
              {activeCount} item{activeCount !== 1 ? 's' : ''} · £{grandTotal.toFixed(2)} total
            </p>
            {missingVariants.length > 0 && (
              <div style={{ padding: '8px 12px', background: 'var(--warning-bg)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--warning)', marginBottom: 16 }}>
                Note: {missingVariants.length} item{missingVariants.length !== 1 ? 's' : ''} still need a variant selected.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <input className="input" placeholder="Project name *" value={saveForm.project_name} onChange={(e) => setSaveForm({ ...saveForm, project_name: e.target.value })} autoFocus />
              <input className="input" placeholder="Customer name" value={saveForm.customer_name} onChange={(e) => setSaveForm({ ...saveForm, customer_name: e.target.value })} />
              <input className="input" placeholder="MO number" value={saveForm.mo_number} onChange={(e) => setSaveForm({ ...saveForm, mo_number: e.target.value })} style={{ fontFamily: 'var(--mono)' }} />
              <input className="input" placeholder="Notes (optional)" value={saveForm.notes} onChange={(e) => setSaveForm({ ...saveForm, notes: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save quote'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
