import type { JobRow } from '@/lib/db'

/** Forme JSON des jobs exposée à l'interface (payload/result déjà parsés). */
export function serializeJob(job: JobRow) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    payload: job.payload ? JSON.parse(job.payload) : null,
    result: job.result ? JSON.parse(job.result) : null,
    error: job.error,
    regenCount: job.regen_count,
    reviewStatus: job.review_status,
    reviewedAt: job.reviewed_at,
    batchId: job.batch_id,
    createdBy: job.created_by,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  }
}
