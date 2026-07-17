import { describe, it, expect } from 'vitest'
import { getDb, createJob, updateJob } from '@/lib/db'
import { listProductGenerations } from '@/lib/catalogue/generations'

type Db = ReturnType<typeof getDb>

function pillars(db: Db, productId: number, coloris: string, w: number, h: number, format: string) {
  return createJob('pillars', { catalogProductId: productId, coloris, size: { w, h }, format }, db, 'b1', 'u')
}
function integration(db: Db, productId: number, coloris: string, w: number, h: number, format: string) {
  return createJob(
    'integration',
    { catalogProductId: productId, coloris, size: { w, h }, format },
    db,
    'b1',
    'u'
  )
}

describe('générations locales d’une page produit (bloc 3.1)', () => {
  it('renvoie une liste vide sans job rattaché', () => {
    const db = getDb(':memory:')
    expect(listProductGenerations(5, db)).toEqual([])
  })

  it('remonte une génération en cours (piliers), sans image de livraison', () => {
    const db = getDb(':memory:')
    const jid = pillars(db, 5, 'GRIS', 300, 120, '2000x1330')
    updateJob(jid, { status: 'running' }, db)
    const gens = listProductGenerations(5, db)
    expect(gens).toHaveLength(1)
    expect(gens[0]).toMatchObject({
      size: '300x120',
      coloris: 'GRIS',
      format: '2000x1330',
      stage: 'pillars',
      status: 'running',
      deliveryPath: null,
    })
  })

  it('l’intégration (id plus grand) prime sur les piliers de la même case', () => {
    const db = getDb(':memory:')
    const pid = pillars(db, 5, 'GRIS', 300, 120, '2000x1330')
    updateJob(pid, { status: 'done' }, db)
    const iid = integration(db, 5, 'GRIS', 300, 120, '2000x1330')
    updateJob(iid, { status: 'running' }, db)
    const gens = listProductGenerations(5, db)
    expect(gens).toHaveLength(1)
    expect(gens[0]).toMatchObject({ stage: 'integration', status: 'running', deliveryPath: null })
  })

  it('expose le chemin de livraison quand l’intégration est terminée', () => {
    const db = getDb(':memory:')
    pillars(db, 5, 'GRIS', 300, 120, '2000x1330')
    const iid = integration(db, 5, 'GRIS', 300, 120, '2000x1330')
    updateJob(
      iid,
      { status: 'done', result: JSON.stringify({ deliveryPath: 'data/artifacts/x/livraison.jpg' }) },
      db
    )
    const gens = listProductGenerations(5, db)
    expect(gens[0]).toMatchObject({
      stage: 'integration',
      status: 'done',
      deliveryPath: 'data/artifacts/x/livraison.jpg',
    })
  })

  it('sépare les cases (coloris × taille × format) et ignore les autres produits', () => {
    const db = getDb(':memory:')
    pillars(db, 5, 'GRIS', 300, 120, '2000x1330')
    pillars(db, 5, 'BLANC', 300, 120, '2000x1330')
    pillars(db, 5, 'GRIS', 350, 120, '2000x1330')
    pillars(db, 99, 'GRIS', 300, 120, '2000x1330') // autre produit
    const gens = listProductGenerations(5, db)
    expect(gens).toHaveLength(3)
  })

  it('ignore les jobs sans rattachement catalogue (lancements « Créer »)', () => {
    const db = getDb(':memory:')
    createJob('pillars', { size: { w: 300, h: 120 } }, db, 'b0', 'u') // pas de catalogProductId
    expect(listProductGenerations(5, db)).toEqual([])
  })

  it('une relance (id plus grand) écrase l’état précédent de la case', () => {
    const db = getDb(':memory:')
    const iid = integration(db, 5, 'GRIS', 300, 120, '2000x1330')
    updateJob(iid, { status: 'error', error: 'boom' }, db)
    // Réessai : nouveau job piliers, id supérieur → l’état bascule sur « en cours ».
    const pid = pillars(db, 5, 'GRIS', 300, 120, '2000x1330')
    updateJob(pid, { status: 'running' }, db)
    const gens = listProductGenerations(5, db)
    expect(gens).toHaveLength(1)
    expect(gens[0]).toMatchObject({ stage: 'pillars', status: 'running' })
  })
})
