import crypto from 'crypto'
import { createClient, RedisClientType } from 'redis'
import zlib from 'zlib'

type KVFunction<K, V> = (key: K, value: V) => void
type StandardType = Object | string | number
type EncryptionConfig = {
    algo: string
    initVector: Buffer
    securityKey: Buffer
  }

export function md5(data: Object | string | number): string {
  data = typeof data === 'number' ? data.toString() : data
  data = typeof data === 'string' ? data : JSON.stringify(data)
  return crypto
    .createHash('md5')
    .update(data as string)
    .digest('hex')
}

export function compressValue<V>(value: V): string {
  return zlib.gzipSync(JSON.stringify(value)).toString('base64')
}

export function decompressValue<V>(value: string): string {
  const buffer = Buffer.from(value, 'base64')
  // return JSON.parse() as V
  return zlib.gunzipSync(buffer).toString('utf8')
}

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
    encrypted: cipher.update(str, 'utf-8', 'base64') + cipher.final('base64'),
    type
  }
}

export function decryptValue<V>(
  value: string,
  type: string,
  encryption: EncryptionConfig
): V {
  const { algo, securityKey, initVector } = encryption
  const decipher = crypto.createDecipheriv(algo, securityKey, initVector)
  const decrypted = decipher.update(value, 'base64', 'utf-8') + decipher.final('utf-8')
  if (type === 'number' || type === 'object') {
    return JSON.parse(decrypted) as V
  }
  return decrypted as V
}

const initialCounters = {
  hits: 0,
  misses: 0
}

export interface Cache<K, V extends StandardType> {
  has(key: K): boolean
  get(key: K): Promise<V | null>
  set(key: K, value: V): Promise<void>
  unset(key: K): void
  size: number
  allEntries(): Array<[K, V]>
}

export class SuperLRU<K, V extends StandardType> implements Cache<K, V> {
  private redis!: RedisClientType
  private cache: Map<K, V | string>
  private old: Map<K, V | string>
  private readonly maxSize: number
  public size: number
  private counters = { ...initialCounters }
  private onEvicted: KVFunction<K, V> | undefined
  private writeThrough: boolean
  private compress: boolean
  private encrypt: boolean
  private valueType: string | null = null
  private encryption: EncryptionConfig = {
    algo: 'aes-256-cbc',
    initVector: Buffer.from('0x00'),
    securityKey: Buffer.from('0x00')
  }

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
    /**
     * The maximum number of items before evicting the least recently used items.
     * The cache will keep up to twice the amount of entries in memory.
     */
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
    }
    if (writeThrough && redisConfig == null) {
      throw new Error('writeThrough requires redisConfig to be defined')
    }
    this.cache = new Map()
    this.old = new Map()
    this.maxSize = maxSize
    this.compress = compress
    this.encrypt = encrypt
    if (encrypt) {
      this.encryption.initVector = initVector
      this.encryption.securityKey = securityKey
    }
    this.size = 0
    this.onEvicted = onEvicted
    this.writeThrough = writeThrough
  }

  public has(key: K): boolean {
    const b = this.cache.has(key) || this.old.has(key)
    if (b) {
      this.counters.hits++
    } else {
      this.counters.misses++
    }
    return b
  }

  private _get(key: K, map: Map<K, V | string>): V | null {
    const value = map.get(key)
    if (value != null) {
      return this.valueOut(value)
    }
    return null
  }

  public async get(key: K): Promise<V | null> {
    const v = this._get(key, this.cache)
    if (v != null) {
      this.counters.hits++
      return v
    }
    const ov = this._get(key, this.old)
    if (ov != null) {
      this.counters.hits++
      this._set(key, ov)
      return ov
    }
    this.counters.misses++
    if (this.writeThrough) {
      const fromRedis = await this.redis.get(md5(key as StandardType))
      const value = this.valueOut(fromRedis) as V
      await this._set(key, value) // put this back in the active cache
      return value
    }
    return null
  }

  public async set(key: K, value: V): Promise<void> {
    await this._set(key, value)
  }

  public async unset(key: K): Promise<void> {
    this._onEvicted(key)
    const deleted = this.cache.delete(key)
    if (deleted) {
      this.size--
    }
    this.old.delete(key)
    if (this.writeThrough) {
      this.redis.del(md5(key as StandardType))
    }
  }

  private _onEvicted(key: K): void {
    if (this.onEvicted != null) {
      const cv = this.cache.has(key)
      const value = cv ? this.cache.get(key) : this.old.get(key)
      if (value != null && (this.compress || this.encrypt)) {
        this.onEvicted(key, this.valueOut(value as string) as V)
      }
      if (value != null) {
        this.onEvicted(key, value as V)
      }
    }
  }

  private async _set(key: K, value: V) {
    const data = (this.compress || this.encrypt) ? this.valueIn(value) : value
    this.cache.set(key, data)
    this.size++
    if (this.size >= this.maxSize) {
      this.size = 0
      this.old = this.cache
      for (const key of this.old.keys()) {
        this._onEvicted(key)
      }
      this.cache = new Map()
    }
    if (this.writeThrough) {
      const hash = md5(key as StandardType)
      if (this.compress) {
        await this.redis.set(hash, data as string)
      } else {
        await this.redis.set(hash, JSON.stringify(data))
      }
    }
  }

  public allEntries(): [K, V][] {
    return Array.from(this.cache.entries()).map(([key, value]) => [
      key,
      this.compress ? (this.valueOut(value as string) as V) : (value as V)
    ])
  }

  public flushStats() {
    const stats = {
      ...this.counters,
      size: this.size,
      oldSize: this.old.size
    }
    this.counters = { ...initialCounters }
    return stats
  }

  private valueIn<V extends StandardType>(value: V): string | V {
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
      data = compressValue(data)
      return data as string
    }
    return data as V
  }

  private valueOut<V>(value: string | V | null): V | null {
    if (value == null) {
      return null
    }
    let data: StandardType = value
    if (this.compress) {
      data = JSON.parse(decompressValue(value as string))
    }
    if (this.encrypt) {
      data = decryptValue(data as string, this.valueType as string, this.encryption)
    }
    return data as V
  }
}

export default SuperLRU
