'use client'

import { useEffect, useRef, useState } from 'react'
import GabaritsManager from '@/components/GabaritsManager'
import PromptEditor from '@/components/PromptEditor'
import ReglagesApp from '@/components/ReglagesApp'
import ResetApp from '@/components/ResetApp'
import type { MoteurKey, MoteurReglages } from '@/lib/moteurs'

/**
 * Admin → Réglages (réorganisation Mathias 13/07/2026) : l'ex-page « Réglages
 * par moteur » (maquette reglages-par-moteur-v9 validée le 13/07/2026, cadrage
 * docs/CADRAGE-MOTEURS-2026-07-12.md) devient LA page Réglages. Elle accueille
 * en tête les réglages GÉNÉRAUX de l'application (générations simultanées,
 * tarif Gemini, serveur de fichiers — universels, donc À PART des moteurs,
 * cf. <ReglagesApp />). Le Lab, qui cohabitait avec eux, a sa propre page
 * Admin → LAB.
 *
 * Un moteur par type de produit. La partie Moteurs regroupe TOUTES les
 * technologies du moteur : import & détourage, coloris, gabarits (ex-page
 * Gabarits absorbée ici), guidage CANNY, génération (prompts par étape),
 * livraison.
 *
 * Sélection du moteur : colonne latérale avec compteur, filtre et familles
 * (maquette reglages-par-moteur-v10 validée le 13/07/2026) — remplace les
 * onglets de la v9, illisibles au-delà de quelques moteurs.
 */

interface MoteurEntry {
  key: MoteurKey
  label: string
  /** Nom de code (ex. Battant = « JANUS », baptisé le 13/07/2026). */
  codeName?: string
  status: 'actif' | 'preparation'
  productCount: number
  /** Famille d'affichage de la colonne des moteurs (maquette v10, 13/07/2026). */
  famille: string
}

interface PromptMeta {
  name: string
  version: number
}

/**
 * Prompts d'UN moteur, rangés par étape de génération. Les noms sont les noms
 * de BASE (ceux du battant) : pour les autres moteurs ils sont préfixés au
 * rendu (« portillon-… ») et les libellés emploient le mot du produit
 * (« Intégration du portillon », pas « du portail »).
 */
const PROMPTS_DECOR: { name: string; label: string }[] = [
  { name: 'moodboard-llm', label: 'Analyse moodboard' },
  { name: 'decor-architecture', label: 'Architecture du décor' },
  { name: 'decor-couloir', label: 'Contrainte du couloir' },
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

/** Image CANNY active du moteur (personnalisée ou d'origine), servie par l'API. */
interface CannyInfo {
  custom: boolean
  relPath: string
  width: number | null
  height: number | null
  version: number
}

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

/**
 * Section repliable de la fiche moteur — FERMÉE par défaut, on déplie à la
 * demande (demande Mathias 13/07/2026). Le titre garde la barre verte + gras.
 */
function Section({
  title,
  action,
  children,
}: {
  title: React.ReactNode
  /** Élément à droite du titre (lien, bouton) — cliquable sans replier la section. */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="bg-white rounded-[12px] border border-border shadow-sm">
      {/* Le lien d'action se place AVANT le chevron (retour Mathias 13/07/2026) —
          le chevron reste toujours collé au bord droit, comme sur les autres sections. */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex-1 p-5 text-left group"
        >
          <h2 className="text-[17px] font-bold group-hover:text-brand-green transition-colors">
            {title}
          </h2>
        </button>
        {action}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Replier la section' : 'Déplier la section'}
          className={`text-text-secondary text-[11px] p-5 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        >
          ▼
        </button>
      </div>
      {open && <div className="px-5 pb-5">{children}</div>}
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
  // Filtre de la colonne des moteurs (maquette v10 : utile quand ils seront 20).
  const [query, setQuery] = useState('')
  const [reglages, setReglages] = useState<MoteurReglages | null>(null)
  const [dirty, setDirty] = useState(false)
  const [promptVersions, setPromptVersions] = useState<Record<string, number>>({})
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
  // Prompt dont l'éditeur est déroulé (un seul à la fois, replié par défaut).
  const [openPrompt, setOpenPrompt] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/moteurs')
      .then((r) => r.json())
      .then((d) => setMoteurs(d.moteurs ?? []))
    fetch('/api/prompts')
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, number> = {}
        for (const p of (d.prompts ?? []) as PromptMeta[]) map[p.name] = p.version
        setPromptVersions(map)
      })
    fetch('/api/coloris')
      .then((r) => r.json())
      .then((d) => setColoris(d.coloris ?? []))
  }, [])

  // Les réglages suivent l'onglet : chaque moteur a LES SIENS (règle 13/07/2026 —
  // jamais partagés). Changer d'onglet recharge et abandonne les modifs non enregistrées.
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

  /** Remplacement de l'image CANNY du moteur (fichier choisi via l'input caché). */
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
        `Image CANNY remplacée (${data.canny.width}×${data.canny.height}). Elle sert dès la prochaine génération.`
      )
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  async function resetCanny() {
    if (!window.confirm('Revenir à l’image CANNY d’origine ?')) return
    setCannyBusy(true)
    const res = await fetch(`/api/moteurs/${selected}/canny`, { method: 'DELETE' })
    const data = await res.json().catch(() => null)
    setCannyBusy(false)
    if (res.ok && data?.canny) {
      setCanny(data.canny)
      setNotice('Image CANNY d’origine rétablie.')
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
    const res = await fetch(`/api/moteurs/${selected}/reglages`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok && data?.reglages) {
      setReglages(data.reglages)
      setDirty(false)
      const m = moteurs.find((x) => x.key === selected)
      setNotice(`Réglages du moteur ${m?.label ?? selected} enregistrés.`)
    } else {
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  const current = moteurs.find((m) => m.key === selected)

  // Colonne des moteurs (maquette reglages-par-moteur-v10 validée le 13/07/2026) :
  // filtre par nom ou nom de code, puis regroupement par famille d'affichage.
  const q = query.trim().toLowerCase()
  const filtres = moteurs.filter(
    (m) =>
      !q ||
      m.label.toLowerCase().includes(q) ||
      (m.codeName ?? '').toLowerCase().includes(q)
  )
  const familles: { nom: string; moteurs: MoteurEntry[] }[] = []
  for (const m of filtres) {
    const f = familles.find((x) => x.nom === m.famille)
    if (f) f.moteurs.push(m)
    else familles.push({ nom: m.famille, moteurs: [m] })
  }
  const nbPrets = moteurs.filter((m) => m.status === 'actif').length
  const nbPrepa = moteurs.length - nbPrets

  /**
   * Ligne prompt : libellé, version réelle, et « Modifier » qui DÉROULE l'éditeur
   * sur place (contenu + historique des versions — demande Mathias 13/07/2026,
   * plus de page Prompt System séparée). Les prompts appartiennent AU moteur
   * (règle 13/07/2026) : battant garde les noms historiques, les autres moteurs
   * préfixent (« portillon-piliers-murets »). Un prompt que le moteur n'a pas
   * encore (ex. décor portillon) est « à venir ».
   */
  const PromptRows = ({ list }: { list: { name: string; label: string }[] }) => (
    <div className="space-y-1.5">
      {list.map((p) => {
        const name = selected === 'battant' ? p.name : `${selected}-${p.name}`
        const version = promptVersions[name]
        const open = openPrompt === name
        return (
          <div
            key={name}
            className={`border rounded-[8px] ${open ? 'border-brand-green' : 'border-border'}`}
          >
            <div className="flex items-center gap-2.5 px-3 py-2 text-sm">
              <span className="font-semibold">{p.label}</span>
              <span className="text-[11px] text-text-disabled font-mono">
                {version ? `v${version}` : '—'}
              </span>
              {version ? (
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
                onSaved={(n, v) => setPromptVersions((m) => ({ ...m, [n]: v }))}
              />
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold mb-6">Réglages</h1>

      {/* ============ Réglages généraux (toute l'application) ============ */}
      <h2 className="text-[15px] font-bold mb-1">Réglages généraux</h2>
      <p className="text-sm text-text-secondary mb-4">
        Valables pour toute l&apos;application, quel que soit le moteur.
      </p>
      <ReglagesApp />

      <div className="border-t border-border my-8" />

      {/* ============ Réglages par moteur ============ */}
      <h2 className="text-[15px] font-bold mb-1">Réglages par moteur</h2>
      <p className="text-sm text-text-secondary mb-5">
        Chaque type de produit a son moteur : ses gabarits, ses prompts et ses réglages.
        Les produits sont rattachés automatiquement à leur moteur.
      </p>

      {/*
        Colonne des moteurs + fiche du moteur sélectionné (maquette
        reglages-par-moteur-v10 validée le 13/07/2026) : les onglets de la v9 ne
        tiennent plus quand les moteurs se multiplient — la colonne offre le
        compteur, le filtre et le regroupement par famille.
      */}
      <div className="grid gap-6 items-start lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="bg-white rounded-[12px] border border-border shadow-sm p-3.5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-104px)] lg:overflow-y-auto">
          <p className="text-[11.5px] text-text-disabled px-1 mb-2.5">
            <b className="text-text-secondary font-semibold">
              {moteurs.length} moteur{moteurs.length > 1 ? 's' : ''}
            </b>
            {moteurs.length > 0 && (
              <>
                {' '}· {nbPrets} prêt{nbPrets > 1 ? 's' : ''} · {nbPrepa} en préparation
              </>
            )}
          </p>
          <label className="flex items-center gap-2 border border-border rounded-[8px] px-3 py-2 mb-2 focus-within:border-brand-green transition-colors">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="flex-none text-text-disabled"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrer les moteurs…"
              autoComplete="off"
              className="w-full text-sm bg-transparent focus:outline-none"
            />
          </label>
          {familles.map((f) => (
            <div key={f.nom}>
              <p className="text-[10.5px] font-bold uppercase tracking-wider text-text-disabled px-1 mt-3 mb-1.5">
                {f.nom}
              </p>
              {f.moteurs.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  aria-current={m.key === selected}
                  onClick={() => setSelected(m.key)}
                  className={`w-full flex items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-sm transition-colors ${
                    m.key === selected
                      ? 'bg-brand-green-light text-brand-green font-bold'
                      : 'text-text-primary font-semibold hover:bg-surface'
                  }`}
                >
                  <span className="flex-1 truncate">{m.label}</span>
                  {m.status === 'actif' ? (
                    <span
                      className={`text-[11px] tabular-nums whitespace-nowrap ${
                        m.key === selected ? 'text-brand-green' : 'text-text-disabled'
                      }`}
                    >
                      {m.productCount} produits
                    </span>
                  ) : (
                    <span className="text-[9.5px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 rounded-full px-2 py-px whitespace-nowrap">
                      prépa
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
          {filtres.length === 0 && (
            <p className="text-sm text-text-disabled text-center py-4">
              Aucun moteur ne correspond.
            </p>
          )}
        </aside>

        <div>
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
          {/* Nom complet du moteur — le nom de code est le baptême de chaque moteur. */}
          <div className="flex items-end justify-between gap-3 flex-wrap bg-white rounded-[12px] border border-border shadow-sm p-5">
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-0.5">
                Moteur
              </span>
              <h2 className="text-2xl font-bold leading-tight">
                {selected === 'portillon' ? 'Portillon' : `Portail ${current?.label ?? ''}`}
                {current?.codeName && (
                  <>
                    {' '}
                    <span className="text-brand-green">« {current.codeName} »</span>
                  </>
                )}
              </h2>
            </div>
            {current && (
              <span className="bg-brand-green-light text-brand-green text-xs font-bold rounded-full px-3.5 py-1.5">
                {current.productCount} produits rattachés
              </span>
            )}
          </div>

          {/* ============ Détection et détourage ============ */}
          <Section title="Détection et détourage">
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
          </Section>

          {/* ============ Gabarits (ex-page Admin → Gabarits, absorbée) ============ */}
          <Section title="Gabarits">
            <GabaritsManager moteur={selected} embedded />
          </Section>

          {/* ============ Canny ============ */}
          <Section title="Canny">
            <div className="flex flex-wrap gap-5 items-start">
              {/* Aperçu agrandi ×2,5 (retour Mathias 13/07/2026 : 160 px illisible). */}
              <figure className="w-[400px] max-w-full flex-none">
                {canny ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/artifacts?p=${encodeURIComponent(canny.relPath)}&v=${canny.version}`}
                    alt="CANNY trottoir de référence"
                    className="w-full rounded-[8px] border border-border bg-black"
                  />
                ) : (
                  <div className="w-full aspect-[2000/1330] rounded-[8px] border border-border bg-surface" />
                )}
                <figcaption className="text-[11px] text-text-disabled mt-1 text-center">
                  {canny
                    ? `Référence ${canny.width ?? '?'}×${canny.height ?? '?'} · ${
                        canny.custom ? 'personnalisée' : 'd’origine'
                      }`
                    : 'Chargement…'}
                </figcaption>
              </figure>
              <div className="flex flex-wrap gap-x-8 gap-y-4 flex-1 min-w-64">
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
          </Section>

          {/* ============ Prompt System ============ */}
          <Section title="Prompt System">
            <div className="space-y-0 divide-y divide-border">
              <div className="pb-4">
                <div className="flex items-baseline gap-2.5 mb-3">
                  <span className="w-[22px] h-[22px] rounded-[6px] bg-surface border border-border grid place-items-center text-xs font-bold text-text-secondary">1</span>
                  <h3 className="font-semibold text-[15px]">Décor</h3>
                </div>
                <PromptRows list={PROMPTS_DECOR} />
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
          </Section>

          {/* ============ Export ============ */}
          <Section title="Export">
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
          </Section>

          {/* Barre d'enregistrement des réglages du moteur */}
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={busy || !dirty || !reglages}
              className="bg-brand-green text-white text-sm font-bold rounded-[10px] px-5 py-2.5 hover:bg-brand-green-hover transition-colors disabled:opacity-50"
            >
              Enregistrer les réglages du moteur
            </button>
            {dirty && (
              <span className="text-xs text-brand-teal">Modifications non enregistrées.</span>
            )}
          </div>
        </div>
      )}
        </div>
      </div>

      {/* ============ Remise à zéro (maquette remise-a-zero-v2, validée le
          15/07/2026 — placée SOUS les moteurs à la demande de Mathias) ============ */}
      <div className="border-t border-border my-8" />
      <ResetApp />
    </div>
  )
}
