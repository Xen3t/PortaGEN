import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDb, createJob } from '@/lib/db'
import { generatedBytes, runReset } from '@/lib/server/reset'
import type Database from 'better-sqlite3'

/**
 * Remise à zéro de l'application : tout sur des dossiers et une base jetables
 * (deps de runReset) — jamais sur data/ du projet.
 */

let tmp: string
let db: Database.Database

function seed(db: Database.Database) {
  // Données « produites par l'app » → doivent disparaître.
  createJob('integration', { any: 1 }, db, 'batch-1', 'mathias')
  db.prepare(
    `INSERT INTO api_calls (provider, model, kind, ok) VALUES ('gemini', 'test', 'image', 1)`
  ).run()
  db.prepare(`INSERT INTO generation_sessions (batch_id, produit) VALUES ('batch-1', 'VOGEL')`).run()
  const decor = db
    .prepare(`INSERT INTO decors (file_path, name, slug) VALUES ('artifacts/decor/x.png', 'X', 'x')`)
    .run()
  db.prepare(`INSERT INTO decor_tags (decor_id, tag) VALUES (?, 'moderne')`).run(decor.lastInsertRowid)
  db.prepare(
    `INSERT INTO decor_versions (decor_id, version, file_path) VALUES (?, 1, 'artifacts/decor/x.png')`
  ).run(decor.lastInsertRowid)
  const user = db.prepare(`SELECT id FROM users LIMIT 1`).get() as { id: number }
  db.prepare(`INSERT INTO decor_favorites (user_id, decor_id) VALUES (?, ?)`).run(
    user.id,
    decor.lastInsertRowid
  )
  const prod = db
    .prepare(
      `INSERT INTO catalog_products (brand, family, name, server_path, summary) VALUES ('casanoov', 'ALU', 'VOGEL', '/srv/VOGEL', '{}')`
    )
    .run()
  db.prepare(
    `INSERT INTO catalog_coloris_settings (product_id, coloris, settings) VALUES (?, 'gris', '{}')`
  ).run(prod.lastInsertRowid)
  db.prepare(
    `INSERT INTO detourages (product_id, coloris, size_label, png_path) VALUES (?, 'gris', '300x140', 'data/detourage/1/g.png')`
  ).run(prod.lastInsertRowid)
  // Installation → doit rester.
  db.prepare(`INSERT INTO size_params (label, params) VALUES ('300x140', '{}')`).run()
  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('k', 'v')`).run()
  db.prepare(`INSERT INTO feedback (username, message) VALUES ('mathias', 'super')`).run()
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portagen-reset-'))
  for (const d of ['artifacts/integration/vogel', 'generation/batch-1', 'detourage/1', 'cache']) {
    fs.mkdirSync(path.join(tmp, 'data', d), { recursive: true })
  }
  fs.writeFileSync(path.join(tmp, 'data', 'artifacts', 'integration', 'vogel', 'mes.png'), 'PNG-MES')
  fs.writeFileSync(path.join(tmp, 'data', 'generation', 'batch-1', 'out.png'), 'PNG-OUT')
  fs.writeFileSync(path.join(tmp, 'data', 'detourage', '1', 'g.png'), 'PNG-DET')
  fs.writeFileSync(path.join(tmp, 'data', 'cache', 'thumb.webp'), 'WEBP')
  // Fichier de l'installation, hors des dossiers générés : ne doit pas bouger.
  fs.mkdirSync(path.join(tmp, 'data', 'moteurs', 'battant'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'data', 'moteurs', 'battant', 'canny-ref.png'), 'CANNY')
  db = getDb(path.join(tmp, 'data', 'test.db'))
  seed(db)
})

afterEach(() => {
  db.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('generatedBytes', () => {
  it('compte uniquement les dossiers générés', () => {
    // mes.png + out.png + g.png = 21 octets ; cache et moteurs exclus.
    expect(generatedBytes(path.join(tmp, 'data'))).toBe(21)
  })
})

describe('runReset', () => {
  const deps = () => ({ db, dataDir: path.join(tmp, 'data'), rootDir: tmp })

  it('refuse tant que des générations tournent', async () => {
    db.prepare(`UPDATE jobs SET status = 'running'`).run()
    const res = await runReset(deps())
    expect(res.error).toContain('en cours')
    // Rien n'a été touché.
    expect((db.prepare(`SELECT COUNT(*) AS n FROM decors`).get() as { n: number }).n).toBe(1)
    expect(fs.existsSync(path.join(tmp, 'data', 'artifacts', 'integration', 'vogel', 'mes.png'))).toBe(true)
  })

  it('sauvegarde puis efface le généré et conserve l’installation', async () => {
    db.prepare(`UPDATE jobs SET status = 'done'`).run()
    const res = await runReset(deps())
    expect(res.error).toBeNull()
    expect(res.running).toBe(false)
    expect(res.backupDir).toMatch(/^data\/sauvegardes\//)

    // Sauvegarde : base + images copiées avant suppression.
    const backup = path.join(tmp, res.backupDir!)
    expect(fs.existsSync(path.join(backup, 'portagen.db'))).toBe(true)
    expect(fs.readFileSync(path.join(backup, 'artifacts', 'integration', 'vogel', 'mes.png'), 'utf8')).toBe('PNG-MES')
    expect(fs.existsSync(path.join(backup, 'generation', 'batch-1', 'out.png'))).toBe(true)
    expect(fs.existsSync(path.join(backup, 'detourage', '1', 'g.png'))).toBe(true)

    // La base sauvegardée contient encore les données d'avant.
    const BetterSqlite3 = (await import('better-sqlite3')).default
    const saved = new BetterSqlite3(path.join(backup, 'portagen.db'), { readonly: true })
    expect((saved.prepare(`SELECT COUNT(*) AS n FROM jobs`).get() as { n: number }).n).toBe(1)
    saved.close()

    // Tables générées vidées.
    for (const t of [
      'jobs', 'api_calls', 'generation_sessions', 'decors', 'decor_tags',
      'decor_versions', 'decor_favorites', 'detourages', 'catalog_products',
      'catalog_coloris_settings',
    ]) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, t).toBe(0)
    }
    // Installation conservée.
    expect((db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n).toBeGreaterThan(0)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM prompts`).get() as { n: number }).n).toBeGreaterThan(0)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM sizes`).get() as { n: number }).n).toBeGreaterThan(0)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM size_params`).get() as { n: number }).n).toBe(1)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM app_settings`).get() as { n: number }).n).toBe(1)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM feedback`).get() as { n: number }).n).toBe(1)

    // Dossiers générés recréés vides ; cache vidé ; installation intacte.
    for (const d of ['artifacts', 'generation', 'detourage', 'cache']) {
      const p = path.join(tmp, 'data', d)
      expect(fs.existsSync(p), d).toBe(true)
      expect(fs.readdirSync(p), d).toHaveLength(0)
    }
    expect(fs.readFileSync(path.join(tmp, 'data', 'moteurs', 'battant', 'canny-ref.png'), 'utf8')).toBe('CANNY')
    expect(generatedBytes(path.join(tmp, 'data'))).toBe(0)
  })
})
