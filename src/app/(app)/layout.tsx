import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { getUserBrand } from '@/lib/brands'
import { touchRunner } from '@/lib/server/runner'
import BrandSwitch from './BrandSwitch'
import FeedbackButton from './FeedbackButton'
import MainNav from './MainNav'
import NotificationBell from './NotificationBell'
import PageTransition from './PageTransition'
import UserMenu from './UserMenu'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  touchRunner() // reprise des jobs interrompus dès qu'une page est ouverte
  const brand = getUserBrand(user.id)

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-border shadow-sm px-6 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-6">
          <BrandSwitch initialBrand={brand} />
          <MainNav isAdmin={user.role === 'admin'} />
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell />
          <UserMenu username={user.username} isAdmin={user.role === 'admin'} />
        </div>
      </header>
      <main className="w-full max-w-7xl mx-auto px-6 py-8 flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
      {/* Pied de page signature HoorTRADE — même style que HoorTRADS. */}
      <footer className="flex items-center justify-between px-8 py-3 text-[11px] text-text-disabled border-t border-border/50">
        <span>© 2026 - HOORTRADE</span>
        <span>PortaGEN V2</span>
      </footer>
      <FeedbackButton />
    </div>
  )
}
