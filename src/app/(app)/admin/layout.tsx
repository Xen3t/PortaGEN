import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'

/** Tout /admin est réservé au rôle admin. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user || user.role !== 'admin') redirect('/')
  return <>{children}</>
}
