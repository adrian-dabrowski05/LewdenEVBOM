import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from './lib/supabase'
import type {
  Product, ProductVariant, ProductPrerequisite, Quote, Preset,
  View, QuantityMap, VariantSelectionMap, AutoAddedMap, QuoteFormData, AppSettings,
  Extra, BuildContext, QuoteExtra, ExtraCountMap,
} from './types'
import { computeExtras, contextFromPreset, EMPTY_CONTEXT } from './utils/extras'
import Header from './components/Header'
import BottomNav from './components/BottomNav'
import QuoteBuilder from './components/QuoteBuilder'
import SavedQuotes from './components/SavedQuotes'
import AdminPanel from './components/AdminPanel'
import AdminLogin from './components/AdminLogin'
import Toast from './components/Toast'
import PartRequests from './components/PartRequests'

export interface ToastState { message: string; type: 'success' | 'error' }

const DEFAULT_FORM: QuoteFormData = {
  project_name: '', customer_name: '', mo_number: '', notes: '', labour_minutes: '',
}

export default function App() {
  const [view, setView] = useState<View>('builder')
  const [isAdmin, setIsAdmin] = useState(false)
  const [showAdminLogin, setShowAdminLogin] = useState(false)

  const [products, setProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [prerequisites, setPrerequisites] = useState<ProductPrerequisite[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [extras, setExtras] = useState<Extra[]>([])
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [quotesLoading, setQuotesLoading] = useState(false)
  const [settings, setSettings] = useState<AppSettings>({ hardware_uplift_pct: 5, labour_rate_per_min: 0 })

  const [quantities, setQuantities] = useState<QuantityMap>({})
  const [variantSelections, setVariantSelections] = useState<VariantSelectionMap>({})
  const [autoAdded, setAutoAdded] = useState<AutoAddedMap>({})
  const [quoteForm, setQuoteForm] = useState<QuoteFormData>(DEFAULT_FORM)
  const [selectedExtras, setSelectedExtras] = useState<Set<string>>(new Set())
  const [extraCounts, setExtraCounts] = useState<ExtraCountMap>({})
  const [buildContext, setBuildContext] = useState<BuildContext>(EMPTY_CONTEXT)

  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  useEffect(() => { loadProducts() }, [])
  const loadProducts = async () => {
    setProductsLoading(true)
    const { data, error } = await supabase.from('products').select('*').eq('is_active', true).order('sort_order')
    if (error) showToast('Failed to load products', 'error')
    else setProducts(data || [])
    setProductsLoading(false)
  }

  useEffect(() => { loadVariants() }, [])
  const loadVariants = async () => {
    const { data } = await supabase.from('product_variants').select('*').order('sort_order')
    if (data) setVariants(data)
  }

  useEffect(() => { loadPrerequisites() }, [])
  const loadPrerequisites = async () => {
    const { data } = await supabase.from('product_prerequisites').select('*').order('sort_order')
    if (data) setPrerequisites(data)
  }

  useEffect(() => { loadPresets() }, [])
  const loadPresets = async () => {
    const { data, error } = await supabase
      .from('presets')
      .select('*, preset_items(*), preset_configurations(*, preset_configuration_items(*))')
      .order('created_at')
    if (!error) setPresets(data || [])
  }

  useEffect(() => { loadExtras() }, [])
  const loadExtras = async () => {
    const { data, error } = await supabase.from('extras').select('*, extra_items(*)').order('number')
    if (!error) setExtras(data || [])
  }

  const toggleExtra = useCallback((extraId: string) => {
    setSelectedExtras((prev) => { const next = new Set(prev); next.has(extraId) ? next.delete(extraId) : next.add(extraId); return next })
    // Re-ticking starts again from "replace all"
    setExtraCounts((prev) => { const next = { ...prev }; delete next[extraId]; return next })
  }, [])

  const setExtraCount = useCallback((extraId: string, count: number) => {
    setExtraCounts((prev) => ({ ...prev, [extraId]: Math.max(0, count) }))
  }, [])

  const clearExtras = useCallback(() => { setSelectedExtras(new Set()); setExtraCounts({}) }, [])

  // Final BOM = rep's quantities with the ticked extras applied on top
  const extrasResult = useMemo(
    () => computeExtras(extras, selectedExtras, buildContext, quantities, extraCounts),
    [extras, selectedExtras, buildContext, quantities, extraCounts],
  )

  useEffect(() => { loadSettings() }, [])
  const loadSettings = async () => {
    const { data } = await supabase.from('settings').select('*')
    if (data) {
      const map: Record<string, string> = {}
      data.forEach((row) => { map[row.key] = row.value })
      setSettings({
        hardware_uplift_pct: parseFloat(map['hardware_uplift_pct'] ?? '5'),
        labour_rate_per_min: parseFloat(map['labour_rate_per_min'] ?? '0'),
      })
    }
  }

  // ── Smart qty setter with prereq auto-add/remove ───────────
  const setQty = useCallback((productId: string, qty: number, prereqsRef?: ProductPrerequisite[]) => {
    const prereqs = prereqsRef ?? prerequisites
    setQuantities((prevQtys) => {
      const prevQty = prevQtys[productId] ?? 0
      const newQtys = { ...prevQtys }
      if (qty <= 0) {
        delete newQtys[productId]
        setVariantSelections((vs) => { const v = { ...vs }; delete v[productId]; return v })
      } else {
        newQtys[productId] = qty
      }
      const productPrereqs = prereqs.filter((p) => p.product_id === productId)
      if (productPrereqs.length === 0) return newQtys
      setAutoAdded((prevAuto) => {
        const newAuto = { ...prevAuto }
        if (qty <= 0 && prevQty > 0) {
          productPrereqs.forEach((prereq) => {
            const autoEntry = newAuto[prereq.prerequisite_product_id]
            if (autoEntry && autoEntry[productId] != null) {
              const wasAutoAdded = autoEntry[productId]
              const newAutoEntry = { ...autoEntry }
              delete newAutoEntry[productId]
              if (Object.keys(newAutoEntry).length === 0) delete newAuto[prereq.prerequisite_product_id]
              else newAuto[prereq.prerequisite_product_id] = newAutoEntry
              const currentPrereqQty = newQtys[prereq.prerequisite_product_id] ?? 0
              const reduced = currentPrereqQty - wasAutoAdded
              if (reduced <= 0) delete newQtys[prereq.prerequisite_product_id]
              else newQtys[prereq.prerequisite_product_id] = reduced
            }
          })
        } else if (qty > 0 && prevQty <= 0) {
          productPrereqs.forEach((prereq) => {
            const addQty = prereq.quantity
            newQtys[prereq.prerequisite_product_id] = (newQtys[prereq.prerequisite_product_id] ?? 0) + addQty
            if (!newAuto[prereq.prerequisite_product_id]) newAuto[prereq.prerequisite_product_id] = {}
            newAuto[prereq.prerequisite_product_id][productId] = addQty
          })
        }
        return newAuto
      })
      return newQtys
    })
  }, [prerequisites])

  // ── Apply preset (with optional configuration) ─────────────
  const applyPreset = useCallback((preset: Preset, configurationId?: string) => {
    // Apply common items
    const commonItems = preset.preset_items ?? []
    commonItems.forEach((item) => {
      setQty(item.product_id, item.quantity, prerequisites)
    })

    // Apply configuration-specific items if a config was selected
    if (configurationId) {
      const config = preset.preset_configurations?.find((c) => c.id === configurationId)
      if (config?.preset_configuration_items) {
        config.preset_configuration_items.forEach((item) => {
          setQty(item.product_id, item.quantity, prerequisites)
        })
      }
    }

    setBuildContext(contextFromPreset(preset, configurationId))

    if (preset.default_labour_minutes != null) {
      setQuoteForm((prev) => ({ ...prev, labour_minutes: String(preset.default_labour_minutes) }))
    }
    showToast(`Preset "${preset.name}" applied`)
  }, [prerequisites, setQty, showToast])

  const loadQuotes = useCallback(async () => {
    setQuotesLoading(true)
    const { data, error } = await supabase.from('quotes').select('*, quote_items(*)').order('created_at', { ascending: false })
    if (error) showToast('Failed to load quotes', 'error')
    else setQuotes(data || [])
    setQuotesLoading(false)
  }, [showToast])

  useEffect(() => { if (view === 'quotes') loadQuotes() }, [view, loadQuotes])

  const saveQuote = async (formData: QuoteFormData): Promise<boolean> => {
    const finalQty = extrasResult.effectiveQty
    const activeItems = products.filter((p) => (finalQty[p.id] ?? 0) > 0)
    if (activeItems.length === 0) { showToast('Add at least one item before saving', 'error'); return false }

    const materialsSubtotal = activeItems.reduce((sum, p) => sum + (p.factory_cost != null ? p.factory_cost * (finalQty[p.id] ?? 0) : 0), 0)
    const upliftPct = settings.hardware_uplift_pct
    const hardwareUpliftAmount = materialsSubtotal * upliftPct / 100
    const labourMinutes = (parseFloat(formData.labour_minutes) || 0) + extrasResult.labourMinutes
    const quoteExtras: QuoteExtra[] = extrasResult.applied.map(({ extra, count }) => ({ number: extra.number, name: extra.name, labour_minutes: Number(extra.labour_minutes) || 0, ...(extra.scales_with_bom ? { count } : {}) }))
    const labourRate = settings.labour_rate_per_min
    const labourTotal = labourMinutes * labourRate
    const grandTotal = materialsSubtotal + hardwareUpliftAmount + labourTotal

    const { data: quoteData, error: quoteError } = await supabase.from('quotes').insert({
      project_name: formData.project_name.trim(),
      customer_name: formData.customer_name.trim() || null,
      mo_number: formData.mo_number.trim() || null,
      notes: formData.notes.trim() || null,
      grand_total: grandTotal,
      materials_subtotal: materialsSubtotal,
      hardware_uplift_pct: upliftPct,
      hardware_uplift_amount: hardwareUpliftAmount,
      labour_minutes: labourMinutes,
      labour_rate_per_min: labourRate,
      labour_total: labourTotal,
      extras: quoteExtras,
      status: 'draft',
    }).select().single()

    if (quoteError || !quoteData) { showToast('Failed to save quote', 'error'); return false }

    const itemsToInsert = activeItems.map((p) => {
      const selectedVariantId = variantSelections[p.id] ?? null
      const selectedVariant = selectedVariantId ? variants.find((v) => v.id === selectedVariantId) : null
      return {
        quote_id: quoteData.id,
        product_id: p.id,
        description: p.description,
        part_number: p.part_number,
        factory_cost: p.factory_cost,
        quantity: finalQty[p.id],
        line_total: p.factory_cost != null ? p.factory_cost * finalQty[p.id] : null,
        variant_id: selectedVariantId,
        variant_label: selectedVariant?.label ?? null,
      }
    })

    const { error: itemsError } = await supabase.from('quote_items').insert(itemsToInsert)
    if (itemsError) { showToast('Quote saved but items failed to save', 'error'); return false }

    showToast('Quote saved successfully')
    setQuantities({})
    setVariantSelections({})
    setAutoAdded({})
    setQuoteForm(DEFAULT_FORM)
    setSelectedExtras(new Set())
    setExtraCounts({})
    setBuildContext(EMPTY_CONTEXT)
    return true
  }

  const updateQuoteStatus = async (quoteId: string, status: string) => {
    const { error } = await supabase.from('quotes').update({ status }).eq('id', quoteId)
    if (error) showToast('Failed to update status', 'error')
    else setQuotes((prev) => prev.map((q) => q.id === quoteId ? { ...q, status: status as Quote['status'] } : q))
  }

  const deleteQuote = async (quoteId: string) => {
    const { error } = await supabase.from('quotes').delete().eq('id', quoteId)
    if (error) showToast('Failed to delete quote', 'error')
    else { setQuotes((prev) => prev.filter((q) => q.id !== quoteId)); showToast('Quote deleted') }
  }

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

  const setVariantSelection = useCallback((productId: string, variantId: string) => {
    setVariantSelections((prev) => ({ ...prev, [productId]: variantId }))
  }, [])

  const activeCount = Object.values(extrasResult.effectiveQty).filter((q) => q > 0).length

  return (
    <>
      <Header view={view} setView={setView} isAdmin={isAdmin} onAdminNav={handleAdminNav} onLogout={handleLogout} activeCount={activeCount} />
      <main className="main">
        {view === 'builder' && (
          <QuoteBuilder
            products={products} loading={productsLoading}
            variants={variants} prerequisites={prerequisites} autoAdded={autoAdded}
            quantities={quantities} setQty={setQty}
            variantSelections={variantSelections} setVariantSelection={setVariantSelection}
            quoteForm={quoteForm} setQuoteForm={setQuoteForm}
            onSave={saveQuote} showToast={showToast}
            presets={presets} onApplyPreset={applyPreset}
            settings={settings}
            extras={extras} selectedExtras={selectedExtras} onToggleExtra={toggleExtra} onSetExtraCount={setExtraCount} onClearExtras={clearExtras}
            extrasResult={extrasResult} buildContext={buildContext} setBuildContext={setBuildContext}
          />
        )}
        {view === 'quotes' && (
          <SavedQuotes quotes={quotes} loading={quotesLoading} onUpdateStatus={updateQuoteStatus} onDelete={deleteQuote} isAdmin={isAdmin} />
        )}
        {view === 'admin' && isAdmin && (
          <AdminPanel
            products={products} presets={presets} settings={settings}
            variants={variants} prerequisites={prerequisites}
            onRefreshProducts={loadProducts} onRefreshPresets={loadPresets}
            onRefreshSettings={loadSettings} onRefreshVariants={loadVariants}
            onRefreshPrerequisites={loadPrerequisites}
            extras={extras} onRefreshExtras={loadExtras}
            showToast={showToast}
          />
        )}
        {view === 'requests' && (
          <PartRequests isAdmin={isAdmin} showToast={showToast} />
        )}
      </main>
      <BottomNav view={view} setView={setView} isAdmin={isAdmin} onAdminNav={handleAdminNav} activeCount={activeCount} />
      {showAdminLogin && <AdminLogin onClose={() => setShowAdminLogin(false)} showToast={showToast} />}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </>
  )
}
