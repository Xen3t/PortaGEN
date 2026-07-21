import { describe, it, expect } from 'vitest'
import { getDb, createJob, updateJob } from '@/lib/db'
import { listUserNotifications } from '@/lib/notifications'

describe('cloche — décors de la Bibliothèque (extension 20/07/2026)', () => {
  it('un décor terminé remonte avec source « decor » et son nom', () => {
    const db = getDb(':memory:')
    const jid = createJob(
      'decor',
      { slug: 'jardin-01', name: 'Jardin moderne', nameSuffix: ' · tirage 2' },
      db,
      undefined,
      'mathias'
    )
    updateJob(jid, { status: 'done', result: JSON.stringify({ kind: 'decor', decorId: 7 }) }, db)
    const notifs = listUserNotifications('mathias', db)
    expect(notifs).toHaveLength(1)
    expect(notifs[0]).toMatchObject({
      source: 'decor',
      productName: 'Jardin moderne · tirage 2',
      kind: 'ok',
      colorisList: [],
    })
  })

  it('un décor en échec remonte en erreur ; en cours = pas de notification', () => {
    const db = getDb(':memory:')
    const err = createJob('decor', { slug: 'x' }, db, undefined, 'mathias')
    updateJob(err, { status: 'error', error: 'boom' }, db)
    const run = createJob('decor', { slug: 'y' }, db, undefined, 'mathias')
    updateJob(run, { status: 'running' }, db)
    const notifs = listUserNotifications('mathias', db)
    expect(notifs).toHaveLength(1)
    expect(notifs[0]).toMatchObject({ source: 'decor', kind: 'error' })
  })

  it('les essais du Lab moteur et les décors des autres utilisateurs sont exclus', () => {
    const db = getDb(':memory:')
    const lab = createJob('decor', { slug: 'lab-essai', lab: true }, db, undefined, 'mathias')
    updateJob(lab, { status: 'done' }, db)
    const autre = createJob('decor', { slug: 'z' }, db, undefined, 'quelqu-un-d-autre')
    updateJob(autre, { status: 'done' }, db)
    expect(listUserNotifications('mathias', db)).toHaveLength(0)
  })
})
