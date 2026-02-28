import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authenticateRequest } from '../_lib/auth.js'
import { checkRateLimit, recordUsage, RECEIPT_SCAN_LIMITS } from '../_lib/rate-limit.js'

// ===========================================
// Receipt scan prompt for Claude Vision
// ===========================================
const RECEIPT_SCAN_PROMPT = `You are a receipt data extraction assistant. Analyze this receipt image and extract the following information. Return your response as a JSON object with EXACTLY this structure — no markdown, no backticks, no explanation, ONLY the JSON:

{
  "vendor": {
    "value": "Store/business name as it appears on the receipt",
    "confidence": 0.0 to 1.0
  },
  "date": {
    "value": "YYYY-MM-DD format",
    "confidence": 0.0 to 1.0
  },
  "total": {
    "value": "Total amount as a number (e.g., 45.99, not $45.99)",
    "confidence": 0.0 to 1.0
  },
  "subtotal": {
    "value": "Subtotal before tax as a number, or null if not visible",
    "confidence": 0.0 to 1.0
  },
  "tax": {
    "value": "Tax amount as a number, or null if not visible",
    "confidence": 0.0 to 1.0
  },
  "paymentMethod": {
    "value": "VISA, MASTERCARD, AMEX, CASH, DEBIT, CHECK, or null if not visible",
    "confidence": 0.0 to 1.0
  },
  "lineItems": [
    {
      "description": "Item description",
      "amount": 0.00,
      "quantity": 1
    }
  ],
  "rawText": "Complete text content of the receipt, preserving line breaks"
}

Confidence scoring guide:
- 1.0: Clearly printed, unambiguous
- 0.8-0.9: Mostly clear, minor ambiguity
- 0.5-0.7: Partially obscured, faded, or ambiguous
- Below 0.5: Guessing based on context

If a field is completely unreadable or not present, set value to null and confidence to 0.

For the date: If the year is not visible, assume the current year. If the date format is ambiguous (e.g., 03/04/2025 could be March 4 or April 3), prefer MM/DD/YYYY format (US standard) and set confidence to 0.7.

For the total: Use the FINAL total including tax, not the subtotal. If multiple total-like numbers appear, use the largest one and note the ambiguity in confidence.`

const MULTI_PAGE_PROMPT = `You are a receipt data extraction assistant. The following images are sequential pages from the same PDF receipt/invoice. Look across ALL pages to find the vendor, date, and total. Return your response as a JSON object with EXACTLY this structure — no markdown, no backticks, no explanation, ONLY the JSON:

{
  "vendor": {
    "value": "Store/business name as it appears on the receipt",
    "confidence": 0.0 to 1.0
  },
  "date": {
    "value": "YYYY-MM-DD format",
    "confidence": 0.0 to 1.0
  },
  "total": {
    "value": "Total amount as a number (e.g., 45.99, not $45.99)",
    "confidence": 0.0 to 1.0
  },
  "subtotal": {
    "value": "Subtotal before tax as a number, or null if not visible",
    "confidence": 0.0 to 1.0
  },
  "tax": {
    "value": "Tax amount as a number, or null if not visible",
    "confidence": 0.0 to 1.0
  },
  "paymentMethod": {
    "value": "VISA, MASTERCARD, AMEX, CASH, DEBIT, CHECK, or null if not visible",
    "confidence": 0.0 to 1.0
  },
  "lineItems": [
    {
      "description": "Item description",
      "amount": 0.00,
      "quantity": 1
    }
  ],
  "rawText": "Complete text content of the receipt from all pages, preserving line breaks"
}

Confidence scoring guide:
- 1.0: Clearly printed, unambiguous
- 0.8-0.9: Mostly clear, minor ambiguity
- 0.5-0.7: Partially obscured, faded, or ambiguous
- Below 0.5: Guessing based on context

If a field is completely unreadable or not present, set value to null and confidence to 0.

For the date: If the year is not visible, assume the current year. If the date format is ambiguous (e.g., 03/04/2025 could be March 4 or April 3), prefer MM/DD/YYYY format (US standard) and set confidence to 0.7.

For the total: Use the FINAL total including tax, not the subtotal. The total may appear on a different page than the line items.`

// ===========================================
// PDF rendering helpers (using pdf.js)
// ===========================================

/**
 * Render a single PDF page to a JPEG base64 string.
 * Uses pdf.js with canvas rendering on the server.
 */
async function renderPdfPageToJpeg(pdfBuffer: ArrayBuffer, pageNum: number, scale: number = 2.0): Promise<string | null> {
  try {
    // Dynamic import of pdf.js (server-side, no worker needed)
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')

    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) })
    const pdf = await loadingTask.promise

    if (pageNum > pdf.numPages) return null

    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale })

    // Create a canvas using the canvas package (server-side)
    const { createCanvas } = await import('canvas')
    const canvas = createCanvas(viewport.width, viewport.height)
    const context = canvas.getContext('2d')

    await page.render({
      canvasContext: context as any,
      viewport,
    }).promise

    // Convert to JPEG base64
    const jpegBuffer = canvas.toBuffer('image/jpeg', { quality: 0.90 })
    return jpegBuffer.toString('base64')
  } catch (err) {
    console.error(`Failed to render PDF page ${pageNum}:`, err)
    return null
  }
}

/**
 * Get total page count from a PDF buffer.
 */
async function getPdfPageCount(pdfBuffer: ArrayBuffer): Promise<number> {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) })
    const pdf = await loadingTask.promise
    return pdf.numPages
  } catch {
    return 0
  }
}

// ===========================================
// Claude Vision API call helpers
// ===========================================

async function callClaudeVision(contentBlocks: any[], apiKey: string): Promise<any> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: contentBlocks,
      }],
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Anthropic API error:', response.status, errorBody)
    throw new Error('Receipt scanning service unavailable')
  }

  const data = await response.json()
  const textContent = data.content?.find((block: any) => block.type === 'text')

  if (!textContent?.text) {
    throw new Error('No response from scanning service')
  }

  // Parse JSON — Claude sometimes wraps in backticks despite instructions
  const cleanJson = textContent.text
    .replace(/^```json?\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim()
  return JSON.parse(cleanJson)
}

function isTotalMissing(scanResult: any): boolean {
  if (!scanResult?.total) return true
  if (scanResult.total.value === null || scanResult.total.value === undefined) return true
  if (typeof scanResult.total.confidence === 'number' && scanResult.total.confidence < 0.5) return true
  return false
}

// ===========================================
// POST: Scan a receipt image using Claude Vision
// ===========================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Guard: API key must be configured
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not configured')
    return res.status(503).json({ error: 'Receipt scanning not configured' })
  }

  try {
    // Authenticate
    const auth = await authenticateRequest(req)
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const { tenantId } = auth

    // Rate limit check
    const rateCheck = await checkRateLimit(tenantId, RECEIPT_SCAN_LIMITS)
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        limitHit: rateCheck.limitHit,
        retryAfterSeconds: rateCheck.retryAfterSeconds,
      })
    }

    // Validate blobUrl
    const { blobUrl } = req.body || {}

    if (!blobUrl || typeof blobUrl !== 'string') {
      return res.status(400).json({ error: 'blobUrl is required' })
    }

    if (!blobUrl.includes('.public.blob.vercel-storage.com')) {
      return res.status(400).json({ error: 'Invalid blob URL' })
    }

    // Fetch the file
    const fileResponse = await fetch(blobUrl)
    if (!fileResponse.ok) {
      return res.status(400).json({ error: 'Failed to fetch file from storage' })
    }

    const contentType = fileResponse.headers.get('content-type') || ''
    const supportedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
    const isPdf = contentType.includes('application/pdf')

    if (!isPdf && !supportedImageTypes.some(t => contentType.includes(t))) {
      return res.status(400).json({
        error: 'Unsupported file type for scanning. Please use JPEG, PNG, WebP images, or PDF documents.',
        fileType: contentType,
      })
    }

    const fileBuffer = await fileResponse.arrayBuffer()
    const apiKey = process.env.ANTHROPIC_API_KEY!
    let scanResult: any

    if (!isPdf) {
      // ==========================================
      // IMAGE PATH: Direct base64 to Claude Vision
      // ==========================================
      const base64Data = Buffer.from(fileBuffer).toString('base64')
      const mediaType = contentType.split(';')[0].trim()

      const contentBlocks = [
        {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: mediaType,
            data: base64Data,
          },
        },
        {
          type: 'text' as const,
          text: RECEIPT_SCAN_PROMPT,
        },
      ]

      scanResult = await callClaudeVision(contentBlocks, apiKey)
    } else {
      // ==========================================
      // PDF PATH: Convert to JPEG, attempt page 1,
      // then auto-fallback to pages 1+2
      // ==========================================

      // Attempt 1: Render page 1 as JPEG
      const page1Jpeg = await renderPdfPageToJpeg(fileBuffer, 1)

      if (!page1Jpeg) {
        return res.status(400).json({ error: 'Failed to render PDF. The file may be corrupted or password-protected.' })
      }

      const page1Content = [
        {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: 'image/jpeg' as const,
            data: page1Jpeg,
          },
        },
        {
          type: 'text' as const,
          text: RECEIPT_SCAN_PROMPT,
        },
      ]

      scanResult = await callClaudeVision(page1Content, apiKey)

      // Attempt 2: If total is missing/low-confidence and there's a page 2, send both pages
      if (isTotalMissing(scanResult)) {
        const totalPages = await getPdfPageCount(fileBuffer)

        if (totalPages >= 2) {
          const page2Jpeg = await renderPdfPageToJpeg(fileBuffer, 2)

          if (page2Jpeg) {
            console.log(`PDF scan fallback: page 1 total was ${scanResult?.total?.value ?? 'null'} (confidence: ${scanResult?.total?.confidence ?? 'N/A'}). Retrying with pages 1+2.`)

            const multiPageContent = [
              {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'image/jpeg' as const,
                  data: page1Jpeg,
                },
              },
              {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'image/jpeg' as const,
                  data: page2Jpeg,
                },
              },
              {
                type: 'text' as const,
                text: MULTI_PAGE_PROMPT,
              },
            ]

            // This counts as a second API call but not a second rate limit hit —
            // the user initiated one scan action
            scanResult = await callClaudeVision(multiPageContent, apiKey)
          }
        }
      }
    }

    // Record usage and return
    await recordUsage(tenantId, 'receipt_scan')

    return res.status(200).json({
      success: true,
      data: scanResult,
    })
  } catch (error) {
    console.error('Error in receipt scan API:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return res.status(500).json({ error: message })
  }
}
