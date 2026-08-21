import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'

/** Le Catalogue est réservé aux ADMINS (demande Mathias 21/08/2026) : les
 *  utilisateurs travaillent depuis « Générer » (MES Contrainte). Les routes
 *  /api/catalogue/* sont verrouillées de la même façon. */
export default async function CatalogueLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user || user.role !== 'admin') redirect('/')
  return children
}
