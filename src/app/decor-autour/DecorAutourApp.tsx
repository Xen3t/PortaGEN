'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Types locaux (mêmes formes que src/lib/decorAutour, redéclarées pour ne pas
// importer le module serveur — il tire fs/sharp — dans le bundle client).
interface ImageRef {
  name: string
  rel: string
  w: number | null
  h: number | null
}
interface DossierRef {
  name: string
  rel: string
}
interface Crumb {
  name: string
  rel: string
}
interface Listing {
  dir: string
  parent: string | null
  crumbs: Crumb[]
  folders: DossierRef[]
  images: ImageRef[]
}

interface Choix {
  name: string
  w: number
  h: number
}
type Statut = 'idle' | 'pending' | 'done' | 'error'
interface ResultState {
  statut: Statut
  resultPath?: string
  error?: string
}
interface RenduRecent {
  key: string
  title: string
  w: number | null
  h: number | null
  planPath: string
  resultPath: string
}

const DESCRIPTION_DEFAUT =
  "Derrière le portail, une maison individuelle française (pavillon) vue de face, façade frontale visible au-dessus du muret. De part et d'autre, piliers carrés et muret bas en stucco blanc (crépi), chapeau plat. Devant, trottoir béton, bordure, route bitume. Grand ciel bleu dégagé et ensoleillé, lumière franche de beau temps."

/** Aperçu du plan gris (gratuit, sans Nano) pour une image donnée. */
function planUrl(rel: string): string {
  return `/api/decor-autour?file=${encodeURIComponent(rel)}`
}
/** Artefact servi par /api/artifacts (miniature si w fourni). */
function art(p: string, w?: number): string {
  return `/api/artifacts?p=${encodeURIComponent(p)}${w ? `&w=${w}` : ''}`
}
function sansExt(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '')
}

export default function DecorAutourApp() {
  const [dir, setDir] = useState<string | undefined>(undefined)
  const [listing, setListing] = useState<Listing | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [listErr, setListErr] = useState('')
  const [selected, setSelected] = useState<Record<string, Choix>>({})
  const [description, setDescription] = useState(DESCRIPTION_DEFAUT)
  const [aspectRatio, setAspectRatio] = useState<'3:2' | '4:3'>('3:2')
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('2K')
  const [results, setResults] = useState<Record<string, ResultState>>({})
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [lightbox, setLightbox] = useState<{ avant: string; apres: string | null; title: string } | null>(null)
  const [history, setHistory] = useState<RenduRecent[]>([])

  const fetchHistory = useCallback(() => {
    fetch('/api/decor-autour/history')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setHistory(d)
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  useEffect(() => {
    let ok = true
    setLoadingList(true)
    setListErr('')
    fetch(`/api/decor-autour/browse${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`)
      .then((r) => r.json())
      .then((data) => {
        if (!ok) return
        if (data.error) setListErr(data.error)
        else setListing(data)
      })
      .catch((e) => ok && setListErr(String(e)))
      .finally(() => ok && setLoadingList(false))
    return () => {
      ok = false
    }
  }, [dir])

  const toggleSelect = useCallback((img: ImageRef) => {
    if (img.w === null || img.h === null) return
    setSelected((prev) => {
      const next = { ...prev }
      if (next[img.rel]) delete next[img.rel]
      else next[img.rel] = { name: img.name, w: img.w as number, h: img.h as number }
      return next
    })
  }, [])

  const nbSel = Object.keys(selected).length

  // Grille : une largeur = une ligne (règle Mathias), tailles triées par hauteur.
  const groups = useMemo(() => {
    const byW = new Map<number, { rel: string; name: string; w: number; h: number }[]>()
    for (const [rel, v] of Object.entries(selected)) {
      const arr = byW.get(v.w) ?? []
      arr.push({ rel, ...v })
      byW.set(v.w, arr)
    }
    return [...byW.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([w, items]) => ({ w, items: items.sort((a, b) => a.h - b.h) }))
  }, [selected])

  const nbDone = Object.values(results).filter((r) => r.statut === 'done').length

  // « Rendus récents » (relus du disque) — groupés une largeur = une ligne.
  const recentGroups = useMemo(() => {
    const byW = new Map<number, RenduRecent[]>()
    for (const r of history) {
      const w = r.w ?? 0
      const arr = byW.get(w) ?? []
      arr.push(r)
      byW.set(w, arr)
    }
    return [...byW.entries()].sort((a, b) => a[0] - b[0]).map(([w, items]) => ({ w, items }))
  }, [history])

  async function generer() {
    const items = Object.keys(selected)
    if (!items.length || running) return
    if (!window.confirm(`Lancer ${items.length} génération(s) Nano en ${imageSize} ? Chaque image = 1 appel facturé.`)) {
      return
    }
    setResults(Object.fromEntries(items.map((rel) => [rel, { statut: 'pending' as Statut }])))
    setRunning(true)
    for (let i = 0; i < items.length; i++) {
      const rel = items[i]
      setProgress(`${i + 1}/${items.length} — ${sansExt(selected[rel].name)}`)
      try {
        const res = await fetch('/api/decor-autour', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: rel, description, aspectRatio, imageSize }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Erreur de génération')
        setResults((prev) => ({ ...prev, [rel]: { statut: 'done', resultPath: data.resultPath } }))
      } catch (e) {
        setResults((prev) => ({ ...prev, [rel]: { statut: 'error', error: e instanceof Error ? e.message : String(e) } }))
      }
      fetchHistory() // le rendu tout juste produit apparaît dans « Rendus récents »
    }
    setRunning(false)
    setProgress('')
  }

  function openLb(it: { rel: string; name: string; w: number; h: number }, r: ResultState | undefined) {
    setLightbox({
      avant: planUrl(it.rel),
      apres: r?.statut === 'done' && r.resultPath ? art(r.resultPath) : null,
      title: `${sansExt(it.name)} · ${it.w}×${it.h}`,
    })
  }

  return (
    <div className="da">
      <style>{CSS}</style>

      <header className="da-top">
        <Link className="back-app" href="/">← PortaGEN</Link>
        <div className="da-title">
          🏡 <b>Décor autour</b> <span className="sep">·</span>{' '}
          <span className="mut">mini-app battants (à côté de PortaGEN)</span>
        </div>
        <span className="badge">banc autonome</span>
      </header>

      <div className="da-app">
        {/* ————— panneau gauche : sélection + réglages ————— */}
        <aside className="panel">
          <div className="block">
            <div className="plab">Images produit — choisis dans un dossier</div>
            <div className="explorer">
              <div className="crumbs">
                {listing?.crumbs.map((c, i) => (
                  <span key={c.rel}>
                    {i > 0 && ' ▸ '}
                    {i === (listing?.crumbs.length ?? 0) - 1 ? (
                      <b>{c.name}</b>
                    ) : (
                      <span className="c" onClick={() => setDir(c.rel)}>
                        {c.name}
                      </span>
                    )}
                  </span>
                ))}
              </div>
              <div className="explist">
                {loadingList ? (
                  <div className="estate">Chargement…</div>
                ) : listErr ? (
                  <div className="estate err">{listErr}</div>
                ) : (
                  <>
                    {listing?.parent !== null && (
                      <div className="erow folder" onClick={() => setDir(listing?.parent ?? undefined)}>
                        <span className="ic">📁</span> <span className="nm">.. (dossier parent)</span>
                      </div>
                    )}
                    {listing?.folders.map((f) => (
                      <div key={f.rel} className="erow folder" onClick={() => setDir(f.rel)}>
                        <span className="ic">📁</span> <span className="nm">{f.name}</span>
                      </div>
                    ))}
                    {listing?.images.map((img) => {
                      const known = img.w !== null && img.h !== null
                      const on = !!selected[img.rel]
                      return (
                        <div
                          key={img.rel}
                          className={`erow img ${on ? 'on' : ''} ${known ? '' : 'off'}`}
                          onClick={() => toggleSelect(img)}
                        >
                          <input type="checkbox" checked={on} disabled={!known} readOnly />
                          <span className={`nm ${known ? '' : 'mut'}`}>{img.name}</span>
                          {known ? (
                            <span className="chip">
                              {img.w}×{img.h}
                            </span>
                          ) : (
                            <span className="chip no">taille ?</span>
                          )}
                        </div>
                      )
                    })}
                    {!listing?.folders.length && !listing?.images.length && (
                      <div className="estate">Dossier vide.</div>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="selrow">
              <span className="cnt">
                {nbSel} image{nbSel > 1 ? 's' : ''} sélectionnée{nbSel > 1 ? 's' : ''}
              </span>
              {nbSel > 0 && (
                <span className="lnk" onClick={() => setSelected({})}>
                  tout désélectionner
                </span>
              )}
            </div>
            <div className="hint">La taille est lue dans le nom (« 300B140 » → 300×140). Sans taille : case non cochable.</div>
          </div>

          <div className="block">
            <div className="plab">Décor peint autour (éditable)</div>
            <textarea className="sel ta" value={description} onChange={(e) => setDescription(e.target.value)} />
            <div className="hint">Description envoyée à Nano — ajuste l’ambiance et relance.</div>
          </div>

          <div className="block">
            <div className="plab">Vue (levier clé — figé)</div>
            <div className="lock">
              <span className="ic">🔒</span>{' '}
              <span>
                <b>Élévation à plat, de face</b> — anti-perspective
              </span>
            </div>
          </div>

          <div className="block">
            <div className="plab">Format &amp; qualité</div>
            <div className="grid2">
              <select className="sel" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as '3:2' | '4:3')}>
                <option value="3:2">3:2</option>
                <option value="4:3">4:3</option>
              </select>
              <select className="sel" value={imageSize} onChange={(e) => setImageSize(e.target.value as '1K' | '2K' | '4K')}>
                <option value="1K">1K</option>
                <option value="2K">2K</option>
                <option value="4K">4K</option>
              </select>
            </div>
          </div>

          <button className="genbtn" onClick={generer} disabled={running || !nbSel}>
            {running ? `⏳ Génération ${progress}…` : `🏡 Générer le décor autour (${nbSel})`}
          </button>
        </aside>

        {/* ————— plan de travail ————— */}
        <main className="main">
          <div className="mhead">
            <h2>Plan de travail</h2>
            <span className="n">{nbSel ? `${nbDone}/${nbSel} généré${nbDone > 1 ? 's' : ''}` : '—'}</span>
          </div>
          <div className="subhead">
            Une case par image sélectionnée. Le plan gris s’affiche tout de suite ; la MES générée se pose par-dessus (glisse la
            poignée pour l’avant/après).
          </div>

          <div className="feed">
            {nbSel > 0 &&
              groups.map((g) => (
                <div key={g.w}>
                  <div className="rowlab">
                    largeur {g.w} — {g.items.length} taille{g.items.length > 1 ? 's' : ''}
                  </div>
                  <div className="grid">
                    {g.items.map((it) => {
                      const r = results[it.rel]
                      return (
                        <div key={it.rel} className="wcard">
                          <div
                            className="wimg"
                            style={{ cursor: 'zoom-in' }}
                            onClick={r?.statut === 'done' ? undefined : () => openLb(it, r)}
                          >
                            {r?.statut === 'done' && r.resultPath ? (
                              <Comparateur
                                avant={planUrl(it.rel)}
                                apres={art(r.resultPath, 560)}
                                onZoom={() => openLb(it, r)}
                              />
                            ) : (
                              <>
                                <img className="plan" src={planUrl(it.rel)} alt="plan gris" />
                                {r?.statut === 'pending' && (
                                  <div className="ov">
                                    <span className="spin" /> Nano peint autour…
                                  </div>
                                )}
                                {r?.statut === 'error' && <div className="ov err">⚠ {r.error}</div>}
                              </>
                            )}
                            <span className="zoomhint" title="Agrandir">
                              ⤢
                            </span>
                          </div>
                          <div className="wfoot">
                            <b>{sansExt(it.name)}</b>
                            <span className="chip">
                              {it.w}×{it.h}
                            </span>
                            <span
                              className={`tag ${r?.statut === 'done' ? 'done' : r?.statut === 'pending' ? 'run' : r?.statut === 'error' ? 'errt' : 'wait'}`}
                            >
                              {r?.statut === 'done'
                                ? '✓ généré'
                                : r?.statut === 'pending'
                                  ? '⏳ génération…'
                                  : r?.statut === 'error'
                                    ? '✕ échec'
                                    : 'plan prêt'}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}

            {history.length > 0 && (
              <div className="recents">
                <div className="rlabel">
                  Rendus récents <span>(relus du disque — {history.length})</span>
                </div>
                {recentGroups.map((g) => (
                  <div key={g.w}>
                    <div className="rowlab">
                      largeur {g.w || '?'} — {g.items.length} rendu{g.items.length > 1 ? 's' : ''}
                    </div>
                    <div className="grid">
                      {g.items.map((r) => (
                        <div key={r.key} className="wcard">
                          <div className="wimg" style={{ cursor: 'zoom-in' }}>
                            <Comparateur
                              avant={art(r.planPath, 560)}
                              apres={art(r.resultPath, 560)}
                              onZoom={() =>
                                setLightbox({
                                  avant: art(r.planPath),
                                  apres: art(r.resultPath),
                                  title: `${r.title} · ${r.w}×${r.h}`,
                                })
                              }
                            />
                            <span className="zoomhint" title="Agrandir">
                              ⤢
                            </span>
                          </div>
                          <div className="wfoot">
                            <b>{r.title}</b>
                            <span className="chip">
                              {r.w}×{r.h}
                            </span>
                            <span className="tag done">✓ disque</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!nbSel && !history.length && (
              <div className="empty">
                <b>Aucune image sélectionnée.</b>
                Navigue dans un dossier à gauche et coche une ou plusieurs images produit.
              </div>
            )}
          </div>
        </main>
      </div>

      {lightbox && (
        <Lightbox
          avant={lightbox.avant}
          apres={lightbox.apres}
          title={lightbox.title}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}

/** Visionneuse plein écran : comparateur en grand (ou plan gris seul) + liens fichiers. */
function Lightbox({
  avant,
  apres,
  title,
  onClose,
}: {
  avant: string
  apres: string | null
  title: string
  onClose: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="lb" onClick={onClose}>
      <div className="lb-inner" onClick={(e) => e.stopPropagation()}>
        <div className="lb-head">
          <b>{title}</b>
          <div className="lb-actions">
            <a href={avant} target="_blank" rel="noreferrer">
              plan gris ↗
            </a>
            {apres && (
              <a href={apres} target="_blank" rel="noreferrer">
                rendu ↗
              </a>
            )}
            <button onClick={onClose} title="Fermer (Échap)">
              ✕
            </button>
          </div>
        </div>
        {apres ? (
          <div className="lb-cmp">
            <Comparateur avant={avant} apres={apres} />
          </div>
        ) : (
          <img className="lb-img" src={avant} alt={title} />
        )}
        {apres && <div className="lb-tip">Glisse pour comparer · Échap ou clic autour pour fermer</div>}
      </div>
    </div>
  )
}

/**
 * Comparateur avant/après à poignée (glisser). Avant et après en 3:2 alignés.
 * `onZoom` (cases de la grille) : un simple clic SANS glisser agrandit ; un
 * glissé déplace la poignée sans agrandir.
 */
function Comparateur({ avant, apres, onZoom }: { avant: string; apres: string; onZoom?: () => void }) {
  const [pos, setPos] = useState(52)
  const ref = useRef<HTMLDivElement>(null)
  const st = useRef({ down: false, moved: false, x: 0 })
  const move = useCallback((clientX: number) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos(Math.max(3, Math.min(97, ((clientX - r.left) / r.width) * 100)))
  }, [])
  return (
    <div
      className="cmp"
      ref={ref}
      style={onZoom ? { cursor: 'zoom-in' } : undefined}
      onMouseDown={(e) => {
        st.current = { down: true, moved: false, x: e.clientX }
      }}
      onMouseMove={(e) => {
        if (!st.current.down) return
        if (Math.abs(e.clientX - st.current.x) > 4) st.current.moved = true
        if (st.current.moved) move(e.clientX)
      }}
      onMouseUp={() => {
        const wasClick = st.current.down && !st.current.moved
        st.current.down = false
        if (wasClick && onZoom) onZoom()
      }}
      onMouseLeave={() => {
        st.current.down = false
      }}
    >
      <img className="after" src={apres} alt="après" />
      <div className="before" style={{ width: `${pos}%` }}>
        <img src={avant} alt="avant" style={{ width: `${(10000 / pos).toFixed(2)}%` }} />
      </div>
      <div className="handle" style={{ left: `${pos}%` }}>
        <span className="grip">⟺</span>
      </div>
      <span className="lab l">avant</span>
      <span className="lab r">après</span>
    </div>
  )
}

const CSS = `
.da { --brand-green:#5d9228; --brand-green-light:#e8f2dc; --brand-green-hover:#4e7d22;
  --brand-teal:#38a0ad; --brand-teal-light:#e2f2f4; --brand-red:#dc2626; --brand-red-light:#fdecec;
  --surface:#f1f3f5; --border:#e5e7eb; --text-primary:#1f2937; --text-secondary:#6b7280; --text-disabled:#9ca3af;
  --amber-bg:#fef3c7; --amber-text:#b45309; --radius-sm:8px; --radius:12px; --shadow-sm:0 1px 3px rgba(0,0,0,.06);
  height:100vh; display:flex; flex-direction:column; overflow:hidden; background:var(--surface);
  color:var(--text-primary); font:14.5px/1.5 "Titillium Web",-apple-system,BlinkMacSystemFont,sans-serif; }
.da * { box-sizing:border-box; }

.da-top { flex:0 0 auto; background:#fff; border-bottom:1px solid var(--border); box-shadow:var(--shadow-sm);
  display:flex; align-items:center; gap:16px; padding:10px 20px; }
.da-top .back-app { color:var(--text-secondary); text-decoration:none; font-weight:700; font-size:13px; }
.da-top .back-app:hover { color:var(--brand-green); }
.da-title { font-size:15px; } .da-title .sep { color:var(--text-disabled); margin:0 4px; }
.da-title .mut { color:var(--text-secondary); font-size:13px; }
.da-top .badge { margin-left:auto; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
  padding:3px 10px; border-radius:999px; background:var(--brand-teal-light); color:var(--brand-teal); }

.da-app { flex:1; display:flex; min-height:0; }

.panel { flex:0 0 360px; background:#fff; border-right:1px solid var(--border); overflow-y:auto;
  padding:16px 18px 20px; display:flex; flex-direction:column; gap:15px; }
.plab { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.1em; color:var(--text-secondary); margin-bottom:7px; }
.sel { width:100%; border:1px solid var(--border); background:#fff; border-radius:var(--radius-sm); padding:8px 10px; font:inherit; font-size:13px; color:var(--text-primary); }
.ta { resize:vertical; min-height:82px; line-height:1.45; }
.hint { font-size:11.5px; color:var(--text-disabled); margin-top:5px; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }

.explorer { border:1px solid var(--border); border-radius:var(--radius-sm); overflow:hidden; }
.crumbs { padding:8px 10px; font-size:12px; background:var(--surface); border-bottom:1px solid var(--border); color:var(--text-secondary); font-family:ui-monospace,Consolas,monospace; word-break:break-word; }
.crumbs b { color:var(--text-primary); }
.crumbs .c { cursor:pointer; } .crumbs .c:hover { color:var(--brand-green); text-decoration:underline; }
.explist { max-height:300px; overflow-y:auto; }
.estate { padding:16px 12px; font-size:12.5px; color:var(--text-disabled); text-align:center; }
.estate.err { color:var(--brand-red); }
.erow { display:flex; align-items:center; gap:9px; padding:7px 10px; border-bottom:1px solid var(--border); font-size:13px; cursor:pointer; }
.erow:last-child { border-bottom:0; }
.erow:hover { background:var(--brand-green-light); }
.erow.folder .ic { color:var(--brand-teal); }
.erow.img.on { background:var(--brand-green-light); }
.erow.img.off { cursor:not-allowed; }
.erow input { width:15px; height:15px; accent-color:var(--brand-green); }
.erow .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.erow .nm.mut { color:var(--text-disabled); }
.erow .chip { flex:0 0 auto; font-size:10.5px; font-weight:700; font-family:ui-monospace,Consolas,monospace; background:#fff; border:1px solid var(--border); border-radius:999px; padding:1px 7px; color:var(--text-secondary); }
.erow .chip.no { color:var(--brand-red); border-color:var(--brand-red-light); background:var(--brand-red-light); }
.selrow { display:flex; align-items:baseline; justify-content:space-between; margin-top:8px; }
.selrow .cnt { font-size:12px; font-weight:700; color:var(--brand-green); }
.selrow .lnk { font-size:11.5px; color:var(--brand-teal); cursor:pointer; }
.selrow .lnk:hover { text-decoration:underline; }

.lock { display:inline-flex; align-items:center; gap:6px; background:var(--surface); border:1px solid var(--border);
  border-radius:var(--radius-sm); padding:7px 10px; font-size:12px; color:var(--text-secondary); width:100%; }
.lock b { color:var(--text-primary); } .lock .ic { color:var(--brand-green); }

.genbtn { width:100%; background:var(--brand-green); color:#fff; font:inherit; font-size:14.5px; font-weight:700; border:0;
  border-radius:10px; padding:12px; cursor:pointer; }
.genbtn:hover { background:var(--brand-green-hover); }
.genbtn:disabled { opacity:.6; cursor:default; }

.main { flex:1; min-width:0; display:flex; flex-direction:column; }
.mhead { flex:0 0 auto; display:flex; align-items:baseline; gap:10px; padding:15px 24px 2px; }
.mhead h2 { margin:0; font-size:19px; font-weight:700; }
.mhead .n { font-size:13px; color:var(--text-disabled); font-weight:600; font-family:ui-monospace,Consolas,monospace; }
.subhead { padding:2px 24px 12px; font-size:12.5px; color:var(--text-secondary); }

.feed { flex:1; overflow-y:auto; padding:4px 24px 30px; }
.rowlab { font-size:12px; font-weight:700; color:var(--text-disabled); margin:8px 2px 8px; font-family:ui-monospace,Consolas,monospace; }
.grid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:6px; }
@media (max-width:1200px){ .grid { grid-template-columns:repeat(2,1fr); } }

.wcard { background:#fff; border:1px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow-sm); overflow:hidden; }
.wimg { position:relative; aspect-ratio:3/2; background:#c9c9c9; overflow:hidden; }
.wimg .plan { display:block; width:100%; height:100%; object-fit:cover; }
.wimg .ov { position:absolute; inset:auto 0 0 0; background:rgba(31,41,55,.72); color:#fff; font-size:12px; font-weight:600;
  padding:8px 10px; display:flex; align-items:center; gap:8px; }
.wimg .ov.err { background:rgba(220,38,38,.85); }
.wfoot { display:flex; align-items:center; gap:8px; padding:9px 12px 11px; }
.wfoot b { font-size:13px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wfoot .chip { flex:0 0 auto; font-size:10.5px; font-weight:700; font-family:ui-monospace,Consolas,monospace; background:var(--surface); border:1px solid var(--border); border-radius:999px; padding:1px 7px; color:var(--text-secondary); }
.wfoot .tag { margin-left:auto; flex:0 0 auto; font-size:10.5px; font-weight:700; border-radius:999px; padding:2px 9px; }
.tag.wait { background:var(--surface); color:var(--text-secondary); }
.tag.run { background:var(--amber-bg); color:var(--amber-text); }
.tag.done { background:var(--brand-green-light); color:var(--brand-green); }
.tag.errt { background:var(--brand-red-light); color:var(--brand-red); }

.spin { width:14px; height:14px; border:2px solid rgba(255,255,255,.4); border-top-color:#fff; border-radius:50%; display:inline-block; animation:da-spin .8s linear infinite; }
@keyframes da-spin { to { transform:rotate(360deg); } }

.empty { border:1.5px dashed var(--border); border-radius:var(--radius); padding:44px 24px; text-align:center; color:var(--text-disabled); font-size:13px; }
.empty b { color:var(--text-secondary); display:block; margin-bottom:4px; }

.recents { margin-top:20px; border-top:1px solid var(--border); padding-top:14px; }
.recents:first-child { margin-top:0; border-top:0; padding-top:0; }
.rlabel { font-size:14px; font-weight:700; margin:0 2px 6px; }
.rlabel span { color:var(--text-disabled); font-weight:600; font-size:12px; }

/* comparateur avant/après à poignée */
.cmp { position:absolute; inset:0; cursor:ew-resize; user-select:none; }
.cmp .after { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; }
.cmp .before { position:absolute; top:0; left:0; height:100%; overflow:hidden; border-right:2px solid #fff; }
.cmp .before img { position:absolute; top:0; left:0; height:100%; max-width:none; object-fit:cover; display:block; }
.cmp .handle { position:absolute; top:0; bottom:0; width:2px; background:#fff; box-shadow:0 0 0 1px rgba(0,0,0,.15); transform:translateX(-1px); }
.cmp .handle .grip { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:26px; height:26px; border-radius:50%; background:#fff; box-shadow:var(--shadow-sm); display:flex; align-items:center; justify-content:center; font-size:12px; color:var(--text-secondary); }
.cmp .lab { position:absolute; bottom:7px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#fff; background:rgba(0,0,0,.4); padding:1px 7px; border-radius:999px; pointer-events:none; }
.cmp .lab.l { left:7px; } .cmp .lab.r { right:7px; }

.wimg .zoomhint { position:absolute; top:7px; right:7px; width:24px; height:24px; border-radius:6px; background:rgba(31,41,55,.55); color:#fff; display:flex; align-items:center; justify-content:center; font-size:13px; pointer-events:none; opacity:0; transition:opacity .15s; z-index:6; }
.wcard:hover .zoomhint { opacity:1; }

/* visionneuse plein écran */
.lb { position:fixed; inset:0; z-index:80; background:rgba(15,18,22,.86); display:flex; align-items:center; justify-content:center; padding:24px; }
.lb-inner { display:flex; flex-direction:column; gap:10px; max-width:96vw; }
.lb-head { display:flex; align-items:center; gap:14px; color:#fff; }
.lb-head b { font-size:15px; font-weight:700; word-break:break-word; }
.lb-actions { margin-left:auto; display:flex; align-items:center; gap:12px; }
.lb-actions a { color:#cfe0ec; font-size:12.5px; font-weight:700; text-decoration:none; white-space:nowrap; }
.lb-actions a:hover { text-decoration:underline; }
.lb-actions button { background:rgba(255,255,255,.14); color:#fff; border:0; width:30px; height:30px; border-radius:8px; font-size:15px; cursor:pointer; }
.lb-actions button:hover { background:rgba(255,255,255,.26); }
.lb-cmp { position:relative; width:min(94vw, calc(86vh * 1.5)); aspect-ratio:3/2; border-radius:10px; overflow:hidden; box-shadow:0 12px 40px rgba(0,0,0,.5); }
.lb-img { display:block; max-width:94vw; max-height:86vh; object-fit:contain; border-radius:10px; box-shadow:0 12px 40px rgba(0,0,0,.5); }
.lb-tip { color:rgba(255,255,255,.7); font-size:11.5px; text-align:center; }
`
