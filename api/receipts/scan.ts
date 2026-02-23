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

For the total: Use the FINAL total including tax, not the subtotal. If multiple total-like numbers appear, use the largest one and note the ambiguity in confidence.

If this is a multi-page document, look across all pages for receipt information. The total, date, and vendor are typically on the first or last page.`

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
    // 2a. Authenticate
    const auth = await authenticateRequest(req)
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const { tenantId } = auth

    // 2b. Rate limit check
    const rateCheck = await checkRateLimit(tenantId, RECEIPT_SCAN_LIMITS)
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        limitHit: rateCheck.limitHit,
        retryAfterSeconds: rateCheck.retryAfterSeconds,
      })
    }

    // 2c. Validate blobUrl
    const { blobUrl } = req.body || {}

    if (!blobUrl || typeof blobUrl !== 'string') {
      return res.status(400).json({ error: 'blobUrl is required' })
    }

    if (!blobUrl.includes('.public.blob.vercel-storage.com')) {
      return res.status(400).json({ error: 'Invalid blob URL' })
    }

    // 2d. Fetch the image
    const imageResponse = await fetch(blobUrl)
    if (!imageResponse.ok) {
      return res.status(400).json({ error: 'Failed to fetch image from storage' })
    }

    const contentType = imageResponse.headers.get('content-type') || ''
    const supportedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
    const isPdf = contentType.includes('application/pdf')

    if (!isPdf && !supportedImageTypes.some(t => contentType.includes(t))) {
      return res.status(400).json({
        error: 'Unsupported file type for scanning. Please use JPEG, PNG, WebP images, or PDF documents.',
        fileType: contentType,
      })
    }

    const imageBuffer = await imageResponse.arrayBuffer()
    const base64Data = Buffer.from(imageBuffer).toString('base64')

    // Determine the media type for the API (normalize content-type)
    const mediaType = contentType.split(';')[0].trim()

    // 2e. Call Claude Vision API
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
          content: [
            isPdf
              ? {
                  type: 'document' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: 'application/pdf' as const,
                    data: base64Data,
                  },
                }
              : {
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
          ],
        }],
      }),
    })

    // 2g. Parse response and handle errors
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

    // Parse the JSON response — Claude sometimes wraps in backticks despite instructions
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

    // 2h. Record usage and return
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
