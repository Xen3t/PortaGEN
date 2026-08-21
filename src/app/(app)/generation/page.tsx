import { getSessionUser } from '@/lib/auth/session'
import GenerationApp from './GenerationApp'

/**
 * Page « Générer » — wrapper SERVEUR (21/08/2026) : le rôle descend en prop,
 * comme pour MES Contrainte (decor-autour/page.tsx). MES Libre est réservé aux
 * admins (demande Mathias 21/08) : la carte n'apparaît pas pour un utilisateur,
 * et les routes /api/generation/libre/* sont verrouillées côté serveur.
 */
export default async function GenerationPage() {
  const user = await getSessionUser()
  return <GenerationApp isAdmin={user?.role === 'admin'} />
}
