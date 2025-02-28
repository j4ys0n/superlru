import crypto from 'crypto'
import { createClient, RedisClientType } from 'redis'
import zlib from 'zlib'

/**
 * Type alias for a key-value function callback.
 * @template K - The type of the key.
 * @template V - The type of the value.
 */
type KVFunction<K, V> = (key: K, value: V) => void

/**
 * Standard types allowed for cache values.
 */
type StandardType = Object | string | number

/**
 * Configuration options for encryption.
 */
type EncryptionConfig = {
  algo: string
  initVector: Buffer
  securityKey: Buffer
}

/**
 * Generates an MD5 hash of the given data.
 * @param {Object|string|number} data - The data to hash.
 * @returns {string} The MD5 hash in hexadecimal format.
 */
export function md5(data: Object | string | number): string {
  data = typeof data === 'number' ? data.toString() : data
  data = typeof data === 'string' ? data : JSON.stringify(data)
  return crypto.createHash('md5').update(data as string).digest('hex')
}

/**
 * Compresses a value using gzip and returns a Base64 string.
 * @template V - The type of the value.
 * @param {V} value - The value to compress.
 * @returns {string} The compressed value as a Base64 encoded string.
 */
export function compressValue<V>(value: V): string {
  return zlib.gzipSync(JSON.stringify(value)).toString('base64')
}

/**
 * Decompresses a Base64 encoded gzip-compressed string.
 * @template V - The expected type of the decompressed value.
 * @param {string} value - The Base64 encoded compressed string.
 * @returns {string} The decompressed string.
 */
export function decompressValue<V>(value: string): string {
  const buffer = Buffer.from(value, 'base64')
  return zlib.gunzipSync(buffer).toString('utf8')
}

/**
 * Encrypts a value using the provided encryption configuration.
 * @template V - The type of the value.
 * @param {V} value - The value to encrypt.
 * @param {EncryptionConfig} encryption - The encryption configuration.
 * @returns {{ encrypted: string; type: string }} The encrypted value and its type.
 */
export function encryptValue<V extends StandardType>(
  value: V,
  encryption: EncryptionConfig
): { encrypted: string; type: string } {
  const { algo, securityKey, initVector } = encryption
  const cipher = crypto.createCipheriv(algo, securityKey, initVector)
  const type = typeof value
  let str = ''
  if (type === 'object') {
    str = JSON.stringify(value)
  } else if (type === 'number') {
    str = value.toString()
  } else {
    str = value as string
  }
  return {
    encrypted:
      cipher.update(str, 'utf-8', 'base64') + cipher.final('base64'),
    type
  }
}

/**
 * Decrypts a value using the provided encryption configuration.
 * @template V - The expected type of the decrypted value.
 * @param {string} value - The encrypted value.
 * @param {string} type - The original type of the value.
 * @param {EncryptionConfig} encryption - The encryption configuration.
 * @returns {V} The decrypted value.
 */
export function decryptValue<V>(
  value: string,
  type: string,
  encryption: EncryptionConfig
): V {
  const { algo, securityKey, initVector } = encryption
  const decipher = crypto.createDecipheriv(algo, securityKey, initVector)
  const decrypted =
    decipher.update(value, 'base64', 'utf-8') + decipher.final('utf-8')
  if (type === 'number' || type === 'object') {
    return JSON.parse(decrypted) as V
  }
  return decrypted as V
}

/**
 * Cache interface defining standard cache operations.
 * @template K - Type of the cache key.
 * @template V - Type of the cache value.
 */
export interface Cache<K, V extends StandardType> {
  has(key: K): boolean
  get(key: K): Promise<V | null>
  set(key: K, value: V): Promise<void>
  unset(key: K): Promise<void>
  size: number
  allEntries(): Array<[K, V]>
  stats(flush: boolean): { hits: number; misses: number; size: number }
}

/**
 * Internal doubly-linked list node used by the LRU cache.
 * @template K - Type of the key.
 * @template V - Type of the value.
 */
interface ListNode<K, V> {
  key: K
  storedValue: V | string // value after applying compression/encryption if enabled
  prev: ListNode<K, V> | null
  next: ListNode<K, V> | null
  timestamp: number // updated on access
}

/**
 * A cache implementation using a single Map combined with a doubly-linked list
 * to maintain least-recently used (LRU) order.
 * Optionally supports write-through to Redis, compression, and encryption.
 * @template K - Type of the cache key.
 * @template V - Type of the cache value.
 */
export class SuperLRU<K, V extends StandardType> implements Cache<K, V> {
  private cache: Map<K, ListNode<K, V>>
  private head: ListNode<K, V> | null = null // most recently used node
  private tail: ListNode<K, V> | null = null // least recently used node
  private capacity: number
  public size: number = 0
  private counters = { hits: 0, misses: 0 }
  private onEvicted?: KVFunction<K, V>
  private writeThrough: boolean
  private compress: boolean
  private encrypt: boolean
  private valueType: string | null = null
  private encryption: EncryptionConfig
  private redis?: RedisClientType

  /**
   * Constructs a new SuperLRU cache instance.
   * @param {object} options - Configuration options.
   * @param {number} options.maxSize - Maximum number of items before eviction.
   * @param {boolean} [options.compress=true] - Whether to compress stored values.
   * @param {boolean} [options.encrypt=false] - Whether to encrypt stored values.
   * @param {Buffer} [options.initVector=crypto.randomBytes(16)] - Initialization vector for encryption.
   * @param {Buffer} [options.securityKey=crypto.randomBytes(32)] - Security key for encryption.
   * @param {KVFunction<K, V>} [options.onEvicted] - Callback function invoked on eviction.
   * @param {boolean} [options.writeThrough=false] - Whether to use write-through caching with Redis.
   * @param {object} [options.redisConfig] - Redis configuration options.
   * @param {string} options.redisConfig.user - Redis username.
   * @param {string} [options.redisConfig.pass] - Redis password.
   * @param {string} options.redisConfig.host - Redis host.
   */
  constructor({
    maxSize,
    compress = true,
    encrypt = false,
    initVector = crypto.randomBytes(16),
    securityKey = crypto.randomBytes(32),
    onEvicted,
    writeThrough = false,
    redisConfig
  }: {
    maxSize: number
    compress?: boolean
    encrypt?: boolean
    initVector?: Buffer
    securityKey?: Buffer
    onEvicted?: KVFunction<K, V>
    writeThrough?: boolean
    redisConfig?: {
      user: string
      pass?: string
      host: string
    }
  }) {
    if (redisConfig != null) {
      if (redisConfig.pass == null) {
        redisConfig.pass = ''
      }
      const url = `redis://${redisConfig.user}:${redisConfig.pass}@${redisConfig.host}`
      this.redis = createClient({ url })
      // Connect to Redis.
      this.redis.connect().catch(console.error)
    }
    if (writeThrough && redisConfig == null) {
      throw new Error('writeThrough requires redisConfig to be defined')
    }

    this.cache = new Map()
    this.capacity = maxSize
    this.onEvicted = onEvicted
    this.writeThrough = writeThrough
    this.compress = compress
    this.encrypt = encrypt
    if (encrypt) {
      this.encryption = {
        algo: 'aes-256-cbc',
        initVector,
        securityKey
      }
    } else {
      this.encryption = {
        algo: 'aes-256-cbc',
        initVector: Buffer.alloc(16, 0),
        securityKey: Buffer.alloc(32, 0)
      }
    }
  }

  /**
   * Adds a node to the head of the doubly-linked list.
   * @private
   * @param {ListNode<K, V>} node - The node to add.
   */
  private _addNode(node: ListNode<K, V>) {
    node.prev = null
    node.next = this.head
    if (this.head) {
      this.head.prev = node
    }
    this.head = node
    if (!this.tail) {
      this.tail = node
    }
  }

  /**
   * Removes a node from the doubly-linked list.
   * @private
   * @param {ListNode<K, V>} node - The node to remove.
   */
  private _removeNode(node: ListNode<K, V>) {
    if (node.prev) {
      node.prev.next = node.next
    } else {
      this.head = node.next
    }
    if (node.next) {
      node.next.prev = node.prev
    } else {
      this.tail = node.prev
    }
    node.prev = null
    node.next = null
  }

  /**
   * Moves a node to the head of the list (marking it as most recently used).
   * @private
   * @param {ListNode<K, V>} node - The node to move.
   */
  private _moveToHead(node: ListNode<K, V>) {
    this._removeNode(node)
    this._addNode(node)
    node.timestamp = Date.now()
  }

  /**
   * Removes and returns the tail node (least recently used).
   * @private
   * @returns {ListNode<K, V> | null} The removed tail node, or null if the list is empty.
   */
  private _popTail(): ListNode<K, V> | null {
    if (!this.tail) return null
    const tailNode = this.tail
    this._removeNode(tailNode)
    return tailNode
  }

  /**
   * Checks if the cache contains the specified key.
   * @param {K} key - The key to check.
   * @returns {boolean} True if the key exists, false otherwise.
   */
  public has(key: K): boolean {
    const exists = this.cache.has(key)
    if (exists) {
      this.counters.hits++
    } else {
      this.counters.misses++
    }
    return exists
  }

  /**
   * Retrieves a value from the cache.
   * If not found and write-through is enabled, attempts to load from Redis.
   * @param {K} key - The key to retrieve.
   * @returns {Promise<V | null>} A promise resolving to the value or null if not found.
   */
  public async get(key: K): Promise<V | null> {
    const node = this.cache.get(key)
    if (node) {
      this.counters.hits++
      this._moveToHead(node)
      return this.valueOut(node.storedValue)
    }
    this.counters.misses++
    if (this.writeThrough && this.redis) {
      const redisKey = md5(key as StandardType)
      const fromRedis = await this.redis.get(redisKey)
      if (fromRedis != null) {
        const value = this.valueOut(fromRedis) as V
        await this.set(key, value)
        return value
      }
    }
    return null
  }

  /**
   * Sets a key-value pair in the cache.
   * Updates the node if the key exists or adds a new node otherwise.
   * Evicts the least recently used item if capacity is exceeded.
   * @param {K} key - The key to set.
   * @param {V} value - The value to store.
   * @returns {Promise<void>} A promise that resolves when the operation completes.
   */
  public async set(key: K, value: V): Promise<void> {
    const processed = (this.compress || this.encrypt)
      ? this.valueIn(value)
      : value
    let node = this.cache.get(key)
    if (node) {
      node.storedValue = processed
      node.timestamp = Date.now()
      this._moveToHead(node)
    } else {
      const newNode: ListNode<K, V> = {
        key,
        storedValue: processed,
        prev: null,
        next: null,
        timestamp: Date.now()
      }
      this.cache.set(key, newNode)
      this._addNode(newNode)
      this.size++
      if (this.size > this.capacity) {
        const tailNode = this._popTail()
        if (tailNode) {
          this.cache.delete(tailNode.key)
          this.size--
          if (this.onEvicted) {
            const evictedValue = this.valueOut(tailNode.storedValue)
            this.onEvicted(tailNode.key, evictedValue as V)
          }
        }
      }
    }
    if (this.writeThrough && this.redis) {
      const hash = md5(key as StandardType)
      let storeValue: string =
        typeof processed === 'string'
          ? processed
          : JSON.stringify(processed)
      await this.redis.set(hash, storeValue)
    }
  }

  /**
   * Removes a key and its value from the cache.
   * Also removes the key from Redis if write-through is enabled.
   * @param {K} key - The key to remove.
   * @returns {Promise<void>} A promise that resolves when the operation completes.
   */
  public async unset(key: K): Promise<void> {
    const node = this.cache.get(key)
    if (node) {
      this._removeNode(node)
      this.cache.delete(key)
      this.size--
      if (this.onEvicted) {
        const value = this.valueOut(node.storedValue)
        this.onEvicted(key, value as V)
      }
    }
    if (this.writeThrough && this.redis) {
      await this.redis.del(md5(key as StandardType))
    }
  }

  /**
   * Retrieves all entries in the cache.
   * @returns {Array<[K, V]>} An array of key-value pairs.
   */
  public allEntries(): [K, V][] {
    const entries: [K, V][] = []
    for (const node of this.cache.values()) {
      const value =
        this.compress || this.encrypt
          ? (this.valueOut(node.storedValue) as V)
          : (node.storedValue as V)
      entries.push([node.key, value])
    }
    return entries
  }

  /**
   * Returns and resets the cache statistics.
   * @returns {{ hits: number; misses: number; size: number }} An object containing hit and miss counts and current cache size.
   */
  public stats(flush: boolean = false) {
    const stats = {
      hits: this.counters.hits,
      misses: this.counters.misses,
      size: this.size
    }
    if (flush) {
      this.counters = { hits: 0, misses: 0 }
    }
    return stats
  }

  /**
   * Processes the input value by applying encryption and/or compression.
   * @private
   * @param {V} value - The value to process.
   * @returns {string | V} The processed value.
   */
  private valueIn(value: V): string | V {
    let data: StandardType = value
    if (this.encrypt) {
      const { encrypted, type } = encryptValue(value, this.encryption)
      data = encrypted
      if (this.valueType == null) {
        this.valueType = type
      }
      if (!this.compress) {
        return data as string
      }
    } else {
      if (this.valueType == null) {
        this.valueType = typeof value
      }
    }
    if (this.compress) {
      return compressValue(data) as string
    }
    return data as V
  }

  /**
   * Processes the stored value by applying decompression and/or decryption.
   * @private
   * @param {string | V | null} value - The stored value to process.
   * @returns {V | null} The original value.
   */
  private valueOut(value: string | V | null): V | null {
    if (value == null) return null
    let data: StandardType = value
    if (this.compress && typeof value === 'string') {
      data = JSON.parse(decompressValue(value))
    }
    if (this.encrypt && typeof data === 'string') {
      data = decryptValue(data, this.valueType as string, this.encryption)
    }
    return data as V
  }
}

export default SuperLRU
