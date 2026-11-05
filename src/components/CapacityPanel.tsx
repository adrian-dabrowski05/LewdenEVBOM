import type { Product, QuantityMap } from '../types'
import { capacityUsage, readCapacity, capacityText } from '../utils/capacity'

// TopTer: how much of the boards' space the quote uses (sockets, flange seats, DIN modules)
export default function CapacityPanel({ products, qty, compact = false }: { products: Product[]; qty: QuantityMap; compact?: boolean }) {
  const lines = capacityUsage(products, qty)
  const overCount = lines.filter((l) => l.over).length
  const titleStyle = { fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' } as const

  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: 16, borderColor: overCount > 0 ? 'var(--danger)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: lines.length > 0 ? 10 : 4 }}>
        <div style={titleStyle}>Board capacity</div>
        {lines.length > 0 && (
          <div style={{ fontSize: 12, fontWeight: 600, color: overCount > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {overCount > 0 ? `⚠ ${overCount} over capacity` : '✓ Everything fits'}
          </div>
        )}
      </div>
      {lines.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Add a board or back box to see how many sockets and DIN modules it takes. Combined boards are added together.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 6 : 8 }}>
          {lines.map((l) => {
            const pct = l.provided > 0 ? Math.min(100, (l.used / l.provided) * 100) : l.used > 0 ? 100 : 0
            const colour = l.over ? 'var(--danger)' : l.used === l.provided && l.used > 0 ? 'var(--warning)' : 'var(--success)'
            if (l.full) {
              // Seats of this size are left, but no socket positions: nothing more of this size fits
              return (
                <div key={l.key} style={{ opacity: 0.6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                    <span style={{ color: 'var(--text-3)' }}>{l.label}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-3)' }}>{l.used > 0 ? `${l.used} · ` : ''}Full</span>
                  </div>
                  {!compact && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>No socket positions left, so no more of this size fit.</div>}
                </div>
              )
            }
            return (
              <div key={l.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                  <span style={{ color: 'var(--text-2)' }}>{l.label}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: l.over ? 'var(--danger)' : 'var(--text-1)' }}>{l.used} / {l.provided}</span>
                </div>
                {!compact && (
                  <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 99, marginTop: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: colour, borderRadius: 99 }} />
                  </div>
                )}
                {l.over && (
                  <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 3 }}>
                    {l.provided === 0
                      ? 'Nothing on the quote provides this yet: add a board, box or flange that takes it.'
                      : `${l.used - l.provided} too many: add another board or pick a bigger one.`}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// One line under a part: what it gives the box and what it takes up
export function CapacityNote({ product }: { product: Product }) {
  const c = readCapacity(product.capacity)
  if (!c.provides && !c.uses) return null
  return (
    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
      {c.provides && <span>Room for: <strong style={{ color: 'var(--text-2)', fontWeight: 600 }}>{capacityText(c.provides)}</strong></span>}
      {c.provides && c.uses && <span> · </span>}
      {c.uses && <span>Uses: <strong style={{ color: 'var(--text-2)', fontWeight: 600 }}>{capacityText(c.uses)}</strong></span>}
    </div>
  )
}
