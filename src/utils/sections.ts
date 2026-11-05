import { createContext, useContext } from 'react'
import type { Category, Section } from '../types'
import { CATEGORIES, TOPTER_CATEGORIES } from '../types'

// ── Quoting sections ──────────────────────────────────────────
// The app quotes more than one kind of product. Each section has its own parts,
// presets, extras, saved quotes and pricing defaults. EV feeder pillars is the
// original section and works exactly as before; TopTer is admin-only for now.

export interface SectionConfig {
  key: Section
  label: string               // shown on the section switch
  shortLabel: string          // shown on small screens
  subtitle: string            // under the app name in the header
  categories: Category[]      // order of the category lists
  defaultCategory: Category   // category picked when adding a part in Admin
  settingsPrefix: string      // settings keys, e.g. 'topter_hardware_uplift_pct'
  quoteTitle: string          // PDF heading
  toolName: string            // PDF footer
  usesBuildContext: boolean   // EV only: current rating / cabinet / size decide which extras apply
  usesCapacity: boolean       // TopTer only: boards provide socket and DIN space, parts use it
  usesPictures: boolean       // TopTer only: a picture next to each part (products.image_url)
}

export const SECTIONS: Record<Section, SectionConfig> = {
  ev: {
    key: 'ev',
    label: 'EV feeder pillars',
    shortLabel: 'EV',
    subtitle: 'EV feeder pillars',
    categories: CATEGORIES,
    defaultCategory: 'Outgoing',
    settingsPrefix: '',
    quoteTitle: 'EV Pillar Quotation',
    toolName: 'EV Pillar Quotation Tool',
    usesBuildContext: true,
    usesCapacity: false,
    usesPictures: false,
  },
  topter: {
    key: 'topter',
    label: 'TopTer boxes',
    shortLabel: 'TopTer',
    subtitle: 'TopTer boxes',
    categories: TOPTER_CATEGORIES,
    defaultCategory: 'Fixed sockets',
    settingsPrefix: 'topter_',
    quoteTitle: 'TopTer Quotation',
    toolName: 'TopTer Quotation Tool',
    usesBuildContext: false,
    usesCapacity: true,
    usesPictures: true,
  },
}

export const SECTION_LIST: SectionConfig[] = [SECTIONS.ev, SECTIONS.topter]

// Rows saved before sections existed have no section: they are EV
export function sectionOf(row: { section?: string | null } | null | undefined): Section {
  return row?.section === 'topter' ? 'topter' : 'ev'
}

// Extra fields for an insert. EV rows rely on the database default ('ev'),
// so EV saves are exactly what they were before sections existed.
export function sectionInsert(cfg: SectionConfig): { section?: Section } {
  return cfg.key === 'ev' ? {} : { section: cfg.key }
}

export const SectionContext = createContext<SectionConfig>(SECTIONS.ev)
export const useSectionConfig = () => useContext(SectionContext)
