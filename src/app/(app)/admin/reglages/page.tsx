'use client'

import { useEffect, useRef, useState } from 'react'
import GabaritsManager from '@/components/GabaritsManager'
import PromptEditor from '@/components/PromptEditor'
import RalifySection from '@/components/RalifySection'
import ReglagesApp, { type AppRubrique } from '@/components/ReglagesApp'
import ResetApp from '@/components/ResetApp'
import type { MoteurKey, MoteurReglages } from '@/lib/moteurs'

/**
 * Admin → Réglages — refonte « arborescence » (maquette reglages-refonte-v1,
 * proposition C validée par Mathias le 28/07/2026) : les sections repliables
 * empilées de l'ancienne page (jugées illisibles) sont remplacées par UNE
 * colonne de navigation pour tout — Application, moteurs avec leurs rubriques
 * dépliées dessous, Système — et un panneau qui n'affiche qu'UNE rubrique à la
 * fois, courte, avec son en-tête (titre + rappel du moteur).
 *
 * Un moteur par type de produit ; ses rubriques regroupent toutes ses
 * technologies : détection & coloris, RALify, gabarits, Canny, Prompt System,
 * export. La fiche TERMINUS ajoute les rubriques Gabarits XL et Canny XL.
 */

interface MoteurEntry {
  key: MoteurKey
  label: string
  /** Nom de code (ex. Battant = « JANUS », baptisé le 13/07/2026). */
  codeName?: string
  status: 'actif' | 'preparation'
  productCount: number
  /** Famille d'affichage (héritée de l'API — non affichée depuis la refonte C). */
  famille: string
}

interface PromptMeta {
  name: string
  version: number
  /** Date (SQLite UTC) et auteur de la version active — affichés sur la ligne fermée. */
  updated: string
  updatedBy: string | null
}

/**
 * Prompts d'UN moteur, rangés par étape de génération. Les noms sont les noms
 * de BASE (ceux du battant) : pour les autres moteurs ils sont préfixés au
 * rendu (« portillon-… ») et les libellés emploient le mot du produit
 * (« Intégration du portillon », pas « du portail »).
 */
const PROMPTS_DECOR: { name: string; label: string; exact?: boolean }[] = [
  { name: 'moodboard-llm', label: 'Analyse moodboard' },
  { name: 'decor-architecture', label: 'Architecture du décor' },
  { name: 'decor-couloir', label: 'Contrainte du couloir' },
]
// Fiche TERMINUS uniquement : l'analyse moodboard des décors XL (caméra reculée,
// allée 6 m) — nom EXACT, hors du préfixage par moteur (jeu « coulissant-xl »).
const PROMPTS_DECOR_COULISSANT: typeof PROMPTS_DECOR = [
  ...PROMPTS_DECOR,
  { name: 'coulissant-xl-moodboard-llm', label: 'Analyse moodboard — décors XL', exact: true },
]
const PROMPTS_PILIERS: { name: string; label: string }[] = [
  { name: 'piliers-murets', label: 'Rendu stucco piliers & murets' },
]
const PROMPTS_MARKETPLACE: { name: string; label: string }[] = [
  { name: 'marketplace-extension', label: 'Extension des bords (outpainting Nano)' },
]
const promptsIntegration = (produit: string): { name: string; label: string }[] => [
  { name: 'pose-fusion', label: `Pose + fusion du ${produit} (stuc + lumière, produit déjà posé)` },
  { name: 'integration-simple', label: `Intégration du ${produit} (méthode simple)` },
  { name: 'integration', label: `Intégration du ${produit} (méthode verrouillée)` },
]

/** Datetime SQLite (UTC sans suffixe) → « JJ/MM » local, pour les lignes de prompt. */
function fmtDbDate(s: string): string {
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Mot du produit d'un moteur — pour tous les libellés de la page. */
const PRODUIT_PAR_MOTEUR: Record<MoteurKey, string> = {
  battant: 'portail',
  coulissant: 'portail',
  portillon: 'portillon',
}

/** Coloris de la palette (origine + ajoutés depuis cette page), servis par /api/coloris. */
interface ColorisEntry {
  key: string
  label: string
  ral: string | null
  swatch: string
  custom: boolean
}

/** Image Canny active du moteur (personnalisée ou d'origine), servie par l'API. */
interface CannyInfo {
  custom: boolean
  relPath: string
  width: number | null
  height: number | null
  version: number
}

/* ===== Arborescence (proposition C) : la sélection désigne UNE rubrique ===== */

/** Rubriques de la fiche moteur — les « XL » n'existent que sur TERMINUS. */
type MoteurRubrique =
  | 'detection'
  | 'ralify'
  | 'gabarits'
  | 'gabarits-xl'
  | 'canny'
  | 'canny-xl'
  | 'prompts'
  | 'export'

type Sel =
  | { kind: 'app'; rub: AppRubrique }
  | { kind: 'moteur'; rub: MoteurRubrique }
  | { kind: 'reset' }

const APP_RUBRIQUES: { rub: AppRubrique; label: string }[] = [
  { rub: 'generations', label: 'Générations & modèle' },
  { rub: 'tarif', label: 'Tarif Gemini' },
  { rub: 'marquage', label: 'Marquage IA' },
  { rub: 'serveur', label: 'Serveur de fichiers' },
]

const MOTEUR_RUBRIQUES: { rub: MoteurRubrique; label: string; xl?: boolean }[] = [
  { rub: 'detection', label: 'Détection & coloris' },
  { rub: 'ralify', label: 'RALify' },
  { rub: 'gabarits', label: 'Gabarits' },
  { rub: 'gabarits-xl', label: 'Gabarits XL', xl: true },
  { rub: 'canny', label: 'Canny' },
  { rub: 'canny-xl', label: 'Canny XL', xl: true },
  { rub: 'prompts', label: 'Prompt System' },
  { rub: 'export', label: 'Export' },
]

/** Sélecteur segmenté (Auto / Off, etc.) aux couleurs de l'app. */
function Seg<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <span className="inline-flex border border-border rounded-[8px] overflow-hidden bg-white">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={`px-3.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
            i > 0 ? 'border-l border-border' : ''
          } ${
            o.value === value
              ? 'bg-brand-green text-white font-bold'
              : 'text-text-secondary hover:bg-surface'
          }`}
        >
          {o.label}
        </button>
      ))}
    </span>
  )
}

/** Carte blanche du panneau — la rubrique affichée vit dedans, toujours ouverte. */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-[12px] border border-border shadow-sm p-5">
      {children}
    </section>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs font-medium text-text-secondary mb-1.5">{children}</span>
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary mt-5 mb-3 first:mt-0">
      {children}
    </h3>
  )
}

export default function MoteursPage() {
  const [moteurs, setMoteurs] = useState<MoteurEntry[]>([])
  const [selected, setSelected] = useState<MoteurKey>('battant')
  const [sel, setSel] = useState<Sel>({ kind: 'app', rub: 'generations' })
  const [reglages, setReglages] = useState<MoteurReglages | null>(null)
  const [dirty, setDirty] = useState(false)
  const [promptVersions, setPromptVersions] = useState<Record<string, PromptMeta>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [coloris, setColoris] = useState<ColorisEntry[]>([])
  const [colorisForm, setColorisForm] = useState<{
    label: string
    ral: string
    swatch: string
  } | null>(null)
  const [canny, setCanny] = useState<CannyInfo | null>(null)
  const [cannyBusy, setCannyBusy] = useState(false)
  const cannyFileRef = useRef<HTMLInputElement>(null)
  // Canny XL (22/07/2026) : image ET réglages (alignement, corridor) du jeu
  // « coulissant-xl », EN COMPLÉMENT du Canny coulissant qui ne bouge pas —
  // rubrique de la fiche TERMINUS uniquement.
  const [cannyXl, setCannyXl] = useState<CannyInfo | null>(null)
  const [cannyXlBusy, setCannyXlBusy] = useState(false)
  const cannyXlFileRef = useRef<HTMLInputElement>(null)
  const [reglagesXl, setReglagesXl] = useState<MoteurReglages | null>(null)
  const [dirtyXl, setDirtyXl] = useState(false)
  // Prompt dont l'éditeur est déroulé (un seul à la fois, replié par défaut).
  const [openPrompt, setOpenPrompt] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/moteurs')
      .then((r) => r.json())
      .then((d) => setMoteurs(d.moteurs ?? []))
    fetch('/api/prompts')
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, PromptMeta> = {}
        for (const p of (d.prompts ?? []) as PromptMeta[]) map[p.name] = p
        setPromptVersions(map)
      })
    fetch('/api/coloris')
      .then((r) => r.json())
      .then((d) => setColoris(d.coloris ?? []))
  }, [])

  // Les réglages suivent le moteur : chaque moteur a LES SIENS (règle 13/07/2026 —
  // jamais partagés). Changer de moteur recharge et abandonne les modifs non
  // enregistrées ; changer de RUBRIQUE du même moteur les conserve.
  useEffect(() => {
    setReglages(null)
    setDirty(false)
    setCanny(null)
    setOpenPrompt(null)
    fetch(`/api/moteurs/${selected}/reglages`)
      .then((r) => r.json())
      .then((d) => setReglages(d.reglages ?? null))
    fetch(`/api/moteurs/${selected}/canny`)
      .then((r) => r.json())
      .then((d) => setCanny(d.canny ?? null))
    setCannyXl(null)
    setReglagesXl(null)
    setDirtyXl(false)
    if (selected === 'coulissant') {
      fetch('/api/moteurs/coulissant-xl/canny')
        .then((r) => r.json())
        .then((d) => setCannyXl(d.canny ?? null))
      fetch('/api/moteurs/coulissant-xl/reglages')
        .then((r) => r.json())
        .then((d) => setReglagesXl(d.reglages ?? null))
    }
  }, [selected])

  /** Ajout d'un coloris à la palette (POST /api/coloris), depuis le mini-formulaire. */
  async function submitColoris() {
    if (!colorisForm) return
    setBusy(true)
    const res = await fetch('/api/coloris', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: colorisForm.label,
        ral: colorisForm.ral.trim() || null,
        swatch: colorisForm.swatch,
      }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok && data?.coloris) {
      setColoris(data.coloris)
      setColorisForm(null)
      setNotice(`Coloris « ${colorisForm.label.trim()} » ajouté à la palette.`)
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  async function deleteColoris(entry: ColorisEntry) {
    if (!window.confirm(`Supprimer le coloris « ${entry.label} » de la palette ?`)) return
    const res = await fetch('/api/coloris', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: entry.key }),
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.coloris) {
      setColoris(data.coloris)
      setNotice(`Coloris « ${entry.label} » supprimé.`)
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  /** Remplacement de l'image Canny du moteur (fichier choisi via l'input caché). */
  async function uploadCanny(file: File) {
    setCannyBusy(true)
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/moteurs/${selected}/canny`, { method: 'POST', body: form })
    const data = await res.json().catch(() => null)
    setCannyBusy(false)
    if (res.ok && data?.canny) {
      setCanny(data.canny)
      setNotice(
        `Image Canny remplacée (${data.canny.width}×${data.canny.height}). Elle sert dès la prochaine génération.`
      )
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  /** Remplacement de l'image Canny XL (jeu « coulissant-xl », fiche TERMINUS). */
  async function uploadCannyXl(file: File) {
    setCannyXlBusy(true)
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/moteurs/coulissant-xl/canny', { method: 'POST', body: form })
    const data = await res.json().catch(() => null)
    setCannyXlBusy(false)
    if (res.ok && data?.canny) {
      setCannyXl(data.canny)
      setNotice(
        `Image Canny XL remplacée (${data.canny.width}×${data.canny.height}). Elle sert dès le prochain décor XL.`
      )
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  async function resetCannyXl() {
    if (!window.confirm('Revenir à l’image Canny XL d’origine (trottoir « caméra reculée ») ?')) return
    setCannyXlBusy(true)
    const res = await fetch('/api/moteurs/coulissant-xl/canny', { method: 'DELETE' })
    const data = await res.json().catch(() => null)
    setCannyXlBusy(false)
    if (res.ok && data?.canny) {
      setCannyXl(data.canny)
      setNotice('Image Canny XL d’origine rétablie.')
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  async function resetCanny() {
    if (!window.confirm('Revenir à l’image Canny d’origine ?')) return
    setCannyBusy(true)
    const res = await fetch(`/api/moteurs/${selected}/canny`, { method: 'DELETE' })
    const data = await res.json().catch(() => null)
    setCannyBusy(false)
    if (res.ok && data?.canny) {
      setCanny(data.canny)
      setNotice('Image Canny d’origine rétablie.')
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  function setField<K extends keyof MoteurReglages>(key: K, value: MoteurReglages[K]) {
    // Pas encore chargé → on ignore (sinon « dirty » fantôme sur un clic perdu).
    if (!reglages) return
    setReglages({ ...reglages, [key]: value })
    setDirty(true)
  }

  /** Réglages du jeu Canny XL (alignement, corridor) — fiche TERMINUS. */
  function setFieldXl<K extends keyof MoteurReglages>(key: K, value: MoteurReglages[K]) {
    if (!reglagesXl) return
    setReglagesXl({ ...reglagesXl, [key]: value })
    setDirtyXl(true)
  }

  async function save() {
    if (!reglages) return
    setBusy(true)
    setNotice(null)
    // Champs numériques : bornés côté client, et envoyés SEULEMENT quand leur mode
    // est « Manuel » — sinon un champ vidé (0, hors bornes) puis masqué par un
    // retour en Auto bloquerait tout l'enregistrement sur une erreur invisible.
    const body: Record<string, unknown> = { ...reglages }
    if (reglages.cannyPlacement === 'manuel') {
      body.cannyOffsetPx = Math.min(300, Math.max(-300, Math.round(reglages.cannyOffsetPx || 0)))
    } else {
      delete body.cannyOffsetPx
    }
    if (reglages.corridor === 'manuel') {
      body.corridorWidthCm = Math.min(800, Math.max(100, Math.round(reglages.corridorWidthCm || 100)))
    } else {
      delete body.corridorWidthCm
    }
    if (reglages.integrationMethod === 'pose-fusion') {
      body.poseDebordPct = Math.min(10, Math.max(0, Number(reglages.poseDebordPct) || 0))
      body.poseSeuilAlpha = Math.min(255, Math.max(1, Math.round(reglages.poseSeuilAlpha || 200)))
    } else {
      delete body.poseDebordPct
      delete body.poseSeuilAlpha
    }
    // Ombre du pilier sur la lame : réglage PROPRE au coulissant (28/07/2026).
    if (selected === 'coulissant' && reglages.integrationMethod === 'pose-fusion') {
      body.ombrePilierPct = Math.min(100, Math.max(0, Math.round(Number(reglages.ombrePilierPct) || 0)))
    } else {
      delete body.ombrePilierPct
    }
    const res = await fetch(`/api/moteurs/${selected}/reglages`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data?.reglages) {
      setBusy(false)
      setNotice(`Erreur : ${data?.error ?? res.status}`)
      return
    }
    setReglages(data.reglages)
    setDirty(false)
    // Réglages du jeu Canny XL (fiche TERMINUS) : seuls ses champs Canny partent —
    // alignement et corridor, avec la même règle « Manuel seulement » que ci-dessus.
    if (dirtyXl && reglagesXl) {
      const bodyXl: Record<string, unknown> = {
        cannyPlacement: reglagesXl.cannyPlacement,
        corridor: reglagesXl.corridor,
      }
      if (reglagesXl.cannyPlacement === 'manuel') {
        bodyXl.cannyOffsetPx = Math.min(300, Math.max(-300, Math.round(reglagesXl.cannyOffsetPx || 0)))
      }
      if (reglagesXl.corridor === 'manuel') {
        bodyXl.corridorWidthCm = Math.min(800, Math.max(100, Math.round(reglagesXl.corridorWidthCm || 100)))
      }
      const resXl = await fetch('/api/moteurs/coulissant-xl/reglages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyXl),
      })
      const dataXl = await resXl.json().catch(() => null)
      if (!resXl.ok || !dataXl?.reglages) {
        setBusy(false)
        setNotice(`Erreur (Canny XL) : ${dataXl?.error ?? resXl.status}`)
        return
      }
      setReglagesXl(dataXl.reglages)
      setDirtyXl(false)
    }
    setBusy(false)
    const m = moteurs.find((x) => x.key === selected)
    setNotice(`Réglages du moteur ${m?.label ?? selected} enregistrés.`)
  }

  const current = moteurs.find((m) => m.key === selected)

  /**
   * Ligne prompt : libellé, version active, date · auteur de la dernière
   * modification, et « Modifier » qui DÉPLIE l'atelier sur place (frise des
   * versions + Éditer / Comparer — refonte du 28/07/2026, maquette
   * prompt-system-v6, toujours DANS la fiche moteur). Les prompts appartiennent
   * AU moteur (règle 13/07/2026) : battant garde les noms historiques, les
   * autres moteurs préfixent (« portillon-piliers-murets »). Un prompt que le
   * moteur n'a pas encore (ex. décor portillon) est « à venir ».
   */
  // Résumé de l'en-tête « Prompt System » (maquette v6) : nombre de prompts du
  // moteur et dernière modification, tous prompts confondus.
  const promptDefs: { name: string; label: string; exact?: boolean }[] = [
    ...(selected === 'coulissant' ? PROMPTS_DECOR_COULISSANT : PROMPTS_DECOR),
    ...PROMPTS_PILIERS,
    ...promptsIntegration(PRODUIT_PAR_MOTEUR[selected]),
    ...PROMPTS_MARKETPLACE,
  ]
  const promptMetas = promptDefs
    .map((p) =>
      promptVersions[p.exact ? p.name : selected === 'battant' ? p.name : `${selected}-${p.name}`]
    )
    .filter((m): m is PromptMeta => Boolean(m))
  const dernierPrompt = promptMetas.reduce<PromptMeta | null>(
    (a, b) => (a && a.updated > b.updated ? a : b),
    null
  )

  const PromptRows = ({ list }: { list: { name: string; label: string; exact?: boolean }[] }) => (
    <div className="space-y-1.5">
      {list.map((p) => {
        // exact = nom pris tel quel (prompts d'un JEU, ex. coulissant-xl-…).
        const name = p.exact ? p.name : selected === 'battant' ? p.name : `${selected}-${p.name}`
        const meta = promptVersions[name]
        const open = openPrompt === name
        return (
          <div
            key={name}
            className={`border rounded-[8px] ${
              open ? 'border-brand-green shadow-[0_0_0_2px_var(--color-brand-green-light)]' : 'border-border'
            }`}
          >
            <div className="flex items-center gap-2.5 px-3 py-2 text-sm">
              <span className="font-semibold">{p.label}</span>
              <span
                className={`text-[11px] font-mono rounded-full px-2 py-px ${
                  open ? 'bg-brand-green text-white font-bold' : 'bg-surface text-text-disabled'
                }`}
              >
                {meta ? `v${meta.version}` : '—'}
              </span>
              {meta && (
                <span className="text-[11.5px] text-text-disabled">
                  {fmtDbDate(meta.updated)}
                  {meta.updatedBy ? ` · ${meta.updatedBy}` : ''}
                </span>
              )}
              {meta ? (
                <button
                  type="button"
                  onClick={() => setOpenPrompt(open ? null : name)}
                  className="ml-auto text-brand-green font-bold text-xs hover:underline"
                >
                  {open ? 'Fermer' : 'Modifier'}
                </button>
              ) : (
                <span className="ml-auto text-text-disabled text-xs" title="Ce moteur n'a pas encore ce prompt">
                  à venir
                </span>
              )}
            </div>
            {open && (
              <PromptEditor
                name={name}
                onSaved={(n, saved) =>
                  setPromptVersions((m) => ({
                    ...m,
                    [n]: {
                      name: n,
                      version: saved.version,
                      updated: saved.created_at,
                      updatedBy: saved.created_by,
                    },
                  }))
                }
              />
            )}
          </div>
        )
      })}
    </div>
  )

  /* ===== En-tête du panneau : titre de la rubrique + rappel du contexte ===== */

  const nomMoteur = current
    ? `${selected === 'portillon' ? 'Portillon' : `Portail ${current.label}`}${
        current.codeName ? ` « ${current.codeName} »` : ''
      }`
    : ''

  const titre =
    sel.kind === 'app'
      ? APP_RUBRIQUES.find((r) => r.rub === sel.rub)?.label
      : sel.kind === 'reset'
        ? 'Remise à zéro de l’application'
        : current?.status === 'preparation'
          ? nomMoteur
          : MOTEUR_RUBRIQUES.find((r) => r.rub === sel.rub)?.label

  /** Clic sur un moteur dans l'arborescence : le sélectionne et ouvre sa 1ʳᵉ rubrique. */
  function pickMoteur(key: MoteurKey) {
    setSelected(key)
    setSel({ kind: 'moteur', rub: 'detection' })
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/*
        Arborescence (proposition C, 28/07/2026) : Application, moteurs — le
        moteur sélectionné déplie ses rubriques dessous — puis Système. Le
        panneau de droite n'affiche que la rubrique cliquée.
      */}
      <div className="grid gap-6 items-start lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="bg-white rounded-[12px] border border-border shadow-sm p-3.5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-104px)] lg:overflow-y-auto">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-text-disabled px-1 mt-0.5 mb-1.5">
            Application
          </p>
          {APP_RUBRIQUES.map((r) => (
            <button
              key={r.rub}
              type="button"
              aria-current={sel.kind === 'app' && sel.rub === r.rub}
              onClick={() => setSel({ kind: 'app', rub: r.rub })}
              className={`w-full flex items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-sm transition-colors ${
                sel.kind === 'app' && sel.rub === r.rub
                  ? 'bg-brand-green-light text-brand-green font-bold'
                  : 'text-text-primary font-semibold hover:bg-surface'
              }`}
            >
              {r.label}
            </button>
          ))}

          <p className="text-[10.5px] font-bold uppercase tracking-wider text-text-disabled px-1 mt-4 mb-1.5">
            Moteurs
          </p>
          {moteurs.map((m) => {
            const active = m.key === selected
            const onFiche = active && sel.kind === 'moteur'
            return (
              <div key={m.key}>
                <button
                  type="button"
                  aria-current={onFiche}
                  onClick={() => pickMoteur(m.key)}
                  className={`w-full flex items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-sm transition-colors ${
                    onFiche
                      ? 'bg-brand-green-light text-brand-green font-bold'
                      : 'text-text-primary font-semibold hover:bg-surface'
                  }`}
                >
                  <span className="flex-1 truncate">{m.label}</span>
                  {m.status === 'preparation' ? (
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 rounded-full px-2 py-px whitespace-nowrap">
                      prépa
                    </span>
                  ) : (
                    <span
                      className={`text-[10px] ${onFiche ? 'text-brand-green' : 'text-text-disabled'}`}
                    >
                      {active ? '▾' : '▸'}
                    </span>
                  )}
                </button>
                {/* Rubriques du moteur déplié — les XL n'existent que sur TERMINUS. */}
                {active && m.status === 'actif' && (
                  <div className="ml-3.5 border-l-2 border-border pl-2 my-1 space-y-px">
                    {MOTEUR_RUBRIQUES.filter((r) => !r.xl || m.key === 'coulissant').map((r) => (
                      <button
                        key={r.rub}
                        type="button"
                        aria-current={sel.kind === 'moteur' && sel.rub === r.rub}
                        onClick={() => setSel({ kind: 'moteur', rub: r.rub })}
                        className={`w-full rounded-[8px] px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                          sel.kind === 'moteur' && sel.rub === r.rub
                            ? 'text-brand-green font-bold bg-brand-green-light'
                            : 'text-text-secondary hover:bg-surface'
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          <p className="text-[10.5px] font-bold uppercase tracking-wider text-text-disabled px-1 mt-4 mb-1.5">
            Système
          </p>
          <button
            type="button"
            aria-current={sel.kind === 'reset'}
            onClick={() => setSel({ kind: 'reset' })}
            className={`w-full flex items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-sm font-semibold transition-colors ${
              sel.kind === 'reset' ? 'bg-brand-red-light text-brand-red font-bold' : 'text-brand-red hover:bg-surface'
            }`}
          >
            Remise à zéro
          </button>
        </aside>

        {/* ============ Panneau : UNE rubrique à la fois ============ */}
        <div>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div className="flex items-center gap-4 flex-wrap">
              <h2 className={`text-[19px] font-bold ${sel.kind === 'reset' ? 'text-brand-red' : ''}`}>
                {titre}
              </h2>
              {/* RALify : l'interrupteur reste visible dans l'en-tête (règle maquette ralify-v2). */}
              {sel.kind === 'moteur' && sel.rub === 'ralify' && current?.status === 'actif' && (
                <Seg
                  value={reglages?.ralify.actif ? 'on' : 'off'}
                  options={[
                    { value: 'on', label: 'Activé' },
                    { value: 'off', label: 'Désactivé' },
                  ]}
                  onChange={(val) =>
                    reglages && setField('ralify', { ...reglages.ralify, actif: val === 'on' })
                  }
                  disabled={!reglages}
                />
              )}
            </div>
            <span className="text-xs text-text-disabled">
              {sel.kind === 'app' && 'Application · valable quel que soit le moteur'}
              {sel.kind === 'reset' && 'Système · sauvegarde complète avant effacement'}
              {sel.kind === 'moteur' && current && (
                <>
                  Moteur <b className="text-text-secondary font-semibold">{nomMoteur}</b>
                  {current.status === 'actif' && <> · {current.productCount} produits</>}
                  {sel.rub === 'prompts' && dernierPrompt && (
                    <>
                      {' '}· {promptMetas.length} prompts · dernier modifié le{' '}
                      {fmtDbDate(dernierPrompt.updated)}
                      {dernierPrompt.updatedBy ? ` par ${dernierPrompt.updatedBy}` : ''}
                    </>
                  )}
                </>
              )}
            </span>
          </div>

          {sel.kind === 'app' && <ReglagesApp rubrique={sel.rub} />}

          {sel.kind === 'reset' && <ResetApp />}

          {sel.kind === 'moteur' && (
            <>
              {notice && (
                <div className="bg-brand-teal-light text-brand-teal text-sm rounded-[8px] px-4 py-3 mb-5 flex justify-between gap-3">
                  <span>{notice}</span>
                  <button onClick={() => setNotice(null)} className="hover:opacity-70">✕</button>
                </div>
              )}

              {current?.status === 'preparation' ? (
                <div className="bg-white rounded-[12px] shadow-sm border border-dashed border-[#cfd4da] p-10 text-center">
                  <h2 className="font-semibold mb-1.5">Moteur {current.label} — en préparation</h2>
                  <p className="text-sm text-text-secondary max-w-xl mx-auto">
                    {current.key === 'coulissant'
                      ? 'Mêmes réglages que le Battant, avec une intégration propre : le vantail se cache derrière le pilier.'
                      : 'Ses propres tailles, gabarits, palette de coloris et Prompt System.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* ============ Détection & coloris ============ */}
                  {sel.rub === 'detection' && (
                    <Card>
                      <SubHeading>Détection du type de produit</SubHeading>
                      <Seg
                        value={reglages?.detectionType ?? 'auto'}
                        options={[
                          { value: 'auto', label: 'Automatique' },
                          { value: 'manuel', label: 'Manuel' },
                        ]}
                        onChange={(v) => setField('detectionType', v)}
                        disabled={!reglages}
                      />

                      <SubHeading>Détourage du produit</SubHeading>
                      <div>
                        <FieldLabel>Moteur de détourage</FieldLabel>
                        <span className="inline-block bg-surface border border-border rounded-[8px] px-3 py-2 text-sm text-text-secondary">
                          BiRefNet (local)
                        </span>
                      </div>

                      <SubHeading>Reconnaissance du coloris</SubHeading>
                      <div className="flex flex-wrap gap-2">
                        {coloris.map((c) => (
                          <span
                            key={c.key}
                            className="flex items-center gap-2 border border-border rounded-[8px] px-3 py-2 text-sm"
                          >
                            <span
                              className="w-4 h-4 rounded-[5px] border border-black/20 flex-none"
                              style={{ background: c.swatch }}
                            />
                            <b>{c.label}</b>
                            {c.ral && <small className="text-text-secondary text-[11.5px]">{c.ral}</small>}
                            {c.custom && (
                              <button
                                type="button"
                                onClick={() => deleteColoris(c)}
                                title="Supprimer ce coloris de la palette"
                                className="text-text-disabled hover:text-brand-red text-xs font-bold"
                              >
                                ✕
                              </button>
                            )}
                          </span>
                        ))}
                        {!colorisForm && (
                          <button
                            type="button"
                            onClick={() => setColorisForm({ label: '', ral: '', swatch: '#9ca3af' })}
                            className="border border-dashed border-border rounded-[8px] px-3 py-2 text-sm font-bold text-brand-green hover:border-brand-green transition-colors"
                          >
                            ＋ Ajouter
                          </button>
                        )}
                      </div>
                      {colorisForm && (
                        <div className="mt-3 flex flex-wrap items-end gap-3 border border-border rounded-[8px] p-3 bg-surface">
                          <div>
                            <FieldLabel>Nom du coloris</FieldLabel>
                            <input
                              type="text"
                              value={colorisForm.label}
                              onChange={(e) => setColorisForm({ ...colorisForm, label: e.target.value })}
                              placeholder="ex. Beige"
                              maxLength={40}
                              className="w-40 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                            />
                          </div>
                          <div>
                            <FieldLabel>RAL (facultatif)</FieldLabel>
                            <input
                              type="text"
                              value={colorisForm.ral}
                              onChange={(e) => setColorisForm({ ...colorisForm, ral: e.target.value })}
                              placeholder="ex. RAL 1015"
                              maxLength={20}
                              className="w-32 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                            />
                          </div>
                          <div>
                            <FieldLabel>Pastille</FieldLabel>
                            <input
                              type="color"
                              value={colorisForm.swatch}
                              onChange={(e) => setColorisForm({ ...colorisForm, swatch: e.target.value })}
                              title="Couleur de la pastille"
                              className="w-12 h-9 border border-border rounded-[8px] bg-white cursor-pointer"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={submitColoris}
                            disabled={busy || !colorisForm.label.trim()}
                            className="bg-brand-green text-white text-xs font-bold rounded-[8px] px-4 py-2 hover:bg-brand-green-hover transition-colors disabled:opacity-50"
                          >
                            Ajouter
                          </button>
                          <button
                            type="button"
                            onClick={() => setColorisForm(null)}
                            className="text-xs text-text-secondary hover:underline py-2"
                          >
                            Annuler
                          </button>
                        </div>
                      )}
                      <p className="text-xs text-text-secondary mt-2">
                        Un coloris ajouté devient disponible partout où l&apos;on choisit un coloris à la
                        main (correction sur la fiche produit). La détection automatique par l&apos;image
                        continue de ne trancher qu&apos;entre les coloris d&apos;origine.
                      </p>
                    </Card>
                  )}

                  {/* ============ RALify (maquette ralify-v2 validée le 28/07/2026) ============ */}
                  {sel.rub === 'ralify' && (
                    <Card>
                      <RalifySection
                        moteur={selected}
                        value={reglages?.ralify ?? null}
                        coloris={coloris}
                        onChange={(r) => setField('ralify', r)}
                        disabled={!reglages}
                      />
                    </Card>
                  )}

                  {/* ============ Gabarits (ex-page Admin → Gabarits, absorbée) ============ */}
                  {sel.rub === 'gabarits' && (
                    <Card>
                      <GabaritsManager moteur={selected} embedded />
                    </Card>
                  )}

                  {/* ============ Gabarits XL (coulissants larges 450-600, 22/07/2026) ============ */}
                  {sel.rub === 'gabarits-xl' && selected === 'coulissant' && (
                    <Card>
                      <GabaritsManager moteur="coulissant-xl" embedded />
                    </Card>
                  )}

                  {/* ============ Canny ============ */}
                  {sel.rub === 'canny' && (
                    <Card>
                      <div className="flex flex-wrap gap-5 items-start">
                        {/* Aperçu agrandi ×2,5 (retour Mathias 13/07/2026 : 160 px illisible). */}
                        <figure className="w-[400px] max-w-full flex-none">
                          {canny ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`/api/artifacts?p=${encodeURIComponent(canny.relPath)}&v=${canny.version}`}
                              alt="Canny trottoir de référence"
                              className="w-full rounded-[8px] border border-border bg-black"
                            />
                          ) : (
                            <div className="w-full aspect-[2000/1330] rounded-[8px] border border-border bg-surface" />
                          )}
                          <figcaption className="text-[11px] text-text-disabled mt-1 text-center">
                            {canny ? (
                              `Référence ${canny.width ?? '?'}×${canny.height ?? '?'} · ${
                                canny.custom ? 'personnalisée' : 'd’origine'
                              }`
                            ) : (
                              <span className="anim-respire">Chargement…</span>
                            )}
                          </figcaption>
                        </figure>
                        {/* Options en UNE colonne (mise en page Canny XL préférée par
                            Mathias le 22/07/2026, appliquée à tous les moteurs). */}
                        <div className="flex flex-col gap-4 flex-1 min-w-64">
                          <div>
                            <FieldLabel>Alignement des piliers au sol</FieldLabel>
                            <Seg
                              value={reglages?.cannyPlacement ?? 'auto'}
                              options={[
                                { value: 'auto', label: 'Auto' },
                                { value: 'manuel', label: 'Manuel' },
                                { value: 'off', label: 'Off' },
                              ]}
                              onChange={(v) => setField('cannyPlacement', v)}
                              disabled={!reglages}
                            />
                            {reglages?.cannyPlacement === 'manuel' && (
                              <div className="mt-2 flex items-center gap-2">
                                <input
                                  type="number"
                                  min={-300}
                                  max={300}
                                  value={reglages.cannyOffsetPx}
                                  onChange={(e) => setField('cannyOffsetPx', Number(e.target.value) || 0)}
                                  title="Décalage manuel de la ligne de sol"
                                  className="w-24 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                />
                                <span className="text-xs text-text-disabled">px · positif = descendu</span>
                              </div>
                            )}
                          </div>
                          <div>
                            <FieldLabel>Largeur du corridor</FieldLabel>
                            <Seg
                              value={reglages?.corridor ?? 'auto'}
                              options={[
                                { value: 'auto', label: 'Auto' },
                                { value: 'manuel', label: 'Manuel' },
                              ]}
                              onChange={(v) => setField('corridor', v)}
                              disabled={!reglages}
                            />
                            {reglages?.corridor === 'manuel' && (
                              <div className="mt-2 flex items-center gap-2">
                                <input
                                  type="number"
                                  min={100}
                                  max={800}
                                  value={reglages.corridorWidthCm}
                                  onChange={(e) => setField('corridorWidthCm', Number(e.target.value) || 0)}
                                  title="Largeur imposée du corridor"
                                  className="w-24 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                />
                                <span className="text-xs text-text-disabled">cm</span>
                              </div>
                            )}
                            <p className="text-[11px] text-text-disabled mt-1.5 max-w-56">
                              Auto = plus grande taille active du moteur.
                            </p>
                          </div>
                          <div>
                            <FieldLabel>Image de référence</FieldLabel>
                            <input
                              ref={cannyFileRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                // On vide l'input pour pouvoir re-choisir le MÊME fichier ensuite.
                                e.target.value = ''
                                if (f) uploadCanny(f)
                              }}
                            />
                            <span className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={cannyBusy || !canny}
                                onClick={() => cannyFileRef.current?.click()}
                                className="bg-white border border-border rounded-[8px] px-3.5 py-1.5 text-xs font-bold text-text-secondary hover:border-brand-green hover:text-brand-green transition-colors disabled:opacity-50"
                              >
                                {cannyBusy ? 'Envoi…' : 'Remplacer'}
                              </button>
                              {canny?.custom && (
                                <button
                                  type="button"
                                  disabled={cannyBusy}
                                  onClick={resetCanny}
                                  className="text-xs text-text-secondary hover:underline disabled:opacity-50"
                                >
                                  Revenir à l&apos;image d&apos;origine
                                </button>
                              )}
                            </span>
                            <p className="text-[11px] text-text-disabled mt-1.5 max-w-56">
                              PNG, JPG ou WebP. L&apos;image est utilisée telle quelle par le moteur dès la
                              prochaine génération.
                            </p>
                          </div>
                        </div>
                      </div>
                    </Card>
                  )}

                  {/* ============ Canny XL (coulissants 450-600, 22/07/2026) — rubrique à
                       part, comme Gabarits XL : le Canny standard ne bouge pas. ============ */}
                  {sel.rub === 'canny-xl' && selected === 'coulissant' && (
                    <Card>
                      <p className="text-xs text-text-secondary mb-4">
                        Utilisé UNIQUEMENT par les tailles et décors XL (coulissants 450 – 600) — il
                        vient en complément, le Canny de la rubrique précédente reste celui du standard.
                      </p>
                      <div className="flex flex-wrap gap-5 items-start">
                        <figure className="w-[400px] max-w-full flex-none">
                          {cannyXl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`/api/artifacts?p=${encodeURIComponent(cannyXl.relPath)}&v=${cannyXl.version}`}
                              alt="Canny XL de référence"
                              className="w-full rounded-[8px] border border-border bg-black"
                            />
                          ) : (
                            <div className="w-full aspect-[2000/1330] rounded-[8px] border border-border bg-surface" />
                          )}
                          <figcaption className="text-[11px] text-text-disabled mt-1 text-center">
                            {cannyXl ? (
                              `Référence XL ${cannyXl.width ?? '?'}×${cannyXl.height ?? '?'} · ${
                                cannyXl.custom ? 'personnalisée' : 'd’origine'
                              }`
                            ) : (
                              <span className="anim-respire">Chargement…</span>
                            )}
                          </figcaption>
                        </figure>
                        <div className="flex flex-col gap-4 flex-1 min-w-64">
                          <div>
                            <FieldLabel>Alignement des piliers au sol</FieldLabel>
                            <Seg
                              value={reglagesXl?.cannyPlacement ?? 'auto'}
                              options={[
                                { value: 'auto', label: 'Auto' },
                                { value: 'manuel', label: 'Manuel' },
                                { value: 'off', label: 'Off' },
                              ]}
                              onChange={(v) => setFieldXl('cannyPlacement', v)}
                              disabled={!reglagesXl}
                            />
                            {reglagesXl?.cannyPlacement === 'manuel' && (
                              <div className="mt-2 flex items-center gap-2">
                                <input
                                  type="number"
                                  min={-300}
                                  max={300}
                                  value={reglagesXl.cannyOffsetPx}
                                  onChange={(e) => setFieldXl('cannyOffsetPx', Number(e.target.value) || 0)}
                                  title="Décalage manuel de la ligne de sol (jeu XL)"
                                  className="w-24 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                />
                                <span className="text-xs text-text-disabled">px · positif = descendu</span>
                              </div>
                            )}
                          </div>
                          <div>
                            <FieldLabel>Largeur du corridor</FieldLabel>
                            <Seg
                              value={reglagesXl?.corridor ?? 'auto'}
                              options={[
                                { value: 'auto', label: 'Auto' },
                                { value: 'manuel', label: 'Manuel' },
                              ]}
                              onChange={(v) => setFieldXl('corridor', v)}
                              disabled={!reglagesXl}
                            />
                            {reglagesXl?.corridor === 'manuel' && (
                              <div className="mt-2 flex items-center gap-2">
                                <input
                                  type="number"
                                  min={100}
                                  max={800}
                                  value={reglagesXl.corridorWidthCm}
                                  onChange={(e) => setFieldXl('corridorWidthCm', Number(e.target.value) || 0)}
                                  title="Largeur imposée du corridor (jeu XL)"
                                  className="w-24 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                />
                                <span className="text-xs text-text-disabled">cm</span>
                              </div>
                            )}
                            <p className="text-[11px] text-text-disabled mt-1.5 max-w-56">
                              Auto = plus grande taille XL active (600 cm).
                            </p>
                          </div>
                          <div>
                            <FieldLabel>Image de référence</FieldLabel>
                            <input
                              ref={cannyXlFileRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                e.target.value = ''
                                if (f) uploadCannyXl(f)
                              }}
                            />
                            <span className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={cannyXlBusy || !cannyXl}
                                onClick={() => cannyXlFileRef.current?.click()}
                                className="bg-white border border-border rounded-[8px] px-3.5 py-1.5 text-xs font-bold text-text-secondary hover:border-brand-green hover:text-brand-green transition-colors disabled:opacity-50"
                              >
                                {cannyXlBusy ? 'Envoi…' : 'Remplacer'}
                              </button>
                              {cannyXl?.custom && (
                                <button
                                  type="button"
                                  disabled={cannyXlBusy}
                                  onClick={resetCannyXl}
                                  className="text-xs text-text-secondary hover:underline disabled:opacity-50"
                                >
                                  Revenir à l&apos;image d&apos;origine
                                </button>
                              )}
                            </span>
                            <p className="text-[11px] text-text-disabled mt-1.5 max-w-56">
                              Trottoir « caméra reculée » : sert uniquement aux décors XL —
                              remplaçable à tout moment.
                            </p>
                          </div>
                        </div>
                      </div>
                    </Card>
                  )}

                  {/* ============ Prompt System ============ */}
                  {sel.rub === 'prompts' && (
                    <Card>
                      <div className="space-y-0 divide-y divide-border">
                        <div className="pb-4">
                          <div className="flex items-baseline gap-2.5 mb-3">
                            <span className="w-[22px] h-[22px] rounded-[6px] bg-surface border border-border grid place-items-center text-xs font-bold text-text-secondary">1</span>
                            <h3 className="font-semibold text-[15px]">Décor</h3>
                          </div>
                          <PromptRows list={selected === 'coulissant' ? PROMPTS_DECOR_COULISSANT : PROMPTS_DECOR} />
                        </div>

                        <div className="py-4">
                          <div className="flex items-baseline gap-2.5 mb-3">
                            <span className="w-[22px] h-[22px] rounded-[6px] bg-surface border border-border grid place-items-center text-xs font-bold text-text-secondary">2</span>
                            <h3 className="font-semibold text-[15px]">Piliers &amp; murets</h3>
                          </div>
                          <PromptRows list={PROMPTS_PILIERS} />
                          <div className="mt-3">
                            <FieldLabel>Masquage de la sortie</FieldLabel>
                            <Seg
                              value={reglages?.masking ?? 'off'}
                              options={[
                                { value: 'off', label: 'Brut' },
                                { value: 'pixel-lock', label: 'Pixel-lock' },
                              ]}
                              onChange={(v) => setField('masking', v)}
                              disabled={!reglages}
                            />
                          </div>
                        </div>

                        <div className="py-4">
                          <div className="flex items-baseline gap-2.5 mb-3">
                            <span className="w-[22px] h-[22px] rounded-[6px] bg-surface border border-border grid place-items-center text-xs font-bold text-text-secondary">3</span>
                            <h3 className="font-semibold text-[15px]">
                              Intégration {PRODUIT_PAR_MOTEUR[selected]}
                            </h3>
                          </div>
                          <PromptRows list={promptsIntegration(PRODUIT_PAR_MOTEUR[selected])} />
                          <div className="flex flex-wrap gap-x-8 gap-y-4 mt-3">
                            <div>
                              <FieldLabel>Méthode</FieldLabel>
                              <Seg
                                value={reglages?.integrationMethod ?? 'simple'}
                                options={[
                                  // « Pose + fusion » (chantier 17/07/2026) : le code pose le produit
                                  // au pixel près, UN appel Nano fait stuc + lumière/ombres.
                                  { value: 'pose-fusion', label: 'Pose + fusion' },
                                  { value: 'simple', label: 'Simple' },
                                  // « Verrouillée » = ex-« rectangle » (renommage Mathias 13/07/2026) :
                                  // décor verrouillé au pixel autour du portail + contrôles.
                                  // « Pose directe » (archivée le 09/07) retirée du sélecteur le
                                  // 13/07 (décision Mathias) — toujours réactivable côté code,
                                  // cf. docs/ARCHIVE-methode-pose-directe.md.
                                  { value: 'rectangle', label: 'Verrouillée' },
                                ]}
                                onChange={(v) => setField('integrationMethod', v)}
                                disabled={!reglages}
                              />
                            </div>
                            {reglages?.integrationMethod === 'pose-fusion' && (
                              <>
                                <div>
                                  <FieldLabel>Débord sur les piliers</FieldLabel>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="number"
                                      min={0}
                                      max={10}
                                      step={0.1}
                                      value={reglages.poseDebordPct}
                                      onChange={(e) => setField('poseDebordPct', Number(e.target.value) || 0)}
                                      title="Débordement du produit sur chaque pilier, en % de la largeur"
                                      className="w-24 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                    />
                                    <span className="text-xs text-text-disabled">% par côté (2 % validé le 17/07)</span>
                                  </div>
                                </div>
                                <div>
                                  <FieldLabel>Seuil alpha du nettoyage</FieldLabel>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="number"
                                      min={1}
                                      max={255}
                                      value={reglages.poseSeuilAlpha}
                                      onChange={(e) => setField('poseSeuilAlpha', Number(e.target.value) || 0)}
                                      title="Alpha minimal conservé au nettoyage du PNG produit"
                                      className="w-24 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                    />
                                    <span className="text-xs text-text-disabled">1-255 · retire les pixels fantômes (200 validé)</span>
                                  </div>
                                </div>
                                {selected === 'coulissant' && (
                                  <div>
                                    <FieldLabel>Ombre du pilier sur la lame</FieldLabel>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        value={reglages.ombrePilierPct}
                                        onChange={(e) => setField('ombrePilierPct', Number(e.target.value) || 0)}
                                        title="Opacité maximale de l'ombre au contact du pilier droit — dégradé progressif sur toute la largeur du pilier, l'indice qui fait passer la lame DERRIÈRE"
                                        className="w-24 border border-border bg-white rounded-[8px] px-3 py-1.5 text-sm focus:outline-none focus:border-brand-green transition-colors"
                                      />
                                      <span className="text-xs text-text-disabled">% d&apos;opacité au contact · 0 = désactivée</span>
                                    </div>
                                    {/* Aperçu LIVE de la jonction (demande Mathias 28/07/2026) : lame,
                                        dégradé d'ombre très progressif sur 1,5 × la largeur du pilier
                                        (2ᵉ itération du 28/07) puis pilier — l'opacité suit la saisie. */}
                                    <div
                                      className="mt-2 relative w-[220px] h-[110px] rounded-[8px] border border-border overflow-hidden"
                                      style={{ background: '#dce9f2' }}
                                      title="Aperçu de la jonction lame / pilier droit"
                                    >
                                      <div className="absolute" style={{ left: 0, top: 14, width: 130, height: 82, background: '#3f4650' }}>
                                        <div style={{ position: 'absolute', top: '33%', left: 0, right: 0, height: 1, background: '#333a42' }} />
                                        <div style={{ position: 'absolute', top: '66%', left: 0, right: 0, height: 1, background: '#333a42' }} />
                                      </div>
                                      <div
                                        className="absolute"
                                        style={{
                                          left: 40,
                                          top: 14,
                                          width: 90,
                                          height: 82,
                                          background: `linear-gradient(to right, rgba(0,0,0,0), rgba(0,0,0,${Math.min(100, Math.max(0, reglages.ombrePilierPct)) / 100}))`,
                                        }}
                                      />
                                      <div className="absolute" style={{ left: 130, top: 0, width: 60, height: '100%', background: '#efefec', borderLeft: '1px solid #d8d8d4' }} />
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                            <div>
                              <FieldLabel>Ombres portées</FieldLabel>
                              <Seg
                                value={reglages?.shadows ?? 'auto'}
                                options={[
                                  { value: 'auto', label: 'Auto' },
                                  { value: 'off', label: 'Off' },
                                ]}
                                onChange={(v) => setField('shadows', v)}
                                disabled={!reglages}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="pt-4">
                          <div className="flex items-baseline gap-2.5 mb-3">
                            <span className="w-[22px] h-[22px] rounded-[6px] bg-surface border border-border grid place-items-center text-xs font-bold text-text-secondary">4</span>
                            <h3 className="font-semibold text-[15px]">Marketplace — carré 2000×2000</h3>
                          </div>
                          <div className="mb-3">
                            <FieldLabel>Déclinaison en MP</FieldLabel>
                            <Seg
                              value={reglages?.marketplace ?? 'choix'}
                              options={[
                                { value: 'choix', label: 'Au choix' },
                                { value: 'toujours', label: 'Toujours auto' },
                                { value: 'jamais', label: 'Jamais' },
                              ]}
                              onChange={(v) => setField('marketplace', v)}
                              disabled={!reglages}
                            />
                            <p className="text-xs text-text-secondary mt-1.5">
                              <b>Au choix</b> : case à cocher au lancement + bouton 1:1 sur le résultat.{' '}
                              <b>Toujours auto</b> : chaque MES Site est déclinée automatiquement.{' '}
                              <b>Jamais</b> : le MP disparaît de l&apos;interface et l&apos;API le refuse.
                            </p>
                          </div>
                          <PromptRows list={PROMPTS_MARKETPLACE} />
                          <p className="text-xs text-text-secondary mt-2.5">
                            Recadrage serré sur le {PRODUIT_PAR_MOTEUR[selected]} ; s&apos;il dépasse, les
                            bords sont étendus par outpainting natif de Nano Banana (prompt ci-dessus,
                            propre au moteur).
                          </p>
                        </div>
                      </div>
                    </Card>
                  )}

                  {/* ============ Export ============ */}
                  {sel.rub === 'export' && (
                    <Card>
                      <div className="flex flex-wrap gap-x-8 gap-y-4">
                        <div>
                          <FieldLabel>Site produit</FieldLabel>
                          <span className="inline-block bg-surface border border-border rounded-[8px] px-3 py-2 text-sm text-text-secondary">
                            2000 × 1330
                          </span>
                        </div>
                        <div>
                          <FieldLabel>Marketplace</FieldLabel>
                          <span className="inline-block bg-surface border border-border rounded-[8px] px-3 py-2 text-sm text-text-secondary">
                            2000 × 2000 ·{' '}
                            {reglages?.marketplace === 'jamais'
                              ? 'désactivé'
                              : reglages?.marketplace === 'toujours'
                                ? 'automatique'
                                : 'au choix au lancement'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-72">
                          <FieldLabel>Nom du livrable</FieldLabel>
                          <input
                            type="text"
                            value={reglages?.livraisonName ?? ''}
                            onChange={(e) => setField('livraisonName', e.target.value)}
                            disabled={!reglages}
                            title="Modèle de nom du livrable"
                            className="w-full border border-border bg-white rounded-[8px] px-3 py-2 text-sm font-mono focus:outline-none focus:border-brand-green transition-colors"
                          />
                        </div>
                      </div>
                    </Card>
                  )}

                  {/* Barre d'enregistrement des réglages du moteur — visible sous chaque
                      rubrique (les modifs d'une rubrique restent en attente quand on en
                      change ; les gabarits, eux, s'enregistrent tout seuls). */}
                  {sel.rub !== 'gabarits' && sel.rub !== 'gabarits-xl' && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={save}
                        disabled={busy || (!dirty && !dirtyXl) || !reglages}
                        className="bg-brand-green text-white text-sm font-bold rounded-[10px] px-5 py-2.5 hover:bg-brand-green-hover transition-colors disabled:opacity-50"
                      >
                        Enregistrer les réglages du moteur
                      </button>
                      {(dirty || dirtyXl) && (
                        <span className="text-xs text-brand-teal">Modifications non enregistrées.</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
