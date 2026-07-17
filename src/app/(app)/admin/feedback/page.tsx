'use client'

import { useEffect, useState } from 'react'

/**
 * Admin → Feedback : les retours envoyés depuis le bouton flottant « ? »
 * (13/07/2026, repris de HoorTRADS). Consultation, suppression un par un
 * ou en bloc.
 */

interface FeedbackItem {
  id: number
  username: string | null
  category: string
  message: string
  page_url: string | null
  created_at: string
}

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  bug: { label: 'Bug', color: 'bg-brand-red-light text-brand-red' },
  suggestion: { label: 'Suggestion', color: 'bg-brand-teal-light text-brand-teal' },
  question: { label: 'Question', color: 'bg-brand-green-light text-brand-green' },
  general: { label: 'Autre', color: 'bg-surface text-text-secondary' },
}

function formatDate(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AdminFeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [confirmClearAll, setConfirmClearAll] = useState(false)
  const [isClearingAll, setIsClearingAll] = useState(false)

  useEffect(() => {
    fetch('/api/feedback')
      .then((r) => r.json())
      .then((d) => setItems(d.feedback ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const deleteOne = async (id: number) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/feedback?id=${id}`, { method: 'DELETE' })
      if (res.ok) setItems((prev) => prev.filter((f) => f.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  const deleteAll = async () => {
    setIsClearingAll(true)
    try {
      const res = await fetch('/api/feedback?all=1', { method: 'DELETE' })
      if (res.ok) {
        setItems([])
        setConfirmClearAll(false)
      }
    } finally {
      setIsClearingAll(false)
    }
  }

  return (
    <div className="max-w-[800px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold mb-1">Feedback</h1>
          <p className="text-sm text-text-secondary">
            {items.length} retour{items.length > 1 ? 's' : ''} envoyé
            {items.length > 1 ? 's' : ''} depuis le bouton « ? » en bas des pages.
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={() => setConfirmClearAll(true)}
            className="text-xs text-text-disabled hover:text-brand-red transition-colors"
          >
            Tout supprimer
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-text-secondary text-sm text-center py-10">Chargement...</p>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-[12px] shadow-sm p-10 text-center">
          <p className="text-text-secondary text-sm">Aucun retour pour le moment.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((f) => {
            const cat = CATEGORY_LABELS[f.category] ?? CATEGORY_LABELS.general
            const isDeleting = deletingId === f.id
            return (
              <div
                key={f.id}
                className={`bg-white rounded-[12px] shadow-sm p-4 group ${isDeleting ? 'opacity-40' : ''}`}
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cat.color}`}>
                      {cat.label}
                    </span>
                    <span className="text-xs text-text-secondary truncate">
                      {f.username || 'Anonyme'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] text-text-disabled">{formatDate(f.created_at)}</span>
                    <button
                      onClick={() => deleteOne(f.id)}
                      disabled={isDeleting}
                      className="text-text-disabled hover:text-brand-red transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50"
                      title="Supprimer"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>
                <p className="text-sm text-text-primary whitespace-pre-wrap">{f.message}</p>
                {f.page_url && (
                  <p className="text-[10px] text-text-disabled font-mono mt-2">{f.page_url}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {confirmClearAll && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !isClearingAll && setConfirmClearAll(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-[16px] shadow-xl p-6 max-w-[420px] w-full mx-4"
          >
            <h3 className="text-base font-bold text-text-primary mb-2">
              Supprimer tous les retours ?
            </h3>
            <p className="text-sm text-text-secondary mb-6">
              Action irréversible. {items.length} retour{items.length > 1 ? 's' : ''} ser
              {items.length > 1 ? 'ont' : 'a'} effacé{items.length > 1 ? 's' : ''} définitivement.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmClearAll(false)}
                disabled={isClearingAll}
                className="px-4 py-2 rounded-[8px] text-sm font-semibold border border-border text-text-secondary hover:bg-surface transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={deleteAll}
                disabled={isClearingAll}
                className="px-4 py-2 rounded-[8px] text-sm font-semibold bg-brand-red text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isClearingAll ? 'Suppression...' : 'Tout supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
