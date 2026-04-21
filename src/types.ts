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

export interface Quote {
  id: string
  project_name: string
  customer_name: string | null
  notes: string | null
  grand_total: number
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
}

export type View = 'builder' | 'quotes' | 'admin'

export interface QuantityMap {
  [productId: string]: number
}

export interface QuoteFormData {
  project_name: string
  customer_name: string
  notes: string
}
