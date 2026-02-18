import { useState } from 'react'

export interface ScanField {
  value: string | number | null
  confidence: number
}

export interface ScanResult {
  vendor: ScanField
  date: ScanField
  total: ScanField
  subtotal: ScanField
  tax: ScanField
  paymentMethod: ScanField
  lineItems: Array<{ description: string; amount: number; quantity: number }>
  rawText: string
}

export interface UseScanReceiptReturn {
  scanResult: ScanResult | null
  isScanning: boolean
  scanError: string | null
  scanReceipt: (blobUrl: string, tenantSubdomain: string) => Promise<ScanResult | null>
  clearScan: () => void
}

export function useScanReceipt(): UseScanReceiptReturn {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  const scanReceipt = async (blobUrl: string, tenantSubdomain: string): Promise<ScanResult | null> => {
    setIsScanning(true)
    setScanError(null)

    try {
      const response = await fetch(`/api/receipts/scan?tenant=${tenantSubdomain}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ blobUrl }),
      })

      if (response.status === 429) {
        const data = await response.json()
        const minutes = Math.ceil((data.retryAfterSeconds || 60) / 60)
        setScanError(`Scanning limit reached. Try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`)
        return null
      }

      if (!response.ok) {
        const data = await response.json()
        setScanError(data.error || 'Failed to scan receipt')
        return null
      }

      const data = await response.json()
      if (data.success && data.data) {
        setScanResult(data.data)
        return data.data
      } else {
        setScanError('Unexpected response from scanner')
        return null
      }
    } catch {
      setScanError('Network error — please try again')
      return null
    } finally {
      setIsScanning(false)
    }
  }

  const clearScan = () => {
    setScanResult(null)
    setScanError(null)
  }

  return { scanResult, isScanning, scanError, scanReceipt, clearScan }
}
