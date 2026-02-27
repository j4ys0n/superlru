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
 * Configuration options for Redis-backed shared cache state.
 * This mode persists only LRU state metadata in Redis (not cache values).
 */
type StateSyncConfig = {
  namespace: string
}

/**
 * Generates an MD5 hash of the given data.
 * @param {Object|string|number} data - The data to hash.
 * @returns {string} The MD5 hash in hexadecimal format.
 */
export function md5(data: Object | string | number): string {
  data = typeof data === 'number' ? data.toString() : data
  data = typeof data === 'string' ? data : JSON.stringify(data)
  return crypto
    .createHash('md5')
    .update(data as string)
    .digest('hex')
}

/**
 * Compresses a value using gzip and returns a Base64 string.
 * Handles undefined by compressing the string "null".
 * @template V - The type of the value.
 * @param {V} value - The value to compress.
 * @returns {string} The compressed value as a Base64 encoded string.
 */
export function compressValue<V>(value: V): string {
  const stringified = JSON.stringify(value)
  // JSON.stringify(undefined) returns undefined. We'll store it as the string "null".
  // JSON.stringify(null) returns "null".
  const bufferInput = stringified === undefined ? 'null' : stringified
  return zlib.gzipSync(bufferInput).toString('base64')
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
    // Handle null explicitly, JSON.stringify(null) is 'null'
    str = value === null ? 'null' : JSON.stringify(value)
  } else if (type === 'number') {
    str = value.toString()
  } else if (type === 'undefined') {
    // Store undefined as the string 'null' to be consistent with compression/JSON
    str = 'null'
  } else {
    str = value as string
  }
  return {
    encrypted: cipher.update(str, 'utf-8', 'base64') + cipher.final('base64'),
    type // Store original type ('undefined', 'object', 'number', 'string')
  }
}

/**
 * Decrypts a value using the provided encryption configuration.
 * @template V - The expected type of the decrypted value.
 * @param {string} value - The encrypted value.
 * @param {string} type - The original type of the value ('object', 'number', 'string', 'undefined').
 * @param {EncryptionConfig} encryption - The encryption configuration.
 * @returns {V} The decrypted value.
 */
export function decryptValue<V>(value: string, type: string, encryption: EncryptionConfig): V {
  const { algo, securityKey, initVector } = encryption
  const decipher = crypto.createDecipheriv(algo, securityKey, initVector)
  const decrypted = decipher.update(value, 'base64', 'utf-8') + decipher.final('utf-8')

  // Handle the stored types correctly
  if (type === 'undefined' || decrypted === 'null') {
    // If original type was undefined, or decrypted value is 'null' (from null or undefined)
    // return null as JSON.parse('null') does. We can't return actual undefined easily here.
    // Consumers should be aware that undefined might become null.
    return null as V
  }
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
  clear(): Promise<void> // Added clear method
  size: number
  allEntries(): Array<[K, V]>
  stats(flush?: boolean): { hits: number; misses: number; size: number }
}

/**
 * Internal doubly-linked list node used by the LRU cache.
 * @template K - Type of the key.
 * @template V - Type of the value.
 */
interface ListNode<K, V> {
  key: K
  storedValue: string | V // value after applying compression/encryption if enabled
  originalType: string // Store original type ('object', 'string', 'number', 'undefined') for decryption
  prev: ListNode<K, V> | null
  next: ListNode<K, V> | null
  timestamp: number // updated on access
}

/**
 * Type definition for the constructor options object.
 */
export type SuperLRUOptions<K, V extends StandardType> = {
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
  stateSync?: StateSyncConfig
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
  private encryption: EncryptionConfig
  private redis?: RedisClientType
  private stateSync?: StateSyncConfig
  private stateMembersKey?: string
  private stateLruKey?: string
  private stateMemberToKey: Map<string, K> = new Map()

  /**
   * Constructs a new SuperLRU cache instance.
   * @param {SuperLRUOptions<K, V>} options - Configuration options.
   */
  constructor(options: SuperLRUOptions<K, V>) {
    // Destructure with defaults AFTER validation
    const {
      maxSize,
      compress = true,
      encrypt = false,
      initVector = crypto.randomBytes(16), // Default only used if encrypt=true and user didn't provide
      securityKey = crypto.randomBytes(32), // Default only used if encrypt=true and user didn't provide
      onEvicted,
      writeThrough = false,
      redisConfig,
      stateSync
    } = options

    // *** VALIDATIONS FIRST ***
    if (maxSize <= 0) {
      throw new Error('maxSize must be a positive number')
    }
    // Check the *original* options object before defaults were applied for encryption keys
    if (encrypt && (options.initVector === undefined || options.securityKey === undefined)) {
      throw new Error('initVector and securityKey are required when encrypt is true')
    }
    if (writeThrough && redisConfig == null) {
      throw new Error('writeThrough requires redisConfig to be defined')
    }
    if (stateSync != null && redisConfig == null) {
      throw new Error('stateSync requires redisConfig to be defined')
    }
    if (writeThrough && stateSync != null) {
      throw new Error('writeThrough and stateSync cannot both be enabled')
    }
    if (
      stateSync != null &&
      (typeof stateSync.namespace !== 'string' || stateSync.namespace.trim().length === 0)
    ) {
      throw new Error('stateSync.namespace must be a non-empty string')
    }

    // *** ASSIGN PROPERTIES ***
    this.cache = new Map()
    this.capacity = maxSize
    this.onEvicted = onEvicted
    this.writeThrough = writeThrough
    this.compress = compress
    this.encrypt = encrypt
    this.stateSync = stateSync ? { namespace: stateSync.namespace.trim() } : undefined
    if (this.stateSync) {
      this.stateMembersKey = `${this.stateSync.namespace}:members`
      this.stateLruKey = `${this.stateSync.namespace}:lru`
    }

    // *** INITIALIZE DEPENDENCIES (Encryption, Redis) ***
    if (this.encrypt) {
      // Use the validated/defaulted keys
      this.encryption = {
        algo: 'aes-256-cbc',
        initVector,
        securityKey
      }
    } else {
      // Provide dummy buffers even if not encrypting to satisfy type, won't be used
      this.encryption = {
        algo: 'aes-256-cbc',
        initVector: Buffer.alloc(16, 0),
        securityKey: Buffer.alloc(32, 0)
      }
    }

    // Initialize Redis client *only once* if needed
    if ((this.writeThrough || this.stateSync) && redisConfig) {
      const redisPass = redisConfig.pass ?? ''
      const url = `redis://${redisConfig.user}:${redisPass}@${redisConfig.host}`
      this.redis = createClient({ url })
      this.redis.connect().catch(err => {
        // Log error, but don't prevent cache from working in memory
        console.error('SuperLRU: Failed to connect to Redis:', err)
      })
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
   * Returns true if the cache is configured to synchronize only cache state through Redis.
   * @private
   */
  private _isStateSyncEnabled(): boolean {
    return this.stateSync != null
  }

  /**
   * Returns true if Redis is connected and state sync keys are available.
   * @private
   */
  private _getStateSyncRedisContext():
    | {
        redis: RedisClientType
        membersKey: string
        lruKey: string
      }
    | null {
    if (
      this.stateSync == null ||
      this.redis == null ||
      !this.redis.isOpen ||
      this.stateMembersKey == null ||
      this.stateLruKey == null
    ) {
      return null
    }
    return {
      redis: this.redis,
      membersKey: this.stateMembersKey,
      lruKey: this.stateLruKey
    }
  }

  /**
   * Hashes a cache key into a Redis-safe state member id.
   * @private
   */
  private _stateMemberFromKey(key: K): string {
    return md5(key as StandardType)
  }

  /**
   * Updates the local member-to-key index used to apply remote evictions locally.
   * @private
   */
  private _indexStateMember(key: K) {
    if (!this._isStateSyncEnabled()) return
    this.stateMemberToKey.set(this._stateMemberFromKey(key), key)
  }

  /**
   * Removes a key from the local member-to-key index.
   * @private
   */
  private _unindexStateMember(key: K) {
    if (!this._isStateSyncEnabled()) return
    this.stateMemberToKey.delete(this._stateMemberFromKey(key))
  }

  /**
   * Completes local node removal bookkeeping and optional eviction callback.
   * @private
   */
  private _finalizeLocalRemoval(node: ListNode<K, V>, notifyEviction: boolean) {
    this.cache.delete(node.key)
    this.size--
    this._unindexStateMember(node.key)

    if (notifyEviction && this.onEvicted) {
      try {
        const value = this.valueOut(node.storedValue, node.originalType)
        this.onEvicted(node.key, value as V)
      } catch (err) {
        console.error(`SuperLRU: Error in onEvicted callback for key ${String(node.key)}:`, err)
      }
    }
  }

  /**
   * Removes a specific key from local memory if present.
   * @private
   */
  private _removeLocalKey(key: K, notifyEviction: boolean): boolean {
    const node = this.cache.get(key)
    if (!node) return false
    this._removeNode(node)
    this._finalizeLocalRemoval(node, notifyEviction)
    return true
  }

  /**
   * Enforces local memory capacity by evicting one tail entry when needed.
   * @private
   */
  private _evictLocalTailIfNeeded() {
    if (this.size <= this.capacity) return
    const tailNode = this._popTail()
    if (!tailNode) return
    this._finalizeLocalRemoval(tailNode, true)
  }

  /**
   * Upserts a value into local memory and updates LRU ordering.
   * @private
   */
  private _upsertLocalNode(key: K, storedValue: string | V, originalType: string) {
    const existingNode = this.cache.get(key)
    if (existingNode) {
      existingNode.storedValue = storedValue
      existingNode.originalType = originalType
      existingNode.timestamp = Date.now()
      this._moveToHead(existingNode)
      this._indexStateMember(key)
      return
    }

    const newNode: ListNode<K, V> = {
      key,
      storedValue,
      originalType,
      prev: null,
      next: null,
      timestamp: Date.now()
    }

    this.cache.set(key, newNode)
    this._addNode(newNode)
    this._indexStateMember(key)
    this.size++
    this._evictLocalTailIfNeeded()
  }

  /**
   * Touches a member in shared Redis state as most recently used.
   * @private
   */
  private async _touchSharedState(member: string): Promise<void> {
    const context = this._getStateSyncRedisContext()
    if (!context) return
    const timestamp = Date.now()
    await Promise.all([
      context.redis.sAdd(context.membersKey, member),
      context.redis.zAdd(context.lruKey, { score: timestamp, value: member })
    ])
  }

  /**
   * Removes a member from shared Redis state.
   * @private
   */
  private async _removeSharedStateMember(member: string): Promise<void> {
    const context = this._getStateSyncRedisContext()
    if (!context) return
    await Promise.all([
      context.redis.sRem(context.membersKey, member),
      context.redis.zRem(context.lruKey, member)
    ])
  }

  /**
   * Prunes oldest shared Redis state members to enforce configured capacity.
   * @private
   */
  private async _pruneSharedState(): Promise<string[]> {
    const context = this._getStateSyncRedisContext()
    if (!context) return []

    const globalSize = await context.redis.zCard(context.lruKey)
    if (globalSize <= this.capacity) return []

    const overflow = globalSize - this.capacity
    const evictedMembers = await context.redis.zRange(context.lruKey, 0, overflow - 1)
    if (evictedMembers.length === 0) return []

    await Promise.all([
      context.redis.zRem(context.lruKey, evictedMembers),
      context.redis.sRem(context.membersKey, evictedMembers)
    ])

    return evictedMembers.map((member: string | Buffer) => member.toString())
  }

  /**
   * Applies shared-state evictions to local memory for keys currently held by this instance.
   * @private
   */
  private _applySharedEvictions(evictedMembers: string[]) {
    for (const member of evictedMembers) {
      const localKey = this.stateMemberToKey.get(member)
      if (localKey === undefined) continue
      this._removeLocalKey(localKey, true)
    }
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
      const stateSyncContext = this._getStateSyncRedisContext()
      if (stateSyncContext) {
        const stateMember = this._stateMemberFromKey(key)
        try {
          const existsInSharedState = await stateSyncContext.redis.sIsMember(stateSyncContext.membersKey, stateMember)
          if (!existsInSharedState) {
            this._removeLocalKey(key, true)
            this.counters.misses++
            return null
          }
          await this._touchSharedState(stateMember)
        } catch (error) {
          console.error(`SuperLRU: Error validating shared state for key ${String(key)}:`, error)
          // If Redis state validation fails, fall back to local cache behavior.
        }
      }

      this.counters.hits++
      this._moveToHead(node)
      return this.valueOut(node.storedValue, node.originalType)
    }

    this.counters.misses++
    if (this.writeThrough && this.redis && this.redis.isOpen) {
      try {
        const redisKey = this._stateMemberFromKey(key)
        // Redis stores the processed value (string) and the original type separately
        const redisResult = await this.redis.hGetAll(redisKey)

        if (redisResult && redisResult.value && redisResult.type) {
          const storedValue = redisResult.value
          const originalType = redisResult.type
          const value = this.valueOut(storedValue, originalType) as V

          // Add the value retrieved from Redis back into the LRU cache
          // This set operation could potentially cause an eviction
          // We pass the already processed value and type to avoid reprocessing
          await this._setInternal(key, storedValue, originalType)

          // Since set() was called, it moved the node to head.
          // We count this as a 'miss' initially, but the subsequent 'set'
          // effectively makes it available for future hits.
          return value
        }
      } catch (error) {
        console.error(`SuperLRU: Error getting key ${String(key)} from Redis:`, error)
        // Treat Redis error as a cache miss
      }
    }
    return null
  }

  /**
   * Internal set method used by get() after fetching from Redis.
   * Avoids reprocessing the value and ensures correct type handling.
   * @private
   */
  private async _setInternal(key: K, storedValue: string | V, originalType: string): Promise<void> {
    this._upsertLocalNode(key, storedValue, originalType)
    // No need to write back to Redis here, as it was just fetched
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
    const originalType = typeof value
    const processedValue = this.valueIn(value) // This is now always a string if compress/encrypt is on
    this._upsertLocalNode(key, processedValue, originalType)

    if (this.writeThrough && this.redis && this.redis.isOpen) {
      try {
        const hash = this._stateMemberFromKey(key)
        // Store processed value and original type in Redis hash
        await this.redis.hSet(hash, {
          value: processedValue as string, // Should be string after valueIn if compress/encrypt
          type: originalType
        })
      } catch (error) {
        console.error(`SuperLRU: Error setting key ${String(key)} in Redis:`, error)
        // Consider error handling strategy - should this throw?
      }
    }

    if (this._getStateSyncRedisContext()) {
      const stateMember = this._stateMemberFromKey(key)
      try {
        await this._touchSharedState(stateMember)
        const evictedMembers = await this._pruneSharedState()
        this._applySharedEvictions(evictedMembers)
      } catch (error) {
        console.error(`SuperLRU: Error synchronizing shared state for key ${String(key)}:`, error)
      }
    }
  }

  /**
   * Removes a key and its value from the cache.
   * Also removes the key from Redis if write-through is enabled.
   * Calls the onEvicted callback if provided.
   * @param {K} key - The key to remove.
   * @returns {Promise<void>} A promise that resolves when the operation completes.
   */
  public async unset(key: K): Promise<void> {
    const existedLocally = this._removeLocalKey(key, true)

    // Delete from Redis write-through storage only if the key existed locally.
    if (existedLocally && this.writeThrough && this.redis && this.redis.isOpen) {
      try {
        await this.redis.del(this._stateMemberFromKey(key))
      } catch (error) {
        console.error(`SuperLRU: Error deleting key ${String(key)} from Redis:`, error)
        // Consider error handling strategy
      }
    }

    // In shared-state mode, remove key state globally even if this instance doesn't hold the value.
    if (this._getStateSyncRedisContext()) {
      try {
        await this._removeSharedStateMember(this._stateMemberFromKey(key))
      } catch (error) {
        console.error(`SuperLRU: Error deleting shared state for key ${String(key)} from Redis:`, error)
      }
    }
  }

  /**
   * Removes all entries from the in-memory cache.
   * If writeThrough is enabled, it also attempts to delete the corresponding keys from Redis.
   * Does **not** call the onEvicted callback for cleared items.
   * @returns {Promise<void>} A promise that resolves when the operation completes.
   */
  public async clear(): Promise<void> {
    const keysToDelete = Array.from(this.cache.keys()) // Get keys before clearing

    // Clear in-memory structures
    this.cache.clear()
    this.stateMemberToKey.clear()
    this.head = null
    this.tail = null
    this.size = 0
    // Note: We are not calling onEvicted for cleared items here.

    // Clear from Redis if writeThrough is enabled
    if (this.writeThrough && this.redis && this.redis.isOpen) {
      if (keysToDelete.length > 0) {
        const redisKeys = keysToDelete.map(key => this._stateMemberFromKey(key))
        try {
          // Use DEL with multiple keys for efficiency
          await this.redis.del(redisKeys)
        } catch (error) {
          // Log or handle Redis deletion errors appropriately
          console.error('SuperLRU: Error clearing keys from Redis:', error)
          // Depending on requirements, might re-throw or just log
        }
      }
    }

    const stateSyncContext = this._getStateSyncRedisContext()
    if (stateSyncContext) {
      try {
        await stateSyncContext.redis.del([stateSyncContext.membersKey, stateSyncContext.lruKey])
      } catch (error) {
        console.error('SuperLRU: Error clearing shared cache state from Redis:', error)
      }
    }
  }

  /**
   * Retrieves all entries in the cache.
   * @returns {Array<[K, V]>} An array of key-value pairs.
   */
  public allEntries(): [K, V][] {
    const entries: [K, V][] = []
    // Iterate in MRU order (head to tail) for potential consistency
    let node = this.head
    while (node) {
      try {
        const value = this.valueOut(node.storedValue, node.originalType) as V
        entries.push([node.key, value])
      } catch (err) {
        console.error(`SuperLRU: Error processing value for key ${String(node.key)} during allEntries:`, err)
        // Skip problematic entry or handle differently?
      }
      node = node.next
    }
    return entries
  }

  /**
   * Returns cache statistics (hit count, miss count, current size).
   * If `flush` is true, resets hit and miss counters to zero after returning.
   * @param {boolean} [flush=false] - Whether to reset hit/miss counters.
   * @returns {{ hits: number; misses: number; size: number }} An object containing hit and miss counts and current cache size.
   */
  public stats(flush: boolean = false): { hits: number; misses: number; size: number } {
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
   * Returns the processed value (always string if compression or encryption is enabled).
   * @private
   * @param {V} value - The value to process.
   * @returns {string | V} The processed value.
   */
  private valueIn(value: V): string | V {
    let processedData: StandardType = value // Start with original value

    if (this.encrypt) {
      const { encrypted } = encryptValue(value, this.encryption)
      processedData = encrypted // Encrypted data is now the base for potential compression
    }

    if (this.compress) {
      // Compress the potentially already encrypted data, or the original data
      // compressValue handles stringification and undefined/null internally
      processedData = compressValue(processedData)
    }

    // If neither encrypt nor compress is true, return the original value
    // Otherwise, return the string result of encryption/compression
    return this.encrypt || this.compress ? (processedData as string) : value
  }

  /**
   * Processes the stored value by applying decompression and/or decryption.
   * Requires the original type to correctly decrypt.
   * @private
   * @param {string | V | null} storedValue - The stored value to process.
   * @param {string} originalType - The original type ('object', 'string', 'number', 'undefined').
   * @returns {V | null} The original value.
   */
  private valueOut(storedValue: string | V | null, originalType: string): V | null {
    if (storedValue === null) return null

    let dataToProcess: StandardType = storedValue

    if (this.compress && typeof storedValue === 'string') {
      const decompressedString = decompressValue(storedValue)
      // If encrypted, the decompressed value is the base64 encrypted string.
      // If only compressed, it's the JSON representation (or "null").
      dataToProcess = decompressedString
    }

    if (this.encrypt && typeof dataToProcess === 'string') {
      // Decrypt requires the original type hint
      dataToProcess = decryptValue(dataToProcess, originalType, this.encryption)
    } else if (!this.encrypt && typeof dataToProcess === 'string') {
      // If only compressed (or neither), parse the stringified value
      try {
        // Handle "null" string explicitly, return null
        if (dataToProcess === 'null') return null
        dataToProcess = JSON.parse(dataToProcess)
      } catch (e) {
        // If JSON.parse fails, it might be a simple string that wasn't JSON originally
        // or potentially corrupted data. Return the string itself.
        console.warn('SuperLRU: Failed to parse stored value, returning as string.', e)
        // dataToProcess remains the string
      }
    }

    // At this point, dataToProcess should be the original type (or null)
    return dataToProcess as V
  }
}

export default SuperLRU
