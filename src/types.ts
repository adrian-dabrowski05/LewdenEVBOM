export type Category =
  | 'Steelworks'
  | 'Accessories'
  | 'Incomers'
  | 'Distribution'
  | 'PEN Fault Protection'
  | 'Outgoing'
  | 'Ancillary Equipment'
  | 'Extras'

export const CATEGORIES: Category[] = [
  'Steelworks',
  'Accessories',
  'Incomers',
  'Distribution',
  'PEN Fault Protection',
  'Outgoing',
  'Ancillary Equipment',
  'Extras',
]

// Products in this category are only added to a quote through an Extra
export const EXTRAS_CATEGORY: Category = 'Extras'

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined'

export interface Product {
  id: string
  category: Category
  description: string
  part_number: string | null
  factory_cost: number | null
  notes: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ProductVariant {
  id: string
  product_id: string
  label: string
  part_number_suffix: string | null
  sort_order: number
  created_at: string
}

export interface ProductPrerequisite {
  id: string
  product_id: string
  prerequisite_product_id: string
  quantity: number
  note: string | null
  sort_order: number
  created_at: string
}

// Two parts that can't go on the same quote. Works both ways.
export interface ProductIncompatibility {
  id: string
  product_id: string
  incompatible_product_id: string
  created_at: string
}

export interface Quote {
  id: string
  project_name: string
  customer_name: string | null
  mo_number: string | null
  notes: string | null
  grand_total: number   // shown as "Factory cost" (column name kept so old quotes still work)
  gross_profit_pct?: number | null
  quote_price?: number | null   // factory cost + gross profit
  rebate_pct?: number | null
  total_quote?: number | null   // quote price - rebate
  materials_subtotal: number
  hardware_uplift_pct: number
  hardware_uplift_amount: number
  labour_minutes: number
  labour_rate_per_min: number
  labour_total: number
  carriage?: number | null   // charged at face value, added after uplift and labour
  status: QuoteStatus
  extras?: QuoteExtra[] | null
  build?: QuoteBuild | null
  created_at: string
  updated_at: string
  quote_items?: QuoteItem[]
}

export interface QuoteItem {
  id: string
  quote_id: string
  product_id: string | null
  description: string
  part_number: string | null
  factory_cost: number | null
  quantity: number
  line_total: number | null
  variant_id: string | null
  variant_label: string | null
}

export interface PresetConfigurationItem {
  id: string
  configuration_id: string
  product_id: string
  quantity: number
}

export interface PresetConfiguration {
  id: string
  preset_id: string
  label: string
  part_number_suffix: string | null
  sort_order: number
  created_at: string
  preset_configuration_items?: PresetConfigurationItem[]
}

export interface Preset {
  id: string
  name: string
  description: string | null
  default_labour_minutes: number | null
  default_labour_rate_per_min: number | null
  created_at: string
  updated_at: string
  preset_items?: PresetItem[]
  preset_configurations?: PresetConfiguration[]
}

export interface PresetItem {
  id: string
  preset_id: string
  product_id: string
  quantity: number
}

export type View = 'builder' | 'quotes' | 'admin' | 'requests'

export interface QuantityMap {
  [productId: string]: number
}

export interface VariantSelectionMap {
  [productId: string]: string
}

export interface AutoAddedMap {
  [prereqProductId: string]: {
    [parentProductId: string]: number
  }
}

export interface QuoteFormData {
  project_name: string
  customer_name: string
  mo_number: string
  notes: string
  labour_minutes: string
  uplift_pct: string   // blank = use the admin default
  carriage: string     // £, no uplift or labour on it; blank = none
  gp_pct: string       // gross profit % (margin) on the factory cost; blank = 0
  rebate_pct: string   // rebate % off the quote price; blank = 0
}

export interface AppSettings {
  hardware_uplift_pct: number
  labour_rate_per_min: number
  prices_reviewed_at: string   // date the admin last reviewed prices (YYYY-MM-DD), blank = not set
}

// ── Extras ─────────────────────────────────────────────────────
export type CabinetMaterial = 'mild_steel' | 'stainless'

export interface ExtraItem {
  id: string
  extra_id: string
  product_id: string
  action: 'add' | 'remove'
  quantity: number
  condition_rating: number | null
  condition_size: number | null
  only_if_removed: boolean
  if_removed_product_id: string | null   // add only if this extra removed this product
  sort_order: number
  created_at: string
}

export interface Extra {
  id: string
  number: number
  name: string
  description: string | null
  is_enabled: boolean
  labour_minutes: number
  allowed_ratings: number[] | null
  allowed_materials: CabinetMaterial[] | null
  scales_with_bom: boolean   // rep picks how many times it applies, e.g. how many RCDs to swap
  rep_priced?: boolean       // rep types in a cost (e.g. non-standard colour), added at face value
  rep_cost_uplift?: boolean  // that cost counts as hardware: it goes in materials and gets the hardware uplift
  sort_order?: number | null // order in the builders, set by the admin (falls back to number)
  created_at: string
  updated_at: string
  extra_items?: ExtraItem[]
}

export interface QuoteExtra {
  number: number
  name: string
  labour_minutes: number
  count?: number
  cost?: number   // rep-entered cost (rep-priced extras only), at face value
  cost_in_materials?: boolean   // that cost is in the materials subtotal (got the uplift), so not listed again
}

// How many times the rep wants each "scales with BOM" extra applied (missing = as many as possible)
export interface ExtraCountMap {
  [extraId: string]: number
}

// Cost the rep typed in for each rep-priced extra, in £ (kept as typed, blank = none)
export interface ExtraCostMap {
  [extraId: string]: string
}

// What the pillar is, used to decide which extras (and which extra lines) apply
export interface BuildContext {
  rating: number | null
  material: CabinetMaterial | null
  size: number | null
}

// Everything needed to put a saved quote back into the builder. quote_items only
// holds the final quantities after extras, so the rep's own quantities and the
// ticked extras are kept here too.
export interface QuoteBuild {
  base_quantities: QuantityMap
  variant_selections: VariantSelectionMap
  auto_added: AutoAddedMap
  selected_extras: string[]   // extra ids
  extra_counts: ExtraCountMap
  extra_costs?: ExtraCostMap  // rep-entered costs of rep-priced extras
  build_context: BuildContext
  labour_minutes: string      // rep's minutes, before extras labour
}
