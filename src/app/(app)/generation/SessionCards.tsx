'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Chargement from '@/components/Chargement'

/**
 * Cartes « Mes sessions » (maquette sessions-v2, validée le 13/07/2026) :
 * générations directes ET lancements de gamme (Catalogue) dans la même liste.
 * Utilisé par l'accueil (les 3 dernières) et par la page « Toutes les
 * sessions ». Cliquer une carte directe rouvre l'écran de résultats
 * (/generation?session=…) ; une carte catalogue ouvre la page de la gamme.
 * Le petit ✕ discret retire la session de la liste (session directe = ligne
 * effacée, lancement de gamme = lot masqué) — les jobs et images sont conservés.
 * La page « Toutes les sessions » active en plus une barre de filtres
 * typologie + date de création (maquette sessions-v3, validée le 28/07/2026).
 */

export interface SessionSummary {
  batchId: string
  produit: string
  moteur: string
  decorName: string | null
  createdAt: string
  source: 'directe' | 'catalogue' | 'decor' | 'libre'
  mesCount: number
  mesDone: number
  coloris: string[]
  mpDone: boolean
  busy: boolean
  failed: boolean
  thumbPath: string | null
}

const MOTEUR_LABELS: Record<string, string> = {
  battant: 'Battant',
  coulissant: 'Coulissant',
  'coulissant-xl': 'Coulissant XL',
  portillon: 'Portillon',
  libre: 'MES Libre',
}

// Dernière liste reçue, gardée en mémoire tant que l'onglet vit (une entrée par
// limite demandée : 3 sur l'accueil, 200 sur « Toutes les sessions »). En
// revenant sur la page, les cartes s'affichent immédiatement depuis ce cache
// pendant que la liste fraîche se recharge en arrière-plan.
const lastLoaded = new Map<number, SessionSummary[]>()

function art(p: string, w?: number): string {
  const base = `/api/artifacts?p=${encodeURIComponent(p)}`
  return w ? `${base}&w=${w}` : base
}

function parseDate(iso: string): Date {
  return new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
}

// Périodes proposées par le filtre « Créées » (maquette sessions-v3).
const DATE_CHOICES = [
  { value: '', label: "N'importe quand" },
  { value: '0', label: "Aujourd'hui" },
  { value: '7', label: 'Les 7 derniers jours' },
  { value: '30', label: 'Les 30 derniers jours' },
]

function matchesPeriod(iso: string, days: string): boolean {
  const d = parseDate(iso)
  // date illisible → on ne masque pas la session, le filtre ne doit rien perdre
  if (Number.isNaN(d.getTime())) return true
  if (days === '0') {
    const now = new Date()
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    )
  }
  return Date.now() - d.getTime() <= Number(days) * 86_400_000
}

export default function SessionCards({
  limit,
  hideWhenEmpty = false,
  allLink = false,
  showTitle = true,
  showFilters = false,
}: {
  limit: number
  /** true sur l'accueil : pas encore de session → le bloc entier disparaît. */
  hideWhenEmpty?: boolean
  /** true sur l'accueil : lien « Toutes les sessions → » dans le titre. */
  allLink?: boolean
  /** false sur la page « Toutes les sessions » : le titre de la page suffit. */
  showTitle?: boolean
  /** true sur « Toutes les sessions » : barre de filtres typologie + date. */
  showFilters?: boolean
}) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(
    () => lastLoaded.get(limit) ?? null
  )
  const [moteurFilter, setMoteurFilter] = useState('')
  const [daysFilter, setDaysFilter] = useState('')

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch(`/api/generation/sessions?limit=${limit}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (Array.isArray(d?.sessions)) {
            lastLoaded.set(limit, d.sessions)
            if (alive) setSessions(d.sessions)
          }
        })
        .catch(() => {})
    load()
    const timer = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [limit])

  // Confirmation intégrée au bouton (pas de window.confirm : certains
  // navigateurs/vues intégrées le bloquent silencieusement — le ✕ semblait
  // alors « mort »). 1er clic = armer, 2e clic = supprimer.
  const [confirm, setConfirm] = useState<{ id: string; state: 'ask' | 'busy' | 'error' } | null>(
    null
  )

  async function removeSession(s: SessionSummary) {
    setConfirm({ id: s.batchId, state: 'busy' })
    try {
      const res = await fetch(`/api/generation/sessions/${encodeURIComponent(s.batchId)}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setSessions((cur) => {
          const next = (cur ?? []).filter((x) => x.batchId !== s.batchId)
          lastLoaded.set(limit, next)
          return next
        })
        setConfirm(null)
      } else {
        setConfirm({ id: s.batchId, state: 'error' })
      }
    } catch {
      setConfirm({ id: s.batchId, state: 'error' })
    }
  }

  if (sessions == null) {
    return hideWhenEmpty ? null : <Chargement />
  }
  if (sessions.length === 0 && hideWhenEmpty) return null

  const shown = showFilters
    ? sessions.filter(
        (s) =>
          (!moteurFilter || s.moteur === moteurFilter) &&
          (daysFilter === '' || matchesPeriod(s.createdAt, daysFilter))
      )
    : sessions
  const filtersActive = moteurFilter !== '' || daysFilter !== ''
  const resetFilters = () => {
    setMoteurFilter('')
    setDaysFilter('')
  }

  return (
    <>
    {showFilters && (
      <div className="flex items-center gap-x-5 gap-y-2 flex-wrap bg-white rounded-[12px] border border-border shadow-sm px-4 py-3 mb-3.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mr-1">
            Typologie
          </span>
          {[['', 'Toutes'], ...Object.entries(MOTEUR_LABELS)].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMoteurFilter(value)}
              className={`rounded-full border-[1.5px] px-3 py-0.5 text-[13px] font-semibold transition-colors ${
                moteurFilter === value
                  ? 'bg-brand-green-light border-brand-green text-brand-green'
                  : 'bg-white border-border text-text-secondary hover:border-brand-green hover:text-brand-green'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mr-1">
            Créées
          </span>
          <select
            value={daysFilter}
            onChange={(e) => setDaysFilter(e.target.value)}
            className="rounded-full border-[1.5px] border-border bg-white px-3 py-0.5 text-[13px] font-semibold cursor-pointer focus:outline-none focus:border-brand-green"
          >
            {DATE_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <span className="ml-auto text-xs text-text-secondary">
          {filtersActive && shown.length !== sessions.length ? (
            <>
              <b className="text-text-primary">{shown.length}</b> session
              {shown.length > 1 ? 's' : ''} sur {sessions.length} ·{' '}
              <button
                type="button"
                onClick={resetFilters}
                className="font-semibold text-brand-green underline"
              >
                tout réafficher
              </button>
            </>
          ) : (
            <>
              <b className="text-text-primary">{sessions.length}</b> session
              {sessions.length > 1 ? 's' : ''}
            </>
          )}
        </span>
      </div>
    )}
    <section className="bg-white rounded-[12px] border border-border shadow-sm p-5">
      {showTitle && (
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-3 flex items-baseline gap-3">
          Mes sessions
          {allLink && sessions.length > 0 && (
            <Link
              href="/generation/sessions"
              className="ml-auto normal-case tracking-normal text-xs font-semibold text-brand-green hover:underline"
            >
              Toutes les sessions →
            </Link>
          )}
        </h2>
      )}
      {sessions.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Aucune session pour l&apos;instant — lance une{' '}
          <Link href="/generation" className="text-brand-green font-semibold hover:underline">
            Génération
          </Link>{' '}
          ou une gamme depuis le{' '}
          <Link href="/catalogue" className="text-brand-green font-semibold hover:underline">
            Catalogue
          </Link>
          , elle apparaîtra ici.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Aucune session ne correspond à ces filtres —{' '}
          <button
            type="button"
            onClick={resetFilters}
            className="font-semibold text-brand-green underline"
          >
            tout réafficher
          </button>
          .
        </p>
      ) : (
        <div className="stagger grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {shown.map((s) => {
            const statut = s.busy
              ? { text: 'en cours', cls: 'text-brand-teal anim-respire' }
              : s.failed
                ? { text: '✗ en erreur', cls: 'text-brand-red' }
                : { text: '✓ terminée', cls: 'text-brand-green' }
            const href =
              s.source === 'catalogue'
                ? `/production/gamme/${encodeURIComponent(s.batchId)}`
                : s.source === 'decor'
                  ? `/decors?session=${encodeURIComponent(s.batchId)}`
                  : s.source === 'libre'
                    ? `/generation?libre=${encodeURIComponent(s.batchId)}`
                    : `/generation?session=${encodeURIComponent(s.batchId)}`
            const unit = s.source === 'decor' ? 'tirage' : s.source === 'libre' ? 'variante' : 'image'
            const count = s.busy
              ? `${s.mesDone}/${s.mesCount} ${unit}s`
              : `${s.mesCount} ${unit}${s.mesCount > 1 ? 's' : ''}`
            return (
              <div
                key={s.batchId}
                onMouseLeave={() => {
                  // quitter la carte désarme la confirmation (sauf en plein appel)
                  if (confirm?.id === s.batchId && confirm.state !== 'busy') setConfirm(null)
                }}
                className={`group relative border-[1.5px] rounded-[12px] overflow-hidden bg-white transition-all hover:shadow-lg hover:-translate-y-0.5 hover:border-brand-green ${
                  s.busy ? 'border-brand-teal' : 'border-border'
                }`}
              >
                <Link href={href} className="block">
                  <div className="relative">
                    {s.thumbPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={art(s.thumbPath, 480)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full h-[110px] object-cover bg-surface"
                      />
                    ) : (
                      <span className="block w-full h-[110px] bg-surface" />
                    )}
                    <span className="absolute bottom-2 left-2 bg-white/95 border border-border rounded-full text-[11px] font-bold px-2.5 py-0.5 text-text-secondary">
                      {count}
                    </span>
                    {s.source === 'catalogue' ? (
                      <span className="absolute top-2 right-2 rounded-full text-[10.5px] font-bold px-2 py-0.5 bg-brand-teal-light text-brand-teal">
                        Catalogue
                      </span>
                    ) : s.source === 'decor' ? (
                      <span className="absolute top-2 right-2 rounded-full text-[10.5px] font-bold px-2 py-0.5 bg-brand-green-light text-brand-green">
                        Décor
                      </span>
                    ) : s.source === 'libre' ? (
                      <span className="absolute top-2 right-2 rounded-full text-[10.5px] font-bold px-2 py-0.5 bg-brand-green-light text-brand-green">
                        Libre
                      </span>
                    ) : (
                      <span className="absolute top-2 right-2 bg-white/95 border border-border rounded-full text-[10.5px] font-bold px-2 py-0.5 text-text-secondary">
                        Directe
                      </span>
                    )}
                  </div>
                  <div className="px-3.5 pt-2.5 pb-3">
                    <div className="flex items-center gap-2">
                      <b className="text-[14px] truncate">{s.produit || 'Sans nom'}</b>
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-brand-green-light text-brand-green shrink-0">
                        {MOTEUR_LABELS[s.moteur] ?? s.moteur}
                      </span>
                    </div>
                    <div className="text-xs text-text-secondary truncate mt-0.5">
                      {s.source === 'catalogue'
                        ? `${s.mesCount} taille${s.mesCount > 1 ? 's' : ''}`
                        : `${s.mesCount} ${unit}${s.mesCount > 1 ? 's' : ''}`}
                      {s.coloris.length > 0 ? ` · ${s.coloris.join(', ')}` : ''}
                      {s.source === 'catalogue'
                        ? ' · lancée depuis le Catalogue'
                        : s.source === 'decor'
                          ? s.decorName
                            ? ` · gamme « ${s.decorName} »`
                            : ' · décor'
                          : s.decorName
                            ? ` · décor « ${s.decorName} »`
                            : ''}
                    </div>
                    {s.busy && s.mesCount > 0 && (
                      <div className="h-[5px] bg-surface rounded-full overflow-hidden mt-1.5">
                        <span
                          className="block h-full bg-brand-teal rounded-full transition-all"
                          style={{ width: `${Math.round((100 * s.mesDone) / s.mesCount)}%` }}
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs mt-1.5">
                      <span className={`font-bold inline-flex items-center gap-1.5 ${statut.cls}`}>
                        {s.busy && (
                          <span className="inline-block animate-spin h-3 w-3 border-2 border-brand-teal-light border-t-brand-teal rounded-full" />
                        )}
                        {statut.text}
                      </span>
                      <span className="ml-auto font-bold text-brand-green">
                        {s.busy ? 'Suivre →' : 'Rouvrir →'}
                      </span>
                    </div>
                  </div>
                </Link>
                {/* suppression discrète : session directe = ligne effacée,
                    lancement de gamme = lot masqué de la liste. Dans les deux
                    cas jobs et images sont conservés. */}
                {confirm?.id === s.batchId ? (
                    <button
                      type="button"
                      onClick={() => void removeSession(s)}
                      disabled={confirm.state === 'busy'}
                      title="Les images générées sont conservées — seule la session disparaît de la liste"
                      className="absolute top-2 left-2 rounded-full bg-brand-red text-white text-[11px] font-bold px-2.5 py-1 shadow-md disabled:opacity-60"
                    >
                      {confirm.state === 'busy'
                        ? 'Suppression…'
                        : confirm.state === 'error'
                          ? 'Échec — réessayer'
                          : 'Confirmer la suppression ?'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirm({ id: s.batchId, state: 'ask' })}
                      title="Supprimer cette session de la liste"
                      className="absolute top-2 left-2 w-6 h-6 rounded-full bg-white/95 border border-border text-text-disabled text-[11px] leading-none grid place-items-center opacity-0 group-hover:opacity-100 hover:text-brand-red hover:border-brand-red/40 transition-opacity"
                    >
                      ✕
                    </button>
                  )}
              </div>
            )
          })}
        </div>
      )}
    </section>
    </>
  )
}
