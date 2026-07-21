'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

/**
 * Vue d'un lancement de gamme : toutes les tailles en grille, remplie en
 * direct (piliers → intégration chaînée, invisible pour l'utilisateur).
 * Validation par vignette et « Tout valider » — le détail technique est sur la
 * page de chaque image.
 */

interface Job {
  id: number
  type: string
  status: string
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  error: string | null
  regenCount: number
  reviewStatus: string
}

interface Tile {
  label: string
  w: number
  h: number
  pillars: Job
  integration: Job | null
}

function art(p: unknown, w?: number): string {
  const base = `/api/artifacts?p=${encodeURIComponent(String(p))}`
  return w ? `${base}&w=${w}` : base
}

function sizeOf(job: Job): { w: number; h: number } | null {
  const s = (job.payload?.size ?? null) as { w?: number; h?: number } | null
  return s && Number.isFinite(s.w) && Number.isFinite(s.h) ? { w: Number(s.w), h: Number(s.h) } : null
}

export default function GammeBatchPage() {
  const { batchId } = useParams<{ batchId: string }>()
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [decorName, setDecorName] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/gamme/${batchId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setJobs(d.jobs ?? []))
      .catch(() => setNotFound(true))
  }, [batchId])

  useEffect(() => {
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [load])

  const tiles: Tile[] = useMemo(() => {
    if (!jobs) return []
    const pillars = jobs.filter((j) => j.type === 'pillars')
    const integrations = jobs.filter((j) => j.type === 'integration')
    const fromPillars = pillars
      .map((p): Tile | null => {
        const s = sizeOf(p)
        if (!s) return null
        const label = `${s.w}x${s.h}`
        // Plusieurs intégrations possibles (régénérations) : la plus récente fait foi.
        const integ = integrations
          .filter((j) => {
            const js = sizeOf(j)
            return js && js.w === s.w && js.h === s.h
          })
          .sort((a, b) => b.id - a.id)[0]
        return { label, w: s.w, h: s.h, pillars: p, integration: integ ?? null }
      })
      .filter((t): t is Tile => t !== null)
    // « pose-fusion » (17/07/2026) : UN job = la MES complète — il tient les deux
    // rôles de la vignette (préparation ET image finale).
    const fromPoseFusion = jobs
      .filter((j) => j.type === 'pose-fusion')
      .map((p): Tile | null => {
        const s = sizeOf(p)
        return s ? { label: `${s.w}x${s.h}`, w: s.w, h: s.h, pillars: p, integration: p } : null
      })
      .filter((t): t is Tile => t !== null)
    return [...fromPillars, ...fromPoseFusion].sort((a, b) => a.w - b.w || a.h - b.h)
  }, [jobs])

  const doneCount = tiles.filter((t) => t.integration?.status === 'done').length
  const approvedCount = tiles.filter((t) => t.integration?.reviewStatus === 'approved').length
  const pending = tiles.some(
    (t) =>
      t.pillars.status === 'queued' ||
      t.pillars.status === 'running' ||
      (t.integration && (t.integration.status === 'queued' || t.integration.status === 'running')) ||
      (!t.integration && t.pillars.status === 'done' && t.pillars.payload?.productPath)
  )

  // Nom lisible de la gamme produit (dossier du visuel) — pas le slug technique
  const gammeName = useMemo(() => {
    for (const j of jobs ?? []) {
      const p = String(j.payload?.productPath ?? '')
      if (!p) continue
      const parts = p.split(/[\\/]/)
      const i = parts.indexOf('products')
      if (i >= 0 && i + 2 < parts.length) return parts[i + 1]
    }
    return null
  }, [jobs])

  // Nom lisible du décor (bibliothèque), retrouvé par son chemin
  const decorPath = String(tiles[0]?.pillars.payload?.decorPath ?? '')
  useEffect(() => {
    if (!decorPath) return
    fetch(`/api/decors/by-path?p=${encodeURIComponent(decorPath)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.decor?.name) setDecorName(d.decor.name)
      })
      .catch(() => {})
  }, [decorPath])

  async function review(job: Job, action: 'approve' | 'reject') {
    setBusy(true)
    await fetch(`/api/jobs/${job.id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setBusy(false)
    load()
  }

  async function cancel(job: Job) {
    setBusy(true)
    const res = await fetch(`/api/jobs/${job.id}/cancel`, { method: 'POST' })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) setNotice(data?.error ?? 'Annulation impossible')
    load()
  }

  async function regen(job: Job) {
    setBusy(true)
    setNotice(null)
    const res = await fetch(`/api/jobs/${job.id}/regen`, { method: 'POST' })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) setNotice(data?.error ?? 'Régénération impossible')
    load()
  }

  async function approveAll() {
    const targets = tiles.filter(
      (t) => t.integration?.status === 'done' && t.integration.reviewStatus !== 'approved'
    )
    if (targets.length === 0) return
    if (!window.confirm(`Valider les ${targets.length} images terminées de cette gamme ?`)) return
    setBusy(true)
    for (const t of targets) {
      await fetch(`/api/jobs/${t.integration!.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
    }
    setBusy(false)
    load()
  }

  if (notFound) {
    return (
      <p className="text-text-secondary">
        Gamme introuvable. <Link href="/" className="text-brand-teal hover:underline">Retour à l&apos;accueil</Link>
      </p>
    )
  }
  if (!jobs) return <p className="text-text-secondary">Chargement…</p>

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <Link href="/" className="text-xs text-text-secondary hover:underline">
            ← Accueil
          </Link>
          <h1 className="text-xl font-semibold">
            Gamme {gammeName ?? 'de portails'}{' '}
            <span className="text-text-disabled font-normal">· {tiles.length} tailles</span>
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {decorName && <>Décor : <b className="font-medium">{decorName}</b> — </>}
            {pending
              ? `génération en cours, ${doneCount}/${tiles.length} images prêtes (la page se met à jour toute seule).`
              : `${doneCount}/${tiles.length} images · ${approvedCount} validée${approvedCount > 1 ? 's' : ''}.`}
          </p>
        </div>
        <button
          onClick={approveAll}
          disabled={busy || tiles.every((t) => t.integration?.status !== 'done' || t.integration.reviewStatus === 'approved')}
          className="bg-brand-green text-white rounded-[10px] px-5 py-2.5 font-bold hover:bg-brand-green-hover hover:shadow-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ✓ Tout valider ({tiles.filter((t) => t.integration?.status === 'done' && t.integration.reviewStatus !== 'approved').length})
        </button>
      </div>

      {notice && (
        <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-5">
          {notice}
        </div>
      )}

      {/* Une rangée par largeur (retour à la ligne à chaque changement de largeur) */}
      <div className="space-y-6">
        {[...new Set(tiles.map((t) => t.w))].sort((a, b) => a - b).map((w) => (
          <section key={w}>
            <h2 className="text-sm font-semibold text-text-secondary mb-2">
              Largeur {w} cm
              <span className="font-normal text-text-disabled"> · {tiles.filter((t) => t.w === w).length} taille{tiles.filter((t) => t.w === w).length > 1 ? 's' : ''}</span>
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {tiles.filter((t) => t.w === w).map((t) => {
          const integ = t.integration
          const finalDone = integ?.status === 'done'
          const image = finalDone
            ? (integ!.result?.compositePath ?? integ!.result?.deliveryPath)
            : t.pillars.status === 'done'
              ? t.pillars.result?.compositePath
              : null
          const detailId = integ?.id ?? t.pillars.id
          const stage =
            t.pillars.status === 'cancelled' || integ?.status === 'cancelled'
              ? { text: 'annulée', tone: 'text-text-disabled' }
              : t.pillars.status === 'error'
              ? {
                  // Vignette pose-fusion : un seul job, l'erreur est celle de la génération entière.
                  text: t.pillars.id === integ?.id ? '⚠ erreur (génération)' : '⚠ erreur (décor + maçonnerie)',
                  tone: 'text-brand-red',
                }
              : integ?.status === 'error'
                ? { text: '⚠ erreur (pose du portail)', tone: 'text-brand-red' }
                : t.pillars.status !== 'done'
                  ? { text: 'préparation du décor…', tone: 'text-text-secondary animate-pulse' }
                  : !integ
                    ? t.pillars.payload?.productPath
                      ? { text: 'pose du portail en attente…', tone: 'text-text-secondary animate-pulse' }
                      : { text: 'décor prêt (pas de portail fourni)', tone: 'text-text-secondary' }
                    : integ.status !== 'done'
                      ? { text: 'pose du portail en cours…', tone: 'text-text-secondary animate-pulse' }
                      : integ.reviewStatus === 'approved'
                        ? { text: '✓ validée', tone: 'text-brand-green font-medium' }
                        : integ.reviewStatus === 'rejected'
                          ? { text: '✗ rejetée', tone: 'text-brand-red font-medium' }
                          : { text: 'à vérifier', tone: 'text-brand-teal font-medium' }
          return (
            <div key={t.label} className="bg-white rounded-[12px] border border-border shadow-sm overflow-hidden hover:shadow-default hover:translate-y-[-1px] transition-all duration-200">
              <Link href={`/production/image/${detailId}`} className="block relative">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={art(image, 480)}
                    alt={t.label}
                    loading="lazy"
                    decoding="async"
                    className="w-full aspect-[3/2] object-cover"
                  />
                ) : (
                  <div className="w-full aspect-[3/2] bg-surface flex items-center justify-center">
                    {t.pillars.status === 'error' || integ?.status === 'error' ? (
                      <span className="text-brand-red text-2xl">⚠</span>
                    ) : (
                      <div className="animate-spin h-7 w-7 border-4 border-border border-t-brand-teal rounded-full" />
                    )}
                  </div>
                )}
                <span className="absolute top-2 left-2 bg-black/75 text-white text-xs px-2 py-0.5 rounded-md font-medium">
                  {t.label}
                </span>
                {finalDone && (
                  <span className="absolute top-2 right-2 bg-white/90 text-[10px] px-1.5 py-0.5 rounded text-text-secondary">
                    finale
                  </span>
                )}
              </Link>
              <div className="px-3 py-2 flex items-center justify-between gap-2">
                <span className={`text-xs ${stage.tone}`}>{stage.text}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {finalDone && integ!.reviewStatus !== 'approved' && (
                    <button
                      onClick={() => review(integ!, 'approve')}
                      disabled={busy}
                      title="Valider cette image"
                      className="border border-brand-green/40 text-brand-green rounded-[8px] px-2 py-1 text-xs hover:bg-brand-green-light transition-colors disabled:opacity-40"
                    >
                      ✓
                    </button>
                  )}
                  {finalDone && integ!.reviewStatus !== 'rejected' && (
                    <button
                      onClick={() => review(integ!, 'reject')}
                      disabled={busy}
                      title="Rejeter cette image"
                      className="border border-brand-red/40 text-brand-red rounded-[8px] px-2 py-1 text-xs hover:bg-brand-red-light transition-colors disabled:opacity-40"
                    >
                      ✗
                    </button>
                  )}
                  {(t.pillars.status === 'queued' || integ?.status === 'queued') && (
                    <button
                      onClick={() => cancel(integ?.status === 'queued' ? integ : t.pillars)}
                      disabled={busy}
                      title="Annuler (la génération en file ne sera pas exécutée)"
                      className="border border-border text-text-secondary rounded-[8px] px-2 py-1 text-xs transition-colors hover:bg-brand-red-light hover:border-brand-red/40 hover:text-brand-red disabled:opacity-40"
                    >
                      ✕
                    </button>
                  )}
                  {(finalDone || integ?.status === 'error' || t.pillars.status === 'error') && (
                    <button
                      onClick={() => regen(integ?.status === 'error' || finalDone ? integ! : t.pillars)}
                      disabled={busy}
                      title={`Régénérer (${(integ ?? t.pillars).regenCount}/10)`}
                      className="border border-border text-text-secondary rounded-[8px] px-2 py-1 text-xs hover:bg-surface transition-colors disabled:opacity-40"
                    >
                      ↻
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
            </div>
          </section>
        ))}
      </div>
      <p className="text-xs text-text-disabled mt-4">
        Cliquez une vignette pour la voir en grand, la corriger ou consulter le détail. Une
        régénération relance automatiquement toute la chaîne pour cette taille.
      </p>
    </div>
  )
}
