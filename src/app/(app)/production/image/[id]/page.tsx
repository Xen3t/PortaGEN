'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { isMesRoot } from '@/lib/mesVariants'
import { parseSizeFromProductName } from '@/lib/productName'
import DecorStudio from '@/components/DecorStudio'
import PhraseAttente from '@/components/PhraseAttente'

/**
 * Détail d'une image (refonte UX 10/07/2026) : l'image finale en grand, les
 * actions (régénérer, corriger) au premier plan, et tout le détail technique
 * (étapes du pipeline, métriques) replié par défaut.
 * 28/07/2026 : valider/rejeter ne concerne plus que les décors (l'approbation
 * admin rend le décor actif en bibliothèque) — retiré des MES.
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
  batchId: string | null
  createdAt: string
  /** MES retenue de sa taille (générations multiples, 29/07/2026). */
  chosen?: boolean
}

/** Une génération sœur (même taille/coloris du même lot) pour la galerie. */
interface SiblingVariant {
  id: number
  n: number
  status: string
  image: string | null
  chosen: boolean
}

/** Clé de la « case » d'une taille : coloris + taille (générations multiples). */
function slotKeyOf(payload: Record<string, unknown> | null): string {
  const col = String((payload?.coloris as string) ?? '').toLowerCase()
  const size = payload?.size as { w?: number; h?: number } | undefined
  return `${col}|${size?.w ?? '?'}x${size?.h ?? '?'}`
}
function variantNoOf(payload: Record<string, unknown> | null): number {
  const v = payload?.variant
  return typeof v === 'number' && v >= 1 ? v : 1
}
function mesImageOf(r: Record<string, unknown> | null): string | null {
  const s = (k: string) => (typeof r?.[k] === 'string' ? (r[k] as string) : null)
  return s('compositePath') ?? s('rawOutputPath') ?? s('deliveryPath')
}
// MES racine : prédicat PARTAGÉ (mesVariants) — la copie locale avait oublié
// « decor-autour » (05/08/2026) et privait le nouveau mode de sa galerie de
// générations sœurs et du bouton « choisir ».
const isMesRootType = isMesRoot

const STATUS_FR: Record<string, string> = {
  queued: 'en file d’attente',
  running: 'en cours',
  done: 'terminée',
  error: 'en erreur',
  cancelled: 'annulée',
}
const REVIEW_FR: Record<string, string> = {
  pending: 'à valider',
  approved: 'validée',
  rejected: 'rejetée',
}

function art(p: unknown, w?: number): string {
  const base = `/api/artifacts?p=${encodeURIComponent(String(p))}`
  return w ? `${base}&w=${w}` : base
}

export default function ImageDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [job, setJob] = useState<Job | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [showTech, setShowTech] = useState(false)
  const [studioDecorId, setStudioDecorId] = useState<number | null>(null)
  const [decorId, setDecorId] = useState<number | null>(null)
  const [instruction, setInstruction] = useState('')
  const [siblings, setSiblings] = useState<SiblingVariant[]>([])

  const load = useCallback(() => {
    fetch(`/api/jobs/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setJob(d.job ?? null)
        if (d.role) setIsAdmin(d.role === 'admin')
      })
  }, [id])

  useEffect(() => {
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [load])

  // Générations multiples (29/07/2026) : les sœurs de la MES (même taille/coloris
  // du même lot) pour la galerie + le choix de la génération retenue. Rechargées
  // à chaque poll du job (chosen tenu à jour).
  useEffect(() => {
    if (!job || !job.batchId || !isMesRootType(job.type)) {
      setSiblings([])
      return
    }
    let alive = true
    const key = slotKeyOf(job.payload)
    fetch(`/api/gamme/${job.batchId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !Array.isArray(d?.jobs)) return
        const vs: SiblingVariant[] = (d.jobs as Job[])
          .filter((j) => isMesRootType(j.type) && slotKeyOf(j.payload) === key)
          .map((j) => ({
            id: j.id,
            n: variantNoOf(j.payload),
            status: j.status,
            image: mesImageOf(j.result),
            chosen: !!j.chosen,
          }))
          .sort((a, b) => a.n - b.n || a.id - b.id)
        setSiblings(vs)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [job])

  /** Désigne cette génération comme la MES retenue de sa taille (persisté). */
  async function chooseGen() {
    if (!job) return
    setBusy(true)
    setNotice(null)
    const res = await fetch(`/api/jobs/${job.id}/choose`, { method: 'POST' })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok) load()
    else setNotice(data?.error ?? 'Choix impossible')
  }

  // Job décor terminé → on retrouve le décor en bibliothèque (decorId direct,
  // ou par le chemin de l'image pour les jobs antérieurs) pour corriger sur place.
  useEffect(() => {
    if (!job || job.status !== 'done') return
    if (job.type !== 'decor' && job.type !== 'decor-fix') return
    const res = job.result ?? {}
    const direct =
      Number(res.decorId ?? (job.payload as { decorId?: number } | null)?.decorId) || null
    if (direct) {
      setDecorId(direct)
      return
    }
    if (res.imagePath) {
      fetch(`/api/decors/by-path?p=${encodeURIComponent(String(res.imagePath))}`)
        .then((r2) => (r2.ok ? r2.json() : null))
        .then((d) => {
          if (d?.decor?.id) setDecorId(d.decor.id)
        })
    }
  }, [job])

  /** Correction par prompt, directement depuis la page. */
  async function correct() {
    if (!decorId || !instruction.trim()) return
    setBusy(true)
    setNotice(null)
    const res = await fetch(`/api/decors/${decorId}/correct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: instruction.trim() }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok) {
      router.push(`/production/image/${data.jobId}`)
    } else {
      setNotice(data?.error ?? 'Correction impossible')
    }
  }

  async function review(action: 'approve' | 'reject') {
    setBusy(true)
    const res = await fetch(`/api/jobs/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setBusy(false)
    if (res.ok) load()
  }

  async function regen() {
    setBusy(true)
    setNotice(null)
    const res = await fetch(`/api/jobs/${id}/regen`, { method: 'POST' })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok) load()
    else setNotice(data?.error ?? 'Régénération impossible')
  }

  if (!job) {
    return <p className="text-text-secondary anim-respire">Chargement…</p>
  }

  const r = job.result ?? {}
  const isPillars = job.type === 'pillars'
  const isIntegration = job.type === 'integration'
  // « pose-fusion » (chantier 17/07/2026) : un seul job = MES finale.
  const isPoseFusion = job.type === 'pose-fusion'
  const isDecorJob = job.type === 'decor' || job.type === 'decor-fix'
  const size = (job.payload?.size as { w: number; h: number } | undefined) ?? undefined
  const sizeLabel = size ? `${size.w}×${size.h}` : ''
  const title = isPillars
    ? `Décor + maçonnerie ${sizeLabel}`
    : isIntegration || isPoseFusion
      ? `Image finale ${sizeLabel}`
      : job.type === 'decor-fix'
        ? 'Correction de décor'
        : `Décor — ${String(job.payload?.slug ?? '')}`

  // Méthode « simple » : pas de composite, la sortie brute du modèle est l'image finale.
  const finalImage = isIntegration
    ? (r.compositePath ?? r.rawOutputPath ?? r.deliveryPath)
    : isPoseFusion
      ? (r.rawOutputPath ?? r.deliveryPath)
      : isPillars
        ? r.compositePath
        : r.imagePath

  const pillarInfo =
    (r.productPillars as {
      applied?: boolean
      reason?: string
      leftPx?: number
      rightPx?: number
    } | null) ?? null

  const steps: { label: string; path: unknown }[] = isPillars
    ? [
        { label: '1 · Entrée (décor + aplats)', path: r.overlayPath },
        { label: '2 · Masque pixel-lock', path: r.maskPath },
        { label: '3 · Sortie brute Nano Banana', path: r.rawOutputPath },
        { label: '4 · Image finale de l’étape', path: r.compositePath },
      ]
    : isIntegration
      ? r.method === 'simple'
        ? [
            { label: '1 · Entrée envoyée (rectangle rouge du gabarit)', path: r.inputPath },
            { label: '2 · Sortie brute Nano Banana (image finale)', path: r.rawOutputPath },
            { label: '3 · Livraison 2000×1330', path: r.deliveryPath },
          ]
        : [
            { label: '0 · Détourage produit (rouge = piliers du visuel retirés)', path: r.detourPath },
            { label: '1 · Référence de contrôle (position/taille théoriques)', path: r.placedPath },
            { label: '2 · Entrée envoyée (rectangle rouge)', path: r.inputPath },
            { label: '3 · Masque pixel-lock + ombres', path: r.maskPath },
            { label: '4 · Sortie brute Nano Banana', path: r.rawOutputPath },
            { label: '5 · Composite final (natif)', path: r.compositePath },
            { label: '6 · Livraison 2000×1330', path: r.deliveryPath },
          ]
      : isPoseFusion
        ? [
            { label: '1 · Entrée envoyée (décor + aplats + produit posé)', path: r.posedInputPath },
            { label: '2 · Sortie brute Nano Banana (image finale)', path: r.rawOutputPath },
            { label: '3 · Livraison 2000×1330', path: r.deliveryPath },
          ]
        : [
            { label: 'Canny envoyé', path: r.cannySentPath },
            { label: 'Décor généré', path: r.imagePath },
          ]

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xs text-text-secondary hover:underline">
              ← Accueil
            </Link>
            {job.batchId && (
              <Link href={`/production/gamme/${job.batchId}`} className="text-xs text-brand-teal hover:underline">
                ▦ voir toute la gamme
              </Link>
            )}
          </div>
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="bg-white border border-border text-text-secondary px-2.5 py-1 rounded-full font-semibold">
            {STATUS_FR[job.status] ?? job.status}
          </span>
          {job.status === 'done' && (job.type === 'decor' || job.type === 'decor-fix') && (
            <span
              className={`px-2.5 py-1 rounded-full font-semibold ${
                job.reviewStatus === 'approved'
                  ? 'bg-brand-green-light text-brand-green'
                  : job.reviewStatus === 'rejected'
                    ? 'bg-brand-red-light text-brand-red'
                    : 'bg-brand-teal-light text-brand-teal'
              }`}
            >
              {REVIEW_FR[job.reviewStatus] ?? job.reviewStatus}
            </span>
          )}
          {job.regenCount > 0 && (
            <span className="bg-white border border-border text-text-secondary px-2.5 py-1 rounded-full font-semibold">
              {job.regenCount}/10 régénérations
            </span>
          )}
        </div>
      </div>

      {job.error && (
        <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-5">
          {job.error}
        </div>
      )}
      {notice && (
        <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-5">
          {notice}
        </div>
      )}

      {(job.status === 'queued' || job.status === 'running') && (
        <div className="bg-white rounded-[12px] border border-border shadow-sm p-16 text-center text-text-secondary mb-6">
          <div className="animate-spin h-8 w-8 border-4 border-border border-t-brand-teal rounded-full mx-auto mb-4" />
          <div className="font-medium"><PhraseAttente /></div>
          <p className="text-xs mt-1">La page se met à jour automatiquement.</p>
        </div>
      )}

      {job.status === 'done' && (
        <>
          {/* L'image, en grand */}
          {finalImage ? (
            <figure className="bg-white rounded-[12px] border border-border shadow-sm overflow-hidden mb-5">
              <button onClick={() => setZoom(String(finalImage))} className="block w-full cursor-zoom-in">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={art(finalImage)} alt={title} className="w-full" />
              </button>
            </figure>
          ) : (
            <div className="bg-white rounded-[12px] border border-border shadow-sm p-10 text-center text-text-secondary mb-5">
              Pas d&apos;image à afficher pour cette génération.
            </div>
          )}

          {/* Générations de la taille (29/07/2026) : galerie des sœurs + choix de
              la MES retenue. Une seule génération → rien (comportement classique). */}
          {isMesRootType(job.type) && siblings.length > 1 && (
            <section className="bg-white rounded-[12px] border border-border shadow-sm p-4 mb-5">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <h2 className="text-sm font-semibold">
                  ▦ Générations de cette taille{' '}
                  <span className="text-text-secondary font-normal">({siblings.length})</span>
                </h2>
                <span className="text-xs text-text-secondary">
                  clique pour comparer, choisis la génération à garder
                </span>
                <button
                  onClick={chooseGen}
                  disabled={busy || !!job.chosen}
                  className="ml-auto bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
                >
                  {job.chosen ? '✓ Génération retenue' : 'Choisir cette génération'}
                </button>
              </div>
              <div className="flex gap-3 overflow-x-auto">
                {siblings.map((v) => {
                  const on = v.id === job.id
                  return (
                    <button
                      key={v.id}
                      onClick={() => !on && router.push(`/production/image/${v.id}`)}
                      title={`Génération ${v.n}`}
                      className={`shrink-0 w-[150px] rounded-[8px] overflow-hidden border-2 text-left bg-white relative ${
                        on
                          ? 'border-brand-teal'
                          : v.chosen
                            ? 'border-brand-green'
                            : 'border-border hover:border-brand-green/50'
                      }`}
                    >
                      {v.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={art(v.image, 300)}
                          alt={`Génération ${v.n}`}
                          loading="lazy"
                          decoding="async"
                          className="w-full aspect-[3/2] object-cover bg-surface"
                        />
                      ) : (
                        <span className="w-full aspect-[3/2] grid place-items-center bg-surface text-[11px] text-text-disabled">
                          {v.status === 'queued' || v.status === 'running'
                            ? 'en cours…'
                            : v.status === 'error'
                              ? 'échec'
                              : `Génération ${v.n}`}
                        </span>
                      )}
                      {v.chosen && (
                        <span className="absolute top-1.5 right-1.5 bg-brand-green text-white text-[10px] font-bold px-1.5 py-px rounded-full">
                          Retenue
                        </span>
                      )}
                      <span className="block px-2 py-1 text-[11.5px]">
                        <b>Génération {v.n}</b>
                        <span className="block text-text-disabled truncate">
                          {on ? 'affichée' : v.chosen ? 'retenue' : 'voir'}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* Alertes qualité — visibles, elles aident à juger l'image */}
          {isIntegration && pillarInfo && !pillarInfo.applied && pillarInfo.reason !== 'aucun-pilier' && (
            <div className="bg-brand-teal-light text-brand-teal text-sm rounded-[8px] px-4 py-3 mb-4">
              ⚠ Le visuel produit semble contenir ses propres piliers, mais ils n’ont pas été
              retirés (
              {pillarInfo.reason === 'ratio-degrade'
                ? 'la découpe donnerait des proportions incohérentes avec la taille demandée'
                : 'détection ambiguë — ex. portail clair sur piliers clairs'}
              ) : le visuel a été utilisé tel quel. Vérifiez l’image, ou fournissez un PNG du
              portail seul.
            </div>
          )}
          {isDecorJob && Number(r.corridorGreenFraction) > 0.08 && (
            <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-4">
              ⚠ Couloir d’allée non conforme :{' '}
              {(Number(r.corridorGreenFraction) * 100).toFixed(1)} % de végétation près de la
              ligne du portail. Régénérez le décor avant de lancer une gamme.
            </div>
          )}
          {isIntegration && r.hingeFallback === true && (
            <div className="bg-brand-teal-light text-brand-teal text-sm rounded-[8px] px-4 py-3 mb-4">
              ⚠ Dépassement de gonds anormal détecté sur le visuel produit : un espace
              portail/piliers peut réapparaître — vérifiez l’image.
            </div>
          )}
          {isIntegration && r.deformationWarning === true && (
            <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-4">
              ⚠ Les proportions du visuel produit ne correspondent pas à la taille{' '}
              {String(r.sizeLabel)} ({(Number(r.ratioDeviation) * 100).toFixed(0)} % d’écart) —
              vérifiez que le bon fichier a été utilisé.
            </div>
          )}
          {isIntegration && r.invarianceOk === false && (
            <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-4">
              ⚠ Le produit a peut-être été altéré par la génération (ressemblance{' '}
              {((Number(r.invarianceScore) || 0) * 100).toFixed(1)} %) — comparez avec le visuel
              d’origine avant d’utiliser l’image.
            </div>
          )}

          {/* Actions — valider/rejeter seulement pour les décors (28/07/2026) */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {isDecorJob && (
              <>
                <button
                  onClick={() => review('approve')}
                  disabled={busy || job.reviewStatus === 'approved'}
                  className="bg-brand-green text-white rounded-[10px] px-5 py-2.5 font-bold hover:bg-brand-green-hover hover:shadow-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ✓ Valider
                </button>
                <button
                  onClick={() => review('reject')}
                  disabled={busy || job.reviewStatus === 'rejected'}
                  className="bg-brand-red text-white rounded-[10px] px-5 py-2.5 font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  ✗ Rejeter
                </button>
              </>
            )}
            <button
              onClick={regen}
              disabled={busy}
              className="bg-white border border-border text-text-secondary rounded-[10px] px-5 py-2.5 font-medium hover:bg-surface transition-colors disabled:opacity-50"
            >
              ↻ Régénérer ({job.regenCount}/10)
            </button>

            {/* Correction par prompt, sur place (décors) */}
            {isDecorJob && decorId && (
              <div className="flex grow items-center gap-2 min-w-72">
                <input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') correct()
                  }}
                  placeholder="Corriger le décor : « enlève l'arbre à droite », « ciel plus dégagé »…"
                  className="grow border border-border bg-white rounded-[8px] px-3 py-2.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                />
                <button
                  onClick={correct}
                  disabled={busy || !instruction.trim()}
                  className="bg-brand-green text-white rounded-[10px] px-4 py-2.5 font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50 shrink-0"
                >
                  🪄 Corriger
                </button>
                <button
                  onClick={() => setStudioDecorId(decorId)}
                  title="Versions du décor et retour arrière"
                  className="text-sm text-brand-teal hover:underline shrink-0"
                >
                  versions
                </button>
              </div>
            )}
          </div>
          {isDecorJob && decorId && (
            <p className="text-xs text-text-disabled mb-4">
              La correction ne change que ce que vous demandez (trottoir et perspective
              verrouillés) et crée une nouvelle version du décor — « versions » pour revenir en
              arrière.
            </p>
          )}

          {isPillars && (
            <IntegrationPanel
              pillarsJobId={job.id}
              jobSize={size ?? null}
            />
          )}

          {/* Détails techniques — repliés par défaut */}
          <section className="bg-white rounded-[12px] border border-border shadow-sm overflow-hidden mt-6">
            <button
              onClick={() => setShowTech((s) => !s)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-surface transition-colors"
            >
              <span className="text-sm font-semibold text-text-secondary">
                🔧 Détails techniques (étapes de fabrication, contrôles qualité)
              </span>
              <span className={`text-text-disabled transition-transform ${showTech ? 'rotate-180' : ''}`}>▾</span>
            </button>
            {showTech && (
              <div className="px-5 pb-5">
                <div className="grid md:grid-cols-2 gap-4 mb-5">
                  {steps
                    .filter((s) => s.path)
                    .map((s) => (
                      <figure key={s.label} className="border border-border rounded-[12px] overflow-hidden">
                        <figcaption className="px-3 py-2 text-xs font-medium text-text-secondary bg-surface border-b border-border">
                          {s.label}
                        </figcaption>
                        <button onClick={() => setZoom(String(s.path))} className="block w-full cursor-zoom-in">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={art(s.path, 640)}
                            alt={s.label}
                            loading="lazy"
                            decoding="async"
                            className="w-full"
                          />
                        </button>
                      </figure>
                    ))}
                </div>

                {isPillars && (
                  <div className="text-sm grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div>
                      <div className="text-xs text-text-secondary">Alignement sol appliqué</div>
                      <div className="font-mono">
                        {r.groundAlign === 'fallback-canny'
                          ? 'Canny (défaut)'
                          : `${String(r.groundOffsetPxNative ?? 0)} px`}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Masquage</div>
                      <div className="font-mono">
                        {r.masking === 'off'
                          ? 'désactivé (rendu brut)'
                          : `pixel-lock · ${((Number(r.changedFraction) || 0) * 100).toFixed(1)} % générés`}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Ombres conservées</div>
                      <div className="font-mono">
                        {r.masking === 'off'
                          ? '—'
                          : r.shadowAborted
                            ? 'détection écartée'
                            : `${((Number(r.shadowFraction) || 0) * 100).toFixed(1)} %`}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Format natif</div>
                      <div className="font-mono">{r.nativeSizeRespected ? 'respecté ✔' : 'corrigé ✘'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Version du prompt</div>
                      <div className="font-mono">v{String(r.promptVersion ?? '?')}</div>
                    </div>
                  </div>
                )}

                {isDecorJob && (
                  <div className="text-sm grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <div className="text-xs text-text-secondary">Décalage trottoir mesuré</div>
                      <div className="font-mono">
                        {r.sidewalkOffsetPxDelivery === null || r.sidewalkOffsetPxDelivery === undefined
                          ? 'non mesuré'
                          : `${String(r.sidewalkOffsetPxDelivery)} px`}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Herbe dans le couloir</div>
                      <div className="font-mono">
                        {r.corridorGreenFraction === null || r.corridorGreenFraction === undefined
                          ? 'pas de couloir'
                          : `${(Number(r.corridorGreenFraction) * 100).toFixed(1)} %`}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Format natif</div>
                      <div className="font-mono">{r.nativeSizeRespected ? 'respecté ✔' : 'corrigé ✘'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Version du prompt</div>
                      <div className="font-mono">v{String(r.promptVersion ?? '?')}</div>
                    </div>
                  </div>
                )}

                {isIntegration && r.method === 'simple' && (
                  <div className="text-sm grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <div className="text-xs text-text-secondary">Méthode</div>
                      <div className="font-mono">simple (rectangle gabarit + PNG produit)</div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Zone portail (gabarit)</div>
                      <div className="font-mono">
                        {(() => {
                          const z = r.zonePx as { x: number; y: number; w: number; h: number } | null
                          return z ? `${z.w}×${z.h} px @ (${z.x}, ${z.y})` : '—'
                        })()}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Format natif</div>
                      <div className="font-mono">{r.nativeSizeRespected ? 'respecté ✔' : 'différent ✘'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Version du prompt</div>
                      <div className="font-mono">v{String(r.promptVersion ?? '?')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Étape décor + maçonnerie</div>
                      <Link href={`/production/image/${String(r.pillarsJobId ?? '')}`} className="text-brand-teal hover:underline">
                        #{String(r.pillarsJobId ?? '?')}
                      </Link>
                    </div>
                  </div>
                )}

                {isIntegration && r.method !== 'simple' && (
                  <div className="text-sm grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <div className="text-xs text-text-secondary">Piliers du visuel produit</div>
                      <div className="font-mono">
                        {!pillarInfo || pillarInfo.reason === 'aucun-pilier'
                          ? 'aucun détecté'
                          : pillarInfo.applied
                            ? `retirés ✔ (G ${pillarInfo.leftPx ?? 0} px · D ${pillarInfo.rightPx ?? 0} px)`
                            : '⚠ conservés'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Méthode</div>
                      <div className="font-mono">
                        {r.method === 'pose-directe' ? 'pose directe (archivée)' : 'rectangle + PJ'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Calage sur piliers rendus</div>
                      <div className="font-mono">
                        {(() => {
                          const e = r.pillarEdgeShiftPx as { left?: number | null; right?: number | null } | null
                          if (!e) return '—'
                          const side = (v: number | null | undefined) =>
                            v === null || v === undefined ? 'non mesuré' : `${v >= 0 ? '+' : ''}${v} px`
                          return `G ${side(e.left)} · D ${side(e.right)}`
                        })()}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Gonds posés sur les piliers</div>
                      <div className="font-mono">
                        {(() => {
                          const h = r.hingeOverlapPx as { left?: number; right?: number; bottom?: number } | null
                          if (!h || ((h.left ?? 0) === 0 && (h.right ?? 0) === 0 && (h.bottom ?? 0) === 0))
                            return 'aucun dépassement'
                          return `G ${h.left ?? 0} px · D ${h.right ?? 0} px · bas ${h.bottom ?? 0} px`
                        })()}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Invariance produit</div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono">{((Number(r.invarianceScore) || 0) * 100).toFixed(1)} %</span>
                        <span
                          className={`px-1.5 py-0.5 rounded-[8px] text-xs ${
                            r.invarianceOk ? 'bg-brand-green-light text-brand-green' : 'bg-brand-red-light text-brand-red'
                          }`}
                        >
                          {r.invarianceOk ? 'préservé' : '⚠ à vérifier'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Ombres conservées</div>
                      <div className="font-mono">
                        {r.shadowAborted ? 'détection écartée' : `${((Number(r.shadowFraction) || 0) * 100).toFixed(1)} %`}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Format natif</div>
                      <div className="font-mono">{r.nativeSizeRespected ? 'respecté ✔' : 'corrigé ✘'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Version du prompt</div>
                      <div className="font-mono">v{String(r.promptVersion ?? '?')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-text-secondary">Étape décor + maçonnerie</div>
                      <Link href={`/production/image/${String(r.pillarsJobId ?? '')}`} className="text-brand-teal hover:underline">
                        #{String(r.pillarsJobId ?? '?')}
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {studioDecorId && (
        <DecorStudio
          decorId={studioDecorId}
          isAdmin={isAdmin}
          onClose={() => {
            setStudioDecorId(null)
            load()
          }}
          onChanged={load}
        />
      )}

      {zoom && (
        <button
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={art(zoom)} alt="Agrandissement" className="max-w-full max-h-full object-contain" />
        </button>
      )}
    </div>
  )
}

/** Panneau « Poser un portail » affiché sous une étape décor + maçonnerie terminée. */
function IntegrationPanel({
  pillarsJobId,
  jobSize,
}: {
  pillarsJobId: number
  jobSize: { w: number; h: number } | null
}) {
  const router = useRouter()
  const [products, setProducts] = useState<{ path: string; name: string }[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const compat = useCallback(
    (name: string): 'ok' | 'ko' | 'unknown' => {
      const s = parseSizeFromProductName(name)
      if (!s || !jobSize) return 'unknown'
      return s.w === jobSize.w && s.h === jobSize.h ? 'ok' : 'ko'
    },
    [jobSize]
  )

  const loadProducts = useCallback(() => {
    fetch('/api/products')
      .then((res) => res.json())
      .then((d) => {
        const list: { path: string; name: string }[] = d.products ?? []
        // Produits à la bonne taille en premier, incompatibles en dernier.
        const rank = { ok: 0, unknown: 1, ko: 2 }
        list.sort((a, b) => rank[compat(a.name)] - rank[compat(b.name)])
        setProducts(list)
        if (list.length) setSelected((cur) => cur || list[0].path)
      })
  }, [compat])

  useEffect(loadProducts, [loadProducts])

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    setBusy(true)
    const res = await fetch('/api/products', { method: 'POST', body: fd })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok) {
      setSelected(data.product.path)
      loadProducts()
      setNotice(`Produit « ${data.product.name} » ajouté à la bibliothèque.`)
    } else {
      setNotice(`Erreur upload : ${data?.error ?? res.status}`)
    }
  }

  async function launch() {
    setBusy(true)
    setNotice(null)
    const res = await fetch(`/api/jobs/${pillarsJobId}/integrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productPath: selected }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok) {
      router.push(`/production/image/${data.jobId}`)
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  return (
    <section className="mt-6 bg-white rounded-[12px] border border-border shadow-sm p-5">
      <h2 className="font-medium mb-1">Poser un portail sur ce décor</h2>
      <p className="text-xs text-text-secondary mb-4">
        Le portail est intégré entre les piliers, à l&apos;emplacement exact donné par le gabarit
        (rectangle rouge), puis l&apos;image est livrée au format du site.
      </p>
      {notice && (
        <div className="bg-brand-teal-light text-brand-teal text-sm rounded-[8px] px-3 py-2 mb-3">
          {notice}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grow min-w-64">
          <label htmlFor="product-select" className="block text-xs font-medium text-text-secondary mb-1">
            Visuel produit (bibliothèque)
          </label>
          <select
            id="product-select"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
          >
            {products.map((pr) => {
              const s = parseSizeFromProductName(pr.name)
              const c = compat(pr.name)
              const suffix = s
                ? c === 'ok'
                  ? ` — ${s.w}×${s.h} ✓ compatible`
                  : ` — ${s.w}×${s.h} ✗ autre taille`
                : ''
              return (
                <option key={pr.path} value={pr.path}>
                  {pr.name}
                  {suffix}
                </option>
              )
            })}
            {products.length === 0 && <option value="">— bibliothèque vide —</option>}
          </select>
          {jobSize && selected && compat(products.find((pr) => pr.path === selected)?.name ?? '') === 'ko' && (
            <p className="text-xs text-brand-red mt-1">
              Ce produit n&apos;est pas un {jobSize.w}×{jobSize.h} : le lancement sera refusé (le
              produit ne doit jamais être déformé).
            </p>
          )}
        </div>
        <label className="text-sm text-brand-teal hover:underline cursor-pointer pb-2">
          + Ajouter un PNG détouré
          <input type="file" accept=".png,.jpg,.jpeg,.webp" onChange={upload} className="hidden" />
        </label>
        <button
          onClick={launch}
          disabled={busy || !selected}
          className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
        >
          Poser le portail
        </button>
      </div>
    </section>
  )
}
