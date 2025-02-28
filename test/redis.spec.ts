import { SuperLRU, md5 } from '../src'

// Create a simple mocked Redis client
const createMockRedisClient = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  set: jest.fn().mockResolvedValue('OK'),
  get: jest.fn().mockResolvedValue(null),
  del: jest.fn().mockResolvedValue(1)
})

// Mock the redis module
jest.mock('redis', () => ({
  createClient: jest.fn(() => createMockRedisClient())
}))

// Import the mocked createClient
import { createClient } from 'redis'

describe('SuperLRU with Redis Write-Through', () => {
  beforeEach(() => {
    // Clear mocks before each test
    jest.clearAllMocks()
  })

  describe('Redis integration configuration', () => {
    it('should create a Redis client when writeThrough is enabled with redisConfig', () => {
      const cache = new SuperLRU<string, string>({
        maxSize: 5,
        writeThrough: true,
        compress: false,
        redisConfig: {
          user: 'testuser',
          pass: 'testpass',
          host: 'localhost:6379'
        }
      })

      expect(createClient).toHaveBeenCalledWith({
        url: 'redis://testuser:testpass@localhost:6379'
      })
    })

    it('should throw error when writeThrough is enabled without redisConfig', () => {
      expect(() => {
        new SuperLRU<string, string>({
          maxSize: 5,
          writeThrough: true
        })
      }).toThrow('writeThrough requires redisConfig to be defined')
    })
  })

  describe('Basic Redis operations', () => {
    it('should write to Redis when setting a value', async () => {
      const mockRedisClient = createMockRedisClient();
      (createClient as jest.Mock).mockReturnValue(mockRedisClient)

      const cache = new SuperLRU<string, string>({
        maxSize: 5,
        writeThrough: true,
        compress: false,
        redisConfig: {
          user: 'testuser',
          host: 'localhost:6379'
        }
      })

      await cache.set('key1', 'value1')

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        md5('key1'),
        expect.any(String)
      )
    })

    it('should delete from Redis when unset is called', async () => {
      const mockRedisClient = createMockRedisClient();
      (createClient as jest.Mock).mockReturnValue(mockRedisClient)

      const cache = new SuperLRU<string, string>({
        maxSize: 5,
        writeThrough: true,
        compress: false,
        redisConfig: {
          user: 'testuser',
          host: 'localhost:6379'
        }
      })

      await cache.set('key1', 'value1')
      await cache.unset('key1')

      expect(mockRedisClient.del).toHaveBeenCalledWith(md5('key1'))
    })
  })

  describe('Cache options', () => {
    it('should support different cache storage options', async () => {
      // Test with compression disabled
      const cache1 = new SuperLRU<string, string>({
        maxSize: 5,
        compress: false,
        encrypt: false,
        writeThrough: false
      })

      await cache1.set('key1', 'value1')
      expect(await cache1.get('key1')).toBe('value1')

      // Test with encryption enabled
      const cache2 = new SuperLRU<string, string>({
        maxSize: 5,
        compress: false,
        encrypt: true,
        writeThrough: false
      })

      await cache2.set('key2', 'value2')
      expect(await cache2.get('key2')).toBe('value2')
    })
  })
})