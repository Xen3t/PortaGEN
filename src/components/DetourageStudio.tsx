'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Poste de détourage plein écran (chantier 2) — conforme à maquettes/detourage-v4.html.
 * Un portail à la fois, en grand : détourer / valider / importer / ignorer, avec
 * choix du fond et ZOOM + déplacement sur toute l'image pour vérifier les bords.
 */

type Status = 'none' | 'a_valider' | 'valide' | 'importe' | 'ignore'
type ViewKind = 'face' | 'presumed' | 'angle' | 'back' | 'open' | null

interface QueueItem {
  coloris: string
  size: string
  w: number
  h: number
  ref: string
  sourceKind: ViewKind
  sourceRel: string | null
  status: Status
  pngPath: string | null
}

const FONDS = [
  { key: 'damier', label: 'Damier' },
  { key: 'sombre', label: 'Sombre' },
  { key: 'blanc', label: 'Blanc' },
] as const
type Fond = (typeof FONDS)[number]['key']

const fondStyle: Record<Fond, React.CSSProperties> = {
  damier: {
    backgroundImage: 'repeating-conic-gradient(#eef1f4 0% 25%, #ffffff 0% 50%)',
    backgroundSize: '24px 24px',
  },
  sombre: { background: '#2b3442' },
  blanc: { background: '#ffffff' },
}

const usableFace = (k: ViewKind) => k === 'face' || k === 'presumed'

export default function DetourageStudio({
  productId,
  productName,
  onClose,
}: {
  productId: number
  productName: string
  onClose: (changed: boolean) => void
}) {
  const [queue, setQueue] = useState<QueueItem[] | null>(null)
  const [cur, setCur] = useState(0)
  const [vue, setVue] = useState<'detoure' | 'origine'>('detoure')
  const [fond, setFond] = useState<Fond>('damier')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const changed = useRef(false)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const r = await fetch(`/api/catalogue/${productId}/detourage`)
    if (r.ok) {
      const d = await r.json()
      setQueue(d.queue as QueueItem[])
    }
  }, [productId])

  useEffect(() => {
    load()
  }, [load])

  // Ouvre sur la première référence non traitée.
  useEffect(() => {
    if (queue && cur === 0) {
      const i = queue.findIndex((q) => q.status === 'none' || q.status === 'a_valider')
      if (i > 0) setCur(i)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue])

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setVue('detoure')
  }
  const goto = (i: number) => {
    if (!queue || i < 0 || i >= queue.length) return
    setCur(i)
    resetView()
    setMsg(null)
  }

  const patch = (i: number, up: Partial<QueueItem>) => {
    setQueue((q) => (q ? q.map((it, k) => (k === i ? { ...it, ...up } : it)) : q))
    changed.current = true
  }

  const it = queue?.[cur]

  async function action(body: Record<string, unknown>) {
    if (!it) return null
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch(`/api/catalogue/${productId}/detourage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, coloris: it.coloris, size: it.size }),
      })
      return await r.json().catch(() => null)
    } finally {
      setBusy(false)
    }
  }

  async function detourer() {
    const d = await action({ action: 'run' })
    if (!d) return
    if (d.ok) {
      patch(cur, { status: 'a_valider', pngPath: d.row.png_path })
      resetView()
    } else {
      setMsg(d.error ?? 'Détourage impossible — importe ton PNG.')
    }
  }
  async function valider() {
    const d = await action({ action: 'valider' })
    if (d?.ok) {
      patch(cur, { status: 'valide' })
      next()
    }
  }
  async function ignorer() {
    const d = await action({ action: 'ignorer' })
    if (d?.ok) {
      patch(cur, { status: 'ignore' })
      next()
    }
  }
  function next() {
    if (!queue) return
    for (let k = cur + 1; k < queue.length; k++)
      if (queue[k].status === 'none' || queue[k].status === 'a_valider') return goto(k)
    if (cur < queue.length - 1) goto(cur + 1)
  }

  async function importer(file: File) {
    if (!it) return
    setBusy(true)
    setMsg(null)
    try {
      const fd = new FormData()
      fd.append('coloris', it.coloris)
      fd.append('size', it.size)
      fd.append('png', file)
      const r = await fetch(`/api/catalogue/${productId}/detourage`, { method: 'POST', body: fd })
      const d = await r.json().catch(() => null)
      if (r.ok && d?.ok) {
        patch(cur, { status: 'importe', pngPath: d.row.png_path })
        resetView()
      } else {
        setMsg(d?.error ?? 'Import refusé.')
      }
    } finally {
      setBusy(false)
    }
  }

  const validCount = queue?.filter((q) => q.status === 'valide' || q.status === 'importe').length ?? 0

  // Zoom molette + déplacement.
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom((z) => Math.min(6, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 0.87))))
  }
  const onDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return
    drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current) return
    setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })
  }
  const onUp = () => {
    drag.current = null
  }

  const srcUrl = it?.sourceRel
    ? `/api/catalogue/${productId}/fichier?p=${encodeURIComponent(it.sourceRel)}&w=1500`
    : null
  const pngUrl = it?.pngPath ? `/api/artifacts?p=${encodeURIComponent(it.pngPath)}` : null

  const hasResult = it && (it.status === 'a_valider' || it.status === 'valide' || it.status === 'importe')
  const showOrigine = vue === 'origine' && !!srcUrl
  const shownUrl = showOrigine ? srcUrl : hasResult ? pngUrl : srcUrl
  const stageFond: Fond = showOrigine ? 'blanc' : fond

  return (
    <div className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.6)] grid place-items-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-[min(1240px,100%)] h-[min(90vh,100%)] min-h-[560px] flex flex-col overflow-hidden">
        {/* en-tête */}
        <div className="flex items-center gap-4 px-6 py-3.5 border-b border-border">
          <span className="text-lg">✂</span>
          <h3 className="text-base font-bold m-0">Détourage — {productName}</h3>
          <span className="ml-auto text-sm text-text-secondary font-semibold">
            <b className="text-brand-green text-[15px]">{validCount}</b> / {queue?.length ?? '…'} validés
          </span>
          <button onClick={() => onClose(changed.current)} className="text-text-disabled text-2xl leading-none" title="Fermer">
            ✕
          </button>
        </div>

        {/* scène */}
        <div className="flex-1 flex items-center justify-center px-16 py-5 bg-[#fafbfc] relative min-h-0">
          {queue && queue.length === 0 && (
            <p className="text-text-secondary">Aucun visuel à détourer pour cette gamme.</p>
          )}
          {!queue && <p className="text-text-secondary">Chargement…</p>}
          {it && (
            <>
              <button
                onClick={() => goto(cur - 1)}
                disabled={cur === 0}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white border border-border grid place-items-center text-xl text-text-secondary hover:text-brand-green hover:border-brand-green disabled:opacity-30 shadow-sm"
              >
                ‹
              </button>
              <button
                onClick={() => goto(cur + 1)}
                disabled={cur === queue!.length - 1}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white border border-border grid place-items-center text-xl text-text-secondary hover:text-brand-green hover:border-brand-green disabled:opacity-30 shadow-sm"
              >
                ›
              </button>

              <div className="flex flex-col items-center gap-3 w-full max-w-[760px] min-h-0">
                <div className="text-xl font-bold">{it.ref} · {it.coloris}</div>
                <div className="text-xs text-text-secondary -mt-2">
                  {it.sourceRel ? it.sourceRel.split(/[\\/]/).pop() : 'aucun visuel produit'}
                </div>
                {/* badge d'état */}
                <ViewBadge item={it} />

                {/* barre outils (seulement quand on a une découpe) */}
                {hasResult && (
                  <div className="flex items-center gap-3 flex-wrap justify-center">
                    {srcUrl && (
                      <span className="inline-flex border border-border rounded-full overflow-hidden bg-white text-xs font-semibold">
                        <button onClick={() => { setVue('detoure'); }} className={`px-4 py-1.5 ${!showOrigine ? 'bg-brand-green text-white' : 'text-text-secondary'}`}>Détouré</button>
                        <button onClick={() => { setVue('origine'); setZoom(1); setPan({x:0,y:0}) }} className={`px-4 py-1.5 ${showOrigine ? 'bg-brand-green text-white' : 'text-text-secondary'}`}>Photo d’origine</button>
                      </span>
                    )}
                    {!showOrigine && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
                        fond
                        {FONDS.map((f) => (
                          <button
                            key={f.key}
                            onClick={() => setFond(f.key)}
                            title={f.label}
                            className={`w-6 h-6 rounded-md border ${fond === f.key ? 'border-brand-green ring-2 ring-brand-green-light' : 'border-border'}`}
                            style={fondStyle[f.key]}
                          />
                        ))}
                        {it.coloris.toUpperCase().includes('BLANC') && fond !== 'sombre' && (
                          <span className="text-amber-700 font-semibold ml-1">← portail clair : vérifie sur fond sombre</span>
                        )}
                      </span>
                    )}
                    <span className="text-xs text-text-disabled">molette = zoom · glisser = déplacer</span>
                  </div>
                )}

                {/* image (zoom + pan) OU zone d'import */}
                {hasResult || (usableFace(it.sourceKind) && it.status === 'none') ? (
                  <div
                    onWheel={onWheel}
                    onMouseDown={onDown}
                    onMouseMove={onMove}
                    onMouseUp={onUp}
                    onMouseLeave={onUp}
                    className="w-full flex-1 min-h-[240px] rounded-xl border border-border relative overflow-hidden grid place-items-center select-none"
                    style={{ ...fondStyle[stageFond], cursor: zoom > 1 ? 'grab' : 'default' }}
                  >
                    <span className="absolute top-3 left-3 z-10 text-[11px] font-bold text-text-secondary bg-white/90 border border-border rounded-full px-2.5 py-0.5">
                      {showOrigine ? 'photo d’origine' : hasResult ? 'fond transparent' : 'à détourer'}
                    </span>
                    {shownUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={shownUrl}
                        alt={it.ref}
                        draggable={false}
                        className="max-w-full max-h-full object-contain"
                        style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`, transition: drag.current ? 'none' : 'transform .08s' }}
                      />
                    )}
                    {it.status === 'none' && usableFace(it.sourceKind) && (
                      <div className="absolute inset-0 grid place-items-center bg-white/55">
                        <button onClick={detourer} disabled={busy} className="bg-brand-green text-white rounded-xl px-6 py-3 text-[15px] font-bold hover:bg-brand-green-hover disabled:opacity-50">
                          {busy ? 'Détourage…' : '✂ Détourer ce visuel'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : it.status === 'ignore' ? (
                  <div className="w-full flex-1 min-h-[240px] rounded-xl border border-border grid place-items-center text-text-secondary">
                    <div className="text-center">
                      <p className="font-bold text-text-primary">Référence laissée de côté</p>
                      <button onClick={() => patch(cur, { status: 'none' })} className="mt-3 bg-white border border-border rounded-lg px-3 py-1.5 text-xs font-bold text-text-secondary hover:text-brand-green">Reprendre</button>
                    </div>
                  </div>
                ) : (
                  <ImportZone kind={it.sourceKind} onPick={() => fileInput.current?.click()} busy={busy} />
                )}

                {msg && <p className="text-sm text-amber-700">{msg}</p>}
                {(it.status === 'valide' || it.status === 'importe') && (
                  <p className="text-xs text-text-disabled">
                    {it.status === 'importe' ? 'PNG fourni par toi · ' : ''}enregistré en local (data/) — rangé sur le serveur à l’activation de l’écriture.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* actions */}
        <div className="flex items-center gap-3 px-6 py-3 border-t border-border">
          <span className="text-sm text-text-secondary">{it ? `Portail ${cur + 1} sur ${queue!.length}` : ''}</span>
          <span className="ml-auto flex items-center gap-2.5">
            {it?.status === 'none' && usableFace(it.sourceKind) && (
              <button onClick={detourer} disabled={busy} className="bg-brand-green text-white rounded-lg px-5 py-2.5 text-sm font-bold hover:bg-brand-green-hover disabled:opacity-50">
                {busy ? 'Détourage…' : '✂ Détourer'}
              </button>
            )}
            {it?.status === 'a_valider' && (
              <>
                <button onClick={detourer} disabled={busy} className="bg-white text-text-secondary border border-border rounded-lg px-4 py-2.5 text-sm font-bold hover:text-brand-green">↻ Refaire</button>
                <button onClick={valider} disabled={busy} className="bg-brand-green text-white rounded-lg px-5 py-2.5 text-sm font-bold hover:bg-brand-green-hover disabled:opacity-50">✓ Valider et suivant →</button>
              </>
            )}
            {(it?.status === 'valide' || it?.status === 'importe') && (
              <>
                {it.sourceRel && usableFace(it.sourceKind) && (
                  <button onClick={detourer} disabled={busy} className="bg-white text-text-secondary border border-border rounded-lg px-4 py-2.5 text-sm font-bold hover:text-brand-green">↻ Refaire</button>
                )}
                <button onClick={next} className="bg-brand-green text-white rounded-lg px-5 py-2.5 text-sm font-bold hover:bg-brand-green-hover">Suivant →</button>
              </>
            )}
            {it && !usableFace(it.sourceKind) && it.status !== 'importe' && it.status !== 'ignore' && (
              <button onClick={ignorer} disabled={busy} className="bg-white text-text-secondary border border-border rounded-lg px-4 py-2.5 text-sm font-bold hover:text-brand-green">Ignorer pour l’instant →</button>
            )}
          </span>
        </div>

        {/* file (miniatures) */}
        <div className="flex gap-2.5 px-6 py-3 border-t border-border overflow-x-auto">
          {queue?.map((q, i) => (
            <button
              key={q.coloris + q.size}
              onClick={() => goto(i)}
              title={`${q.ref} · ${q.coloris}`}
              className={`flex-none w-[104px] h-[64px] rounded-lg border relative grid place-items-center overflow-hidden ${i === cur ? 'border-brand-green ring-2 ring-brand-green-light' : 'border-border'}`}
              style={q.pngPath ? fondStyle.damier : undefined}
            >
              {q.pngPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/artifacts?p=${encodeURIComponent(q.pngPath)}`} alt="" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-[10px] text-text-disabled px-1 text-center">{q.ref.replace('VOGEL ', '')}</span>
              )}
              <span className={`absolute top-1 right-1 w-4 h-4 rounded-full text-[9px] grid place-items-center text-white font-bold ${dotClass(q.status)}`}>
                {dotText(q.status)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/png"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) importer(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function ViewBadge({ item }: { item: QueueItem }) {
  const cls = 'text-xs font-bold rounded-full px-3.5 py-1'
  if (item.status === 'valide' || item.status === 'importe')
    return <span className={`${cls} bg-brand-green-light text-brand-green`}>✓ {item.status === 'importe' ? 'PNG importé' : 'détouré'} &amp; validé</span>
  if (item.status === 'a_valider')
    return <span className={`${cls} bg-brand-green-light text-brand-green`}>✓ face détectée — à valider</span>
  if (usableFace(item.sourceKind)) return <span className={`${cls} bg-brand-green-light text-brand-green`}>✓ face détectée</span>
  if (item.sourceKind === 'angle') return <span className={`${cls} bg-amber-100 text-amber-700`}>⚠ vue d’angle (3/4) — inutilisable de face</span>
  if (item.sourceKind === 'back') return <span className={`${cls} bg-amber-100 text-amber-700`}>⚠ vue de dos — inutilisable de face</span>
  return <span className={`${cls} bg-surface text-text-secondary`}>aucune photo de face sur le serveur</span>
}

function ImportZone({ kind, onPick, busy }: { kind: ViewKind; onPick: () => void; busy: boolean }) {
  const msg =
    kind === 'angle' || kind === 'back'
      ? 'Vue inutilisable de face — importe ton PNG détouré, ou choisis un autre fichier.'
      : 'Aucune photo de face sur le serveur. Importe ton PNG si tu l’as.'
  return (
    <div className="w-full flex-1 min-h-[240px] rounded-xl border-2 border-dashed border-amber-300 bg-[#fffdf6] grid place-items-center">
      <div className="text-center max-w-md px-6">
        <div className="text-4xl">⬆</div>
        <p className="text-[15px] font-bold text-amber-700 mt-2">Importe le PNG de face</p>
        <p className="text-sm text-text-secondary mt-1">{msg}</p>
        <button onClick={onPick} disabled={busy} className="mt-4 bg-amber-700 text-white rounded-lg px-5 py-2.5 text-sm font-bold disabled:opacity-50">
          ⬆ Importer mon PNG
        </button>
      </div>
    </div>
  )
}

function dotClass(s: Status): string {
  if (s === 'valide' || s === 'importe') return 'bg-brand-green'
  if (s === 'a_valider') return 'bg-text-disabled'
  if (s === 'ignore') return 'bg-border text-text-secondary'
  return 'bg-amber-700'
}
function dotText(s: Status): string {
  if (s === 'valide' || s === 'importe') return '✓'
  if (s === 'ignore') return '–'
  if (s === 'a_valider') return '·'
  return '!'
}
