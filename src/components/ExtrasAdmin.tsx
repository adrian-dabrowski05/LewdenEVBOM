import { useState } from 'react'
import type { Product, Extra, ExtraItem, CabinetMaterial } from '../types'
import { CATEGORIES } from '../types'
import { supabase } from '../lib/supabase'
import { MATERIAL_LABELS, RATING_OPTIONS, SIZE_OPTIONS } from '../utils/extras'

type ShowToast = (msg: string, type?: 'success' | 'error') => void

const smallLabel = { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5 } as const

interface MetaBuffer {
  name: string
  description: string
  is_enabled: boolean
  labour_minutes: string
  allowed_ratings: number[]
  allowed_materials: CabinetMaterial[]
}

const toBuffer = (e: Extra): MetaBuffer => ({
  name: e.name,
  description: e.description ?? '',
  is_enabled: e.is_enabled,
  labour_minutes: e.labour_minutes ? String(e.labour_minutes) : '',
  allowed_ratings: e.allowed_ratings ?? [],
  allowed_materials: e.allowed_materials ?? [],
})

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

function ProductSelect({ products, value, onChange }: { products: Product[]; value: string; onChange: (id: string) => void }) {
  return (
    <select className="input input-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select a product…</option>
      {CATEGORIES.map((cat) => {
        const cp = products.filter((p) => p.category === cat)
        if (!cp.length) return null
        return <optgroup key={cat} label={cat}>{cp.map((p) => <option key={p.id} value={p.id}>{p.description}{p.part_number ? ` (${p.part_number})` : ''}</option>)}</optgroup>
      })}
    </select>
  )
}

// ── Items of one extra ────────────────────────────────────────
function ExtraItemsManager({ extra, products, onRefresh, showToast }: { extra: Extra; products: Product[]; onRefresh: () => void; showToast: ShowToast }) {
  const [action, setAction] = useState<'add' | 'remove'>('add')
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('1')
  const [rating, setRating] = useState('')
  const [size, setSize] = useState('')
  const [onlyIfRemoved, setOnlyIfRemoved] = useState(false)
  const [saving, setSaving] = useState(false)

  const items = [...(extra.extra_items ?? [])].sort((a, b) => a.sort_order - b.sort_order)

  const addItem = async () => {
    if (!productId) { showToast('Select a product', 'error'); return }
    const quantity = parseFloat(qty)
    if (!(quantity > 0)) { showToast('Enter a quantity above 0', 'error'); return }
    setSaving(true)
    const maxOrder = items.reduce((m, i) => Math.max(m, i.sort_order), 0)
    const { error } = await supabase.from('extra_items').insert({
      extra_id: extra.id, product_id: productId, action, quantity,
      condition_rating: rating ? Number(rating) : null,
      condition_size: size ? Number(size) : null,
      only_if_removed: action === 'add' && onlyIfRemoved,
      sort_order: maxOrder + 10,
    })
    setSaving(false)
    if (error) { showToast('Failed to add item', 'error'); return }
    showToast('Item added'); setProductId(''); setQty('1'); setRating(''); setSize(''); setOnlyIfRemoved(false); onRefresh()
  }

  const updateItem = async (item: ExtraItem, update: Partial<ExtraItem>) => {
    const { error } = await supabase.from('extra_items').update(update).eq('id', item.id)
    if (error) { showToast('Failed to update item', 'error'); return }
    onRefresh()
  }

  const removeItem = async (id: string) => {
    const { error } = await supabase.from('extra_items').delete().eq('id', id)
    if (error) { showToast('Failed to remove item', 'error'); return }
    onRefresh()
  }

  return (
    <div style={{ marginTop: 4 }}>
      <div style={smallLabel}>What this extra does</div>
      {items.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '6px 0' }}>No items yet — this extra only adds its labour.</div>}
      {items.map((item) => {
        const product = products.find((p) => p.id === item.product_id)
        const isRemove = item.action === 'remove'
        return (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: isRemove ? 'var(--danger-bg)' : 'var(--success-bg)', color: isRemove ? 'var(--danger)' : 'var(--success)', border: `1px solid ${isRemove ? 'var(--danger)' : 'var(--success)'}`, flexShrink: 0 }}>
              {isRemove ? 'Remove' : 'Add'}
            </span>
            <div style={{ flex: '1 1 180px', fontSize: 13, minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{product?.description ?? 'Unknown product'}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
                {product?.part_number && <span className="part-number">{product.part_number}</span>}
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{product?.factory_cost != null ? `£${product.factory_cost.toFixed(2)} each` : 'Price TBC'}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="number" min="1" step="1" title="Quantity"
                style={{ width: 60, padding: '4px 8px', fontSize: 13, border: '1.5px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 500 }}
                defaultValue={item.quantity}
                onBlur={(e) => { const q = parseFloat(e.target.value); if (q > 0 && q !== item.quantity) updateItem(item, { quantity: q }) }} />
              <select className="input input-sm" style={{ width: 'auto' }} title="Only at this current rating" value={item.condition_rating ?? ''} onChange={(e) => updateItem(item, { condition_rating: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Any rating</option>
                {RATING_OPTIONS.map((r) => <option key={r} value={r}>{r}A only</option>)}
              </select>
              <select className="input input-sm" style={{ width: 'auto' }} title="Only for this cabinet size" value={item.condition_size ?? ''} onChange={(e) => updateItem(item, { condition_size: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Any size</option>
                {SIZE_OPTIONS.map((n) => <option key={n} value={n}>Size {n} only</option>)}
              </select>
              {!isRemove && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }} title="Only add this if one of this extra's Remove lines found something to remove">
                  <input type="checkbox" checked={item.only_if_removed} onChange={(e) => updateItem(item, { only_if_removed: e.target.checked })} />
                  Only if swapped
                </label>
              )}
              <button className="btn btn-sm btn-danger" onClick={() => removeItem(item.id)}>Delete</button>
            </div>
          </div>
        )
      })}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
        <div style={{ width: 110 }}>
          <label style={smallLabel}>Action</label>
          <select className="input input-sm" value={action} onChange={(e) => setAction(e.target.value as 'add' | 'remove')}>
            <option value="add">Add</option>
            <option value="remove">Remove</option>
          </select>
        </div>
        <div style={{ flex: '2 1 200px' }}>
          <label style={smallLabel}>Product</label>
          <ProductSelect products={products} value={productId} onChange={setProductId} />
        </div>
        <div style={{ width: 70 }}>
          <label style={smallLabel}>Qty</label>
          <input className="input input-sm" type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} style={{ fontFamily: 'var(--mono)', textAlign: 'center' }} />
        </div>
        <div style={{ width: 120 }}>
          <label style={smallLabel}>Rating</label>
          <select className="input input-sm" value={rating} onChange={(e) => setRating(e.target.value)}>
            <option value="">Any</option>
            {RATING_OPTIONS.map((r) => <option key={r} value={r}>{r}A only</option>)}
          </select>
        </div>
        <div style={{ width: 120 }}>
          <label style={smallLabel}>Cabinet size</label>
          <select className="input input-sm" value={size} onChange={(e) => setSize(e.target.value)}>
            <option value="">Any</option>
            {SIZE_OPTIONS.map((n) => <option key={n} value={n}>Size {n} only</option>)}
          </select>
        </div>
        {action === 'add' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-2)', paddingBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyIfRemoved} onChange={(e) => setOnlyIfRemoved(e.target.checked)} />
            Only if swapped
          </label>
        )}
        <button className="btn btn-sm btn-secondary" onClick={addItem} disabled={saving}>{saving ? 'Adding…' : 'Add line'}</button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 10 }}>
        To swap a part, add a <strong>Remove</strong> line for the old part and an <strong>Add</strong> line for the new one. Tick "Only if swapped" on the Add line if the new part should only go on when the old part was actually in the BOM.
      </p>
    </div>
  )
}

// ── Extras tab ────────────────────────────────────────────────
export default function ExtrasAdmin({ extras, products, onRefresh, showToast }: { extras: Extra[]; products: Product[]; onRefresh: () => void; showToast: ShowToast }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [buf, setBuf] = useState<MetaBuffer | null>(null)
  const [saving, setSaving] = useState(false)

  const startEdit = (extra: Extra) => { setEditingId(extra.id); setBuf(toBuffer(extra)); setExpanded(extra.id) }

  const saveMeta = async (id: string) => {
    if (!buf) return
    if (!buf.name.trim()) { showToast('Name is required', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('extras').update({
      name: buf.name.trim(),
      description: buf.description.trim() || null,
      is_enabled: buf.is_enabled,
      labour_minutes: parseFloat(buf.labour_minutes) || 0,
      allowed_ratings: buf.allowed_ratings.length ? [...buf.allowed_ratings].sort((a, b) => a - b) : null,
      allowed_materials: buf.allowed_materials.length ? buf.allowed_materials : null,
    }).eq('id', id)
    setSaving(false)
    if (error) { showToast('Failed to save extra', 'error'); return }
    showToast('Extra saved'); setEditingId(null); setBuf(null); onRefresh()
  }

  const createExtra = async () => {
    const nextNumber = extras.reduce((m, e) => Math.max(m, e.number), 0) + 1
    const { data, error } = await supabase.from('extras').insert({ number: nextNumber, name: `Extra ${nextNumber}`, is_enabled: false, labour_minutes: 0 }).select().single()
    if (error || !data) { showToast('Failed to create extra', 'error'); return }
    showToast(`Extra ${nextNumber} created`); onRefresh(); startEdit({ ...data, extra_items: [] })
  }

  const deleteExtra = async (extra: Extra) => {
    if (!confirm(`Delete extra ${extra.number} "${extra.name}"? Saved quotes keep their record of it.`)) return
    const { error } = await supabase.from('extras').delete().eq('id', extra.id)
    if (error) { showToast('Failed to delete extra', 'error'); return }
    showToast('Extra deleted'); if (expanded === extra.id) setExpanded(null); onRefresh()
  }

  return (
    <>
      <div className="toolbar">
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{extras.length} extra{extras.length !== 1 ? 's' : ''} · prices are edited in the Product catalogue</div>
        <div className="toolbar-right"><button className="btn btn-primary" onClick={createExtra}>+ New extra</button></div>
      </div>

      {extras.length === 0 && <div className="empty-state"><div className="empty-state-icon">➕</div><h3>No extras yet</h3><p>Run the extras SQL in Supabase to set up extras 1–13</p></div>}

      {extras.map((extra) => {
        const isOpen = expanded === extra.id
        const isEditing = editingId === extra.id && buf != null
        const itemCount = extra.extra_items?.length ?? 0
        return (
          <div key={extra.id} className="preset-admin-card" style={!extra.is_enabled ? { opacity: 0.75 } : undefined}>
            <div className="preset-admin-header" onClick={() => setExpanded(isOpen ? null : extra.id)}>
              <div style={{ flex: 1 }}>
                {isEditing && buf ? (
                  <div onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      <input className="input input-sm" value={buf.name} onChange={(e) => setBuf({ ...buf, name: e.target.value })} style={{ flex: 1, minWidth: 160 }} placeholder="Name *" />
                      <input className="input input-sm" value={buf.description} onChange={(e) => setBuf({ ...buf, description: e.target.value })} style={{ flex: 2, minWidth: 160 }} placeholder="Description shown to reps (optional)" />
                    </div>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
                      <div>
                        <label style={smallLabel}>Labour minutes</label>
                        <input className="input input-sm" type="number" min="0" value={buf.labour_minutes} onChange={(e) => setBuf({ ...buf, labour_minutes: e.target.value })} placeholder="0" style={{ maxWidth: 120 }} />
                      </div>
                      <div>
                        <label style={smallLabel}>Available</label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, height: 34, cursor: 'pointer' }}>
                          <input type="checkbox" checked={buf.is_enabled} onChange={(e) => setBuf({ ...buf, is_enabled: e.target.checked })} />
                          {buf.is_enabled ? 'Reps can tick it' : 'Greyed out'}
                        </label>
                      </div>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={smallLabel}>Only for these current ratings (none ticked = any)</label>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {RATING_OPTIONS.map((r) => (
                          <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                            <input type="checkbox" checked={buf.allowed_ratings.includes(r)} onChange={() => setBuf({ ...buf, allowed_ratings: toggleIn(buf.allowed_ratings, r) })} />{r}A
                          </label>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={smallLabel}>Only for these cabinets (none ticked = any)</label>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {(Object.keys(MATERIAL_LABELS) as CabinetMaterial[]).map((m) => (
                          <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                            <input type="checkbox" checked={buf.allowed_materials.includes(m)} onChange={() => setBuf({ ...buf, allowed_materials: toggleIn(buf.allowed_materials, m) })} />{MATERIAL_LABELS[m]}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-sm" onClick={() => { setEditingId(null); setBuf(null) }}>Cancel</button>
                      <button className="btn btn-sm btn-primary" onClick={() => saveMeta(extra.id)} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div className="preset-admin-name"><span style={{ color: 'var(--text-3)', marginRight: 6 }}>{extra.number}.</span>{extra.name}</div>
                      <span className="badge badge-preset">{itemCount} line{itemCount !== 1 ? 's' : ''}</span>
                      {!extra.is_enabled && <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 99, background: 'var(--surface-3)', color: 'var(--text-3)' }}>Greyed out</span>}
                    </div>
                    {extra.description && <div className="preset-admin-desc">{extra.description}</div>}
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {Number(extra.labour_minutes) > 0 && <span style={{ color: 'var(--brand)' }}>+{extra.labour_minutes} min labour</span>}
                      {(extra.allowed_ratings ?? []).length > 0 && <span>{(extra.allowed_ratings ?? []).map((r) => `${r}A`).join(' / ')} only</span>}
                      {(extra.allowed_materials ?? []).length > 0 && <span>{(extra.allowed_materials ?? []).map((m) => MATERIAL_LABELS[m] ?? m).join(' / ')} only</span>}
                    </div>
                  </>
                )}
              </div>
              {!isEditing && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn-sm" onClick={() => startEdit(extra)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => deleteExtra(extra)}>Delete</button>
                  <svg style={{ width: 16, height: 16, color: 'var(--text-3)', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none', flexShrink: 0 }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6l4 4 4-4" /></svg>
                </div>
              )}
            </div>

            {isOpen && (
              <div className="preset-admin-body">
                <ExtraItemsManager extra={extra} products={products} onRefresh={onRefresh} showToast={showToast} />
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
