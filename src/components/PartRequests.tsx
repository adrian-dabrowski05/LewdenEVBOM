import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import SearchBar from './SearchBar'

interface PartRequest {
  id: string
  description: string | null
  part_number: string | null
  notes: string | null
  requested_by: string | null
  status: 'pending' | 'added' | 'declined'
  created_at: string
}

interface Props {
  isAdmin: boolean
  showToast: (msg: string, type?: 'success' | 'error') => void
}

const STATUS_STYLES: Record<string, { background: string; color: string; border: string }> = {
  pending:  { background: 'var(--warning-bg)',  color: 'var(--warning)',  border: 'var(--warning)' },
  added:    { background: 'var(--success-bg)',  color: 'var(--success)',  border: 'var(--success)' },
  declined: { background: 'var(--danger-bg)',   color: 'var(--danger)',   border: 'var(--danger)'  },
}

const STATUS_LABELS = { pending: 'Pending', added: 'Added', declined: 'Declined' }

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function PartRequests({ isAdmin, showToast }: Props) {
  const [requests, setRequests] = useState<PartRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Form state
  const [formDesc, setFormDesc] = useState('')
  const [formPN, setFormPN] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formBy, setFormBy] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Admin filter
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'added' | 'declined'>('all')

  useEffect(() => { loadRequests() }, [])

  const loadRequests = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('part_requests')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) showToast('Failed to load requests', 'error')
    else setRequests(data || [])
    setLoading(false)
  }

  const submitRequest = async () => {
    if (!formDesc.trim() && !formPN.trim()) {
      showToast('Please enter a description or part number', 'error')
      return
    }
    setSubmitting(true)
    const { error } = await supabase.from('part_requests').insert({
      description: formDesc.trim() || null,
      part_number: formPN.trim() || null,
      notes: formNotes.trim() || null,
      requested_by: formBy.trim() || null,
      status: 'pending',
    })
    setSubmitting(false)
    if (error) { showToast('Failed to submit request', 'error'); return }
    setSubmitted(true)
    setFormDesc(''); setFormPN(''); setFormNotes(''); setFormBy('')
    loadRequests()
    setTimeout(() => setSubmitted(false), 4000)
  }

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from('part_requests').update({ status }).eq('id', id)
    if (error) { showToast('Failed to update status', 'error'); return }
    setRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: status as PartRequest['status'] } : r))
  }

  const deleteRequest = async (id: string) => {
    const { error } = await supabase.from('part_requests').delete().eq('id', id)
    if (error) { showToast('Failed to delete request', 'error'); return }
    setRequests((prev) => prev.filter((r) => r.id !== id))
    showToast('Request deleted')
  }

  const filtered = useMemo(() => {
    let list = requests
    if (statusFilter !== 'all') list = list.filter((r) => r.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((r) =>
        (r.description ?? '').toLowerCase().includes(q) ||
        (r.part_number ?? '').toLowerCase().includes(q) ||
        (r.notes ?? '').toLowerCase().includes(q) ||
        (r.requested_by ?? '').toLowerCase().includes(q),
      )
    }
    return list
  }, [requests, statusFilter, search])

  const pendingCount = requests.filter((r) => r.status === 'pending').length

  return (
    <div>
      {/* ── Submit a request (visible to everyone) ── */}
      <div className="card" style={{ padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, background: 'var(--brand)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </div>
          <div>
            <h2 style={{ fontSize: 16, marginBottom: 2 }}>Request a part</h2>
            <p style={{ fontSize: 13, color: 'var(--text-2)' }}>Can't find what you need? Submit a request and it'll be reviewed for addition to the catalogue.</p>
          </div>
        </div>

        {submitted ? (
          <div style={{ padding: '14px 16px', background: 'var(--success-bg)', border: '1px solid var(--success)', borderRadius: 'var(--radius-md)', fontSize: 14, color: 'var(--success)', fontWeight: 500, textAlign: 'center' }}>
            ✓ Request submitted — it'll be reviewed and added to the catalogue if approved.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Description
                </label>
                <input
                  className="input"
                  placeholder="e.g. 100A 4P Switch Disconnector"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Part number
                </label>
                <input
                  className="input"
                  style={{ fontFamily: 'var(--mono)' }}
                  placeholder="e.g. LCR1234"
                  value={formPN}
                  onChange={(e) => setFormPN(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Additional notes
              </label>
              <input
                className="input"
                placeholder="Any extra context — category, why it's needed, etc."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Your name (optional)
              </label>
              <input
                className="input"
                placeholder="So we know who to follow up with"
                value={formBy}
                onChange={(e) => setFormBy(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn btn-primary" onClick={submitRequest} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Admin view of all requests ── */}
      {isAdmin && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ fontSize: 15 }}>All requests</h3>
              {pendingCount > 0 && (
                <span style={{ background: 'var(--warning)', color: '#fff', borderRadius: 99, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                  {pendingCount} pending
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['all', 'pending', 'added', 'declined'] as const).map((s) => (
                <button
                  key={s}
                  className="btn btn-sm"
                  style={statusFilter === s ? { background: 'var(--brand)', borderColor: 'var(--brand)', color: '#fff' } : {}}
                  onClick={() => setStatusFilter(s)}
                >
                  {s === 'all' ? `All (${requests.length})` : `${STATUS_LABELS[s]} (${requests.filter((r) => r.status === s).length})`}
                </button>
              ))}
            </div>
          </div>

          <div className="toolbar" style={{ marginBottom: 12 }}>
            <SearchBar value={search} onChange={setSearch} placeholder="Search requests…" />
          </div>

          {loading && <div className="loading"><div className="spinner" /> Loading…</div>}

          {!loading && filtered.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <h3>No requests</h3>
              <p>{statusFilter === 'all' ? 'No part requests yet' : `No ${statusFilter} requests`}</p>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map((req) => {
              const style = STATUS_STYLES[req.status]
              return (
                <div key={req.id} className="card" style={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        {req.description && <span style={{ fontSize: 14, fontWeight: 600 }}>{req.description}</span>}
                        {req.part_number && (
                          <span className="part-number" style={{ fontSize: 12 }}>{req.part_number}</span>
                        )}
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 99, background: style.background, color: style.color, border: `1px solid ${style.border}` }}>
                          {STATUS_LABELS[req.status]}
                        </span>
                      </div>
                      {req.notes && <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 4 }}>{req.notes}</div>}
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {req.requested_by ? `Requested by ${req.requested_by} · ` : ''}{formatDate(req.created_at)}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {req.status !== 'added' && (
                        <button
                          className="btn btn-sm"
                          style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
                          onClick={() => updateStatus(req.id, 'added')}
                        >
                          Mark added
                        </button>
                      )}
                      {req.status !== 'declined' && (
                        <button
                          className="btn btn-sm"
                          style={{ borderColor: 'var(--text-3)', color: 'var(--text-3)' }}
                          onClick={() => updateStatus(req.id, 'declined')}
                        >
                          Decline
                        </button>
                      )}
                      {req.status === 'pending' && (
                        <button className="btn btn-sm" onClick={() => updateStatus(req.id, 'pending')}>
                          Reset
                        </button>
                      )}
                      <button className="btn btn-sm btn-danger" onClick={() => deleteRequest(req.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
