import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { Dispatch, SetStateAction, MutableRefObject } from 'react'
import { supabase } from './lib/supabase'
import type {
  Product, ProductVariant, ProductPrerequisite, Quote, Preset,
  View, QuantityMap, VariantSelectionMap, AutoAddedMap, QuoteFormData, AppSettings,
  Extra, BuildContext, ExtraCountMap, ExtraCostMap, QuoteBuild, ProductIncompatibility, Section, TopterDesign,
} from './types'
import { computeExtras, contextFromPreset, contextFromSteelwork, contextFromText, mergeContext, EMPTY_CONTEXT, toQuoteExtras } from './utils/extras'
import { quotePricing } from './utils/pricing'
import { buildIncompatMap } from './utils/compatibility'
import { SECTIONS, SectionContext, sectionOf, sectionInsert } from './utils/sections'
import { EMPTY_DESIGN, readDesign } from './utils/design'

// Extras show in the admin's chosen order; extras never reordered sit by their number
const extraOrder = (e: Extra) => e.sort_order ?? e.number * 10
const sortExtras = (list: Extra[]) => [...list].sort((a, b) => extraOrder(a) - extraOrder(b) || a.number - b.number)
import Header from './components/Header'
import BottomNav from './components/BottomNav'
import QuoteBuilder from './components/QuoteBuilder'
import StepBuilder from './components/StepBuilder'
import TopterStepBuilder from './components/TopterStepBuilder'
import TopterDesigner, { TopterModeSwitch } from './components/TopterDesigner'
import type { TopterMode } from './components/TopterDesigner'
import SectionSwitch from './components/SectionSwitch'
import SavedQuotes from './components/SavedQuotes'
import AdminPanel from './components/AdminPanel'
import AdminLogin from './components/AdminLogin'
import Toast from './components/Toast'
import PartRequests from './components/PartRequests'

// "Prices last reviewed" line at the top of the quote builder, set in Admin > Settings
function PricesReviewed({ date }: { date: string }) {
  if (!date) return null
  const d = new Date(`${date}T00:00:00`)
  const shown = isNaN(d.getTime()) ? date : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-2)', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 99, padding: '4px 12px', marginBottom: 12 }}>
      Prices last reviewed: <strong style={{ color: 'var(--text-1)' }}>{shown}</strong>
    </div>
  )
}

export interface ToastState { message: string; type: 'success' | 'error' }

const DEFAULT_FORM: QuoteFormData = {
  project_name: '', customer_name: '', mo_number: '', notes: '', labour_minutes: '', uplift_pct: '', carriage: '', gp_pct: '', rebate_pct: '',
}

// The saved quote currently loaded into the builder for editing
export interface EditingQuote { id: string; project_name: string }

// Builder state kept separately for each section, so a half-built EV quote is
// still there after looking at TopTer and back. The setter works on whichever
// section is open when it is called, so it never changes and the callbacks that
// use it don't need to know about sections.
function useSectionState<T>(section: Section, sectionRef: MutableRefObject<Section>, initial: () => T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<Record<Section, T>>(() => ({ ev: initial(), topter: initial() }))
  const set = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    const key = sectionRef.current
    setState((prev) => {
      const next = typeof action === 'function' ? (action as (p: T) => T)(prev[key]) : action
      return Object.is(next, prev[key]) ? prev : { ...prev, [key]: next }
    })
  }, [sectionRef])
  return [state[section], set]
}

// Which section was open last time (remembered on this device)
function storedSection(): Section {
  try { return localStorage.getItem('quote_section') === 'topter' ? 'topter' : 'ev' } catch { return 'ev' }
}

export default function App() {
  const [view, setView] = useState<View>('builder')
  const [isAdmin, setIsAdmin] = useState(false)
  const [showAdminLogin, setShowAdminLogin] = useState(false)

  // ── Quoting section ─────────────────────────────────────────
  // EV feeder pillars or TopTer boxes, for everyone.
  const [section, setSection] = useState<Section>(storedSection)
  const activeSection: Section = section
  const cfg = SECTIONS[activeSection]
  const sectionRef = useRef<Section>(activeSection)
  sectionRef.current = activeSection
  const changeSection = (next: Section) => {
    setSection(next)
    try { localStorage.setItem('quote_section', next) } catch { /* private window etc. */ }
  }

  // Everything is loaded once; each section only sees its own rows
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [prerequisites, setPrerequisites] = useState<ProductPrerequisite[]>([])
  const [incompatibilities, setIncompatibilities] = useState<ProductIncompatibility[]>([])
  const [allPresets, setAllPresets] = useState<Preset[]>([])
  const [allExtras, setAllExtras] = useState<Extra[]>([])
  const [allQuotes, setAllQuotes] = useState<Quote[]>([])
  const [quotesLoading, setQuotesLoading] = useState(false)
  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({})

  const products = useMemo(() => allProducts.filter((p) => sectionOf(p) === activeSection), [allProducts, activeSection])
  const presets = useMemo(() => allPresets.filter((p) => sectionOf(p) === activeSection), [allPresets, activeSection])
  const extras = useMemo(() => allExtras.filter((e) => sectionOf(e) === activeSection), [allExtras, activeSection])
  const quotes = useMemo(() => allQuotes.filter((q) => sectionOf(q) === activeSection), [allQuotes, activeSection])

  // Pricing defaults per section. TopTer keys start "topter_"; until they exist
  // TopTer uses the EV uplift and labour rate. EV reads the same keys as always.
  const settings = useMemo<AppSettings>(() => {
    const own = (key: string) => settingsMap[cfg.settingsPrefix + key]
    const withFallback = (key: string) => own(key) ?? settingsMap[key]
    return {
      hardware_uplift_pct: parseFloat(withFallback('hardware_uplift_pct') ?? '5'),
      labour_rate_per_min: parseFloat(withFallback('labour_rate_per_min') ?? '0'),
      prices_reviewed_at: (own('prices_reviewed_at') ?? '').trim(),
    }
  }, [settingsMap, cfg])

  const [quantities, setQuantities] = useSectionState<QuantityMap>(activeSection, sectionRef, () => ({}))
  const [variantSelections, setVariantSelections] = useSectionState<VariantSelectionMap>(activeSection, sectionRef, () => ({}))
  const [autoAdded, setAutoAdded] = useSectionState<AutoAddedMap>(activeSection, sectionRef, () => ({}))
  const [quoteForm, setQuoteForm] = useSectionState<QuoteFormData>(activeSection, sectionRef, () => DEFAULT_FORM)
  const [selectedExtras, setSelectedExtras] = useSectionState<Set<string>>(activeSection, sectionRef, () => new Set())
  const [extraCounts, setExtraCounts] = useSectionState<ExtraCountMap>(activeSection, sectionRef, () => ({}))
  const [extraCosts, setExtraCosts] = useSectionState<ExtraCostMap>(activeSection, sectionRef, () => ({}))
  const [buildContext, setBuildContext] = useSectionState<BuildContext>(activeSection, sectionRef, () => EMPTY_CONTEXT)
  const [editingQuote, setEditingQuote] = useSectionState<EditingQuote | null>(activeSection, sectionRef, () => null)
  const [design, setDesign] = useSectionState<TopterDesign>(activeSection, sectionRef, () => EMPTY_DESIGN)   // TopTer box designer layout

  // Only parts still in the catalogue. A removed part can still be listed in a
  // preset, a prerequisite or an extra (removing a part only hides it, so old
  // quotes keep it). The builders use these lists so a removed part never shows
  // up as "Unknown product" or sneaks into a quote. Admin still sees everything
  // so leftovers can be tidied up there.
  const productIds = useMemo(() => new Set(products.map((p) => p.id)), [products])
  const livePresets = useMemo<Preset[]>(() => presets.map((preset) => ({
    ...preset,
    preset_items: (preset.preset_items ?? []).filter((i) => productIds.has(i.product_id)),
    preset_configurations: (preset.preset_configurations ?? []).map((c) => ({
      ...c,
      preset_configuration_items: (c.preset_configuration_items ?? []).filter((i) => productIds.has(i.product_id)),
    })),
  })), [presets, productIds])
  const livePrerequisites = useMemo(
    () => prerequisites.filter((p) => productIds.has(p.product_id) && productIds.has(p.prerequisite_product_id)),
    [prerequisites, productIds],
  )
  const liveExtras = useMemo<Extra[]>(() => extras.map((e) => ({
    ...e,
    extra_items: (e.extra_items ?? []).filter((i) => productIds.has(i.product_id)),
  })), [extras, productIds])

  // Step-by-step page instead of the full builder (remembered on this device)
  const [stepMode, setStepMode] = useState<boolean>(() => {
    try { return localStorage.getItem('builder_mode') === 'steps' } catch { return false }
  })
  const toggleStepMode = () => {
    const next = !stepMode
    setStepMode(next)
    try { localStorage.setItem('builder_mode', next ? 'steps' : 'full') } catch { /* private window etc. */ }
    setDesignerOn(false)
    setStartAtReview(false)
    setView('builder')
  }

  // TopTer only: the drag-and-drop box designer, a third mode next to the list and steps
  const [designerOn, setDesignerOnState] = useState<boolean>(() => {
    try { return localStorage.getItem('topter_designer') === 'on' } catch { return false }
  })
  const setDesignerOn = (on: boolean) => {
    setDesignerOnState(on)
    try { localStorage.setItem('topter_designer', on ? 'on' : 'off') } catch { /* private window etc. */ }
  }
  const [startAtReview, setStartAtReview] = useState(false)   // designer's "Review & save" opens the step builder's last step
  const topterMode: TopterMode = designerOn ? 'designer' : stepMode ? 'steps' : 'list'
  const changeTopterMode = (mode: TopterMode) => {
    setStartAtReview(false)
    setDesignerOn(mode === 'designer')
    if (mode !== 'designer') {
      const steps = mode === 'steps'
      setStepMode(steps)
      try { localStorage.setItem('builder_mode', steps ? 'steps' : 'full') } catch { /* private window etc. */ }
    }
  }
  const openReview = () => {
    setDesignerOn(false)
    setStepMode(true)
    try { localStorage.setItem('builder_mode', 'steps') } catch { /* private window etc. */ }
    setStartAtReview(true)
    window.scrollTo({ top: 0 })
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
    else setAllProducts(data || [])
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

  // Parts that can't go on the same quote (set per part in Admin > Products)
  useEffect(() => { loadIncompatibilities() }, [])
  const loadIncompatibilities = async () => {
    const { data, error } = await supabase.from('product_incompatibilities').select('*')
    if (!error) setIncompatibilities(data || [])   // table missing = no rules yet
  }
  const incompatMap = useMemo(() => buildIncompatMap(incompatibilities), [incompatibilities])

  useEffect(() => { loadPresets() }, [])
  const loadPresets = async () => {
    const { data, error } = await supabase
      .from('presets')
      .select('*, preset_items(*), preset_configurations(*, preset_configuration_items(*))')
      .order('created_at')
    if (!error) setAllPresets(data || [])
  }

  useEffect(() => { loadExtras() }, [])
  const loadExtras = async () => {
    const { data, error } = await supabase.from('extras').select('*, extra_items(*)').order('number')
    if (!error) setAllExtras(sortExtras(data || []))
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
    // This section's parts in their new order; other sections' parts stay as they are
    setAllProducts((prev) => [...prev.filter((p) => !(p.id in byId)), ...order.map((id) => ({ ...byId[id], sort_order: newOrder[id] }))])

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
    setAllExtras((prev) => [...prev.filter((e) => !(e.id in byId)), ...order.map((id) => ({ ...byId[id], sort_order: newOrder[id] }))])

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
  }, [setSelectedExtras, setExtraCounts])

  const setExtraCount = useCallback((extraId: string, count: number) => {
    setExtraCounts((prev) => ({ ...prev, [extraId]: Math.max(0, count) }))
  }, [setExtraCounts])

  // Cost the rep types in for a rep-priced extra (e.g. non-standard colour)
  const setExtraCost = useCallback((extraId: string, value: string) => {
    setExtraCosts((prev) => ({ ...prev, [extraId]: value }))
  }, [setExtraCosts])

  const clearExtras = useCallback(() => { setSelectedExtras(new Set()); setExtraCounts({}); setExtraCosts({}) }, [setSelectedExtras, setExtraCounts, setExtraCosts])

  // Final BOM = rep's quantities with the ticked extras applied on top
  const extrasResult = useMemo(
    () => computeExtras(liveExtras, selectedExtras, buildContext, quantities, extraCounts, extraCosts),
    [liveExtras, selectedExtras, buildContext, quantities, extraCounts, extraCosts],
  )

  useEffect(() => { loadSettings() }, [])
  const loadSettings = async () => {
    const { data } = await supabase.from('settings').select('*')
    if (data) {
      const map: Record<string, string> = {}
      data.forEach((row) => { map[row.key] = row.value })
      setSettingsMap(map)
    }
  }

  // ── Smart qty setter with prereq auto-add/remove ───────────
  const setQty = useCallback((productId: string, qty: number, prereqsRef?: ProductPrerequisite[]) => {
    const prereqs = prereqsRef ?? livePrerequisites
    setQuantities((prevQtys) => {
      const prevQty = prevQtys[productId] ?? 0
      const newQtys = { ...prevQtys }
      if (qty <= 0) {
        delete newQtys[productId]
        setVariantSelections((vs) => { const v = { ...vs }; delete v[productId]; return v })
      } else {
        newQtys[productId] = qty
        // Picking a cabinet / steelwork part fills in the pillar's rating, material
        // and size from what the part says. Only when it is first added, so a
        // rep's own change to those boxes isn't undone by the + button.
        if (prevQty <= 0) {
          const product = products.find((p) => p.id === productId)
          const found = product ? contextFromSteelwork(product) : {}
          if (Object.keys(found).length > 0) setBuildContext((ctx) => mergeContext(ctx, found))
        }
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
  }, [livePrerequisites, products, setQuantities, setVariantSelections, setBuildContext, setAutoAdded])

  // ── Apply preset (with optional configuration) ─────────────
  const applyPreset = useCallback((preset: Preset, configurationId?: string) => {
    // Apply common items
    const commonItems = preset.preset_items ?? []
    commonItems.forEach((item) => {
      setQty(item.product_id, item.quantity, livePrerequisites)
    })

    // Apply configuration-specific items if a config was selected
    if (configurationId) {
      const config = preset.preset_configurations?.find((c) => c.id === configurationId)
      if (config?.preset_configuration_items) {
        config.preset_configuration_items.forEach((item) => {
          setQty(item.product_id, item.quantity, livePrerequisites)
        })
      }
    }

    // The preset name gives the rating, size and material; anything it doesn't
    // give (e.g. a size 4 pillar) is read from the steelwork parts in the preset
    const config = configurationId ? preset.preset_configurations?.find((c) => c.id === configurationId) : null
    const presetIds = new Set([...(preset.preset_items ?? []), ...(config?.preset_configuration_items ?? [])].map((i) => i.product_id))
    const fromSteel = products
      .filter((p) => presetIds.has(p.id))
      .reduce<BuildContext>((ctx, p) => mergeContext(ctx, contextFromSteelwork(p)), EMPTY_CONTEXT)
    // (EV only: TopTer has no pillar rating, cabinet or size)
    if (cfg.usesBuildContext) setBuildContext(mergeContext(fromSteel, contextFromPreset(preset, configurationId)))

    if (preset.default_labour_minutes != null) {
      setQuoteForm((prev) => ({ ...prev, labour_minutes: String(preset.default_labour_minutes) }))
    }
    showToast(`Preset "${preset.name}" applied`)
  }, [livePrerequisites, products, setQty, showToast, cfg, setBuildContext, setQuoteForm])

  const loadQuotes = useCallback(async () => {
    setQuotesLoading(true)
    const { data, error } = await supabase.from('quotes').select('*, quote_items(*)').order('created_at', { ascending: false })
    if (error) showToast('Failed to load quotes', 'error')
    else setAllQuotes(data || [])
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
    setExtraCosts({})
    setBuildContext(EMPTY_CONTEXT)
    setEditingQuote(null)
    setDesign(EMPTY_DESIGN)
  }, [setQuantities, setVariantSelections, setAutoAdded, setQuoteForm, setSelectedExtras, setExtraCounts, setExtraCosts, setBuildContext, setEditingQuote, setDesign])

  // Anything on the quote worth clearing: parts, extras, any quote detail
  // (customer, reference, labour, uplift, carriage, GP, rebate), the EV
  // rating/material/size dropdowns or a designer layout
  const quoteHasContent = Object.keys(quantities).length > 0 || selectedExtras.size > 0
    || Object.values(quoteForm).some((v) => String(v ?? '').trim() !== '')
    || JSON.stringify(buildContext) !== JSON.stringify(EMPTY_CONTEXT)
    || design.rows.length > 0

  // The Clear button in every builder: the whole quote goes back to this
  // section's defaults. Uplift and labour rate fall back to the Admin settings
  // because their boxes are left empty. When editing a saved quote this also
  // stops editing; the saved quote itself is not changed.
  const clearQuote = () => {
    if (!quoteHasContent) return
    const msg = 'Clear the whole quote? Parts, extras, labour, hardware uplift, carriage and all quote details go back to the defaults.'
      + (editingQuote ? `\n\nThis also stops editing "${editingQuote.project_name}". The saved quote is not changed.` : '')
    if (confirm(msg)) resetBuilder()
  }

  // Clearing the quote in the list or step builder also empties the designer
  useEffect(() => {
    if (design.rows.length > 0 && Object.keys(quantities).length === 0) setDesign(EMPTY_DESIGN)
  }, [design, quantities, setDesign])

  // asNew: when editing, save a copy instead of overwriting the original
  const saveQuote = async (formData: QuoteFormData, asNew = false): Promise<boolean> => {
    const finalQty = extrasResult.effectiveQty
    const activeItems = products.filter((p) => (finalQty[p.id] ?? 0) > 0)
    if (activeItems.length === 0) { showToast('Add at least one item before saving', 'error'); return false }

    const materialsSubtotal = activeItems.reduce((sum, p) => sum + (p.factory_cost != null ? p.factory_cost * (finalQty[p.id] ?? 0) : 0), 0)
    + extrasResult.repHardwareCost   // rep-entered extra costs that count as hardware
    const upliftPct = formData.uplift_pct.trim() === '' ? settings.hardware_uplift_pct : (parseFloat(formData.uplift_pct) || 0)
    const hardwareUpliftAmount = materialsSubtotal * upliftPct / 100
    const labourMinutes = (parseFloat(formData.labour_minutes) || 0) + extrasResult.labourMinutes
    const quoteExtras = toQuoteExtras(extrasResult.applied)
    const labourRate = settings.labour_rate_per_min
    const labourTotal = labourMinutes * labourRate
    const carriage = Math.max(0, parseFloat(formData.carriage) || 0)
    // Rep-entered extra costs (e.g. non-standard colour) go on at face value, after uplift and labour
    const factoryCost = materialsSubtotal + hardwareUpliftAmount + labourTotal + extrasResult.repCost
    // Carriage: no profit or rebate on it, added after the rebate
    const pricing = quotePricing(factoryCost, formData.gp_pct, formData.rebate_pct, carriage)
    const build: QuoteBuild = {
      base_quantities: quantities,
      variant_selections: variantSelections,
      auto_added: autoAdded,
      selected_extras: Array.from(selectedExtras),
      extra_counts: extraCounts,
      extra_costs: extraCosts,
      build_context: buildContext,
      labour_minutes: formData.labour_minutes,
      // TopTer: the designer's boxes, so editing the quote brings the layout back
      ...(cfg.key === 'topter' && design.rows.length > 0 ? { design } : {}),
    }

    const quoteRow = {
      project_name: formData.project_name.trim(),
      customer_name: formData.customer_name.trim() || null,
      mo_number: formData.mo_number.trim() || null,
      notes: formData.notes.trim() || null,
      grand_total: factoryCost + carriage,   // factory cost + carriage, as before (the app shows factory cost = this - carriage)
      gross_profit_pct: pricing.gpPct,
      quote_price: pricing.quotePrice,
      rebate_pct: pricing.rebatePct,
      total_quote: pricing.totalQuote,
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
      : await supabase.from('quotes').insert({ ...quoteRow, ...sectionInsert(cfg), status: 'draft' }).select().single()

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
    setExtraCosts(build?.extra_costs ?? {})
    setBuildContext(build?.build_context ?? EMPTY_CONTEXT)
    setDesign(readDesign(build?.design))
    setQuoteForm({
      project_name: quote.project_name,
      customer_name: quote.customer_name ?? '',
      mo_number: quote.mo_number ?? '',
      notes: quote.notes ?? '',
      labour_minutes: build ? build.labour_minutes : (Number(quote.labour_minutes) ? String(quote.labour_minutes) : ''),
      uplift_pct: Number(quote.hardware_uplift_pct) === settings.hardware_uplift_pct ? '' : String(quote.hardware_uplift_pct),
      carriage: Number(quote.carriage) ? String(quote.carriage) : '',
      gp_pct: Number(quote.gross_profit_pct) ? String(quote.gross_profit_pct) : '',
      rebate_pct: Number(quote.rebate_pct) ? String(quote.rebate_pct) : '',
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
    else setAllQuotes((prev) => prev.map((q) => q.id === quoteId ? { ...q, status: status as Quote['status'] } : q))
  }

  const deleteQuote = async (quoteId: string) => {
    const { error } = await supabase.from('quotes').delete().eq('id', quoteId)
    if (error) showToast('Failed to delete quote', 'error')
    else {
      setAllQuotes((prev) => prev.filter((q) => q.id !== quoteId))
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
    // A steelwork variant that names a size / material / rating (e.g. "Stainless")
    // fills in that box too
    const product = products.find((p) => p.id === productId)
    const variant = variants.find((v) => v.id === variantId)
    if (product?.category === 'Steelworks' && variant) {
      const found = contextFromText(`${variant.label} ${variant.part_number_suffix ?? ''}`)
      if (Object.keys(found).length > 0) setBuildContext((ctx) => mergeContext(ctx, found))
    }
  }, [products, variants, setVariantSelections, setBuildContext])

  const activeCount = Object.entries(extrasResult.effectiveQty).filter(([id, q]) => q > 0 && productIds.has(id)).length

  return (
    <SectionContext.Provider value={cfg}>
      <Header view={view} setView={setView} isAdmin={isAdmin} onAdminNav={handleAdminNav} onLogout={handleLogout} activeCount={activeCount} stepMode={stepMode} onToggleStepMode={toggleStepMode} subtitle={cfg.subtitle} />
      <main className="main">
        {view !== 'requests' && <SectionSwitch section={activeSection} onChange={changeSection} />}
        {view === 'builder' && activeSection === 'topter' && !productsLoading && products.length === 0 && (
          <div className="card" style={{ padding: '12px 16px', marginBottom: 14, fontSize: 13, color: 'var(--text-2)', borderColor: 'var(--warning)' }}>
            No TopTer parts yet. Run <strong>supabase/topter-section.sql</strong> in the Supabase SQL Editor, then reload this page.
          </div>
        )}
        {view === 'builder' && <PricesReviewed date={settings.prices_reviewed_at} />}
        {view === 'builder' && activeSection === 'topter' && <TopterModeSwitch mode={topterMode} onChange={changeTopterMode} />}
        {view === 'builder' && (() => {
          const builderProps = {
            products,
            loading: productsLoading,
            variants,
            prerequisites: livePrerequisites,
            incompatMap,
            autoAdded,
            quantities,
            setQty,
            variantSelections,
            setVariantSelection,
            quoteForm,
            setQuoteForm,
            onSave: saveQuote,
            showToast,
            presets: livePresets,
            onApplyPreset: applyPreset,
            settings,
            extras: liveExtras,
            selectedExtras,
            onToggleExtra: toggleExtra,
            onSetExtraCount: setExtraCount,
            extraCosts,
            onSetExtraCost: setExtraCost,
            onClearExtras: clearExtras,
            onClearQuote: clearQuote,
            canClear: quoteHasContent,
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
          if (activeSection === 'topter' && designerOn) {
            return (
              <TopterDesigner
                products={products} loading={productsLoading}
                quantities={quantities} setQty={setQty}
                design={design} setDesign={setDesign}
                quoteForm={quoteForm} settings={settings} extrasResult={extrasResult}
                showToast={showToast} editingQuote={editingQuote} onCancelEdit={cancelEdit}
                onClearQuote={clearQuote} canClear={quoteHasContent}
                onReview={openReview}
              />
            )
          }
          if (!stepMode) return <QuoteBuilder key={activeSection} {...builderProps} />
          return activeSection === 'topter' ? <TopterStepBuilder {...builderProps} startAtReview={startAtReview} /> : <StepBuilder {...builderProps} />
        })()}
        {view === 'quotes' && (
          <SavedQuotes quotes={quotes} loading={quotesLoading} onUpdateStatus={updateQuoteStatus} onDelete={deleteQuote} onEdit={editQuote} isAdmin={isAdmin} />
        )}
        {view === 'admin' && isAdmin && (
          <AdminPanel
            key={activeSection}
            products={products} presets={presets} settings={settings}
            variants={variants} prerequisites={prerequisites}
            onRefreshProducts={loadProducts} onRefreshPresets={loadPresets}
            onRefreshSettings={loadSettings} onRefreshVariants={loadVariants}
            onRefreshPrerequisites={loadPrerequisites}
            incompatibilities={incompatibilities} onRefreshIncompatibilities={loadIncompatibilities}
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
    </SectionContext.Provider>
  )
}
