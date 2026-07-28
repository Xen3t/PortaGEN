'use client'

import { useEffect, useRef, useState } from 'react'
import {
  RAL_CIBLES,
  RALIFY_DEFAUTS,
  isHexColor,
  ralCibleLabel,
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

/** Cible par défaut proposée quand on passe un coloris en « Traiter ». */
function cibleSuggestion(key: string): string {
  return RALIFY_DEFAUTS.regles[key]?.cible ?? '#434a50'
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
  disabled,
}: {
  moteur: MoteurKey
  value: RalifyReglages | null
  coloris: ColorisEntry[]
  onChange: (next: RalifyReglages) => void
  disabled: boolean
}) {
  const v = value ?? RALIFY_DEFAUTS

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
      {/* ===== Règle générale par coloris détecté ===== */}
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-3">
        Règle générale — par coloris détecté
      </h3>
      <div className="space-y-2">
        {coloris.map((c) => {
          const regle = v.regles[c.key] ?? { traiter: false, cible: null }
          const teck = c.key === 'teck'
          return (
            <div
              key={c.key}
              className="flex items-center gap-3.5 border border-border rounded-[8px] px-3.5 py-2.5 flex-wrap"
            >
              <span className="flex items-center gap-2 min-w-[120px] text-sm">
                <span
                  className="w-4 h-4 rounded-[5px] border border-black/20 flex-none"
                  style={{ background: c.swatch }}
                />
                <b>{c.label}</b>
                {teck && <small className="text-text-secondary text-[11.5px]">bois</small>}
              </span>
              <span className="inline-flex border border-border rounded-[8px] overflow-hidden bg-white">
                {segBtn(
                  regle.traiter,
                  'Traiter',
                  () => setRegle(c.key, { traiter: true, cible: regle.cible ?? cibleSuggestion(c.key) }),
                  true
                )}
                {segBtn(!regle.traiter, 'Ne pas toucher', () => setRegle(c.key, { traiter: false }), false)}
              </span>
              <span className={`text-[13px] ${regle.traiter ? 'text-text-disabled' : 'text-text-disabled opacity-45'}`}>
                →
              </span>
              {teck && !regle.traiter ? (
                <span className="text-[13px] text-text-disabled border border-border rounded-[8px] px-2.5 py-1.5 bg-surface opacity-45">
                  — le bois n&apos;a pas de RAL —
                </span>
              ) : (
                <CibleSelect
                  cible={regle.cible}
                  disabled={disabled || !regle.traiter}
                  onChange={(hex) => setRegle(c.key, { cible: hex })}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* ===== Exceptions par produit ===== */}
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary mt-5 mb-3">
        Exceptions — par produit
      </h3>
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

      {/* ===== Intensité ===== */}
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary mt-5 mb-3">
        Intensité
      </h3>
      <div className="max-w-xs">
        <div className="flex items-baseline justify-between text-xs mb-1">
          <span className="font-medium text-text-secondary">Force de la correction</span>
          <span className="font-mono text-text-disabled tabular-nums">{v.intensite} %</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={v.intensite}
          disabled={disabled}
          onChange={(e) => onChange({ ...v, intensite: Number(e.target.value) })}
          title="Force de la correction (100 % = teinte exactement au RAL)"
          className="w-full accent-brand-green"
        />
      </div>

      {/* ===== Contrôle : test avant/après ===== */}
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary mt-5 mb-3">
        Contrôle
      </h3>
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
      <p className="text-[11px] text-text-disabled mt-3">
        À chaque génération, le PNG corrigé est ajouté aux artefacts de contrôle du job
        (« 0-produit-ralify »).
      </p>
    </div>
  )
}
