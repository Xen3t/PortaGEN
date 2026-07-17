import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db'

/**
 * Retours utilisateurs (13/07/2026, repris de HoorTRADS) : envoyés depuis le
 * bouton flottant « ? » en bas à droite de toutes les pages, consultés et
 * supprimés dans Admin → Feedback.
 */

export const FEEDBACK_CATEGORIES = ['bug', 'suggestion', 'question', 'general'] as const

export interface FeedbackRow {
  id: number
  user_id: number | null
  username: string | null
  category: string
  message: string
  page_url: string | null
  created_at: string
}

export function addFeedback(
  entry: {
    userId: number
    username: string
    category: string
    message: string
    pageUrl: string | null
  },
  db: Database.Database = getDb()
): void {
  db.prepare(
    `INSERT INTO feedback (user_id, username, category, message, page_url)
     VALUES (@userId, @username, @category, @message, @pageUrl)`
  ).run(entry)
}

export function listFeedback(limit = 200, db: Database.Database = getDb()): FeedbackRow[] {
  return db
    .prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT ?')
    .all(limit) as FeedbackRow[]
}

export function deleteFeedback(id: number, db: Database.Database = getDb()): boolean {
  return db.prepare('DELETE FROM feedback WHERE id = ?').run(id).changes > 0
}

export function deleteAllFeedback(db: Database.Database = getDb()): number {
  return db.prepare('DELETE FROM feedback').run().changes
}
