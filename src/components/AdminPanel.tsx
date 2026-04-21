import { useState, useMemo } from 'react'
import type { Product, Preset, PresetItem, Category } from '../types'
import { CATEGORIES } from '../types'
import { supabase } from '../lib/supabase'
import SearchBar from './SearchBar'

interface Props {
  products: Product[]
  presets: Preset[]
  onRefreshProducts: () => void
  onRefreshPresets: () => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

type AdminTab = 'products' | 'presets'

interface EditBuffer {
  description: string
  category: Category
  part_number: string
  factory_cost: string
  notes: string
}

const emptyBuffer = (): EditBuffer => ({ description: '', category: 'Outgoing', part_number: '', factory_cost: '', notes: '' })

// ── Products tab ─────────────────────────────────────────────
function ProductsTab({ products, onRefresh, showToast }: { products: Product[]; onRefresh: () => void; showToast: Props['showToast'] }) {
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBuf, setEditBuf] = useState<EditBuffer>(emptyBuffer())
  const [saving, setSaving] = useState(false)
  const [addingNew, setAddingNew] = useState(false)
  const [newBuf, setNewBuf] = useState<EditBuffer>(emptyBuffer())

  const filtered = useMemo(() => {
    if (!search.trim()) return products
    const q = search.toLowerCase()
    return products.filter((p) => p.description.toLowerCase().includes(q) || (p.part_number ?? '').toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
  }, [products, search])

  const startEdit = (p: Product) => {
    setEditingId(p.id)
    setEditBuf({ description: p.description, category: p.category, part_number: p.part_number ?? '', factory_cost: p.factory_cost != null ? String(p.factory_cost) : '', notes: p.notes ?? '' })
  }

  const saveEdit = async () => {
    if (!editingId || !editBuf.description.trim()) { showToast('Description is required', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('products').update({
      description: editBuf.description.trim(),
      category: editBuf.category,
      part_number: editBuf.part_number.trim() || null,
      factory_cost: editBuf.factory_cost ? parseFloat(editBuf.factory_cost) : null,
      notes: editBuf.notes.trim() || null,
    }).eq('id', editingId)
    setSaving(false)
    if (error) { showToast('Failed to save changes', 'error'); return }
    showToast('Product updated')
    setEditingId(null)
    onRefresh()
  }

  const deleteProduct = async (id: string) => {
    if (!confirm('Remove this product from the catalogue?')) return
    const { error } = await supabase.from('products').update({ is_active: false }).eq('id', id)
    if (error) { showToast('Failed to remove product', 'error'); return }
    showToast('Product removed')
    onRefresh()
  }

  const saveNew = async () => {
    if (!newBuf.description.trim()) { showToast('Description is required', 'error'); return }
    setSaving(true)
    const maxOrder = Math.max(0, ...products.filter((p) => p.category === newBuf.category).map((p) => p.sort_order))
    const { error } = await supabase.from('products').insert({
      description: newBuf.description.trim(),
      category: newBuf.category,
      part_number: newBuf.part_number.trim() || null,
      factory_cost: newBuf.factory_cost ? parseFloat(newBuf.factory_cost) : null,
      notes: newBuf.notes.trim() || null,
      sort_order: maxOrder + 10,
      is_active: true,
    })
    setSaving(false)
    if (error) { showToast('Failed to add product', 'error'); return }
    showToast('Product added')
    setAddingNew(false)
    setNewBuf(emptyBuffer())
    onRefresh()
  }

  const EditRow = ({ buf, onBuf }: { buf: EditBuffer; onBuf: (b: EditBuffer) => void }) => (
    <tr className="editing-row">
      <td style={{ minWidth: 200 }}><input className="input input-sm" value={buf.description} onChange={(e) => onBuf({ ...buf, description: e.target.value })} placeholder="Description *" /></td>
      <td><select className="input input-sm" value={buf.category} onChange={(e) => onBuf({ ...buf, category: e.target.value as Category })}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
      <td><input className="input input-sm" style={{ fontFamily: 'var(--mono)', fontSize: 12 }} value={buf.part_number} onChange={(e) => onBuf({ ...buf, part_number: e.target.value })} placeholder="LCR1234" /></td>
      <td><input className="input input-sm" type="number" step="0.01" min="0" style={{ textAlign: 'right' }} value={buf.factory_cost} onChange={(e) => onBuf({ ...buf, factory_cost: e.target.value })} placeholder="0.00" /></td>
      <td><input className="input input-sm" value={buf.notes} onChange={(e) => onBuf({ ...buf, notes: e.target.value })} placeholder="Optional note" /></td>
    </tr>
  )

  return (
    <>
      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search catalogue…" />
        <div className="toolbar-right">
          <button className="btn btn-primary" onClick={() => { setAddingNew(true); setNewBuf(emptyBuffer()) }}>+ Add product</button>
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 12 }}>{filtered.length} product{filtered.length !== 1 ? 's' : ''}{search && ` matching "${search}"`}</div>

      <div className="card" style={{ overflow: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Description</th>
              <th style={{ width: 140 }}>Category</th>
              <th style={{ width: 110 }}>Part no.</th>
              <th style={{ width: 100, textAlign: 'right' }}>Factory cost</th>
              <th style={{ width: 160 }}>Notes</th>
              <th style={{ width: 130, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {addingNew && (
              <>
                <EditRow buf={newBuf} onBuf={setNewBuf} />
                <tr style={{ background: 'var(--brand-light)' }}>
                  <td colSpan={6} style={{ paddingTop: 6, paddingBottom: 6 }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm" onClick={() => setAddingNew(false)}>Cancel</button>
                      <button className="btn btn-sm btn-primary" onClick={saveNew} disabled={saving}>{saving ? 'Saving…' : 'Add product'}</button>
                    </div>
                  </td>
                </tr>
              </>
            )}
            {filtered.map((p) =>
              editingId === p.id ? (
                <>
                  <EditRow key={`edit-${p.id}`} buf={editBuf} onBuf={setEditBuf} />
                  <tr key={`edit-actions-${p.id}`} style={{ background: 'var(--brand-light)' }}>
                    <td colSpan={6} style={{ paddingTop: 6, paddingBottom: 6 }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                        <button className="btn btn-sm btn-primary" onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
                      </div>
                    </td>
                  </tr>
                </>
              ) : (
                <tr key={p.id}>
                  <td>{p.description}</td>
                  <td><span style={{ fontSize: 12, color: 'var(--text-2)', background: 'var(--surface-3)', padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>{p.category}</span></td>
                  <td>{p.part_number ? <span className="part-number">{p.part_number}</span> : <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{p.factory_cost != null ? `£${p.factory_cost.toFixed(2)}` : <span style={{ color: 'var(--text-3)', fontSize: 12, fontStyle: 'italic' }}>—</span>}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{p.notes || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm" onClick={() => startEdit(p)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => deleteProduct(p.id)}>Remove</button>
                    </div>
                  </td>
                </tr>
              ),
            )}
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
  const [saving, setSaving] = useState(false)

  // Editing state for a preset's items
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [addItemProductId, setAddItemProductId] = useState('')
  const [addItemQty, setAddItemQty] = useState('1')

  const createPreset = async () => {
    if (!newName.trim()) { showToast('Preset name is required', 'error'); return }
    setSaving(true)
    const { data, error } = await supabase.from('presets').insert({ name: newName.trim(), description: newDesc.trim() || null }).select().single()
    setSaving(false)
    if (error || !data) { showToast('Failed to create preset', 'error'); return }
    showToast('Preset created')
    setCreatingNew(false)
    setNewName('')
    setNewDesc('')
    setExpanded(data.id)
    onRefresh()
  }

  const deletePreset = async (id: string) => {
    if (!confirm('Delete this preset?')) return
    const { error } = await supabase.from('presets').delete().eq('id', id)
    if (error) { showToast('Failed to delete preset', 'error'); return }
    showToast('Preset deleted')
    if (expanded === id) setExpanded(null)
    onRefresh()
  }

  const startEditPreset = (preset: Preset) => {
    setEditingPresetId(preset.id)
    setEditName(preset.name)
    setEditDesc(preset.description ?? '')
  }

  const savePresetMeta = async (id: string) => {
    if (!editName.trim()) { showToast('Name is required', 'error'); return }
    const { error } = await supabase.from('presets').update({ name: editName.trim(), description: editDesc.trim() || null }).eq('id', id)
    if (error) { showToast('Failed to update preset', 'error'); return }
    showToast('Preset updated')
    setEditingPresetId(null)
    onRefresh()
  }

  const addItem = async (presetId: string) => {
    if (!addItemProductId) { showToast('Select a product', 'error'); return }
    const qty = parseInt(addItemQty) || 1
    const { error } = await supabase.from('preset_items').upsert({ preset_id: presetId, product_id: addItemProductId, quantity: qty }, { onConflict: 'preset_id,product_id' })
    if (error) { showToast('Failed to add item', 'error'); return }
    showToast('Item added to preset')
    setAddItemProductId('')
    setAddItemQty('1')
    onRefresh()
  }

  const removeItem = async (itemId: string) => {
    const { error } = await supabase.from('preset_items').delete().eq('id', itemId)
    if (error) { showToast('Failed to remove item', 'error'); return }
    onRefresh()
  }

  const updateItemQty = async (itemId: string, qty: number) => {
    if (qty <= 0) { await supabase.from('preset_items').delete().eq('id', itemId); onRefresh(); return }
    await supabase.from('preset_items').update({ quantity: qty }).eq('id', itemId)
    onRefresh()
  }

  // Products already in this preset
  const usedProductIds = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId)
    return new Set((preset?.preset_items ?? []).map((i) => i.product_id))
  }

  return (
    <>
      <div className="toolbar">
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{presets.length} preset{presets.length !== 1 ? 's' : ''}</div>
        <div className="toolbar-right">
          <button className="btn btn-primary" onClick={() => setCreatingNew(true)}>+ New preset</button>
        </div>
      </div>

      {/* New preset form */}
      {creatingNew && (
        <div className="card" style={{ padding: '16px 18px', marginBottom: 12, borderColor: 'var(--brand)', borderWidth: 1.5 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>New preset</div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Preset name *" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1, minWidth: 180 }} autoFocus />
            <input className="input" placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} style={{ flex: 2, minWidth: 180 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" onClick={() => { setCreatingNew(false); setNewName(''); setNewDesc('') }}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={createPreset} disabled={saving}>{saving ? 'Creating…' : 'Create preset'}</button>
          </div>
        </div>
      )}

      {presets.length === 0 && !creatingNew && (
        <div className="empty-state">
          <div className="empty-state-icon">⚡</div>
          <h3>No presets yet</h3>
          <p>Create a preset to let sales reps quickly populate the BOM with common configurations</p>
        </div>
      )}

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
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                    <input className="input input-sm" value={editName} onChange={(e) => setEditName(e.target.value)} style={{ flex: 1, minWidth: 140 }} placeholder="Preset name *" />
                    <input className="input input-sm" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} style={{ flex: 2, minWidth: 140 }} placeholder="Description" />
                    <button className="btn btn-sm" onClick={() => setEditingPresetId(null)}>Cancel</button>
                    <button className="btn btn-sm btn-primary" onClick={() => savePresetMeta(preset.id)}>Save</button>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="preset-admin-name">{preset.name}</div>
                      <span className="badge badge-preset">{items.length} items</span>
                    </div>
                    {preset.description && <div className="preset-admin-desc">{preset.description}</div>}
                  </>
                )}
              </div>
              {!isEditing && (
                <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn-sm" onClick={() => { startEditPreset(preset); setExpanded(preset.id) }}>Edit name</button>
                  <button className="btn btn-sm btn-danger" onClick={() => deletePreset(preset.id)}>Delete</button>
                  <svg style={{ width: 16, height: 16, color: 'var(--text-3)', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none', flexShrink: 0, alignSelf: 'center' }}
                    viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </div>
              )}
            </div>

            {isOpen && (
              <div className="preset-admin-body">
                {/* Existing items */}
                {items.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    {items.map((item: PresetItem) => {
                      const product = products.find((p) => p.id === item.product_id)
                      return (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ flex: 1, fontSize: 13 }}>
                            <div style={{ fontWeight: 500 }}>{product?.description ?? 'Unknown product'}</div>
                            {product?.part_number && <span className="part-number" style={{ marginTop: 2, display: 'inline-block' }}>{product.part_number}</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            <input
                              type="number" min="1" style={{ width: 60, padding: '4px 8px', fontSize: 13, border: '1.5px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 500 }}
                              value={item.quantity}
                              onChange={(e) => updateItemQty(item.id, parseInt(e.target.value) || 0)}
                            />
                            <button className="btn btn-sm btn-danger" onClick={() => removeItem(item.id)}>Remove</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Add item */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: 2, minWidth: 200 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 }}>Add product</label>
                    <select className="input input-sm" value={addItemProductId} onChange={(e) => setAddItemProductId(e.target.value)}>
                      <option value="">Select a product…</option>
                      {CATEGORIES.map((cat) => {
                        const catProducts = availableProducts.filter((p) => p.category === cat)
                        if (!catProducts.length) return null
                        return (
                          <optgroup key={cat} label={cat}>
                            {catProducts.map((p) => <option key={p.id} value={p.id}>{p.description}{p.part_number ? ` (${p.part_number})` : ''}</option>)}
                          </optgroup>
                        )
                      })}
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

// ── Main AdminPanel ───────────────────────────────────────────
export default function AdminPanel({ products, presets, onRefreshProducts, onRefreshPresets, showToast }: Props) {
  const [tab, setTab] = useState<AdminTab>('products')

  return (
    <>
      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'products' ? 'active' : ''}`} onClick={() => setTab('products')}>
          Product catalogue
        </button>
        <button className={`admin-tab ${tab === 'presets' ? 'active' : ''}`} onClick={() => setTab('presets')}>
          Presets
          {presets.length > 0 && <span style={{ marginLeft: 6, background: 'var(--secondary)', color: 'var(--secondary-text)', borderRadius: 99, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{presets.length}</span>}
        </button>
      </div>

      {tab === 'products' && <ProductsTab products={products} onRefresh={onRefreshProducts} showToast={showToast} />}
      {tab === 'presets' && <PresetsTab products={products} presets={presets} onRefresh={onRefreshPresets} showToast={showToast} />}
    </>
  )
}
