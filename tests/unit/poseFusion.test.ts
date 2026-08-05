import { describe, it, expect } from 'vitest'
import { appliquerSectionsPieds, colorisPromptDescription } from '@/lib/pipeline/poseFusion'

describe('colorisPromptDescription', () => {
  it('traduit la palette CASANOOV en description prompt (clé, libellé ou RAL)', () => {
    expect(colorisPromptDescription('Gris')).toContain('RAL 7016')
    expect(colorisPromptDescription('anthracite')).toContain('RAL 7016')
    expect(colorisPromptDescription('7016')).toContain('RAL 7016')
    expect(colorisPromptDescription('Noir')).toContain('RAL 9005')
    expect(colorisPromptDescription('9005')).toContain('RAL 9005')
    expect(colorisPromptDescription('Blanc')).toContain('white')
    expect(colorisPromptDescription('Teck')).toContain('teak')
    expect(colorisPromptDescription('BOIS')).toContain('teak')
  })

  it('coloris absent ou inconnu → formulation neutre (le produit posé fait foi)', () => {
    for (const c of [undefined, '', 'Beige', 'RAL 6005']) {
      expect(colorisPromptDescription(c)).toBe(
        'exactly the colour and finish visible on the pasted gate'
      )
    }
  })
})

describe('appliquerSectionsPieds', () => {
  const prompt = 'avant\n[PIEDS]\nbloc pieds\n[/PIEDS]\n[SANS-PIEDS]\nbloc sans pieds\n[/SANS-PIEDS]\naprès'

  it('produit avec pieds : garde [PIEDS], retire [SANS-PIEDS] et tous les marqueurs', () => {
    const r = appliquerSectionsPieds(prompt, true)
    expect(r).toBe('avant\nbloc pieds\naprès')
  })

  it('produit sans pieds : garde [SANS-PIEDS], retire [PIEDS]', () => {
    const r = appliquerSectionsPieds(prompt, false)
    expect(r).toBe('avant\nbloc sans pieds\naprès')
  })

  it('marqueurs en ligne (au milieu d’une phrase)', () => {
    const inline = 'the gate, [PIEDS]its feet, [/PIEDS]hinges and pillars.'
    expect(appliquerSectionsPieds(inline, true)).toBe('the gate, its feet, hinges and pillars.')
    expect(appliquerSectionsPieds(inline, false)).toBe('the gate, hinges and pillars.')
  })

  it('prompt sans marqueur (portillon, versions antérieures) : inchangé', () => {
    const sans = 'un prompt ordinaire\nsur deux lignes'
    expect(appliquerSectionsPieds(sans, true)).toBe(sans)
    expect(appliquerSectionsPieds(sans, false)).toBe(sans)
  })

  it('la v3 seedée produit deux variantes valides sans marqueur résiduel', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const v3 = fs.readFileSync('Prompt System/Prompt Pose Fusion.txt', 'utf8')
    const avec = appliquerSectionsPieds(v3, true)
    const sans = appliquerSectionsPieds(v3, false)
    expect(avec).toContain('SUPPORT FEET AND GROUND HARDWARE')
    expect(avec).not.toContain('NO SUPPORT FEET')
    expect(sans).toContain('NO SUPPORT FEET')
    expect(sans).not.toContain('SUPPORT FEET AND GROUND HARDWARE')
    for (const variante of [avec, sans]) {
      expect(variante).not.toContain('[PIEDS]')
      expect(variante).not.toContain('[/PIEDS]')
      expect(variante).not.toContain('[SANS-PIEDS]')
      expect(variante).not.toContain('[/SANS-PIEDS]')
    }
  })
})
