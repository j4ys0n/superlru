import { SuperLRU } from '../src'

describe('unit tests', () => {
  it('compressed cache with string should store and retrieve a value', async () => {
    const cache = new SuperLRU<string, string>({ maxSize: 5 })
    await cache.set('test', 'value')
    const value = await cache.get('test')
    expect(value).toBe('value')
  })

  it('compressed cache with number should store and retrieve a value', async () => {
    const cache = new SuperLRU<string, number>({ maxSize: 5 })
    await cache.set('test', 12345.6789)
    const value = await cache.get('test')
    expect(value).toBe(12345.6789)
  })

  it('compressed cache with object should store and retrieve a value', async () => {
    const cache = new SuperLRU<string, { prop1: string, prop2: number}>({ maxSize: 5 })
    await cache.set('test', { prop1: 'value', prop2: 12345.6789 })
    const value = await cache.get('test')
    expect(value).toStrictEqual({ prop1: 'value', prop2: 12345.6789 })
  })

  it('encrypted compressed cache with string should store and retrieve a value', async () => {
    const cache = new SuperLRU<string, string>({ maxSize: 5, encrypt: true })
    await cache.set('test', 'valuevaluevalue')
    const value = await cache.get('test')
    expect(value).toBe('valuevaluevalue')
  })

  it('encrypted cache with object should store and retrieve a value', async () => {
    const input = {
      prop1: 'value',
      prop2: 12345.6789,
      prop3: 'value',
      prop4: 12345.6789,
      prop5: 'value',
      prop6: 12345.6789
    }
    const cache = new SuperLRU<string, { [key: string]: any }>({ maxSize: 5, compress: false, encrypt: true })
    await cache.set('test', input)
    const value = await cache.get('test')
    expect(value).toStrictEqual(input)
  })
})
