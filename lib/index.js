"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SuperLRU = void 0;
exports.md5 = md5;
exports.compressValue = compressValue;
exports.decompressValue = decompressValue;
exports.encryptValue = encryptValue;
exports.decryptValue = decryptValue;
const tslib_1 = require("tslib");
const crypto_1 = tslib_1.__importDefault(require("crypto"));
const redis_1 = require("redis");
const zlib_1 = tslib_1.__importDefault(require("zlib"));
/**
 * Generates an MD5 hash of the given data.
 * @param {Object|string|number} data - The data to hash.
 * @returns {string} The MD5 hash in hexadecimal format.
 */
function md5(data) {
    data = typeof data === 'number' ? data.toString() : data;
    data = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto_1.default.createHash('md5').update(data).digest('hex');
}
/**
 * Compresses a value using gzip and returns a Base64 string.
 * @template V - The type of the value.
 * @param {V} value - The value to compress.
 * @returns {string} The compressed value as a Base64 encoded string.
 */
function compressValue(value) {
    return zlib_1.default.gzipSync(JSON.stringify(value)).toString('base64');
}
/**
 * Decompresses a Base64 encoded gzip-compressed string.
 * @template V - The expected type of the decompressed value.
 * @param {string} value - The Base64 encoded compressed string.
 * @returns {string} The decompressed string.
 */
function decompressValue(value) {
    const buffer = Buffer.from(value, 'base64');
    return zlib_1.default.gunzipSync(buffer).toString('utf8');
}
/**
 * Encrypts a value using the provided encryption configuration.
 * @template V - The type of the value.
 * @param {V} value - The value to encrypt.
 * @param {EncryptionConfig} encryption - The encryption configuration.
 * @returns {{ encrypted: string; type: string }} The encrypted value and its type.
 */
function encryptValue(value, encryption) {
    const { algo, securityKey, initVector } = encryption;
    const cipher = crypto_1.default.createCipheriv(algo, securityKey, initVector);
    const type = typeof value;
    let str = '';
    if (type === 'object') {
        str = JSON.stringify(value);
    }
    else if (type === 'number') {
        str = value.toString();
    }
    else {
        str = value;
    }
    return {
        encrypted: cipher.update(str, 'utf-8', 'base64') + cipher.final('base64'),
        type
    };
}
/**
 * Decrypts a value using the provided encryption configuration.
 * @template V - The expected type of the decrypted value.
 * @param {string} value - The encrypted value.
 * @param {string} type - The original type of the value.
 * @param {EncryptionConfig} encryption - The encryption configuration.
 * @returns {V} The decrypted value.
 */
function decryptValue(value, type, encryption) {
    const { algo, securityKey, initVector } = encryption;
    const decipher = crypto_1.default.createDecipheriv(algo, securityKey, initVector);
    const decrypted = decipher.update(value, 'base64', 'utf-8') + decipher.final('utf-8');
    if (type === 'number' || type === 'object') {
        return JSON.parse(decrypted);
    }
    return decrypted;
}
/**
 * A cache implementation using a single Map combined with a doubly-linked list
 * to maintain least-recently used (LRU) order.
 * Optionally supports write-through to Redis, compression, and encryption.
 * @template K - Type of the cache key.
 * @template V - Type of the cache value.
 */
class SuperLRU {
    cache;
    head = null; // most recently used node
    tail = null; // least recently used node
    capacity;
    size = 0;
    counters = { hits: 0, misses: 0 };
    onEvicted;
    writeThrough;
    compress;
    encrypt;
    valueType = null;
    encryption;
    redis;
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
    constructor({ maxSize, compress = true, encrypt = false, initVector = crypto_1.default.randomBytes(16), securityKey = crypto_1.default.randomBytes(32), onEvicted, writeThrough = false, redisConfig }) {
        if (redisConfig != null) {
            if (redisConfig.pass == null) {
                redisConfig.pass = '';
            }
            const url = `redis://${redisConfig.user}:${redisConfig.pass}@${redisConfig.host}`;
            this.redis = (0, redis_1.createClient)({ url });
            // Connect to Redis.
            this.redis.connect().catch(console.error);
        }
        if (writeThrough && redisConfig == null) {
            throw new Error('writeThrough requires redisConfig to be defined');
        }
        this.cache = new Map();
        this.capacity = maxSize;
        this.onEvicted = onEvicted;
        this.writeThrough = writeThrough;
        this.compress = compress;
        this.encrypt = encrypt;
        if (encrypt) {
            this.encryption = {
                algo: 'aes-256-cbc',
                initVector,
                securityKey
            };
        }
        else {
            this.encryption = {
                algo: 'aes-256-cbc',
                initVector: Buffer.alloc(16, 0),
                securityKey: Buffer.alloc(32, 0)
            };
        }
    }
    /**
     * Adds a node to the head of the doubly-linked list.
     * @private
     * @param {ListNode<K, V>} node - The node to add.
     */
    _addNode(node) {
        node.prev = null;
        node.next = this.head;
        if (this.head) {
            this.head.prev = node;
        }
        this.head = node;
        if (!this.tail) {
            this.tail = node;
        }
    }
    /**
     * Removes a node from the doubly-linked list.
     * @private
     * @param {ListNode<K, V>} node - The node to remove.
     */
    _removeNode(node) {
        if (node.prev) {
            node.prev.next = node.next;
        }
        else {
            this.head = node.next;
        }
        if (node.next) {
            node.next.prev = node.prev;
        }
        else {
            this.tail = node.prev;
        }
        node.prev = null;
        node.next = null;
    }
    /**
     * Moves a node to the head of the list (marking it as most recently used).
     * @private
     * @param {ListNode<K, V>} node - The node to move.
     */
    _moveToHead(node) {
        this._removeNode(node);
        this._addNode(node);
        node.timestamp = Date.now();
    }
    /**
     * Removes and returns the tail node (least recently used).
     * @private
     * @returns {ListNode<K, V> | null} The removed tail node, or null if the list is empty.
     */
    _popTail() {
        if (!this.tail)
            return null;
        const tailNode = this.tail;
        this._removeNode(tailNode);
        return tailNode;
    }
    /**
     * Checks if the cache contains the specified key.
     * @param {K} key - The key to check.
     * @returns {boolean} True if the key exists, false otherwise.
     */
    has(key) {
        const exists = this.cache.has(key);
        if (exists) {
            this.counters.hits++;
        }
        else {
            this.counters.misses++;
        }
        return exists;
    }
    /**
     * Retrieves a value from the cache.
     * If not found and write-through is enabled, attempts to load from Redis.
     * @param {K} key - The key to retrieve.
     * @returns {Promise<V | null>} A promise resolving to the value or null if not found.
     */
    async get(key) {
        const node = this.cache.get(key);
        if (node) {
            this.counters.hits++;
            this._moveToHead(node);
            return this.valueOut(node.storedValue);
        }
        this.counters.misses++;
        if (this.writeThrough && this.redis) {
            const redisKey = md5(key);
            const fromRedis = await this.redis.get(redisKey);
            if (fromRedis != null) {
                const value = this.valueOut(fromRedis);
                await this.set(key, value);
                return value;
            }
        }
        return null;
    }
    /**
     * Sets a key-value pair in the cache.
     * Updates the node if the key exists or adds a new node otherwise.
     * Evicts the least recently used item if capacity is exceeded.
     * @param {K} key - The key to set.
     * @param {V} value - The value to store.
     * @returns {Promise<void>} A promise that resolves when the operation completes.
     */
    async set(key, value) {
        const processed = (this.compress || this.encrypt)
            ? this.valueIn(value)
            : value;
        let node = this.cache.get(key);
        if (node) {
            node.storedValue = processed;
            node.timestamp = Date.now();
            this._moveToHead(node);
        }
        else {
            const newNode = {
                key,
                storedValue: processed,
                prev: null,
                next: null,
                timestamp: Date.now()
            };
            this.cache.set(key, newNode);
            this._addNode(newNode);
            this.size++;
            if (this.size > this.capacity) {
                const tailNode = this._popTail();
                if (tailNode) {
                    this.cache.delete(tailNode.key);
                    this.size--;
                    if (this.onEvicted) {
                        const evictedValue = this.valueOut(tailNode.storedValue);
                        this.onEvicted(tailNode.key, evictedValue);
                    }
                }
            }
        }
        if (this.writeThrough && this.redis) {
            const hash = md5(key);
            let storeValue = typeof processed === 'string'
                ? processed
                : JSON.stringify(processed);
            await this.redis.set(hash, storeValue);
        }
    }
    /**
     * Removes a key and its value from the cache.
     * Also removes the key from Redis if write-through is enabled.
     * @param {K} key - The key to remove.
     * @returns {Promise<void>} A promise that resolves when the operation completes.
     */
    async unset(key) {
        const node = this.cache.get(key);
        if (node) {
            this._removeNode(node);
            this.cache.delete(key);
            this.size--;
            if (this.onEvicted) {
                const value = this.valueOut(node.storedValue);
                this.onEvicted(key, value);
            }
        }
        if (this.writeThrough && this.redis) {
            await this.redis.del(md5(key));
        }
    }
    /**
     * Retrieves all entries in the cache.
     * @returns {Array<[K, V]>} An array of key-value pairs.
     */
    allEntries() {
        const entries = [];
        for (const node of this.cache.values()) {
            const value = this.compress || this.encrypt
                ? this.valueOut(node.storedValue)
                : node.storedValue;
            entries.push([node.key, value]);
        }
        return entries;
    }
    /**
     * Returns and resets the cache statistics.
     * @returns {{ hits: number; misses: number; size: number }} An object containing hit and miss counts and current cache size.
     */
    stats(flush = false) {
        const stats = {
            hits: this.counters.hits,
            misses: this.counters.misses,
            size: this.size
        };
        if (flush) {
            this.counters = { hits: 0, misses: 0 };
        }
        return stats;
    }
    /**
     * Processes the input value by applying encryption and/or compression.
     * @private
     * @param {V} value - The value to process.
     * @returns {string | V} The processed value.
     */
    valueIn(value) {
        let data = value;
        if (this.encrypt) {
            const { encrypted, type } = encryptValue(value, this.encryption);
            data = encrypted;
            if (this.valueType == null) {
                this.valueType = type;
            }
            if (!this.compress) {
                return data;
            }
        }
        else {
            if (this.valueType == null) {
                this.valueType = typeof value;
            }
        }
        if (this.compress) {
            return compressValue(data);
        }
        return data;
    }
    /**
     * Processes the stored value by applying decompression and/or decryption.
     * @private
     * @param {string | V | null} value - The stored value to process.
     * @returns {V | null} The original value.
     */
    valueOut(value) {
        if (value == null)
            return null;
        let data = value;
        if (this.compress && typeof value === 'string') {
            data = JSON.parse(decompressValue(value));
        }
        if (this.encrypt && typeof data === 'string') {
            data = decryptValue(data, this.valueType, this.encryption);
        }
        return data;
    }
}
exports.SuperLRU = SuperLRU;
exports.default = SuperLRU;
//# sourceMappingURL=index.js.map