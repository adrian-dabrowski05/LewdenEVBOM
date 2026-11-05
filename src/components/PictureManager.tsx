import { useMemo, useRef, useState } from 'react'
import type { Product } from '../types'
import { supabase } from '../lib/supabase'
import { useSectionConfig } from '../utils/sections'
import { pictureUrl, similarPartsQuery, uploadPicture } from '../utils/pictures'

type ShowToast = (msg: string, type?: 'success' | 'error') => void

const SQL_HINT = 'Run supabase/topter-pictures.sql in Supabase first'

function explain(message: string): string {
  if (/image_url|bucket|row-level security|not found/i.test(message)) return SQL_HINT
  return `Could not save: ${message}`
}

// Admin: add, change or remove the picture shown next to a part, and copy it to
// similar parts (for example every MCB in the same range).
export default function PictureManager({ product, products, onRefresh, showToast }: {
  product: Product; products: Product[]; onRefresh: () => void; showToast: ShowToast
}) {
  const cfg = useSectionConfig()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')
  const [query, setQuery] = useState(() => similarPartsQuery(product.part_number))
  const [onlyEmpty, setOnlyEmpty] = useState(true)
  const current = product.image_url?.trim() || null
  const currentUrl = pictureUrl(current)

  const setPicture = async (value: string | null, okMessage: string) => {
    setBusy(true)
    const { error } = await supabase.from('products').update({ image_url: value }).eq('id', product.id)
    setBusy(false)
    if (error) { showToast(explain(error.message), 'error'); return false }
    showToast(okMessage); onRefresh()
    return true
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { showToast('Pick a picture file (JPG, PNG or WebP)', 'error'); return }
    setBusy(true)
    const { url, error } = await uploadPicture(file, cfg.key)
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
    if (error || !url) { showToast(explain(error ?? 'upload failed'), 'error'); return }
    await setPicture(url, 'Picture uploaded')
  }

  const saveLink = async () => {
    const v = link.trim()
    if (!/^https?:\/\/\S+$/i.test(v)) { showToast('Paste a full link starting with https://', 'error'); return }
    if (await setPicture(v, 'Picture saved')) setLink('')
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return products.filter((p) => p.id !== product.id
      && ((p.part_number ?? '').toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
      && (!onlyEmpty || !p.image_url?.trim())
      && p.image_url?.trim() !== current)
  }, [products, product.id, query, onlyEmpty, current])

  const copyToMatches = async () => {
    if (!current || matches.length === 0) return
    if (!window.confirm(`Use this picture on ${matches.length} other part${matches.length === 1 ? '' : 's'}?`)) return
    setBusy(true)
    const { error } = await supabase.from('products').update({ image_url: current }).in('id', matches.map((m) => m.id))
    setBusy(false)
    if (error) { showToast(explain(error.message), 'error'); return }
    showToast(`Picture added to ${matches.length} part${matches.length === 1 ? '' : 's'}`); onRefresh()
  }

  const label = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--info)' } as const

  return (
    <div style={{ padding: '12px 14px', background: 'var(--info-bg)', border: '1px solid var(--info)', borderRadius: 'var(--radius-md)', marginTop: 8 }}>
      <div style={{ ...label, marginBottom: 10 }}>Picture</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ width: 120, height: 120, flexShrink: 0, background: '#fff', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {currentUrl
            ? <img src={currentUrl} alt={product.description} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <span style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', padding: 8 }}>No picture yet</span>}
        </div>
        <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
            <button className="btn btn-sm btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? 'Saving…' : current ? 'Upload a new picture' : 'Upload a picture'}</button>
            {current && <button className="btn btn-sm btn-danger" onClick={() => setPicture(null, 'Picture removed')} disabled={busy}>Remove picture</button>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input input-sm" style={{ flex: '1 1 180px', minWidth: 0 }} placeholder="…or paste a picture link (https://…)" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveLink() }} />
            <button className="btn btn-sm" onClick={saveLink} disabled={busy || !link.trim()}>Use link</button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--info)', opacity: 0.9 }}>
            Uploads are shrunk to 800px and stored in Supabase. On a phone, Upload lets you take a photo.
          </p>
        </div>
      </div>

      {current && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-strong)' }}>
          <div style={{ ...label, marginBottom: 6 }}>Use this picture on similar parts</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="input input-sm" style={{ flex: '1 1 160px', minWidth: 0, maxWidth: 260, fontFamily: 'var(--mono)' }} placeholder="Part number or words" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find similar parts" />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
              <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} /> Only parts with no picture
            </label>
            <button className="btn btn-sm" onClick={copyToMatches} disabled={busy || matches.length === 0}>
              {matches.length === 0 ? 'No matching parts' : `Use on ${matches.length} part${matches.length === 1 ? '' : 's'}`}
            </button>
          </div>
          {matches.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
              {matches.slice(0, 6).map((m) => m.part_number || m.description).join(', ')}{matches.length > 6 ? ` and ${matches.length - 6} more` : ''}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
