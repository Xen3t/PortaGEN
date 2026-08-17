import type { Metadata } from 'next'
import { getSessionUser } from '@/lib/auth/session'
import DecorEcrinApp from './DecorEcrinApp'

export const metadata: Metadata = {
  title: 'MES Contrainte — PortaGEN',
  description:
    'MES Contrainte : dépôt d’images, plan gris à la vraie échelle, Nano peint autour',
}

/**
 * MES CONTRAINTE — page officielle (07/08/2026) : le banc de test remplace
 * l'ancienne page (supprimée, décision Mathias) et le nom est harmonisé
 * « MES Contrainte » PARTOUT (fini Décor Écrin / MES Écrin, décision 07/08).
 * L'URL ne change pas ; les cartes « Mes sessions » arrivent en ?session=…,
 * les lots de la page vivent en ?lot=…. L'auth est portée par le layout (app).
 * isAdmin (08/08) : la modale « Gérer les décors » est ouverte à tous, mais
 * décor par défaut et suppression n'apparaissent que pour l'admin.
 */
export default async function DecorAutourPage() {
  const user = await getSessionUser()
  return <DecorEcrinApp isAdmin={user?.role === 'admin'} />
}
