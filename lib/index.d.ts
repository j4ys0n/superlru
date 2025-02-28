/**
 * Type alias for a key-value function callback.
 * @template K - The type of the key.
 * @template V - The type of the value.
 */
type KVFunction<K, V> = (key: K, value: V) => void;
/**
 * Standard types allowed for cache values.
 */
type StandardType = Object | string | number;
/**
 * Configuration options for encryption.
 */
type EncryptionConfig = {
    algo: string;
    initVector: Buffer;
    securityKey: Buffer;
};
/**
 * Generates an MD5 hash of the given data.
 * @param {Object|string|number} data - The data to hash.
 * @returns {string} The MD5 hash in hexadecimal format.
 */
export declare function md5(data: Object | string | number): string;
/**
 * Compresses a value using gzip and returns a Base64 string.
 * @template V - The type of the value.
 * @param {V} value - The value to compress.
 * @returns {string} The compressed value as a Base64 encoded string.
 */
export declare function compressValue<V>(value: V): string;
/**
 * Decompresses a Base64 encoded gzip-compressed string.
 * @template V - The expected type of the decompressed value.
 * @param {string} value - The Base64 encoded compressed string.
 * @returns {string} The decompressed string.
 */
export declare function decompressValue<V>(value: string): string;
/**
 * Encrypts a value using the provided encryption configuration.
 * @template V - The type of the value.
 * @param {V} value - The value to encrypt.
 * @param {EncryptionConfig} encryption - The encryption configuration.
 * @returns {{ encrypted: string; type: string }} The encrypted value and its type.
 */
export declare function encryptValue<V extends StandardType>(value: V, encryption: EncryptionConfig): {
    encrypted: string;
    type: string;
};
/**
 * Decrypts a value using the provided encryption configuration.
 * @template V - The expected type of the decrypted value.
 * @param {string} value - The encrypted value.
 * @param {string} type - The original type of the value.
 * @param {EncryptionConfig} encryption - The encryption configuration.
 * @returns {V} The decrypted value.
 */
export declare function decryptValue<V>(value: string, type: string, encryption: EncryptionConfig): V;
/**
 * Cache interface defining standard cache operations.
 * @template K - Type of the cache key.
 * @template V - Type of the cache value.
 */
export interface Cache<K, V extends StandardType> {
    has(key: K): boolean;
    get(key: K): Promise<V | null>;
    set(key: K, value: V): Promise<void>;
    unset(key: K): Promise<void>;
    size: number;
    allEntries(): Array<[K, V]>;
    stats(flush: boolean): {
        hits: number;
        misses: number;
        size: number;
    };
}
/**
 * A cache implementation using a single Map combined with a doubly-linked list
 * to maintain least-recently used (LRU) order.
 * Optionally supports write-through to Redis, compression, and encryption.
 * @template K - Type of the cache key.
 * @template V - Type of the cache value.
 */
export declare class SuperLRU<K, V extends StandardType> implements Cache<K, V> {
    private cache;
    private head;
    private tail;
    private capacity;
    size: number;
    private counters;
    private onEvicted?;
    private writeThrough;
    private compress;
    private encrypt;
    private valueType;
    private encryption;
    private redis?;
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
    constructor({ maxSize, compress, encrypt, initVector, securityKey, onEvicted, writeThrough, redisConfig }: {
        maxSize: number;
        compress?: boolean;
        encrypt?: boolean;
        initVector?: Buffer;
        securityKey?: Buffer;
        onEvicted?: KVFunction<K, V>;
        writeThrough?: boolean;
        redisConfig?: {
            user: string;
            pass?: string;
            host: string;
        };
    });
    /**
     * Adds a node to the head of the doubly-linked list.
     * @private
     * @param {ListNode<K, V>} node - The node to add.
     */
    private _addNode;
    /**
     * Removes a node from the doubly-linked list.
     * @private
     * @param {ListNode<K, V>} node - The node to remove.
     */
    private _removeNode;
    /**
     * Moves a node to the head of the list (marking it as most recently used).
     * @private
     * @param {ListNode<K, V>} node - The node to move.
     */
    private _moveToHead;
    /**
     * Removes and returns the tail node (least recently used).
     * @private
     * @returns {ListNode<K, V> | null} The removed tail node, or null if the list is empty.
     */
    private _popTail;
    /**
     * Checks if the cache contains the specified key.
     * @param {K} key - The key to check.
     * @returns {boolean} True if the key exists, false otherwise.
     */
    has(key: K): boolean;
    /**
     * Retrieves a value from the cache.
     * If not found and write-through is enabled, attempts to load from Redis.
     * @param {K} key - The key to retrieve.
     * @returns {Promise<V | null>} A promise resolving to the value or null if not found.
     */
    get(key: K): Promise<V | null>;
    /**
     * Sets a key-value pair in the cache.
     * Updates the node if the key exists or adds a new node otherwise.
     * Evicts the least recently used item if capacity is exceeded.
     * @param {K} key - The key to set.
     * @param {V} value - The value to store.
     * @returns {Promise<void>} A promise that resolves when the operation completes.
     */
    set(key: K, value: V): Promise<void>;
    /**
     * Removes a key and its value from the cache.
     * Also removes the key from Redis if write-through is enabled.
     * @param {K} key - The key to remove.
     * @returns {Promise<void>} A promise that resolves when the operation completes.
     */
    unset(key: K): Promise<void>;
    /**
     * Retrieves all entries in the cache.
     * @returns {Array<[K, V]>} An array of key-value pairs.
     */
    allEntries(): [K, V][];
    /**
     * Returns and resets the cache statistics.
     * @returns {{ hits: number; misses: number; size: number }} An object containing hit and miss counts and current cache size.
     */
    stats(flush?: boolean): {
        hits: number;
        misses: number;
        size: number;
    };
    /**
     * Processes the input value by applying encryption and/or compression.
     * @private
     * @param {V} value - The value to process.
     * @returns {string | V} The processed value.
     */
    private valueIn;
    /**
     * Processes the stored value by applying decompression and/or decryption.
     * @private
     * @param {string | V | null} value - The stored value to process.
     * @returns {V | null} The original value.
     */
    private valueOut;
}
export default SuperLRU;
