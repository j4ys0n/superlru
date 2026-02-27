# SuperLRU Cache

A high-performance LRU (Least Recently Used) cache implementation for TypeScript and JavaScript applications.

[![npm version](https://img.shields.io/npm/v/superlru.svg)](https://www.npmjs.com/package/superlru)
[![npm downloads](https://img.shields.io/npm/dm/superlru.svg)](https://www.npmjs.com/package/superlru)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Features

- 🚀 Efficient in-memory LRU caching with O(1) operations
- 🔄 Optional Redis persistence for distributed applications
- 🗜️ Automatic data compression using gzip
- 🔐 AES-256-CBC encryption for sensitive data
- 📊 Built-in cache statistics tracking
- 📦 TypeScript support with full type safety

## Installation

```bash
npm install superlru
# or
yarn add superlru
# or
pnpm add superlru
```

## Quick Start

```typescript
import { SuperLRU } from 'superlru'

// Create a type-safe cache instance
const cache = new SuperLRU<string, { prop1: string; prop2: number }>({
  maxSize: 100
})

// Set a value
await cache.set('key1', {
  prop1: 'value',
  prop2: 12345.6789
})

// Get a value
const value = await cache.get('key1')
console.log(value) // { prop1: 'value', prop2: 12345.6789 }

// Check if a key exists
const exists = cache.has('key1') // true

// Remove a value
await cache.unset('key1')

// Clear the entire cache
await cache.clear()
```

## Configuration Options

| Option             | Type       | Default                  | Description                                                                                                  |
| ------------------ | ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `maxSize`          | `number`   | _required_               | Maximum number of entries in the cache                                                                       |
| `compress`         | `boolean`  | `true`                   | Enable gzip compression for stored values                                                                    |
| `encrypt`          | `boolean`  | `false`                  | Enable AES-256 encryption for stored values                                                                  |
| `initVector`       | `Buffer`   | `crypto.randomBytes(16)` | Initialization vector for encryption (required if `encrypt` is true and no custom key provided)              |
| `securityKey`      | `Buffer`   | `crypto.randomBytes(32)` | Security key for encryption (required if `encrypt` is true and no custom key provided)                       |
| `onEvicted`        | `Function` | `undefined`              | Callback invoked when an item is evicted due to capacity limits or `unset` calls (not called during `clear`) |
| `writeThrough`     | `boolean`  | `false`                  | Enable Redis persistence                                                                                     |
| `redisConfig`      | `Object`   | `undefined`              | Redis connection configuration (required if `writeThrough` is true)                                          |
| `redisConfig.user` | `string`   | -                        | Redis username                                                                                               |
| `redisConfig.pass` | `string`   | `''`                     | Redis password                                                                                               |
| `redisConfig.host` | `string`   | -                        | Redis host and port (e.g., 'localhost:6379')                                                                 |
| `stateSync`        | `Object`   | `undefined`              | Enable Redis-backed shared cache state only (LRU metadata, no value payloads)                                |
| `stateSync.namespace` | `string` | _required when set_     | Namespace used for shared state keys in Redis                                                                 |

`writeThrough` and `stateSync` are mutually exclusive.

## Advanced Usage

### Redis Integration

SuperLRU supports write-through caching with Redis for persistence across application restarts or distributed systems:

```typescript
const cache = new SuperLRU<string, object>({
  maxSize: 1000,
  writeThrough: true,
  redisConfig: {
    user: 'username',
    pass: 'password',
    host: 'localhost:6379'
  }
})

// Operations like set, unset, and clear will interact with Redis
await cache.set('persistentKey', { data: 'persists' })
await cache.clear() // Clears in-memory and attempts to delete keys from Redis
```

### Redis Shared State (HA Deployments)

Use `stateSync` when multiple API instances must share cache state (LRU order/evictions) but should not store cache values in Redis.

```typescript
const cache = new SuperLRU<string, object>({
  maxSize: 1000,
  stateSync: {
    namespace: 'my-service-cache'
  },
  redisConfig: {
    user: 'username',
    pass: 'password',
    host: 'localhost:6379'
  }
})

await cache.set('k1', { data: 'instance-local value' })
```

In this mode:
- Redis stores only key membership and LRU ordering metadata.
- `get()` returns `null` on local misses (it does not read values from Redis).
- `unset()` removes shared state globally, even if the key is not present in local memory.
- `clear()` removes the namespace's shared state keys from Redis.

### Encryption

For sensitive data, enable encryption:

```typescript
import crypto from 'crypto'

const cache = new SuperLRU<string, object>({
  maxSize: 1000,
  encrypt: true,
  // Provide custom encryption keys for deterministic behavior if needed
  initVector: crypto.randomBytes(16), // Or a fixed Buffer
  securityKey: crypto.randomBytes(32) // Or a fixed Buffer
})
```

> Currently, AES-256-CBC is the only supported encryption method.

### Working with Cache Statistics

SuperLRU provides built-in statistics tracking:

```typescript
// Set and get some values...
await cache.set('statKey', 'statValue')
await cache.get('statKey') // Hit
await cache.get('missingKey') // Miss

// Get cache statistics
const stats = cache.stats()
console.log(`Cache size: ${stats.size}`) // Current number of items
console.log(`Cache hits: ${stats.hits}`)
console.log(`Cache misses: ${stats.misses}`)

// Get stats and reset hit/miss counters
const statsAndReset = cache.stats(true)
console.log(`Previous hits: ${statsAndReset.hits}`)

const currentStats = cache.stats()
console.log(`Current hits: ${currentStats.hits}`) // Should be 0
```

### Eviction Callback

Register a callback to be notified when items are evicted due to capacity limits or explicit `unset` calls. Note: This callback is **not** invoked during a `clear()` operation.

```typescript
const cache = new SuperLRU<string, object>({
  maxSize: 100,
  onEvicted: (key, value) => {
    console.log(`Item with key ${key} was evicted`)
    // Perform cleanup or logging
  }
})

await cache.set('key1', { data: 1 })
// ... fill cache ...
await cache.set('newKey', { data: 'new' }) // Might trigger eviction
await cache.unset('key1') // Triggers eviction callback
```

## API Reference

### `SuperLRU<K, V>`

```typescript
class SuperLRU<K, V extends Object | string | number> implements Cache<K, V>
```

#### Constructor

```typescript
constructor(options: {
  maxSize: number;
  compress?: boolean;
  encrypt?: boolean;
  initVector?: Buffer;
  securityKey?: Buffer;
  onEvicted?: (key: K, value: V) => void;
  writeThrough?: boolean;
  redisConfig?: {
    user: string;
    pass?: string;
    host: string;
  };
  stateSync?: {
    namespace: string;
  };
})
```

#### Properties

- `size: number` - The current number of items in the cache.

#### Methods

- `has(key: K): boolean` - Checks if a key exists in the cache. Increments hit/miss counter.
- `get(key: K): Promise<V | null>` - Retrieves a value from the cache. Updates LRU order on hit. Attempts Redis fetch on miss if `writeThrough` is enabled. In `stateSync` mode, local misses do not fetch values from Redis.
- `set(key: K, value: V): Promise<void>` - Stores or updates a value in the cache. Updates LRU order. Writes values to Redis only when `writeThrough` is enabled. In `stateSync` mode, only Redis state metadata is updated.
- `unset(key: K): Promise<void>` - Removes a value from the cache. Calls `onEvicted` callback if defined. Deletes value payload from Redis if `writeThrough` is enabled. In `stateSync` mode, removes shared state for the key globally.
- `clear(): Promise<void>` - Removes all entries from the in-memory cache. If `writeThrough` is enabled, it also attempts to delete the corresponding value keys from Redis. In `stateSync` mode, it clears shared state namespace keys in Redis. Does **not** call `onEvicted`.
- `allEntries(): Array<[K, V]>` - Returns an array of all `[key, value]` pairs currently in the cache. Values are decompressed/decrypted as needed.
- `stats(flush?: boolean): { hits: number; misses: number; size: number }` - Returns cache statistics (hit count, miss count, current size). If `flush` is true, resets hit and miss counters to zero after returning.

## Performance test results

```
Write time for 1000 items: 9.148125ms (0.009148125ms per item)
Read hit time for 1000 items: 6.044292ms (0.006044292000000001ms per item)
Read miss time for 1000 items: 0.336917ms (0.000336917ms per item)
Write time with compression: 60.81225ms (0.6081225ms per item)
Write time without compression: 0.132667ms (0.00132667ms per item)
Read time with compression: 16.244792ms (0.16244792ms per item)
Read time without compression: 0.165833ms (0.0016583300000000002ms per item)
Write time with encryption: 0.929667ms (0.00929667ms per item)
Write time without encryption: 0.073167ms (0.0007316699999999999ms per item)
Read time with encryption: 0.562375ms (0.005623749999999999ms per item)
Read time without encryption: 0.091416ms (0.00091416ms per item)
Write time with high eviction rate (1000 items, cache size 10): 11.848417ms (0.011848417ms per item)
Initial memory usage (MB): { rss: 434, heapTotal: 262, heapUsed: 236 }
Memory after filling cache (MB): { rss: 644, heapTotal: 468, heapUsed: 410 }
Memory increase (MB): { rss: 210, heapTotal: 206, heapUsed: 174 }
Memory after clearing cache (MB): { rss: 644, heapTotal: 469, heapUsed: 415 }
```

## License

Apache 2.0

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
