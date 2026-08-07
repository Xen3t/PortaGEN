'use client'

import { useEffect, useState } from 'react'

/**
 * Réglages GÉNÉRAUX de l'application — universels, donc À PART des moteurs
 * (demande Mathias 13/07/2026). Depuis l'« affichage complet » de la page
 * Admin → Réglages (maquette reglages-full-v1 validée le 29/07/2026), les
 * rubriques sont EMPILÉES en cartes, chacune avec son ancre (app-generations,
 * app-marquage, app-serveur) que les signets de l'arborescence rejoignent.
 * « Générations & modèle » regroupe les générations simultanées et le modèle
 * image. « Tarif Gemini » supprimée le 05/08/2026 avec le LAB (demande Mathias).
 */

export type AppRubrique = 'generations' | 'marquage' | 'serveur'

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary mt-6 mb-3 first:mt-0">
      {children}
    </h3>
  )
}

/**
 * Carte d'une rubrique de l'Application. `id`/`data-anchor` = cible des signets et
 * du scroll-spy de la page Réglages ; `scroll-mt` compense le bandeau collant.
 */
function AppCard({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      data-anchor={id}
      className="bg-white rounded-[12px] border border-border shadow-sm p-5 scroll-mt-[150px]"
    >
      <h3 className="text-[16px] font-bold leading-tight mb-4">{title}</h3>
      {children}
    </section>
  )
}

export default function ReglagesApp() {
  const [value, setValue] = useState<number | null>(null)
  const [bounds, setBounds] = useState({ min: 1, max: 20 })
  const [serverRoot, setServerRoot] = useState('')
  const [marquageIa, setMarquageIa] = useState<boolean | null>(null)
  // Modèle image global (28/07/2026) : Nano Banana Pro ou Nano Banana.
  const [imageModel, setImageModel] = useState<string | null>(null)
  const [imageModels, setImageModels] = useState<{ id: string; label: string }[]>([])
  // Modèles & exécution (07/08 soir) : vision descriptions, gabarit du prompt
  // vision, sas de calcul d'image, chaînes de préparation MES Contrainte.
  const [visionModel, setVisionModel] = useState('')
  const [visionTemplate, setVisionTemplate] = useState('')
  const [visionTemplateDefaut, setVisionTemplateDefaut] = useState('')
  const [sasImages, setSasImages] = useState<number | null>(null)
  const [sasBounds, setSasBounds] = useState({ min: 1, max: 8 })
  const [prepConcurrence, setPrepConcurrence] = useState<number | null>(null)
  const [prepBounds, setPrepBounds] = useState({ min: 1, max: 6 })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        setValue(d.concurrencyPerUser ?? 10)
        if (d.bounds) setBounds(d.bounds)
        if (d.serverRoot) setServerRoot(d.serverRoot)
        if (typeof d.marquageIa === 'boolean') setMarquageIa(d.marquageIa)
        if (d.imageModel) setImageModel(d.imageModel)
        if (d.imageModels) setImageModels(d.imageModels)
        if (typeof d.visionModel === 'string') setVisionModel(d.visionModel)
        setVisionTemplate(typeof d.visionTemplate === 'string' ? d.visionTemplate : '')
        if (typeof d.visionTemplateDefaut === 'string')
          setVisionTemplateDefaut(d.visionTemplateDefaut)
        if (typeof d.sasImages === 'number') setSasImages(d.sasImages)
        if (d.sasBounds) setSasBounds(d.sasBounds)
        if (typeof d.prepConcurrence === 'number') setPrepConcurrence(d.prepConcurrence)
        if (d.prepBounds) setPrepBounds(d.prepBounds)
      })
  }, [])

  /** Enregistrement générique d'un champ « Modèles & exécution ». */
  async function savePatch(patch: Record<string, unknown>, message: string) {
    setBusy(true)
    setNotice(null)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    setNotice(res.ok ? message : `Erreur : ${data?.error ?? res.status}`)
  }

  /** Bascule du marquage IA — enregistrée immédiatement (un seul bouton Oui/Non). */
  async function saveMarquageIa(next: boolean) {
    setMarquageIa(next)
    setBusy(true)
    setNotice(null)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marquageIa: next }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok) {
      setNotice(
        next
          ? 'Marquage IA activé — chaque nouvelle image générée portera la métadonnée IPTC.'
          : 'Marquage IA désactivé — les prochaines images sortiront sans la métadonnée IPTC.'
      )
    } else {
      setMarquageIa(!next)
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  /** Bascule du modèle image — enregistrée immédiatement (comme le marquage IA). */
  async function saveImageModel(next: string) {
    const previous = imageModel
    setImageModel(next)
    setBusy(true)
    setNotice(null)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageModel: next }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (res.ok) {
      const label = imageModels.find((m) => m.id === next)?.label ?? next
      setNotice(`Modèle image basculé sur ${label} — effet immédiat sur les prochaines générations.`)
    } else {
      setImageModel(previous)
      setNotice(`Erreur : ${data?.error ?? res.status}`)
    }
  }

  async function saveServerRoot() {
    setBusy(true)
    setNotice(null)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverRoot: serverRoot.trim() }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    setNotice(
      res.ok
        ? 'Racine du serveur enregistrée — le prochain scan du catalogue l’utilisera.'
        : `Erreur : ${data?.error ?? res.status}`
    )
  }

  async function save() {
    if (value === null) return
    setBusy(true)
    setNotice(null)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concurrencyPerUser: value }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    setNotice(
      res.ok
        ? `Enregistré — effet immédiat sur les prochains démarrages de jobs (${data.concurrencyPerUser} simultanés par utilisateur).`
        : `Erreur : ${data?.error ?? res.status}`
    )
  }

  return (
    <div className="space-y-5">
      {notice && (
        <div className="bg-brand-teal-light text-brand-teal text-sm rounded-[8px] px-4 py-3 flex justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="hover:opacity-70">✕</button>
        </div>
      )}

      <AppCard id="app-generations" title="Générations & modèle">
            <SubHeading>Générations simultanées par utilisateur</SubHeading>
            <p className="text-xs text-text-secondary mb-4">
              Nombre de jobs (décors, piliers, intégrations) qu&apos;un même utilisateur peut faire
              tourner en parallèle. Les jobs au-delà attendent en file et démarrent dès qu&apos;une
              place se libère. Changement pris en compte immédiatement, sans redémarrage.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={bounds.min}
                max={bounds.max}
                value={value ?? ''}
                onChange={(e) => setValue(Number(e.target.value))}
                title="Générations simultanées par utilisateur"
                className="w-24 border border-border bg-surface rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
              />
              <span className="text-xs text-text-disabled">
                entre {bounds.min} et {bounds.max}
              </span>
              <button
                onClick={save}
                disabled={busy || value === null || value < bounds.min || value > bounds.max}
                className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
              >
                Enregistrer
              </button>
            </div>

            <SubHeading>Modèle de génération d&apos;images</SubHeading>
            <p className="text-xs text-text-secondary mb-4">
              Modèle Gemini utilisé pour <strong>toutes</strong> les générations d&apos;images
              (décors, piliers, intégrations, marketplace). <strong>Nano Banana Pro</strong>{' '}
              (<span className="font-mono">gemini-3-pro-image</span>) : la meilleure qualité,
              le plus cher. <strong>Nano Banana</strong>{' '}
              (<span className="font-mono">gemini-3.1-flash-image</span>) : plus rapide et
              beaucoup moins cher, qualité en retrait. Prise en compte immédiate sur les
              prochaines générations — les jobs en cours terminent avec l&apos;ancien modèle.
            </p>
            <span className="inline-flex border border-border rounded-[8px] overflow-hidden bg-white">
              {imageModels.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={busy || imageModel === null}
                  onClick={() => imageModel !== m.id && saveImageModel(m.id)}
                  className={`px-3.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                    i > 0 ? 'border-l border-border' : ''
                  } ${
                    imageModel === m.id
                      ? 'bg-brand-green text-white font-bold'
                      : 'text-text-secondary hover:bg-surface'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </span>

            <SubHeading>Modèle vision — descriptions produit</SubHeading>
            <p className="text-xs text-text-secondary mb-3">
              Modèle Gemini qui rédige la description factuelle d&apos;un produit (bibliothèque
              des descriptions, MES Contrainte). Vide = défaut{' '}
              <span className="font-mono">gemini-pro-latest</span>. Vérifie qu&apos;un nom saisi
              existe vraiment (un modèle inconnu = erreur 404 à la première description).
            </p>
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <input
                type="text"
                value={visionModel}
                onChange={(e) => setVisionModel(e.target.value)}
                placeholder="gemini-pro-latest"
                maxLength={80}
                className="w-64 font-mono border border-border bg-surface rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
              />
              <button
                onClick={() =>
                  void savePatch(
                    { visionModel: visionModel.trim() },
                    'Modèle vision enregistré — effet sur les prochaines descriptions.'
                  )
                }
                disabled={busy}
                className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
              >
                Enregistrer
              </button>
            </div>

            <SubHeading>Gabarit du prompt vision</SubHeading>
            <p className="text-xs text-text-secondary mb-3">
              Consigne envoyée au modèle vision pour rédiger une description (structure
              STRUCTURE / FRAME / INFILL / HARDWARE). Vide = gabarit par défaut. Les
              descriptions déjà en bibliothèque ne bougent pas.
            </p>
            <textarea
              value={visionTemplate}
              onChange={(e) => setVisionTemplate(e.target.value)}
              placeholder={visionTemplateDefaut}
              rows={7}
              className="w-full font-mono text-[12px] border border-border bg-surface rounded-[8px] px-3 py-2 focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
            />
            <div className="flex items-center gap-3 mt-2 mb-2 flex-wrap">
              <button
                onClick={() =>
                  void savePatch(
                    { visionTemplate },
                    'Gabarit du prompt vision enregistré — effet sur les prochaines descriptions.'
                  )
                }
                disabled={busy}
                className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
              >
                Enregistrer
              </button>
              <button
                onClick={() => {
                  setVisionTemplate('')
                  void savePatch({ visionTemplate: '' }, 'Gabarit par défaut restauré.')
                }}
                disabled={busy}
                className="bg-white border border-border text-text-secondary rounded-[10px] px-4 py-2 text-sm font-bold hover:border-brand-green hover:text-brand-green transition-colors disabled:opacity-50"
              >
                Gabarit par défaut
              </button>
            </div>

            <SubHeading>Protection de la machine (calculs lourds)</SubHeading>
            <p className="text-xs text-text-secondary mb-3">
              Le serveur fait des calculs lourds (RALify, plan gris, recadrage final) pour
              TOUT le monde à la fois : tes préparations, mais aussi chaque génération qui
              revient de Nano. Ce plafond limite combien de ces calculs tournent en même
              temps — au-delà, ils patientent quelques secondes. C&apos;est ce qui empêche
              l&apos;interface de se figer pendant un gros lot. Effet immédiat.
            </p>
            <div className="flex items-center gap-3 mb-2">
              <input
                type="number"
                min={sasBounds.min}
                max={sasBounds.max}
                value={sasImages ?? ''}
                onChange={(e) => setSasImages(Number(e.target.value))}
                title="Calculs d'image simultanés"
                className="w-24 border border-border bg-surface rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
              />
              <span className="text-xs text-text-disabled">
                entre {sasBounds.min} et {sasBounds.max}
              </span>
              <button
                onClick={() => void savePatch({ sasImages }, 'Protection de la machine enregistrée.')}
                disabled={
                  busy || sasImages === null || sasImages < sasBounds.min || sasImages > sasBounds.max
                }
                className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
              >
                Enregistrer
              </button>
            </div>

            <SubHeading>Files d&apos;attente à l&apos;écran (MES Contrainte)</SubHeading>
            <p className="text-xs text-text-secondary mb-3">
              Quand tu déposes 10 images, combien de cases avancent EN MÊME TEMPS dans la
              chaîne détourage → RALify → description → pose — les autres attendent leur
              tour. Ne change que le rythme visible sur la page (les calculs lourds restent
              plafonnés par la protection ci-dessus). Pris en compte au prochain chargement
              de la page.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={prepBounds.min}
                max={prepBounds.max}
                value={prepConcurrence ?? ''}
                onChange={(e) => setPrepConcurrence(Number(e.target.value))}
                title="Images préparées de front"
                className="w-24 border border-border bg-surface rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
              />
              <span className="text-xs text-text-disabled">
                entre {prepBounds.min} et {prepBounds.max}
              </span>
              <button
                onClick={() =>
                  void savePatch({ prepConcurrence }, 'File d’attente à l’écran enregistrée.')
                }
                disabled={
                  busy ||
                  prepConcurrence === null ||
                  prepConcurrence < prepBounds.min ||
                  prepConcurrence > prepBounds.max
                }
                className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
              >
                Enregistrer
              </button>
            </div>
      </AppCard>

      <AppCard id="app-marquage" title="Marquage IA">
            <p className="text-xs text-text-secondary mb-4">
              Chaque image générée reçoit la métadonnée officielle des contenus créés par IA :{' '}
              <span className="font-mono">IPTC DigitalSourceType = trainedAlgorithmicMedia</span>.
              Invisible à l&apos;œil, elle est lue par Google et les plateformes. Un code déjà
              présent dans l&apos;image (ex. <span className="font-mono">compositeSynthetic</span>)
              est conservé tel quel, et les Content Credentials (C2PA) ne sont jamais retirés.
              S&apos;applique à toutes les images de l&apos;application, quel que soit le moteur.
            </p>
            <span className="inline-flex border border-border rounded-[8px] overflow-hidden bg-white">
              {[
                { v: true, label: 'Activé' },
                { v: false, label: 'Désactivé' },
              ].map((o, i) => (
                <button
                  key={o.label}
                  type="button"
                  disabled={busy || marquageIa === null}
                  onClick={() => marquageIa !== o.v && saveMarquageIa(o.v)}
                  className={`px-3.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                    i > 0 ? 'border-l border-border' : ''
                  } ${
                    marquageIa === o.v
                      ? 'bg-brand-green text-white font-bold'
                      : 'text-text-secondary hover:bg-surface'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </span>
      </AppCard>

      <AppCard id="app-serveur" title="Serveur de fichiers">
            <p className="text-xs text-text-secondary mb-4">
              Racine du serveur de l&apos;entreprise scannée par le catalogue. L&apos;application y
              accède <strong>en lecture seule</strong> : rien n&apos;est jamais écrit, modifié ou
              supprimé sur le serveur.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={serverRoot}
                onChange={(e) => setServerRoot(e.target.value)}
                placeholder="Chemin du serveur de fichiers"
                title="Racine du serveur de fichiers"
                className="flex-1 min-w-64 border border-border bg-surface rounded-[8px] px-3 py-2 text-sm font-mono focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
              />
              <button
                onClick={saveServerRoot}
                disabled={busy || !serverRoot.trim()}
                className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
              >
                Enregistrer
              </button>
            </div>
      </AppCard>
    </div>
  )
}
