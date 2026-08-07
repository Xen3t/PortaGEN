'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import PhraseAttente from '@/components/PhraseAttente'

/**
 * Vue d'un lancement de gamme : toutes les tailles en grille, remplie en
 * direct (piliers → intégration chaînée, invisible pour l'utilisateur).
 * Le détail technique est sur la page de chaque image.
 * 28/07/2026 : validation des MES retirée (décision Mathias) — une image
 * terminée est simplement terminée.
 */

interface Job {
  id: number
  type: string
  status: string
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  error: string | null
  regenCount: number
  /** MES retenue de sa taille (générations multiples, 29/07/2026). */
  chosen?: boolean
}

interface Tile {
  label: string
  w: number
  h: number
  /** Coloris du lancement catalogue — null pour une gamme directe (sans coloris). */
  coloris: string | null
  pillars: Job
  integration: Job | null
  /** Numéro de génération (1..N) — 1 si génération unique. */
  variant: number
  /** Cette génération est la retenue de sa taille. */
  chosen: boolean
}

/** Lettre de nomenclature du job : B battant · C coulissant · P portillon. */
function lettreOf(job: Job): string {
  const m = job.payload?.moteur
  return m === 'coulissant' ? 'C' : m === 'portillon' ? 'P' : 'B'
}

function art(p: unknown, w?: number): string {
  const base = `/api/artifacts?p=${encodeURIComponent(String(p))}`
  return w ? `${base}&w=${w}` : base
}

function sizeOf(job: Job): { w: number; h: number } | null {
  const s = (job.payload?.size ?? null) as { w?: number; h?: number } | null
  return s && Number.isFinite(s.w) && Number.isFinite(s.h) ? { w: Number(s.w), h: Number(s.h) } : null
}

/** Numéro de génération d'un job (1 par défaut, génération unique). */
function varOf(job: Job): number {
  const v = job.payload?.variant
  return typeof v === 'number' && v >= 1 ? v : 1
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
    const colorisOf = (j: Job): string | null =>
      typeof j.payload?.coloris === 'string' ? (j.payload.coloris as string) : null
    const fromPillars = pillars
      .map((p): Tile | null => {
        const s = sizeOf(p)
        if (!s) return null
        const label = `${s.w}x${s.h}`
        // Générations multiples (29/07/2026) : l'intégration d'une taille doit
        // suivre SA génération — on apparie par n° de variante (à défaut, par
        // taille comme avant). Plusieurs intégrations (régénérations) : la plus
        // récente fait foi.
        const pv = varOf(p)
        const integ = integrations
          .filter((j) => {
            const js = sizeOf(j)
            if (!js || js.w !== s.w || js.h !== s.h) return false
            return varOf(j) === pv
          })
          .sort((a, b) => b.id - a.id)[0]
        return {
          label,
          w: s.w,
          h: s.h,
          coloris: colorisOf(p),
          pillars: p,
          integration: integ ?? null,
          variant: pv,
          chosen: !!integ?.chosen,
        }
      })
      .filter((t): t is Tile => t !== null)
    // « pose-fusion » (17/07/2026) et « decor-autour » (05/08/2026) : UN job = la
    // MES complète — il tient les deux rôles de la vignette (préparation ET
    // image finale). Le Journal admin lie « voir la gamme » sur TOUT batch.
    const fromPoseFusion = jobs
      .filter((j) => j.type === 'pose-fusion' || j.type === 'decor-autour')
      .map((p): Tile | null => {
        const s = sizeOf(p)
        return s
          ? {
              label: `${s.w}x${s.h}`,
              w: s.w,
              h: s.h,
              coloris: colorisOf(p),
              pillars: p,
              integration: p,
              variant: varOf(p),
              chosen: !!p.chosen,
            }
          : null
      })
      .filter((t): t is Tile => t !== null)
    return [...fromPillars, ...fromPoseFusion].sort((a, b) => a.w - b.w || a.h - b.h)
  }, [jobs])

  // RÈGLE PERMANENTE (rappel Mathias 22/07/2026) : blocs par coloris, une largeur
  // = UNE ligne, colonnes alignées par hauteur, taille absente = case vide
  // alignée — jamais de repli. Générations multiples (29/07/2026) : une CASE par
  // taille = la génération retenue (chosen) sinon la 1ʳᵉ ; les sœurs vivent dans
  // la page image (galerie). `count` = nb de générations de la case.
  const betterDisplay = (a: Tile, b: Tile): boolean => {
    if (a.chosen !== b.chosen) return a.chosen // la retenue gagne toujours
    if (a.variant !== b.variant) return a.variant < b.variant // sinon la 1ʳᵉ génération
    return a.pillars.id > b.pillars.id // égalité : la relance la plus récente
  }
  const blocs = useMemo(() => {
    const byColoris = new Map<string | null, Map<string, { display: Tile; count: number }>>()
    for (const t of tiles) {
      if (!byColoris.has(t.coloris)) byColoris.set(t.coloris, new Map())
      const cellules = byColoris.get(t.coloris)!
      const prev = cellules.get(t.label)
      if (!prev) {
        cellules.set(t.label, { display: t, count: 1 })
        continue
      }
      prev.count += 1
      if (betterDisplay(t, prev.display)) prev.display = t
    }
    return Array.from(byColoris.entries()).map(([coloris, cellules]) => {
      const list = [...cellules.values()].map((c) => c.display)
      return {
        coloris,
        cellules,
        widths: [...new Set(list.map((t) => t.w))].sort((a, b) => a - b),
        heights: [...new Set(list.map((t) => t.h))].sort((a, b) => a - b),
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles])

  // Compteurs PAR TAILLE (une case = une génération affichée), pas par génération.
  const slotCells = blocs.flatMap((b) => [...b.cellules.values()])
  const slotCount = slotCells.length
  const doneCount = slotCells.filter((c) => c.display.integration?.status === 'done').length
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

  if (notFound) {
    return (
      <p className="text-text-secondary">
        Gamme introuvable. <Link href="/" className="text-brand-teal hover:underline">Retour à l&apos;accueil</Link>
      </p>
    )
  }
  if (!jobs) return <p className="text-text-secondary anim-respire">Chargement…</p>

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <Link href="/" className="text-xs text-text-secondary hover:underline">
            ← Accueil
          </Link>
          <h1 className="text-xl font-semibold">
            Gamme {gammeName ?? 'de portails'}{' '}
            <span className="text-text-disabled font-normal">· {slotCount} tailles</span>
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {decorName && <>Décor : <b className="font-medium">{decorName}</b> — </>}
            {pending
              ? `génération en cours, ${doneCount}/${slotCount} images prêtes (la page se met à jour toute seule).`
              : `${doneCount}/${slotCount} images terminées.`}
          </p>
        </div>
      </div>

      {notice && (
        <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-5">
          {notice}
        </div>
      )}

      {/* RÈGLE PERMANENTE (rappel Mathias 22/07/2026) : un bloc par coloris, une
          largeur = UNE ligne, colonnes alignées par hauteur, taille absente =
          case vide alignée — jamais de repli, quel que soit le nombre de tailles. */}
      <div className="space-y-8">
        {blocs.map((b) => (
          <section key={b.coloris ?? 'sans-coloris'}>
            {b.coloris && <h2 className="text-[15px] font-bold mb-3">{b.coloris}</h2>}
            <div className="space-y-5">
              {b.widths.map((w) => (
                <div key={w}>
                  <h3 className="text-sm font-semibold text-text-secondary mb-2">
                    Largeur {w} cm
                  </h3>
                  <div
                    className="grid gap-4"
                    style={{ gridTemplateColumns: `repeat(${b.heights.length}, minmax(0, 1fr))` }}
                  >
                    {b.heights.map((h) => {
                      const cell = b.cellules.get(`${w}x${h}`)
                      if (!cell) {
                        // Taille absente de ce lancement : case vide alignée.
                        return (
                          <div
                            key={h}
                            aria-hidden
                            className="rounded-[12px] border-2 border-dashed border-border/60 min-h-[120px]"
                          />
                        )
                      }
          const t = cell.display
          const nVar = cell.count
          const integ = t.integration
          const finalDone = integ?.status === 'done'
          const image = finalDone
            ? (integ!.result?.compositePath ?? integ!.result?.deliveryPath)
            : t.pillars.status === 'done'
              ? t.pillars.result?.compositePath
              : null
          const detailId = integ?.id ?? t.pillars.id
          // « phrases » : état d'attente → faux texte tournant à la place du statut fixe.
          const stage: { text: string; tone: string; phrases?: boolean } =
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
                  ? { text: 'préparation du décor…', tone: 'text-text-secondary', phrases: true }
                  : !integ
                    ? t.pillars.payload?.productPath
                      ? { text: 'pose du portail en attente…', tone: 'text-text-secondary', phrases: true }
                      : { text: 'décor prêt (pas de portail fourni)', tone: 'text-text-secondary' }
                    : integ.status !== 'done'
                      ? { text: 'pose du portail en cours…', tone: 'text-text-secondary', phrases: true }
                      : { text: '✓ terminée', tone: 'text-brand-green font-medium' }
          return (
            <div key={h} className="bg-white rounded-[12px] border border-border shadow-sm overflow-hidden hover:shadow-default hover:translate-y-[-1px] transition-all duration-200">
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
                  {`${t.w}${lettreOf(t.pillars)}${t.h}`}
                  {t.coloris ? ` · ${t.coloris}` : ''}
                </span>
                {finalDone && (
                  <span className="absolute top-2 right-2 bg-white/90 text-[10px] px-1.5 py-0.5 rounded text-text-secondary">
                    finale
                  </span>
                )}
                {nVar > 1 && (
                  <span
                    title={`${nVar} générations — ouvre pour comparer et en choisir une`}
                    className={`absolute bottom-2 left-2 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      t.chosen ? 'bg-brand-green text-white' : 'bg-black/75 text-white'
                    }`}
                  >
                    {t.chosen ? `✓ retenue · ${nVar}` : `▦ ${nVar} générations`}
                  </span>
                )}
              </Link>
              <div className="px-3 py-2 flex items-center justify-between gap-2">
                <span className={`text-xs ${stage.tone}`}>
                  {stage.phrases ? <PhraseAttente /> : stage.text}
                </span>
                <div className="flex items-center gap-1 shrink-0">
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
                </div>
              ))}
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
