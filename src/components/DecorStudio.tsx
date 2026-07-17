'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Atelier décor — fenêtre plein écran par-dessus l'interface (demande Mathias
 * 09/07/2026 : « le moment le plus important, c'est à la création d'un décor »).
 *
 * Deux entrées :
 *  - CRÉATION : ouvert automatiquement au lancement des tirages — on voit les
 *    décors arriver en grand au fil des jobs, on corrige, on garde, on jette.
 *  - MODIFICATION : bouton « Modifier » sur un décor existant — même fenêtre,
 *    correction par prompt, historique des versions, retour arrière.
 */

interface StudioVersion {
  id: number
  version: number
  file_path: string
  kind: 'initial' | 'correction' | 'restauration'
  instruction: string | null
  created_at: string
}

interface StudioDecor {
  id: number
  name: string
  file_path: string
  status: 'a_valider' | 'actif' | 'archive'
  image_size: string | null
  moodboard_path: string | null
}

interface Slot {
  key: string
  label: string
  jobId: number | null
  fixJobId: number | null
  decor: StudioDecor | null
  versions: StudioVersion[]
  error: string | null
  gone: boolean
}

const KIND_LABELS: Record<StudioVersion['kind'], string> = {
  initial: 'tirage initial',
  correction: 'correction',
  restauration: 'restauration',
}
const STATUS_LABELS: Record<StudioDecor['status'], string> = {
  a_valider: 'À valider',
  actif: 'Actif',
  archive: 'Archivé',
}
const STATUS_STYLES: Record<StudioDecor['status'], string> = {
  a_valider: 'bg-brand-teal-light text-brand-teal',
  actif: 'bg-brand-green-light text-brand-green',
  archive: 'bg-surface text-text-secondary',
}

function imgUrl(p: string, w?: number): string {
  const base = `/api/artifacts?p=${encodeURIComponent(p)}`
  return w ? `${base}&w=${w}` : base
}

export default function DecorStudio({
  jobIds,
  decorId,
  isAdmin,
  onClose,
  onChanged,
  onUse,
}: {
  /** Mode création : jobs de génération à suivre (un tirage par job) */
  jobIds?: number[]
  /** Mode modification : décor existant */
  decorId?: number
  isAdmin: boolean
  onClose: () => void
  onChanged: () => void
  onUse: (filePath: string) => void
}) {
  const [slots, setSlots] = useState<Slot[]>(() =>
    jobIds?.length
      ? jobIds.map((id, i) => ({
          key: `job-${id}`,
          label: jobIds.length > 1 ? `Tirage ${i + 1}` : 'Décor',
          jobId: id,
          fixJobId: null,
          decor: null,
          versions: [],
          error: null,
          gone: false,
        }))
      : [
          {
            key: `decor-${decorId}`,
            label: 'Décor',
            jobId: null,
            fixJobId: null,
            decor: null,
            versions: [],
            error: null,
            gone: false,
          },
        ]
  )
  const [current, setCurrent] = useState(0)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // Moodboard en vis-à-vis du décor (comparaison avant validation) — actif par défaut
  const [compare, setCompare] = useState(true)
  const changedRef = useRef(onChanged)
  changedRef.current = onChanged

  const patchSlot = useCallback((key: string, patch: Partial<Slot>) => {
    setSlots((cur) => cur.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }, [])

  const loadDecor = useCallback(
    async (key: string, id: number) => {
      const res = await fetch(`/api/decors/${id}`)
      const data = await res.json().catch(() => null)
      if (res.ok && data?.decor) {
        patchSlot(key, { decor: data.decor, versions: data.versions ?? [] })
      }
    },
    [patchSlot]
  )

  // Chargement initial en mode modification
  useEffect(() => {
    if (decorId) void loadDecor(`decor-${decorId}`, decorId)
  }, [decorId, loadDecor])

  // Polling des jobs en cours (génération et corrections) — l'atelier se met à
  // jour tout seul, l'utilisateur ne quitte jamais la fenêtre.
  useEffect(() => {
    const watching = slots.some((s) => !s.gone && (s.jobId || s.fixJobId))
    if (!watching) return
    const timer = setInterval(async () => {
      for (const slot of slots) {
        if (slot.gone) continue
        const watchedId = slot.jobId ?? slot.fixJobId
        if (!watchedId) continue
        const res = await fetch(`/api/jobs/${watchedId}`)
        const data = await res.json().catch(() => null)
        const job = data?.job
        if (!job) continue
        if (job.status === 'done') {
          const dId: number | undefined = job.result?.decorId ?? slot.decor?.id
          patchSlot(slot.key, { jobId: null, fixJobId: null, error: null })
          if (dId) await loadDecor(slot.key, dId)
          changedRef.current()
        } else if (job.status === 'error') {
          patchSlot(slot.key, { jobId: null, fixJobId: null, error: job.error ?? 'Erreur inconnue' })
        }
      }
    }, 2500)
    return () => clearInterval(timer)
  }, [slots, loadDecor, patchSlot])

  // Échap pour fermer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const visible = slots.filter((s) => !s.gone)
  const slot = visible[Math.min(current, Math.max(0, visible.length - 1))] ?? null
  const decor = slot?.decor ?? null
  const working = Boolean(slot && (slot.jobId || slot.fixJobId))

  async function api(path: string, init: RequestInit): Promise<Record<string, unknown> | null> {
    const res = await fetch(path, init)
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setMessage(`Erreur : ${data?.error ?? res.status}`)
      return null
    }
    setMessage(null)
    return data
  }

  async function sendCorrection() {
    if (!slot || !decor || !instruction.trim()) return
    setBusy(true)
    const data = await api(`/api/decors/${decor.id}/correct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: instruction.trim() }),
    })
    setBusy(false)
    if (!data) return
    setInstruction('')
    patchSlot(slot.key, { fixJobId: Number(data.jobId), error: null })
  }

  async function restore(v: StudioVersion) {
    if (!slot || !decor) return
    const data = await api(`/api/decors/${decor.id}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versionId: v.id }),
    })
    if (!data) return
    await loadDecor(slot.key, decor.id)
    changedRef.current()
  }

  async function setStatus(status: StudioDecor['status']) {
    if (!slot || !decor) return
    const data = await api(`/api/decors/${decor.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!data) return
    patchSlot(slot.key, { decor: { ...decor, status } })
    changedRef.current()
  }

  async function renameDecor(name: string) {
    if (!slot || !decor || !name.trim() || name === decor.name) return
    const data = await api(`/api/decors/${decor.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    if (!data) return
    patchSlot(slot.key, { decor: { ...decor, name: name.trim() } })
    changedRef.current()
  }

  async function discard() {
    if (!slot || !decor) return
    if (isAdmin) {
      if (!window.confirm(`Jeter « ${decor.name} » ? Le fichier sera supprimé définitivement.`)) return
      const data = await api(`/api/decors/${decor.id}`, { method: 'DELETE' })
      if (!data) return
    } else {
      const data = await api(`/api/decors/${decor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archive' }),
      })
      if (!data) return
    }
    patchSlot(slot.key, { gone: true })
    changedRef.current()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[16px] w-[min(1200px,96vw)] h-[min(820px,94vh)] flex flex-col overflow-hidden shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div>
            <h2 className="font-semibold text-text-primary">Atelier décor</h2>
            <p className="text-xs text-text-secondary">
              Corrigez par prompt, comparez les versions, gardez ce qui vous plaît — tout se passe ici.
            </p>
          </div>
          <button onClick={onClose} className="text-text-disabled hover:text-text-primary transition-colors text-xl leading-none px-2" title="Fermer (Échap)">
            ✕
          </button>
        </div>

        {message && (
          <div className="bg-brand-red-light border-b border-border text-brand-red text-sm px-5 py-2 shrink-0 flex justify-between">
            <span>{message}</span>
            <button onClick={() => setMessage(null)} className="text-brand-red hover:opacity-70 transition-colors">✕</button>
          </div>
        )}

        {visible.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
            Tous les tirages ont été jetés.
            <button onClick={onClose} className="ml-2 text-brand-teal hover:underline">Fermer</button>
          </div>
        ) : (
          <div className="flex-1 flex min-h-0">
            {/* Zone image */}
            <div className="flex-1 flex flex-col min-w-0 bg-surface">
              {decor?.moodboard_path && (
                <div className="shrink-0 flex justify-end px-4 pt-3">
                  <button
                    onClick={() => setCompare((c) => !c)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      compare
                        ? 'bg-brand-teal-light border-brand-teal/40 text-brand-teal font-semibold'
                        : 'bg-white border-border text-text-secondary hover:bg-surface'
                    }`}
                  >
                    {compare ? '👁 Moodboard en vis-à-vis ✓' : '👁 Comparer au moodboard'}
                  </button>
                </div>
              )}
              <div className="flex-1 flex items-center justify-center min-h-0 p-4">
                {slot && slot.jobId && !decor ? (
                  <div className="text-center text-text-secondary">
                    <div className="animate-spin h-10 w-10 border-4 border-border border-t-brand-teal rounded-full mx-auto mb-4" />
                    <p className="font-medium">Génération en cours…</p>
                    <p className="text-xs mt-1">Le décor s&apos;affichera ici dès qu&apos;il sera prêt (≈ 1 à 2 min).</p>
                  </div>
                ) : slot?.error && !decor ? (
                  <div className="text-center text-brand-red text-sm max-w-md">
                    <p className="font-medium mb-1">La génération a échoué</p>
                    <p className="text-brand-red/80">{slot.error}</p>
                  </div>
                ) : decor ? (
                  <div className={`flex items-center justify-center gap-4 max-h-full max-w-full ${compare && decor.moodboard_path ? 'w-full' : ''}`}>
                    {/* Moodboard en vis-à-vis, pour juger la fidélité avant de valider */}
                    {compare && decor.moodboard_path && (
                      <figure className="flex-1 min-w-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imgUrl(decor.moodboard_path)}
                          alt="Moodboard d'origine"
                          onError={() => setCompare(false)}
                          className="max-h-[56vh] w-full object-contain rounded-[12px] relative cursor-zoom-in origin-left transition-transform duration-200 ease-out hover:scale-[1.45] hover:z-20"
                        />
                        <figcaption className="text-center text-[11px] text-text-disabled mt-1.5">
                          Moodboard (la référence)
                        </figcaption>
                      </figure>
                    )}
                    <figure className={`relative ${compare && decor.moodboard_path ? 'flex-1 min-w-0' : 'max-h-full max-w-full'}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imgUrl(decor.file_path)}
                        alt={decor.name}
                        className={`${
                          compare && decor.moodboard_path
                            ? 'max-h-[56vh] w-full relative cursor-zoom-in origin-right transition-transform duration-200 ease-out hover:scale-[1.45] hover:z-20'
                            : 'max-h-[62vh] max-w-full'
                        } object-contain rounded-[12px] ${working ? 'opacity-40' : ''}`}
                      />
                      {compare && decor.moodboard_path && (
                        <figcaption className="text-center text-[11px] text-text-disabled mt-1.5">
                          Décor généré
                        </figcaption>
                      )}
                      {working && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="bg-white/95 rounded-[12px] px-5 py-4 text-center shadow-default">
                            <div className="animate-spin h-7 w-7 border-4 border-border border-t-brand-teal rounded-full mx-auto mb-2" />
                            <p className="text-sm font-medium text-text-secondary">Correction en cours…</p>
                            <p className="text-[11px] text-text-disabled">L&apos;image se remplacera toute seule.</p>
                          </div>
                        </div>
                      )}
                    </figure>
                  </div>
                ) : null}
              </div>

              {/* Bandeau des tirages (mode création multiple) */}
              {visible.length > 1 && (
                <div className="shrink-0 flex gap-2 px-4 pb-4 overflow-x-auto">
                  {visible.map((s, i) => (
                    <button
                      key={s.key}
                      onClick={() => setCurrent(i)}
                      className={`shrink-0 rounded-[8px] overflow-hidden border-2 transition-colors ${
                        s === slot ? 'border-brand-green' : 'border-transparent hover:border-border'
                      }`}
                      title={s.decor?.name ?? s.label}
                    >
                      {s.decor ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imgUrl(s.decor.file_path, 240)} alt={s.label} loading="lazy" decoding="async" className="h-16 aspect-[3/2] object-cover" />
                      ) : (
                        <span className="h-16 aspect-[3/2] flex items-center justify-center bg-white text-[11px] text-text-disabled px-2">
                          {s.error ? '⚠ échec' : `${s.label}…`}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Colonne d'actions */}
            <div className="w-[340px] shrink-0 border-l border-border p-4 overflow-y-auto space-y-4">
              {decor ? (
                <>
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_STYLES[decor.status]}`}>
                        {STATUS_LABELS[decor.status]}
                      </span>
                      {decor.image_size && <span className="text-[10px] text-text-disabled">{decor.image_size}</span>}
                    </div>
                    <input
                      defaultValue={decor.name}
                      key={`name-${decor.id}-${decor.name}`}
                      onBlur={(e) => renameDecor(e.target.value)}
                      title="Nom du décor"
                      className="w-full border border-border bg-surface rounded-[8px] px-2 py-1.5 text-sm font-medium focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
                    />
                  </div>

                  <div>
                    <span className="text-xs font-medium text-text-secondary">🪄 Corriger ce décor</span>
                    <textarea
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      placeholder="Ex. : « enlève l'arbre à droite », « ciel plus dégagé », « allée en gravier clair »…"
                      rows={3}
                      disabled={working}
                      className="mt-1 w-full border border-border bg-surface rounded-[8px] px-2 py-1.5 text-sm resize-y focus:outline-none focus:border-brand-green focus:bg-white transition-colors disabled:opacity-50"
                    />
                    <button
                      onClick={sendCorrection}
                      disabled={busy || working || !instruction.trim()}
                      className="mt-1.5 w-full bg-brand-green text-white rounded-[10px] py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
                    >
                      {working ? 'Correction en cours…' : 'Appliquer la correction'}
                    </button>
                    <p className="text-[11px] text-text-disabled mt-1">
                      Seule la correction demandée change — trottoir et perspective verrouillés.
                      L&apos;ancienne image reste dans l&apos;historique.
                    </p>
                  </div>

                  {slot!.versions.length > 1 && (
                    <div>
                      <span className="text-xs font-medium text-text-secondary">🕘 Versions ({slot!.versions.length})</span>
                      <ul className="mt-2 space-y-2">
                        {slot!.versions.map((v) => {
                          const isCurrent = v.file_path === decor.file_path
                          return (
                            <li key={v.id} className="flex items-center gap-2">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={imgUrl(v.file_path, 240)}
                                alt={`v${v.version}`}
                                loading="lazy"
                                decoding="async"
                                className="w-16 aspect-[3/2] object-cover rounded-[8px] border border-border shrink-0"
                              />
                              <div className="min-w-0 grow">
                                <p className="text-xs font-medium">
                                  v{v.version} · {KIND_LABELS[v.kind]}
                                  {isCurrent && <span className="ml-1 text-brand-green">— courante</span>}
                                </p>
                                <p className="text-[11px] text-text-disabled truncate" title={v.instruction ?? undefined}>
                                  {v.instruction ?? ''}
                                </p>
                              </div>
                              {!isCurrent && (
                                <button
                                  onClick={() => restore(v)}
                                  disabled={working}
                                  className="shrink-0 bg-white border border-border text-text-secondary rounded-[8px] px-2 py-1 text-[11px] hover:bg-surface transition-colors disabled:opacity-50"
                                >
                                  Restaurer
                                </button>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}

                  <div className="border-t border-border pt-3 space-y-2">
                    {decor.status !== 'actif' && isAdmin && (
                      <button
                        onClick={() => setStatus('actif')}
                        disabled={working}
                        className="w-full bg-brand-green text-white rounded-[10px] py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
                      >
                        ✓ Garder ce décor (valider)
                      </button>
                    )}
                    <button
                      onClick={() => onUse(decor.file_path)}
                      disabled={working || decor.status !== 'actif'}
                      title={decor.status !== 'actif' ? 'Validez d’abord le décor' : undefined}
                      className="w-full bg-brand-teal text-white rounded-[10px] py-2 text-sm font-bold hover:bg-brand-teal-hover transition-colors disabled:opacity-50"
                    >
                      Utiliser ce décor →
                    </button>
                    <button
                      onClick={discard}
                      disabled={working}
                      className="w-full bg-white border border-border text-brand-red rounded-[10px] py-2 text-sm hover:bg-brand-red-light transition-colors disabled:opacity-50"
                    >
                      {isAdmin ? '🗑 Jeter ce tirage' : '⬛ Archiver ce tirage'}
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-text-disabled">
                  {slot?.error ? 'Ce tirage a échoué.' : 'En attente du décor…'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
