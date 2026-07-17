'use client'

import { useEffect, useMemo, useState } from 'react'
import GabaritPreview from '@/components/GabaritPreview'
import { DEFAULT_PARAMS, effectiveHeights, type CapStyle, type GabaritParams } from '@/lib/geometry'
import type { MoteurKey } from '@/lib/moteurs'

/**
 * Gestion des gabarits (piliers & murets) — extraction de l'ex-page
 * Admin → Gabarits (13/07/2026, chantier Moteurs) pour vivre DANS la page
 * Admin → Réglages par moteur : chaque moteur porte SES gabarits (règle
 * 13/07/2026 : jamais partagés) — la prop `moteur` sélectionne le jeu de
 * réglages et le référentiel de tailles lus/écrits (/api/size-params, /api/sizes).
 *  - PARAMÈTRES GLOBAUX (curseurs) : pilotent TOUTES les tailles d'un coup ;
 *  - grille de VIGNETTES compactes, une rangée par largeur, aperçu seul ;
 *  - clic sur une vignette → PANNEAU DE DÉTAIL pour déroger cette taille
 *    paramètre par paramètre (le spécifique gagne sur le global).
 */

interface SizeEntry {
  w: number
  h: number
  label: string
}
interface DecorEntry {
  file_path: string
  name: string
  status: string
}
type Override = Partial<
  Pick<
    GabaritParams,
    | 'pillarWidth'
    | 'pillarHMin'
    | 'pillarHMax'
    | 'muretHMin'
    | 'muretHMax'
    | 'pillarH'
    | 'muretH'
    | 'muretEnabled'
    | 'capStyle'
    | 'offsetX'
  >
>
type OverrideKey = keyof Override
type Slider = { key: Exclude<OverrideKey, 'capStyle' | 'muretEnabled'>; label: string; unit: string; min: number; max: number }

// Mot du produit selon le moteur — utilisé dans tous les libellés.
const PRODUIT: Record<MoteurKey, string> = {
  battant: 'portail',
  coulissant: 'portail',
  portillon: 'portillon',
}

// Globaux : pilier et muret se règlent chacun aux deux extrémités de la gamme
// (produit de 100 et de 200 cm de haut) — hauteurs intermédiaires interpolées.
const globalSliders = (produit: string): Slider[] => [
  { key: 'pillarWidth', label: 'Largeur pilier', unit: 'cm', min: 10, max: 80 },
  { key: 'pillarHMin', label: `Pilier · ${produit} 100`, unit: 'cm', min: 60, max: 300 },
  { key: 'pillarHMax', label: `Pilier · ${produit} 200`, unit: 'cm', min: 60, max: 300 },
  { key: 'muretHMin', label: `Muret · ${produit} 100`, unit: 'cm', min: 20, max: 250 },
  { key: 'muretHMax', label: `Muret · ${produit} 200`, unit: 'cm', min: 20, max: 250 },
  { key: 'offsetX', label: `Décalage X ${produit}`, unit: 'cm', min: -100, max: 100 },
]

// Dérogation par taille : hauteurs imposées en direct pour CETTE taille.
const sizeSliders = (produit: string): Slider[] => [
  { key: 'pillarWidth', label: 'Largeur pilier', unit: 'cm', min: 10, max: 80 },
  { key: 'pillarH', label: 'Hauteur pilier', unit: 'cm', min: 60, max: 300 },
  { key: 'muretH', label: 'Hauteur muret', unit: 'cm', min: 20, max: 250 },
  { key: 'offsetX', label: `Décalage X ${produit}`, unit: 'cm', min: -100, max: 100 },
]

const CAP_LABELS: Record<CapStyle, string> = { none: 'aucun', flat: 'plat', gendarme: 'gendarme' }

export default function GabaritsManager({
  moteur = 'battant',
  embedded = false,
}: {
  moteur?: MoteurKey
  /** true = intégré dans une section de la fiche moteur qui porte déjà le titre. */
  embedded?: boolean
}) {
  const [sizes, setSizes] = useState<SizeEntry[]>([])
  const [decors, setDecors] = useState<DecorEntry[]>([])
  const [decorPath, setDecorPath] = useState('')
  const [globals, setGlobals] = useState<Override>({})
  const [globalsDirty, setGlobalsDirty] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [notice, setNotice] = useState<string | null>(null)

  // — panneau de dérogation —
  const [panelLabel, setPanelLabel] = useState<string | null>(null)
  const [draft, setDraft] = useState<Override>({})
  const [panelDirty, setPanelDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/decors')
      .then((r) => r.json())
      .then((d) => {
        const list: DecorEntry[] = (d.decors ?? []).filter((x: DecorEntry) => x.status === 'actif')
        setDecors(list)
        if (list.length) setDecorPath((cur) => cur || list[0].file_path)
      })
  }, [])

  // Tailles et réglages suivent le MOTEUR : rechargés à chaque changement d'onglet,
  // état d'édition abandonné (chaque moteur a son jeu, jamais partagé).
  useEffect(() => {
    setPanelLabel(null)
    setGlobalsDirty(false)
    setPanelDirty(false)
    fetch(`/api/sizes?moteur=${moteur}`)
      .then((r) => r.json())
      .then((d) => setSizes(d.sizes ?? []))
    fetch(`/api/size-params?moteur=${moteur}`)
      .then((r) => r.json())
      .then((d) => {
        setOverrides(d.overrides ?? {})
        setGlobals(d.globals ?? {})
      })
  }, [moteur])

  // Ordre de navigation dans la fenêtre de dérogation : celui des vignettes
  // (largeur croissante, puis hauteur) — flèches ← / → et boutons ‹ ›.
  const orderedSizes = useMemo(
    () => [...sizes].sort((a, b) => a.w - b.w || a.h - b.h),
    [sizes]
  )
  const panelIndex = panelLabel ? orderedSizes.findIndex((s) => s.label === panelLabel) : -1
  const prevSize = panelIndex > 0 ? orderedSizes[panelIndex - 1] : null
  const nextSize = panelIndex >= 0 && panelIndex < orderedSizes.length - 1 ? orderedSizes[panelIndex + 1] : null

  // Échap ferme le panneau ; ← / → passent à la taille voisine (comme un clic
  // sur sa vignette). Ignoré quand le focus est sur un curseur ou un menu :
  // là, les flèches servent déjà à changer la valeur.
  useEffect(() => {
    if (!panelLabel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanelLabel(null)
        return
      }
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft' && prevSize) openPanel(prevSize.label)
      if (e.key === 'ArrowRight' && nextSize) openPanel(nextSize.label)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelLabel, prevSize, nextSize, overrides])

  const decorUrl = useMemo(
    () => (decorPath ? `/api/artifacts?p=${encodeURIComponent(decorPath)}` : null),
    [decorPath]
  )
  const widths = useMemo(() => [...new Set(sizes.map((s) => s.w))].sort((a, b) => a - b), [sizes])

  /** Valeur effective d'un paramètre pour une taille (défaut < global < dérogation). */
  const effectiveFor = (label: string): GabaritParams => ({
    ...DEFAULT_PARAMS,
    ...globals,
    ...(panelLabel === label ? draft : overrides[label] ?? {}),
  })

  function openPanel(label: string) {
    setDraft({ ...(overrides[label] ?? {}) })
    setPanelDirty(false)
    setPanelLabel(label)
  }

  function setGlobal<K extends OverrideKey>(key: K, value: Override[K]) {
    setGlobals((cur) => ({ ...cur, [key]: value }))
    setGlobalsDirty(true)
  }

  function setDraftField<K extends OverrideKey>(key: K, value: Override[K]) {
    setDraft((cur) => ({ ...cur, [key]: value }))
    setPanelDirty(true)
  }

  function clearDraftField(key: OverrideKey) {
    setDraft((cur) => {
      const next = { ...cur }
      delete next[key]
      return next
    })
    setPanelDirty(true)
  }

  async function saveGlobals() {
    setBusy(true)
    setNotice(null)
    const res = await fetch('/api/size-params', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ globals, moteur }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok) {
      setGlobalsDirty(false)
      setNotice('Réglages globaux enregistrés — appliqués aux prochaines gammes (sauf tailles dérogées).')
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  async function savePanel() {
    if (!panelLabel) return
    setBusy(true)
    setNotice(null)
    const empty = Object.keys(draft).length === 0
    const res = await fetch('/api/size-params', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: panelLabel, params: empty ? null : draft, moteur }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok) {
      setOverrides((cur) => {
        const next = { ...cur }
        if (empty) delete next[panelLabel]
        else next[panelLabel] = { ...draft }
        return next
      })
      setPanelDirty(false)
      setNotice(
        empty
          ? `${panelLabel} suit de nouveau les réglages globaux.`
          : `Dérogation ${panelLabel} enregistrée — appliquée aux prochaines gammes.`
      )
    } else {
      setNotice(`Erreur (${panelLabel}) : ${data?.error ?? res.status}`)
    }
  }

  const panelSize = sizes.find((s) => s.label === panelLabel) ?? null

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        {/* Même style de titre que les sections de la fiche moteur (13/07/2026) ;
            masqué quand la section repliable de la fiche moteur porte déjà le titre. */}
        {!embedded && (
          <h2 className="text-[17px] font-bold">Gabarits — piliers &amp; murets</h2>
        )}
        <div className="min-w-72 ml-auto">
          <label htmlFor="decor-select" className="block text-xs font-medium text-text-secondary mb-1">
            Décor d&apos;aperçu
          </label>
          <select
            id="decor-select"
            value={decorPath}
            onChange={(e) => setDecorPath(e.target.value)}
            className="w-full border border-border bg-white rounded-[8px] px-2 py-2 text-sm focus:outline-none focus:border-brand-green transition-colors"
          >
            {decors.map((d) => (
              <option key={d.file_path} value={d.file_path}>
                {d.name}
              </option>
            ))}
            {decors.length === 0 && <option value="">— aucun décor actif —</option>}
          </select>
        </div>
      </div>

      {notice && (
        <div className="bg-brand-teal-light text-brand-teal text-sm rounded-[8px] px-3 py-2 mb-4 flex justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-brand-teal hover:opacity-70">✕</button>
        </div>
      )}

      {/* PARAMÈTRES GLOBAUX */}
      <section className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
            Paramètres globaux
          </h3>
          <p className="text-xs text-text-disabled">
            Hauteurs pilier/muret réglées pour la plus petite (100) et la plus grande (200) taille —
            les tailles intermédiaires s&apos;adaptent proportionnellement · les tailles dérogées restent verrouillées
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-6 gap-y-4">
          {globalSliders(PRODUIT[moteur]).map((p) => {
            const value = (globals[p.key] ?? DEFAULT_PARAMS[p.key]) as number
            return (
              <div key={p.key}>
                <div className="flex items-baseline justify-between text-xs mb-1">
                  <label className="font-medium text-text-secondary">{p.label}</label>
                  <span className="font-mono text-text-disabled">
                    {value} {p.unit}
                  </span>
                </div>
                <input
                  type="range"
                  min={p.min}
                  max={p.max}
                  value={value}
                  onChange={(e) => setGlobal(p.key, Number(e.target.value))}
                  title={p.label}
                  className="w-full"
                  style={{ accentColor: '#5d9228' }}
                />
              </div>
            )
          })}
          <div>
            <div className="flex items-baseline justify-between text-xs mb-1">
              <label className="font-medium text-text-secondary">Chapeau pilier</label>
            </div>
            <select
              value={globals.capStyle ?? DEFAULT_PARAMS.capStyle}
              onChange={(e) => setGlobal('capStyle', e.target.value as CapStyle)}
              title="Chapeau pilier"
              className="w-full text-xs border border-border bg-white rounded-[8px] px-2 py-1.5 focus:outline-none focus:border-brand-green transition-colors"
            >
              {(Object.keys(CAP_LABELS) as CapStyle[]).map((c) => (
                <option key={c} value={c}>{CAP_LABELS[c]}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-xs font-medium text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={globals.muretEnabled ?? DEFAULT_PARAMS.muretEnabled}
                onChange={(e) => setGlobal('muretEnabled', e.target.checked)}
              />
              Murets latéraux
            </label>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={saveGlobals}
            disabled={busy || !globalsDirty}
            className="bg-brand-green text-white text-sm font-bold rounded-[10px] px-4 py-2 hover:bg-brand-green-hover transition-colors disabled:opacity-50"
          >
            Enregistrer les réglages globaux
          </button>
          {globalsDirty && (
            <span className="text-xs text-brand-teal">Modifications non enregistrées — l&apos;aperçu est déjà à jour.</span>
          )}
        </div>
      </section>

      {/* VIGNETTES — une rangée par largeur */}
      <div className="space-y-6">
        {widths.map((w) => (
          <section key={w}>
            <h3 className="text-sm font-semibold text-text-secondary mb-2">
              Largeur {w} cm
              <span className="font-normal text-text-disabled"> · cliquez une vignette pour déroger</span>
            </h3>
            <div className="flex gap-3">
              {sizes
                .filter((s) => s.w === w)
                .map((s) => {
                  const hasOverride =
                    panelLabel === s.label
                      ? Object.keys(draft).length > 0
                      : Object.keys(overrides[s.label] ?? {}).length > 0
                  const open = panelLabel === s.label
                  return (
                    <button
                      key={s.label}
                      onClick={() => openPanel(s.label)}
                      className={`flex-1 min-w-0 bg-white rounded-[12px] shadow-sm p-2 text-left border-2 transition-all duration-150 ${
                        open ? 'border-brand-green' : 'border-transparent hover:shadow-default hover:translate-y-[-1px]'
                      }`}
                    >
                      <GabaritPreview decorUrl={decorUrl} size={{ w: s.w, h: s.h }} params={effectiveFor(s.label)} />
                      <div className="flex items-center justify-between gap-1 mt-1.5 px-0.5">
                        <span className="text-sm font-medium">{s.w}×{s.h}</span>
                        {hasOverride && (
                          <span className="text-[10px] bg-brand-teal-light text-brand-teal px-1.5 py-0.5 rounded-full whitespace-nowrap">
                            dérogé
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
            </div>
          </section>
        ))}
      </div>

      {/* FENÊTRE DE DÉROGATION (centrée) : grand aperçu à gauche, réglages à droite */}
      {panelLabel && panelSize && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setPanelLabel(null)}
        >
          <div
            className="bg-white rounded-[16px] w-[min(1100px,95vw)] max-h-[92vh] flex flex-col overflow-hidden shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-border shrink-0">
              <div className="min-w-0">
                <h3 className="font-semibold">Taille {panelSize.w}×{panelSize.h} cm</h3>
                <p className="text-xs text-text-secondary truncate">
                  Chaque réglage modifié ici verrouille ce paramètre pour cette taille — le reste suit les réglages globaux.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Navigation entre tailles sans fermer la fenêtre — aussi au clavier (← / →). */}
                <button
                  onClick={() => prevSize && openPanel(prevSize.label)}
                  disabled={!prevSize}
                  title={prevSize ? `Taille précédente : ${prevSize.w}×${prevSize.h} (←)` : 'Première taille'}
                  className="border border-border rounded-[8px] px-2.5 py-1.5 text-sm text-text-secondary hover:bg-surface transition-colors disabled:opacity-40 disabled:hover:bg-white"
                >
                  ‹ {prevSize ? `${prevSize.w}×${prevSize.h}` : '—'}
                </button>
                <button
                  onClick={() => nextSize && openPanel(nextSize.label)}
                  disabled={!nextSize}
                  title={nextSize ? `Taille suivante : ${nextSize.w}×${nextSize.h} (→)` : 'Dernière taille'}
                  className="border border-border rounded-[8px] px-2.5 py-1.5 text-sm text-text-secondary hover:bg-surface transition-colors disabled:opacity-40 disabled:hover:bg-white"
                >
                  {nextSize ? `${nextSize.w}×${nextSize.h}` : '—'} ›
                </button>
                <button
                  onClick={() => setPanelLabel(null)}
                  className="text-text-disabled hover:text-text-primary text-xl leading-none px-2"
                  title="Fermer (Échap)"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 flex min-h-0">
              {/* Grand aperçu */}
              <div className="flex-1 min-w-0 bg-surface p-5 flex items-center justify-center">
                <div className="w-full max-w-3xl">
                  <GabaritPreview decorUrl={decorUrl} size={{ w: panelSize.w, h: panelSize.h }} params={effectiveFor(panelLabel)} />
                </div>
              </div>

              {/* Réglages */}
              <div className="w-[340px] shrink-0 border-l border-border p-5 overflow-y-auto space-y-4">
                {sizeSliders(PRODUIT[moteur]).map((p) => {
                  const overridden = p.key in draft
                  // Hauteurs : la valeur « global » affichée est celle interpolée pour CETTE taille.
                  const interp = effectiveHeights(panelSize.h, globals)
                  const fallback =
                    p.key === 'pillarH'
                      ? interp.pillarH
                      : p.key === 'muretH'
                        ? interp.muretH
                        : ((globals[p.key] ?? DEFAULT_PARAMS[p.key]) as number)
                  const value = Math.round(draft[p.key] ?? fallback)
                  return (
                    <div key={p.key}>
                      <div className="flex items-baseline justify-between text-xs mb-1">
                        <label className="font-medium text-text-secondary flex items-center gap-1.5">
                          {p.label}
                          {overridden ? (
                            <span className="text-[10px] bg-brand-teal-light text-brand-teal px-1.5 py-0.5 rounded-full">dérogé</span>
                          ) : (
                            <span className="text-[10px] text-text-disabled">global</span>
                          )}
                        </label>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="font-mono text-text-disabled">{value} {p.unit}</span>
                          {overridden && (
                            <button
                              onClick={() => clearDraftField(p.key)}
                              title="Revenir au réglage global"
                              className="text-text-disabled hover:text-brand-teal"
                            >
                              ↺
                            </button>
                          )}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={p.min}
                        max={p.max}
                        value={value}
                        onChange={(e) => setDraftField(p.key, Number(e.target.value))}
                        title={p.label}
                        className="w-full"
                        style={{ accentColor: overridden ? '#38a0ad' : '#9ca3af' }}
                      />
                    </div>
                  )
                })}

                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                    Chapeau pilier
                    {'capStyle' in draft ? (
                      <span className="text-[10px] bg-brand-teal-light text-brand-teal px-1.5 py-0.5 rounded-full">dérogé</span>
                    ) : (
                      <span className="text-[10px] text-text-disabled">global</span>
                    )}
                    {'capStyle' in draft && (
                      <button onClick={() => clearDraftField('capStyle')} title="Revenir au réglage global" className="text-text-disabled hover:text-brand-teal">↺</button>
                    )}
                  </label>
                  <select
                    value={draft.capStyle ?? globals.capStyle ?? DEFAULT_PARAMS.capStyle}
                    onChange={(e) => setDraftField('capStyle', e.target.value as CapStyle)}
                    title="Chapeau pilier"
                    className="text-xs border border-border bg-white rounded-[8px] px-2 py-1.5 focus:outline-none focus:border-brand-green transition-colors"
                  >
                    {(Object.keys(CAP_LABELS) as CapStyle[]).map((c) => (
                      <option key={c} value={c}>{CAP_LABELS[c]}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                    Murets latéraux
                    {'muretEnabled' in draft ? (
                      <span className="text-[10px] bg-brand-teal-light text-brand-teal px-1.5 py-0.5 rounded-full">dérogé</span>
                    ) : (
                      <span className="text-[10px] text-text-disabled">global</span>
                    )}
                    {'muretEnabled' in draft && (
                      <button onClick={() => clearDraftField('muretEnabled')} title="Revenir au réglage global" className="text-text-disabled hover:text-brand-teal">↺</button>
                    )}
                  </label>
                  <input
                    type="checkbox"
                    checked={draft.muretEnabled ?? globals.muretEnabled ?? DEFAULT_PARAMS.muretEnabled}
                    onChange={(e) => setDraftField('muretEnabled', e.target.checked)}
                    title="Murets latéraux"
                  />
                </div>

                <div className="border-t border-border pt-4 space-y-2">
                <button
                  onClick={savePanel}
                  disabled={busy || !panelDirty}
                  className="w-full bg-brand-green text-white text-sm font-bold rounded-[10px] py-2 hover:bg-brand-green-hover transition-colors disabled:opacity-50"
                >
                  Enregistrer
                </button>
                <button
                  onClick={() => {
                    setDraft({})
                    setPanelDirty(true)
                  }}
                  disabled={busy || Object.keys(draft).length === 0}
                  className="w-full bg-white border border-border text-text-secondary text-sm rounded-[10px] py-2 hover:bg-surface transition-colors disabled:opacity-50"
                >
                  ↺ Tout remettre au global
                </button>
                <p className="text-[11px] text-text-disabled">
                  Appliqué aux prochaines gammes. « Tout remettre au global » + Enregistrer supprime
                  la dérogation : la taille suit de nouveau les réglages globaux.
                </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
