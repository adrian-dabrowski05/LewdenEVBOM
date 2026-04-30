import type { View } from '../types'

interface Props {
  view: View
  setView: (v: View) => void
  isAdmin: boolean
  onAdminNav: () => void
  onLogout: () => void
  activeCount: number
}

export default function Header({ view, setView, isAdmin, onAdminNav, onLogout, activeCount }: Props) {
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
          <div className="header-title">EV BOM Calculator</div>
          <div className="header-sub">Lewden · Pillar quotation tool</div>
        </div>
      </div>

      <nav className="header-nav">
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
