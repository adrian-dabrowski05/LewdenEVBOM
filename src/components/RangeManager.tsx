import { useMemo, useState } from 'react'
import type { Product } from '../types'
import { supabase } from '../lib/supabase'
import { rangeKey } from '../utils/ranges'

type ShowToast = (msg: string, type?: 'success' | 'error') => void

// Admin (TopTer): which range a part belongs to, and what tells it apart from
// the other variants. Parts with the same range name share one card in the
// quote builder.
export default function RangeManager({ product, products, onRefresh, showToast }: {
  product: Product; products: Product[]; onRefresh: () => void; showToast: ShowToast
}) {
  const [name, setName] = useState(product.range_name ?? '')
  const [option, setOption] = useState(product.option_label ?? '')
  const [saving, setSaving] = useState(false)

  const rangeNames = useMemo(() => {
    const seen = new Map<string, string>()
    products.forEach((p) => { const k = rangeKey(p); if (k && !seen.has(k)) seen.set(k, p.range_name!.trim()) })
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [products])

  const key = name.trim().toLowerCase()
  const others = useMemo(() => key ? products.filter((p) => p.id !== product.id && rangeKey(p) === key) : [], [products, product.id, key])

  const save = async (clear = false) => {
    const range_name = clear ? null : name.trim() || null
    const option_label = clear || !range_name ? null : option.trim() || null
    setSaving(true)
    const { error } = await supabase.from('products').update({ range_name, option_label }).eq('id', product.id)
    setSaving(false)
    if (error) { showToast(/range_name|option_label/.test(error.message) ? 'Run supabase/topter-pictures-ranges.sql in Supabase first' : `Could not save: ${error.message}`, 'error'); return }
    if (clear) { setName(''); setOption('') }
    showToast(clear ? 'Taken out of its range' : 'Range saved'); onRefresh()
  }

  const listId = `ranges-${product.id}`
  return (
    <div style={{ padding: '12px 14px', background: 'var(--info-bg)', border: '1px solid var(--info)', borderRadius: 'var(--radius-md)', marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--info)', marginBottom: 8 }}>Range</div>
      <p style={{ fontSize: 11, color: 'var(--info)', marginBottom: 10, opacity: 0.9 }}>
        Parts with the same range name are listed together under one card, with the range's picture. The variant text is what tells this part apart, for example <strong>16A 110V 2P+E 4h</strong>. Leave the range blank to show the part on its own.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
          Range name
          <input className="input input-sm" list={listId} style={{ marginTop: 4 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. topTER interlocked socket, IP44" />
          <datalist id={listId}>{rangeNames.map((r) => <option key={r} value={r} />)}</datalist>
        </label>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
          Variant
          <input className="input input-sm" style={{ marginTop: 4 }} value={option} onChange={(e) => setOption(e.target.value)} placeholder="e.g. 16A 110V 2P+E 4h" disabled={!name.trim()} />
        </label>
      </div>
      {key && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
          {others.length === 0
            ? 'No other part is in this range yet.'
            : `Shares a card with ${others.length} other part${others.length === 1 ? '' : 's'}: ${others.slice(0, 5).map((p) => p.option_label || p.part_number || p.description).join(', ')}${others.length > 5 ? ` and ${others.length - 5} more` : ''}`}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
        {product.range_name && <button className="btn btn-sm" onClick={() => save(true)} disabled={saving}>Take out of range</button>}
        <button className="btn btn-sm btn-primary" onClick={() => save()} disabled={saving}>{saving ? 'Saving…' : 'Save range'}</button>
      </div>
    </div>
  )
}
