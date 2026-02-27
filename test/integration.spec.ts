import crypto from 'crypto'
import { SuperLRU, md5 } from '../src'

// Define fixed keys for deterministic encryption tests where needed
const fixedEncryptionConfig = {
  initVector: Buffer.from('0123456789abcdef0123456789abcdef', 'hex'), // 16 bytes
  securityKey: Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex') // 32 bytes
}

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
      const cache = new SuperLRU<string, { prop1: string; prop2: number }>({ maxSize: 5 })
      await cache.set('key1', { prop1: 'value', prop2: 12345.6789 })
      const value = await cache.get('key1')
      expect(value).toStrictEqual({ prop1: 'value', prop2: 12345.6789 })
    })

    it('should return null for non-existent keys', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })
      const value = await cache.get('nonexistent')
      expect(value).toBeNull()
    })

    it('should correctly report key existence with has()', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })
      await cache.set('key1', 'value1')
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
    // Use fixed keys for reliable testing of encryption itself
    const encryptionConfig = fixedEncryptionConfig

    it('should store and retrieve string values with encryption enabled', async () => {
      const cache = new SuperLRU<string, string>({
        maxSize: 5,
        encrypt: true,
        ...encryptionConfig
      })

      await cache.set('key1', 'value1')
      const value = await cache.get('key1')
      expect(value).toBe('value1')
    })

    it('should store and retrieve complex objects with encryption and compression enabled', async () => {
      const cache = new SuperLRU<string, any>({
        maxSize: 5,
        encrypt: true,
        compress: true,
        ...encryptionConfig
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
        compress: false,
        ...encryptionConfig
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

    it('should throw error if encryption is enabled without explicitly providing keys', () => {
      // Test case where user passes encrypt: true but relies on implicit defaults (which is now disallowed)
      expect(() => {
        new SuperLRU<string, string>({
          maxSize: 5,
          encrypt: true
          // initVector and securityKey are missing from the options object
        })
      }).toThrow('initVector and securityKey are required when encrypt is true')

      // Test case providing only one key
      expect(() => {
        new SuperLRU<string, string>({
          maxSize: 5,
          encrypt: true,
          initVector: crypto.randomBytes(16)
          // securityKey missing
        })
      }).toThrow('initVector and securityKey are required when encrypt is true')

      expect(() => {
        new SuperLRU<string, string>({
          maxSize: 5,
          encrypt: true,
          securityKey: crypto.randomBytes(32)
          // initVector missing
        })
      }).toThrow('initVector and securityKey are required when encrypt is true')

      // Should NOT throw if encrypt is false, even without keys
      expect(() => {
        new SuperLRU<string, string>({
          maxSize: 5,
          encrypt: false
        })
      }).not.toThrow()

      // Should NOT throw if encrypt is true AND keys are provided
      expect(() => {
        new SuperLRU<string, string>({
          maxSize: 5,
          encrypt: true,
          initVector: crypto.randomBytes(16),
          securityKey: crypto.randomBytes(32)
        })
      }).not.toThrow()
    })
  })

  describe('LRU Eviction behavior', () => {
    it('should evict least recently used items when capacity is exceeded', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 3 })

      await cache.set('key1', 'value1') // LRU initially
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3') // MRU initially

      // Verify all keys are present
      expect(cache.has('key1')).toBe(true) // Access moves key1 to MRU. Order: key1, key3, key2
      expect(cache.has('key2')).toBe(true) // Access moves key2 to MRU. Order: key2, key1, key3
      expect(cache.has('key3')).toBe(true) // Access moves key3 to MRU. Order: key3, key2, key1
      expect(cache.size).toBe(3)

      // Add a new item, should evict key1 (LRU after the has checks)
      await cache.set('key4', 'value4') // Order: key4, key3, key2. Evicts key1.

      expect(cache.has('key1')).toBe(false) // Miss
      expect(cache.has('key2')).toBe(true) // Hit. Order: key2, key4, key3
      expect(cache.has('key3')).toBe(true) // Hit. Order: key3, key2, key4
      expect(cache.has('key4')).toBe(true) // Hit. Order: key4, key3, key2
      expect(cache.size).toBe(3)
    })

    it('should update LRU order when accessing existing items via get()', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 3 })

      await cache.set('key1', 'value1') // LRU
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3') // MRU
      // Order: key3, key2, key1

      // Access key1, making key2 the LRU
      await cache.get('key1') // Hit. Order: key1, key3, key2

      // Add a new item, should evict key2 (now LRU)
      await cache.set('key4', 'value4') // Order: key4, key1, key3. Evicts key2.

      expect(cache.has('key1')).toBe(true) // Hit. Order: key1, key4, key3
      expect(cache.has('key2')).toBe(false) // Miss (Evicted)
      expect(cache.has('key3')).toBe(true) // Hit. Order: key3, key1, key4
      expect(cache.has('key4')).toBe(true) // Hit. Order: key4, key3, key1
    })

    it('should update existing items via set() and maintain LRU order', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 3 })

      await cache.set('key1', 'value1') // LRU
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3') // MRU
      // Order: key3, key2, key1

      // Update existing key, should not evict and should update LRU order (key1 becomes MRU)
      await cache.set('key1', 'updated value')
      // Now order is key1 (MRU), key3, key2 (LRU)

      // Add key4, should evict key2
      await cache.set('key4', 'value4') // Order: key4, key1, key3. Evicts key2.

      expect(cache.has('key1')).toBe(true) // Hit. Order: key1, key4, key3
      expect(await cache.get('key1')).toBe('updated value') // Hit. Order: key1, key4, key3 (get also updates)
      expect(cache.has('key2')).toBe(false) // Miss (Evicted)
      expect(cache.has('key3')).toBe(true) // Hit. Order: key3, key1, key4
      expect(cache.has('key4')).toBe(true) // Hit. Order: key4, key3, key1
    })
  })

  describe('Statistics tracking', () => {
    it('should track cache hits and misses correctly', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })

      // Initial stats
      let stats = cache.stats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(stats.size).toBe(0)

      // Miss
      await cache.get('nonexistent')
      stats = cache.stats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(1)

      // Set doesn't count as hit/miss
      await cache.set('key1', 'value1')
      stats = cache.stats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(1)
      expect(stats.size).toBe(1)

      // Hit
      await cache.get('key1')
      stats = cache.stats()
      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)

      // has() also counts
      cache.has('key1') // Hit
      cache.has('nonexistent2') // Miss
      stats = cache.stats()
      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(2)
    })

    it('should reset stats when flush is true', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })

      // Generate some hits and misses
      await cache.get('nonexistent') // Miss
      await cache.set('key1', 'value1')
      await cache.get('key1') // Hit

      // Check and flush stats
      const flushedStats = cache.stats(true)
      expect(flushedStats.hits).toBe(1)
      expect(flushedStats.misses).toBe(1)
      expect(flushedStats.size).toBe(1) // Size is not reset

      // Stats should be reset
      const newStats = cache.stats()
      expect(newStats.hits).toBe(0)
      expect(newStats.misses).toBe(0)
      expect(newStats.size).toBe(1) // Size remains
    })
  })

  describe('Callback functionality', () => {
    it('should call the onEvicted callback when items are evicted by capacity limit', async () => {
      const evictionLog: Array<[string, string]> = []
      const onEvicted = jest.fn((key: string, value: string) => {
        evictionLog.push([key, value])
      })

      const cache = new SuperLRU<string, string>({
        maxSize: 2,
        onEvicted
      })

      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      expect(onEvicted).not.toHaveBeenCalled()

      // This should evict key1
      await cache.set('key3', 'value3')
      expect(onEvicted).toHaveBeenCalledTimes(1)
      expect(onEvicted).toHaveBeenCalledWith('key1', 'value1')
      expect(evictionLog).toEqual([['key1', 'value1']])
    })

    it('should call the onEvicted callback when items are removed by unset()', async () => {
      const evictionLog: Array<[string, string]> = []
      const onEvicted = jest.fn((key: string, value: string) => {
        evictionLog.push([key, value])
      })

      const cache = new SuperLRU<string, string>({
        maxSize: 2,
        onEvicted
      })

      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      expect(onEvicted).not.toHaveBeenCalled()

      // Manually unset should also trigger callback
      await cache.unset('key1')
      expect(onEvicted).toHaveBeenCalledTimes(1)
      expect(onEvicted).toHaveBeenCalledWith('key1', 'value1')
      expect(evictionLog).toEqual([['key1', 'value1']])

      await cache.unset('key2')
      expect(onEvicted).toHaveBeenCalledTimes(2)
      expect(onEvicted).toHaveBeenCalledWith('key2', 'value2')
      expect(evictionLog).toEqual([
        ['key1', 'value1'],
        ['key2', 'value2']
      ])
    })

    it('should NOT call the onEvicted callback during clear()', async () => {
      const onEvicted = jest.fn()
      const cache = new SuperLRU<string, string>({
        maxSize: 5,
        onEvicted
      })

      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')

      await cache.clear()

      expect(onEvicted).not.toHaveBeenCalled()
    })
  })

  describe('allEntries functionality', () => {
    it('should return all entries in the cache in MRU order', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })

      await cache.set('key1', 'value1') // LRU
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3') // MRU

      const entries = cache.allEntries()
      expect(entries.length).toBe(3)

      // Expected order: MRU -> LRU
      expect(entries).toEqual([
        ['key3', 'value3'],
        ['key2', 'value2'],
        ['key1', 'value1']
      ])

      // Access key1 to change order
      await cache.get('key1') // key1 is now MRU
      // Order: key1, key3, key2

      const entriesAfterGet = cache.allEntries()
      expect(entriesAfterGet).toEqual([
        ['key1', 'value1'],
        ['key3', 'value3'],
        ['key2', 'value2']
      ])
    })

    it('should correctly handle entries with compression and encryption', async () => {
      const cache = new SuperLRU<string, any>({
        maxSize: 5,
        compress: true,
        encrypt: true,
        initVector: fixedEncryptionConfig.initVector, // Use fixed keys
        securityKey: fixedEncryptionConfig.securityKey
      })

      const obj1 = { name: 'Object 1', value: 123 }
      const obj2 = { name: 'Object 2', value: 456 }

      await cache.set('key1', obj1)
      await cache.set('key2', obj2)

      const entries = cache.allEntries()
      expect(entries.length).toBe(2)

      // Check that decompression and decryption work correctly
      // Order depends on insertion/access, so check contents regardless of order
      // Use expect.arrayContaining and expect.objectContaining for flexibility
      expect(entries).toEqual(
        expect.arrayContaining([expect.objectContaining(['key1', obj1]), expect.objectContaining(['key2', obj2])])
      )
    })
  })

  describe('clear() functionality', () => {
    it('should remove all items from the cache', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      expect(cache.size).toBe(3)
      expect(cache.has('key1')).toBe(true)

      await cache.clear()

      expect(cache.size).toBe(0)
      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key2')).toBe(false)
      expect(cache.has('key3')).toBe(false)
      expect(cache.allEntries()).toEqual([])
    })

    it('should work correctly on an empty cache', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })
      expect(cache.size).toBe(0)
      await cache.clear()
      expect(cache.size).toBe(0)
      expect(cache.allEntries()).toEqual([])
    })

    it('should allow adding items after clearing', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })
      await cache.set('key1', 'value1')
      await cache.clear()
      expect(cache.size).toBe(0)

      await cache.set('keyA', 'valueA')
      expect(cache.size).toBe(1)
      expect(await cache.get('keyA')).toBe('valueA')
      expect(cache.has('key1')).toBe(false)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty cache correctly', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 5 })

      expect(cache.size).toBe(0)
      expect(cache.allEntries()).toEqual([])
      expect(cache.has('anything')).toBe(false) // Miss
      expect(await cache.get('anything')).toBeNull() // Miss
      const stats = cache.stats()
      expect(stats.misses).toBe(2) // From has() and get()
    })

    it('should handle cache with maxSize of 1 correctly', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 1 })

      await cache.set('key1', 'value1')
      expect(cache.size).toBe(1)
      expect(cache.has('key1')).toBe(true) // Hit

      await cache.set('key2', 'value2') // Evicts key1
      expect(cache.size).toBe(1)
      expect(cache.has('key1')).toBe(false) // Miss
      expect(cache.has('key2')).toBe(true) // Hit
    })

    it('should handle setting and getting null/undefined values correctly', async () => {
      const cache = new SuperLRU<string, any>({
        maxSize: 5,
        compress: true, // Test with compression
        encrypt: true, // Test with encryption
        ...fixedEncryptionConfig
      })

      // Set null/undefined values
      await cache.set('null-key', null)
      await cache.set('undef-key', undefined)

      // Get values
      const nullValue = await cache.get('null-key')
      const undefValue = await cache.get('undef-key')

      // Our implementation now consistently returns null for both stored null and stored undefined
      // due to JSON stringification behavior and how we handle decryption/decompression.
      expect(nullValue).toBeNull()
      expect(undefValue).toBeNull()

      // Verify they exist in the cache
      expect(cache.has('null-key')).toBe(true)
      expect(cache.has('undef-key')).toBe(true)
      expect(cache.size).toBe(2)
    })

    it('should throw error if maxSize is not positive', () => {
      // Test with 0
      expect(() => {
        new SuperLRU<string, string>({ maxSize: 0 })
      }).toThrow('maxSize must be a positive number')

      // Test with negative number
      expect(() => {
        new SuperLRU<string, string>({ maxSize: -1 })
      }).toThrow('maxSize must be a positive number')

      // Test with positive number (should not throw)
      expect(() => {
        new SuperLRU<string, string>({ maxSize: 1 })
      }).not.toThrow()
    })
  })

  describe('More complex workflows', () => {
    it('should handle a mix of operations in sequence', async () => {
      const cache = new SuperLRU<string, any>({ maxSize: 3 })

      // Add items: [key1], [key2, key1], [key3, key2, key1]
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')
      expect(cache.size).toBe(3)
      expect(cache.allEntries().map(e => e[0])).toEqual(['key3', 'key2', 'key1'])

      // Access key1: [key1, key3, key2]
      await cache.get('key1')
      expect(cache.allEntries().map(e => e[0])).toEqual(['key1', 'key3', 'key2'])

      // Add key4, evicts key2: [key4, key1, key3]
      await cache.set('key4', 'value4')
      expect(cache.size).toBe(3)
      expect(cache.has('key2')).toBe(false)
      expect(cache.allEntries().map(e => e[0])).toEqual(['key4', 'key1', 'key3'])

      // Unset key3: [key4, key1]
      await cache.unset('key3')
      expect(cache.size).toBe(2)
      expect(cache.allEntries().map(e => e[0])).toEqual(['key4', 'key1'])

      // Add key5: [key5, key4, key1]
      await cache.set('key5', 'value5')
      expect(cache.size).toBe(3)
      expect(cache.allEntries().map(e => e[0])).toEqual(['key5', 'key4', 'key1'])

      // Add key6, evicts key1: [key6, key5, key4]
      await cache.set('key6', 'value6')
      expect(cache.size).toBe(3)
      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key2')).toBe(false)
      expect(cache.has('key3')).toBe(false)
      expect(cache.has('key4')).toBe(true)
      expect(cache.has('key5')).toBe(true)
      expect(cache.has('key6')).toBe(true)

      // Check final entry values and order
      const entries = cache.allEntries()
      expect(entries).toEqual([
        ['key6', 'value6'],
        ['key5', 'value5'],
        ['key4', 'value4']
      ])
    })
  })
})
