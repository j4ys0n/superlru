/// <reference types="node" />
type KVFunction<K, V> = (key: K, value: V) => void;
type StandardType = Object | string | number;
type EncryptionConfig = {
    algo: string;
    initVector: Buffer;
    securityKey: Buffer;
};
export declare function md5(data: Object | string | number): string;
export declare function compressValue<V>(value: V): string;
export declare function decompressValue<V>(value: string): string;
export declare function encryptValue<V extends StandardType>(value: V, encryption: EncryptionConfig): {
    encrypted: string;
    type: string;
};
export declare function decryptValue<V>(value: string, type: string, encryption: EncryptionConfig): V;
export interface Cache<K, V extends StandardType> {
    has(key: K): boolean;
    get(key: K): Promise<V | null>;
    set(key: K, value: V): Promise<void>;
    unset(key: K): void;
    size: number;
    allEntries(): Array<[K, V]>;
}
export declare class SuperLRU<K, V extends StandardType> implements Cache<K, V> {
    private redis;
    private cache;
    private old;
    private readonly maxSize;
    size: number;
    private counters;
    private onEvicted;
    private writeThrough;
    private compress;
    private encrypt;
    private valueType;
    private encryption;
    constructor({ maxSize, compress, encrypt, onEvicted, writeThrough, redisConfig }: {
        /**
         * The maximum number of items before evicting the least recently used items.
         * The cache will keep up to twice the amount of entries in memory.
         */
        maxSize: number;
        compress?: boolean;
        encrypt?: boolean;
        onEvicted?: KVFunction<K, V>;
        writeThrough?: boolean;
        redisConfig?: {
            user: string;
            pass?: string;
            host: string;
        };
    });
    has(key: K): boolean;
    private _get;
    get(key: K): Promise<V | null>;
    set(key: K, value: V): Promise<void>;
    unset(key: K): Promise<void>;
    private _onEvicted;
    private _set;
    allEntries(): [K, V][];
    flushStats(): {
        size: number;
        oldSize: number;
        hits: number;
        misses: number;
    };
    private valueIn;
    private valueOut;
}
export default SuperLRU;
