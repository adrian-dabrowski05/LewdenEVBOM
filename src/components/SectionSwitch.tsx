import type { Section } from '../types'
import { SECTION_LIST } from '../utils/sections'

// Picks which section the builder, saved quotes and admin work on.
export default function SectionSwitch({ section, onChange }: { section: Section; onChange: (s: Section) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
      <div role="tablist" aria-label="Quoting section" style={{ display: 'inline-flex', background: 'var(--surface-3)', borderRadius: 99, padding: 3, gap: 2 }}>
        {SECTION_LIST.map((s) => {
          const active = s.key === section
          return (
            <button
              key={s.key}
              role="tab"
              aria-selected={active}
              onClick={() => onChange(s.key)}
              style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 600 : 500, padding: '6px 14px', borderRadius: 99, background: active ? 'var(--brand)' : 'transparent', color: active ? '#fff' : 'var(--text-2)', whiteSpace: 'nowrap' }}
            >
              <span className="hide-mobile">{s.label}</span>
              <span className="show-mobile">{s.shortLabel}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
