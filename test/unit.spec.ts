import crypto from 'crypto'
import { compressValue, decompressValue, decryptValue, encryptValue, md5 } from '../src'

const encryption = {
  algo: 'aes-256-cbc',
  initVector: crypto.randomBytes(16),
  securityKey: crypto.randomBytes(32)
}

const input = {
  prop1: 'value',
  prop2: 12345.6789,
  prop3: 'value',
  prop4: 12345.6789,
  prop5: 'value',
  prop6: 12345.6789
}

describe('unit tests', () => {
  it('should create an md5 hash', () => {
    const hash1 = md5('testing')
    expect(hash1).toBe('ae2b1fca515949e5d54fb22b8ed95575')
    const hash2 = md5('very-long-string-that-you-might-want-to-be-shorter')
    expect(hash2).toBe('b03b42e1117fe5965ec9f53024e90f04')
  })

  it('should compress and decompress a value', () => {
    const compressed = compressValue('testing')
    const decompressed = decompressValue(compressed)
    expect(decompressed).toBe(JSON.stringify('testing'))
  })

  it('should encrypt and decrypt a value', () => {
    const stringInput = 'encrypted string value test'
    const { encrypted: encryptedString, type: typeString } = encryptValue(stringInput, encryption)
    const decryptedString = decryptValue(encryptedString, typeString, encryption)
    expect(decryptedString).toBe(stringInput)

    const objectInput = { test: 'encrypted object value test' }
    const { encrypted: encryptedObject, type: typeObject } = encryptValue(objectInput, encryption)
    const decryptedObject = decryptValue(encryptedObject, typeObject, encryption)
    expect(decryptedObject).toEqual(objectInput)

    const numberInput = 12345.6789
    const { encrypted: encryptedNumber, type: typeNumber } = encryptValue(numberInput, encryption)
    const decryptedNumber = decryptValue(encryptedNumber, typeNumber, encryption)
    expect(decryptedNumber).toBe(numberInput)
  })
})
