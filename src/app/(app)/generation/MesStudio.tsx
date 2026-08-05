'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import PhraseAttente from '@/components/PhraseAttente'
import Chargement from '@/components/Chargement'

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
  result: { deliveryPath?: string; instruction?: string; productPath?: string } | null
  error: string | null
}

function imgUrl(p: string, w?: number): string {
  const base = `/api/artifacts?p=${encodeURIComponent(p)}`
  return w ? `${base}&w=${w}` : base
}

/** Une génération (variante) d'une taille, pour la galerie du studio. */
export interface StudioVariant {
  id: number
  /** Numéro de génération (1..N). */
  n: number
  status: string
  deliveryPath?: string
  chosen: boolean
}

export default function MesStudio({
  batchId,
  produit = 'battant',
  mpEnabled = true,
  rootJobId,
  chosenJobId,
  variants = [],
  chosenVariantId = null,
  onChoose,
  onChooseVariant,
  onSelectVariant,
  onMP,
  onClose,
  onPrev,
  onNext,
}: {
  batchId: string
  /** Typologie (battant / portillon) — préfixe du nom de fichier téléchargé. */
  produit?: string
  /** false = déclinaison MP interdite par le moteur (réglage 'jamais') → bloc masqué. */
  mpEnabled?: boolean
  rootJobId: number
  chosenJobId: number | null
  /**
   * Générations multiples (29/07/2026) : les variantes de la MÊME taille. Vide ou
   * une seule = comportement historique (pas de galerie de générations, pas de
   * verrou MP). rootJobId est la génération AFFICHÉE.
   */
  variants?: StudioVariant[]
  /** Génération retenue de la taille (persistée), null = aucune choisie. */
  chosenVariantId?: number | null
  onChoose: (versionJobId: number) => void
  /** Désigne la génération affichée comme la MES retenue de la taille. */
  onChooseVariant?: (variantJobId: number) => void
  /** Bascule vers une autre génération de la taille (parent change la MES ouverte). */
  onSelectVariant?: (variantJobId: number) => void
  onMP: (versionJobId: number) => void
  onClose: () => void
  /** ← : MES précédente du lot (absent = première). */
  onPrev?: () => void
  /** → : MES suivante du lot (absent = dernière). */
  onNext?: () => void
}) {
  const [jobs, setJobs] = useState<SJob[]>([])
  // false tant que la première réponse du serveur n'est pas arrivée : la zone
  // image montre la roue de chargement, pas « Aucune version. » (28/07/2026).
  const [charge, setCharge] = useState(false)
  const [viewJobId, setViewJobId] = useState<number | null>(null)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [mpSent, setMpSent] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // Aperçu en grand du PNG produit d'origine, par-dessus le studio
  const [pngZoom, setPngZoom] = useState(false)
  // Loupe : position de la souris sur l'image (0..1) + ratio hauteur/largeur de l'image,
  // null = souris hors de l'image
  const [loupe, setLoupe] = useState<{ x: number; y: number; ar: number } | null>(null)
  // Puissance de la loupe (molette sur l'image pour l'ajuster), gardée entre deux survols
  const [loupeZoom, setLoupeZoom] = useState(4)
  // Dimensions de la fenêtre de la loupe, mesurées à son affichage (pour centrer sous le curseur)
  const [lensBox, setLensBox] = useState<{ w: number; h: number } | null>(null)
  const lensRef = useCallback((el: HTMLDivElement | null) => {
    if (el) setLensBox({ w: el.offsetWidth, h: el.offsetHeight })
  }, [])
  const imgRef = useRef<HTMLImageElement | null>(null)
  const zoneRef = useRef<HTMLDivElement | null>(null)

  // Studio ouvert = la page derrière ne défile plus (sinon la molette la fait bouger)
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Molette au-dessus de l'image = puissance de la loupe. Listener natif non-passif
  // posé sur la zone image (toujours montée) : on doit pouvoir bloquer le défilement
  // du navigateur, ce que l'onWheel de React ne permet pas.
  useEffect(() => {
    const zone = zoneRef.current
    if (!zone) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const img = imgRef.current
      if (!img || !(e.target instanceof Node) || !img.contains(e.target)) return
      setLoupeZoom((z) => Math.min(12, Math.max(2, e.deltaY < 0 ? z + 1 : z - 1)))
    }
    zone.addEventListener('wheel', onWheel, { passive: false })
    return () => zone.removeEventListener('wheel', onWheel)
  }, [])
  const follow = useRef(true)

  // Butée des flèches : petit message éphémère quand ← sur la première MES
  // du lot ou → sur la dernière (rien ne bouge, on prévient juste).
  const [edgeHint, setEdgeHint] = useState<string | null>(null)
  const edgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showEdge = useCallback((msg: string) => {
    setEdgeHint(msg)
    if (edgeTimer.current) clearTimeout(edgeTimer.current)
    edgeTimer.current = setTimeout(() => setEdgeHint(null), 1600)
  }, [])
  useEffect(
    () => () => {
      if (edgeTimer.current) clearTimeout(edgeTimer.current)
    },
    []
  )

  // Suivi du batch (versions + retouches en cours)
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const d = await fetch(`/api/gamme/${batchId}`).then((r) => r.json())
        if (alive && Array.isArray(d.jobs)) {
          setJobs(d.jobs)
          setCharge(true)
        }
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

  // Échap : ferme l'aperçu PNG s'il est ouvert, sinon le studio.
  // ← / → : MES précédente / suivante du lot — sauf quand on tape un retour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pngZoom) setPngZoom(false)
        else onClose()
        return
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return
      if (e.key === 'ArrowLeft') {
        if (onPrev) onPrev()
        else showEdge('Première MES du lot')
      } else {
        if (onNext) onNext()
        else showEdge('Dernière MES du lot')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pngZoom, onPrev, onNext, showEdge])

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
  // PNG produit d'origine — porté par le job MES racine, identique pour toutes les versions
  const pp = versions.find((v) => v.id === rootJobId)?.result?.productPath
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
  // Générations multiples (29/07/2026) : galerie des variantes + verrou MP.
  const multiGen = variants.length > 1
  const sortedVariants = [...variants].sort((a, b) => a.n - b.n || a.id - b.id)
  // La MES retenue de la taille est-elle celle affichée ? (mono-génération = oui d'office)
  const currentIsChosenVariant = !multiGen || chosenVariantId === rootJobId
  const canChooseVariant =
    multiGen && !!currentDone && chosenVariantId !== rootJobId && !!onChooseVariant

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
            <div ref={zoneRef} className="flex-1 grid place-items-center min-h-0 p-4 relative">
              {current == null ? (
                charge ? (
                  <p className="text-text-secondary text-sm">Aucune version.</p>
                ) : (
                  <Chargement plein={false} />
                )
              ) : currentDone && dp ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  ref={imgRef}
                  src={imgUrl(dp)}
                  alt={title}
                  onMouseMove={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setLoupe({
                      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
                      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
                      ar: r.height / r.width,
                    })
                  }}
                  onMouseLeave={() => setLoupe(null)}
                  className="max-h-[58vh] max-w-full object-contain rounded-[12px] shadow-sm cursor-crosshair"
                />
              ) : current.status === 'error' ? (
                <div className="text-center text-brand-red text-sm max-w-md">
                  <p className="font-medium mb-1">Cette version a échoué</p>
                  <p className="text-brand-red/80">{current.error ?? 'erreur'}</p>
                </div>
              ) : (
                <div className="text-center text-text-secondary">
                  <div className="animate-spin h-10 w-10 border-4 border-border border-t-brand-green rounded-full mx-auto mb-3" />
                  <p className="font-medium"><PhraseAttente /></p>
                  <p className="text-xs mt-1">La nouvelle version s&apos;affichera ici (≈ 1 à 2 min).</p>
                </div>
              )}
              {/* Jamais de voile ni de roue PAR-DESSUS la version affichée quand une
                  autre version se génère (demande Mathias 28/07/2026) : l'attente se
                  lit dans la galerie (« En cours… ») et sur le bouton de retouche. */}
              {edgeHint && (
                <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/70 text-white text-xs font-bold px-3.5 py-1.5 rounded-full pointer-events-none animate-fade-in-up whitespace-nowrap">
                  {edgeHint}
                </span>
              )}
            </div>

            {/* Galerie des GÉNÉRATIONS (générations multiples, 29/07/2026) :
                les variantes de la taille, côte à côte — clic pour comparer. */}
            {multiGen && (
              <div className="shrink-0 border-t border-border bg-white px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-text-secondary font-bold mb-2">
                  ▦ Générations — clique pour comparer, choisis celle à garder
                </p>
                <div className="flex gap-2.5 overflow-x-auto">
                  {sortedVariants.map((v) => {
                    const vdone = v.status === 'done' && v.deliveryPath
                    const vworking = v.status === 'queued' || v.status === 'running'
                    const on = v.id === rootJobId
                    const isChosenV = v.id === chosenVariantId
                    return (
                      <button
                        key={v.id}
                        onClick={() => onSelectVariant?.(v.id)}
                        className={`shrink-0 w-[132px] rounded-[8px] overflow-hidden border-2 text-left bg-white relative ${
                          on ? 'border-brand-teal' : isChosenV ? 'border-brand-green' : 'border-border hover:border-brand-green/50'
                        }`}
                        title={`Génération ${v.n}`}
                      >
                        {vdone ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imgUrl(v.deliveryPath!, 240)} alt={`Génération ${v.n}`} loading="lazy" decoding="async" className="w-full h-[74px] object-cover" />
                        ) : (
                          <span className="w-full h-[74px] grid place-items-center bg-surface text-[11px] text-text-disabled">
                            {vworking ? 'En cours…' : v.status === 'error' ? 'Échec' : `Génération ${v.n}`}
                          </span>
                        )}
                        {isChosenV && (
                          <span className="absolute top-1 right-1 bg-brand-green text-white text-[10px] font-bold px-1.5 py-px rounded-full">
                            Choisie
                          </span>
                        )}
                        <span className="block px-2 py-1 text-[11px]">
                          <b>Génération {v.n}</b>
                          <span className="block text-text-disabled truncate">
                            {on ? 'affichée' : isChosenV ? 'retenue' : 'voir'}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Galerie des versions (retouches de la génération affichée) — masquée
                quand il n'y a qu'une version ET plusieurs générations (bruit inutile). */}
            {(!multiGen || versions.length > 1) && (
            <div className="shrink-0 border-t border-border bg-white px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-text-secondary font-bold mb-2">
                {multiGen ? `Versions de la génération affichée (${versions.length})` : `Versions (${versions.length})`}
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
                          {vworking ? 'En cours…' : v.status === 'error' ? 'Échec' : `V${n}`}
                        </span>
                      )}
                      {chosen && (
                        <span className="absolute top-1 right-1 bg-brand-green text-white text-[10px] font-bold px-1.5 py-px rounded-full">
                          Choisie
                        </span>
                      )}
                      <span className="block px-2 py-1 text-[11px]">
                        <b>V{n}</b>
                        <span className="block text-text-disabled truncate">
                          {n === 1 ? 'Origine' : instrOf(v) || 'Retouche'}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
            )}
          </div>

          {/* Colonne actions — grisée et recouverte par la loupe pendant le survol de l'image */}
          <div className="w-[340px] max-[800px]:w-auto shrink-0 border-l max-[800px]:border-l-0 max-[800px]:border-t border-border relative">
            <div
              className={`h-full p-4 overflow-y-auto flex flex-col gap-4 transition-opacity ${
                loupe ? 'opacity-30 grayscale pointer-events-none select-none' : ''
              }`}
            >
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-text-secondary font-bold mb-2">
                Demander une retouche
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
            </div>

            {/* Choix de la GÉNÉRATION retenue (générations multiples, 29/07/2026) */}
            {multiGen && (
              <div className="border-t border-border pt-3">
                <p className="text-[13px] text-text-secondary mb-2">
                  Génération affichée : <b>Génération {variants.find((v) => v.id === rootJobId)?.n ?? 1}</b>
                  {currentIsChosenVariant ? ' — retenue' : ''}
                </p>
                <button
                  onClick={() => !currentIsChosenVariant && onChooseVariant?.(rootJobId)}
                  disabled={!canChooseVariant}
                  className="w-full bg-brand-green text-white rounded-[10px] py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
                >
                  {currentIsChosenVariant ? '✓ Génération retenue' : 'Choisir cette génération'}
                </button>
                {currentDone && dp && (
                  <a
                    href={imgUrl(dp)}
                    download={fname}
                    className="mt-2 w-full inline-flex items-center justify-center gap-2 bg-white border border-border text-text-secondary rounded-[10px] py-2 text-sm font-bold hover:border-brand-green hover:text-brand-green transition-colors"
                  >
                    Télécharger cette génération
                  </a>
                )}
                <p className="text-[11px] text-text-disabled mt-1.5">
                  Une seule génération retenue par taille — c&apos;est elle qu&apos;on décline en Marketplace.
                </p>
              </div>
            )}

            {/* Choix de la VERSION (retouche) — mono-génération (historique) ou dès
                qu'une génération a plusieurs versions (retouches). */}
            {(!multiGen || versions.length > 1) && (
            <div className="border-t border-border pt-3">
              <p className="text-[13px] text-text-secondary mb-2">
                Version affichée : <b>V{current ? numOf(current) : '–'}</b>
                {isChosen ? ' — version choisie' : ''}
              </p>
              <button
                onClick={() => current && onChoose(current.id)}
                disabled={!currentDone || isChosen}
                className="w-full bg-brand-green text-white rounded-[10px] py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
              >
                {isChosen ? 'Version déjà choisie' : 'Choisir cette version'}
              </button>
              {currentDone && dp && !multiGen && (
                <a
                  href={imgUrl(dp)}
                  download={fname}
                  className="mt-2 w-full inline-flex items-center justify-center gap-2 bg-white border border-border text-text-secondary rounded-[10px] py-2 text-sm font-bold hover:border-brand-green hover:text-brand-green transition-colors"
                >
                  Télécharger cette version
                </a>
              )}
            </div>
            )}

            {mpEnabled && (
            <div className="border-t border-border pt-3">
              <label className="block text-[11px] uppercase tracking-wide text-text-secondary font-bold mb-2">
                Marketplace (MP)
              </label>
              <button
                onClick={() => {
                  if (!current || mpDone || !currentIsChosenVariant) return
                  setMpSent(true)
                  onMP(chosenJobId ?? current.id)
                }}
                disabled={!currentDone || mpDone || !currentIsChosenVariant}
                className="w-full text-white rounded-[10px] py-2 text-sm font-bold disabled:opacity-50"
                style={{ background: '#6d5bb5' }}
              >
                {mpDone ? 'Déclinée en MP' : 'Décliner en MP'}
              </button>
              {multiGen && !currentIsChosenVariant && !mpDone && (
                <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 rounded-[8px] px-2.5 py-1.5 mt-1.5">
                  🔒 Choisis d&apos;abord cette génération (ou ouvre la génération retenue) pour la décliner en MP.
                </p>
              )}
              {mpDone && (
                <p className="text-[11px] text-text-disabled mt-1.5">
                  Le résultat MP apparaît sur la page de génération.
                </p>
              )}
            </div>
            )}

            {/* PNG produit d'origine (détouré) — clic = aperçu en grand par-dessus le
                studio. Bloc ÉLASTIQUE (demande Mathias 28/07) : la vignette occupe la
                hauteur restante de la colonne et rétrécit au besoin, pour que tout
                tienne toujours SANS ascenseur. */}
            {pp && (
              <div className="border-t border-border pt-3 flex-1 min-h-0 flex flex-col">
                <label className="block text-[11px] uppercase tracking-wide text-text-secondary font-bold mb-2 shrink-0">
                  PNG produit d&apos;origine
                </label>
                <button
                  type="button"
                  onClick={() => setPngZoom(true)}
                  title="Le produit détouré utilisé pour cette MES — cliquer pour agrandir"
                  className="w-full flex-1 min-h-[56px] overflow-hidden bg-white border border-border rounded-[10px] p-2 cursor-zoom-in hover:border-brand-green transition-colors flex items-center justify-center"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imgUrl(pp, 480)}
                    alt="PNG produit d'origine"
                    loading="lazy"
                    decoding="async"
                    className="max-w-full max-h-full object-contain"
                  />
                </button>
                <p className="text-[11px] text-text-disabled mt-1.5 shrink-0">
                  Cliquer pour l&apos;afficher en grand.
                </p>
              </div>
            )}
            </div>

            {/* Loupe : vue zoomée centrée sous le curseur, par-dessus les boutons.
                Près des bords, la partie sans image reste blanche. */}
            {loupe && currentDone && dp && (
              <div className="absolute inset-0 z-10 p-2 pointer-events-none">
                <div
                  ref={lensRef}
                  className="w-full h-full rounded-[12px] border-2 border-brand-green bg-white shadow-lg bg-no-repeat"
                  style={(() => {
                    // Le point sous le curseur (x, y en 0..1) est placé au centre de la fenêtre
                    const bgW = (lensBox?.w ?? 320) * loupeZoom
                    const bgH = bgW * loupe.ar
                    return {
                      backgroundImage: `url(${imgUrl(dp)})`,
                      backgroundSize: `${bgW}px ${bgH}px`,
                      backgroundPosition: `${(lensBox?.w ?? 320) / 2 - loupe.x * bgW}px ${
                        (lensBox?.h ?? 320) / 2 - loupe.y * bgH
                      }px`,
                    }
                  })()}
                />
                <span className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 border border-border rounded-full px-3 py-1 text-[11px] font-bold text-text-secondary shadow-sm whitespace-nowrap">
                  Loupe ×{loupeZoom} <span className="font-normal text-text-disabled">(molette)</span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Aperçu en grand du PNG produit — par-dessus le studio (fond blanc :
          un produit détouré serait invisible sur le voile noir) */}
      {pngZoom && pp && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={(e) => {
            e.stopPropagation()
            setPngZoom(false)
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgUrl(pp)}
            alt="PNG produit en grand"
            className="max-w-full max-h-full object-contain rounded-[8px] bg-white"
          />
        </div>
      )}
    </div>
  )
}
