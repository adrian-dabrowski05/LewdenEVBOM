import { supabase } from '../lib/supabase'

// ── Part pictures (TopTer only for now) ───────────────────────
// products.image_url holds either
//   • a path inside the app, e.g. 'parts/topter/fixed-socket-ip44.jpg'
//     (the pictures taken from the Palazzoli catalogue, in public/parts/topter), or
//   • a full web link, e.g. a picture uploaded in Admin to Supabase storage.

export const PICTURE_BUCKET = 'part-pictures'

export function pictureUrl(raw?: string | null): string | null {
  const v = raw?.trim()
  if (!v) return null
  if (/^(https?:)?\/\//i.test(v) || v.startsWith('data:') || v.startsWith('blob:')) return v
  const base = ((import.meta as any).env?.BASE_URL as string | undefined) ?? '/'
  return base.replace(/\/?$/, '/') + v.replace(/^\/+/, '')
}

// Phone photos can be several MB. Shrink to at most 800px on the longest side
// and save as JPEG on a white background before uploading.
async function shrinkImage(file: File, max = 800): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file
  try {
    const src = URL.createObjectURL(file)
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = src
    })
    URL.revokeObjectURL(src)
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
    return blob ?? file
  } catch {
    return file
  }
}

export async function uploadPicture(file: File, folder: string): Promise<{ url?: string; error?: string }> {
  const blob = await shrinkImage(file)
  const ext = blob.type === 'image/jpeg' ? 'jpg' : ((file.name.split('.').pop() || 'img').toLowerCase().replace(/[^a-z0-9]/g, '') || 'img')
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from(PICTURE_BUCKET).upload(path, blob, { contentType: blob.type || file.type || 'image/jpeg', upsert: false })
  if (error) return { error: error.message }
  const { data } = supabase.storage.from(PICTURE_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl }
}

// A starting point for "use this picture on similar parts":
// 'BG06-1B32' → 'BG06-', 'P488124' → 'P488', 'BSRG1123' → 'BSRG112'
export function similarPartsQuery(partNumber?: string | null): string {
  const pn = (partNumber ?? '').trim().toUpperCase()
  if (!pn) return ''
  const dash = pn.indexOf('-')
  if (dash > 0) return pn.slice(0, dash + 1)
  return pn.match(/^[A-Z]+\d{0,3}/)?.[0] ?? pn
}
