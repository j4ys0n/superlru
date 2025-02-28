# SuperLRU Cache

A high-performance LRU (Least Recently Used) cache implementation for TypeScript and JavaScript applications.

[![npm version](https://img.shields.io/npm/v/superlru.svg)](https://www.npmjs.com/package/superlru)
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
const cache = new SuperLRU<string, { prop1: string, prop2: number }>({ 
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
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxSize` | `number` | *required* | Maximum number of entries in the cache |
| `compress` | `boolean` | `true` | Enable gzip compression for stored values |
| `encrypt` | `boolean` | `false` | Enable AES-256 encryption for stored values |
| `initVector` | `Buffer` | `crypto.randomBytes(16)` | Initialization vector for encryption |
| `securityKey` | `Buffer` | `crypto.randomBytes(32)` | Security key for encryption |
| `onEvicted` | `Function` | `undefined` | Callback invoked when an item is evicted |
| `writeThrough` | `boolean` | `false` | Enable Redis persistence |
| `redisConfig` | `Object` | `undefined` | Redis connection configuration |

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
```

### Encryption

For sensitive data, enable encryption:

```typescript
const cache = new SuperLRU<string, object>({
  maxSize: 1000,
  encrypt: true,
  // Optional: provide custom encryption keys
  initVector: Buffer.from('your-init-vector'),
  securityKey: Buffer.from('your-security-key')
})
```

> Currently, AES-256-CBC is the only supported encryption method.

### Working with Cache Statistics

SuperLRU provides built-in statistics tracking:

```typescript
// Set and get some values...

// Get cache statistics
const stats = cache.stats()
console.log(`Cache size: ${stats.size}`)
console.log(`Cache hits: ${stats.hits}`)
console.log(`Cache misses: ${stats.misses}`)

// Reset statistics
const statsAndReset = cache.stats(true)
```

### Eviction Callback

Register a callback to be notified when items are evicted:

```typescript
const cache = new SuperLRU<string, object>({
  maxSize: 100,
  onEvicted: (key, value) => {
    console.log(`Item with key ${key} was evicted`)
    // Perform cleanup or logging
  }
})
```

## API Reference

### `SuperLRU<K, V>`

```typescript
class SuperLRU<K, V extends Object | string | number> implements Cache<K, V>
```

#### Methods

- `has(key: K): boolean` - Check if a key exists in the cache
- `get(key: K): Promise<V | null>` - Retrieve a value from the cache
- `set(key: K, value: V): Promise<void>` - Store a value in the cache
- `unset(key: K): Promise<void>` - Remove a value from the cache
- `allEntries(): Array<[K, V]>` - Get all entries in the cache
- `stats(flush?: boolean): { hits: number; misses: number; size: number }` - Get cache statistics

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