'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import SessionCards from './generation/SessionCards'
import { SilhouetteModeIcone, type Mode } from './Silhouette'

/**
 * ACCUEIL — page d'arrivée (navigation v2 validée le 12/07/2026) :
 * les actions + mes sessions, filtrées sur la marque active.
 *
 * 13/07/2026 (maquette sessions-v2) : la page Production a été SUPPRIMÉE —
 * les lancements de gamme sont des sessions comme les autres, affichées ici.
 * 07/08/2026 : « Mes dernières générations » et « Notifications » retirés de
 * l'écran (décision Mathias) — le système de notifications reste en place.
 */

interface Job {
  id: number
  type: string
  status: string
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  error: string | null
  reviewStatus: string
  batchId: string | null
  createdAt: string
}

export default function AccueilPage() {
  const [data, setData] = useState<{ brand: string; jobs: Job[] } | null>(null)

  useEffect(() => {
    const load = () =>
      fetch('/api/accueil')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setData(d))
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [])

  if (data && data.brand !== 'casanoov') {
    return (
      <div className="bg-white rounded-[12px] border border-border shadow-sm p-10 text-center max-w-2xl mx-auto">
        <p className="font-bold text-lg mb-1">PortaGEN {data.brand.toUpperCase()} arrive bientôt</p>
        <p className="text-sm text-text-secondary">
          Le moteur de cette marque n&apos;existe pas encore. Repassez sur CASANOOV via le logo
          en haut à gauche pour retrouver vos générations.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      {/* Les actions au-dessus des sessions (rework 22/07/2026, validé par
          Mathias — maquette generer-depuis-catalogue-v2). 05/08 (demande
          Mathias) : MES Décors retiré de l'Accueil, et MES Contrainte pointe
          sur la NOUVELLE méthode « Décor Écrin » (/generation/decor-autour),
          plus sur le flux legacy. L'Accueil ne change pas au-delà de cette
          rangée. */}
      <div className="stagger grid md:grid-cols-2 gap-3.5">
        {(
          [
            {
              href: '/generation/decor-autour',
              mode: 'contrainte' as Mode,
              titre: 'MES Contrainte',
              sous: 'vraie échelle, Nano peint autour',
            },
            {
              href: '/generation?mode=libre',
              mode: 'libre' as Mode,
              titre: 'MES Libre',
              sous: 'génération libre (WIP)',
            },
          ] as const
        ).map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex items-center justify-center gap-3.5 bg-white rounded-[12px] border-[1.5px] border-border shadow-sm px-5 py-4 transition-all hover:border-brand-green hover:shadow-md hover:-translate-y-0.5"
          >
            {/* Icônes carrées SilhouetteMode à la place des pictos PNG (22/07) */}
            <SilhouetteModeIcone mode={a.mode} className="block w-[34px] h-[34px] shrink-0" />
            <span>
              <span className="block font-bold text-[15px]">{a.titre}</span>
              <span className="block text-xs text-text-secondary">{a.sous}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* Sessions rouvrables : directes ET lancements de gamme (sessions-v2,
          validée le 13/07/2026). Les 4 DERNIÈRES sur l'accueil (passé de 3 à 4,
          demande Mathias 08/08) — masqué tant qu'il n'y en a aucune. Monté SANS
          attendre /api/accueil : les appels partent en parallèle. */}
      <SessionCards limit={4} hideWhenEmpty allLink />

      {/* « Mes dernières générations » et « Notifications » RETIRÉS de
          l'Accueil le 07/08/2026 (décision Mathias) : doublon des sessions, et
          leurs clics héritaient de la vieille page /production/image. Le
          système de notifications (API accueil, échecs) reste en place — il
          n'est simplement plus affiché ici. */}
    </div>
  )
}
