import { useState, useMemo } from 'react'
import type { Quote, QuoteStatus } from '../types'
import SearchBar from './SearchBar'

interface Props {
  quotes: Quote[]
  loading: boolean
  onUpdateStatus: (id: string, status: string) => void
  onDelete: (id: string) => void
  isAdmin: boolean
}

const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
}

const STATUS_COLORS: Record<QuoteStatus, string> = {
  draft: 'badge-draft',
  sent: 'badge-sent',
  accepted: 'badge-accepted',
  declined: 'badge-declined',
}

const STATUS_SELECT_STYLES: Record<QuoteStatus, string> = {
  draft: 'background:var(--surface-3);color:var(--text-2)',
  sent: 'background:var(--info-bg);color:var(--info)',
  accepted: 'background:var(--success-bg);color:var(--success)',
  declined: 'background:var(--danger-bg);color:var(--danger)',
}

function fmt(n: number | null) {
  return n != null ? `£${n.toFixed(2)}` : '—'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default function SavedQuotes({ quotes, loading, onUpdateStatus, onDelete, isAdmin }: Props) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return quotes
    const q = search.toLowerCase()
    return quotes.filter(
      (quote) =>
        quote.project_name.toLowerCase().includes(q) ||
        (quote.customer_name ?? '').toLowerCase().includes(q) ||
        (quote.notes ?? '').toLowerCase().includes(q) ||
        quote.status.toLowerCase().includes(q) ||
        quote.quote_items?.some(
          (item) =>
            item.description.toLowerCase().includes(q) ||
            (item.part_number ?? '').toLowerCase().includes(q),
        ),
    )
  }, [quotes, search])

  if (loading) {
    return <div className="loading"><div className="spinner" /> Loading quotes…</div>
  }

  if (quotes.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📋</div>
        <h3>No quotes yet</h3>
        <p>Build a quote in the builder and save it to see it here</p>
      </div>
    )
  }

  return (
    <>
      <div className="toolbar">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search by project, customer, part number…"
        />
        <div style={{ fontSize: 13, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
          {filtered.length} of {quotes.length}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <h3>No results</h3>
          <p>Try a different search term</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map((q) => {
          const isExpanded = expanded === q.id
          const isConfirming = confirmDelete === q.id
          const items = q.quote_items ?? []

          return (
            <div key={q.id} className="quote-card">
              <div className="quote-card-header" onClick={() => setExpanded(isExpanded ? null : q.id)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div className="quote-card-title">{q.project_name}</div>
                    <span className={`badge ${STATUS_COLORS[q.status]}`}>{STATUS_LABELS[q.status]}</span>
                  </div>
                  {q.customer_name && (
                    <div className="quote-card-meta">{q.customer_name}</div>
                  )}
                  <div className="quote-card-meta">
                    {items.length} item{items.length !== 1 ? 's' : ''} · {formatDate(q.created_at)}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                  <div className="quote-card-total">{fmt(q.grand_total)}</div>
                  <svg
                    style={{ width: 16, height: 16, color: 'var(--text-3)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  >
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </div>
              </div>

              {isExpanded && (
                <div className="quote-card-body">
                  {q.notes && (
                    <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12, fontStyle: 'italic' }}>
                      {q.notes}
                    </p>
                  )}

                  {/* Status + actions row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Status
                    </label>
                    <select
                      className="status-select"
                      style={{ cssText: STATUS_SELECT_STYLES[q.status] } as React.CSSProperties}
                      value={q.status}
                      onChange={(e) => onUpdateStatus(q.id, e.target.value)}
                    >
                      {Object.entries(STATUS_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>

                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      {isAdmin && !isConfirming && (
                        <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(q.id)}>
                          Delete
                        </button>
                      )}
                      {isConfirming && (
                        <>
                          <span style={{ fontSize: 13, color: 'var(--text-2)', display: 'flex', alignItems: 'center' }}>Are you sure?</span>
                          <button className="btn btn-sm" onClick={() => setConfirmDelete(null)}>Cancel</button>
                          <button className="btn btn-sm btn-danger" onClick={() => { onDelete(q.id); setConfirmDelete(null); setExpanded(null) }}>
                            Yes, delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Items table — desktop */}
                  <div className="card" style={{ overflow: 'auto' }}>
                    <table className="product-table" style={{ minWidth: 480 }}>
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th style={{ width: 100 }}>Part no.</th>
                          <th className="right" style={{ width: 80 }}>Unit cost</th>
                          <th className="right" style={{ width: 50 }}>Qty</th>
                          <th className="right" style={{ width: 80 }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={item.id}>
                            <td>{item.description}</td>
                            <td>
                              {item.part_number
                                ? <span className="part-number">{item.part_number}</span>
                                : <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>}
                            </td>
                            <td className="right">
                              {item.factory_cost != null ? fmt(item.factory_cost) : <span className="cost-tbc">TBC</span>}
                            </td>
                            <td className="right">{item.quantity}</td>
                            <td className="right" style={{ fontWeight: 600 }}>
                              {item.line_total != null ? fmt(item.line_total) : <span className="cost-tbc">TBC</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 2 }}>Grand total</div>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(q.grand_total)}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
