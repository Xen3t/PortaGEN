'use client'

import Link from 'next/link'
import SessionCards from '../SessionCards'

/**
 * « Toutes les sessions » (validé 13/07/2026, maquette sessions-v1) : l'historique
 * complet des sessions de génération directe de l'utilisateur — l'accueil n'en
 * montre que les dernières. Mêmes cartes, mêmes actions (rouvrir, supprimer).
 * Barre de filtres typologie + date de création (maquette sessions-v3, 28/07/2026).
 */
export default function SessionsPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-2.5 flex-wrap mb-5">
        <Link href="/" className="pill">
          ← Accueil
        </Link>
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-4">Mes sessions de génération</h1>
      <SessionCards limit={200} showTitle={false} showFilters />
    </div>
  )
}
