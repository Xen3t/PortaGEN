import { describe, it, expect } from 'vitest'
import { colorisPromptDescription } from '@/lib/pipeline/poseFusion'

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
