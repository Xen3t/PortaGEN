'use client'

import { useEffect, useMemo, useState } from 'react'
import GabaritPreview from '@/components/GabaritPreview'
import {
  DEFAULT_PARAMS,
  DEFAULT_PILIER_DROIT,
  effectiveHeights,
  type CapStyle,
  type GabaritParams,
  type PilierDroitParams,
} from '@/lib/geometry'
import { GABARIT_SET_DEFAULTS, type GabaritSetKey } from '@/lib/gabaritSets'

/**
 * Gestion des gabarits (piliers & murets) — extraction de l'ex-page
 * Admin → Gabarits (13/07/2026, chantier Moteurs) pour vivre DANS la page
 * Admin → Réglages par moteur : chaque moteur porte SES gabarits (règle
 * 13/07/2026 : jamais partagés) — la prop `moteur` sélectionne le jeu de
 * réglages et le référentiel de tailles lus/écrits (/api/size-params, /api/sizes).
 * Depuis le 22/07/2026 elle accepte aussi le jeu « coulissant-xl » (onglet
 * Gabarits XL de la fiche TERMINUS : coulissants 450-600, scène élargie).
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
    | 'sceneH'
  >
>
type OverrideKey = keyof Override
type Slider = { key: Exclude<OverrideKey, 'capStyle' | 'muretEnabled'>; label: string; unit: string; min: number; max: number }

// Mot du produit selon le jeu de gabarits — utilisé dans tous les libellés.
const PRODUIT: Record<GabaritSetKey, string> = {
  battant: 'portail',
  coulissant: 'portail',
  'coulissant-xl': 'portail',
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

// Jeu XL uniquement : reculer la scène l'agrandit (cm de hauteur, la largeur
// suit le ratio MES) pour que les lames de 4,5 à 6 m tiennent dans le cadre.
const XL_SLIDERS: Slider[] = [
  { key: 'sceneH', label: 'Recul de la scène', unit: 'cm', min: 320, max: 700 },
]

// Dérogation par taille : hauteurs imposées en direct pour CETTE taille.
const sizeSliders = (produit: string): Slider[] => [
  { key: 'pillarWidth', label: 'Largeur pilier', unit: 'cm', min: 10, max: 80 },
  { key: 'pillarH', label: 'Hauteur pilier', unit: 'cm', min: 60, max: 300 },
  { key: 'muretH', label: 'Hauteur muret', unit: 'cm', min: 20, max: 250 },
  { key: 'offsetX', label: `Décalage X ${produit}`, unit: 'cm', min: -100, max: 100 },
]

const CAP_LABELS: Record<CapStyle, string> = { none: 'aucun', flat: 'plat', gendarme: 'gendarme' }

// 2ᵉ gabarit du coulissant (04/08/2026) : placement du pilier droit qui cache
// la lame. 4 réglages seulement (décision Mathias : « on ne fait que le placer »).
type PilierDroitSlider = { key: keyof PilierDroitParams; label: string; unit: string; min: number; max: number }
// Le pilier droit ne se règle qu'en largeur et décalage : la hauteur suit le
// pilier gauche, et le recouvrement de la lame est une marge technique fixe.
const PILIER_DROIT_SLIDERS: PilierDroitSlider[] = [
  { key: 'largeur', label: 'Largeur du pilier droit', unit: 'cm', min: 10, max: 120 },
  { key: 'decalage', label: 'Décalage horizontal', unit: 'cm', min: -60, max: 60 },
]

export default function GabaritsManager({
  moteur = 'battant',
  embedded = false,
}: {
  /** Moteur ou jeu de gabarits (« coulissant-xl » = onglet Gabarits XL). */
  moteur?: GabaritSetKey
  /** true = intégré dans une section de la fiche moteur qui porte déjà le titre. */
  embedded?: boolean
}) {
  const [sizes, setSizes] = useState<SizeEntry[]>([])
  const [decors, setDecors] = useState<DecorEntry[]>([])
  const [decorPath, setDecorPath] = useState('')
  // Canny du jeu en surimpression sur les aperçus (demande Mathias 22/07/2026) :
  // repère blanc pour régler piliers et murets — le jeu XL affiche le Canny XL.
  const [cannyUrl, setCannyUrl] = useState<string | null>(null)
  const [globals, setGlobals] = useState<Override>({})
  const [globalsDirty, setGlobalsDirty] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [notice, setNotice] = useState<string | null>(null)

  // Coulissant : gabarit en 2 phases (04/08/2026). Phase 1 = base (sans pilier
  // droit, muret jusqu'au bord) ; phase 2 = placement du pilier droit.
  const isCoulissant = moteur === 'coulissant' || moteur === 'coulissant-xl'
  const [phase, setPhase] = useState<1 | 2>(1)
  const [pilierDroit, setPilierDroit] = useState<PilierDroitParams>(DEFAULT_PILIER_DROIT)
  // Défaut = le pilier de la phase 1 (dérivé du gabarit général), pour le repli
  // et le bouton « valeurs par défaut ».
  const [pilierDroitDefault, setPilierDroitDefault] = useState<PilierDroitParams>(DEFAULT_PILIER_DROIT)
  const [pilierDroitDirty, setPilierDroitDirty] = useState(false)
  // false = jamais réglé : le rendu (et l'aperçu) reprennent le pilier de
  // l'étape 1 (hauteur interpolée par taille). Dès qu'on ajuste/enregistre,
  // on passe au placement fixe de la Phase 2.
  const [pilierDroitConfigured, setPilierDroitConfigured] = useState(false)

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
    setPhase(1)
    setPilierDroitDirty(false)
    fetch(`/api/sizes?moteur=${moteur}`)
      .then((r) => r.json())
      .then((d) => setSizes(d.sizes ?? []))
    fetch(`/api/size-params?moteur=${moteur}`)
      .then((r) => r.json())
      .then((d) => {
        setOverrides(d.overrides ?? {})
        setGlobals(d.globals ?? {})
        setPilierDroit({ ...DEFAULT_PILIER_DROIT, ...(d.pilierDroit ?? {}) })
        setPilierDroitDefault({ ...DEFAULT_PILIER_DROIT, ...(d.pilierDroitDefault ?? {}) })
        setPilierDroitConfigured(Boolean(d.pilierDroitConfigured))
      })
    setCannyUrl(null)
    fetch(`/api/moteurs/${moteur}/canny`)
      .then((r) => r.json())
      .then((d) =>
        setCannyUrl(
          d.canny?.relPath
            ? `/api/artifacts?p=${encodeURIComponent(d.canny.relPath)}&v=${d.canny.version}`
            : null
        )
      )
      .catch(() => setCannyUrl(null))
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

  // Défauts effectifs du jeu : ceux du code + ceux du jeu (scène élargie en XL).
  const base = useMemo<GabaritParams>(
    () => ({ ...DEFAULT_PARAMS, ...(GABARIT_SET_DEFAULTS[moteur] ?? {}) }),
    [moteur]
  )

  // Largeur de référence des gabarits (04/08/2026) : la plus grande largeur du
  // jeu affiché. L'aperçu utilise donc le même gabarit pour toutes les largeurs
  // d'une hauteur — reflet exact de ce que fait le lancement (launchGamme).
  const refWidth = widths.length ? widths[widths.length - 1] : undefined

  /** Valeur effective d'un paramètre pour une taille (défaut < global < dérogation). */
  const effectiveFor = (label: string): GabaritParams => ({
    ...base,
    ...globals,
    ...(panelLabel === label ? draft : overrides[label] ?? {}),
    ...(refWidth ? { refWidth } : {}),
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

  function setPilierDroitField(key: keyof PilierDroitParams, value: number) {
    setPilierDroit((cur) => ({ ...cur, [key]: value }))
    setPilierDroitDirty(true)
  }

  async function savePilierDroit() {
    setBusy(true)
    setNotice(null)
    const res = await fetch('/api/size-params', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pilierDroit, moteur }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok) {
      setPilierDroitDirty(false)
      setPilierDroitConfigured(true)
      if (data?.pilierDroit) setPilierDroit(data.pilierDroit)
      setNotice('Pilier droit enregistré — appliqué aux prochaines gammes coulissantes.')
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

      {/* Onglets de phase (coulissant uniquement) : base puis pilier droit. */}
      {isCoulissant && (
        <div className="inline-flex gap-1 bg-white border border-border rounded-full p-1 mb-5 shadow-sm">
          {([1, 2] as const).map((n) => (
            <button
              key={n}
              onClick={() => setPhase(n)}
              className={`text-sm font-bold px-4 py-1.5 rounded-full transition-colors ${
                phase === n ? 'bg-brand-green text-white' : 'text-text-secondary hover:bg-surface'
              }`}
            >
              <span className="opacity-70 font-semibold">Phase {n} · </span>
              {n === 1 ? 'Base (piliers & murets)' : 'Pilier droit'}
            </button>
          ))}
        </div>
      )}

      {isCoulissant && phase === 1 && (
        <p className="text-xs text-text-secondary mb-4 max-w-[80ch]">
          À cette étape, <b>pas de pilier droit</b> : le muret file jusqu&apos;au bord et la lame est
          posée par-dessus. Le pilier droit qui cache la lame se règle en <b>Phase 2</b>.
        </p>
      )}

      {/* ===== PHASE 1 (ou moteurs non coulissants) : base piliers & murets ===== */}
      {(!isCoulissant || phase === 1) && (
      <>
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
          {[
            ...globalSliders(PRODUIT[moteur]),
            ...(moteur === 'coulissant-xl' ? XL_SLIDERS : []),
          ].map((p) => {
            const value = (globals[p.key] ?? base[p.key]) as number
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
              value={globals.capStyle ?? base.capStyle}
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
                checked={globals.muretEnabled ?? base.muretEnabled}
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
                      <GabaritPreview decorUrl={decorUrl} size={{ w: s.w, h: s.h }} params={effectiveFor(s.label)} cannyUrl={cannyUrl} rightPillar={!isCoulissant} />
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
      </>
      )}

      {/* ===== PHASE 2 : placement du pilier droit (coulissant) ===== */}
      {isCoulissant && phase === 2 && (
        <>
          <section className="mb-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
                Placement du pilier droit
              </h3>
              <p className="text-xs text-text-disabled max-w-[54ch]">
                Peint par-dessus le rendu pour passer devant la lame. Sa <b>hauteur suit toujours le pilier gauche</b>
                {' '}(les deux piliers sont identiques) — on ne règle que <b>largeur et décalage</b> : le décalage
                choisit ce que le pilier recouvre.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              {PILIER_DROIT_SLIDERS.map((p) => (
                <div key={p.key}>
                  <div className="flex items-baseline justify-between text-xs mb-1">
                    <label className="font-medium text-text-secondary">{p.label}</label>
                    <span className="font-mono text-text-disabled">
                      {pilierDroit[p.key]} {p.unit}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={p.min}
                    max={p.max}
                    value={pilierDroit[p.key]}
                    onChange={(e) => setPilierDroitField(p.key, Number(e.target.value))}
                    title={p.label}
                    className="w-full"
                    style={{ accentColor: '#5d9228' }}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={savePilierDroit}
                disabled={busy || !pilierDroitDirty}
                className="bg-brand-green text-white text-sm font-bold rounded-[10px] px-4 py-2 hover:bg-brand-green-hover transition-colors disabled:opacity-50"
              >
                Enregistrer le pilier droit
              </button>
              <button
                onClick={() => {
                  setPilierDroit(pilierDroitDefault)
                  setPilierDroitDirty(true)
                }}
                title="Reprend le pilier tel qu'il est fait à l'étape 1 (gabarit général)"
                className="text-xs text-brand-teal hover:opacity-70 font-semibold"
              >
                ↺ Pilier de l&apos;étape 1
              </button>
              {pilierDroitDirty && (
                <span className="text-xs text-brand-teal">Modifications non enregistrées — l&apos;aperçu est déjà à jour.</span>
              )}
            </div>
          </section>

          <div className="space-y-6">
            {widths.map((w) => (
              <section key={w}>
                <h3 className="text-sm font-semibold text-text-secondary mb-2">Largeur {w} cm</h3>
                <div className="flex gap-3">
                  {sizes
                    .filter((s) => s.w === w)
                    .map((s) => (
                      <div key={s.label} className="flex-1 min-w-0 bg-white rounded-[12px] shadow-sm p-2 border-2 border-transparent">
                        <GabaritPreview
                          decorUrl={decorUrl}
                          size={{ w: s.w, h: s.h }}
                          params={{ ...base, ...globals, ...(refWidth ? { refWidth } : {}) }}
                          cannyUrl={cannyUrl}
                          // Non réglé : on montre le pilier de l'étape 1 (général,
                          // interpolé) — reflet exact du rendu. Réglé/ajusté : le
                          // placement fixe de la Phase 2.
                          rightPillar={!(pilierDroitConfigured || pilierDroitDirty)}
                          pilierDroit={pilierDroitConfigured || pilierDroitDirty ? pilierDroit : null}
                        />
                        <div className="mt-1.5 px-0.5 text-sm font-medium">{s.w}×{s.h}</div>
                      </div>
                    ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

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
                  <GabaritPreview decorUrl={decorUrl} size={{ w: panelSize.w, h: panelSize.h }} params={effectiveFor(panelLabel)} cannyUrl={cannyUrl} rightPillar={!isCoulissant} />
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
                        : ((globals[p.key] ?? base[p.key]) as number)
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
                    value={draft.capStyle ?? globals.capStyle ?? base.capStyle}
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
                    checked={draft.muretEnabled ?? globals.muretEnabled ?? base.muretEnabled}
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
