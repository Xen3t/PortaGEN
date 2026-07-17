'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

/**
 * Cartes « Mes sessions » (maquette sessions-v2, validée le 13/07/2026) :
 * générations directes ET lancements de gamme (Catalogue) dans la même liste.
 * Utilisé par l'accueil (les 3 dernières) et par la page « Toutes les
 * sessions ». Cliquer une carte directe rouvre l'écran de résultats
 * (/generation?session=…) ; une carte catalogue ouvre la page de la gamme.
 * Le petit ✕ discret retire la session de la liste (session directe = ligne
 * effacée, lancement de gamme = lot masqué) — les jobs et images sont conservés.
 */

export interface SessionSummary {
  batchId: string
  produit: string
  moteur: string
  decorName: string | null
  createdAt: string
  source: 'directe' | 'catalogue'
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
  portillon: 'Portillon',
}

function art(p: string, w?: number): string {
  const base = `/api/artifacts?p=${encodeURIComponent(p)}`
  return w ? `${base}&w=${w}` : base
}

function fmtDate(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function SessionCards({
  limit,
  hideWhenEmpty = false,
  allLink = false,
  showTitle = true,
}: {
  limit: number
  /** true sur l'accueil : pas encore de session → le bloc entier disparaît. */
  hideWhenEmpty?: boolean
  /** true sur l'accueil : lien « Toutes les sessions → » dans le titre. */
  allLink?: boolean
  /** false sur la page « Toutes les sessions » : le titre de la page suffit. */
  showTitle?: boolean
}) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch(`/api/generation/sessions?limit=${limit}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && Array.isArray(d?.sessions)) setSessions(d.sessions)
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
        setSessions((cur) => (cur ?? []).filter((x) => x.batchId !== s.batchId))
        setConfirm(null)
      } else {
        setConfirm({ id: s.batchId, state: 'error' })
      }
    } catch {
      setConfirm({ id: s.batchId, state: 'error' })
    }
  }

  if (sessions == null) {
    return hideWhenEmpty ? null : <p className="text-sm text-text-secondary">Chargement…</p>
  }
  if (sessions.length === 0 && hideWhenEmpty) return null

  return (
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
      ) : (
        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {sessions.map((s) => {
            const statut = s.busy
              ? { text: 'en cours', cls: 'text-brand-teal' }
              : s.failed
                ? { text: '✗ en erreur', cls: 'text-brand-red' }
                : { text: '✓ terminée', cls: 'text-brand-green' }
            const href =
              s.source === 'catalogue'
                ? `/production/gamme/${encodeURIComponent(s.batchId)}`
                : `/generation?session=${encodeURIComponent(s.batchId)}`
            const count = s.busy
              ? `${s.mesDone}/${s.mesCount} images`
              : `${s.mesCount} image${s.mesCount > 1 ? 's' : ''}`
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
                        : `${s.mesCount} image${s.mesCount > 1 ? 's' : ''}`}
                      {s.coloris.length > 0 ? ` · ${s.coloris.join(', ')}` : ''}
                      {s.source === 'catalogue'
                        ? ' · lancée depuis le Catalogue'
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
                      <span className="text-text-secondary">{fmtDate(s.createdAt)}</span>
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
  )
}
