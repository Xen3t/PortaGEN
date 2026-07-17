import { describe, it, expect } from 'vitest'
import { classifyView, isUsableFace } from '@/lib/catalogue/parse'
import { serverPngUsable } from '@/lib/catalogue/detourageQueue'

describe('classification des vues (détourage, chantier 2)', () => {
  it('reconnaît une vraie face', () => {
    expect(classifyView('VOGEL 300B160 FRONT.jpg')).toBe('face')
    expect(classifyView('1_VOGEL400B120_FRONT.jpg')).toBe('face')
  })

  it('reconnaît une vue d’angle (FRONT LEFT/RIGHT/3Q)', () => {
    expect(classifyView('VOGEL-400B140_FRONT_LEFT.jpg')).toBe('angle')
    expect(classifyView('VOGEL 300B180 FRONT LEFT.jpg')).toBe('angle')
    expect(classifyView('VOGEL_400B160_FRONT-RIGHT.jpg')).toBe('angle')
  })

  it('reconnaît un dos et une vue ouverte', () => {
    expect(classifyView('7_VOGEL300B140_BACK.png')).toBe('back')
    expect(classifyView('VOGEL_FRONT-OPEN.jpg')).toBe('open')
  })

  it('sans mot de vue → face présumée', () => {
    expect(classifyView('1-VOGEL300B160.png')).toBe('presumed')
  })

  it('face et présumée sont utilisables ; angle/dos/ouvert non', () => {
    expect(isUsableFace('face')).toBe(true)
    expect(isUsableFace('presumed')).toBe(true)
    expect(isUsableFace('angle')).toBe(false)
    expect(isUsableFace('back')).toBe(false)
    expect(isUsableFace('open')).toBe(false)
  })

  it('un PNG serveur n’est utilisable que si c’est une face', () => {
    expect(serverPngUsable('Png/Vent-B-J-1055-white-2-300B120.png')).toBe(true)
    expect(serverPngUsable('Png/7_VOGEL300B140_BACK.png')).toBe(false)
    expect(serverPngUsable('Png/VOGEL_400B140_FRONT_LEFT.png')).toBe(false)
    expect(serverPngUsable(null)).toBe(false)
  })
})
