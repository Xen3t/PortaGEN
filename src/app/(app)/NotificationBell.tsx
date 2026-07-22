'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/**
 * Cloche de notifications du bandeau (bloc 3.4, 13/07/2026).
 *
 * Miroir des lancements catalogue TERMINÉS de l'utilisateur (API /notifications).
 * L'état « lu » vit en localStorage (repère du dernier id vu) : pas de colonne en
 * base, la cloche reste un simple témoin. Menu déroulant calé sous l'icône, jamais
 * coupé — corrige la maquette où le volet débordait à droite.
 *
 * « Tout effacer » (22/07/2026) suit le même principe : un repère « effacé
 * jusqu'à l'id X » en localStorage masque les notifications antérieures ; les
 * lancements suivants réapparaissent normalement.
 */

interface Notif {
  id: number
  batchId: string
  productId: number
  productName: string
  colorisList: string[]
  siteDone: number
  marketplaceDone: number
  errorCount: number
  kind: 'ok' | 'partial' | 'error'
  message: string
  at: string
  /** 'catalogue' → clic = page produit ; 'decor' → clic = Bibliothèque (20/07/2026). */
  source: 'catalogue' | 'decor'
}

const SEEN_KEY = 'portagen-notif-seen'
const CLEARED_KEY = 'portagen-notif-cleared'

function relTime(iso: string): string {
  const then = new Date(iso.replace(' ', 'T') + 'Z').getTime()
  if (!Number.isFinite(then)) return ''
  const min = Math.round((Date.now() - then) / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.round(h / 24)
  if (d === 1) return 'hier'
  if (d < 7) return `il y a ${d} j`
  return new Date(then).toLocaleDateString('fr-FR')
}

export default function NotificationBell() {
  const router = useRouter()
  const pathname = usePathname()
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [seen, setSeen] = useState(0)
  const [cleared, setCleared] = useState(0)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    fetch('/api/notifications')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setNotifs(d.notifications as Notif[]))
      .catch(() => undefined)
  }, [])

  // Repère « lu » chargé une fois, puis rafraîchissement régulier des notifs.
  useEffect(() => {
    const raw = Number(localStorage.getItem(SEEN_KEY))
    if (Number.isFinite(raw)) setSeen(raw)
    const rawCleared = Number(localStorage.getItem(CLEARED_KEY))
    if (Number.isFinite(rawCleared)) setCleared(rawCleared)
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [load])

  // Ferme au clic ailleurs / au changement de page.
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    load()
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open, load])

  const visible = notifs.filter((n) => n.id > cleared)
  const unread = visible.filter((n) => n.id > seen).length

  function markAllRead() {
    const maxId = notifs.reduce((m, n) => Math.max(m, n.id), seen)
    setSeen(maxId)
    localStorage.setItem(SEEN_KEY, String(maxId))
  }

  // Vide la liste : tout ce qui existe aujourd'hui est masqué (et marqué lu).
  function clearAll() {
    const maxId = notifs.reduce((m, n) => Math.max(m, n.id), Math.max(cleared, seen))
    setCleared(maxId)
    setSeen(maxId)
    localStorage.setItem(CLEARED_KEY, String(maxId))
    localStorage.setItem(SEEN_KEY, String(maxId))
  }

  function openNotif(n: Notif) {
    setOpen(false)
    router.push(n.source === 'decor' ? '/decors' : `/catalogue/${n.productId}`)
  }

  const icon = (kind: Notif['kind']) =>
    kind === 'error'
      ? { ch: '!', cls: 'bg-brand-red-light text-brand-red' }
      : kind === 'partial'
        ? { ch: '!', cls: 'bg-amber-100 text-amber-700' }
        : { ch: '✓', cls: 'bg-brand-green-light text-brand-green' }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        className="relative flex items-center text-text-secondary hover:text-text-primary transition-colors px-1"
      >
        {/* Cloche identique à celle de HoorTRADS (demande Mathias 13/07/2026). */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-brand-red text-white text-[10px] font-bold rounded-full min-w-[16px] h-[16px] grid place-items-center px-1">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[360px] max-w-[calc(100vw-32px)] bg-white rounded-[12px] shadow-lg border border-border z-40 overflow-hidden">
          <div className="flex items-center px-4 py-3 border-b border-border">
            <span className="font-bold text-sm">Notifications</span>
            <span className="ml-auto flex items-center gap-3">
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs font-semibold text-brand-green hover:underline"
                >
                  Tout marquer comme lu
                </button>
              )}
              {visible.length > 0 && (
                <button
                  onClick={clearAll}
                  className="text-xs font-semibold text-text-secondary hover:underline"
                >
                  Tout effacer
                </button>
              )}
            </span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {visible.length === 0 ? (
              <p className="px-4 py-6 text-sm text-text-secondary text-center">
                Aucune notification pour l&apos;instant.
              </p>
            ) : (
              visible.map((n) => {
                const ic = icon(n.kind)
                // Un décor n'a pas de coloris : le titre reste le nom seul.
                const coloris =
                  n.colorisList.length === 0
                    ? null
                    : n.colorisList.length === 1
                      ? n.colorisList[0].toUpperCase()
                      : `${n.colorisList.length} coloris`
                return (
                  <button
                    key={n.batchId}
                    onClick={() => openNotif(n)}
                    className={`flex gap-3 w-full text-left px-4 py-3 border-b border-border last:border-b-0 hover:bg-surface transition-colors ${
                      n.id > seen ? 'bg-brand-green-light/30' : ''
                    }`}
                  >
                    <span
                      className={`w-[30px] h-[30px] rounded-lg grid place-items-center text-sm font-bold shrink-0 ${ic.cls}`}
                    >
                      {ic.ch}
                    </span>
                    <span className="text-[13px] leading-snug">
                      <b className="text-text-primary">
                        {n.productName}
                        {coloris ? ` · ${coloris}` : ''}
                      </b>{' '}
                      — {n.message}
                      <small className="block text-text-disabled text-[11.5px] mt-0.5">
                        {relTime(n.at)} · {n.source === 'decor' ? 'voir la Bibliothèque' : 'voir la gamme'}
                      </small>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
