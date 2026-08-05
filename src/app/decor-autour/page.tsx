import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'
import DecorAutourApp from './DecorAutourApp'

export const metadata: Metadata = {
  title: 'Décor autour — PortaGEN',
  description: 'Banc autonome « décor autour » (battants)',
}

/**
 * Mini-app « Décor autour » — page STANDALONE, hors du groupe (app) : pas de
 * menu ni de chrome de l'app (« vivant à côté »), mais on garde l'auth de l'app.
 */
export default async function DecorAutourPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  return <DecorAutourApp />
}
