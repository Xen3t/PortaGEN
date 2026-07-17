import { describe, it, expect } from 'vitest'
import { sanitizeMoodboardName } from '@/lib/server/moodboards'

describe('moodboards — nettoyage des noms de fichiers', () => {
  it('retire l’extension et les caractères interdits Windows', () => {
    expect(sanitizeMoodboardName('Background 3 - VOGEL.jpg')).toBe('Background 3 - VOGEL')
    expect(sanitizeMoodboardName('a/b\\c:d*e?f"g<h>i|j.png')).toBe('a b c d e f g h i j')
  })

  it('refuse de produire un nom vide et borne la longueur', () => {
    expect(sanitizeMoodboardName('   .jpg')).toBe('')
    expect(sanitizeMoodboardName('x'.repeat(300)).length).toBeLessThanOrEqual(100)
  })

  it('neutralise toute tentative de sortie de dossier', () => {
    expect(sanitizeMoodboardName('../../secret')).not.toContain('/')
    expect(sanitizeMoodboardName('..\\..\\secret')).not.toContain('\\')
  })
})
