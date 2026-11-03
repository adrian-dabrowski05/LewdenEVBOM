import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from './lib/supabase'
import type {
  Product, ProductVariant, ProductPrerequisite, Quote, Preset,
  View, QuantityMap, VariantSelectionMap, AutoAddedMap, QuoteFormData, AppSettings,
  Extra, BuildContext, QuoteExtra, ExtraCountMap, QuoteBuild,
} from './types'
import { computeExtras, contextFromPreset, EMPTY_CONTEXT } from './utils/extras'

// Extras show in the admin's chosen order; extras never reordered sit by their number
const extraOrder = (e: Extra) => e.sort_order ?? e.number * 10
const sortExtras = (list: Extra[]) => [...list].sort((a, b) => extraOrder(a) - extraOrder(b) || a.number - b.number)
import Header from './components/Header'
import BottomNav from './components/BottomNav'
import QuoteBuilder from './components/QuoteBuilder'
import StepBuilder from './components/StepBuilder'
import SavedQuotes from './components/SavedQuotes'
import AdminPanel from './components/AdminPanel'
import AdminLogin from './components/AdminLogin'
import Toast from './components/Toast'
import PartRequests from './components/PartRequests'

export interface ToastState { message: string; type: 'success' | 'error' }

const DEFAULT_FORM: QuoteFormData = {
  project_name: '', customer_name: '', mo_number: '', notes: '', labour_minutes: '', uplift_pct: '', carriage: '',
}

// The saved quote currently loaded into the builder for editing
export interface EditingQuote { id: string; project_name: string }

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
  const [editingQuote, setEditingQuote] = useState<EditingQuote | null>(null)

  // Step-by-step page instead of the full builder (remembered on this device)
  const [stepMode, setStepMode] = useState<boolean>(() => {
    try { return localStorage.getItem('builder_mode') === 'steps' } catch { return false }
  })
  const toggleStepMode = () => {
    const next = !stepMode
    setStepMode(next)
    try { localStorage.setItem('builder_mode', next ? 'steps' : 'full') } catch { /* private window etc. */ }
    setView('builder')
  }

  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }, [])

  useEffect(() => { loadProducts() }, [])
  const loadProducts = async () => {
    setProductsLoading(true)
    const { data, error } = await supabase.from('products').select('*').eq('is_active', true).order('sort_order').order('created_at').order('id')
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
    if (!error) setExtras(sortExtras(data || []))
  }

  // ── Admin: reorder parts and extras (saved for everyone) ───
  // groupIds is the list as the admin sees it (a category, a step or a group).
  // The part swaps places with its neighbour in that list.
  const [reordering, setReordering] = useState(false)

  const moveProduct = useCallback(async (productId: string, groupIds: string[], dir: -1 | 1) => {
    const i = groupIds.indexOf(productId)
    const j = i + dir
    if (reordering || i < 0 || j < 0 || j >= groupIds.length) return
    const order = products.map((p) => p.id)
    const a = order.indexOf(productId)
    const b = order.indexOf(groupIds[j])
    if (a < 0 || b < 0) return
    ;[order[a], order[b]] = [order[b], order[a]]

    // If every part already has its own number, swapping the two numbers is enough.
    // Otherwise (e.g. all 0 to begin with) number the whole list 10, 20, 30…
    const strictlyIncreasing = products.every((p, k) => k === 0 || p.sort_order > products[k - 1].sort_order)
    const newOrder: Record<string, number> = {}
    if (strictlyIncreasing) {
      products.forEach((p) => { newOrder[p.id] = p.sort_order })
      newOrder[order[a]] = products[a].sort_order
      newOrder[order[b]] = products[b].sort_order
    } else {
      order.forEach((id, k) => { newOrder[id] = (k + 1) * 10 })
    }

    const byId = Object.fromEntries(products.map((p) => [p.id, p]))
    const changed = products.filter((p) => p.sort_order !== newOrder[p.id])
    setProducts(order.map((id) => ({ ...byId[id], sort_order: newOrder[id] })))

    setReordering(true)
    const results = await Promise.all(changed.map((p) => supabase.from('products').update({ sort_order: newOrder[p.id] }).eq('id', p.id)))
    setReordering(false)
    const failed = results.find((r) => r.error)
    if (failed) { showToast(`Could not save the new order: ${failed.error?.message}`, 'error'); loadProducts() }
  }, [products, reordering, showToast])

  const moveExtra = useCallback(async (extraId: string, groupIds: string[], dir: -1 | 1) => {
    const i = groupIds.indexOf(extraId)
    const j = i + dir
    if (reordering || i < 0 || j < 0 || j >= groupIds.length) return
    const order = extras.map((e) => e.id)
    const a = order.indexOf(extraId)
    const b = order.indexOf(groupIds[j])
    if (a < 0 || b < 0) return
    ;[order[a], order[b]] = [order[b], order[a]]
    // Extras are few, so just number them all 10, 20, 30…
    const newOrder: Record<string, number> = {}
    order.forEach((id, k) => { newOrder[id] = (k + 1) * 10 })
    const byId = Object.fromEntries(extras.map((e) => [e.id, e]))
    const changed = extras.filter((e) => e.sort_order !== newOrder[e.id])
    setExtras(order.map((id) => ({ ...byId[id], sort_order: newOrder[id] })))

    setReordering(true)
    const results = await Promise.all(changed.map((e) => supabase.from('extras').update({ sort_order: newOrder[e.id] }).eq('id', e.id)))
    setReordering(false)
    const failed = results.find((r) => r.error)
    if (failed) {
      const msg = failed.error?.message ?? ''
      showToast(/sort_order/.test(msg) ? 'Run supabase/extras-sort-order.sql in Supabase first' : `Could not save the new order: ${msg}`, 'error')
      loadExtras()
    }
  }, [extras, reordering, showToast])

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

  const resetBuilder = useCallback(() => {
    setQuantities({})
    setVariantSelections({})
    setAutoAdded({})
    setQuoteForm(DEFAULT_FORM)
    setSelectedExtras(new Set())
    setExtraCounts({})
    setBuildContext(EMPTY_CONTEXT)
    setEditingQuote(null)
  }, [])

  // asNew: when editing, save a copy instead of overwriting the original
  const saveQuote = async (formData: QuoteFormData, asNew = false): Promise<boolean> => {
    const finalQty = extrasResult.effectiveQty
    const activeItems = products.filter((p) => (finalQty[p.id] ?? 0) > 0)
    if (activeItems.length === 0) { showToast('Add at least one item before saving', 'error'); return false }

    const materialsSubtotal = activeItems.reduce((sum, p) => sum + (p.factory_cost != null ? p.factory_cost * (finalQty[p.id] ?? 0) : 0), 0)
    const upliftPct = formData.uplift_pct.trim() === '' ? settings.hardware_uplift_pct : (parseFloat(formData.uplift_pct) || 0)
    const hardwareUpliftAmount = materialsSubtotal * upliftPct / 100
    const labourMinutes = (parseFloat(formData.labour_minutes) || 0) + extrasResult.labourMinutes
    const quoteExtras: QuoteExtra[] = extrasResult.applied.map(({ extra, count }) => ({ number: extra.number, name: extra.name, labour_minutes: Number(extra.labour_minutes) || 0, ...(extra.scales_with_bom ? { count } : {}) }))
    const labourRate = settings.labour_rate_per_min
    const labourTotal = labourMinutes * labourRate
    const carriage = Math.max(0, parseFloat(formData.carriage) || 0)
    // Carriage goes on at face value, after uplift and labour
    const grandTotal = materialsSubtotal + hardwareUpliftAmount + labourTotal + carriage
    const build: QuoteBuild = {
      base_quantities: quantities,
      variant_selections: variantSelections,
      auto_added: autoAdded,
      selected_extras: Array.from(selectedExtras),
      extra_counts: extraCounts,
      build_context: buildContext,
      labour_minutes: formData.labour_minutes,
    }

    const quoteRow = {
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
      carriage,
      extras: quoteExtras,
      build,
    }

    const updating = editingQuote != null && !asNew
    const { data: quoteData, error: quoteError } = updating
      ? await supabase.from('quotes').update(quoteRow).eq('id', editingQuote.id).select().single()
      : await supabase.from('quotes').insert({ ...quoteRow, status: 'draft' }).select().single()

    if (quoteError || !quoteData) {
      console.error('Saving quote failed', quoteError)
      showToast(`${updating ? 'Failed to update quote' : 'Failed to save quote'}${quoteError ? `: ${quoteError.message}` : ''}`, 'error')
      return false
    }

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

    // Note the old lines before adding the new ones, so only those get removed afterwards
    let oldItemIds: string[] = []
    if (updating) {
      const { data: oldItems } = await supabase.from('quote_items').select('id').eq('quote_id', quoteData.id)
      oldItemIds = (oldItems ?? []).map((i) => i.id)
    }

    const { error: itemsError } = await supabase.from('quote_items').insert(itemsToInsert)
    if (itemsError) {
      console.error('Saving quote items failed', itemsError)
      showToast(`${updating ? 'Quote updated but items failed to save — the old items were kept' : 'Quote saved but items failed to save'}: ${itemsError.message}`, 'error')
      return false
    }

    // New lines are in, so the old ones can go (if this fails the quote still has its old lines too)
    if (oldItemIds.length > 0) {
      const { error: deleteError } = await supabase.from('quote_items').delete().in('id', oldItemIds)
      if (deleteError) {
        console.error('Removing old quote items failed', deleteError)
        showToast(`Quote updated but old items could not be removed: ${deleteError.message}`, 'error')
        return false
      }
    }

    showToast(updating ? 'Quote updated' : 'Quote saved successfully')
    resetBuilder()
    return true
  }

  // Put a saved quote back into the builder
  const editQuote = (quote: Quote) => {
    const hasWork = Object.keys(quantities).length > 0 || selectedExtras.size > 0
    if (hasWork && editingQuote?.id !== quote.id && !confirm('Replace what is in the builder with this quote?')) return

    const productIds = new Set(products.map((p) => p.id))
    const extraIds = new Set(extras.map((e) => e.id))
    const build = quote.build
    let missing = 0
    let extrasFolded = false

    let base: QuantityMap = {}
    let selections: VariantSelectionMap = {}
    if (build) {
      Object.entries(build.base_quantities ?? {}).forEach(([id, qty]) => { if (productIds.has(id)) base[id] = qty; else missing++ })
      Object.entries(build.variant_selections ?? {}).forEach(([id, v]) => { if (base[id]) selections[id] = v })
    } else {
      // Saved before quotes kept their build: quote_items are the final quantities,
      // so load them as they are, with any extras already folded in as normal parts
      ;(quote.quote_items ?? []).forEach((item) => {
        if (!item.product_id || !productIds.has(item.product_id)) { missing++; return }
        base[item.product_id] = (base[item.product_id] ?? 0) + Number(item.quantity)
        if (item.variant_id) selections[item.product_id] = item.variant_id
      })
      extrasFolded = (quote.extras ?? []).length > 0
    }

    setQuantities(base)
    setVariantSelections(selections)
    setAutoAdded(build?.auto_added ?? {})
    setSelectedExtras(new Set((build?.selected_extras ?? []).filter((id) => extraIds.has(id))))
    setExtraCounts(build?.extra_counts ?? {})
    setBuildContext(build?.build_context ?? EMPTY_CONTEXT)
    setQuoteForm({
      project_name: quote.project_name,
      customer_name: quote.customer_name ?? '',
      mo_number: quote.mo_number ?? '',
      notes: quote.notes ?? '',
      labour_minutes: build ? build.labour_minutes : (Number(quote.labour_minutes) ? String(quote.labour_minutes) : ''),
      uplift_pct: Number(quote.hardware_uplift_pct) === settings.hardware_uplift_pct ? '' : String(quote.hardware_uplift_pct),
      carriage: Number(quote.carriage) ? String(quote.carriage) : '',
    })
    setEditingQuote({ id: quote.id, project_name: quote.project_name })
    setView('builder')

    if (missing > 0) showToast(`${missing} item${missing !== 1 ? 's are' : ' is'} no longer in the catalogue and ${missing !== 1 ? 'were' : 'was'} left out`, 'error')
    else if (extrasFolded) showToast('Older quote: extras are loaded as normal parts, so they are not ticked', 'error')
    else showToast(`Editing "${quote.project_name}"`)
  }

  const cancelEdit = () => {
    if (!confirm('Stop editing? Unsaved changes will be lost.')) return
    resetBuilder()
  }

  const updateQuoteStatus = async (quoteId: string, status: string) => {
    const { error } = await supabase.from('quotes').update({ status }).eq('id', quoteId)
    if (error) showToast('Failed to update status', 'error')
    else setQuotes((prev) => prev.map((q) => q.id === quoteId ? { ...q, status: status as Quote['status'] } : q))
  }

  const deleteQuote = async (quoteId: string) => {
    const { error } = await supabase.from('quotes').delete().eq('id', quoteId)
    if (error) showToast('Failed to delete quote', 'error')
    else {
      setQuotes((prev) => prev.filter((q) => q.id !== quoteId))
      // Nothing left to update, so a save from the builder becomes a new quote
      if (editingQuote?.id === quoteId) setEditingQuote(null)
      showToast('Quote deleted')
    }
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
      <Header view={view} setView={setView} isAdmin={isAdmin} onAdminNav={handleAdminNav} onLogout={handleLogout} activeCount={activeCount} stepMode={stepMode} onToggleStepMode={toggleStepMode} />
      <main className="main">
        {view === 'builder' && (() => {
          const builderProps = {
            products,
            loading: productsLoading,
            variants,
            prerequisites,
            autoAdded,
            quantities,
            setQty,
            variantSelections,
            setVariantSelection,
            quoteForm,
            setQuoteForm,
            onSave: saveQuote,
            showToast,
            presets,
            onApplyPreset: applyPreset,
            settings,
            extras,
            selectedExtras,
            onToggleExtra: toggleExtra,
            onSetExtraCount: setExtraCount,
            onClearExtras: clearExtras,
            extrasResult,
            buildContext,
            setBuildContext,
            editingQuote,
            onCancelEdit: cancelEdit,
            isAdmin,
            onMoveProduct: moveProduct,
            onMoveExtra: moveExtra,
            reordering,
          }
          return stepMode ? <StepBuilder {...builderProps} /> : <QuoteBuilder {...builderProps} />
        })()}
        {view === 'quotes' && (
          <SavedQuotes quotes={quotes} loading={quotesLoading} onUpdateStatus={updateQuoteStatus} onDelete={deleteQuote} onEdit={editQuote} isAdmin={isAdmin} />
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
