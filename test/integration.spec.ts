import crypto from 'crypto'
import { SuperLRU, md5 } from '../src'

describe('SuperLRU Cache Integration Tests', () => {
  describe('Basic cache operations', () => {
    it('should store and retrieve string values', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })
      await cache.set('key1', 'value1')
      const value = await cache.get('key1')
      expect(value).toBe('value1')
    })

    it('should store and retrieve number values', async () => {
      const cache = new SuperLRU<string, number>({ maxSize: 5 })
      await cache.set('key1', 12345.6789)
      const value = await cache.get('key1')
      expect(value).toBe(12345.6789)
    })

    it('should store and retrieve object values', async () => {
      const cache = new SuperLRU<string, { prop1: string, prop2: number }>({ maxSize: 5 })
      await cache.set('key1', { prop1: 'value', prop2: 12345.6789 })
      const value = await cache.get('key1')
      expect(value).toStrictEqual({ prop1: 'value', prop2: 12345.6789 })
    })

    it('should return null for non-existent keys', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })
      const value = await cache.get('nonexistent')
      expect(value).toBeNull()
    })

    it('should correctly report key existence with has()', () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })
      cache.set('key1', 'value1')
      expect(cache.has('key1')).toBe(true)
      expect(cache.has('nonexistent')).toBe(false)
    })

    it('should remove items with unset()', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })
      await cache.set('key1', 'value1')
      expect(await cache.get('key1')).toBe('value1')

      await cache.unset('key1')
      expect(await cache.get('key1')).toBeNull()
      expect(cache.has('key1')).toBe(false)
    })
  })

  describe('Compression functionality', () => {
    it('should store and retrieve string values with compression enabled', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5, compress: true })
      await cache.set('key1', 'value1')
      const value = await cache.get('key1')
      expect(value).toBe('value1')
    })

    it('should store and retrieve object values with compression enabled', async () => {
      const cache = new SuperLRU<string, object>({ maxSize: 5, compress: true })
      const complexObject = {
        name: 'Test Object',
        values: [1, 2, 3, 4, 5],
        nested: {
          prop1: 'nested value',
          prop2: 12345.6789
        }
      }

      await cache.set('complex', complexObject)
      const value = await cache.get('complex')
      expect(value).toStrictEqual(complexObject)
    })

    it('should store and retrieve values with compression disabled', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5, compress: false })
      await cache.set('key1', 'value1')
      const value = await cache.get('key1')
      expect(value).toBe('value1')
    })
  })

  describe('Encryption functionality', () => {
    it('should store and retrieve string values with encryption enabled', async () => {
      const cache = new SuperLRU<string, string>({
        maxSize: 5,
        encrypt: true,
        initVector: crypto.randomBytes(16),
        securityKey: crypto.randomBytes(32)
      })

      await cache.set('key1', 'value1')
      const value = await cache.get('key1')
      expect(value).toBe('value1')
    })

    it('should store and retrieve complex objects with encryption and compression enabled', async () => {
      const cache = new SuperLRU<string, any>({
        maxSize: 5,
        encrypt: true,
        compress: true
      })

      const complexObject = {
        name: 'Test Object',
        values: [1, 2, 3, 4, 5],
        nested: {
          prop1: 'nested value',
          prop2: 12345.6789
        }
      }

      await cache.set('complex', complexObject)
      const value = await cache.get('complex')
      expect(value).toStrictEqual(complexObject)
    })

    it('should store and retrieve values with encryption enabled and compression disabled', async () => {
      const cache = new SuperLRU<string, any>({
        maxSize: 5,
        encrypt: true,
        compress: false
      })

      const input = {
        prop1: 'value',
        prop2: 12345.6789,
        prop3: 'value',
        prop4: 12345.6789,
        prop5: 'value',
        prop6: 12345.6789
      }

      await cache.set('test', input)
      const value = await cache.get('test')
      expect(value).toStrictEqual(input)
    })
  })

  describe('LRU Eviction behavior', () => {
    it('should evict least recently used items when capacity is exceeded', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 3 })

      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      // Verify all keys are present
      expect(cache.has('key1')).toBe(true)
      expect(cache.has('key2')).toBe(true)
      expect(cache.has('key3')).toBe(true)
      expect(cache.size).toBe(3)

      // Add a new item, should evict key1 (LRU)
      await cache.set('key4', 'value4')

      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key2')).toBe(true)
      expect(cache.has('key3')).toBe(true)
      expect(cache.has('key4')).toBe(true)
      expect(cache.size).toBe(3)
    })

    it('should update LRU order when accessing existing items', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 3 })

      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      // Access key1, making key2 the LRU
      await cache.get('key1')

      // Add a new item, should evict key2 (now LRU) instead of key1
      await cache.set('key4', 'value4')

      expect(cache.has('key1')).toBe(true)
      expect(cache.has('key2')).toBe(false) // Evicted
      expect(cache.has('key3')).toBe(true)
      expect(cache.has('key4')).toBe(true)
    })

    it('should update existing items and maintain LRU order', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 3 })

      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      // Update existing key, should not evict and should update LRU order
      await cache.set('key1', 'updated value')
      await cache.set('key4', 'value4')

      expect(cache.has('key1')).toBe(true)
      expect(await cache.get('key1')).toBe('updated value')
      expect(cache.has('key2')).toBe(false) // Evicted
      expect(cache.has('key3')).toBe(true)
      expect(cache.has('key4')).toBe(true)
    })
  })

  describe('Statistics tracking', () => {
    it('should track cache hits and misses', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })

      // Initial stats
      const initialStats = cache.stats()
      expect(initialStats.hits).toBe(0)
      expect(initialStats.misses).toBe(0)

      // Miss
      await cache.get('nonexistent')

      // Hit
      await cache.set('key1', 'value1')
      await cache.get('key1')

      // Check stats
      const currentStats = cache.stats()
      expect(currentStats.hits).toBe(1)
      expect(currentStats.misses).toBe(1)
    })

    it('should reset stats when flush is true', () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })

      // Generate some hits and misses
      cache.has('nonexistent') // Miss
      cache.set('key1', 'value1')
      cache.has('key1') // Hit

      // Check and flush stats
      const stats = cache.stats(true)
      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)

      // Stats should be reset
      const newStats = cache.stats()
      expect(newStats.hits).toBe(0)
      expect(newStats.misses).toBe(0)
    })
  })

  describe('Callback functionality', () => {
    it('should call the onEvicted callback when items are evicted', async () => {
      const evictionLog: Array<[string, string]> = []
      const onEvicted = (key: string, value: string) => {
        evictionLog.push([key, value])
      }

      const cache = new SuperLRU<string, string>({
        maxSize: 2,
        onEvicted
      })

      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      expect(evictionLog.length).toBe(0)

      // This should evict key1
      await cache.set('key3', 'value3')
      expect(evictionLog.length).toBe(1)
      expect(evictionLog[0]).toEqual(['key1', 'value1'])

      // Manually unset should also trigger callback
      await cache.unset('key2')
      expect(evictionLog.length).toBe(2)
      expect(evictionLog[1]).toEqual(['key2', 'value2'])
    })
  })

  describe('allEntries functionality', () => {
    it('should return all entries in the cache', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })

      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      const entries = cache.allEntries()
      expect(entries.length).toBe(3)

      // Convert entries to an object for easier testing
      const entriesObj = Object.fromEntries(entries)
      expect(entriesObj).toEqual({
        key1: 'value1',
        key2: 'value2',
        key3: 'value3'
      })
    })

    it('should correctly handle entries with compression and encryption', async () => {
      const cache = new SuperLRU<string, any>({
        maxSize: 5,
        compress: true,
        encrypt: true
      })

      const obj1 = { name: 'Object 1', value: 123 }
      const obj2 = { name: 'Object 2', value: 456 }

      await cache.set('key1', obj1)
      await cache.set('key2', obj2)

      const entries = cache.allEntries()
      expect(entries.length).toBe(2)

      // Check that decompression and decryption work correctly
      expect(entries).toContainEqual(['key1', obj1])
      expect(entries).toContainEqual(['key2', obj2])
    })
  })

  describe('Edge cases', () => {
    it('should handle empty cache correctly', () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })

      expect(cache.size).toBe(0)
      expect(cache.allEntries()).toEqual([])
      expect(cache.has('anything')).toBe(false)
    })

    it('should handle cache with maxSize of 1 correctly', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 1 })

      await cache.set('key1', 'value1')
      expect(cache.size).toBe(1)

      await cache.set('key2', 'value2')
      expect(cache.size).toBe(1)
      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key2')).toBe(true)
    })

    it('should handle setting and getting null values', async () => {
      const cache = new SuperLRU<string, any>({ maxSize: 5 })

      // Set null/undefined values
      await cache.set('null-key', null as any)

      // Get values
      const nullValue = await cache.get('null-key')

      // In real-world usage, this would depend on how JSON.stringify/parse 
      // handles null vs undefined, but we should at least test the behavior
      expect(nullValue).toBeNull()
    })
  })

  describe('More complex workflows', () => {
    it('should handle a mix of operations in sequence', async () => {
      const cache = new SuperLRU<string, any>({ maxSize: 3 })

      // Add items
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      // Check size
      expect(cache.size).toBe(3)

      // Access key1 to make it more recently used
      await cache.get('key1')

      // Add new item, should evict key2
      await cache.set('key4', 'value4')
      expect(cache.size).toBe(3)
      expect(cache.has('key2')).toBe(false)

      // Unset key3
      await cache.unset('key3')
      expect(cache.size).toBe(2)

      // Add two more keys
      await cache.set('key5', 'value5')
      await cache.set('key6', 'value6')

      // Final state should have keys 1, 4, 5, 6 with 1, 4, 5 in cache
      expect(cache.size).toBe(3)
      expect(cache.has('key1')).toBe(false) // Was evicted when adding key6
      expect(cache.has('key2')).toBe(false)
      expect(cache.has('key3')).toBe(false)
      expect(cache.has('key4')).toBe(true)
      expect(cache.has('key5')).toBe(true)
      expect(cache.has('key6')).toBe(true)

      // Check entry values
      const entries = Object.fromEntries(cache.allEntries())
      expect(entries).toEqual({
        key4: 'value4',
        key5: 'value5',
        key6: 'value6'
      })
    })
  })
})