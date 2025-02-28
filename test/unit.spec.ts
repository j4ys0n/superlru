import crypto from 'crypto'
import { compressValue, decompressValue, decryptValue, encryptValue, md5, SuperLRU } from '../src'

const encryption = {
  algo: 'aes-256-cbc',
  initVector: crypto.randomBytes(16),
  securityKey: crypto.randomBytes(32)
}

describe('md5 hash function', () => {
  it('should create consistent md5 hash for strings', () => {
    const hash1 = md5('testing')
    expect(hash1).toBe('ae2b1fca515949e5d54fb22b8ed95575')
    const hash2 = md5('very-long-string-that-you-might-want-to-be-shorter')
    expect(hash2).toBe('b03b42e1117fe5965ec9f53024e90f04')
  })

  it('should create consistent md5 hash for numbers', () => {
    const hash1 = md5(12345)
    const hash2 = md5('12345')
    expect(hash1).toBe(hash2)
  })

  it('should create consistent md5 hash for objects', () => {
    const obj = { a: 1, b: 'test' }
    const hash1 = md5(obj)
    const hash2 = md5(JSON.stringify(obj))
    expect(hash1).toBe(hash2)
  })

  it('should create different hashes for different inputs', () => {
    const hash1 = md5('test1')
    const hash2 = md5('test2')
    expect(hash1).not.toBe(hash2)
  })
})

describe('compression functions', () => {
  it('should compress and decompress a string value', () => {
    const input = 'testing string compression'
    const compressed = compressValue(input)
    const decompressed = decompressValue(compressed)
    expect(decompressed).toBe(JSON.stringify(input))
    expect(JSON.parse(decompressed)).toBe(input)
  })

  it('should compress and decompress a numeric value', () => {
    const input = 12345.6789
    const compressed = compressValue(input)
    const decompressed = decompressValue(compressed)
    expect(JSON.parse(decompressed)).toBe(input)
  })

  it('should compress and decompress an object value', () => {
    const input = { test: 'value', num: 123 }
    const compressed = compressValue(input)
    const decompressed = decompressValue(compressed)
    expect(JSON.parse(decompressed)).toEqual(input)
  })

  it('should produce a smaller string after compression for large data', () => {
    const largeString = 'a'.repeat(10000)
    const compressed = compressValue(largeString)
    expect(compressed.length).toBeLessThan(largeString.length)
  })

  it('should handle empty values correctly', () => {
    const emptyString = ''
    const emptyObject = {}

    const compressedString = compressValue(emptyString)
    const decompressedString = decompressValue(compressedString)
    expect(JSON.parse(decompressedString)).toBe(emptyString)

    const compressedObject = compressValue(emptyObject)
    const decompressedObject = decompressValue(compressedObject)
    expect(JSON.parse(decompressedObject)).toEqual(emptyObject)
  })
})

describe('encryption functions', () => {
  it('should encrypt and decrypt a string value', () => {
    const stringInput = 'encrypted string value test'
    const { encrypted: encryptedString, type: typeString } = encryptValue(stringInput, encryption)
    const decryptedString = decryptValue(encryptedString, typeString, encryption)
    expect(decryptedString).toBe(stringInput)
  })

  it('should encrypt and decrypt an object value', () => {
    const objectInput = { test: 'encrypted object value test' }
    const { encrypted: encryptedObject, type: typeObject } = encryptValue(objectInput, encryption)
    const decryptedObject = decryptValue(encryptedObject, typeObject, encryption)
    expect(decryptedObject).toEqual(objectInput)
  })

  it('should encrypt and decrypt a numeric value', () => {
    const numberInput = 12345.6789
    const { encrypted: encryptedNumber, type: typeNumber } = encryptValue(numberInput, encryption)
    const decryptedNumber = decryptValue(encryptedNumber, typeNumber, encryption)
    expect(decryptedNumber).toBe(numberInput)
  })

  it('should produce different encrypted values for the same input with different encryption configs', () => {
    const input = 'test value'
    const encryption1 = {
      algo: 'aes-256-cbc',
      initVector: crypto.randomBytes(16),
      securityKey: crypto.randomBytes(32)
    }
    const encryption2 = {
      algo: 'aes-256-cbc',
      initVector: crypto.randomBytes(16),
      securityKey: crypto.randomBytes(32)
    }

    const { encrypted: encrypted1 } = encryptValue(input, encryption1)
    const { encrypted: encrypted2 } = encryptValue(input, encryption2)

    expect(encrypted1).not.toBe(encrypted2)
  })

  it('should produce the same encrypted value for the same input with the same encryption config', () => {
    const input = 'test value'
    const sameEncryption = {
      algo: 'aes-256-cbc',
      initVector: Buffer.from('0123456789abcdef0123456789abcdef', 'hex'),
      securityKey: Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex')
    }

    const { encrypted: encrypted1 } = encryptValue(input, sameEncryption)
    const { encrypted: encrypted2 } = encryptValue(input, sameEncryption)

    expect(encrypted1).toBe(encrypted2)
  })

  it('should correctly return the type of the encrypted value', () => {
    const stringInput = 'string test'
    const { type: stringType } = encryptValue(stringInput, encryption)
    expect(stringType).toBe('string')

    const numberInput = 12345
    const { type: numberType } = encryptValue(numberInput, encryption)
    expect(numberType).toBe('number')

    const objectInput = { test: 'object test' }
    const { type: objectType } = encryptValue(objectInput, encryption)
    expect(objectType).toBe('object')
  })

  it('should throw an error when decrypting with incorrect encryption config', () => {
    const input = 'test value'
    const { encrypted, type } = encryptValue(input, encryption)

    const wrongEncryption = {
      algo: 'aes-256-cbc',
      initVector: crypto.randomBytes(16),  // Different IV
      securityKey: encryption.securityKey
    }

    expect(() => {
      decryptValue(encrypted, type, wrongEncryption)
    }).toThrow()
  })
})

describe('Combined utility functions', () => {
  it('should work correctly when compressing and then encrypting data', () => {
    const input = { name: 'test', value: 12345, nested: { prop: 'value' } }

    // Simulate what happens inside the cache
    const compressed = compressValue(input)
    const { encrypted, type } = encryptValue(compressed, encryption)

    // Reverse the process
    const decrypted: string = decryptValue(encrypted, type, encryption)
    const decompressed = JSON.parse(decompressValue(decrypted))

    expect(decompressed).toEqual(input)
  })
})