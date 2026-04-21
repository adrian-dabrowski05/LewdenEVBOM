import { useState, useMemo } from 'react'
import type { Product, Category } from '../types'
import { CATEGORIES } from '../types'
import { supabase } from '../lib/supabase'
import SearchBar from './SearchBar'

interface Props {
  products: Product[]
  onRefresh: () => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

interface EditBuffer {
  description: string
  category: Category
  part_number: string
  factory_cost: string
  notes: string
}

const emptyBuffer = (): EditBuffer => ({
  description: '',
  category: 'Outgoing',
  part_number: '',
  factory_cost: '',
  notes: '',
})

export default function AdminPanel({ products, onRefresh, showToast }: Props) {
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBuf, setEditBuf] = useState<EditBuffer>(emptyBuffer())
  const [saving, setSaving] = useState(false)
  const [addingNew, setAddingNew] = useState(false)
  const [newBuf, setNewBuf] = useState<EditBuffer>(emptyBuffer())

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

  const startEdit = (p: Product) => {
    setEditingId(p.id)
    setEditBuf({
      description: p.description,
      category: p.category,
      part_number: p.part_number ?? '',
      factory_cost: p.factory_cost != null ? String(p.factory_cost) : '',
      notes: p.notes ?? '',
    })
  }

  const cancelEdit = () => { setEditingId(null) }

  const saveEdit = async () => {
    if (!editingId) return
    if (!editBuf.description.trim()) { showToast('Description is required', 'error'); return }
    setSaving(true)
    const { error } = await supabase
      .from('products')
      .update({
        description: editBuf.description.trim(),
        category: editBuf.category,
        part_number: editBuf.part_number.trim() || null,
        factory_cost: editBuf.factory_cost ? parseFloat(editBuf.factory_cost) : null,
        notes: editBuf.notes.trim() || null,
      })
      .eq('id', editingId)
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
    const maxOrder = Math.max(0, ...products.filter(p => p.category === newBuf.category).map(p => p.sort_order))
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

  const EditableRow = ({ buf, onBuf }: { buf: EditBuffer; onBuf: (b: EditBuffer) => void }) => (
    <tr className="editing-row">
      <td style={{ minWidth: 220 }}>
        <input
          className="input input-sm"
          value={buf.description}
          onChange={(e) => onBuf({ ...buf, description: e.target.value })}
          placeholder="Description *"
        />
      </td>
      <td>
        <select
          className="input input-sm"
          value={buf.category}
          onChange={(e) => onBuf({ ...buf, category: e.target.value as Category })}
        >
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td>
        <input
          className="input input-sm"
          style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
          value={buf.part_number}
          onChange={(e) => onBuf({ ...buf, part_number: e.target.value })}
          placeholder="LCR1234"
        />
      </td>
      <td>
        <input
          className="input input-sm"
          type="number"
          step="0.01"
          min="0"
          style={{ textAlign: 'right' }}
          value={buf.factory_cost}
          onChange={(e) => onBuf({ ...buf, factory_cost: e.target.value })}
          placeholder="0.00"
        />
      </td>
      <td>
        <input
          className="input input-sm"
          value={buf.notes}
          onChange={(e) => onBuf({ ...buf, notes: e.target.value })}
          placeholder="Optional note"
        />
      </td>
    </tr>
  )

  return (
    <>
      <div className="toolbar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search catalogue…" />
        <div className="toolbar-right">
          <button className="btn btn-primary" onClick={() => { setAddingNew(true); setNewBuf(emptyBuffer()) }}>
            + Add product
          </button>
        </div>
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 12 }}>
        {filtered.length} product{filtered.length !== 1 ? 's' : ''}
        {search && ` matching "${search}"`}
      </div>

      <div className="card" style={{ overflow: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Description</th>
              <th style={{ width: 140 }}>Category</th>
              <th style={{ width: 110 }}>Part no.</th>
              <th style={{ width: 100, textAlign: 'right' }}>Factory cost</th>
              <th style={{ width: 160 }}>Notes</th>
              <th style={{ width: 120, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* New row */}
            {addingNew && (
              <>
                <EditableRow buf={newBuf} onBuf={setNewBuf} />
                <tr style={{ background: 'var(--brand-light)' }}>
                  <td colSpan={6} style={{ paddingTop: 6, paddingBottom: 6 }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm" onClick={() => setAddingNew(false)}>Cancel</button>
                      <button className="btn btn-sm btn-primary" onClick={saveNew} disabled={saving}>
                        {saving ? 'Saving…' : 'Add product'}
                      </button>
                    </div>
                  </td>
                </tr>
              </>
            )}

            {filtered.map((p) =>
              editingId === p.id ? (
                <>
                  <EditableRow key={`edit-${p.id}`} buf={editBuf} onBuf={setEditBuf} />
                  <tr key={`edit-actions-${p.id}`} style={{ background: 'var(--brand-light)' }}>
                    <td colSpan={6} style={{ paddingTop: 6, paddingBottom: 6 }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm" onClick={cancelEdit}>Cancel</button>
                        <button className="btn btn-sm btn-primary" onClick={saveEdit} disabled={saving}>
                          {saving ? 'Saving…' : 'Save changes'}
                        </button>
                      </div>
                    </td>
                  </tr>
                </>
              ) : (
                <tr key={p.id}>
                  <td>{p.description}</td>
                  <td>
                    <span style={{ fontSize: 12, color: 'var(--text-2)', background: 'var(--surface-3)', padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>
                      {p.category}
                    </span>
                  </td>
                  <td>
                    {p.part_number
                      ? <span className="part-number">{p.part_number}</span>
                      : <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>
                    {p.factory_cost != null
                      ? `£${p.factory_cost.toFixed(2)}`
                      : <span style={{ color: 'var(--text-3)', fontSize: 12, fontStyle: 'italic' }}>—</span>}
                  </td>
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
