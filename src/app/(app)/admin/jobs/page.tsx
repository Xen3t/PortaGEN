'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

/**
 * Admin → Journal des générations : le fil complet de tous les jobs (décors,
 * maçonnerie, intégrations, corrections), un par ligne — l'ancien
 * « Suivi & validation », conservé pour l'administration (demande Mathias
 * 10/07/2026). L'équipe, elle, passe par la vue Production.
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
  createdBy: string | null
  createdAt: string
}

/** Appels Gemini + tokens de sortie d'une période (bandeau en tête, 05/08/2026). */
interface TokenCount {
  calls: number
  outputTokens: number
}
interface TokenStats {
  jour: TokenCount
  j7: TokenCount
  j30: TokenCount
  total: TokenCount
}

function fmtDate(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  queued: { label: 'En file', cls: 'bg-surface text-text-secondary' },
  running: { label: 'En cours', cls: 'bg-brand-teal-light text-brand-teal' },
  done: { label: 'Terminé', cls: 'bg-brand-green-light text-brand-green' },
  error: { label: 'Erreur', cls: 'bg-brand-red-light text-brand-red' },
  cancelled: { label: 'Annulé', cls: 'bg-background text-text-secondary' },
}

const REVIEW_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: 'À valider', cls: 'bg-brand-teal-light text-brand-teal' },
  approved: { label: 'Validée', cls: 'bg-brand-green text-white' },
  rejected: { label: 'Rejetée', cls: 'bg-brand-red text-white' },
}

/** La validation ne concerne plus que les décors (retirée des MES le 28/07/2026). */
function hasReview(job: Job): boolean {
  return job.type === 'decor' || job.type === 'decor-fix'
}

function jobTitle(job: Job): string {
  // Les essais de l'ancien Lab moteur (détruit le 05/08/2026) restent tracés ici.
  const labPrefix = job.payload?.lab === true ? '🧪 Lab · ' : ''
  if (job.type === 'decor') {
    const p = (job.payload?.slug as string) ?? ''
    return `${labPrefix}Décor — ${p}`
  }
  if (job.type === 'pillars') {
    const size = job.payload?.size as { w: number; h: number } | undefined
    return `${labPrefix}Piliers — ${size ? `${size.w}x${size.h}` : '?'}`
  }
  if (job.type === 'integration') {
    const size = job.payload?.size as { w: number; h: number } | undefined
    return `${labPrefix}Intégration — ${size ? `${size.w}x${size.h}` : '?'}`
  }
  if (job.type === 'pose-fusion') {
    const size = job.payload?.size as { w: number; h: number } | undefined
    return `${labPrefix}Pose + fusion — ${size ? `${size.w}x${size.h}` : '?'}`
  }
  if (job.type === 'decor-fix') return 'Correction de décor'
  return `${job.type} #${job.id}`
}

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [tokens, setTokens] = useState<TokenStats | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  async function cancel(job: Job) {
    const res = await fetch(`/api/jobs/${job.id}/cancel`, { method: 'POST' })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setNotice(data?.error ?? `Annulation impossible (${res.status})`)
      return
    }
    setNotice(null)
    setJobs((cur) => cur.map((j) => (j.id === job.id ? { ...j, status: 'cancelled' } : j)))
  }

  async function remove(job: Job) {
    if (!window.confirm(`Supprimer la demande #${job.id} (${jobTitle(job)}) du journal ?\nLes images déjà produites sont conservées.`)) return
    const res = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setNotice(data?.error ?? `Suppression impossible (${res.status})`)
      return
    }
    setNotice(null)
    setJobs((cur) => cur.filter((j) => j.id !== job.id))
  }

  useEffect(() => {
    let active = true
    const load = () =>
      fetch('/api/jobs?limit=200')
        .then((r) => r.json())
        .then((d) => {
          if (active) setJobs(d.jobs ?? [])
        })
    load()
    const t = setInterval(load, 3000)
    return () => {
      active = false
      clearInterval(t)
    }
  }, [])

  // Chiffres de tokens (remplacent la page Coûts API supprimée le 05/08/2026) :
  // rafraîchis toutes les 30 s seulement, les agrégats n'ont pas besoin du rythme des jobs.
  useEffect(() => {
    let active = true
    const load = () =>
      fetch('/api/tokens')
        .then((r) => r.json())
        .then((d) => {
          if (active && d.total) setTokens(d)
        })
    load()
    const t = setInterval(load, 30_000)
    return () => {
      active = false
      clearInterval(t)
    }
  }, [])

  // Recherche plein texte : nom du job, auteur, statut, validation, date.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return jobs
    return jobs.filter((job) => {
      const st = STATUS_LABEL[job.status] ?? STATUS_LABEL.queued
      const rv =
        job.status === 'done' && hasReview(job)
          ? (REVIEW_LABEL[job.reviewStatus] ?? REVIEW_LABEL.pending)
          : null
      const hay = [
        `#${job.id}`,
        jobTitle(job),
        job.createdBy ?? '',
        st.label,
        job.status,
        rv?.label ?? '',
        rv ? job.reviewStatus : '',
        fmtDate(job.createdAt),
        job.createdAt,
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [jobs, search])

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Journal des générations</h1>
      <p className="text-sm text-text-secondary mb-6">
        Le fil complet de tous les jobs, un par ligne — vue d&apos;administration. L&apos;équipe
        passe par les sessions de l&apos;<Link href="/" className="text-brand-teal hover:underline">Accueil</Link>.
      </p>
      {notice && (
        <div className="bg-brand-red-light text-brand-red text-sm rounded-[8px] px-4 py-3 mb-4 flex justify-between gap-4">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-brand-red/60 hover:text-brand-red transition-colors">✕</button>
        </div>
      )}
      {/* Tokens Gemini en tête (demande Mathias 05/08/2026, remplace la page
          Coûts API supprimée) : tokens de sortie = l'essentiel de la facture. */}
      {tokens && (
        <div className="bg-white rounded-[12px] border border-border shadow-sm px-5 py-4 mb-4 flex flex-wrap items-center gap-x-10 gap-y-3">
          {(
            [
              ['Aujourd’hui', tokens.jour],
              ['7 derniers jours', tokens.j7],
              ['30 derniers jours', tokens.j30],
              ['Depuis le début', tokens.total],
            ] as const
          ).map(([label, t]) => (
            <div key={label}>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-text-disabled mb-0.5">
                {label}
              </p>
              <p className="text-lg font-semibold leading-tight">
                {t.outputTokens.toLocaleString('fr-FR')}
                <span className="ml-1.5 text-xs font-normal text-text-secondary">
                  tokens sortie · {t.calls.toLocaleString('fr-FR')} appel{t.calls > 1 ? 's' : ''}
                </span>
              </p>
            </div>
          ))}
          <p className="ml-auto max-w-52 text-xs text-text-disabled">
            Les tokens de sortie (images) font l’essentiel de la facture Gemini.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Rechercher (nom du job, auteur, statut, validation, date — ex. « intégration », « mathias », « erreur », « 10/07 »)…"
          className="grow min-w-80 border border-border bg-white rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-brand-green transition-colors"
        />
        {search && (
          <span className="text-sm text-text-secondary">
            {filtered.length} résultat{filtered.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="bg-white rounded-[12px] border border-border shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Génération</th>
              <th className="px-4 py-3">Par</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Validation</th>
              <th className="px-4 py-3">Regen.</th>
              <th className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((job) => {
              const st = STATUS_LABEL[job.status] ?? STATUS_LABEL.queued
              const rv = hasReview(job) ? (REVIEW_LABEL[job.reviewStatus] ?? REVIEW_LABEL.pending) : null
              return (
                <tr key={job.id} className="hover:bg-surface">
                  <td className="px-4 py-3 text-text-disabled">{job.id}</td>
                  <td className="px-4 py-3">
                    <Link href={`/production/image/${job.id}`} className="font-medium text-text-primary hover:underline">
                      {jobTitle(job)}
                    </Link>
                    {job.batchId && (
                      <Link
                        href={`/production/gamme/${job.batchId}`}
                        className="ml-2 text-xs text-brand-teal hover:underline"
                        title="Toutes les tailles de ce lancement, en grille"
                      >
                        ▦ voir la gamme
                      </Link>
                    )}
                    {job.error && (
                      <div className="text-xs text-brand-red truncate max-w-md">{job.error}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{job.createdBy ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="px-4 py-3">
                    {job.status === 'done' && rv ? (
                      <span className={`px-2 py-0.5 rounded-full text-xs ${rv.cls}`}>{rv.label}</span>
                    ) : (
                      <span className="text-text-disabled text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{job.regenCount}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {job.status === 'queued' && (
                      <button
                        onClick={() => cancel(job)}
                        title="Suspendre cette demande : encore en file, elle ne sera pas exécutée"
                        className="border border-border text-text-secondary rounded-[8px] px-2 py-1 text-xs transition-colors hover:bg-brand-teal-light hover:border-brand-teal/40 hover:text-brand-teal"
                      >
                        ⏸ Suspendre
                      </button>
                    )}
                    {job.status !== 'running' && (
                      <button
                        onClick={() => remove(job)}
                        title="Supprimer cette demande du journal (les images produites sont conservées)"
                        className="ml-1.5 border border-border text-text-secondary rounded-[8px] px-2 py-1 text-xs transition-colors hover:bg-brand-red-light hover:border-brand-red/40 hover:text-brand-red"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-text-secondary">
                  {jobs.length === 0
                    ? 'Aucune génération pour l’instant.'
                    : 'Aucune génération ne correspond à cette recherche.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
