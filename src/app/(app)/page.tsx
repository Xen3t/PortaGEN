'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import SessionCards from './generation/SessionCards'
import { SilhouetteModeIcone, type Mode } from './Silhouette'
import Chargement from '@/components/Chargement'

/**
 * ACCUEIL — page d'arrivée (navigation v2 validée le 12/07/2026) :
 * mes sessions (directes + gammes), mes dernières générations et mes
 * notifications, filtrées sur la marque active.
 *
 * 13/07/2026 (maquette sessions-v2) : la page Production a été SUPPRIMÉE —
 * les lancements de gamme sont des sessions comme les autres, affichées ici.
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

const TYPE_LABELS: Record<string, string> = {
  decor: 'Décor',
  'decor-fix': 'Correction de décor',
  pillars: 'Piliers',
  integration: 'Intégration',
}

function art(p: unknown, w?: number): string {
  const base = `/api/artifacts?p=${encodeURIComponent(String(p))}`
  return w ? `${base}&w=${w}` : base
}

function jobImage(j: Job): string | null {
  const r = j.result ?? {}
  const p = (r.deliveryPath ?? r.compositePath ?? r.imagePath) as string | undefined
  return p ? art(p, 160) : null
}

function jobLabel(j: Job): string {
  const size = j.payload?.size
  const sizeLabel =
    typeof size === 'string'
      ? size
      : size && typeof size === 'object'
        ? `${(size as Record<string, unknown>).w ?? ''}x${(size as Record<string, unknown>).h ?? ''}`
        : ''
  return [TYPE_LABELS[j.type] ?? j.type, sizeLabel].filter(Boolean).join(' · ')
}

function statusBadge(j: Job): { text: string; cls: string } {
  if (j.status === 'queued' || j.status === 'running') {
    return { text: '⏳ en cours', cls: 'text-brand-teal anim-respire' }
  }
  if (j.status === 'error') return { text: '✗ en erreur', cls: 'text-brand-red' }
  if (j.status === 'cancelled') return { text: 'annulée', cls: 'text-text-disabled' }
  if (j.reviewStatus === 'approved') return { text: '✓ validée', cls: 'text-brand-green' }
  if (j.reviewStatus === 'rejected') return { text: 'rejetée', cls: 'text-text-disabled' }
  return { text: '✓ terminé — à valider', cls: 'text-brand-green' }
}

function fmtDate(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
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

  // Plus de « X à valider » (décision Mathias 13/07/2026) : pas validé =
  // simplement ignoré. Les notifications ne gardent que les échecs.
  const failed = data ? data.jobs.filter((j) => j.status === 'error') : []

  return (
    <div className="grid gap-4">
      {/* Les 3 actions au-dessus des sessions (rework 22/07/2026, validé par
          Mathias — maquette generer-depuis-catalogue-v2) : MES Contrainte,
          MES Libre, MES Décors. L'Accueil ne change pas au-delà de cette rangée. */}
      <div className="stagger grid md:grid-cols-3 gap-3.5">
        {(
          [
            {
              href: '/generation?mode=contrainte',
              mode: 'contrainte' as Mode,
              titre: 'MES Contrainte',
              sous: 'catalogue ou images, décor imposé',
            },
            {
              href: '/generation?mode=libre',
              mode: 'libre' as Mode,
              titre: 'MES Libre',
              sous: 'génération libre (WIP)',
            },
            {
              href: '/decors',
              mode: 'decors' as Mode,
              titre: 'MES Décors',
              sous: 'créer et gérer les décors',
            },
          ] as const
        ).map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex items-center gap-3.5 bg-white rounded-[12px] border-[1.5px] border-border shadow-sm px-5 py-4 transition-all hover:border-brand-green hover:shadow-md hover:-translate-y-0.5"
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
          validée le 13/07/2026). 3 max sur l'accueil (demande Mathias) —
          masqué tant qu'il n'y en a aucune. Monté SANS attendre /api/accueil :
          les deux appels partent en parallèle, les cartes arrivent plus vite. */}
      <SessionCards limit={3} hideWhenEmpty allLink />

      {!data ? (
        <Chargement />
      ) : (
      <div className="grid grid-cols-[1.6fr_1fr] max-md:grid-cols-1 gap-4 items-start">
      <section className="bg-white rounded-[12px] border border-border shadow-sm p-5">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-3">
          Mes dernières générations
        </h2>
        {data.jobs.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Vous n&apos;avez encore rien généré. Passez par le{' '}
            <Link href="/catalogue" className="text-brand-green font-semibold hover:underline">
              Catalogue
            </Link>{' '}
            ou par la{' '}
            <Link href="/generation" className="text-brand-green font-semibold hover:underline">
              Génération
            </Link>
            .
          </p>
        ) : (
          data.jobs.map((j) => {
            const badge = statusBadge(j)
            const img = jobImage(j)
            return (
              <Link
                key={j.id}
                href={`/production/image/${j.id}`}
                className="flex items-center gap-3 py-2 border-b border-border last:border-b-0 text-sm hover:bg-surface transition-colors px-1 rounded"
              >
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={img}
                    alt=""
                    className="w-[52px] h-[34px] object-cover rounded border border-border flex-none"
                    loading="lazy"
                  />
                ) : (
                  <span className="w-[52px] h-[34px] rounded border border-border bg-surface flex-none" />
                )}
                <span className="font-semibold">{jobLabel(j)}</span>
                <span className="text-xs text-text-secondary">{fmtDate(j.createdAt)}</span>
                <span className={`ml-auto text-xs font-bold ${badge.cls}`}>{badge.text}</span>
              </Link>
            )
          })
        )}
      </section>

      <section className="bg-white rounded-[12px] border border-border shadow-sm p-5">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-3">
          Notifications
        </h2>
        {failed.length === 0 ? (
          <p className="text-sm text-text-secondary">Rien à signaler.</p>
        ) : (
          <div className="grid gap-1">
            {failed.map((j) => (
              <Link
                key={j.id}
                href={`/production/image/${j.id}`}
                className="text-sm py-2 border-b border-border last:border-b-0 block hover:bg-surface px-1 rounded transition-colors"
              >
                <b className="text-brand-red">Échec</b>{' '}
                <span className="text-text-secondary">
                  {jobLabel(j)} · {fmtDate(j.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
      </div>
      )}
    </div>
  )
}
