# Super LRU Cache

Simple LRU Cache implementation

features:
- gzip compression
- encryption
- optionally backed by redis

options:
- `maxSize: number` - max number of entries in the cache
- `compress: boolean` - use gzip compression on cache entries (default: `true`)
- `encrypt: boolean` - use encryption on cache entries (default: `false`)**
- `initVector: Buffer` - specify custom init vector (default: `crypto.randomBytes(16)`)
- `securityKey: Buffer` - specify custom security key (default: `crypto.randomBytes(32)`)
- `writeThrough: boolean` - write cache entries through to Redis. (default: `false`)
- `redisConfig: { user: string, pass: string, host: string }` - redis connection info. (default: `undefined`)

** currentlty the only encryption method supported is `aes-256-cbc`. more can be added in the future. 

```typescript
import { SuperLRU } from 'superlru'

const cache = new SuperLRU<string, { prop1: string, prop2: number }>({ maxSize: 100 })

await cache.set('test', {
  prop1: 'value',
  prop2: 12345.6789,
})
const value = await cache.get('test')
```


