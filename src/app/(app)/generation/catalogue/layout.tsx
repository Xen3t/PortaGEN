import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'

/** « Générer depuis le catalogue » suit la règle du Catalogue : réservé aux
 *  ADMINS (demande Mathias 21/08/2026). */
export default async function GenerationCatalogueLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getSessionUser()
  if (!user || user.role !== 'admin') redirect('/')
  return children
}
