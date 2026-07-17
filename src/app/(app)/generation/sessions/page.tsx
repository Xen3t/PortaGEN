'use client'

import Link from 'next/link'
import SessionCards from '../SessionCards'

/**
 * « Toutes les sessions » (validé 13/07/2026, maquette sessions-v1) : l'historique
 * complet des sessions de génération directe de l'utilisateur — l'accueil n'en
 * montre que les dernières. Mêmes cartes, mêmes actions (rouvrir, supprimer).
 */
export default function SessionsPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-2.5 flex-wrap mb-5">
        <Link href="/" className="pill">
          ← Accueil
        </Link>
      </div>
      <div className="flex items-baseline gap-3 flex-wrap mb-4">
        <h1 className="text-2xl font-bold tracking-tight">Mes sessions de génération</h1>
        <span className="text-sm text-text-secondary">
          rouvre une session pour retélécharger ou passer en MP
        </span>
      </div>
      <SessionCards limit={200} showTitle={false} />
    </div>
  )
}
