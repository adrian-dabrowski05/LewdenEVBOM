import { useEffect, useState, type ReactNode } from 'react'
import type { Product } from '../types'
import { useSectionConfig } from '../utils/sections'
import { pictureUrl } from '../utils/pictures'

// Pictures next to parts. Only sections with usesPictures (TopTer) show them, so
// EV feeder pillars look exactly as before.

export function usePicture(product: Product): string | null {
  const cfg = useSectionConfig()
  return cfg.usesPictures ? pictureUrl(product.image_url) : null
}

// A small square picture. Tap it to see a bigger one.
export function PartThumb({ product, size = 48 }: { product: Product; size?: number }) {
  const url = usePicture(product)
  const [open, setOpen] = useState(false)
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [url])
  if (!url || broken) return null
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        aria-label={`Show a bigger picture of ${product.description}`}
        title="Tap for a bigger picture"
        style={{ width: size, height: size, flexShrink: 0, padding: 2, border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', background: '#fff', cursor: 'zoom-in', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
      >
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
      </button>
      {open && <PictureViewer url={url} product={product} onClose={() => setOpen(false)} />}
    </>
  )
}

// Puts the picture to the left of the part's details. With no picture to show,
// the details are rendered exactly as they would be without this wrapper.
export function WithPicture({ product, size = 48, children }: { product: Product; size?: number; children: ReactNode }) {
  const url = usePicture(product)
  if (!url) return <>{children}</>
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
      <PartThumb product={product} size={size} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

export function PictureViewer({ url, product, onClose }: { url: string; product: Product; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Catalogue pictures are small, so show them at most 1.6× their own size to keep them sharp
  const [width, setWidth] = useState<number | null>(null)
  return (
    <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); onClose() }} role="dialog" aria-modal="true" aria-label={product.description}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-handle" />
        <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, minHeight: 200 }}>
          <img
            src={url}
            alt={product.description}
            onLoad={(e) => setWidth(Math.min(360, Math.round(e.currentTarget.naturalWidth * 1.6)))}
            style={{ width: width ?? undefined, maxWidth: '100%', maxHeight: '55dvh', objectFit: 'contain', display: 'block' }}
          />
        </div>
        <div style={{ marginTop: 12, fontSize: 14, fontWeight: 600 }}>{product.description}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 6 }}>
          {product.part_number ? <span className="part-number">{product.part_number}</span> : <span />}
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
