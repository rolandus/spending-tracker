import { describe, it, expect } from 'vitest'
import { importFidelity } from '../fidelity'

const HEADER =
  'Run Date,Account,Account Number,Action,Symbol,Description,Type,Price ($),Quantity,Commission ($),Fees ($),Accrued Interest ($),Amount ($),Settlement Date'

function csv(...rows: string[]) {
  // Fidelity CSVs have 2 blank lines before the header
  return ['\n', '\n', HEADER, ...rows].join('\n')
}

describe('importFidelity', () => {
  it('imports direct deposit rows', () => {
    const result = importFidelity(
      csv(
        '09/29/2025,"Individual","X96665077","DIRECT DEPOSIT Handshake-OS0000656581 (Cash)", ,"No Description",Cash,,0.000,,,,1150,',
      ),
      1,
      'fidelity.csv',
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.amount).toBe(1150)
    expect(result[0]!.date).toBe('2025-09-29')
    expect(result[0]!.description).toBe('DIRECT DEPOSIT Handshake-OS0000656581')
    expect(result[0]!.paymentMethod).toBe('direct_deposit')
  })

  it('filters out non-direct-deposit rows', () => {
    const result = importFidelity(
      csv(
        '12/31/2025,"Individual","X96665077","REINVESTMENT FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash)",SPAXX,"FIDELITY GOVERNMENT MONEY MARKET",Cash,1,345.65,,,,-345.65,',
        '12/31/2025,"Individual","X96665077","DIVIDEND RECEIVED FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash)",SPAXX,"FIDELITY GOVERNMENT MONEY MARKET",Cash,,0.000,,,,345.65,',
        '09/29/2025,"Individual","X96665077","DIRECT DEPOSIT Handshake-OS0000656581 (Cash)", ,"No Description",Cash,,0.000,,,,1150,',
        '11/07/2025,"Individual","X96665077","YOU SOLD WALMART INC COM (WMT) (Cash)",WMT,"WALMART INC COM",Cash,102.68,-34,,,,3491.1,11/10/2025',
      ),
      1,
      'fidelity.csv',
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.description).toBe('DIRECT DEPOSIT Handshake-OS0000656581')
  })

  it('strips (Cash) suffix from description', () => {
    const result = importFidelity(
      csv(
        '09/03/2025,"Individual","X96665077","DIRECT DEPOSIT CHARLES SCHWACCTVERIFY (Cash)", ,"No Description",Cash,,0.000,,,,0.1,',
      ),
      1,
      'fidelity.csv',
    )
    expect(result[0]!.description).toBe('DIRECT DEPOSIT CHARLES SCHWACCTVERIFY')
  })

  it('sets transactionType to unknown', () => {
    const result = importFidelity(
      csv(
        '01/14/2025,"Individual","X96665077","DIRECT DEPOSIT Handshake-OS0000572425 (Cash)", ,"No Description",Cash,,0.000,,,,1150,',
      ),
      1,
      'fidelity.csv',
    )
    expect(result[0]!.transactionType).toBe('unknown')
  })

  it('throws on invalid header', () => {
    expect(() => importFidelity('Bad,Header\n1,2', 1, 'fidelity.csv')).toThrow(
      'Invalid Fidelity CSV',
    )
  })

  it('returns empty array when no direct deposits exist', () => {
    const result = importFidelity(
      csv(
        '12/31/2025,"Individual","X96665077","DIVIDEND RECEIVED FIDELITY GOVERNMENT MONEY MARKET (SPAXX) (Cash)",SPAXX,"FIDELITY GOVERNMENT MONEY MARKET",Cash,,0.000,,,,345.65,',
      ),
      1,
      'fidelity.csv',
    )
    expect(result).toHaveLength(0)
  })
})
