import { useState, useMemo } from 'react'
import type { Quote, QuoteStatus } from '../types'
import SearchBar from './SearchBar'
import { printSavedQuote, printBOM } from '../utils/printQuote'

interface Props {
  quotes: Quote[]
  loading: boolean
  onUpdateStatus: (id: string, status: string) => void
  onDelete: (id: string) => void
  isAdmin: boolean
}

const STATUS_LABELS: Record<QuoteStatus, string> = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined' }
const STATUS_COLORS: Record<QuoteStatus, string> = { draft: 'badge-draft', sent: 'badge-sent', accepted: 'badge-accepted', declined: 'badge-declined' }
const STATUS_SELECT_STYLES: Record<QuoteStatus, React.CSSProperties> = {
  draft: { background: 'var(--surface-3)', color: 'var(--text-2)' },
  sent: { background: 'var(--info-bg)', color: 'var(--info)' },
  accepted: { background: 'var(--success-bg)', color: 'var(--success)' },
  declined: { background: 'var(--danger-bg)', color: 'var(--danger)' },
}

const fmt = (n: number | null | undefined) => n != null ? `£${Number(n).toFixed(2)}` : '—'
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

function BOMModal({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const items = quote.quote_items ?? []
  const baseUrl = (import.meta as any).env.BASE_URL

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580, maxHeight: '90dvh', overflow: 'auto' }}>
        <div className="modal-handle" />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 17 }}>Bill of Materials</h2>
            <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3 }}>{quote.project_name}</p>
            {quote.customer_name && <p style={{ fontSize: 13, color: 'var(--text-2)' }}>{quote.customer_name}</p>}
          </div>
          {quote.mo_number && (
            <span style={{ background: 'var(--brand)', color: '#fff', padding: '3px 10px', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {quote.mo_number}
            </span>
          )}
        </div>

        <div style={{ background: 'var(--brand-light)', border: '1px solid var(--brand)', borderRadius: 'var(--radius-md)', padding: '8px 12px', marginBottom: 16, fontSize: 12, color: 'var(--brand)', fontWeight: 500 }}>
          Order confirmation — no pricing information shown
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {items.map((item, i) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{item.description}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  {item.part_number && <span className="part-number">{item.part_number}</span>}
                  {item.variant_label && (
                    <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--secondary)', color: 'var(--secondary-text)', padding: '2px 8px', borderRadius: 99 }}>
                      {item.variant_label}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ flexShrink: 0, textAlign: 'right' }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>×{item.quantity}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1.5px solid var(--border)', marginTop: 12, paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{items.length} item{items.length !== 1 ? 's' : ''} · {items.reduce((s, i) => s + i.quantity, 0)} units total</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={onClose}>Close</button>
            <button className="btn btn-sm btn-primary" onClick={() => printBOM(quote, baseUrl)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              Print BOM
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SavedQuotes({ quotes, loading, onUpdateStatus, onDelete, isAdmin }: Props) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [bomQuote, setBomQuote] = useState<Quote | null>(null)
  const baseUrl = (import.meta as any).env.BASE_URL

  const filtered = useMemo(() => {
    if (!search.trim()) return quotes
    const q = search.toLowerCase()
    return quotes.filter((quote) =>
      quote.project_name.toLowerCase().includes(q) ||
      (quote.customer_name ?? '').toLowerCase().includes(q) ||
      (quote.mo_number ?? '').toLowerCase().includes(q) ||
      (quote.notes ?? '').toLowerCase().includes(q) ||
      quote.status.toLowerCase().includes(q) ||
      quote.quote_items?.some((item) =>
        item.description.toLowerCase().includes(q) ||
        (item.part_number ?? '').toLowerCase().includes(q) ||
        (item.variant_label ?? '').toLowerCase().includes(q),
      ),
    )
  }, [quotes, search])

  if (loading) return <div className="loading"><div className="spinner" /> Loading quotes…</div>

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
        <SearchBar value={search} onChange={setSearch} placeholder="Search by project, customer, MO number, part number…" />
        <div style={{ fontSize: 13, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{filtered.length} of {quotes.length}</div>
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
          const hasLabour = (q.labour_total ?? 0) > 0
          const hasUplift = (q.hardware_uplift_amount ?? 0) > 0

          return (
            <div key={q.id} className="quote-card">
              <div className="quote-card-header" onClick={() => setExpanded(isExpanded ? null : q.id)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div className="quote-card-title">{q.project_name}</div>
                    <span className={`badge ${STATUS_COLORS[q.status]}`}>{STATUS_LABELS[q.status]}</span>
                    {q.mo_number && (
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, background: 'var(--brand)', color: '#fff', padding: '1px 7px', borderRadius: 4 }}>
                        {q.mo_number}
                      </span>
                    )}
                  </div>
                  {q.customer_name && <div className="quote-card-meta">{q.customer_name}</div>}
                  <div className="quote-card-meta">{items.length} item{items.length !== 1 ? 's' : ''} · {formatDate(q.created_at)}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                  <div className="quote-card-total">{fmt(q.grand_total)}</div>
                  <svg style={{ width: 16, height: 16, color: 'var(--text-3)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'none' }}
                    viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6l4 4 4-4" /></svg>
                </div>
              </div>

              {isExpanded && (
                <div className="quote-card-body">
                  {q.notes && <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12, fontStyle: 'italic' }}>{q.notes}</p>}

                  {/* Status + actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</label>
                    <select className="status-select" style={STATUS_SELECT_STYLES[q.status]} value={q.status} onChange={(e) => onUpdateStatus(q.id, e.target.value)}>
                      {Object.entries(STATUS_LABELS).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                    </select>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm" onClick={() => setBomQuote(q)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                        </svg>
                        View BOM
                      </button>
                      <button className="btn btn-sm" onClick={() => printSavedQuote(q, baseUrl)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                          <line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" />
                        </svg>
                        PDF
                      </button>
                      {isAdmin && !isConfirming && <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(q.id)}>Delete</button>}
                      {isConfirming && (
                        <>
                          <span style={{ fontSize: 13, color: 'var(--text-2)', display: 'flex', alignItems: 'center' }}>Are you sure?</span>
                          <button className="btn btn-sm" onClick={() => setConfirmDelete(null)}>Cancel</button>
                          <button className="btn btn-sm btn-danger" onClick={() => { onDelete(q.id); setConfirmDelete(null); setExpanded(null) }}>Yes, delete</button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Items table */}
                  <div className="card" style={{ overflow: 'auto', marginBottom: 14 }}>
                    <table className="product-table" style={{ minWidth: 480 }}>
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th style={{ width: 100 }}>Part no.</th>
                          <th style={{ width: 120 }}>Variant</th>
                          <th className="right" style={{ width: 80 }}>Unit cost</th>
                          <th className="right" style={{ width: 50 }}>Qty</th>
                          <th className="right" style={{ width: 80 }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={item.id}>
                            <td>{item.description}</td>
                            <td>{item.part_number ? <span className="part-number">{item.part_number}</span> : <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>}</td>
                            <td>
                              {item.variant_label
                                ? <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--secondary)', color: 'var(--secondary-text)', padding: '2px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>{item.variant_label}</span>
                                : <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>}
                            </td>
                            <td className="right">{item.factory_cost != null ? fmt(item.factory_cost) : <span className="cost-tbc">TBC</span>}</td>
                            <td className="right">{item.quantity}</td>
                            <td className="right" style={{ fontWeight: 600 }}>{item.line_total != null ? fmt(item.line_total) : <span className="cost-tbc">TBC</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Cost breakdown */}
                  <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 8 }}>Cost breakdown</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span style={{ color: 'var(--text-2)' }}>Materials subtotal</span>
                        <span>{fmt(q.materials_subtotal)}</span>
                      </div>
                      {hasUplift && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span style={{ color: 'var(--secondary-text)', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ background: 'var(--secondary)', borderRadius: 4, padding: '1px 5px', fontSize: 10, fontWeight: 700 }}>+{q.hardware_uplift_pct}%</span>
                            Hardware uplift
                          </span>
                          <span style={{ color: 'var(--secondary-text)' }}>{fmt(q.hardware_uplift_amount)}</span>
                        </div>
                      )}
                      {hasLabour && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span style={{ color: 'var(--brand)' }}>
                            Labour <span style={{ fontSize: 11, color: 'var(--text-3)' }}>({q.labour_minutes} min @ £{Number(q.labour_rate_per_min).toFixed(4)}/min)</span>
                          </span>
                          <span style={{ color: 'var(--brand)' }}>{fmt(q.labour_total)}</span>
                        </div>
                      )}
                      <div style={{ borderTop: '1.5px solid var(--border)', paddingTop: 6, marginTop: 2, display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700 }}>
                        <span>Grand total</span>
                        <span>{fmt(q.grand_total)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {bomQuote && <BOMModal quote={bomQuote} onClose={() => setBomQuote(null)} />}
    </>
  )
}
