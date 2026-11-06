import type { CustomItem } from '../types'
import type { CustomLine } from '../utils/customItems'
import { newCustomItem } from '../utils/customItems'
import { fmt } from './QuoteBuilder'

// ── One-off items on Review & save ───────────────────────────
// For anything that isn't in the system: the rep types a description, part
// number, cost and quantity, and the line goes on the bill of materials, into
// the totals (materials, so it gets the hardware uplift), the PDF and the saved
// quote. Clear empties it with the rest of the quote.

const titleStyle = { fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 6 } as const
const labelStyle = { display: 'block', fontSize: 11, color: 'var(--text-2)', marginBottom: 3 } as const

export function CustomItemsCard({ items, setItems }: { items: CustomItem[]; setItems: (items: CustomItem[]) => void }) {
  const update = (id: string, field: keyof Omit<CustomItem, 'id'>, value: string) => {
    if ((field === 'cost' || field === 'quantity') && value.trim() !== '') {
      const n = parseFloat(value)
      if (!isNaN(n) && n < 0) return
    }
    setItems(items.map((i) => (i.id === id ? { ...i, [field]: value } : i)))
  }
  const remove = (id: string) => setItems(items.filter((i) => i.id !== id))
  const add = () => setItems([...items, newCustomItem()])

  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
      <div style={titleStyle}>Items not on the system</div>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
        For a one-off part that isn't in the catalogue. It goes on the bill of materials and the PDF, and its cost is added to materials (so it gets the hardware uplift).
      </p>
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
          {items.map((item) => {
            const cost = parseFloat(item.cost) || 0
            const qty = item.quantity.trim() === '' ? 1 : (parseFloat(item.quantity) || 0)
            const named = item.description.trim() !== '' || item.part_number.trim() !== ''
            return (
              <div key={item.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', padding: '10px 12px', border: `1.5px solid ${named ? 'var(--brand)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', background: named ? 'var(--brand-light)' : 'var(--surface)' }}>
                <div style={{ flex: '3 1 220px', minWidth: 0 }}>
                  <label style={labelStyle}>Description</label>
                  <input className="input" placeholder="What the item is" value={item.description} onChange={(e) => update(item.id, 'description', e.target.value)} />
                </div>
                <div style={{ flex: '1 1 130px', minWidth: 0 }}>
                  <label style={labelStyle}>Part number</label>
                  <input className="input" placeholder="Optional" value={item.part_number} onChange={(e) => update(item.id, 'part_number', e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
                </div>
                <div style={{ flex: '1 1 100px', minWidth: 0 }}>
                  <label style={labelStyle}>Cost each (£)</label>
                  <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={item.cost} onChange={(e) => update(item.id, 'cost', e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
                </div>
                <div style={{ flex: '0 1 80px', minWidth: 0 }}>
                  <label style={labelStyle}>Qty</label>
                  <input className="input" type="number" min="0" step="1" placeholder="1" value={item.quantity} onChange={(e) => update(item.id, 'quantity', e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                  <span style={{ minWidth: 72, textAlign: 'right', fontWeight: 600, fontSize: 14 }}>{fmt(cost * qty)}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(item.id)} title="Remove this item" style={{ color: 'var(--danger)' }}>Remove</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <button className="btn btn-sm" onClick={add}>+ Add item not on the system</button>
    </div>
  )
}

// The one-off items as lines on the bill of materials summary
export function CustomBomLines({ lines }: { lines: CustomLine[] }) {
  if (lines.length === 0) return null
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Items not on the system</div>
      {lines.map((l) => (
        <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '3px 0' }}>
          <span style={{ minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, marginRight: 6 }}>{l.quantity}×</span>
            {l.description}
            {l.part_number && <span style={{ color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: 11, marginLeft: 6 }}>{l.part_number}</span>}
          </span>
          <span style={{ flexShrink: 0, fontWeight: 500 }}>{fmt(l.line_total)}</span>
        </div>
      ))}
    </div>
  )
}

// The one-off items as PDF lines
export function customPrintItems(lines: CustomLine[]) {
  return lines.map((l) => ({
    description: l.description,
    part_number: l.part_number,
    factory_cost: l.factory_cost,
    quantity: l.quantity,
    line_total: l.line_total,
    variant_label: null,
  }))
}
