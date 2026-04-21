import { useState, useMemo } from 'react'
import type { Product, QuantityMap, QuoteFormData } from '../types'
import { CATEGORIES } from '../types'
import SearchBar from './SearchBar'

interface Props {
  products: Product[]
  loading: boolean
  quantities: QuantityMap
  setQty: (id: string, qty: number) => void
  grandTotal: number
  quoteForm: QuoteFormData
  setQuoteForm: (f: QuoteFormData) => void
  onSave: (f: QuoteFormData) => Promise<boolean>
  showToast: (msg: string, type?: 'success' | 'error') => void
}

const fmt = (n: number | null) => (n != null ? `£${n.toFixed(2)}` : null)

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="stepper">
      <button
        className="stepper-btn"
        onPointerDown={(e) => { e.preventDefault(); onChange(Math.max(0, value - 1)) }}
        aria-label="Decrease"
      >−</button>
      <input
        className="stepper-input"
        type="number"
        min="0"
        max="999"
        value={value || ''}
        placeholder="0"
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
      />
      <button
        className="stepper-btn"
        onPointerDown={(e) => { e.preventDefault(); onChange(value + 1) }}
        aria-label="Increase"
      >+</button>
    </div>
  )
}

export default function QuoteBuilder({
  products, loading, quantities, setQty, grandTotal,
  quoteForm, setQuoteForm, onSave, showToast,
}: Props) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveForm, setSaveForm] = useState<QuoteFormData>({ project_name: '', customer_name: '', notes: '' })

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return products
    const q = search.toLowerCase()
    return products.filter(
      (p) =>
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

  const handleClear = () => {
    if (activeCount === 0) return
    if (confirm('Clear all quantities?')) {
      products.forEach((p) => setQty(p.id, 0))
    }
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
    if (ok) { setShowSaveModal(false); setSaveForm({ project_name: '', customer_name: '', notes: '' }) }
  }

  if (loading) {
    return <div className="loading"><div className="spinner" /> Loading catalogue…</div>
  }

  return (
    <>
      {/* Toolbar */}
      <div className="toolbar">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search parts, part numbers, categories…"
        />
      </div>

      {/* Quote info */}
      <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 10 }}>
          Quote details
        </div>
        <div className="quote-info-grid">
          <input
            className="input"
            placeholder="Project name *"
            value={quoteForm.project_name}
            onChange={(e) => setQuoteForm({ ...quoteForm, project_name: e.target.value })}
          />
          <input
            className="input"
            placeholder="Customer name"
            value={quoteForm.customer_name}
            onChange={(e) => setQuoteForm({ ...quoteForm, customer_name: e.target.value })}
          />
        </div>
        <input
          className="input"
          placeholder="Notes (optional)"
          value={quoteForm.notes}
          onChange={(e) => setQuoteForm({ ...quoteForm, notes: e.target.value })}
          style={{ marginTop: 10 }}
        />
      </div>

      {/* No results */}
      {searchActive && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <h3>No parts found</h3>
          <p>Try a different search term or part number</p>
        </div>
      )}

      {/* ── Desktop: table ── */}
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
                {catQty > 0 && (
                  <span style={{ background: 'var(--brand)', color: '#fff', borderRadius: '99px', padding: '1px 8px', fontSize: 10, fontWeight: 700 }}>
                    {catQty} selected
                  </span>
                )}
                {items.length} items
                {!searchActive && (
                  <svg className={`category-chevron ${isOpen ? 'open' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                )}
              </span>
            </div>

            {isOpen && (
              <>
                {/* Desktop table */}
                <div className="card" style={{ marginBottom: 4 }}>
                  <table className="product-table">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th style={{ width: 110 }}>Part no.</th>
                        <th className="right" style={{ width: 90 }}>Unit cost</th>
                        <th className="right" style={{ width: 130 }}>Quantity</th>
                        <th className="right" style={{ width: 90 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((p) => {
                        const qty = quantities[p.id] ?? 0
                        const lineTotal = p.factory_cost != null && qty > 0 ? p.factory_cost * qty : null
                        return (
                          <tr key={p.id}>
                            <td>
                              <div style={{ fontWeight: qty > 0 ? 500 : 400 }}>{p.description}</div>
                              {p.notes && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{p.notes}</div>}
                            </td>
                            <td>
                              {p.part_number ? <span className="part-number">{p.part_number}</span> : <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>}
                            </td>
                            <td className="right">
                              {p.factory_cost != null ? (
                                <span style={{ fontWeight: 500 }}>{fmt(p.factory_cost)}</span>
                              ) : (
                                <span className="cost-tbc">TBC</span>
                              )}
                            </td>
                            <td className="right">
                              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <Stepper value={qty} onChange={(n) => setQty(p.id, n)} />
                              </div>
                            </td>
                            <td className="right" style={{ fontWeight: qty > 0 ? 600 : 400 }}>
                              {lineTotal != null ? fmt(lineTotal) : qty > 0 ? <span className="cost-tbc">TBC</span> : <span style={{ color: 'var(--text-3)' }}>—</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="product-cards">
                  {items.map((p) => {
                    const qty = quantities[p.id] ?? 0
                    const lineTotal = p.factory_cost != null && qty > 0 ? p.factory_cost * qty : null
                    return (
                      <div key={p.id} className="product-card" style={qty > 0 ? { borderColor: 'var(--brand)', borderWidth: '1.5px' } : {}}>
                        <div className="product-card-header">
                          <div>
                            <div className="product-card-desc">{p.description}</div>
                            {p.part_number && (
                              <span className="part-number" style={{ marginTop: 4, display: 'inline-block' }}>{p.part_number}</span>
                            )}
                          </div>
                          <div style={{ flexShrink: 0 }}>
                            <Stepper value={qty} onChange={(n) => setQty(p.id, n)} />
                          </div>
                        </div>
                        <div className="product-card-meta">
                          <span className="product-card-cost">
                            {p.factory_cost != null ? fmt(p.factory_cost) : <span className="cost-tbc">TBC</span>}
                            <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400, marginLeft: 4 }}>each</span>
                          </span>
                          {qty > 0 && (
                            <span className="product-card-total">
                              Total: {lineTotal != null ? <strong>{fmt(lineTotal)}</strong> : <span className="cost-tbc">TBC</span>}
                            </span>
                          )}
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

      {/* Grand total bar */}
      <div className="total-bar">
        <div>
          <div className="total-bar-label">Grand total</div>
          <div className="total-bar-amount">{`£${grandTotal.toFixed(2)}`}</div>
          {activeCount > 0 && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
              {activeCount} line item{activeCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>
        <div className="total-bar-actions">
          {activeCount > 0 && (
            <button className="btn btn-ghost" style={{ color: 'rgba(255,255,255,0.55)' }} onClick={handleClear}>
              Clear
            </button>
          )}
          <button className="btn btn-primary" onClick={openSaveModal}>
            Save quote
          </button>
        </div>
      </div>

      {/* Save modal */}
      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <h2 style={{ marginBottom: 4 }}>Save quote</h2>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20 }}>
              {activeCount} item{activeCount !== 1 ? 's' : ''} · £{grandTotal.toFixed(2)} total
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <input
                className="input"
                placeholder="Project name *"
                value={saveForm.project_name}
                onChange={(e) => setSaveForm({ ...saveForm, project_name: e.target.value })}
                autoFocus
              />
              <input
                className="input"
                placeholder="Customer name"
                value={saveForm.customer_name}
                onChange={(e) => setSaveForm({ ...saveForm, customer_name: e.target.value })}
              />
              <input
                className="input"
                placeholder="Notes (optional)"
                value={saveForm.notes}
                onChange={(e) => setSaveForm({ ...saveForm, notes: e.target.value })}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save quote'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
