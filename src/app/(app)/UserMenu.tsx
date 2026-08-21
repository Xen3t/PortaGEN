'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Menu utilisateur (en haut à droite) : le nom ouvre un menu déroulant avec
 * les pages d'administration (admin uniquement) et la déconnexion —
 * demande Mathias 10/07/2026 (l'entrée « Administration » quitte la nav).
 */

// Ordre RÉORGANISÉ le 08/08 (demande Mathias) : le pilotage quotidien d'abord
// (Réglages, Descriptions), le suivi ensuite (Journal), puis les outils
// ponctuels (Détection) et l'administration pure (Utilisateurs, Feedback).
// « LAB » et « Coûts API » supprimés le 05/08/2026.
const ADMIN_LINKS = [
  { href: '/admin/reglages', label: 'Réglages' },
  { href: '/admin/descriptions', label: 'Descriptions produit' },
  { href: '/admin/jobs', label: 'Journal des générations' },
  { href: '/admin/detection', label: 'Détection des images' },
  { href: '/admin/utilisateurs', label: 'Utilisateurs' },
  { href: '/admin/feedback', label: 'Feedback' },
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

  // Changement de mot de passe par l'utilisateur lui-même (21/08, tous rôles) :
  // mot de passe actuel exigé, les autres sessions sont déconnectées, la
  // session courante est conservée (le serveur repose le cookie).
  const [mdpOpen, setMdpOpen] = useState(false)
  const [mdpActuel, setMdpActuel] = useState('')
  const [mdpNouveau, setMdpNouveau] = useState('')
  const [mdpNotice, setMdpNotice] = useState<string | null>(null)
  const [mdpBusy, setMdpBusy] = useState(false)
  function ouvrirMdp() {
    setMdpActuel('')
    setMdpNouveau('')
    setMdpNotice(null)
    setMdpOpen(true)
    setOpen(false)
  }
  async function changerMdp(e: React.FormEvent) {
    e.preventDefault()
    if (mdpBusy) return
    setMdpBusy(true)
    setMdpNotice(null)
    try {
      const res = await fetch('/api/users/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actuel: mdpActuel, nouveau: mdpNouveau }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok) {
        setMdpOpen(false)
      } else {
        setMdpNotice(data?.error ?? 'Changement impossible.')
      }
    } catch {
      setMdpNotice('Impossible de contacter le serveur.')
    } finally {
      setMdpBusy(false)
    }
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
        <div className="anim-menu absolute right-0 top-full mt-2 w-56 bg-white rounded-[12px] shadow-lg border border-border py-1.5 z-40">
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
            onClick={ouvrirMdp}
            className="w-full text-left px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"
          >
            Changer mon mot de passe
          </button>
          <button
            onClick={logout}
            className="w-full text-left px-4 py-2 text-sm font-medium text-text-secondary hover:bg-brand-red-light hover:text-brand-red transition-colors"
          >
            Déconnexion
          </button>
        </div>
      )}
      {mdpOpen && (
        <div
          className="fixed inset-0 bg-[rgba(31,41,55,0.45)] z-50 flex items-center justify-center p-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMdpOpen(false)
          }}
        >
          <form
            onSubmit={changerMdp}
            className="bg-white rounded-[12px] shadow-lg w-[400px] max-w-full p-5 text-left"
          >
            <h2 className="text-[16px] font-bold mb-1">Changer mon mot de passe</h2>
            <p className="text-[12.5px] text-text-secondary mb-4">
              Tes autres sessions ouvertes seront déconnectées ; celle-ci reste active.
            </p>
            {mdpNotice && (
              <div className="bg-brand-red-light text-brand-red text-[12.5px] font-semibold rounded-[8px] px-3 py-2 mb-3">
                {mdpNotice}
              </div>
            )}
            <input
              type="password"
              value={mdpActuel}
              onChange={(e) => setMdpActuel(e.target.value)}
              placeholder="Mot de passe actuel"
              autoFocus
              className="w-full border border-border bg-surface rounded-[8px] px-3 py-2 text-sm mb-2.5 focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
            />
            <input
              type="password"
              value={mdpNouveau}
              onChange={(e) => setMdpNouveau(e.target.value)}
              placeholder="Nouveau mot de passe (8 caractères min.)"
              className="w-full border border-border bg-surface rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
            />
            <div className="flex justify-end gap-2.5 mt-4">
              <button
                type="button"
                onClick={() => setMdpOpen(false)}
                className="bg-white border border-border text-text-secondary rounded-[8px] px-4 py-2 text-sm font-bold hover:border-text-secondary transition-colors"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={mdpBusy || !mdpActuel || mdpNouveau.length < 8}
                className="bg-brand-green text-white rounded-[8px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
              >
                {mdpBusy ? 'Changement…' : 'Changer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
