import { describe, it, expect } from 'vitest'
import { getDb } from '@/lib/db'
import {
  addColoris,
  colorisDefAll,
  listAllColoris,
  listCustomColoris,
  removeColoris,
} from '@/lib/catalogue/colorisStore'
import { saveColorisOverride } from '@/lib/catalogue/colorisOverride'

describe('palette de coloris extensible (admin, 13/07/2026)', () => {
  it('sert la palette d’origine quand rien n’a été ajouté', () => {
    const db = getDb(':memory:')
    const all = listAllColoris(db)
    expect(all.map((c) => c.key)).toEqual(['gris', 'blanc', 'noir', 'teck'])
    expect(all.every((c) => !c.custom)).toBe(true)
  })

  it('ajoute un coloris (clé sans accents), le retrouve et le supprime', () => {
    const db = getDb(':memory:')
    const res = addColoris({ label: 'Vert Forêt', ral: 'RAL 6009', swatch: '#31372B' }, db)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.coloris.key).toBe('vert-foret')
    expect(res.coloris.swatch).toBe('#31372b')
    expect(colorisDefAll('vert forêt', db)?.custom).toBe(true)
    expect(listAllColoris(db)).toHaveLength(5)

    const del = removeColoris('vert-foret', db)
    expect(del.ok).toBe(true)
    expect(listCustomColoris(db)).toHaveLength(0)
  })

  it('refuse les doublons, les pastilles invalides et la suppression des coloris d’origine', () => {
    const db = getDb(':memory:')
    expect(addColoris({ label: 'Gris', swatch: '#123456' }, db).ok).toBe(false)
    expect(addColoris({ label: 'Beige', swatch: 'beige' }, db).ok).toBe(false)
    expect(addColoris({ label: '   ', swatch: '#123456' }, db).ok).toBe(false)
    expect(removeColoris('gris', db).ok).toBe(false)
    expect(removeColoris('inconnu', db).ok).toBe(false)
  })

  it('accepte une correction de fiche produit vers un coloris ajouté', () => {
    const db = getDb(':memory:')
    const productId = Number(
      db
        .prepare(
          `INSERT INTO catalog_products (brand, family, name, server_path, summary)
           VALUES ('VOGEL', 'PORTAIL BATTANT', 'TEST', '/srv/test', '{}')`
        )
        .run().lastInsertRowid
    )
    addColoris({ label: 'Beige', ral: 'RAL 1015', swatch: '#d8c9a3' }, db)
    expect(saveColorisOverride(productId, 'non précisé', 'beige', db)).toBe('Beige')
    expect(() => saveColorisOverride(productId, 'non précisé', 'violet', db)).toThrow()
  })
})
