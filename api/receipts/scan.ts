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
// Fetch and validate a blob URL, return base64 + media type
// ===========================================
async function fetchImageAsBase64(blobUrl: string): Promise<{ base64: string; mediaType: string } | null> {
  if (!blobUrl.includes('.public.blob.vercel-storage.com')) return null

  const response = await fetch(blobUrl)
  if (!response.ok) return null

  const contentType = response.headers.get('content-type') || ''
  const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
  if (!supportedTypes.some(t => contentType.includes(t))) return null

  const buffer = await response.arrayBuffer()
  return {
    base64: Buffer.from(buffer).toString('base64'),
    mediaType: contentType.split(';')[0].trim(),
  }
}

// ===========================================
// POST: Scan a receipt image using Claude Vision
// ===========================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

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

    // Validate primary blobUrl
    const { blobUrl, blobUrl2 } = req.body || {}

    if (!blobUrl || typeof blobUrl !== 'string') {
      return res.status(400).json({ error: 'blobUrl is required' })
    }

    // Fetch primary image
    const image1 = await fetchImageAsBase64(blobUrl)
    if (!image1) {
      return res.status(400).json({
        error: 'Failed to fetch image from storage. Only JPEG, PNG, and WebP images are supported.',
      })
    }

    // Build content blocks for Claude Vision
    const contentBlocks: any[] = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: image1.mediaType,
          data: image1.base64,
        },
      },
    ]

    // If second image provided (multi-page PDF fallback), add it
    let isMultiPage = false
    if (blobUrl2 && typeof blobUrl2 === 'string') {
      const image2 = await fetchImageAsBase64(blobUrl2)
      if (image2) {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: image2.mediaType,
            data: image2.base64,
          },
        })
        isMultiPage = true
      }
    }

    // Add the appropriate prompt
    contentBlocks.push({
      type: 'text',
      text: isMultiPage ? MULTI_PAGE_PROMPT : RECEIPT_SCAN_PROMPT,
    })

    // Call Claude Vision API
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
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

    if (!anthropicResponse.ok) {
      const errorBody = await anthropicResponse.text()
      console.error('Anthropic API error:', anthropicResponse.status, errorBody)
      return res.status(500).json({ error: 'Receipt scanning service unavailable' })
    }

    const anthropicData = await anthropicResponse.json()
    const textContent = anthropicData.content?.find((block: any) => block.type === 'text')

    if (!textContent?.text) {
      return res.status(500).json({ error: 'No response from scanning service' })
    }

    // Parse the JSON response
    let scanResult
    try {
      const cleanJson = textContent.text
        .replace(/^```json?\n?/i, '')
        .replace(/\n?```$/i, '')
        .trim()
      scanResult = JSON.parse(cleanJson)
    } catch {
      console.error('Failed to parse scan result:', textContent.text)
      return res.status(500).json({ error: 'Failed to parse receipt data' })
    }

    // Record usage and return
    await recordUsage(tenantId, 'receipt_scan')

    return res.status(200).json({
      success: true,
      data: scanResult,
    })
  } catch (error) {
    console.error('Error in receipt scan API:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
