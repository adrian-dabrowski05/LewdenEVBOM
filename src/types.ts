export type Category =
  | 'Steelworks'
  | 'Accessories'
  | 'Incomers'
  | 'Distribution'
  | 'PEN Fault Protection'
  | 'Outgoing'
  | 'Ancillary Equipment'

export const CATEGORIES: Category[] = [
  'Steelworks',
  'Accessories',
  'Incomers',
  'Distribution',
  'PEN Fault Protection',
  'Outgoing',
  'Ancillary Equipment',
]

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

export interface Quote {
  id: string
  project_name: string
  customer_name: string | null
  mo_number: string | null
  notes: string | null
  grand_total: number
  materials_subtotal: number
  hardware_uplift_pct: number
  hardware_uplift_amount: number
  labour_minutes: number
  labour_rate_per_min: number
  labour_total: number
  status: QuoteStatus
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

export interface Preset {
  id: string
  name: string
  description: string | null
  default_labour_minutes: number | null
  default_labour_rate_per_min: number | null
  created_at: string
  updated_at: string
  preset_items?: PresetItem[]
}

export interface PresetItem {
  id: string
  preset_id: string
  product_id: string
  quantity: number
}

export type View = 'builder' | 'quotes' | 'admin'

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
}

export interface AppSettings {
  hardware_uplift_pct: number
  labour_rate_per_min: number
}
