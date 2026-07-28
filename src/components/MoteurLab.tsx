'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import PhraseAttente from './PhraseAttente'
import Chargement from './Chargement'
import Link from 'next/link'
import { parseSizeFromProductName } from '@/lib/productName'
import type { MoteurKey } from '@/lib/moteurs'
import { COULISSANT_XL_MIN_W, gabaritSetForSize, type GabaritSetKey } from '@/lib/gabaritSets'

/**
 * Lab moteur — cœur de la page Admin → LAB (page dédiée depuis le 13/07/2026,
 * né dans « Réglages moteur » le 11/07/2026) : essayer chaque étape du pipeline
 * SÉPARÉMENT (Décor, Piliers, Intégration) et tout voir de l'essai — images de
 * chaque sous-étape, prompt envoyé, mesures, appels API (modèle, durée, tokens),
 * données brutes. Les essais passent par les mêmes jobs que la production :
 * rien de spécial n'est généré, tout est comparable. Le moteur testé vient du
 * sélecteur de la page LAB : les essais utilisent SES tailles, SES gabarits,
 * SES prompts et SES réglages.
 *
 * Depuis le 22/07/2026, le TERMINUS (coulissant) se teste aussi en « Gabarits
 * XL » (bascule dédiée) : décors à l'échelle XL (CANNY caméra reculée) et
 * référentiel de tailles 450-600 — prompts et réglages du moteur inchangés.
 */

type Step = 'decor' | 'pillars' | 'integration'

interface Job {
  id: number
  type: string
  status: string
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  error: string | null
  createdAt: string
  updatedAt: string | null
}

interface ApiCall {
  id: number
  provider: string
  model: string
  kind: string
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  ok: boolean
  error: string | null
}

const STATUS_FR: Record<string, string> = {
  queued: 'en file d’attente',
  running: 'en cours',
  done: 'terminé',
  error: 'en erreur',
  cancelled: 'annulé',
}

/** Ordre et libellés des artefacts image affichés (toutes étapes confondues). */
const ARTIFACT_STEPS: { key: string; label: string }[] = [
  { key: 'cannySentPath', label: 'Canny envoyé au modèle' },
  { key: 'imagePath', label: 'Décor final' },
  { key: 'overlayPath', label: 'Entrée : décor + aplats gris (gabarit)' },
  { key: 'detourPath', label: 'Détourage produit (piliers du visuel retirés)' },
  { key: 'placedPath', label: 'Référence de contrôle (produit posé)' },
  { key: 'inputPath', label: 'Entrée envoyée (rectangle rouge)' },
  { key: 'maskPath', label: 'Masque pixel-lock' },
  { key: 'rawOutputPath', label: 'Sortie brute Nano Banana' },
  { key: 'compositePath', label: 'Image finale de l’étape' },
  { key: 'deliveryPath', label: 'Livraison 2000×1330' },
]

function art(p: unknown): string {
  return `/api/artifacts?p=${encodeURIComponent(String(p))}`
}

/* ============================== Mesures curées ============================== */

/** Une mesure lisible : libellé, valeur, et verdict quand un seuil existe. */
interface Metric {
  label: string
  value: string
  status?: 'ok' | 'warn'
}

interface Pricing {
  inEurPerMTok: number
  outEurPerMTok: number
}

/** Nom de fichier seul (sans dossier ni extension) pour les entrées en clair. */
function fileLabel(p: unknown): string {
  const s = String(p ?? '')
  return (s.split(/[\\/]/).pop() ?? s).replace(/\.(png|jpe?g|webp)$/i, '')
}

function pct(v: unknown): string {
  return `${((Number(v) || 0) * 100).toFixed(1).replace('.', ',')} %`
}

function signedPx(v: unknown): string {
  const n = Number(v) || 0
  return `${n >= 0 ? '+' : ''}${n} px`
}

const METHOD_FR: Record<string, string> = {
  simple: 'simple (rectangle gabarit + PNG produit)',
  rectangle: 'rectangle (ancienne)',
  'pose-directe': 'pose directe (archivée)',
}

/**
 * Mesures affichées par étape, dans un ordre choisi, avec verdict ✓/⚠ dès qu'un
 * seuil existe. Tout le reste (clés techniques, JSON de zones…) reste consultable
 * dans « données brutes du job » — rien n'est perdu, mais rien ne pollue.
 */
function buildMetrics(job: Job): Metric[] {
  const r = job.result ?? {}
  const p = job.payload ?? {}
  const m: Metric[] = []
  const add = (label: string, value: string, status?: 'ok' | 'warn') =>
    m.push({ label, value, status })

  const addDims = () => {
    if (!r.width) return
    add(
      'Image générée',
      `${r.width} × ${r.height} px — format natif ${String(r.imageSize ?? '2K')}`,
      r.nativeSizeRespected === false ? 'warn' : 'ok'
    )
  }

  if (job.type === 'decor' || job.type === 'decor-fix') {
    if (p.moodboardPath) add('Moodboard', fileLabel(p.moodboardPath))
    addDims()
    const off = r.sidewalkOffsetPxDelivery
    if (off === null || off === undefined) {
      add('Trottoir vs référence', 'non mesuré')
    } else {
      add(
        'Trottoir vs référence',
        `${signedPx(off)} — tolérance ±10`,
        Math.abs(Number(off)) <= 10 ? 'ok' : 'warn'
      )
    }
    const veg = r.corridorGreenFraction
    if (veg !== null && veg !== undefined) {
      const largeur = r.corridorWidthCm
        ? ` (${(Number(r.corridorWidthCm) / 100).toLocaleString('fr-FR')} m)`
        : ''
      add(
        `Végétation dans le couloir${largeur}`,
        `${pct(veg)} — seuil 8 %`,
        Number(veg) <= 0.08 ? 'ok' : 'warn'
      )
    }
    if (r.corridorWarning) add('Couloir', String(r.corridorWarning), 'warn')
    if (r.promptVersion) add('Prompt moodboard', `v${r.promptVersion}`)
    if (r.architecturePromptVersion) add('Prompt architecture', `v${r.architecturePromptVersion}`)
    if (r.corridorPromptVersion) add('Prompt couloir', `v${r.corridorPromptVersion}`)
  }

  if (job.type === 'pillars') {
    if (p.decorPath) add('Décor d’entrée', fileLabel(p.decorPath))
    const size = p.size as { w: number; h: number } | undefined
    if (size) add('Taille du portail', `${size.w} × ${size.h} cm`)
    addDims()
    if (r.groundAlign === 'fallback-canny') {
      // Mesure non concluante → position du CANNY de référence : c'est le plan de
      // base (gabarits calibrés dessus), information neutre — pas une alerte.
      add('Alignement sol', 'position Canny par défaut (mesure non concluante)')
    } else if (r.groundOffsetPxNative !== undefined) {
      add(
        'Alignement sol appliqué',
        `${signedPx(r.groundOffsetPxNative)}${r.groundAlign === 'measured' ? ' (mesuré)' : ''}`
      )
    }
    const shift = r.alignShift as { dx: number; dy: number; atBound?: boolean } | undefined
    if (shift) {
      const aborted = shift.atBound && shift.dx === 0 && shift.dy === 0
      add(
        'Recalage de la sortie',
        aborted
          ? 'abandonné — décalage de sortie > ±16 px'
          : `${signedPx(shift.dx)} horizontal · ${signedPx(shift.dy)} vertical${shift.atBound ? ' — butée atteinte' : ''}`,
        shift.atBound ? 'warn' : undefined
      )
    }
    if (r.masking === 'off') {
      add('Masquage', 'désactivé — rendu brut de Nano (décision 11/07)')
    }
    if (r.changedFraction !== undefined) add('Pixels générés (maçonnerie)', pct(r.changedFraction))
    if (r.shadowFraction !== undefined) {
      add(
        'Ombres conservées',
        r.shadowAborted === true ? 'détection écartée' : pct(r.shadowFraction),
        r.shadowAborted === true ? 'warn' : undefined
      )
    }
    if (r.promptVersion) add('Prompt piliers-murets', `v${r.promptVersion}`)
  }

  if (job.type === 'integration') {
    const productPath = p.productPath ?? r.productPath
    if (productPath) add('Produit', fileLabel(productPath))
    if (r.method) add('Méthode', METHOD_FR[String(r.method)] ?? String(r.method))
    if (r.pillarsJobId) add('Job Piliers source', `#${r.pillarsJobId}`)
    addDims()
    const z = r.zonePx as { x: number; y: number; w: number; h: number } | undefined
    if (z) add('Zone portail (gabarit)', `${z.w} × ${z.h} px, posée à (${z.x}, ${z.y})`)
    if (r.method !== 'simple') {
      if (r.invarianceScore !== undefined) {
        add(
          'Produit préservé (invariance)',
          pct(r.invarianceScore),
          r.invarianceOk === false ? 'warn' : 'ok'
        )
      }
      if (r.deformationWarning === true) {
        add('Proportions produit', `écart ${pct(r.ratioDeviation)} vs taille demandée`, 'warn')
      }
      if (r.shadowFraction !== undefined) {
        add(
          'Ombres conservées',
          r.shadowAborted === true ? 'détection écartée' : pct(r.shadowFraction)
        )
      }
      if (r.hingeFallback === true) add('Pose des gonds', 'repli boîte englobante', 'warn')
    }
    if (r.promptVersion) add('Prompt intégration', `v${r.promptVersion}`)
  }

  return m
}

/** Paire avant/après du comparateur, selon l'étape. */
function comparePairOf(job: Job): { before: { label: string; path: string }; after: { label: string; path: string } } | null {
  if (job.status !== 'done') return null
  const r = job.result ?? {}
  if (job.type === 'pillars' && r.overlayPath && r.compositePath) {
    return {
      before: { label: 'Entrée (aplats)', path: String(r.overlayPath) },
      after: { label: 'Sortie (composite)', path: String(r.compositePath) },
    }
  }
  if (job.type === 'integration') {
    const out = r.compositePath ?? r.rawOutputPath
    if (r.inputPath && out) {
      return {
        before: { label: 'Entrée (rect. rouge)', path: String(r.inputPath) },
        after: { label: 'Sortie', path: String(out) },
      }
    }
  }
  if ((job.type === 'decor' || job.type === 'decor-fix') && r.cannySentPath && r.imagePath) {
    return {
      before: { label: 'Canny', path: String(r.cannySentPath) },
      after: { label: 'Décor', path: String(r.imagePath) },
    }
  }
  return null
}

/**
 * Comparateur avant/après à POIGNÉE (demande Mathias 11/07/2026) : les deux images
 * sont superposées, la poignée se fait glisser pour révéler l'avant (à gauche) et
 * l'après (à droite). Fonctionne à la souris et au doigt.
 */
function CompareView({
  before,
  after,
}: {
  before: { label: string; path: string }
  after: { label: string; path: string }
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [pos, setPos] = useState(50)

  const moveTo = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const p = ((clientX - rect.left) / rect.width) * 100
    setPos(Math.min(99, Math.max(1, p)))
  }, [])

  return (
    <figure className="border border-border bg-white rounded-[12px] overflow-hidden mb-5">
      <figcaption className="px-3 py-2 text-xs font-medium text-text-secondary bg-surface border-b border-border">
        Comparateur avant / après — faites glisser la poignée
      </figcaption>
      <div
        ref={containerRef}
        className="relative select-none touch-none cursor-ew-resize"
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          moveTo(e.clientX)
        }}
        onPointerMove={(e) => {
          if (dragging.current) moveTo(e.clientX)
        }}
        onPointerUp={() => {
          dragging.current = false
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
      >
        {/* L'après en fond, l'avant par-dessus, découpé au niveau de la poignée */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={art(after.path)} alt={after.label} className="block w-full" draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={art(before.path)}
          alt={before.label}
          className="absolute inset-0 w-full"
          draggable={false}
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        />
        <span className="absolute top-2 left-2 text-xs font-semibold bg-black/55 text-white px-2 py-0.5 rounded-full pointer-events-none">
          {before.label}
        </span>
        <span className="absolute top-2 right-2 text-xs font-semibold bg-black/55 text-white px-2 py-0.5 rounded-full pointer-events-none">
          {after.label}
        </span>
        {/* Poignée */}
        <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${pos}%` }}>
          <div className="absolute top-0 bottom-0 -translate-x-1/2 w-[3px] bg-white shadow-[0_0_6px_rgba(0,0,0,0.45)]" />
          <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white border border-border shadow-lg flex items-center justify-center text-text-secondary text-sm font-bold">
            ◂▸
          </div>
        </div>
      </div>
    </figure>
  )
}

/** Les datetimes SQLite sont en UTC sans suffixe — on le rétablit pour parser. */
function parseDbDate(s: string): Date {
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
}

function elapsedLabel(job: Job): string {
  const start = parseDbDate(job.createdAt).getTime()
  const end =
    job.status === 'queued' || job.status === 'running'
      ? Date.now()
      : job.updatedAt
        ? parseDbDate(job.updatedAt).getTime()
        : start
  const s = Math.max(0, Math.round((end - start) / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

/* ============================== Inspecteur de job ============================== */

function JobInspector({
  jobId,
  pricing,
  onChain,
}: {
  jobId: number
  pricing: Pricing | null
  onChain?: (job: Job) => React.ReactNode
}) {
  const [job, setJob] = useState<Job | null>(null)
  const [calls, setCalls] = useState<ApiCall[]>([])
  const [promptText, setPromptText] = useState<string | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  const load = useCallback(() => {
    fetch(`/api/jobs/${jobId}`)
      .then((r) => r.json())
      .then((d) => {
        setJob(d.job ?? null)
        setCalls(d.calls ?? [])
      })
      .catch(() => null)
  }, [jobId])

  useEffect(() => {
    setJob(null)
    setCalls([])
    setPromptText(null)
    load()
  }, [load])

  const active = job === null || job.status === 'queued' || job.status === 'running'
  useEffect(() => {
    if (!active) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [active, load])

  // Prompt image complet (étape Décor) : le .txt est un artefact, on l'affiche.
  const promptPath = job?.result?.promptPath
  useEffect(() => {
    if (!promptPath) return
    fetch(art(promptPath))
      .then((r) => (r.ok ? r.text() : null))
      .then(setPromptText)
      .catch(() => null)
  }, [promptPath])

  if (!job) return <Chargement label="Chargement de l’essai…" />

  const r = job.result ?? {}
  const artifacts = ARTIFACT_STEPS.filter((s) => typeof r[s.key] === 'string')
  const metrics = buildMetrics(job)
  const warns = metrics.filter((m) => m.status === 'warn').length
  const comparePair = comparePairOf(job)
  const modelMs = calls.reduce((acc, c) => acc + (c.durationMs ?? 0), 0)
  // Coût en € : tarif (Réglages) appliqué aux appels IMAGE uniquement — les appels
  // texte (analyse moodboard, tags) coûtent des centièmes de centime, négligeables,
  // et les compter au tarif image fausserait tout.
  const imageCalls = calls.filter((c) => c.kind === 'image.generate')
  const tokIn = imageCalls.reduce((acc, c) => acc + (c.inputTokens ?? 0), 0)
  const tokOut = imageCalls.reduce((acc, c) => acc + (c.outputTokens ?? 0), 0)
  const cost =
    pricing && (pricing.inEurPerMTok > 0 || pricing.outEurPerMTok > 0) && imageCalls.length > 0
      ? (tokIn * pricing.inEurPerMTok + tokOut * pricing.outEurPerMTok) / 1_000_000
      : null

  return (
    <div>
      {/* Statut + durées + coût */}
      <div className="flex flex-wrap items-center gap-2 text-xs mb-4">
        <span className="bg-white border border-border text-text-secondary px-2.5 py-1 rounded-full font-semibold">
          Essai #{job.id} · {STATUS_FR[job.status] ?? job.status}
        </span>
        <span className="bg-white border border-border text-text-secondary px-2.5 py-1 rounded-full">
          durée totale : {elapsedLabel(job)}
        </span>
        {calls.length > 0 && (
          <span className="bg-white border border-border text-text-secondary px-2.5 py-1 rounded-full">
            {calls.length} appel{calls.length > 1 ? 's' : ''} API · {(modelMs / 1000).toFixed(1)} s
            de modèle
          </span>
        )}
        {cost !== null && (
          <span className="bg-brand-green-light text-brand-green px-2.5 py-1 rounded-full font-semibold">
            ≈ {cost.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: cost < 1 ? 3 : 2 })} €
          </span>
        )}
        <Link
          href={`/production/image/${job.id}`}
          className="text-brand-teal hover:underline px-1"
        >
          page détaillée ↗
        </Link>
      </div>

      {active && (
        <div className="bg-white rounded-[12px] border border-border shadow-sm p-10 text-center text-text-secondary mb-4">
          <div className="animate-spin h-7 w-7 border-4 border-border border-t-brand-teal rounded-full mx-auto mb-3" />
          <div className="font-medium"><PhraseAttente /></div>
          <p className="text-xs mt-1">La page se met à jour automatiquement.</p>
        </div>
      )}

      {job.error && (
        <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-4">
          {job.error}
        </div>
      )}

      {/* Mesures & contrôles — verdicts en tête, mesures curées, seuils affichés */}
      {job.status === 'done' && metrics.length > 0 && (
        <section className="bg-white rounded-[12px] border border-border shadow-sm p-4 mb-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold text-text-secondary">Mesures & contrôles</h3>
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                warns === 0
                  ? 'bg-brand-green-light text-brand-green'
                  : 'bg-brand-red-light text-brand-red'
              }`}
            >
              {warns === 0
                ? '✓ Tous les contrôles sont bons'
                : `⚠ ${warns} contrôle${warns > 1 ? 's' : ''} à vérifier`}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 text-sm">
            {metrics.map((m) => (
              <div key={m.label}>
                <div className="text-xs text-text-secondary">{m.label}</div>
                <div
                  className={`font-mono break-words ${
                    m.status === 'warn'
                      ? 'text-brand-red font-semibold'
                      : m.status === 'ok'
                        ? 'text-brand-green'
                        : ''
                  }`}
                >
                  {m.status === 'ok' ? '✓ ' : m.status === 'warn' ? '⚠ ' : ''}
                  {m.value}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Comparateur avant / après */}
      {comparePair && <CompareView before={comparePair.before} after={comparePair.after} />}

      {/* Toutes les images de l'essai, dans l'ordre du pipeline */}
      {artifacts.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4 mb-5">
          {artifacts.map((s) => (
            <figure key={s.key} className="border border-border bg-white rounded-[12px] overflow-hidden">
              <figcaption className="px-3 py-2 text-xs font-medium text-text-secondary bg-surface border-b border-border">
                {s.label}
              </figcaption>
              <button onClick={() => setZoom(String(r[s.key]))} className="block w-full cursor-zoom-in">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={art(r[s.key])} alt={s.label} className="w-full" />
              </button>
            </figure>
          ))}
        </div>
      )}

      {/* Prompt image complet (décor) */}
      {promptText && (
        <details className="bg-white rounded-[12px] border border-border shadow-sm mb-4 overflow-hidden">
          <summary className="px-4 py-3 text-sm font-semibold text-text-secondary cursor-pointer hover:bg-surface">
            Prompt image envoyé au modèle (complet)
          </summary>
          <pre className="px-4 pb-4 text-xs whitespace-pre-wrap text-text-secondary">{promptText}</pre>
        </details>
      )}

      {/* Appels API : modèle, durée, tokens */}
      {calls.length > 0 && (
        <section className="bg-white rounded-[12px] border border-border shadow-sm p-4 mb-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-text-secondary mb-3">Appels API du job</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text-disabled">
                <th className="py-1 pr-3 font-medium">Type</th>
                <th className="py-1 pr-3 font-medium">Modèle</th>
                <th className="py-1 pr-3 font-medium">Durée</th>
                <th className="py-1 pr-3 font-medium">Tokens (entrée / sortie)</th>
                <th className="py-1 font-medium">Résultat</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="py-1.5 pr-3 font-mono">{c.kind}</td>
                  <td className="py-1.5 pr-3 font-mono">{c.model}</td>
                  <td className="py-1.5 pr-3 font-mono">
                    {c.durationMs === null ? '—' : `${(c.durationMs / 1000).toFixed(1)} s`}
                  </td>
                  <td className="py-1.5 pr-3 font-mono">
                    {c.inputTokens ?? '—'} / {c.outputTokens ?? '—'}
                  </td>
                  <td className="py-1.5">
                    {c.ok ? (
                      <span className="text-brand-green font-semibold">ok</span>
                    ) : (
                      <span className="text-brand-red font-semibold" title={c.error ?? ''}>
                        erreur
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Données brutes (payload + result), pour ne rien perdre */}
      <button
        onClick={() => setShowRaw((s) => !s)}
        className="text-xs text-brand-teal hover:underline mb-2"
      >
        {showRaw ? 'masquer' : 'voir'} les données brutes du job
      </button>
      {showRaw && (
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div className="bg-white rounded-[12px] border border-border shadow-sm p-4 overflow-x-auto">
            <h4 className="text-xs font-semibold text-text-secondary mb-2">Paramètres (payload)</h4>
            <pre className="text-[11px] whitespace-pre-wrap">{JSON.stringify(job.payload, null, 2)}</pre>
          </div>
          <div className="bg-white rounded-[12px] border border-border shadow-sm p-4 overflow-x-auto">
            <h4 className="text-xs font-semibold text-text-secondary mb-2">Résultat (result)</h4>
            <pre className="text-[11px] whitespace-pre-wrap">{JSON.stringify(job.result, null, 2)}</pre>
          </div>
        </div>
      )}

      {/* Enchaînement vers l'étape suivante */}
      {job.status === 'done' && onChain?.(job)}

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

/* ============================== Grille multi-tailles (Piliers) ============================== */

/** CANNY trottoir de référence, servi via /api/artifacts (dossier Assets autorisé). */
const CANNY_REF = 'Assets/Trottoir Canny/Trottoir 2000x1330.png'
/** CANNY « caméra reculée » du jeu Gabarits XL (coulissants ≥ 450, 22/07/2026). */
const CANNY_REF_XL = 'Assets/Trottoir Canny/Trottoir XL 2000x1330.png'

/**
 * Comparaison façon page Gabarits (demande Mathias 11/07/2026, v2) : MATRICE —
 * une LIGNE par largeur (300 / 350 / 400), les hauteurs alignées en colonnes,
 * toutes les tuiles à la même échelle pour juger les proportions. Deux calques
 * activables d'un coup sur TOUTE la grille : le CANNY trottoir en surimpression
 * (fusion « screen » : seules les lignes blanches apparaissent) et les aplats
 * gris du gabarit en fantôme (l'image d'entrée à 50 % — identique au composite
 * hors maçonnerie grâce au pixel-lock, seuls les aplats ressortent).
 * Clic sur une tuile = détail complet de cette taille (inchangé).
 */
function PillarsGrid({
  ids,
  focus,
  onFocus,
}: {
  ids: number[]
  focus: number | null
  onFocus: (id: number) => void
}) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [showCanny, setShowCanny] = useState(false)
  const [showAplats, setShowAplats] = useState(false)
  const idsKey = ids.join(',')

  const load = useCallback(() => {
    const wanted = new Set(idsKey.split(',').map(Number))
    fetch('/api/jobs?limit=200')
      .then((r) => r.json())
      .then((d) => setJobs(((d.jobs ?? []) as Job[]).filter((j) => wanted.has(j.id))))
      .catch(() => null)
  }, [idsKey])

  useEffect(() => {
    setJobs([])
    load()
  }, [load])

  const running = (s: string) => s === 'queued' || s === 'running'
  const active = jobs.length < ids.length || jobs.some((j) => running(j.status))
  useEffect(() => {
    if (!active) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [active, load])

  const sizeOf = (j: Job) => (j.payload?.size as { w?: number; h?: number } | undefined) ?? {}
  // Jobs XL (coulissant ≥ 450) : leur calque CANNY est le trottoir XL « caméra reculée ».
  const cannyOf = (j: Job) =>
    gabaritSetForSize((j.payload?.moteur as MoteurKey | undefined) ?? 'battant', sizeOf(j).w ?? 0) ===
    'coulissant-xl'
      ? CANNY_REF_XL
      : CANNY_REF
  const widths = [...new Set(jobs.map((j) => sizeOf(j).w ?? 0))].sort((a, b) => a - b)
  const heights = [...new Set(jobs.map((j) => sizeOf(j).h ?? 0))].sort((a, b) => a - b)
  const cols = Math.max(1, heights.length)
  const gridCols = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
  const done = jobs.filter((j) => j.status === 'done').length

  return (
    <section className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-text-secondary">
          Comparaison des tailles ({done}/{ids.length} terminées)
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {active && (
            <span className="text-xs bg-brand-teal-light text-brand-teal px-2.5 py-1 rounded-full font-semibold">
              <PhraseAttente />
            </span>
          )}
          {/* Calques appliqués à TOUTE la grille d'un coup */}
          <button
            onClick={() => setShowAplats((v) => !v)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              showAplats
                ? 'bg-brand-green-light text-brand-green border-brand-green font-semibold'
                : 'bg-white text-text-secondary border-border hover:bg-surface'
            }`}
          >
            ▦ Aplats gris
          </button>
          <button
            onClick={() => setShowCanny((v) => !v)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              showCanny
                ? 'bg-brand-teal-light text-brand-teal border-brand-teal font-semibold'
                : 'bg-white text-text-secondary border-border hover:bg-surface'
            }`}
          >
            ⌇ Canny trottoir
          </button>
        </div>
      </div>

      {/* En-tête des colonnes : les hauteurs, alignées avec toutes les lignes */}
      <div className="grid gap-2 mb-1" style={gridCols}>
        {heights.map((h) => (
          <div key={h} className="text-center text-xs text-text-disabled font-mono">
            h {h}
          </div>
        ))}
      </div>

      {/* Une LIGNE par largeur : tuiles à la même échelle, hauteurs en colonnes */}
      {widths.map((w) => (
        <div key={w} className="mb-3">
          <div className="text-xs font-semibold text-text-secondary mb-1">Largeur {w} cm</div>
          <div className="grid gap-2" style={gridCols}>
            {jobs
              .filter((j) => sizeOf(j).w === w)
              .sort((a, b) => (sizeOf(a).h ?? 0) - (sizeOf(b).h ?? 0))
              .map((j) => {
                const s = sizeOf(j)
                const img = j.result?.compositePath
                const col = heights.indexOf(s.h ?? 0) + 1
                return (
                  <button
                    key={j.id}
                    onClick={() => onFocus(j.id)}
                    style={{ gridColumn: col }}
                    className={`text-left bg-white border rounded-[8px] overflow-hidden transition-all ${
                      focus === j.id
                        ? 'border-brand-teal ring-2 ring-brand-teal'
                        : 'border-border hover:shadow-default hover:translate-y-[-1px]'
                    }`}
                  >
                    {/* Ratio natif exact (2528×1696) : les calques restent alignés au pixel */}
                    <div className="relative aspect-[2528/1696] bg-surface">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={art(img)}
                          alt={`${s.w}×${s.h}`}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          {running(j.status) ? (
                            <div className="animate-spin h-5 w-5 border-4 border-border border-t-brand-teal rounded-full" />
                          ) : j.status === 'error' ? (
                            <span className="text-brand-red text-xl">⚠</span>
                          ) : null}
                        </div>
                      )}
                      {img && showAplats && j.result?.overlayPath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={art(j.result.overlayPath)}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
                        />
                      ) : null}
                      {img && showCanny ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={art(cannyOf(j))}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover mix-blend-screen opacity-70 pointer-events-none"
                        />
                      ) : null}
                    </div>
                    <div className="px-2 py-1 text-[11px] text-text-secondary font-mono flex items-center justify-between gap-1">
                      <span className="font-semibold">
                        {s.w}×{s.h}
                      </span>
                      <span className="truncate">
                        {j.status === 'done'
                          ? `sol ${signedPx(j.result?.groundOffsetPxNative ?? 0)} ${j.result?.nativeSizeRespected === false ? '✘' : '✓'}`
                          : j.status === 'error'
                            ? '⚠ erreur'
                            : (STATUS_FR[j.status] ?? j.status)}
                      </span>
                    </div>
                  </button>
                )
              })}
          </div>
        </div>
      ))}
    </section>
  )
}

/* ============================== Essais (historique en base) ============================== */

/**
 * Refonte lab-v1 (maquette validée par Mathias le 22/07/2026) : l'historique des
 * essais vient DE LA BASE (/api/lab/essais, jobs marqués `lab`) — fini les
 * pastilles localStorage limitées à 12 et perdues au changement de navigateur.
 * Liste datée avec vignettes, filtres par étape et par jeu, archivage par essai
 * + « Tout archiver » (rien n'est supprimé, la vue Archives reste consultable).
 */
interface LabEssaiUi {
  id: number
  ids: number[]
  step: Step
  moteur: MoteurKey
  xl: boolean
  status: 'running' | 'done' | 'error'
  done: number
  errors: number
  total: number
  createdAt: string
  thumbPath: string | null
  titre: string
  detail: string
  inputTokens: number
  outputTokens: number
}

const STEP_FR: Record<Step, string> = {
  decor: 'Décor',
  pillars: 'Piliers',
  integration: 'Intégration',
}

/** « Aujourd’hui — mardi 22 juillet », « Hier — … », sinon la date seule. */
function dayLabel(d: Date): string {
  const jour = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const ref = new Date()
  ref.setHours(0, 0, 0, 0)
  const that = new Date(d)
  that.setHours(0, 0, 0, 0)
  const diff = Math.round((ref.getTime() - that.getTime()) / 86_400_000)
  if (diff === 0) return `Aujourd’hui — ${jour}`
  if (diff === 1) return `Hier — ${jour}`
  return jour
}

function heureLabel(s: string): string {
  const d = parseDbDate(s)
  return `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`
}

/** « #151 » pour un essai simple, « #136-148 » pour un lancement multi-tailles. */
function idsLabel(e: LabEssaiUi): string {
  return e.ids.length > 1 ? `#${e.ids[0]}-${e.ids[e.ids.length - 1]}` : `#${e.id}`
}

/* ============================== Page Lab ============================== */

export default function MoteurLab({ moteur = 'battant' }: { moteur?: MoteurKey }) {
  const [step, setStep] = useState<Step>('decor')
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * Jeu de gabarits testé (TERMINUS uniquement, 22/07/2026) : « Gabarits XL »
   * bascule les essais à l'échelle XL — décor XL (CANNY caméra reculée, prompt
   * moodboard XL) et référentiel de tailles 450-600 — sans toucher aux prompts
   * ni aux réglages du moteur. Côté serveur, toute largeur ≥ 450 prend le jeu
   * XL d'elle-même (launchGamme) : la bascule ne sert qu'à proposer les bons
   * décors et les bonnes tailles.
   */
  const [jeuXl, setJeuXl] = useState(false)
  const jeu: GabaritSetKey = moteur === 'coulissant' && jeuXl ? 'coulissant-xl' : moteur
  const isXlJeu = jeu === 'coulissant-xl'

  // Référentiels
  const [moodboards, setMoodboards] = useState<{ path: string; name: string }[]>([])
  const [decors, setDecors] = useState<
    { file_path: string; name: string; status: string; type: string }[]
  >([])
  const [sizes, setSizes] = useState<{ w: number; h: number; label: string }[]>([])
  const [products, setProducts] = useState<{ path: string; name: string }[]>([])
  const [pillarsJobs, setPillarsJobs] = useState<Job[]>([])
  const [pricing, setPricing] = useState<Pricing | null>(null)

  // Essais (historique en base — refonte lab-v1 du 22/07/2026)
  const [essais, setEssais] = useState<LabEssaiUi[]>([])
  const [archivedCount, setArchivedCount] = useState(0)
  const [archivesView, setArchivesView] = useState(false)
  const [stepFilter, setStepFilter] = useState<'all' | Step>('all')
  const [xlOnly, setXlOnly] = useState(false)
  /** Essai ouvert en détail (id de tête + jobs du groupe) — null = liste. */
  const [selected, setSelected] = useState<{ id: number; ids: number[]; step: Step } | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)

  const loadEssais = useCallback(() => {
    fetch(`/api/lab/essais${archivesView ? '?archives=1' : ''}`)
      .then((r) => r.json())
      .then((d) => {
        setEssais((d.essais ?? []) as LabEssaiUi[])
        setArchivedCount(d.archivedCount ?? 0)
      })
      .catch(() => null)
  }, [archivesView])

  useEffect(() => {
    setEssais([])
    loadEssais()
  }, [loadEssais])

  // Un essai tourne encore → la liste se rafraîchit toute seule.
  const anyRunning = essais.some((e) => e.status === 'running')
  useEffect(() => {
    if (!anyRunning) return
    const t = setInterval(loadEssais, 5000)
    return () => clearInterval(t)
  }, [anyRunning, loadEssais])

  // Formulaires
  const [mbPath, setMbPath] = useState('')
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('2K')
  const [decorPath, setDecorPath] = useState('')
  /** Tailles cochées pour l'essai Piliers (multi-tailles, comparaison façon Gabarits) */
  const [sizesSel, setSizesSel] = useState<string[]>([])
  /** 'moteur' = align omis de l'essai → le réglage Admin → Réglages par moteur s'applique. */
  const [align, setAlign] = useState<'moteur' | 'auto' | 'off'>('moteur')
  /** Taille sélectionnée dans la grille multi-tailles (détail complet) */
  const [pillarsFocus, setPillarsFocus] = useState<number | null>(null)
  const [integJobId, setIntegJobId] = useState<number | ''>('')
  const [productPath, setProductPath] = useState('')
  const [method, setMethod] = useState<'simple' | 'rectangle' | 'pose-directe'>('simple')

  const loadPillarsJobs = useCallback(() => {
    fetch('/api/jobs?limit=200')
      .then((r) => r.json())
      .then((d) => {
        // Seuls les jobs DU moteur testé : une intégration se fait sur des
        // piliers du même moteur (payload.moteur absent = battant, historique).
        const jobs: Job[] = (d.jobs ?? []).filter(
          (j: Job) =>
            j.type === 'pillars' &&
            j.status === 'done' &&
            ((j.payload?.moteur as string | undefined) ?? 'battant') === moteur
        )
        setPillarsJobs(jobs)
        if (jobs.length) setIntegJobId((cur) => (cur === '' ? jobs[0].id : cur))
      })
  }, [moteur])

  useEffect(() => {
    fetch('/api/decors')
      .then((r) => r.json())
      .then((d) => {
        setMoodboards(d.moodboards ?? [])
        setDecors(
          (d.decors ?? []) as { file_path: string; name: string; status: string; type: string }[]
        )
        if (d.moodboards?.length) setMbPath((cur) => cur || d.moodboards[0].path)
      })
    fetch('/api/products')
      .then((r) => r.json())
      .then((d) => {
        setProducts(d.products ?? [])
        if (d.products?.length) setProductPath((cur) => cur || d.products[0].path)
      })
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => setPricing(d.pricing ?? null))
    loadPillarsJobs()
  }, [moteur, loadPillarsJobs])

  // Référentiel de tailles DU jeu testé (13/07/2026) — le jeu Gabarits XL a le
  // sien (450-600, 22/07/2026) : basculer Standard ↔ XL recharge les tailles.
  useEffect(() => {
    fetch(`/api/sizes?moteur=${jeu}`)
      .then((r) => r.json())
      .then((d) => {
        setSizes(d.sizes ?? [])
        setSizesSel(d.sizes?.length ? [d.sizes[0].label] : [])
      })
  }, [jeu])

  // Décors proposés à l'essai Piliers : ceux DU jeu — un décor XL ne va jamais
  // aux tailles standards, et inversement (règle bibliothèque, 22/07/2026).
  const decorsJeu = decors.filter((d) => (d.type === 'coulissant-xl') === isXlJeu)

  // Sélection réparée si le décor appartient à l'AUTRE jeu ; un décor chaîné
  // depuis l'essai Décor (hors bibliothèque) reste sélectionné tel quel.
  useEffect(() => {
    const xl = jeu === 'coulissant-xl'
    setDecorPath((cur) => {
      const pool = decors.filter((d) => (d.type === 'coulissant-xl') === xl)
      const enBibliotheque = decors.some((d) => d.file_path === cur)
      if (cur && (!enBibliotheque || pool.some((d) => d.file_path === cur))) return cur
      return pool[0]?.file_path ?? ''
    })
  }, [decors, jeu])

  async function launch(url: string, body: unknown, s: Step): Promise<void> {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setNotice(data?.error ?? `Erreur ${res.status}`)
        return
      }
      const ids: number[] =
        Array.isArray(data?.jobIds) && data.jobIds.length
          ? data.jobIds
          : data?.jobId !== undefined
            ? [data.jobId]
            : []
      if (ids.length === 0) {
        setNotice('Lancement accepté mais aucun job retourné — voir le journal des générations.')
        return
      }
      // L'essai s'ouvre directement, la liste (en base) se met à jour derrière.
      setPillarsFocus(null)
      setSelected({ id: ids[0], ids, step: s })
      setArchivesView(false)
      loadEssais()
    } finally {
      setBusy(false)
    }
  }

  async function archiver(body: { ids: number[] } | { all: true }): Promise<void> {
    const res = await fetch('/api/lab/essais', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setNotice(data?.error ?? `Archivage refusé (${res.status})`)
      return
    }
    loadEssais()
  }

  const integJob = pillarsJobs.find((j) => j.id === integJobId)
  const integJobSize = (integJob?.payload?.size as { w: number; h: number } | undefined) ?? null
  const compat = (name: string): 'ok' | 'ko' | 'unknown' => {
    const s = parseSizeFromProductName(name)
    if (!s || !integJobSize) return 'unknown'
    return s.w === integJobSize.w && s.h === integJobSize.h ? 'ok' : 'ko'
  }
  const productsSorted = [...products].sort((a, b) => {
    const rank = { ok: 0, unknown: 1, ko: 2 }
    return rank[compat(a.name)] - rank[compat(b.name)]
  })

  const STEP_TABS: { key: Step; label: string }[] = [
    { key: 'decor', label: '1 · Décor' },
    { key: 'pillars', label: '2 · Piliers' },
    { key: 'integration', label: '3 · Intégration' },
  ]

  // Essais visibles : ceux DU moteur testé, filtrés par étape et par jeu.
  const visibles = essais.filter(
    (e) =>
      e.moteur === moteur &&
      (stepFilter === 'all' || e.step === stepFilter) &&
      (!xlOnly || e.xl)
  )
  // Groupes par jour, la liste étant déjà triée du plus récent au plus ancien.
  const jours: { label: string; items: LabEssaiUi[] }[] = []
  for (const e of visibles) {
    const label = dayLabel(parseDbDate(e.createdAt))
    const dernier = jours[jours.length - 1]
    if (dernier && dernier.label === label) dernier.items.push(e)
    else jours.push({ label, items: [e] })
  }

  const coutOf = (e: LabEssaiUi): string | null => {
    if (!pricing || (pricing.inEurPerMTok <= 0 && pricing.outEurPerMTok <= 0)) return null
    if (e.inputTokens <= 0 && e.outputTokens <= 0) return null
    const c = (e.inputTokens * pricing.inEurPerMTok + e.outputTokens * pricing.outEurPerMTok) / 1_000_000
    return `≈ ${c.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: c < 1 ? 2 : 2 })} €`
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* ============ Panneau gauche : lancement ============ */}
      <aside className="w-full lg:w-[330px] shrink-0 lg:sticky lg:top-4 bg-white border border-border rounded-[12px] shadow-sm p-5 flex flex-col gap-5">
        <div>
          <h2 className="text-lg font-semibold">🧪 Lancer un essai</h2>
          <p className="text-xs text-text-secondary mt-1">
            Même moteur que la production (prompts, gabarits, réglages), essais{' '}
            <strong>isolés</strong> : rien n’entre dans la bibliothèque ni dans les sessions.
          </p>
        </div>

        {/* Étape testée */}
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-widest text-text-secondary mb-2">
            Étape testée
          </div>
          <div className="flex gap-1 bg-surface rounded-full p-1">
            {STEP_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setStep(t.key)}
                className={`flex-1 text-xs font-bold rounded-full px-1 py-1.5 transition-colors ${
                  step === t.key
                    ? 'bg-white text-brand-green shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Jeu de gabarits (TERMINUS seul, 22/07/2026) : Standard ou Gabarits XL. */}
        {moteur === 'coulissant' && (
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-widest text-text-secondary mb-2">
              Jeu de gabarits
            </div>
            <div className="flex rounded-[8px] border border-border overflow-hidden">
              {[
                { xl: false, label: 'Standard (300–400)' },
                { xl: true, label: `XL (${COULISSANT_XL_MIN_W}–600)` },
              ].map((o) => (
                <button
                  key={o.label}
                  onClick={() => {
                    setJeuXl(o.xl)
                    // Le XL se juge en conditions réelles : tout en 4K (décision
                    // 22/07/2026) — le sélecteur de format reste modifiable après.
                    if (o.xl) setImageSize('4K')
                  }}
                  className={`flex-1 text-xs px-2 py-2 font-semibold transition-colors ${
                    jeuXl === o.xl
                      ? 'bg-brand-green text-white'
                      : 'bg-white text-text-secondary hover:bg-surface'
                  }`}
                >
                  {jeuXl === o.xl ? '✓ ' : ''}
                  {o.label}
                </button>
              ))}
            </div>
            {jeuXl && (
              <p className="text-[11px] text-text-disabled mt-1.5">
                Décors à l’échelle XL (Canny caméra reculée), tout en 4K.
              </p>
            )}
          </div>
        )}

        {/* ——— Formulaire de l'étape ——— */}
        {step === 'decor' && (
          <>
            <div>
              <label htmlFor="lab-mb" className="block text-xs font-medium text-text-secondary mb-1">
                Moodboard
              </label>
              <select
                id="lab-mb"
                value={mbPath}
                onChange={(e) => setMbPath(e.target.value)}
                className="w-full border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
              >
                {moodboards.map((m) => (
                  <option key={m.path} value={m.path}>
                    {m.name}
                  </option>
                ))}
                {moodboards.length === 0 && <option value="">— aucun moodboard —</option>}
              </select>
            </div>
            <div>
              <label htmlFor="lab-size" className="block text-xs font-medium text-text-secondary mb-1">
                Format
              </label>
              <select
                id="lab-size"
                value={imageSize}
                onChange={(e) => setImageSize(e.target.value as '1K' | '2K' | '4K')}
                className="w-full border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
              >
                <option value="1K">1K (rapide)</option>
                <option value="2K">2K (standard)</option>
                <option value="4K">4K (lent)</option>
              </select>
            </div>
            <button
              onClick={() =>
                launch(
                  '/api/decor',
                  // Le jeu (et non le moteur) : « coulissant-xl » = décor à
                  // l'échelle XL (CANNY XL, prompt moodboard XL, corridor XL).
                  { moodboardPath: mbPath, imageSize, lab: true, moteur: jeu },
                  'decor'
                )
              }
              disabled={busy || !mbPath}
              className="bg-brand-green text-white rounded-[10px] px-5 py-2.5 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
            >
              🧪 Lancer l’essai Décor
            </button>
            {mbPath && (
              <figure className="border border-border rounded-[12px] overflow-hidden">
                <figcaption className="px-3 py-1.5 text-xs text-text-secondary bg-surface border-b border-border">
                  Moodboard envoyé
                </figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={art(mbPath)} alt="Moodboard" className="w-full" />
              </figure>
            )}
          </>
        )}

        {step === 'pillars' && (
          <>
            <div>
              <label htmlFor="lab-decor" className="block text-xs font-medium text-text-secondary mb-1">
                Décor (bibliothèque)
              </label>
              <select
                id="lab-decor"
                value={decorPath}
                onChange={(e) => setDecorPath(e.target.value)}
                className="w-full border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
              >
                {decorPath && !decorsJeu.some((d) => d.file_path === decorPath) && (
                  <option value={decorPath}>Décor de l’essai précédent</option>
                )}
                {decorsJeu.map((d) => (
                  <option key={d.file_path} value={d.file_path}>
                    {d.name}
                    {d.status === 'a_valider' ? ' (à valider)' : d.status === 'archive' ? ' (archivé)' : ''}
                  </option>
                ))}
                {decorsJeu.length === 0 && (
                  <option value="">
                    {isXlJeu ? '— aucun décor XL en bibliothèque —' : '— bibliothèque vide —'}
                  </option>
                )}
              </select>
            </div>
            <div>
              <label htmlFor="lab-align" className="block text-xs font-medium text-text-secondary mb-1">
                Alignement des piliers au sol
              </label>
              <select
                id="lab-align"
                value={align}
                onChange={(e) => setAlign(e.target.value as 'moteur' | 'auto' | 'off')}
                className="w-full border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
              >
                {/* 'moteur' : align omis de l'appel → le réglage du moteur s'applique
                    (permet de TESTER le réglage admin avant la production, 13/07/2026). */}
                <option value="moteur">réglage moteur</option>
                <option value="auto">auto (mesuré)</option>
                <option value="off">désactivé</option>
              </select>
            </div>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-medium text-text-secondary">
                  Tailles — {sizesSel.length} cochée{sizesSel.length > 1 ? 's' : ''}
                </span>
                <span className="flex gap-2 text-xs">
                  <button onClick={() => setSizesSel(sizes.map((s) => s.label))} className="text-brand-teal hover:underline">
                    tout
                  </button>
                  <button onClick={() => setSizesSel([])} className="text-brand-teal hover:underline">
                    aucune
                  </button>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {sizes.map((s) => {
                  const on = sizesSel.includes(s.label)
                  return (
                    <button
                      key={s.label}
                      onClick={() =>
                        setSizesSel((cur) =>
                          on ? cur.filter((l) => l !== s.label) : [...cur, s.label]
                        )
                      }
                      className={`text-xs px-2.5 py-1.5 rounded-full border font-mono transition-colors ${
                        on
                          ? 'bg-brand-green-light text-brand-green border-brand-green font-semibold'
                          : 'bg-white text-text-secondary border-border hover:bg-surface'
                      }`}
                    >
                      {on ? '✓ ' : ''}
                      {s.w}×{s.h}
                    </button>
                  )
                })}
              </div>
            </div>
            <button
              onClick={() =>
                launch(
                  '/api/gamme',
                  {
                    decorPath,
                    items: sizesSel
                      .map((label) => sizes.find((s) => s.label === label))
                      .filter((s): s is NonNullable<typeof s> => Boolean(s))
                      .map((s) => ({ size: { w: s.w, h: s.h } })),
                    // 'moteur' → align omis : /api/gamme laisse le réglage moteur décider.
                    ...(align === 'moteur' ? {} : { align }),
                    lab: true,
                    // Toujours le MOTEUR (pas le jeu) : côté serveur, launchGamme
                    // passe de lui-même les largeurs ≥ 450 sur le jeu Gabarits XL.
                    moteur,
                  },
                  'pillars'
                )
              }
              disabled={busy || !decorPath || sizesSel.length === 0}
              className="bg-brand-green text-white rounded-[10px] px-5 py-2.5 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
            >
              🧪 Lancer l’essai Piliers{sizesSel.length > 1 ? ` (${sizesSel.length} tailles)` : ''}
            </button>
            {decorPath && (
              <figure className="border border-border rounded-[12px] overflow-hidden">
                <figcaption className="px-3 py-1.5 text-xs text-text-secondary bg-surface border-b border-border">
                  Décor d’entrée
                </figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={art(decorPath)} alt="Décor" className="w-full" />
              </figure>
            )}
          </>
        )}

        {step === 'integration' && (
          <>
            <div>
              <label htmlFor="lab-pjob" className="block text-xs font-medium text-text-secondary mb-1">
                Job Piliers terminé
              </label>
              <select
                id="lab-pjob"
                value={integJobId}
                onChange={(e) => setIntegJobId(Number(e.target.value))}
                className="w-full border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
              >
                {pillarsJobs.map((j) => {
                  const s = j.payload?.size as { w: number; h: number } | undefined
                  return (
                    <option key={j.id} value={j.id}>
                      #{j.id} · {s ? `${s.w}×${s.h}` : '?'} · {String(j.payload?.slug ?? '')} ·{' '}
                      {j.createdAt.slice(0, 16)}
                    </option>
                  )
                })}
                {pillarsJobs.length === 0 && <option value="">— aucun job Piliers terminé —</option>}
              </select>
            </div>
            <div>
              <label htmlFor="lab-product" className="block text-xs font-medium text-text-secondary mb-1">
                Visuel produit
              </label>
              <select
                id="lab-product"
                value={productPath}
                onChange={(e) => setProductPath(e.target.value)}
                className="w-full border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
              >
                {productsSorted.map((pr) => {
                  const c = compat(pr.name)
                  return (
                    <option key={pr.path} value={pr.path}>
                      {pr.name}
                      {c === 'ok' ? ' ✓ compatible' : c === 'ko' ? ' ✗ autre taille' : ''}
                    </option>
                  )
                })}
                {products.length === 0 && <option value="">— bibliothèque vide —</option>}
              </select>
            </div>
            <div>
              <label htmlFor="lab-method" className="block text-xs font-medium text-text-secondary mb-1">
                Méthode
              </label>
              <select
                id="lab-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as 'simple' | 'rectangle' | 'pose-directe')}
                className="w-full border border-border bg-surface rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
              >
                <option value="simple">simple (nouvelle, défaut)</option>
                <option value="rectangle">rectangle (ancienne)</option>
                <option value="pose-directe">pose directe (archivée)</option>
              </select>
            </div>
            <button
              onClick={() =>
                integJobId !== '' &&
                launch(
                  `/api/jobs/${integJobId}/integrate`,
                  { productPath, method, lab: true },
                  'integration'
                )
              }
              disabled={busy || integJobId === '' || !productPath}
              className="bg-brand-green text-white rounded-[10px] px-5 py-2.5 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
            >
              🧪 Lancer l’essai Intégration
            </button>
            {integJob?.result?.compositePath ? (
              <figure className="border border-border rounded-[12px] overflow-hidden">
                <figcaption className="px-3 py-1.5 text-xs text-text-secondary bg-surface border-b border-border">
                  Décor + maçonnerie d’entrée
                </figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={art(integJob.result.compositePath)} alt="Piliers" className="w-full" />
              </figure>
            ) : null}
          </>
        )}
      </aside>

      {/* ============ Zone principale : essais ============ */}
      <div className="flex-1 min-w-0">
        {notice && (
          <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-5">
            {notice}
          </div>
        )}

        {selected ? (
          /* ——— Détail d'un essai (inspecteur inchangé) ——— */
          <div>
            <button
              onClick={() => {
                setSelected(null)
                setPillarsFocus(null)
                loadEssais()
              }}
              className="text-sm font-bold text-brand-teal hover:underline mb-4"
            >
              ← Retour aux essais
            </button>
            {selected.step === 'pillars' && selected.ids.length > 1 ? (
              <>
                <PillarsGrid ids={selected.ids} focus={pillarsFocus} onFocus={setPillarsFocus} />
                {pillarsFocus === null && (
                  <p className="text-xs text-text-disabled mb-4">
                    Cliquez sur une taille dans la grille pour ouvrir son détail complet
                    (mesures, comparateur, appels API).
                  </p>
                )}
                {pillarsFocus !== null && (
                  <JobInspector
                    jobId={pillarsFocus}
                    pricing={pricing}
                    onChain={(job) => (
                      <button
                        onClick={() => {
                          loadPillarsJobs()
                          setIntegJobId(job.id)
                          setStep('integration')
                          setSelected(null)
                        }}
                        className="bg-brand-teal text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:opacity-90 transition-opacity"
                      >
                        → Essayer l’Intégration sur ce job
                      </button>
                    )}
                  />
                )}
              </>
            ) : (
              <JobInspector
                jobId={selected.id}
                pricing={pricing}
                onChain={(job) => {
                  if (selected.step === 'decor') {
                    const img = job.result?.imagePath
                    if (!img) return null
                    return (
                      <button
                        onClick={() => {
                          setDecorPath(String(img))
                          setStep('pillars')
                          setSelected(null)
                        }}
                        className="bg-brand-teal text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:opacity-90 transition-opacity"
                      >
                        → Essayer les Piliers sur ce décor
                      </button>
                    )
                  }
                  if (selected.step === 'pillars') {
                    return (
                      <button
                        onClick={() => {
                          loadPillarsJobs()
                          setIntegJobId(job.id)
                          setStep('integration')
                          setSelected(null)
                        }}
                        className="bg-brand-teal text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:opacity-90 transition-opacity"
                      >
                        → Essayer l’Intégration sur ce job
                      </button>
                    )
                  }
                  return null
                }}
              />
            )}
          </div>
        ) : (
          /* ——— Liste des essais ——— */
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h2 className="text-lg font-semibold">{archivesView ? 'Archives' : 'Essais'}</h2>
              <span className="text-sm text-text-disabled font-semibold">
                {visibles.length} essai{visibles.length > 1 ? 's' : ''}
              </span>
              <div className="grow" />
              {!archivesView && visibles.length > 0 && (
                <button
                  onClick={() => setConfirmAll(true)}
                  className="bg-white border border-border text-text-secondary rounded-[10px] px-4 py-2 text-sm font-bold hover:border-brand-green hover:text-brand-green transition-colors"
                >
                  📦 Tout archiver
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-4">
              {(
                [
                  { key: 'all', label: 'Toutes les étapes' },
                  { key: 'decor', label: 'Décor' },
                  { key: 'pillars', label: 'Piliers' },
                  { key: 'integration', label: 'Intégration' },
                ] as { key: 'all' | Step; label: string }[]
              ).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setStepFilter(f.key)}
                  className={`text-xs px-3 py-1.5 rounded-full border font-bold transition-colors ${
                    stepFilter === f.key
                      ? 'bg-brand-green text-white border-brand-green'
                      : 'bg-white text-text-secondary border-border hover:bg-surface'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              {moteur === 'coulissant' && (
                <>
                  <span className="w-px h-5 bg-border mx-1" />
                  <button
                    onClick={() => setXlOnly((v) => !v)}
                    className={`text-xs px-3 py-1.5 rounded-full border font-bold transition-colors ${
                      xlOnly
                        ? 'bg-brand-teal text-white border-brand-teal'
                        : 'bg-white text-text-secondary border-border hover:bg-surface'
                    }`}
                  >
                    XL seul
                  </button>
                </>
              )}
              <div className="grow" />
              <button
                onClick={() => {
                  setArchivesView((v) => !v)
                  setSelected(null)
                }}
                className="text-xs text-text-secondary hover:text-brand-green hover:underline"
              >
                {archivesView ? '← Essais actifs' : `Voir les archives (${archivedCount})`}
              </button>
            </div>

            {jours.length === 0 && (
              <div className="border-[1.5px] border-dashed border-border rounded-[12px] p-10 text-center text-sm text-text-disabled">
                {archivesView
                  ? 'Aucune archive pour ce moteur.'
                  : 'Aucun essai — lancez-en un depuis le panneau de gauche.'}
              </div>
            )}

            {jours.map((g) => (
              <div key={g.label}>
                <div className="text-xs font-bold uppercase tracking-widest text-text-disabled mt-4 mb-2">
                  {g.label}
                </div>
                {g.items.map((e) => (
                  <div
                    key={e.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setPillarsFocus(null)
                      setSelected({ id: e.id, ids: e.ids, step: e.step })
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') {
                        setPillarsFocus(null)
                        setSelected({ id: e.id, ids: e.ids, step: e.step })
                      }
                    }}
                    className="flex items-center gap-4 bg-white border border-border rounded-[12px] shadow-sm px-3 py-2.5 mb-2 cursor-pointer hover:border-brand-green transition-colors"
                  >
                    <span className="w-[92px] shrink-0 rounded-[6px] overflow-hidden border border-border bg-surface aspect-[3/2] flex items-center justify-center">
                      {e.thumbPath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`${art(e.thumbPath)}&w=240`}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : e.status === 'running' ? (
                        <span className="animate-spin h-4 w-4 border-[3px] border-border border-t-brand-teal rounded-full" />
                      ) : (
                        <span className="text-text-disabled text-lg">—</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold truncate">
                        {idsLabel(e)} · {e.titre}
                      </span>
                      <span className="block text-xs text-text-secondary truncate">{e.detail}</span>
                    </span>
                    <span className="hidden md:flex items-center gap-1.5 shrink-0">
                      <span className="text-[10.5px] font-bold bg-surface text-text-secondary rounded-full px-2.5 py-0.5">
                        {STEP_FR[e.step]}
                      </span>
                      {e.xl && (
                        <span className="text-[10.5px] font-bold bg-brand-teal-light text-brand-teal rounded-full px-2.5 py-0.5">
                          XL
                        </span>
                      )}
                      {e.status === 'running' ? (
                        <span className="text-[10.5px] font-bold bg-amber-100 text-amber-700 rounded-full px-2.5 py-0.5 animate-pulse">
                          ⏳ {e.done}/{e.total}
                        </span>
                      ) : e.status === 'error' ? (
                        <span className="text-[10.5px] font-bold bg-brand-red-light text-brand-red rounded-full px-2.5 py-0.5">
                          ✕ {e.errors} erreur{e.errors > 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-[10.5px] font-bold bg-brand-green-light text-brand-green rounded-full px-2.5 py-0.5">
                          ✓ terminé
                        </span>
                      )}
                      {coutOf(e) && (
                        <span className="text-[10.5px] font-mono bg-white border border-border text-text-secondary rounded-full px-2.5 py-0.5">
                          {coutOf(e)}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] text-text-disabled font-mono w-11 text-right">
                      {heureLabel(e.createdAt)}
                    </span>
                    {!archivesView && (
                      <button
                        title="Archiver cet essai"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          archiver({ ids: e.ids })
                        }}
                        className="shrink-0 text-text-disabled hover:text-brand-red hover:bg-surface rounded-[6px] px-1.5 py-1 transition-colors"
                      >
                        📦
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ——— Confirmation « Tout archiver » ——— */}
      {confirmAll && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-[12px] shadow-lg w-[430px] max-w-full p-6">
            <h3 className="text-base font-semibold mb-1">Tout archiver ?</h3>
            <p className="text-sm text-text-secondary mb-4">
              Tous les essais actifs du LAB (tous moteurs) partent aux archives. Ils restent
              consultables via « Voir les archives » — aucune image ni mesure n’est supprimée.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmAll(false)}
                className="bg-white border border-border text-text-secondary rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-surface transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => {
                  setConfirmAll(false)
                  archiver({ all: true })
                }}
                className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors"
              >
                📦 Tout archiver
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
