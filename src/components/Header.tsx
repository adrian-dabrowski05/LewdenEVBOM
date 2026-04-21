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
  return (
    <header className="header">
      <div className="header-logo">
        <div className="header-logo-mark">L</div>
        <div>
          <div className="header-title">EV BOM Calculator</div>
          <div className="header-sub">Lewden · Pillar quotation tool</div>
        </div>
      </div>

      <nav className="header-nav">
        <button
          className={`header-nav-item ${view === 'builder' ? 'active' : ''}`}
          onClick={() => setView('builder')}
        >
          {activeCount > 0 ? `Quote builder (${activeCount})` : 'Quote builder'}
        </button>
        <button
          className={`header-nav-item ${view === 'quotes' ? 'active' : ''}`}
          onClick={() => setView('quotes')}
        >
          Saved quotes
        </button>
        {isAdmin ? (
          <>
            <button
              className={`header-nav-item ${view === 'admin' ? 'active' : ''}`}
              onClick={() => setView('admin')}
            >
              Admin
            </button>
            <button className="header-nav-item" onClick={onLogout} style={{ marginLeft: 4 }}>
              Sign out
            </button>
          </>
        ) : (
          <button className="header-nav-item" onClick={onAdminNav}>
            Admin
          </button>
        )}
      </nav>
    </header>
  )
}
