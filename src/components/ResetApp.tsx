'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Remise à zéro de l'application (maquette remise-a-zero-v2 validée le
 * 15/07/2026) : section en BAS de la page Admin → Réglages, sous les moteurs.
 * Efface tout ce que l'app a produit (MES, décors, détourages, catalogue,
 * historique) après une sauvegarde complète base + images dans
 * data/sauvegardes/. L'installation (comptes, prompts, gabarits, réglages)
 * n'est pas touchée.
 */

/** Poids lisible en français (« 1,5 Go », « 320 Mo »). */
function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1).replace('.', ',')} Go`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} Mo`
  return `${Math.max(1, Math.round(bytes / 1e3))} Ko`
}

const STEPS = [
  'Sauvegarde de la base',
  'Copie des images',
  'Suppression des données générées',
  'Suppression des images',
]

export default function ResetApp() {
  const [open, setOpen] = useState(false)
  const [bytes, setBytes] = useState<number | null>(null)
  const [modal, setModal] = useState<'off' | 'confirm' | 'progress'>('off')
  const [step, setStep] = useState(1)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetch('/api/reset')
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.bytes === 'number') setBytes(d.bytes)
        // Remise à zéro déjà en cours (lancée d'un autre onglet ou avant un
        // rechargement de la page) : on raccroche la fenêtre de progression.
        if (d.status?.running) {
          setModal('progress')
          startPolling()
        }
      })
    return stopPolling
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }

  function startPolling() {
    stopPolling()
    pollRef.current = setInterval(async () => {
      const d = await fetch('/api/reset')
        .then((r) => r.json())
        .catch(() => null)
      if (!d?.status) return
      if (d.status.running) {
        setStep(d.status.step)
      } else {
        // Fin détectée par le sondage (cas « raccroché » : pas de POST à nous).
        stopPolling()
        setModal('off')
        if (typeof d.bytes === 'number') setBytes(d.bytes)
        setNotice(
          d.status.error
            ? { kind: 'error', text: `Erreur : ${d.status.error}` }
            : {
                kind: 'ok',
                text: `Remise à zéro terminée — l'application est comme neuve. Sauvegarde complète dans ${d.status.backupDir}/.`,
              }
        )
      }
    }, 800)
  }

  async function run() {
    setNotice(null)
    setModal('progress')
    setStep(1)
    startPolling()
    const res = await fetch('/api/reset', { method: 'POST' })
    const data = await res.json().catch(() => null)
    stopPolling()
    setModal('off')
    if (res.ok && data?.status) {
      setBytes(0)
      setNotice({
        kind: 'ok',
        text: `Remise à zéro terminée — l'application est comme neuve. Sauvegarde complète dans ${data.status.backupDir}/.`,
      })
    } else {
      setNotice({ kind: 'error', text: `Erreur : ${data?.error ?? res.status}` })
    }
  }

  const poids = bytes !== null && bytes > 0 ? formatBytes(bytes) : null

  return (
    <>
      {notice && (
        <div
          className={`text-sm rounded-[8px] px-4 py-3 mb-5 flex justify-between gap-3 ${
            notice.kind === 'ok'
              ? 'bg-brand-teal-light text-brand-teal'
              : 'bg-brand-red-light text-brand-red'
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="hover:opacity-70">✕</button>
        </div>
      )}

      <section className="bg-white rounded-[12px] border border-border shadow-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex-1 p-5 text-left group"
          >
            <h2 className="text-[17px] font-bold text-brand-red group-hover:opacity-80 transition-opacity">
              Remise à zéro de l&apos;application
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
        {open && (
          <div className="px-5 pb-5">
            <p className="text-xs text-text-secondary mb-4">
              Efface tout ce que l&apos;application a produit et la remet comme au premier jour.
              L&apos;installation (comptes, prompts, gabarits, réglages) n&apos;est pas touchée.
            </p>

            <div className="grid gap-4 sm:grid-cols-2 mb-4">
              <div className="border border-border rounded-[8px] p-4">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-brand-red mb-2">
                  Sera effacé
                </h3>
                <ul className="text-[13.5px] space-y-1">
                  {[
                    ['Toutes les MES générées', poids ? `· ${poids} d’images` : null],
                    ['Les sessions de génération de l’Accueil', null],
                    ['L’historique des jobs et des appels API', '· stats de coûts'],
                    ['Tous les décors de la bibliothèque', '· versions et favoris compris'],
                    ['Tous les détourages PNG', null],
                    ['Le catalogue scanné', '· re-scannable à tout moment'],
                  ].map(([label, small]) => (
                    <li key={label as string} className="relative pl-5">
                      <span className="absolute left-0 top-px text-brand-red font-bold text-[11px]">✕</span>
                      {label}
                      {small && <small className="text-text-disabled"> {small}</small>}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="border border-border rounded-[8px] p-4">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-brand-green mb-2">
                  Sera conservé
                </h3>
                <ul className="text-[13.5px] space-y-1">
                  {[
                    ['Les comptes utilisateurs et leurs rôles', null],
                    ['Les prompts', '· toutes versions'],
                    ['Les gabarits et images Canny', null],
                    ['Les réglages', '· généraux et par moteur'],
                    ['La palette de coloris', null],
                    ['Les retours utilisateurs (Feedback)', null],
                  ].map(([label, small]) => (
                    <li key={label as string} className="relative pl-5">
                      <span className="absolute left-0 top-px text-brand-green font-bold text-xs">✓</span>
                      {label}
                      {small && <small className="text-text-disabled"> {small}</small>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex gap-2.5 items-start bg-brand-teal-light text-brand-teal rounded-[8px] px-3.5 py-2.5 text-[13px] mb-4">
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="flex-none mt-0.5"
              >
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              <span>
                <b>Sauvegarde automatique avant d&apos;effacer</b> : la base et toutes les images
                sont copiées dans <code className="font-mono text-xs">data/sauvegardes/</code> avec
                la date. Rien n&apos;est perdu définitivement.
              </span>
            </div>

            <button
              type="button"
              onClick={() => setModal('confirm')}
              disabled={modal !== 'off'}
              className="bg-brand-red text-white text-sm font-bold rounded-[10px] px-5 py-2.5 hover:bg-[#c23543] transition-colors disabled:opacity-50"
            >
              Remettre à zéro…
            </button>
          </div>
        )}
      </section>

      {modal !== 'off' && (
        <div
          className="fixed inset-0 bg-[rgba(31,41,55,0.45)] z-50 flex items-center justify-center p-6"
          onClick={(e) => {
            // Fermeture au clic sur le fond — uniquement tant qu'on n'a pas lancé.
            if (e.target === e.currentTarget && modal === 'confirm') setModal('off')
          }}
        >
          <div className="bg-white rounded-[12px] shadow-lg w-[520px] max-w-full p-6">
            {modal === 'confirm' ? (
              <>
                <h2 className="text-lg font-bold mb-2.5">Remettre l&apos;application à zéro ?</h2>
                <p className="text-[13.5px] text-text-secondary mb-3">
                  <b className="text-text-primary">
                    Toutes les MES, tous les décors, tous les détourages et le catalogue
                  </b>{' '}
                  vont être effacés, ainsi que tout l&apos;historique de génération. Les comptes,
                  prompts, gabarits et réglages sont conservés.
                </p>
                <p className="text-[13.5px] text-text-secondary">
                  Une sauvegarde complète (base{poids ? ` + ${poids} d’images` : ' + images'}) sera
                  d&apos;abord créée dans <b className="text-text-primary">data/sauvegardes/</b> —
                  l&apos;opération peut prendre une à deux minutes.
                </p>
                <div className="flex justify-end gap-2.5 mt-5">
                  <button
                    type="button"
                    onClick={() => setModal('off')}
                    className="bg-white border border-border text-text-secondary text-sm font-bold rounded-[10px] px-4 py-2 hover:bg-surface transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={run}
                    className="bg-brand-red text-white text-sm font-bold rounded-[10px] px-4 py-2 hover:bg-[#c23543] transition-colors"
                  >
                    Sauvegarder puis tout effacer
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold mb-3">Remise à zéro en cours…</h2>
                {STEPS.map((label, i) => {
                  const n = i + 1
                  const state = n < step ? 'done' : n === step ? 'doing' : 'todo'
                  return (
                    <div
                      key={label}
                      className={`flex items-center gap-2.5 py-1.5 text-[13.5px] ${
                        state === 'doing'
                          ? 'text-text-primary font-semibold'
                          : state === 'done'
                            ? 'text-text-secondary'
                            : 'text-text-disabled'
                      }`}
                    >
                      <span className="w-5 h-5 flex-none grid place-items-center">
                        {state === 'done' ? (
                          <span className="text-brand-green font-bold">✓</span>
                        ) : state === 'doing' ? (
                          <span className="w-3.5 h-3.5 border-2 border-border border-t-brand-green rounded-full animate-spin" />
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-border" />
                        )}
                      </span>
                      {label}
                      {n === 2 && poids ? (
                        <small className="text-text-disabled">({poids})</small>
                      ) : null}
                    </div>
                  )
                })}
                <p className="text-xs text-text-secondary mt-3.5">
                  Ne pas fermer cette fenêtre pendant l&apos;opération.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
