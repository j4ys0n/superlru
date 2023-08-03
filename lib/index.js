"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SuperLRU = exports.decryptValue = exports.encryptValue = exports.decompressValue = exports.compressValue = exports.md5 = void 0;
const tslib_1 = require("tslib");
const crypto_1 = tslib_1.__importDefault(require("crypto"));
const redis_1 = require("redis");
const zlib_1 = tslib_1.__importDefault(require("zlib"));
function md5(data) {
    data = typeof data === 'number' ? data.toString() : data;
    data = typeof data === 'string' ? data : JSON.stringify(data);
    return crypto_1.default
        .createHash('md5')
        .update(data)
        .digest('hex');
}
exports.md5 = md5;
function compressValue(value) {
    return zlib_1.default.gzipSync(JSON.stringify(value)).toString('base64');
}
exports.compressValue = compressValue;
function decompressValue(value) {
    const buffer = Buffer.from(value, 'base64');
    // return JSON.parse() as V
    return zlib_1.default.gunzipSync(buffer).toString('utf8');
}
exports.decompressValue = decompressValue;
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
exports.encryptValue = encryptValue;
function decryptValue(value, type, encryption) {
    const { algo, securityKey, initVector } = encryption;
    const decipher = crypto_1.default.createDecipheriv(algo, securityKey, initVector);
    const decrypted = decipher.update(value, 'base64', 'utf-8') + decipher.final('utf-8');
    if (type === 'number' || type === 'object') {
        return JSON.parse(decrypted);
    }
    return decrypted;
}
exports.decryptValue = decryptValue;
const initialCounters = {
    hits: 0,
    misses: 0
};
class SuperLRU {
    redis;
    cache;
    old;
    maxSize;
    size;
    counters = { ...initialCounters };
    onEvicted;
    writeThrough;
    compress;
    encrypt;
    valueType = null;
    encryption = {
        algo: 'aes-256-cbc',
        initVector: crypto_1.default.randomBytes(16),
        securityKey: crypto_1.default.randomBytes(32)
    };
    constructor({ maxSize, compress = true, encrypt = false, onEvicted, writeThrough = false, redisConfig }) {
        if (redisConfig != null) {
            if (redisConfig.pass == null) {
                redisConfig.pass = '';
            }
            const url = `redis://${redisConfig.user}:${redisConfig.pass}@${redisConfig.host}`;
            this.redis = (0, redis_1.createClient)({ url });
        }
        if (writeThrough && redisConfig == null) {
            throw new Error('writeThrough requires redisConfig to be defined');
        }
        this.cache = new Map();
        this.old = new Map();
        this.maxSize = maxSize;
        this.compress = compress;
        this.encrypt = encrypt;
        this.size = 0;
        this.onEvicted = onEvicted;
        this.writeThrough = writeThrough;
    }
    has(key) {
        const b = this.cache.has(key) || this.old.has(key);
        if (b) {
            this.counters.hits++;
        }
        else {
            this.counters.misses++;
        }
        return b;
    }
    _get(key, map) {
        const value = map.get(key);
        if (value != null) {
            return this.valueOut(value);
        }
        return null;
    }
    async get(key) {
        const v = this._get(key, this.cache);
        if (v != null) {
            this.counters.hits++;
            return v;
        }
        const ov = this._get(key, this.old);
        if (ov != null) {
            this.counters.hits++;
            this._set(key, ov);
            return ov;
        }
        this.counters.misses++;
        if (this.writeThrough) {
            const fromRedis = await this.redis.get(md5(key));
            const value = this.valueOut(fromRedis);
            await this._set(key, value); // put this back in the active cache
            return value;
        }
        return null;
    }
    async set(key, value) {
        await this._set(key, value);
    }
    async unset(key) {
        this._onEvicted(key);
        const deleted = this.cache.delete(key);
        if (deleted) {
            this.size--;
        }
        this.old.delete(key);
        if (this.writeThrough) {
            this.redis.del(md5(key));
        }
    }
    _onEvicted(key) {
        if (this.onEvicted != null) {
            const cv = this.cache.has(key);
            const value = cv ? this.cache.get(key) : this.old.get(key);
            if (value != null && (this.compress || this.encrypt)) {
                this.onEvicted(key, this.valueOut(value));
            }
            if (value != null) {
                this.onEvicted(key, value);
            }
        }
    }
    async _set(key, value) {
        const data = (this.compress || this.encrypt) ? this.valueIn(value) : value;
        this.cache.set(key, data);
        this.size++;
        if (this.size >= this.maxSize) {
            this.size = 0;
            this.old = this.cache;
            for (const key of this.old.keys()) {
                this._onEvicted(key);
            }
            this.cache = new Map();
        }
        if (this.writeThrough) {
            const hash = md5(key);
            if (this.compress) {
                await this.redis.set(hash, data);
            }
            else {
                await this.redis.set(hash, JSON.stringify(data));
            }
        }
    }
    allEntries() {
        return Array.from(this.cache.entries()).map(([key, value]) => [
            key,
            this.compress ? this.valueOut(value) : value
        ]);
    }
    flushStats() {
        const stats = {
            ...this.counters,
            size: this.size,
            oldSize: this.old.size
        };
        this.counters = { ...initialCounters };
        return stats;
    }
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
            data = compressValue(data);
            return data;
        }
        return data;
    }
    valueOut(value) {
        if (value == null) {
            return null;
        }
        let data = value;
        if (this.compress) {
            data = JSON.parse(decompressValue(value));
        }
        if (this.encrypt) {
            data = decryptValue(data, this.valueType, this.encryption);
        }
        return data;
    }
}
exports.SuperLRU = SuperLRU;
exports.default = SuperLRU;
