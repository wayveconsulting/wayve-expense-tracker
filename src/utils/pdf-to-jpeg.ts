/**
 * Client-side PDF to JPEG conversion using pdf.js.
 * Lazy-loads pdf.js only when needed (not in the main bundle).
 * Renders PDF pages to canvas and returns JPEG File objects.
 */

let pdfjsLib: any = null

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib
  // Dynamic import — only loaded when a PDF scan is triggered
  pdfjsLib = await import('pdfjs-dist')
  // Use the worker bundled with the pdfjs-dist package (Vite handles the import)
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
  return pdfjsLib
}

/**
 * Render a single PDF page to a JPEG File object.
 * @param pdfData - ArrayBuffer of the PDF file
 * @param pageNum - 1-indexed page number
 * @param scale - Render scale (2.0 = 2x resolution for clarity)
 * @returns File object (JPEG) or null if page doesn't exist
 */
export async function renderPdfPageToJpeg(
  pdfData: ArrayBuffer,
  pageNum: number,
  scale: number = 2.0
): Promise<File | null> {
  try {
    const lib = await loadPdfJs()
    const pdf = await lib.getDocument({ data: new Uint8Array(pdfData) }).promise

    if (pageNum > pdf.numPages) return null

    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const context = canvas.getContext('2d')!

    await page.render({ canvasContext: context, viewport }).promise

    // Convert canvas to JPEG blob
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.90)
    })

    if (!blob) return null

    // Create a File object so it's compatible with uploadToBlob
    const fileName = `pdf-scan-page${pageNum}.jpg`
    return new File([blob], fileName, { type: 'image/jpeg' })
  } catch (err) {
    console.error(`Failed to render PDF page ${pageNum}:`, err)
    return null
  }
}

/**
 * Get the total number of pages in a PDF.
 */
export async function getPdfPageCount(pdfData: ArrayBuffer): Promise<number> {
  try {
    const lib = await loadPdfJs()
    const pdf = await lib.getDocument({ data: new Uint8Array(pdfData) }).promise
    return pdf.numPages
  } catch {
    return 0
  }
}
