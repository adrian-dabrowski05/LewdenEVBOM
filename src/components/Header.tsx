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
  const logoSrc = `${import.meta.env.BASE_URL}logo.png`

  return (
    <header className="header">
      <div className="header-logo">
        <div className="header-logo-mark">
          <img
            src={logoSrc}
            alt="Lewden"
            style={{ height: 36, width: 'auto', display: 'block' }}
            onError={(e) => {
              const img = e.currentTarget
              img.style.display = 'none'
              const fallback = img.nextElementSibling as HTMLElement
              if (fallback) fallback.style.display = 'flex'
            }}
          />
          <span style={{ display: 'none', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', fontWeight: 700, fontSize: 14, color: 'var(--secondary-text)' }}>L</span>
        </div>
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
