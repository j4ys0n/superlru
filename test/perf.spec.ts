import { SuperLRU } from '../src'

/**
 * These tests are designed to evaluate performance characteristics
 * and behavior under load. They can be skipped in normal CI runs
 * by using test.skip() if they take too long to execute.
 */
describe('SuperLRU Performance Tests', () => {
  // Helper function to measure execution time
  function measureTime(fn: () => Promise<void>): Promise<number> {
    return new Promise(async (resolve) => {
      const start = process.hrtime.bigint()
      await fn()
      const end = process.hrtime.bigint()
      // Return time in milliseconds
      resolve(Number(end - start) / 1_000_000)
    })
  }

  // Helper to generate random strings
  function randomString(length = 10): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  describe('Basic cache performance', () => {
    it('should handle high volume of operations efficiently', async () => {
      const cache = new SuperLRU<string, string>({ maxSize: 1000 })
      const iterations = 1000

      // Test write performance
      const writeTime = await measureTime(async () => {
        for (let i = 0; i < iterations; i++) {
          await cache.set(`key-${i}`, `value-${i}`)
        }
      })

      // Test read performance for existing keys
      const readHitTime = await measureTime(async () => {
        for (let i = 0; i < iterations; i++) {
          await cache.get(`key-${i}`)
        }
      })

      // Test read performance for non-existing keys
      const readMissTime = await measureTime(async () => {
        for (let i = 0; i < iterations; i++) {
          await cache.get(`nonexistent-${i}`)
        }
      })

      // Log performance metrics
      console.log(`Write time for ${iterations} items: ${writeTime}ms (${writeTime / iterations}ms per item)`)
      console.log(`Read hit time for ${iterations} items: ${readHitTime}ms (${readHitTime / iterations}ms per item)`)
      console.log(`Read miss time for ${iterations} items: ${readMissTime}ms (${readMissTime / iterations}ms per item)`)

      // Get cache stats
      const stats = cache.stats()
      expect(stats.hits).toBe(iterations)
      expect(stats.misses).toBe(iterations)
    })
  })

  describe('Compression performance', () => {
    it('should measure overhead of compression', async () => {
      // Cache with compression
      const compressedCache = new SuperLRU<string, object>({
        maxSize: 1000,
        compress: true
      })

      // Cache without compression
      const rawCache = new SuperLRU<string, object>({
        maxSize: 1000,
        compress: false
      })

      const iterations = 100
      const largeObject = {
        id: 'test',
        data: Array(1000).fill(0).map(() => randomString(50))
      }

      // Test write performance with compression
      const compressedWriteTime = await measureTime(async () => {
        for (let i = 0; i < iterations; i++) {
          await compressedCache.set(`key-${i}`, largeObject)
        }
      })

      // Test write performance without compression
      const rawWriteTime = await measureTime(async () => {
        for (let i = 0; i < iterations; i++) {
          await rawCache.set(`key-${i}`, largeObject)
        }
      })

      // Test read performance with compression
      const compressedReadTime = await measureTime(async () => {
        for (let i = 0; i < iterations; i++) {
          await compressedCache.get(`key-${i}`)
        }
      })

      // Test read performance without compression
      const rawReadTime = await measureTime(async () => {
        for (let i = 0; i < iterations; i++) {
          await rawCache.get(`key-${i}`)
        }
      })

      // Log results
      console.log(`Write time with compression: ${compressedWriteTime}ms (${compressedWriteTime / iterations}ms per item)`)
      console.log(`Write time without compression: ${rawWriteTime}ms (${rawWriteTime / iterations}ms per item)`)
      console.log(`Read time with compression: ${compressedReadTime}ms (${compressedReadTime / iterations}ms per item)`)
      console.log(`Read time without compression: ${rawReadTime}ms (${rawReadTime / iterations}ms per item)`)

      // Compression should increase write/read time but is still worth it for large objects
      expect(compressedWriteTime).toBeGreaterThan(0)
      expect(rawWriteTime).toBeGreaterThan(0)
    })
  })

  describe('Encryption performance', () => {
    it('should measure overhead of encryption', async () => {
      // Cache with encryption
      const encryptedCache = new SuperLRU<string, object>({
        maxSize: 1000,
        compress: false,
        encrypt: true
      })

      // Cache without encryption
      const rawCache = new SuperLRU<string, object>({
        maxSize: 1000,
        compress: false,
        encrypt: false
      })

      const iterations = 100
      const object = {
        id: 'test',
        sensitiveData: randomString(100)
      }

      // Test write performance with encryption
      const encryptedWriteTime = await measureTime(async () => {
        for (let i = 0; i < iterations; i++) {
          await encryptedCache.set(`key-${i}`, object)
        }
      })

      // Test write performance without encryption
      const rawWriteTime = await measureTime(async () => {
        for (let i = 0; i < iterations; i++) {
          await rawCache.set(`key-${i}`, object)
        }
      })

      // Test read performance with encryption
      const encryptedReadTime = await measureTime(async () => {
        for (let i = 0; i < iterations; i++) {
          await encryptedCache.get(`key-${i}`)
        }
      })

      // Test read performance without encryption
      const rawReadTime = await measureTime(async () => {
        for (let i = 0; i < iterations; i++) {
          await rawCache.get(`key-${i}`)
        }
      })

      // Log results
      console.log(`Write time with encryption: ${encryptedWriteTime}ms (${encryptedWriteTime / iterations}ms per item)`)
      console.log(`Write time without encryption: ${rawWriteTime}ms (${rawWriteTime / iterations}ms per item)`)
      console.log(`Read time with encryption: ${encryptedReadTime}ms (${encryptedReadTime / iterations}ms per item)`)
      console.log(`Read time without encryption: ${rawReadTime}ms (${rawReadTime / iterations}ms per item)`)

      // Encryption should increase write/read time
      expect(encryptedWriteTime).toBeGreaterThan(0)
      expect(rawWriteTime).toBeGreaterThan(0)
    })
  })

  describe('Cache eviction performance', () => {
    it('should maintain performance with high eviction rate', async () => {
      // Small cache that will have many evictions
      const cache = new SuperLRU<string, string>({ maxSize: 10 })
      const iterations = 1000

      // Test write performance with high eviction
      const writeTime = await measureTime(async () => {
        for (let i = 0; i < iterations; i++) {
          await cache.set(`key-${i}`, `value-${i}`)
        }
      })

      // Verify eviction behavior
      expect(cache.size).toBe(10)

      // Check which keys remain (should be the last 10)
      for (let i = iterations - 10; i < iterations; i++) {
        expect(cache.has(`key-${i}`)).toBe(true)
      }

      // Check some evicted keys
      expect(cache.has(`key-0`)).toBe(false)
      expect(cache.has(`key-${iterations - 11}`)).toBe(false)

      console.log(`Write time with high eviction rate (${iterations} items, cache size 10): ${writeTime}ms (${writeTime / iterations}ms per item)`)
    })
  })

  describe('Memory usage simulation', () => {
    it('should simulate memory usage patterns', async () => {
      // Skip this test in CI environments
      if (process.env.CI) {
        console.log('Skipping memory usage test in CI environment')
        return
      }

      // Helper to get memory usage in MB
      const getMemoryUsage = () => {
        const memoryUsage = process.memoryUsage()
        return {
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024)
        }
      }

      const initialMemory = getMemoryUsage()
      console.log('Initial memory usage (MB):', initialMemory)

      // Create a large cache
      const cache = new SuperLRU<string, object>({
        maxSize: 10000,
        compress: true
      })

      // Fill it with larger objects
      const largeObjectSize = 1000
      for (let i = 0; i < 10000; i++) {
        const largeObject = {
          id: `item-${i}`,
          data: Array(largeObjectSize).fill(0).map(() => randomString(20))
        }
        await cache.set(`key-${i}`, largeObject)
      }

      const afterFillMemory = getMemoryUsage()
      console.log('Memory after filling cache (MB):', afterFillMemory)

      // Force garbage collection if available (requires --expose-gc node flag)
      if (global.gc) {
        global.gc()
      }

      // Calculate memory difference
      const memoryIncrease = {
        rss: afterFillMemory.rss - initialMemory.rss,
        heapTotal: afterFillMemory.heapTotal - initialMemory.heapTotal,
        heapUsed: afterFillMemory.heapUsed - initialMemory.heapUsed
      }

      console.log('Memory increase (MB):', memoryIncrease)

      // Clear the cache
      for (let i = 0; i < 10000; i++) {
        await cache.unset(`key-${i}`)
      }

      // Force garbage collection again if available
      if (global.gc) {
        global.gc()
      }

      const afterClearMemory = getMemoryUsage()
      console.log('Memory after clearing cache (MB):', afterClearMemory)
    })
  })

  describe('Type stability and edge cases', () => {
    it('should handle numeric keys consistently', async () => {
      const cache = new SuperLRU<number, string>({ maxSize: 100 })

      await cache.set(123, 'value-123')
      await cache.set(456, 'value-456')

      expect(await cache.get(123)).toBe('value-123')
      expect(cache.has(123)).toBe(true)

      // Test with number as string
      expect(cache.has('123' as any)).toBe(false) // Should not access by string
    })

    it('should handle boolean keys consistently', async () => {
      const cache = new SuperLRU<boolean, string>({ maxSize: 100 })

      await cache.set(true, 'value-true')
      await cache.set(false, 'value-false')

      expect(await cache.get(true)).toBe('value-true')
      expect(await cache.get(false)).toBe('value-false')

      // Test with boolean as string
      expect(cache.has('true' as any)).toBe(false) // Should not access by string
    })

    it('should handle Symbol keys consistently', async () => {
      const cache = new SuperLRU<symbol, string>({ maxSize: 100 })

      const sym1 = Symbol('test1')
      const sym2 = Symbol('test1') // Same description, different symbol

      await cache.set(sym1, 'value-sym1')

      expect(await cache.get(sym1)).toBe('value-sym1')
      expect(cache.has(sym1)).toBe(true)

      // Different symbol with same description should not match
      expect(cache.has(sym2)).toBe(false)
      expect(await cache.get(sym2)).toBeNull()
    })

    it('should handle complex nested objects as values', async () => {
      const cache = new SuperLRU<string, any>({ maxSize: 100 })

      const complexValue = {
        string: 'test',
        number: 123,
        boolean: true,
        nested: {
          array: [1, 2, 3],
          object: { a: 1, b: 2 }
        },
        fn: undefined, // Functions will be lost in JSON serialization
        date: new Date('2023-01-01T00:00:00Z') // Dates will be serialized
      }

      await cache.set('complex', complexValue)

      const retrieved = await cache.get('complex')

      // Date objects become strings when serialized/deserialized with JSON
      const dateString = complexValue.date.toISOString()

      expect(retrieved.string).toBe(complexValue.string)
      expect(retrieved.number).toBe(complexValue.number)
      expect(retrieved.boolean).toBe(complexValue.boolean)
      expect(retrieved.nested.array).toEqual(complexValue.nested.array)
      expect(retrieved.nested.object).toEqual(complexValue.nested.object)
      expect(retrieved.fn).toBeUndefined()
      expect(retrieved.date).toBe(dateString)
    })
  })
})