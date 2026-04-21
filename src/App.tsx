import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase'
import type { Product, Quote, Preset, View, QuantityMap, QuoteFormData, AppSettings } from './types'
import Header from './components/Header'
import BottomNav from './components/BottomNav'
import QuoteBuilder from './components/QuoteBuilder'
import SavedQuotes from './components/SavedQuotes'
import AdminPanel from './components/AdminPanel'
import AdminLogin from './components/AdminLogin'
import Toast from './components/Toast'

export interface ToastState { message: string; type: 'success' | 'error' }

const DEFAULT_FORM: QuoteFormData = {
  project_name: '', customer_name: '', notes: '',
  labour_minutes: '', labour_rate_per_min: '',
}

export default function App() {
  const [view, setView] = useState<View>('builder')
  const [isAdmin, setIsAdmin] = useState(false)
  const [showAdminLogin, setShowAdminLogin] = useState(false)

  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [presets, setPresets] = useState<Preset[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [quotesLoading, setQuotesLoading] = useState(false)
  const [settings, setSettings] = useState<AppSettings>({ hardware_uplift_pct: 5 })

  const [quantities, setQuantities] = useState<QuantityMap>({})
  const [quoteForm, setQuoteForm] = useState<QuoteFormData>(DEFAULT_FORM)

  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // ── Load products ──────────────────────────────────────────
  useEffect(() => { loadProducts() }, [])
  const loadProducts = async () => {
    setProductsLoading(true)
    const { data, error } = await supabase.from('products').select('*').eq('is_active', true).order('sort_order')
    if (error) showToast('Failed to load products', 'error')
    else setProducts(data || [])
    setProductsLoading(false)
  }

  // ── Load presets ───────────────────────────────────────────
  useEffect(() => { loadPresets() }, [])
  const loadPresets = async () => {
    const { data, error } = await supabase.from('presets').select('*, preset_items(*)').order('created_at')
    if (!error) setPresets(data || [])
  }

  // ── Load settings ──────────────────────────────────────────
  useEffect(() => { loadSettings() }, [])
  const loadSettings = async () => {
    const { data } = await supabase.from('settings').select('*')
    if (data) {
      const map: Record<string, string> = {}
      data.forEach((row) => { map[row.key] = row.value })
      setSettings({ hardware_uplift_pct: parseFloat(map['hardware_uplift_pct'] ?? '5') })
    }
  }

  // ── Apply preset ───────────────────────────────────────────
  const applyPreset = useCallback((preset: Preset) => {
    if (!preset.preset_items?.length) return
    setQuantities((prev) => {
      const next = { ...prev }
      preset.preset_items!.forEach((item) => {
        next[item.product_id] = (next[item.product_id] ?? 0) + item.quantity
      })
      return next
    })
    // Fill labour defaults if set
    if (preset.default_labour_minutes != null || preset.default_labour_rate_per_min != null) {
      setQuoteForm((prev) => ({
        ...prev,
        labour_minutes: preset.default_labour_minutes != null ? String(preset.default_labour_minutes) : prev.labour_minutes,
        labour_rate_per_min: preset.default_labour_rate_per_min != null ? String(preset.default_labour_rate_per_min) : prev.labour_rate_per_min,
      }))
    }
    showToast(`Preset "${preset.name}" applied`)
  }, [showToast])

  // ── Load quotes ────────────────────────────────────────────
  const loadQuotes = useCallback(async () => {
    setQuotesLoading(true)
    const { data, error } = await supabase.from('quotes').select('*, quote_items(*)').order('created_at', { ascending: false })
    if (error) showToast('Failed to load quotes', 'error')
    else setQuotes(data || [])
    setQuotesLoading(false)
  }, [showToast])

  useEffect(() => { if (view === 'quotes') loadQuotes() }, [view, loadQuotes])

  // ── Save quote ─────────────────────────────────────────────
  const saveQuote = async (formData: QuoteFormData): Promise<boolean> => {
    const activeItems = products.filter((p) => (quantities[p.id] ?? 0) > 0)
    if (activeItems.length === 0) { showToast('Add at least one item before saving', 'error'); return false }

    const materialsSubtotal = activeItems.reduce((sum, p) => sum + (p.factory_cost != null ? p.factory_cost * (quantities[p.id] ?? 0) : 0), 0)
    const upliftPct = settings.hardware_uplift_pct
    const hardwareUpliftAmount = materialsSubtotal * upliftPct / 100
    const labourMinutes = parseFloat(formData.labour_minutes) || 0
    const labourRate = parseFloat(formData.labour_rate_per_min) || 0
    const labourTotal = labourMinutes * labourRate
    const grandTotal = materialsSubtotal + hardwareUpliftAmount + labourTotal

    const { data: quoteData, error: quoteError } = await supabase.from('quotes').insert({
      project_name: formData.project_name.trim(),
      customer_name: formData.customer_name.trim() || null,
      notes: formData.notes.trim() || null,
      grand_total: grandTotal,
      materials_subtotal: materialsSubtotal,
      hardware_uplift_pct: upliftPct,
      hardware_uplift_amount: hardwareUpliftAmount,
      labour_minutes: labourMinutes,
      labour_rate_per_min: labourRate,
      labour_total: labourTotal,
      status: 'draft',
    }).select().single()

    if (quoteError || !quoteData) { showToast('Failed to save quote', 'error'); return false }

    const itemsToInsert = activeItems.map((p) => ({
      quote_id: quoteData.id,
      product_id: p.id,
      description: p.description,
      part_number: p.part_number,
      factory_cost: p.factory_cost,
      quantity: quantities[p.id],
      line_total: p.factory_cost != null ? p.factory_cost * quantities[p.id] : null,
    }))

    const { error: itemsError } = await supabase.from('quote_items').insert(itemsToInsert)
    if (itemsError) { showToast('Quote saved but items failed to save', 'error'); return false }

    showToast('Quote saved successfully')
    setQuantities({})
    setQuoteForm(DEFAULT_FORM)
    return true
  }

  // ── Update quote status ────────────────────────────────────
  const updateQuoteStatus = async (quoteId: string, status: string) => {
    const { error } = await supabase.from('quotes').update({ status }).eq('id', quoteId)
    if (error) showToast('Failed to update status', 'error')
    else setQuotes((prev) => prev.map((q) => q.id === quoteId ? { ...q, status: status as Quote['status'] } : q))
  }

  // ── Delete quote ───────────────────────────────────────────
  const deleteQuote = async (quoteId: string) => {
    const { error } = await supabase.from('quotes').delete().eq('id', quoteId)
    if (error) showToast('Failed to delete quote', 'error')
    else { setQuotes((prev) => prev.filter((q) => q.id !== quoteId)); showToast('Quote deleted') }
  }

  // ── Admin auth ─────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setIsAdmin(!!session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAdmin(!!session)
      if (session) setShowAdminLogin(false)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const handleAdminNav = () => { isAdmin ? setView('admin') : setShowAdminLogin(true) }
  const handleLogout = async () => { await supabase.auth.signOut(); setIsAdmin(false); setView('builder'); showToast('Signed out') }

  // ── Qty helpers ────────────────────────────────────────────
  const setQty = useCallback((productId: string, qty: number) => {
    setQuantities((prev) => {
      if (qty <= 0) { const next = { ...prev }; delete next[productId]; return next }
      return { ...prev, [productId]: qty }
    })
  }, [])

  const activeCount = Object.values(quantities).filter((q) => q > 0).length

  return (
    <>
      <Header view={view} setView={setView} isAdmin={isAdmin} onAdminNav={handleAdminNav} onLogout={handleLogout} activeCount={activeCount} />

      <main className="main">
        {view === 'builder' && (
          <QuoteBuilder
            products={products} loading={productsLoading}
            quantities={quantities} setQty={setQty}
            quoteForm={quoteForm} setQuoteForm={setQuoteForm}
            onSave={saveQuote} showToast={showToast}
            presets={presets} onApplyPreset={applyPreset}
            settings={settings}
          />
        )}
        {view === 'quotes' && (
          <SavedQuotes quotes={quotes} loading={quotesLoading} onUpdateStatus={updateQuoteStatus} onDelete={deleteQuote} isAdmin={isAdmin} />
        )}
        {view === 'admin' && isAdmin && (
          <AdminPanel products={products} presets={presets} settings={settings}
            onRefreshProducts={loadProducts} onRefreshPresets={loadPresets} onRefreshSettings={loadSettings}
            showToast={showToast} />
        )}
      </main>

      <BottomNav view={view} setView={setView} isAdmin={isAdmin} onAdminNav={handleAdminNav} activeCount={activeCount} />
      {showAdminLogin && <AdminLogin onClose={() => setShowAdminLogin(false)} showToast={showToast} />}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </>
  )
}
