'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Menu utilisateur (en haut à droite) : le nom ouvre un menu déroulant avec
 * les pages d'administration (admin uniquement) et la déconnexion —
 * demande Mathias 10/07/2026 (l'entrée « Administration » quitte la nav).
 */

const ADMIN_LINKS = [
  { href: '/admin/jobs', label: 'Journal des générations' },
  // Réorganisation 13/07/2026 (demande Mathias) : « Réglages par moteur » devient
  // « Réglages » et accueille les réglages généraux (générations simultanées,
  // tarif, serveur de fichiers) ; l'ex-« Réglages généraux » devient « LAB »
  // avec un sélecteur de moteur. Gabarits absorbés le 13/07, Prompts le 13/07 —
  // tout s'édite dans la fiche moteur.
  { href: '/admin/reglages', label: 'Réglages' },
  { href: '/admin/lab', label: 'LAB' },
  { href: '/admin/couts', label: 'Coûts API' },
  { href: '/admin/feedback', label: 'Feedback' },
  { href: '/admin/utilisateurs', label: 'Utilisateurs' },
]

export default function UserMenu({
  username,
  isAdmin,
}: {
  username: string
  isAdmin: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Ferme le menu au clic ailleurs ou au changement de page
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const adminActive = pathname.startsWith('/admin')

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full transition-colors ${
          adminActive
            ? 'bg-brand-teal-light text-brand-teal font-semibold'
            : 'text-text-secondary hover:bg-surface'
        }`}
      >
        <span className="font-semibold">{username}</span>
        <span className="text-text-disabled">· {isAdmin ? 'admin' : 'utilisateur'}</span>
        <span className={`text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-[12px] shadow-lg border border-border py-1.5 z-40">
          {/* « Créer » retiré le 13/07/2026 (bloc 3.5) : l'ancien flux guidé de MES
              est repris par le catalogue (/creer redirige vers /catalogue).
              « Bibliothèque » retirée le 13/07/2026 : devenue « Décors » dans la
              nav principale (les onglets Moodboards et Produits ont été supprimés). */}
          {isAdmin && (
            <>
              <p className="px-4 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-disabled">
                Administration
              </p>
              {ADMIN_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`block px-4 py-2 text-sm font-medium transition-colors ${
                    pathname.startsWith(l.href)
                      ? 'text-brand-teal bg-brand-teal-light/50'
                      : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                  }`}
                >
                  {l.label}
                </Link>
              ))}
              <div className="border-t border-border my-1.5" />
            </>
          )}
          <button
            onClick={logout}
            className="w-full text-left px-4 py-2 text-sm font-medium text-text-secondary hover:bg-brand-red-light hover:text-brand-red transition-colors"
          >
            Déconnexion
          </button>
        </div>
      )}
    </div>
  )
}
