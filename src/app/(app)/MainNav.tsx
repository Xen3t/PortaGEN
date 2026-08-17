'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Navigation v2 (maquette validée le 12/07/2026) : Accueil · Catalogue ·
 * Production. Créer et Bibliothèque ne sont PLUS dans la barre (retour Mathias :
 * « ça me gave ») : ils vivent dans le menu utilisateur, « Ancienne interface ».
 *
 * 13/07/2026 : ajout de « Génération » (maquette generation-v4 validée) — page
 * de génération DIRECTE, sans catalogue (déposer des images → MES →
 * téléchargement direct). Entrée de nav dédiée demandée par Mathias.
 *
 * 13/07/2026 : la Bibliothèque devient « Décors » et rejoint la nav principale
 * — ses onglets Moodboards et Produits ont été supprimés.
 * Ordre demandé par Mathias : Accueil · Génération · Décors · Catalogue.
 *
 * 13/07/2026 (sessions-v2) : « Production » SUPPRIMÉE de la nav — un lancement
 * de gamme = une session, affichée sur l'Accueil ; /production redirige vers /.
 * Les pages de détail /production/gamme/* et /production/image/* restent.
 *
 * 22/07/2026 (rework, structure actée par Mathias — maquette
 * generer-depuis-catalogue-v3) : « Génération » devient « Générer » et
 * « Décors » SORT de la barre — la page devient « MES Décors » sur /decors
 * (ex-/bibliotheque, redirigée), accessible depuis l'Accueil et la page
 * Générer. Nav : Accueil · Générer · Catalogue.
 *
 * 17/08/2026 : la bibliothèque de Décors (maquette bibliotheque-decors-v1)
 * vit DANS la page MES Contrainte (modale « Décors ») — PAS d'entrée de nav,
 * demande explicite Mathias.
 */

const MAIN_LINKS = [
  { href: '/', label: 'Accueil', match: (p: string) => p === '/' },
  {
    href: '/generation',
    label: 'Générer',
    match: (p: string) => p.startsWith('/generation') || p.startsWith('/decors'),
  },
  {
    href: '/catalogue',
    label: 'Catalogue',
    match: (p: string) => p.startsWith('/catalogue'),
  },
]

export default function MainNav() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-1 text-sm font-semibold">
      {MAIN_LINKS.map((l) => {
        const active = l.match(pathname)
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`px-3 py-1.5 rounded-full transition-colors ${
              active
                ? 'bg-brand-green-light text-brand-green'
                : 'text-text-secondary hover:text-brand-green hover:bg-surface'
            }`}
          >
            {l.label}
          </Link>
        )
      })}
    </nav>
  )
}
