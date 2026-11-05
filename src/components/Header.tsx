import type { View } from '../types'

interface Props {
  view: View
  setView: (v: View) => void
  isAdmin: boolean
  onAdminNav: () => void
  onLogout: () => void
  activeCount: number
  stepMode: boolean
  onToggleStepMode: () => void
  subtitle: string   // the section being quoted, e.g. "EV feeder pillars"
}

export default function Header({ view, setView, isAdmin, onAdminNav, onLogout, activeCount, stepMode, onToggleStepMode, subtitle }: Props) {
  const logoSrc = `${(import.meta as any).env.BASE_URL}logo.png`

  return (
    <header className="header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 10, padding: '5px 14px 5px 8px' }}>
        <img
          src={logoSrc}
          alt="Lewden"
          style={{ height: 32, width: 'auto', display: 'block', objectFit: 'contain', flexShrink: 0 }}
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
        <div>
          <div className="header-title">Lewden Quoting Tool</div>
          <div className="header-sub">{subtitle}</div>
        </div>
      </div>

      {/* Switches the quote builder between the full list and the step-by-step page */}
      <button
        onClick={onToggleStepMode}
        title={stepMode ? 'Switch back to the full quote builder' : 'Build the quote section by section'}
        aria-pressed={stepMode}
        style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px 0 8px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', border: `1px solid ${stepMode ? 'var(--secondary)' : 'rgba(255,255,255,0.25)'}`, background: stepMode ? 'rgba(255,204,0,0.15)' : 'rgba(255,255,255,0.08)', color: '#fff' }}
      >
        <span style={{ position: 'relative', width: 30, height: 18, borderRadius: 99, background: stepMode ? 'var(--secondary)' : 'rgba(255,255,255,0.3)', transition: 'background 0.15s', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: 2, left: stepMode ? 14 : 2, width: 14, height: 14, borderRadius: 99, background: '#fff', transition: 'left 0.15s' }} />
        </span>
        <span className="hide-mobile">Step-by-step</span>
        <span className="show-mobile">Steps</span>
      </button>

      <nav className="header-nav" style={{ marginLeft: 8 }}>
        <button className={`header-nav-item ${view === 'builder' ? 'active' : ''}`} onClick={() => setView('builder')}>
          {activeCount > 0 ? `Quote builder (${activeCount})` : 'Quote builder'}
        </button>
        <button className={`header-nav-item ${view === 'quotes' ? 'active' : ''}`} onClick={() => setView('quotes')}>
          Saved quotes
        </button>
        <button className={`header-nav-item ${view === 'requests' ? 'active' : ''}`} onClick={() => setView('requests')}>
          Part requests
        </button>
        {isAdmin ? (
          <>
            <button className={`header-nav-item ${view === 'admin' ? 'active' : ''}`} onClick={() => setView('admin')}>Admin</button>
            <button className="header-nav-item" onClick={onLogout} style={{ marginLeft: 4 }}>Sign out</button>
          </>
        ) : (
          <button className="header-nav-item" onClick={onAdminNav}>Admin</button>
        )}
      </nav>
    </header>
  )
}
