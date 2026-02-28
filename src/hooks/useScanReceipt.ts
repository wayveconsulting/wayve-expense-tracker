import { useState } from 'react'
import { uploadToBlob } from '../utils/attachment-upload'
import { renderPdfPageToJpeg, getPdfPageCount } from '../utils/pdf-to-jpeg'

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
  scanReceipt: (blobUrl: string, tenantSubdomain: string, fileType?: string) => Promise<ScanResult | null>
  clearScan: () => void
}

function isTotalMissing(result: ScanResult): boolean {
  if (!result?.total) return true
  if (result.total.value === null || result.total.value === undefined) return true
  if (typeof result.total.confidence === 'number' && result.total.confidence < 0.5) return true
  return false
}

async function callScanEndpoint(
  blobUrl: string,
  tenantSubdomain: string,
  blobUrl2?: string
): Promise<{ success: boolean; data?: ScanResult; error?: string; status: number }> {
  const body: Record<string, string> = { blobUrl }
  if (blobUrl2) body.blobUrl2 = blobUrl2

  const response = await fetch(`/api/receipts/scan?tenant=${tenantSubdomain}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  })

  const data = await response.json()
  return { ...data, status: response.status }
}

/**
 * Delete a temporary blob URL from Vercel Blob storage.
 * Fire-and-forget — failures are logged but don't block the scan flow.
 */
async function deleteTempBlob(blobUrl: string, tenantSubdomain: string) {
  try {
    await fetch(`/api/attachments/cleanup?tenant=${tenantSubdomain}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ blobUrl }),
    })
  } catch (err) {
    console.error('Failed to clean up temp scan blob:', err)
  }
}

export function useScanReceipt(): UseScanReceiptReturn {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  const scanReceipt = async (
    blobUrl: string,
    tenantSubdomain: string,
    fileType?: string
  ): Promise<ScanResult | null> => {
    setIsScanning(true)
    setScanError(null)

    const tempBlobUrls: string[] = []

    try {
      const isPdf = fileType === 'application/pdf'

      if (!isPdf) {
        // ==========================================
        // IMAGE PATH: Send directly to scan endpoint
        // ==========================================
        const result = await callScanEndpoint(blobUrl, tenantSubdomain)

        if (result.status === 429) {
          const minutes = Math.ceil(((result as any).retryAfterSeconds || 60) / 60)
          setScanError(`Scanning limit reached. Try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`)
          return null
        }

        if (!result.success || !result.data) {
          setScanError(result.error || 'Failed to scan receipt')
          return null
        }

        setScanResult(result.data)
        return result.data
      }

      // ==========================================
      // PDF PATH: Convert to JPEG client-side
      // ==========================================

      // Fetch the PDF from Vercel Blob
      const pdfResponse = await fetch(blobUrl)
      if (!pdfResponse.ok) {
        setScanError('Failed to fetch PDF for scanning')
        return null
      }
      const pdfData = await pdfResponse.arrayBuffer()

      // Render page 1 to JPEG
      const page1File = await renderPdfPageToJpeg(pdfData, 1)
      if (!page1File) {
        setScanError('Failed to render PDF. The file may be corrupted or password-protected.')
        return null
      }

      // Upload page 1 JPEG to Vercel Blob (temp)
      const blobPathPrefix = `${tenantSubdomain}/temp-scan`
      const page1Blob = await uploadToBlob(page1File, tenantSubdomain, blobPathPrefix)
      const page1BlobUrl = page1Blob.blobUrl
      tempBlobUrls.push(page1BlobUrl)

      // Attempt 1: Scan page 1
      const result1 = await callScanEndpoint(page1BlobUrl, tenantSubdomain)

      if (result1.status === 429) {
        const minutes = Math.ceil(((result1 as any).retryAfterSeconds || 60) / 60)
        setScanError(`Scanning limit reached. Try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`)
        return null
      }

      if (!result1.success || !result1.data) {
        setScanError(result1.error || 'Failed to scan receipt')
        return null
      }

      // Check if we got a good total
      if (!isTotalMissing(result1.data)) {
        setScanResult(result1.data)
        return result1.data
      }

      // Attempt 2: Page 1 total was missing/low-confidence — try pages 1+2
      const totalPages = await getPdfPageCount(pdfData)
      if (totalPages < 2) {
        // Only 1 page, return what we got
        setScanResult(result1.data)
        return result1.data
      }

      const page2File = await renderPdfPageToJpeg(pdfData, 2)
      if (!page2File) {
        // Page 2 render failed, return page 1 results
        setScanResult(result1.data)
        return result1.data
      }

      // Upload page 2 JPEG to Vercel Blob (temp)
      const page2Blob = await uploadToBlob(page2File, tenantSubdomain, blobPathPrefix)
      const page2BlobUrl = page2Blob.blobUrl
      tempBlobUrls.push(page2BlobUrl)

      // Send both pages to scan endpoint
      const result2 = await callScanEndpoint(page1BlobUrl, tenantSubdomain, page2BlobUrl)

      if (result2.status === 429) {
        const minutes = Math.ceil(((result2 as any).retryAfterSeconds || 60) / 60)
        setScanError(`Scanning limit reached. Try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`)
        return null
      }

      if (!result2.success || !result2.data) {
        // Fallback: return page 1 results if page 1+2 call failed
        setScanResult(result1.data)
        return result1.data
      }

      setScanResult(result2.data)
      return result2.data
    } catch (err) {
      console.error('Scan error:', err)
      setScanError('Network error — please try again')
      return null
    } finally {
      setIsScanning(false)
      // Clean up temp blobs in the background
      for (const url of tempBlobUrls) {
        deleteTempBlob(url, tenantSubdomain)
      }
    }
  }

  const clearScan = () => {
    setScanResult(null)
    setScanError(null)
  }

  return { scanResult, isScanning, scanError, scanReceipt, clearScan }
}
