'use client'

import { useEffect, useState } from 'react'

/**
 * Réglages GÉNÉRAUX de l'application (générations simultanées, tarif Gemini,
 * serveur de fichiers) — universels, donc À PART des moteurs (demande Mathias
 * 13/07/2026) : ils vivent en tête de la page Admin → Réglages, au-dessus de la
 * partie « Moteurs ». Anciennement page « Réglages généraux » (le Lab qui y
 * cohabitait est parti dans sa propre page Admin → LAB).
 */

/** Section repliable, même style que celles de la fiche moteur (fermée par défaut). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="bg-white rounded-[12px] border border-border shadow-sm">
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

export default function ReglagesApp() {
  const [value, setValue] = useState<number | null>(null)
  const [bounds, setBounds] = useState({ min: 1, max: 20 })
  const [priceIn, setPriceIn] = useState('')
  const [priceOut, setPriceOut] = useState('')
  const [serverRoot, setServerRoot] = useState('')
  const [marquageIa, setMarquageIa] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        setValue(d.concurrencyPerUser ?? 10)
        if (d.bounds) setBounds(d.bounds)
        if (d.pricing) {
          setPriceIn(d.pricing.inEurPerMTok > 0 ? String(d.pricing.inEurPerMTok) : '')
          setPriceOut(d.pricing.outEurPerMTok > 0 ? String(d.pricing.outEurPerMTok) : '')
        }
        if (d.serverRoot) setServerRoot(d.serverRoot)
        if (typeof d.marquageIa === 'boolean') setMarquageIa(d.marquageIa)
      })
  }, [])

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

  async function savePricing() {
    setBusy(true)
    setNotice(null)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        priceEurPerMTokIn: priceIn.trim() === '' ? 0 : Number(priceIn.replace(',', '.')),
        priceEurPerMTokOut: priceOut.trim() === '' ? 0 : Number(priceOut.replace(',', '.')),
      }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    setNotice(
      res.ok
        ? 'Tarif enregistré — le coût en € s’affiche désormais sur les essais du LAB.'
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

      <Section title="Générations simultanées par utilisateur">
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
      </Section>

      <Section title="Tarif Gemini (pour le coût en €)">
        <p className="text-xs text-text-secondary mb-4">
          Prix en euros <strong>par million de tokens</strong>, appliqué aux{' '}
          <strong>appels image</strong> uniquement (les appels texte coûtent des centièmes de
          centime). Sert au coût affiché sur chaque essai du LAB. Grille Google au 11/07/2026
          pour Gemini 3 Pro Image : 2&nbsp;$ en entrée et 120&nbsp;$ en sortie image le
          million, soit ≈ <strong>1,75&nbsp;€</strong> et <strong>105&nbsp;€</strong> au taux
          du jour (1&nbsp;$ ≈ 0,876&nbsp;€) — à réajuster si la grille ou le taux change.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="price-in" className="block text-xs font-medium text-text-secondary mb-1">
              Entrée (€ / M tokens)
            </label>
            <input
              id="price-in"
              type="text"
              inputMode="decimal"
              value={priceIn}
              onChange={(e) => setPriceIn(e.target.value)}
              placeholder="ex. 1,80"
              className="w-32 border border-border bg-surface rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
            />
          </div>
          <div>
            <label htmlFor="price-out" className="block text-xs font-medium text-text-secondary mb-1">
              Sortie (€ / M tokens)
            </label>
            <input
              id="price-out"
              type="text"
              inputMode="decimal"
              value={priceOut}
              onChange={(e) => setPriceOut(e.target.value)}
              placeholder="ex. 110"
              className="w-32 border border-border bg-surface rounded-[8px] px-3 py-2 text-sm focus:outline-none focus:border-brand-green focus:bg-white transition-colors"
            />
          </div>
          <button
            onClick={savePricing}
            disabled={busy}
            className="bg-brand-green text-white rounded-[10px] px-4 py-2 text-sm font-bold hover:bg-brand-green-hover transition-colors disabled:opacity-50"
          >
            Enregistrer
          </button>
        </div>
      </Section>

      <Section title="Marquage IA des images (métadonnées)">
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
      </Section>

      <Section title="Serveur de fichiers (catalogue)">
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
      </Section>
    </div>
  )
}
