'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Studio MES (lot 4, 13/07/2026) — la fenêtre du studio décor, appliquée à la MES.
 * On voit la MES en grand, on envoie un RETOUR par prompt à Nano Banana Pro (→ une
 * nouvelle VERSION), on navigue dans les versions, et on « choisit » celle qu'on garde.
 *
 * Les versions d'une MES = les jobs du batch rattachés à sa racine (le job
 * d'intégration `rootJobId`) : le job d'intégration lui-même (V1) + les jobs
 * « mes-fix » dont `payload.rootJobId` vaut cette racine. Rien n'est persisté au
 * catalogue — le studio ne fait que suivre le batch et enqueuer des retouches.
 */

interface SJob {
  id: number
  type: string
  status: string
  payload: {
    coloris?: string
    size?: { w: number; h: number }
    rootJobId?: number
    instruction?: string
  } | null
  result: { deliveryPath?: string; instruction?: string } | null
  error: string | null
}

function imgUrl(p: string, w?: number): string {
  const base = `/api/artifacts?p=${encodeURIComponent(p)}`
  return w ? `${base}&w=${w}` : base
}

export default function MesStudio({
  batchId,
  produit = 'battant',
  mpEnabled = true,
  rootJobId,
  chosenJobId,
  onChoose,
  onMP,
  onClose,
}: {
  batchId: string
  /** Typologie (battant / portillon) — préfixe du nom de fichier téléchargé. */
  produit?: string
  /** false = déclinaison MP interdite par le moteur (réglage 'jamais') → bloc masqué. */
  mpEnabled?: boolean
  rootJobId: number
  chosenJobId: number | null
  onChoose: (versionJobId: number) => void
  onMP: (versionJobId: number) => void
  onClose: () => void
}) {
  const [jobs, setJobs] = useState<SJob[]>([])
  const [viewJobId, setViewJobId] = useState<number | null>(null)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [mpSent, setMpSent] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const follow = useRef(true)

  // Suivi du batch (versions + retouches en cours)
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const d = await fetch(`/api/gamme/${batchId}`).then((r) => r.json())
        if (alive && Array.isArray(d.jobs)) setJobs(d.jobs)
      } catch {
        // réseau : prochain tick
      }
    }
    tick()
    const t = setInterval(tick, 1800)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [batchId])

  // Échap pour fermer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const versions = jobs
    .filter((j) => j.id === rootJobId || (j.type === 'mes-fix' && j.payload?.rootJobId === rootJobId))
    .sort((a, b) => a.id - b.id)
  const numOf = (j: SJob) => versions.findIndex((v) => v.id === j.id) + 1
  const working = versions.some((v) => v.status === 'queued' || v.status === 'running')
  const doneVersions = versions.filter((v) => v.status === 'done' && v.result?.deliveryPath)
  const latestDone = doneVersions.length ? doneVersions[doneVersions.length - 1] : null

  // Suit automatiquement la dernière version prête, sauf si l'utilisateur en a choisi une à voir
  useEffect(() => {
    if (follow.current && latestDone) setViewJobId(latestDone.id)
  }, [latestDone])

  const current =
    versions.find((v) => v.id === viewJobId) ?? latestDone ?? versions[versions.length - 1] ?? null
  const meta = versions.find((v) => v.id === rootJobId)?.payload ?? current?.payload ?? {}
  const w = meta.size?.w
  const h = meta.size?.h
  const title = w && h ? `${meta.coloris ?? ''} · ${w}B${h}` : meta.coloris ?? 'MES'
  const instrOf = (j: SJob) => j.result?.instruction ?? j.payload?.instruction ?? ''

  const viewVersion = useCallback((id: number) => {
    follow.current = false
    setViewJobId(id)
  }, [])

  async function sendRetour() {
    const instr = instruction.trim()
    if (!instr || !current || working) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/generation/mes-correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: current.id, instruction: instr }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) {
        setMessage(d?.error ?? 'Retour impossible.')
        return
      }
      setInstruction('')
      follow.current = true // on suivra la nouvelle version dès qu'elle est prête
    } catch {
      setMessage('Impossible de contacter le serveur.')
    } finally {
      setBusy(false)
    }
  }

  const currentDone = current?.status === 'done' && current.result?.deliveryPath
  const dp = current?.result?.deliveryPath
  // MP déjà demandé pour cette MES (dans ce studio ou ailleurs) → un seul passage
  const mpDone =
    mpSent || jobs.some((j) => j.type === 'marketplace' && j.payload?.rootJobId === rootJobId)
  const fname = `${produit}_${(meta.coloris || 'mes').toLowerCase()}_${w ?? ''}B${h ?? ''}_site.jpg`
  const isChosen = current != null && current.id === chosenJobId

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-[16px] w-[min(1200px,96vw)] h-[min(840px,94vh)] flex flex-col overflow-hidden shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0">
          <div>
            <h2 className="font-bold text-text-primary">Studio MES — {title}</h2>
            <p className="text-xs text-text-secondary">
              Envoie un retour à Nano Banana Pro, compare les versions, garde celle qui te plaît.
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto text-text-disabled hover:text-text-primary transition-colors text-xl leading-none px-2"
            title="Fermer (Échap)"
          >
            ✕
          </button>
        </div>

        {message && (
          <div className="bg-brand-red-light border-b border-border text-brand-red text-sm px-5 py-2 shrink-0 flex justify-between">
            <span>{message}</span>
            <button onClick={() => setMessage(null)} className="text-brand-red hover:opacity-70">
              ✕
            </button>
          </div>
        )}

        <div className="flex-1 flex min-h-0 max-[800px]:flex-col">
          {/* Zone image + galerie */}
          <div className="flex-1 flex flex-col min-w-0 bg-surface">
            <div className="flex-1 grid place-items-center min-h-0 p-4 relative">
              {current == null ? (
                <p className="text-text-secondary text-sm">Aucune version.</p>
              ) : currentDone && dp ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imgUrl(dp)}
                  alt={title}
                  className={`max-h-[58vh] max-w-full object-contain rounded-[12px] shadow-sm ${working ? 'opacity-50' : ''}`}
                />
              ) : current.status === 'error' ? (
                <div className="text-center text-brand-red text-sm max-w-md">
                  <p className="font-medium mb-1">Cette version a échoué</p>
                  <p className="text-brand-red/80">{current.error ?? 'erreur'}</p>
                </div>
              ) : (
                <div className="text-center text-text-secondary">
                  <div className="animate-spin h-10 w-10 border-4 border-border border-t-brand-green rounded-full mx-auto mb-3" />
                  <p className="font-medium">Nano Banana Pro travaille…</p>
                  <p className="text-xs mt-1">La nouvelle version s&apos;affichera ici (≈ 1 à 2 min).</p>
                </div>
              )}
              {working && currentDone && (
                <div className="absolute inset-0 grid place-items-center pointer-events-none">
                  <div className="bg-white/95 rounded-[12px] px-5 py-4 text-center shadow-lg">
                    <div className="animate-spin h-7 w-7 border-4 border-border border-t-brand-green rounded-full mx-auto mb-2" />
                    <p className="text-sm font-medium text-text-secondary">Nouvelle version en cours…</p>
                  </div>
                </div>
              )}
            </div>

            {/* Galerie des versions */}
            <div className="shrink-0 border-t border-border bg-white px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-text-secondary font-bold mb-2">
                🕘 Versions ({versions.length})
              </p>
              <div className="flex gap-2.5 overflow-x-auto">
                {versions.map((v) => {
                  const n = numOf(v)
                  const vdone = v.status === 'done' && v.result?.deliveryPath
                  const vworking = v.status === 'queued' || v.status === 'running'
                  const on = current?.id === v.id
                  const chosen = v.id === chosenJobId
                  return (
                    <button
                      key={v.id}
                      onClick={() => viewVersion(v.id)}
                      className={`shrink-0 w-[132px] rounded-[8px] overflow-hidden border-2 text-left bg-white relative ${
                        on ? 'border-brand-green' : 'border-border hover:border-brand-green/50'
                      }`}
                      title={n === 1 ? 'MES d’origine' : instrOf(v)}
                    >
                      {vdone ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imgUrl(v.result!.deliveryPath!, 240)} alt={`V${n}`} loading="lazy" decoding="async" className="w-full h-[74px] object-cover" />
                      ) : (
                        <span className="w-full h-[74px] grid place-items-center bg-surface text-[11px] text-text-disabled">
                          {vworking ? '⏳ en cours' : v.status === 'error' ? '⚠ échec' : `V${n}`}
                        </span>
                      )}
                      {chosen && <span className="absolute top-1 right-1.5 text-brand-green text-sm">★</span>}
                      <span className="block px-2 py-1 text-[11px]">
                        <b>
                          V{n}
                          {chosen ? ' ✓' : ''}
                        </b>
                        <span className="block text-text-disabled truncate">
                          {n === 1 ? 'origine' : instrOf(v) || 'retouche'}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Colonne actions */}
          <div className="w-[340px] max-[800px]:w-auto shrink-0 border-l max-[800px]:border-l-0 max-[800px]:border-t border-border p-4 overflow-y-auto flex flex-col gap-4">
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-text-secondary font-bold mb-2">
                🪄 Envoyer un retour à Nano Banana Pro
              </label>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                disabled={working || busy}
                rows={3}
                placeholder="Ex. : « ajoute un lampadaire à gauche », « ciel plus dégagé », « ombre plus douce sous le portail »…"
                className="w-full border border-border bg-surface rounded-[8px] px-2.5 py-2 text-sm resize-y focus:outline-none focus:border-brand-green focus:bg-white transition-colors disabled:opacity-50"
              />
              <button
                onClick={sendRetour}
                disabled={busy || working || !instruction.trim()}
                className="mt-2 w-full bg-brand-green text-white rounded-[10px] py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
              >
                {working ? 'Version en cours…' : busy ? 'Envoi…' : 'Générer la version'}
              </button>
              <p className="text-[11px] text-text-disabled mt-1.5">
                Chaque retour crée une <b>nouvelle version</b> ; l&apos;ancienne reste dans l&apos;historique. Le
                portail est verrouillé (ne change pas).
              </p>
            </div>

            <div className="border-t border-border pt-3">
              <p className="text-[13px] text-text-secondary mb-2">
                Tu regardes <b>V{current ? numOf(current) : '–'}</b>
                {isChosen ? ' — c’est ta version choisie.' : chosenJobId ? '.' : '.'}
              </p>
              <button
                onClick={() => current && onChoose(current.id)}
                disabled={!currentDone || isChosen}
                className="w-full bg-brand-green text-white rounded-[10px] py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
              >
                {isChosen ? '★ Version déjà choisie' : `★ Je veux cette version (V${current ? numOf(current) : ''})`}
              </button>
              {currentDone && dp && (
                <a
                  href={imgUrl(dp)}
                  download={fname}
                  className="mt-2 w-full inline-flex items-center justify-center gap-2 bg-white border border-border text-text-secondary rounded-[10px] py-2 text-sm font-bold hover:border-brand-green hover:text-brand-green transition-colors"
                >
                  ⬇ Télécharger cette version
                </a>
              )}
            </div>

            {mpEnabled && (
            <div className="border-t border-border pt-3">
              <label className="block text-[11px] uppercase tracking-wide text-text-secondary font-bold mb-2">
                Marketplace (MP)
              </label>
              <button
                onClick={() => {
                  if (!current || mpDone) return
                  setMpSent(true)
                  onMP(chosenJobId ?? current.id)
                }}
                disabled={!currentDone || mpDone}
                className="w-full text-white rounded-[10px] py-2 text-sm font-bold disabled:opacity-50"
                style={{ background: '#6d5bb5' }}
              >
                {mpDone ? '✓ Déjà passée en MP' : '⬜ Passer la version choisie en MP'}
              </button>
              <p className="text-[11px] text-text-disabled mt-1.5">
                {mpDone
                  ? 'Le résultat MP apparaît sur la page de génération.'
                  : 'Recadrage 1:1 + génération des bords, sur la version que tu as choisie.'}
              </p>
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
