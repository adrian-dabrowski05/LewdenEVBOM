import { useState, useMemo, Fragment } from 'react'
import type { Product, ProductVariant, ProductPrerequisite, Preset, PresetItem, Category, AppSettings } from '../types'
import { CATEGORIES } from '../types'
import { supabase } from '../lib/supabase'
import SearchBar from './SearchBar'

interface Props {
  products: Product[]
  presets: Preset[]
  settings: AppSettings
  variants: ProductVariant[]
  prerequisites: ProductPrerequisite[]
  onRefreshProducts: () => void
  onRefreshPresets: () => void
  onRefreshSettings: () => void
  onRefreshVariants: () => void
  onRefreshPrerequisites: () => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

type AdminTab = 'products' | 'presets' | 'settings'
type ProductPanel = 'variants' | 'prerequisites' | null

interface EditBuffer { description: string; category: Category; part_number: string; factory_cost: string; notes: string }
const emptyBuffer = (): EditBuffer => ({ description: '', category: 'Outgoing', part_number: '', factory_cost: '', notes: '' })

// ── EditRow defined OUTSIDE all components so React never remounts it ──
interface EditRowProps {
  buf: EditBuffer
  onBuf: (b: EditBuffer) => void
}
function EditRow({ buf, onBuf }: EditRowProps) {
  return (
    <tr className="editing-row">
      <td></td>
      <td style={{ minWidth: 200 }}>
        <input className="input input-sm" value={buf.description} onChange={(e) => onBuf({ ...buf, description: e.target.value })} placeholder="Description *" />
      </td>
      <td>
        <select className="input input-sm" value={buf.category} onChange={(e) => onBuf({ ...buf, category: e.target.value as Category })}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td>
        <input className="input input-sm" style={{ fontFamily: 'var(--mono)', fontSize: 12 }} value={buf.part_number} onChange={(e) => onBuf({ ...buf, part_number: e.target.value })} placeholder="LCR1234" />
      </td>
      <td>
        <input className="input input-sm" type="number" step="0.01" min="0" style={{ textAlign: 'right' }} value={buf.factory_cost} onChange={(e) => onBuf({ ...buf, factory_cost: e.target.value })} placeholder="0.00" />
      </td>
      <td>
        <input className="input input-sm" value={buf.notes} onChange={(e) => onBuf({ ...buf, notes: e.target.value })} placeholder="Optional note" />
      </td>
    </tr>
  )
}

// ── Variant manager ───────────────────────────────────────────
function VariantManager({ product, variants, onRefresh, showToast }: {
  product: Product; variants: ProductVariant[]; onRefresh: () => void; showToast: Props['showToast']
}) {
  const [newLabel, setNewLabel] = useState('')
  const [newSuffix, setNewSuffix] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editSuffix, setEditSuffix] = useState('')

  const productVariants = variants.filter((v) => v.product_id === product.id).sort((a, b) => a.sort_order - b.sort_order)

  const addVariant = async () => {
    if (!newLabel.trim()) return
    setSaving(true)
    const maxOrder = Math.max(0, ...productVariants.map((v) => v.sort_order))
    const { error } = await supabase.from('product_variants').insert({ product_id: product.id, label: newLabel.trim(), part_number_suffix: newSuffix.trim() || null, sort_order: maxOrder + 10 })
    setSaving(false)
    if (error) { showToast('Failed to add variant', 'error'); return }
    setNewLabel(''); setNewSuffix(''); onRefresh()
  }

  const removeVariant = async (id: string) => {
    const { error } = await supabase.from('product_variants').delete().eq('id', id)
    if (error) { showToast('Failed to remove variant', 'error'); return }
    onRefresh()
  }

  const startEditVariant = (v: ProductVariant) => { setEditingVariantId(v.id); setEditLabel(v.label); setEditSuffix(v.part_number_suffix ?? '') }

  const saveVariantEdit = async (id: string) => {
    if (!editLabel.trim()) return
    const { error } = await supabase.from('product_variants').update({ label: editLabel.trim(), part_number_suffix: editSuffix.trim() || null }).eq('id', id)
    if (error) { showToast('Failed to update variant', 'error'); return }
    setEditingVariantId(null); onRefresh()
  }

  const combinedPN = (v: ProductVariant) => {
    if (!v.part_number_suffix) return null
    return product.part_number ? `${product.part_number}${v.part_number_suffix}` : v.part_number_suffix
  }

  return (
    <div style={{ padding: '12px 14px', background: 'var(--brand-light)', borderRadius: 'var(--radius-md)', marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--brand)', marginBottom: 8 }}>
        Variant options
        {productVariants.length > 0 && <span style={{ background: 'var(--brand)', color: '#fff', borderRadius: 99, padding: '1px 6px', fontSize: 10, marginLeft: 6 }}>{productVariants.length}</span>}
      </div>
      {product.part_number ? (
        <div style={{ fontSize: 11, color: 'var(--brand)', opacity: 0.75, marginBottom: 10 }}>Base part number: <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{product.part_number}</span> — suffix will be appended</div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--warning)', marginBottom: 10 }}>No base part number — suffix will be used as the full variant part number.</div>
      )}

      {productVariants.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {productVariants.map((v) => {
            const combined = combinedPN(v)
            const isEditing = editingVariantId === v.id
            return (
              <div key={v.id} style={{ background: 'var(--surface)', border: '1px solid var(--brand)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                {isEditing ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ flex: 2, minWidth: 120 }}>
                      <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 3 }}>Label</label>
                      <input className="input input-sm" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveVariantEdit(v.id) }} autoFocus />
                    </div>
                    <div style={{ flex: 1, minWidth: 100 }}>
                      <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 3 }}>Part no. suffix</label>
                      <input className="input input-sm" style={{ fontFamily: 'var(--mono)' }} placeholder="e.g. -MG" value={editSuffix} onChange={(e) => setEditSuffix(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveVariantEdit(v.id) }} />
                    </div>
                    {editSuffix && (
                      <div style={{ paddingBottom: 2 }}>
                        <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 3 }}>Result</label>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: 'var(--brand)' }}>{product.part_number ? `${product.part_number}${editSuffix}` : editSuffix}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm" onClick={() => setEditingVariantId(null)}>Cancel</button>
                      <button className="btn btn-sm btn-primary" onClick={() => saveVariantEdit(v.id)}>Save</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand)' }}>{v.label}</div>
                      {combined ? (
                        <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-2)', background: 'var(--surface-3)', padding: '1px 6px', borderRadius: 4 }}>{combined}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>({product.part_number} + {v.part_number_suffix})</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>No part number suffix</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button className="btn btn-sm" onClick={() => startEditVariant(v)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => removeVariant(v.id)}>Remove</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ borderTop: productVariants.length > 0 ? '1px solid rgba(0,74,154,0.15)' : 'none', paddingTop: productVariants.length > 0 ? 12 : 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--brand)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Add variant</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 2, minWidth: 130 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 3 }}>Label *</label>
            <input className="input input-sm" placeholder="e.g. Moss Green" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addVariant() } }} />
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 3 }}>Part no. suffix</label>
            <input className="input input-sm" style={{ fontFamily: 'var(--mono)' }} placeholder="e.g. -MG" value={newSuffix} onChange={(e) => setNewSuffix(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addVariant() } }} />
          </div>
          {newSuffix && (
            <div style={{ paddingBottom: 2 }}>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 3 }}>Result</label>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: 'var(--brand)' }}>{product.part_number ? `${product.part_number}${newSuffix}` : newSuffix}</span>
            </div>
          )}
          <button className="btn btn-sm btn-primary" onClick={addVariant} disabled={saving || !newLabel.trim()}>Add</button>
        </div>
      </div>
      {productVariants.length === 0 && <p style={{ fontSize: 11, color: 'var(--brand)', opacity: 0.7, marginTop: 10 }}>No variants yet. Add options reps will choose from (e.g. colour finishes).</p>}
    </div>
  )
}

// ── Prerequisite manager ──────────────────────────────────────
function PrerequisiteManager({ product, products, prerequisites, onRefresh, showToast }: {
  product: Product; products: Product[]; prerequisites: ProductPrerequisite[]; onRefresh: () => void; showToast: Props['showToast']
}) {
  const [newProductId, setNewProductId] = useState('')
  const [newQty, setNewQty] = useState('1')
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)

  const productPrereqs = prerequisites.filter((p) => p.product_id === product.id)
  const usedIds = new Set(productPrereqs.map((p) => p.prerequisite_product_id))
  const available = products.filter((p) => p.id !== product.id && !usedIds.has(p.id))

  const addPrereq = async () => {
    if (!newProductId) { showToast('Select a product', 'error'); return }
    setSaving(true)
    const maxOrder = Math.max(0, ...productPrereqs.map((p) => p.sort_order))
    const { error } = await supabase.from('product_prerequisites').insert({ product_id: product.id, prerequisite_product_id: newProductId, quantity: parseInt(newQty) || 1, note: newNote.trim() || null, sort_order: maxOrder + 10 })
    setSaving(false)
    if (error) { showToast('Failed to add prerequisite', 'error'); return }
    showToast('Prerequisite added'); setNewProductId(''); setNewQty('1'); setNewNote(''); onRefresh()
  }

  const removePrereq = async (id: string) => {
    const { error } = await supabase.from('product_prerequisites').delete().eq('id', id)
    if (error) { showToast('Failed to remove prerequisite', 'error'); return }
    onRefresh()
  }

  const updatePrereq = async (id: string, field: 'quantity' | 'note', value: string | number) => {
    const update = field === 'quantity' ? { quantity: Number(value) } : { note: String(value).trim() || null }
    const { error } = await supabase.from('product_prerequisites').update(update).eq('id', id)
    if (error) { showToast('Failed to update', 'error'); return }
    onRefresh()
  }

  return (
    <div style={{ padding: '12px 14px', background: 'var(--success-bg)', border: '1px solid var(--success)', borderRadius: 'var(--radius-md)', marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--success)', marginBottom: 8 }}>
        Prerequisites
        {productPrereqs.length > 0 && <span style={{ background: 'var(--success)', color: '#fff', borderRadius: 99, padding: '1px 6px', fontSize: 10, marginLeft: 6 }}>{productPrereqs.length}</span>}
      </div>
      <p style={{ fontSize: 11, color: 'var(--success)', marginBottom: 10, opacity: 0.8 }}>When a rep adds this product, these items are automatically added to the BOM.</p>

      {productPrereqs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {productPrereqs.map((pr) => {
            const prereqProduct = products.find((p) => p.id === pr.prerequisite_product_id)
            return (
              <div key={pr.id} style={{ background: 'var(--surface)', border: '1px solid var(--success)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{prereqProduct?.description ?? 'Unknown'}</div>
                  {prereqProduct?.part_number && <span className="part-number" style={{ marginTop: 2, display: 'inline-block' }}>{prereqProduct.part_number}</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Qty</label>
                    <input type="number" min="1" style={{ width: 56, padding: '3px 6px', fontSize: 12, border: '1.5px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 600 }} value={pr.quantity} onChange={(e) => updatePrereq(pr.id, 'quantity', parseInt(e.target.value) || 1)} />
                  </div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <label style={{ display: 'block', fontSize: 10, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Custom note (optional)</label>
                    <input className="input input-sm" placeholder="e.g. Insulators 35mm M6 ×4" defaultValue={pr.note ?? ''} onBlur={(e) => updatePrereq(pr.id, 'note', e.target.value)} style={{ minWidth: 120 }} />
                  </div>
                  <button className="btn btn-sm btn-danger" style={{ marginTop: 16 }} onClick={() => removePrereq(pr.id)}>Remove</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: 2, minWidth: 180 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Add prerequisite product</label>
          <select className="input input-sm" value={newProductId} onChange={(e) => setNewProductId(e.target.value)}>
            <option value="">Select product…</option>
            {CATEGORIES.map((cat) => { const cp = available.filter((p) => p.category === cat); if (!cp.length) return null; return <optgroup key={cat} label={cat}>{cp.map((p) => <option key={p.id} value={p.id}>{p.description}{p.part_number ? ` (${p.part_number})` : ''}</option>)}</optgroup> })}
          </select>
        </div>
        <div style={{ width: 64 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Qty</label>
          <input className="input input-sm" type="number" min="1" value={newQty} onChange={(e) => setNewQty(e.target.value)} style={{ fontFamily: 'var(--mono)', textAlign: 'center' }} />
        </div>
        <div style={{ flex: 2, minWidth: 140 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Custom note (optional)</label>
          <input className="input input-sm" placeholder="e.g. Insulators 35mm M6 ×4" value={newNote} onChange={(e) => setNewNote(e.target.value)} />
        </div>
        <button className="btn btn-sm" style={{ background: 'var(--success)', borderColor: 'var(--success)', color: '#fff' }} onClick={addPrereq} disabled={saving || !newProductId}>Add</button>
      </div>
    </div>
  )
}

// ── Products tab ─────────────────────────────────────────────
function ProductsTab({ products, variants, prerequisites, onRefreshProducts, onRefreshVariants, onRefreshPrerequisites, showToast }: {
  products: Product[]; variants: ProductVariant[]; prerequisites: ProductPrerequisite[]
  onRefreshProducts: () => void; onRefreshVariants: () => void; onRefreshPrerequisites: () => void
  showToast: Props['showToast']
}) {
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBuf, setEditBuf] = useState<EditBuffer>(emptyBuffer())
  const [openPanel, setOpenPanel] = useState<{ id: string; panel: ProductPanel } | null>(null)
  const [saving, setSaving] = useState(false)
  const [addingNew, setAddingNew] = useState(false)
  const [newBuf, setNewBuf] = useState<EditBuffer>(emptyBuffer())
  const [reviewed, setReviewed] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    if (!search.trim()) return products
    const q = search.toLowerCase()
    return products.filter((p) => p.description.toLowerCase().includes(q) || (p.part_number ?? '').toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
  }, [products, search])

  const variantCountByProduct = useMemo(() => {
    const map: Record<string, number> = {}
    variants.forEach((v) => { map[v.product_id] = (map[v.product_id] ?? 0) + 1 })
    return map
  }, [variants])

  const prereqCountByProduct = useMemo(() => {
    const map: Record<string, number> = {}
    prerequisites.forEach((p) => { map[p.product_id] = (map[p.product_id] ?? 0) + 1 })
    return map
  }, [prerequisites])

  const allFilteredReviewed = filtered.length > 0 && filtered.every((p) => reviewed.has(p.id))
  const reviewedCount = filtered.filter((p) => reviewed.has(p.id)).length

  const toggleReviewed = (id: string) => {
    setReviewed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => setReviewed((prev) => new Set([...prev, ...filtered.map((p) => p.id)]))
  const deselectAll = () => setReviewed((prev) => { const next = new Set(prev); filtered.forEach((p) => next.delete(p.id)); return next })

  const startEdit = (p: Product) => {
    setEditingId(p.id)
    setEditBuf({ description: p.description, category: p.category, part_number: p.part_number ?? '', factory_cost: p.factory_cost != null ? String(p.factory_cost) : '', notes: p.notes ?? '' })
  }

  const saveEdit = async () => {
    if (!editingId || !editBuf.description.trim()) { showToast('Description is required', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('products').update({ description: editBuf.description.trim(), category: editBuf.category, part_number: editBuf.part_number.trim() || null, factory_cost: editBuf.factory_cost ? parseFloat(editBuf.factory_cost) : null, notes: editBuf.notes.trim() || null }).eq('id', editingId)
    setSaving(false)
    if (error) { showToast('Failed to save changes', 'error'); return }
    showToast('Product updated'); setEditingId(null); onRefreshProducts()
  }

  const deleteProduct = async (id: string) => {
    if (!confirm('Remove this product from the catalogue?')) return
    const { error } = await supabase.from('products').update({ is_active: false }).eq('id', id)
    if (error) { showToast('Failed to remove product', 'error'); return }
    showToast('Product removed'); onRefreshProducts()
  }

  const saveNew = async () => {
    if (!newBuf.description.trim()) { showToast('Description is required', 'error'); return }
    setSaving(true)
    const maxOrder = Math.max(0, ...products.filter((p) => p.category === newBuf.category).map((p) => p.sort_order))
    const { error } = await supabase.from('products').insert({ description: newBuf.description.trim(), category: newBuf.category, part_number: newBuf.part_number.trim() || null, factory_cost: newBuf.factory_cost ? parseFloat(newBuf.factory_cost) : null, notes: newBuf.notes.trim() || null, sort_order: maxOrder + 10, is_active: true })
    setSaving(false)
    if (error) { showToast('Failed to add product', 'error'); return }
    showToast('Product added'); setAddingNew(false); setNewBuf(emptyBuffer()); onRefreshProducts()
  }

  const togglePanel = (productId: string, panel: ProductPanel) => {
    setOpenPanel((prev) => prev?.id === productId && prev?.panel === panel ? null : { id: productId, panel })
  }

  return (
    <>
      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search catalogue…" />
        <div className="toolbar-right">
          <button className="btn btn-primary" onClick={() => { setAddingNew(true); setNewBuf(emptyBuffer()) }}>+ Add product</button>
        </div>
      </div>

      {/* Checklist toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
          {filtered.length} product{filtered.length !== 1 ? 's' : ''}
          {search && ` matching "${search}"`}
          {reviewedCount > 0 && (
            <span style={{ marginLeft: 8, background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid var(--success)', borderRadius: 99, padding: '1px 8px', fontSize: 11, fontWeight: 600 }}>
              {reviewedCount} reviewed
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn btn-sm"
            style={{ fontSize: 12, color: 'var(--success)', borderColor: 'var(--success)' }}
            onClick={allFilteredReviewed ? deselectAll : selectAll}
          >
            {allFilteredReviewed ? 'Deselect all' : 'Select all'}
          </button>
          {reviewedCount > 0 && !allFilteredReviewed && (
            <button className="btn btn-sm" onClick={deselectAll} style={{ fontSize: 12 }}>
              Clear reviewed
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ overflow: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}></th>
              <th>Description</th>
              <th style={{ width: 140 }}>Category</th>
              <th style={{ width: 110 }}>Part no.</th>
              <th style={{ width: 100, textAlign: 'right' }}>Factory cost</th>
              <th style={{ width: 160 }}>Notes</th>
              <th style={{ width: 200, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {addingNew && (
              <>
                <EditRow buf={newBuf} onBuf={setNewBuf} />
                <tr style={{ background: 'var(--brand-light)' }}>
                  <td colSpan={7} style={{ paddingTop: 6, paddingBottom: 6 }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm" onClick={() => setAddingNew(false)}>Cancel</button>
                      <button className="btn btn-sm btn-primary" onClick={saveNew} disabled={saving}>{saving ? 'Saving…' : 'Add product'}</button>
                    </div>
                  </td>
                </tr>
              </>
            )}

            {filtered.map((p) => {
              const variantCount = variantCountByProduct[p.id] ?? 0
              const prereqCount = prereqCountByProduct[p.id] ?? 0
              const isEditingThis = editingId === p.id
              const currentPanel = openPanel?.id === p.id ? openPanel.panel : null
              const isReviewed = reviewed.has(p.id)

              return (
                <Fragment key={p.id}>
                  {isEditingThis ? (
                    <>
                      <EditRow buf={editBuf} onBuf={setEditBuf} />
                      <tr style={{ background: 'var(--brand-light)' }}>
                        <td colSpan={7} style={{ paddingTop: 6, paddingBottom: 6 }}>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                            <button className="btn btn-sm btn-primary" onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
                          </div>
                        </td>
                      </tr>
                    </>
                  ) : (
                    <tr style={isReviewed ? { opacity: 0.38, background: 'var(--surface-3)' } : {}}>
                      {/* Checkbox */}
                      <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                        <input
                          type="checkbox"
                          checked={isReviewed}
                          onChange={() => toggleReviewed(p.id)}
                          title="Mark as reviewed"
                          style={{ width: 15, height: 15, accentColor: 'var(--success)', cursor: 'pointer' }}
                        />
                      </td>
                      <td style={isReviewed ? { textDecoration: 'line-through', color: 'var(--text-3)' } : {}}>{p.description}</td>
                      <td><span style={{ fontSize: 12, color: 'var(--text-2)', background: 'var(--surface-3)', padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>{p.category}</span></td>
                      <td>{p.part_number ? <span className="part-number">{p.part_number}</span> : <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>}</td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>{p.factory_cost != null ? `£${p.factory_cost.toFixed(2)}` : <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>—</span>}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{p.notes || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button className="btn btn-sm" style={prereqCount > 0 ? { borderColor: 'var(--success)', color: 'var(--success)' } : {}} onClick={() => togglePanel(p.id, 'prerequisites')}>
                            Prereqs{prereqCount > 0 ? ` (${prereqCount})` : ''}
                          </button>
                          <button className="btn btn-sm" style={variantCount > 0 ? { borderColor: 'var(--brand)', color: 'var(--brand)' } : {}} onClick={() => togglePanel(p.id, 'variants')}>
                            Variants{variantCount > 0 ? ` (${variantCount})` : ''}
                          </button>
                          <button className="btn btn-sm" onClick={() => startEdit(p)}>Edit</button>
                          <button className="btn btn-sm btn-danger" onClick={() => deleteProduct(p.id)}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {currentPanel === 'variants' && !isEditingThis && (
                    <tr style={{ background: 'var(--surface-2)' }}>
                      <td colSpan={7} style={{ padding: '4px 12px 12px' }}>
                        <VariantManager product={p} variants={variants} onRefresh={onRefreshVariants} showToast={showToast} />
                      </td>
                    </tr>
                  )}

                  {currentPanel === 'prerequisites' && !isEditingThis && (
                    <tr style={{ background: 'var(--surface-2)' }}>
                      <td colSpan={7} style={{ padding: '4px 12px 12px' }}>
                        <PrerequisiteManager product={p} products={products} prerequisites={prerequisites} onRefresh={onRefreshPrerequisites} showToast={showToast} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Presets tab ───────────────────────────────────────────────
function PresetsTab({ products, presets, onRefresh, showToast }: { products: Product[]; presets: Preset[]; onRefresh: () => void; showToast: Props['showToast'] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newLabourMins, setNewLabourMins] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editLabourMins, setEditLabourMins] = useState('')
  const [addItemProductId, setAddItemProductId] = useState('')
  const [addItemQty, setAddItemQty] = useState('1')

  const createPreset = async () => {
    if (!newName.trim()) { showToast('Preset name is required', 'error'); return }
    setSaving(true)
    const { data, error } = await supabase.from('presets').insert({ name: newName.trim(), description: newDesc.trim() || null, default_labour_minutes: newLabourMins ? parseFloat(newLabourMins) : null, default_labour_rate_per_min: null }).select().single()
    setSaving(false)
    if (error || !data) { showToast('Failed to create preset', 'error'); return }
    showToast('Preset created'); setCreatingNew(false); setNewName(''); setNewDesc(''); setNewLabourMins(''); setExpanded(data.id); onRefresh()
  }

  const deletePreset = async (id: string) => {
    if (!confirm('Delete this preset?')) return
    const { error } = await supabase.from('presets').delete().eq('id', id)
    if (error) { showToast('Failed to delete preset', 'error'); return }
    showToast('Preset deleted'); if (expanded === id) setExpanded(null); onRefresh()
  }

  const startEditPreset = (preset: Preset) => { setEditingPresetId(preset.id); setEditName(preset.name); setEditDesc(preset.description ?? ''); setEditLabourMins(preset.default_labour_minutes != null ? String(preset.default_labour_minutes) : '') }

  const savePresetMeta = async (id: string) => {
    if (!editName.trim()) { showToast('Name is required', 'error'); return }
    const { error } = await supabase.from('presets').update({ name: editName.trim(), description: editDesc.trim() || null, default_labour_minutes: editLabourMins ? parseFloat(editLabourMins) : null }).eq('id', id)
    if (error) { showToast('Failed to update preset', 'error'); return }
    showToast('Preset updated'); setEditingPresetId(null); onRefresh()
  }

  const addItem = async (presetId: string) => {
    if (!addItemProductId) { showToast('Select a product', 'error'); return }
    const qty = parseInt(addItemQty) || 1
    const { error } = await supabase.from('preset_items').upsert({ preset_id: presetId, product_id: addItemProductId, quantity: qty }, { onConflict: 'preset_id,product_id' })
    if (error) { showToast('Failed to add item', 'error'); return }
    showToast('Item added'); setAddItemProductId(''); setAddItemQty('1'); onRefresh()
  }

  const removeItem = async (itemId: string) => { await supabase.from('preset_items').delete().eq('id', itemId); onRefresh() }
  const updateItemQty = async (itemId: string, qty: number) => {
    if (qty <= 0) { await supabase.from('preset_items').delete().eq('id', itemId); onRefresh(); return }
    await supabase.from('preset_items').update({ quantity: qty }).eq('id', itemId); onRefresh()
  }

  const usedProductIds = (presetId: string) => new Set((presets.find((p) => p.id === presetId)?.preset_items ?? []).map((i) => i.product_id))

  return (
    <>
      <div className="toolbar">
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{presets.length} preset{presets.length !== 1 ? 's' : ''}</div>
        <div className="toolbar-right"><button className="btn btn-primary" onClick={() => setCreatingNew(true)}>+ New preset</button></div>
      </div>

      {creatingNew && (
        <div className="card" style={{ padding: '16px 18px', marginBottom: 12, borderColor: 'var(--brand)', borderWidth: 1.5 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>New preset</div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Preset name *" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1, minWidth: 160 }} autoFocus />
            <input className="input" placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} style={{ flex: 2, minWidth: 160 }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Default labour duration (minutes) — optional</label>
            <input className="input" style={{ maxWidth: 220 }} type="number" min="0" placeholder="e.g. 120" value={newLabourMins} onChange={(e) => setNewLabourMins(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => { setCreatingNew(false); setNewName(''); setNewDesc(''); setNewLabourMins('') }}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={createPreset} disabled={saving}>{saving ? 'Creating…' : 'Create preset'}</button>
          </div>
        </div>
      )}

      {presets.length === 0 && !creatingNew && <div className="empty-state"><div className="empty-state-icon">⚡</div><h3>No presets yet</h3><p>Create a preset to let sales reps quickly populate the BOM</p></div>}

      {presets.map((preset) => {
        const isOpen = expanded === preset.id
        const isEditing = editingPresetId === preset.id
        const items = preset.preset_items ?? []
        const used = usedProductIds(preset.id)
        const availableProducts = products.filter((p) => !used.has(p.id))

        return (
          <div key={preset.id} className="preset-admin-card">
            <div className="preset-admin-header" onClick={() => setExpanded(isOpen ? null : preset.id)}>
              <div style={{ flex: 1 }}>
                {isEditing ? (
                  <div onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      <input className="input input-sm" value={editName} onChange={(e) => setEditName(e.target.value)} style={{ flex: 1, minWidth: 140 }} placeholder="Preset name *" />
                      <input className="input input-sm" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} style={{ flex: 2, minWidth: 140 }} placeholder="Description" />
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ display: 'block', fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Default labour minutes</label>
                      <input className="input input-sm" type="number" min="0" value={editLabourMins} onChange={(e) => setEditLabourMins(e.target.value)} placeholder="Optional" style={{ maxWidth: 160 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-sm" onClick={() => setEditingPresetId(null)}>Cancel</button>
                      <button className="btn btn-sm btn-primary" onClick={() => savePresetMeta(preset.id)}>Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="preset-admin-name">{preset.name}</div>
                      <span className="badge badge-preset">{items.length} items</span>
                    </div>
                    {preset.description && <div className="preset-admin-desc">{preset.description}</div>}
                    {preset.default_labour_minutes != null && <div style={{ fontSize: 12, color: 'var(--brand)', marginTop: 3 }}>Labour default: {preset.default_labour_minutes} minutes</div>}
                  </>
                )}
              </div>
              {!isEditing && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn-sm" onClick={() => { startEditPreset(preset); setExpanded(preset.id) }}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => deletePreset(preset.id)}>Delete</button>
                  <svg style={{ width: 16, height: 16, color: 'var(--text-3)', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none', flexShrink: 0 }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6l4 4 4-4" /></svg>
                </div>
              )}
            </div>

            {isOpen && (
              <div className="preset-admin-body">
                {items.map((item: PresetItem) => {
                  const product = products.find((p) => p.id === item.product_id)
                  return (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ flex: 1, fontSize: 13 }}>
                        <div style={{ fontWeight: 500 }}>{product?.description ?? 'Unknown product'}</div>
                        {product?.part_number && <span className="part-number" style={{ marginTop: 2, display: 'inline-block' }}>{product.part_number}</span>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <input type="number" min="1" style={{ width: 60, padding: '4px 8px', fontSize: 13, border: '1.5px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 500 }} value={item.quantity} onChange={(e) => updateItemQty(item.id, parseInt(e.target.value) || 0)} />
                        <button className="btn btn-sm btn-danger" onClick={() => removeItem(item.id)}>Remove</button>
                      </div>
                    </div>
                  )
                })}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
                  <div style={{ flex: 2, minWidth: 200 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Add product</label>
                    <select className="input input-sm" value={addItemProductId} onChange={(e) => setAddItemProductId(e.target.value)}>
                      <option value="">Select a product…</option>
                      {CATEGORIES.map((cat) => { const cp = availableProducts.filter((p) => p.category === cat); if (!cp.length) return null; return <optgroup key={cat} label={cat}>{cp.map((p) => <option key={p.id} value={p.id}>{p.description}{p.part_number ? ` (${p.part_number})` : ''}</option>)}</optgroup> })}
                    </select>
                  </div>
                  <div style={{ width: 80 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Qty</label>
                    <input className="input input-sm" type="number" min="1" value={addItemQty} onChange={(e) => setAddItemQty(e.target.value)} style={{ fontFamily: 'var(--mono)', textAlign: 'center' }} />
                  </div>
                  <button className="btn btn-sm btn-secondary" onClick={() => addItem(preset.id)}>Add item</button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

// ── Settings tab ──────────────────────────────────────────────
function SettingsTab({ settings, onRefresh, showToast }: { settings: AppSettings; onRefresh: () => void; showToast: Props['showToast'] }) {
  const [upliftPct, setUpliftPct] = useState(String(settings.hardware_uplift_pct))
  const [labourRate, setLabourRate] = useState(String(settings.labour_rate_per_min))
  const [saving, setSaving] = useState(false)

  const saveSetting = async (key: string, value: string, min: number, max: number | null, label: string) => {
    const val = parseFloat(value)
    if (isNaN(val) || val < min || (max !== null && val > max)) { showToast(`Enter a valid ${label}`, 'error'); return false }
    setSaving(true)
    const { error } = await supabase.from('settings').update({ value: String(val) }).eq('key', key)
    setSaving(false)
    if (error) { showToast('Failed to save setting', 'error'); return false }
    return true
  }

  const saveUplift = async () => { if (await saveSetting('hardware_uplift_pct', upliftPct, 0, 100, 'percentage between 0 and 100')) { showToast('Hardware uplift saved'); onRefresh() } }
  const saveLabour = async () => { if (await saveSetting('labour_rate_per_min', labourRate, 0, null, 'labour rate')) { showToast('Labour rate saved'); onRefresh() } }

  return (
    <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ padding: '20px 24px' }}>
        <h3 style={{ marginBottom: 4 }}>Hardware uplift</h3>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20 }}>A percentage added to the materials subtotal on every quote. Shown as a separate line item on quotes and PDFs.</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Uplift percentage (%)</label>
            <div style={{ position: 'relative' }}>
              <input className="input" type="number" min="0" max="100" step="0.1" value={upliftPct} onChange={(e) => setUpliftPct(e.target.value)} style={{ paddingRight: 36, fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 600 }} />
              <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--text-3)', pointerEvents: 'none' }}>%</span>
            </div>
          </div>
          <button className="btn btn-primary" onClick={saveUplift} disabled={saving} style={{ flexShrink: 0 }}>Save</button>
        </div>
        {upliftPct && !isNaN(parseFloat(upliftPct)) && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--secondary-light)', border: '1px solid var(--secondary-dark)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--secondary-text)' }}>
            Example: £1,000 materials → <strong>+£{(1000 * parseFloat(upliftPct) / 100).toFixed(2)}</strong> uplift → £{(1000 * (1 + parseFloat(upliftPct) / 100)).toFixed(2)} total
          </div>
        )}
      </div>
      <div className="card" style={{ padding: '20px 24px' }}>
        <h3 style={{ marginBottom: 4 }}>Labour rate</h3>
        <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20 }}>Cost per minute of labour. Sales reps enter the duration in minutes — this rate is applied automatically. Not visible to sales reps.</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rate (£ per minute)</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--text-3)', pointerEvents: 'none' }}>£</span>
              <input className="input" type="number" min="0" step="0.0001" value={labourRate} onChange={(e) => setLabourRate(e.target.value)} style={{ paddingLeft: 28, fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 600 }} />
            </div>
          </div>
          <button className="btn btn-primary" onClick={saveLabour} disabled={saving} style={{ flexShrink: 0 }}>Save</button>
        </div>
        {labourRate && !isNaN(parseFloat(labourRate)) && parseFloat(labourRate) > 0 && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--brand-light)', border: '1px solid var(--brand)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--brand)' }}>
            Example: 60 minutes → <strong>£{(60 * parseFloat(labourRate)).toFixed(2)}</strong> labour cost
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────
export default function AdminPanel({ products, presets, settings, variants, prerequisites, onRefreshProducts, onRefreshPresets, onRefreshSettings, onRefreshVariants, onRefreshPrerequisites, showToast }: Props) {
  const [tab, setTab] = useState<AdminTab>('products')

  return (
    <>
      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'products' ? 'active' : ''}`} onClick={() => setTab('products')}>Product catalogue</button>
        <button className={`admin-tab ${tab === 'presets' ? 'active' : ''}`} onClick={() => setTab('presets')}>
          Presets
          {presets.length > 0 && <span style={{ marginLeft: 6, background: 'var(--secondary)', color: 'var(--secondary-text)', borderRadius: 99, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{presets.length}</span>}
        </button>
        <button className={`admin-tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>Settings</button>
      </div>

      {tab === 'products' && <ProductsTab products={products} variants={variants} prerequisites={prerequisites} onRefreshProducts={onRefreshProducts} onRefreshVariants={onRefreshVariants} onRefreshPrerequisites={onRefreshPrerequisites} showToast={showToast} />}
      {tab === 'presets' && <PresetsTab products={products} presets={presets} onRefresh={onRefreshPresets} showToast={showToast} />}
      {tab === 'settings' && <SettingsTab settings={settings} onRefresh={onRefreshSettings} showToast={showToast} />}
    </>
  )
}
