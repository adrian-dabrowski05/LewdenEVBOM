import type { View } from '../types'

interface Props {
  view: View
  setView: (v: View) => void
  isAdmin: boolean
  onAdminNav: () => void
  activeCount: number
}

const IconBuilder = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
)
const IconQuotes = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" />
  </svg>
)
const IconRequests = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
  </svg>
)
const IconAdmin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 1 0-16 0" />
  </svg>
)

export default function BottomNav({ view, setView, isAdmin, onAdminNav, activeCount }: Props) {
  return (
    <nav className="bottom-nav show-mobile">
      <button className={`bottom-nav-item ${view === 'builder' ? 'active' : ''}`} onClick={() => setView('builder')}>
        <IconBuilder />
        {activeCount > 0 ? `Builder (${activeCount})` : 'Builder'}
      </button>
      <button className={`bottom-nav-item ${view === 'quotes' ? 'active' : ''}`} onClick={() => setView('quotes')}>
        <IconQuotes />
        Quotes
      </button>
      <button className={`bottom-nav-item ${view === 'requests' ? 'active' : ''}`} onClick={() => setView('requests')}>
        <IconRequests />
        Requests
      </button>
      <button className={`bottom-nav-item ${view === 'admin' ? 'active' : ''}`} onClick={isAdmin ? () => setView('admin') : onAdminNav}>
        <IconAdmin />
        Admin
      </button>
    </nav>
  )
}
