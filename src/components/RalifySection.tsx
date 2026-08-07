'use client'

import { useEffect, useRef, useState } from 'react'
import {
  RAL_CIBLES,
  RALIFY_DEFAUTS,
  isHexColor,
  ralCibleLabel,
  ralCodeDepuisHex,
  ralHexDepuisCode,
  type RalifyException,
  type RalifyReglages,
} from '@/lib/ralify'
import type { MoteurKey } from '@/lib/moteurs'

/**
 * Encart « RALify — harmonisation des couleurs » de la fiche moteur (maquette
 * ralify-v2 validée le 28/07/2026). Règle générale par coloris détecté,
 * exceptions par nom de produit, intensité, et test avant/après sur un PNG
 * détouré du catalogue (API /api/ralify). L'interrupteur Activé/Désactivé est
 * dans l'en-tête de la section (page Réglages) ; l'enregistrement passe par le
 * bouton global « Enregistrer les réglages du moteur ».
 */

interface ColorisEntry {
  key: string
  label: string
  ral: string | null
  swatch: string
  /** true = coloris ajouté à la palette (supprimable), false = d'origine. */
  custom: boolean
}

interface ProduitTest {
  productId: number
  produit: string
  coloris: string
  size: { w: number; h: number }
}

interface TestResult {
  produit: string
  /** null = coloris non reconnu (image donnée à la main). */
  coloris: string | null
  cible: string | null
  /** La règle qui a tranché (exception, règle générale…). */
  raison: string
  intensite: number
  largeur: number | null
  hauteur: number | null
  avantHex?: string
  apresHex?: string
  pixelsTraites?: number
  /** Pixels laissés intacts (poignée, serrure… loin de la matière dominante). */
  pixelsProteges?: number
  avant: string
  apres: string | null
}

/**
 * Comparateur avant/après plein cadre : l'après est révélé à droite de la barre,
 * qu'on déplace à la souris (le curseur invisible couvre toute l'image).
 */
function Comparateur({ avant, apres }: { avant: string; apres: string }) {
  const [pos, setPos] = useState(50)
  return (
    <div className="relative w-full select-none rounded-[10px] border border-border bg-white overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={avant} alt="Avant traitement" draggable={false} className="block w-full" />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={apres} alt="Après traitement" draggable={false} className="block w-full" />
      </div>
      <span className="absolute top-3 left-3 bg-black/55 text-white text-[11px] font-bold uppercase tracking-wider rounded-full px-3 py-1 pointer-events-none">
        Avant
      </span>
      <span className="absolute top-3 right-3 bg-brand-green/90 text-white text-[11px] font-bold uppercase tracking-wider rounded-full px-3 py-1 pointer-events-none">
        Après
      </span>
      <div
        className="absolute top-0 bottom-0 w-[3px] bg-brand-green pointer-events-none"
        style={{ left: `calc(${pos}% - 1.5px)` }}
      >
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-brand-green text-white grid place-items-center text-sm font-bold shadow-md">
          ⇄
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Barre avant/après"
        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
      />
    </div>
  )
}

/** Bloc d'info du résultat de test (libellé + valeur). */
function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-[10.5px] font-bold uppercase tracking-wider text-text-disabled mb-0.5">
        {label}
      </span>
      <span className="flex items-center gap-1.5 text-sm font-semibold">{children}</span>
    </div>
  )
}

/** Pastille de couleur, avec son hex en monospace. */
function Pastille({ hex }: { hex: string }) {
  return (
    <>
      <span
        className="w-4 h-4 rounded-[5px] border border-black/20 flex-none"
        style={{ background: hex }}
      />
      <span className="font-mono text-[12.5px] text-text-secondary">{hex}</span>
    </>
  )
}

/** Cible par défaut d'un coloris : son RAL de référence (défauts d'usine pour
 *  gris/noir/blanc), sinon sa pastille — la cible EST le RAL du coloris, on ne
 *  la répète pas à l'écran (retour Mathias 07/08 soir). */
function cibleSuggestion(key: string, secours?: string): string {
  return RALIFY_DEFAUTS.regles[key]?.cible ?? secours ?? '#434a50'
}

/** Interrupteur on/off (retour Mathias 07/08 soir : plus de boutons segmentés
 *  sur les lignes) — vert = corrigé, gris = laissé tel quel. */
function Interrupteur({
  on,
  disabled,
  onChange,
  title,
}: {
  on: boolean
  disabled: boolean
  onChange: (on: boolean) => void
  title?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      title={title}
      className={`relative w-11 h-6 rounded-full transition-colors flex-none disabled:opacity-50 ${
        on ? 'bg-brand-green' : 'bg-[#cfd4da]'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-5' : ''
        }`}
      />
    </button>
  )
}

/** Champ RAL d'une ligne : on TAPE le code (« 7016 »), la couleur suit —
 *  c'est la seule manière d'exprimer la cible (retour Mathias 07/08 soir). */
function RalChamp({
  hex,
  disabled,
  onHex,
}: {
  hex: string | null
  disabled: boolean
  onHex: (hex: string) => void
}) {
  const [texte, setTexte] = useState(() => ralCodeDepuisHex(hex) ?? '')
  useEffect(() => {
    setTexte(ralCodeDepuisHex(hex) ?? '')
  }, [hex])
  const inconnu = texte.trim() !== '' && ralHexDepuisCode(texte) === null
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-xs font-medium text-text-secondary">RAL</span>
      <input
        type="text"
        inputMode="numeric"
        value={texte}
        disabled={disabled}
        maxLength={4}
        placeholder="7016"
        onChange={(e) => {
          const t = e.target.value
          setTexte(t)
          const h = ralHexDepuisCode(t)
          if (h) onHex(h)
        }}
        title="Code RAL cible — la pastille suit automatiquement"
        className="w-16 border border-border bg-white rounded-[8px] px-2 py-1.5 text-sm font-mono tabular-nums focus:outline-none focus:border-brand-green transition-colors disabled:opacity-45"
      />
      {inconnu && (
        <span title="Code RAL inconnu de la table — la cible précédente reste appliquée" className="text-amber-700 text-xs font-bold">
          ?
        </span>
      )}
    </span>
  )
}

function CibleSelect({
  cible,
  disabled,
  onChange,
}: {
  cible: string | null
  disabled: boolean
  onChange: (hex: string) => void
}) {
  // « Personnalisé » choisi explicitement (sinon déduit : hex hors palette RAL).
  const [customChoisi, setCustomChoisi] = useState(false)
  const known = cible !== null && RAL_CIBLES.some((c) => c.hex === cible)
  const custom = customChoisi || (cible !== null && !known)
  return (
    <span className={`flex items-center gap-2 ${disabled ? 'opacity-45 pointer-events-none' : ''}`}>
      <select
        value={custom ? 'custom' : (cible ?? '')}
        disabled={disabled}
        title="Couleur cible"
        onChange={(e) => {
          if (e.target.value === 'custom') {
            setCustomChoisi(true)
          } else {
            setCustomChoisi(false)
            onChange(e.target.value)
          }
        }}
        className="border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-brand-green transition-colors"
      >
        {cible === null && <option value="">—</option>}
        {RAL_CIBLES.map((c) => (
          <option key={c.hex} value={c.hex}>
            {c.ral} · {c.label}
          </option>
        ))}
        <option value="custom">Personnalisé (hex)…</option>
      </select>
      {custom && (
        <input
          type="color"
          value={isHexColor(cible) ? cible : '#434a50'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          title="Couleur cible personnalisée"
          className="w-10 h-8 border border-border rounded-[6px] bg-white cursor-pointer"
        />
      )}
      {!custom && cible && (
        <span
          className="w-4 h-4 rounded-[5px] border border-black/20 flex-none"
          style={{ background: cible }}
          title="Cible"
        />
      )}
    </span>
  )
}

export default function RalifySection({
  moteur,
  value,
  coloris,
  onChange,
  onPaletteChange,
  disabled,
}: {
  moteur: MoteurKey
  value: RalifyReglages | null
  coloris: ColorisEntry[]
  onChange: (next: RalifyReglages) => void
  /** La palette de coloris (globale, /api/coloris) a changé — ajout/suppression. */
  onPaletteChange: (next: ColorisEntry[]) => void
  disabled: boolean
}) {
  const v = value ?? RALIFY_DEFAUTS

  // Ajout d'un coloris À MÊME le tableau (simplification 07/08 soir : plus de
  // bloc « palette » séparé — un coloris = une ligne, point).
  const [ajout, setAjout] = useState<{ label: string; ral: string; swatch: string } | null>(null)
  const [paletteBusy, setPaletteBusy] = useState(false)
  const [paletteErr, setPaletteErr] = useState<string | null>(null)

  async function ajouterColoris() {
    if (!ajout || !ajout.label.trim()) return
    setPaletteBusy(true)
    setPaletteErr(null)
    const res = await fetch('/api/coloris', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: ajout.label.trim(),
        ral: ajout.ral.trim() || null,
        swatch: ajout.swatch,
      }),
    })
    const data = await res.json().catch(() => null)
    setPaletteBusy(false)
    if (res.ok && Array.isArray(data?.coloris)) {
      onPaletteChange(data.coloris)
      setAjout(null)
    } else {
      setPaletteErr(data?.error ?? `Erreur ${res.status}`)
    }
  }

  async function supprimerColoris(c: ColorisEntry) {
    if (!window.confirm(`Supprimer le coloris « ${c.label} » de la palette ?`)) return
    setPaletteBusy(true)
    setPaletteErr(null)
    const res = await fetch('/api/coloris', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: c.key }),
    })
    const data = await res.json().catch(() => null)
    setPaletteBusy(false)
    if (res.ok && Array.isArray(data?.coloris)) {
      onPaletteChange(data.coloris)
      // Sa règle part avec lui (sinon règle orpheline invisible).
      if (v.regles[c.key]) {
        const regles = { ...v.regles }
        delete regles[c.key]
        onChange({ ...v, regles })
      }
    } else {
      setPaletteErr(data?.error ?? `Erreur ${res.status}`)
    }
  }

  // Formulaire d'exception (ajout ou modification d'une ligne existante).
  const [form, setForm] = useState<{ index: number | null; ex: RalifyException } | null>(null)

  // Test avant/après sur un PNG produit du catalogue (référence = index de la liste).
  const [produits, setProduits] = useState<ProduitTest[] | null>(null)
  const [serveurOk, setServeurOk] = useState(true)
  const [produitIdx, setProduitIdx] = useState<number | ''>('')
  const [testBusy, setTestBusy] = useState(false)
  const [test, setTest] = useState<TestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setProduits(null)
    setServeurOk(true)
    setProduitIdx('')
    setTest(null)
    setTestError(null)
    fetch(`/api/ralify?moteur=${moteur}`)
      .then((r) => r.json())
      .then((d) => {
        setProduits(d.produits ?? [])
        setServeurOk(d.serveurOk !== false)
      })
      .catch(() => setProduits([]))
  }, [moteur])

  function setRegle(key: string, patch: Partial<{ traiter: boolean; cible: string | null }>) {
    const cur = v.regles[key] ?? { traiter: false, cible: null }
    onChange({ ...v, regles: { ...v.regles, [key]: { ...cur, ...patch } } })
  }

  async function lancerTest() {
    const p = produitIdx === '' ? undefined : produits?.[produitIdx]
    if (!p) return
    setTestBusy(true)
    setTest(null)
    setTestError(null)
    const res = await fetch('/api/ralify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: p.productId,
        coloris: p.coloris,
        size: p.size,
        ralify: v,
      }),
    })
    const data = await res.json().catch(() => null)
    setTestBusy(false)
    if (res.ok && data?.avant) setTest(data as TestResult)
    else setTestError(data?.error ?? `Erreur ${res.status}`)
  }

  /** Test sur une image donnée à la main (comme en génération directe) — sans serveur. */
  async function lancerTestImage(file: File) {
    setTestBusy(true)
    setTest(null)
    setTestError(null)
    const form = new FormData()
    form.append('file', file)
    form.append('ralify', JSON.stringify(v))
    const res = await fetch('/api/ralify', { method: 'POST', body: form })
    const data = await res.json().catch(() => null)
    setTestBusy(false)
    if (res.ok && data?.avant) setTest(data as TestResult)
    else setTestError(data?.error ?? `Erreur ${res.status}`)
  }

  const segBtn = (on: boolean, label: string, action: () => void, first: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={action}
      className={`px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
        first ? '' : 'border-l border-border'
      } ${on ? 'bg-brand-green text-white font-bold' : 'text-text-secondary hover:bg-surface'}`}
    >
      {label}
    </button>
  )

  return (
    <div>
      {/* ===== UN SEUL tableau : un coloris = une ligne (qui il est, ce qu'on
          en fait). Simplification 07/08 soir — la palette et les règles ne
          font plus qu'un, l'intensité vit dans l'en-tête, exceptions et
          testeur sont repliés dessous. ===== */}
      <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Coloris → couleur cible
        </h3>
        <span className="flex items-center gap-2.5 text-xs">
          <span className="font-medium text-text-secondary">Intensité</span>
          <input
            type="range"
            min={0}
            max={100}
            value={v.intensite}
            disabled={disabled}
            onChange={(e) => onChange({ ...v, intensite: Number(e.target.value) })}
            title="Force de la correction (100 % = teinte exactement au RAL)"
            className="w-36 accent-brand-green"
          />
          <span className="font-mono text-text-disabled tabular-nums w-10 text-right">
            {v.intensite} %
          </span>
        </span>
      </div>
      <div className="space-y-2">
        {coloris.map((c) => {
          const regle = v.regles[c.key] ?? { traiter: false, cible: null }
          const teck = c.key === 'teck'
          const defaut = cibleSuggestion(c.key, c.swatch)
          // La pastille montre CE QUI SORTIRA : la cible quand on corrige,
          // la teinte d'origine quand on ne touche pas.
          const pastille = regle.traiter ? (regle.cible ?? defaut) : c.swatch
          return (
            <div
              key={c.key}
              className="flex items-center gap-3.5 border border-border rounded-[8px] px-3.5 py-2.5 flex-wrap"
            >
              <span className="flex items-center gap-2 min-w-[110px] text-sm">
                <span
                  className="w-4 h-4 rounded-[5px] border border-black/20 flex-none"
                  style={{ background: pastille }}
                />
                <b>{c.label}</b>
                {teck && <small className="text-text-secondary text-[11.5px]">bois</small>}
              </span>
              {/* On TAPE le RAL, la pastille suit — et c'est tout (07/08 soir). */}
              <RalChamp
                hex={regle.cible ?? defaut}
                disabled={disabled || !regle.traiter}
                onHex={(hex) => setRegle(c.key, { traiter: true, cible: hex })}
              />
              {/* Interrupteur on/off (07/08 soir) : vert = corrigé vers le RAL,
                  sans libellé d'état (retiré à la demande de Mathias). */}
              <Interrupteur
                on={regle.traiter}
                disabled={disabled}
                onChange={(on) =>
                  setRegle(c.key, on ? { traiter: true, cible: regle.cible ?? defaut } : { traiter: false })
                }
                title={regle.traiter ? 'Corrigé vers le RAL — cliquer pour laisser tel quel' : 'Laissé tel quel — cliquer pour corriger vers le RAL'}
              />
              {c.custom && (
                <button
                  type="button"
                  disabled={disabled || paletteBusy}
                  onClick={() => void supprimerColoris(c)}
                  title="Supprimer ce coloris de la palette (sa ligne disparaît partout)"
                  className="ml-auto text-text-disabled hover:text-brand-red text-xs font-bold disabled:opacity-50"
                >
                  ✕
                </button>
              )}
            </div>
          )
        })}
        {/* Ajouter un coloris = ajouter une LIGNE — enregistré aussitôt dans la
            palette globale ; sa cible se règle ensuite sur la ligne. */}
        {ajout ? (
          <div className="flex flex-wrap items-end gap-3 border border-border rounded-[8px] px-3.5 py-2.5 bg-surface">
            <div>
              <span className="block text-xs font-medium text-text-secondary mb-1.5">Nom</span>
              <input
                type="text"
                value={ajout.label}
                onChange={(e) => setAjout({ ...ajout, label: e.target.value })}
                placeholder="ex. Beige"
                maxLength={40}
                className="w-36 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
              />
            </div>
            <div>
              <span className="block text-xs font-medium text-text-secondary mb-1.5">
                RAL (facultatif)
              </span>
              <input
                type="text"
                value={ajout.ral}
                onChange={(e) => {
                  const t = e.target.value
                  // Le RAL pilote la pastille (même logique que les lignes).
                  const hex = ralHexDepuisCode(t)
                  setAjout({ ...ajout, ral: t, ...(hex ? { swatch: hex } : {}) })
                }}
                placeholder="ex. 1015"
                maxLength={20}
                className="w-28 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
              />
            </div>
            <div>
              <span className="block text-xs font-medium text-text-secondary mb-1.5">Pastille</span>
              <input
                type="color"
                value={ajout.swatch}
                onChange={(e) => setAjout({ ...ajout, swatch: e.target.value })}
                title="Couleur de la pastille"
                className="w-10 h-8 border border-border rounded-[6px] bg-white cursor-pointer"
              />
            </div>
            <button
              type="button"
              disabled={paletteBusy || !ajout.label.trim()}
              onClick={() => void ajouterColoris()}
              className="bg-brand-green text-white text-xs font-bold rounded-[8px] px-4 py-2 hover:bg-brand-green-hover transition-colors disabled:opacity-50"
            >
              Ajouter
            </button>
            <button
              type="button"
              onClick={() => setAjout(null)}
              className="text-xs text-text-secondary hover:underline py-2"
            >
              Annuler
            </button>
            {paletteErr && <span className="text-xs text-brand-red">{paletteErr}</span>}
          </div>
        ) : (
          <button
            type="button"
            disabled={disabled || paletteBusy}
            onClick={() => setAjout({ label: '', ral: '', swatch: '#9ca3af' })}
            className="w-full border border-dashed border-border rounded-[8px] px-3.5 py-2 text-sm font-bold text-brand-green hover:border-brand-green transition-colors disabled:opacity-50"
          >
            ＋ Ajouter un coloris
          </button>
        )}
      </div>

      {/* ===== Exceptions par produit — replié (usage rare) ===== */}
      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-text-secondary select-none">
          Exceptions par produit ({v.exceptions.length})
        </summary>
        <p className="text-xs text-text-disabled mt-2 mb-2">
          Une exception prime sur le tableau : « si le nom du produit contient … alors cette
          cible (ou ne pas toucher) ».
        </p>
      <div className="space-y-1.5">
        {v.exceptions.map((ex, i) => (
          <div
            key={i}
            className="flex items-center gap-2.5 border border-border rounded-[8px] px-3.5 py-2 text-sm flex-wrap"
          >
            <span className="text-text-secondary">
              Nom du produit contient <b className="text-text-primary">« {ex.contient} »</b>
              {' · '}
              {ex.coloris
                ? <>coloris <b className="text-text-primary capitalize">{ex.coloris}</b></>
                : 'tous coloris'}
            </span>
            <span className="text-text-disabled text-[13px]">→</span>
            <span className="flex items-center gap-2 font-semibold">
              {ex.traiter && ex.cible && (
                <span
                  className="w-4 h-4 rounded-[5px] border border-black/20 flex-none"
                  style={{ background: ex.cible }}
                />
              )}
              {ex.traiter ? ralCibleLabel(ex.cible) : 'Ne pas toucher'}
            </span>
            <span className="ml-auto flex gap-3.5 text-xs font-bold">
              <button
                type="button"
                disabled={disabled}
                onClick={() => setForm({ index: i, ex: { ...ex } })}
                className="text-brand-green hover:underline disabled:opacity-50"
              >
                Modifier
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange({ ...v, exceptions: v.exceptions.filter((_, j) => j !== i) })}
                className="text-brand-red hover:underline disabled:opacity-50"
              >
                Supprimer
              </button>
            </span>
          </div>
        ))}
        {!form && (
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              setForm({
                index: null,
                ex: { contient: '', coloris: null, traiter: true, cible: '#434a50' },
              })
            }
            className="w-full border border-dashed border-border rounded-[8px] px-3.5 py-2 text-sm font-bold text-brand-green hover:border-brand-green transition-colors disabled:opacity-50"
          >
            ＋ Ajouter une exception
          </button>
        )}
      </div>
      {form && (
        <div className="mt-2 flex flex-wrap items-end gap-3.5 border border-border rounded-[8px] p-3.5 bg-surface">
          <div>
            <span className="block text-xs font-medium text-text-secondary mb-1.5">
              Nom du produit contient
            </span>
            <input
              type="text"
              value={form.ex.contient}
              onChange={(e) => setForm({ ...form, ex: { ...form.ex, contient: e.target.value } })}
              placeholder="ex. VOGEL"
              maxLength={80}
              className="w-44 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
            />
          </div>
          <div>
            <span className="block text-xs font-medium text-text-secondary mb-1.5">Coloris</span>
            <select
              value={form.ex.coloris ?? ''}
              onChange={(e) =>
                setForm({ ...form, ex: { ...form.ex, coloris: e.target.value || null } })
              }
              title="Coloris concerné par l'exception"
              className="border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-brand-green transition-colors"
            >
              <option value="">Tous les coloris</option>
              {coloris.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="block text-xs font-medium text-text-secondary mb-1.5">Traitement</span>
            <span className="inline-flex border border-border rounded-[8px] overflow-hidden bg-white">
              {segBtn(
                form.ex.traiter,
                'Traiter',
                () =>
                  setForm({
                    ...form,
                    ex: { ...form.ex, traiter: true, cible: form.ex.cible ?? '#434a50' },
                  }),
                true
              )}
              {segBtn(
                !form.ex.traiter,
                'Ne pas toucher',
                () => setForm({ ...form, ex: { ...form.ex, traiter: false } }),
                false
              )}
            </span>
          </div>
          {form.ex.traiter && (
            <div>
              <span className="block text-xs font-medium text-text-secondary mb-1.5">Cible</span>
              <CibleSelect
                cible={form.ex.cible}
                disabled={false}
                onChange={(hex) => setForm({ ...form, ex: { ...form.ex, cible: hex } })}
              />
            </div>
          )}
          <button
            type="button"
            disabled={!form.ex.contient.trim() || (form.ex.traiter && !isHexColor(form.ex.cible))}
            onClick={() => {
              const ex = { ...form.ex, contient: form.ex.contient.trim() }
              const exceptions =
                form.index === null
                  ? [...v.exceptions, ex]
                  : v.exceptions.map((e, i) => (i === form.index ? ex : e))
              onChange({ ...v, exceptions })
              setForm(null)
            }}
            className="bg-brand-green text-white text-xs font-bold rounded-[8px] px-4 py-2 hover:bg-brand-green-hover transition-colors disabled:opacity-50"
          >
            {form.index === null ? 'Ajouter' : 'Enregistrer l’exception'}
          </button>
          <button
            type="button"
            onClick={() => setForm(null)}
            className="text-xs text-text-secondary hover:underline py-2"
          >
            Annuler
          </button>
        </div>
      )}
      </details>

      {/* ===== Testeur avant/après — replié (contrôle ponctuel) ===== */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-text-secondary select-none">
          Tester le réglage (avant / après)
        </summary>
        <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <select
          value={produitIdx}
          disabled={disabled || !produits?.length}
          onChange={(e) => setProduitIdx(e.target.value ? Number(e.target.value) : '')}
          title="PNG produit du catalogue à tester"
          className={`border border-border bg-white rounded-[8px] px-2.5 py-1.5 text-[13px] max-w-full focus:outline-none focus:border-brand-green transition-colors ${
            produits === null ? 'anim-respire' : ''
          }`}
        >
          <option value="">
            {produits === null
              ? 'Chargement…'
              : produits.length
                ? 'Choisir un produit…'
                : serveurOk
                  ? 'Aucun PNG produit pour ce moteur'
                  : 'Serveur de fichiers inaccessible'}
          </option>
          {(produits ?? []).map((p, i) => (
            <option key={`${p.productId}-${p.coloris}`} value={i}>
              {p.produit} · {p.coloris}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled || testBusy || produitIdx === ''}
          onClick={lancerTest}
          className="bg-white border border-border rounded-[8px] px-3.5 py-1.5 text-xs font-bold text-text-secondary hover:border-brand-green hover:text-brand-green transition-colors disabled:opacity-50"
        >
          {testBusy ? 'Traitement…' : 'Tester'}
        </button>
        <span className="text-xs text-text-disabled">ou</span>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) lancerTestImage(f)
          }}
        />
        <button
          type="button"
          disabled={disabled || testBusy}
          onClick={() => fileRef.current?.click()}
          title="Tester sur une image donnée à la main (coloris détecté automatiquement) — sans passer par le serveur"
          className="bg-white border border-border rounded-[8px] px-3.5 py-1.5 text-xs font-bold text-text-secondary hover:border-brand-green hover:text-brand-green transition-colors disabled:opacity-50"
        >
          Tester une image…
        </button>
      </div>
      {produits !== null && !serveurOk && (
        <p className="text-xs text-amber-700 mt-2">
          Le serveur de fichiers (O:\) est inaccessible depuis ce poste — reconnecte-le pour
          pouvoir tester sur un produit du catalogue.
        </p>
      )}
      {testError && <p className="text-xs text-brand-red mt-2">{testError}</p>}
      {test && (
        <div className="mt-4">
          {/* Bandeau d'infos de validation — tout ce qui a servi à décider. */}
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3 border border-border rounded-[10px] bg-surface px-4 py-3 mb-3">
            <Info label="Produit">{test.produit}</Info>
            <Info label="Coloris détecté">
              <span className="capitalize">{test.coloris ?? 'non reconnu'}</span>
            </Info>
            <Info label="Règle appliquée">{test.raison}</Info>
            <Info label="Cible">
              {test.cible ? (
                <>
                  <span
                    className="w-4 h-4 rounded-[5px] border border-black/20 flex-none"
                    style={{ background: test.cible }}
                  />
                  {ralCibleLabel(test.cible)}
                </>
              ) : (
                'Ne pas toucher'
              )}
            </Info>
            {test.apres && (
              <>
                <Info label="Intensité">{test.intensite} %</Info>
                <Info label="Matière avant">
                  {test.avantHex && <Pastille hex={test.avantHex} />}
                </Info>
                <Info label="Matière après">
                  {test.apresHex && <Pastille hex={test.apresHex} />}
                </Info>
                {typeof test.pixelsTraites === 'number' && (
                  <Info label="Pixels traités">
                    {test.pixelsTraites.toLocaleString('fr-FR')}
                  </Info>
                )}
                {typeof test.pixelsProteges === 'number' && (
                  <Info label="Protégés (poignée, serrure…)">
                    {test.pixelsProteges.toLocaleString('fr-FR')}
                  </Info>
                )}
              </>
            )}
            {test.largeur && test.hauteur && (
              <Info label="Image">
                {test.largeur} × {test.hauteur} px
              </Info>
            )}
          </div>

          {test.apres ? (
            <>
              <Comparateur avant={test.avant} apres={test.apres} />
              <p className="text-[11px] text-text-disabled mt-1.5 text-center">
                Déplace la barre pour comparer — avant à gauche, après à droite.
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={test.avant}
                alt={`${test.produit} — non traité`}
                className="w-full max-w-[560px] rounded-[10px] border border-border bg-white"
              />
              <p className="text-sm text-text-secondary">
                Ne pas toucher — {test.raison.toLowerCase()}.
              </p>
            </div>
          )}
        </div>
      )}
        </div>
      </details>

      <p className="text-[11px] text-text-disabled mt-3">
        À chaque génération, le PNG corrigé est ajouté aux artefacts de contrôle du job
        (« 0-produit-ralify »).
      </p>
    </div>
  )
}
