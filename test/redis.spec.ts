import { SuperLRU, compressValue, encryptValue, md5 } from '../src'
import crypto from 'crypto' // Needed for encryption tests
import { RedisClientType } from 'redis' // Import type

// Keep track of the client created within this test suite
let currentTestRedisClient: (RedisClientType & { disconnect: jest.Mock }) | null = null

const createMockRedisClient = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  // Use hSet/hGetAll for storing value + type
  hSet: jest.fn().mockResolvedValue(1),
  hGetAll: jest.fn().mockResolvedValue(null), // Default to miss
  del: jest.fn().mockResolvedValue(1), // Simulate successful deletion
  on: jest.fn(), // Mock the 'on' method for event listeners if needed
  isOpen: true, // Assume connected after connect() resolves
  disconnect: jest.fn().mockResolvedValue(undefined) // Add mock disconnect
})

// Mock the redis module
// Store the mock client instance so we can inspect it
let mockRedisClientInstance = createMockRedisClient()
jest.mock('redis', () => ({
  createClient: jest.fn(() => {
    // Reset the inspectable mock each time createClient is called in a test setup
    mockRedisClientInstance = createMockRedisClient()
    currentTestRedisClient = mockRedisClientInstance as any // Store the instance for disconnect
    return mockRedisClientInstance
  })
}))

// Import the mocked createClient AFTER the mock setup
import { createClient } from 'redis'

describe('SuperLRU with Redis Write-Through', () => {
  const redisConfig = {
    user: 'testuser',
    pass: 'testpass',
    host: 'localhost:6379'
  }

  const encryptionConfig = {
    initVector: crypto.randomBytes(16),
    securityKey: crypto.randomBytes(32)
  }

  beforeEach(() => {
    // Clear mocks state but reuse the same mock setup structure
    jest.clearAllMocks()
    // Reset the tracked client instance before each test
    currentTestRedisClient = null
  })

  afterAll(async () => {
    // Disconnect the client if it was created and has a disconnect method
    // This check might be redundant if beforeEach clears it, but good for safety
    if (currentTestRedisClient && typeof currentTestRedisClient.disconnect === 'function') {
      await currentTestRedisClient.disconnect()
    }
  })

  describe('Redis integration configuration', () => {
    it('should create and connect a Redis client when writeThrough is enabled with redisConfig', () => {
      const cache = new SuperLRU<string, string>({
        maxSize: 5,
        writeThrough: true,
        compress: false,
        redisConfig: redisConfig
      })

      // The constructor now correctly calls createClient only once
      expect(createClient).toHaveBeenCalledTimes(1)
      expect(createClient).toHaveBeenCalledWith({
        url: `redis://${redisConfig.user}:${redisConfig.pass}@${redisConfig.host}`
      })
      // Access the correct mock instance for assertion
      expect(currentTestRedisClient?.connect).toHaveBeenCalledTimes(1)
    })

    it('should handle redisConfig without password', () => {
      const configNoPass = { user: 'testuser', host: 'localhost:6379' }
      const cache = new SuperLRU<string, string>({
        maxSize: 5,
        writeThrough: true,
        compress: false,
        redisConfig: configNoPass
      })

      expect(createClient).toHaveBeenCalledTimes(1) // Corrected expectation
      expect(createClient).toHaveBeenCalledWith({
        url: `redis://${configNoPass.user}:@${configNoPass.host}` // Note the empty password part
      })
      expect(currentTestRedisClient?.connect).toHaveBeenCalledTimes(1)
    })

    it('should throw error when writeThrough is enabled without redisConfig', () => {
      expect(() => {
        new SuperLRU<string, string>({
          maxSize: 5,
          writeThrough: true
          // redisConfig missing
        })
      }).toThrow('writeThrough requires redisConfig to be defined')
      expect(createClient).not.toHaveBeenCalled()
    })

    it('should NOT create a Redis client when writeThrough is false', () => {
      const cache = new SuperLRU<string, string>({
        maxSize: 5,
        writeThrough: false
        // redisConfig can be present or absent, doesn't matter
      })

      expect(createClient).not.toHaveBeenCalled()
    })
  })

  describe('Basic Redis operations', () => {
    let cache: SuperLRU<string, string>

    beforeEach(() => {
      // Ensure a fresh cache and mock client for each test in this suite
      cache = new SuperLRU<string, string>({
        maxSize: 5,
        writeThrough: true,
        compress: false, // Simplify testing by disabling compression/encryption
        encrypt: false,
        redisConfig: redisConfig
      })
      // Wait for potential async connection if needed, though mock resolves immediately
      // await new Promise(resolve => setTimeout(resolve, 0));
    })

    it('should write to Redis with correct key hash, value, and type on set()', async () => {
      const key = 'key1'
      const value = 'value1'
      const expectedRedisKey = md5(key)
      const expectedType = typeof value

      await cache.set(key, value)

      expect(mockRedisClientInstance.hSet).toHaveBeenCalledTimes(1)
      expect(mockRedisClientInstance.hSet).toHaveBeenCalledWith(expectedRedisKey, {
        value: value, // Since compress/encrypt are false, value is stored directly
        type: expectedType
      })
    })

    it('should write compressed/encrypted value and type to Redis on set() if enabled', async () => {
      const cacheEncComp = new SuperLRU<string, { data: string }>({
        maxSize: 5,
        writeThrough: true,
        compress: true,
        encrypt: true,
        redisConfig: redisConfig,
        initVector: encryptionConfig.initVector, // Pass keys correctly
        securityKey: encryptionConfig.securityKey
      })

      const key = 'keyComplex'
      const value = { data: 'sensitive info' }
      const expectedRedisKey = md5(key)
      const expectedType = typeof value

      // Manually perform the valueIn process to know the expected stored value
      const processedValue = cacheEncComp['valueIn'](value) // Use internal method for accuracy

      await cacheEncComp.set(key, value)

      expect(mockRedisClientInstance.hSet).toHaveBeenCalledTimes(1)
      expect(mockRedisClientInstance.hSet).toHaveBeenCalledWith(expectedRedisKey, {
        value: processedValue, // Should be the compressed(encrypted(value)) string
        type: expectedType
      })
    })

    it('should delete from Redis with correct key hash on unset() only if key exists locally', async () => {
      const key = 'keyToDelete'
      const expectedRedisKey = md5(key)

      // Set it first
      await cache.set(key, 'some value')
      expect(mockRedisClientInstance.hSet).toHaveBeenCalledTimes(1) // Verify set happened

      // Now unset
      await cache.unset(key)

      // Should delete because key existed
      expect(mockRedisClientInstance.del).toHaveBeenCalledTimes(1)
      expect(mockRedisClientInstance.del).toHaveBeenCalledWith(expectedRedisKey)
    })

    it('should NOT interact with Redis on unset() if key not in cache', async () => {
      const key = 'keyNotInCache'

      await cache.unset(key)

      // Corrected: Should not call del if key wasn't in the cache
      expect(mockRedisClientInstance.del).not.toHaveBeenCalled()
    })

    it('should attempt to get from Redis hash on get() miss', async () => {
      const key = 'keyToGet'
      const expectedRedisKey = md5(key)
      const valueFromRedis = 'value from redis'
      const typeFromRedis = 'string'

      // Configure mock to return a value hash for this key
      mockRedisClientInstance.hGetAll.mockResolvedValue({
        value: valueFromRedis,
        type: typeFromRedis
      })

      const value = await cache.get(key)

      expect(mockRedisClientInstance.hGetAll).toHaveBeenCalledTimes(1)
      expect(mockRedisClientInstance.hGetAll).toHaveBeenCalledWith(expectedRedisKey)
      expect(value).toBe(valueFromRedis)

      // Verify the value fetched from Redis is now in the local cache
      expect(cache.has(key)).toBe(true)
      // Verify set was NOT called externally (it uses _setInternal)
      expect(mockRedisClientInstance.hSet).not.toHaveBeenCalled()
    })

    it('should handle get() miss when Redis also misses (returns null/empty)', async () => {
      const key = 'keyNotInRedis'
      const expectedRedisKey = md5(key)

      // Configure mock to return null or empty object
      mockRedisClientInstance.hGetAll.mockResolvedValue(null) // Or {}

      const value = await cache.get(key)

      expect(mockRedisClientInstance.hGetAll).toHaveBeenCalledTimes(1)
      expect(mockRedisClientInstance.hGetAll).toHaveBeenCalledWith(expectedRedisKey)
      expect(value).toBeNull()
      expect(cache.has(key)).toBe(false)
      // hSet should NOT have been called in this case
      expect(mockRedisClientInstance.hSet).not.toHaveBeenCalled()
    })

    it('should handle Redis errors gracefully during get()', async () => {
      const key = 'keyWithError'
      const expectedRedisKey = md5(key)
      const redisError = new Error('Redis connection failed')

      // Mock Redis get to reject
      mockRedisClientInstance.hGetAll.mockRejectedValue(redisError)

      // Mock console.error to suppress expected error message during test
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      const value = await cache.get(key)

      expect(mockRedisClientInstance.hGetAll).toHaveBeenCalledTimes(1)
      expect(mockRedisClientInstance.hGetAll).toHaveBeenCalledWith(expectedRedisKey)
      expect(value).toBeNull() // Should return null on Redis error
      expect(cache.has(key)).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error getting key'), redisError)

      consoleErrorSpy.mockRestore() // Restore console.error
    })

    it('should handle Redis errors gracefully during set()', async () => {
      const key = 'keyWithError'
      const value = 'value'
      const redisError = new Error('Redis write failed')

      // Mock Redis set to reject
      mockRedisClientInstance.hSet.mockRejectedValue(redisError)

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      await cache.set(key, value) // Should not throw

      expect(mockRedisClientInstance.hSet).toHaveBeenCalledTimes(1)
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error setting key'), redisError)

      // Verify item is still in local cache despite Redis error
      expect(cache.has(key)).toBe(true)
      // Need to await get() as it's async
      expect(await cache.get(key)).toBe(value) // Should hit local cache

      consoleErrorSpy.mockRestore()
    })

    it('should handle Redis errors gracefully during unset()', async () => {
      const key = 'keyWithError'
      const value = 'value'
      const redisError = new Error('Redis delete failed')

      // Add item first
      await cache.set(key, value)
      expect(cache.has(key)).toBe(true)
      mockRedisClientInstance.hSet.mockClear() // Clear set mock call

      // Mock Redis del to reject
      mockRedisClientInstance.del.mockRejectedValue(redisError)

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      await cache.unset(key) // Should not throw

      expect(mockRedisClientInstance.del).toHaveBeenCalledTimes(1)
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error deleting key'), redisError)

      // Verify item is removed from local cache despite Redis error
      expect(cache.has(key)).toBe(false)

      consoleErrorSpy.mockRestore()
    })
  })

  describe('clear() with Redis', () => {
    let cache: SuperLRU<string, string>

    beforeEach(() => {
      cache = new SuperLRU<string, string>({
        maxSize: 5,
        writeThrough: true,
        compress: false,
        encrypt: false,
        redisConfig: redisConfig
      })
    })

    it('should delete all corresponding keys from Redis on clear()', async () => {
      const keys = ['keyA', 'keyB', 'keyC']
      const redisKeys = keys.map(k => md5(k))

      // Populate cache
      for (const key of keys) {
        await cache.set(key, `value-${key}`)
      }
      expect(cache.size).toBe(keys.length)
      mockRedisClientInstance.hSet.mockClear() // Clear set calls

      await cache.clear()

      expect(cache.size).toBe(0)
      // Should call DEL with an array of keys
      expect(mockRedisClientInstance.del).toHaveBeenCalledTimes(1)
      expect(mockRedisClientInstance.del).toHaveBeenCalledWith(redisKeys)
    })

    it('should NOT call Redis del on clear() if writeThrough is false', async () => {
      const cacheNoWrite = new SuperLRU<string, string>({
        maxSize: 5,
        writeThrough: false, // Disabled
        redisConfig: redisConfig // Still provide config, but writeThrough=false overrides
      })

      await cacheNoWrite.set('key1', 'value1')
      expect(cacheNoWrite.size).toBe(1)

      await cacheNoWrite.clear()

      expect(cacheNoWrite.size).toBe(0)
      // createClient was not called for this instance
      expect(mockRedisClientInstance.del).not.toHaveBeenCalled()
    })

    it('should NOT call Redis del on clear() if cache is empty', async () => {
      expect(cache.size).toBe(0)

      await cache.clear()

      expect(cache.size).toBe(0)
      expect(mockRedisClientInstance.del).not.toHaveBeenCalled()
    })

    it('should handle Redis errors gracefully during clear()', async () => {
      const keys = ['keyA', 'keyB']
      const redisKeys = keys.map(k => md5(k))
      const redisError = new Error('Redis multi-delete failed')

      // Populate cache
      for (const key of keys) {
        await cache.set(key, `value-${key}`)
      }
      mockRedisClientInstance.hSet.mockClear()

      // Mock Redis del to reject
      mockRedisClientInstance.del.mockRejectedValue(redisError)

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      await cache.clear() // Should not throw

      expect(cache.size).toBe(0) // Local cache should still clear
      // del would have been called once with multiple keys
      expect(mockRedisClientInstance.del).toHaveBeenCalledTimes(1)
      expect(mockRedisClientInstance.del).toHaveBeenCalledWith(redisKeys)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error clearing keys from Redis'),
        redisError
      )

      consoleErrorSpy.mockRestore()
    })
  })
})
