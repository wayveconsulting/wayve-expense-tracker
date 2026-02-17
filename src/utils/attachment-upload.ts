import { upload } from '@vercel/blob/client'

// ============================================
// Types
// ============================================

export interface PendingAttachment {
  blobUrl: string
  fileName: string
  fileType: string
  fileSize: number
}

export interface UploadProgress {
  status: 'idle' | 'compressing' | 'uploading' | 'done' | 'error'
  message?: string
}

// ============================================
// Constants
// ============================================

const COMPRESSION_THRESHOLD = 4 * 1024 * 1024 // 4MB — compress if larger
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024       // 10MB — reject if larger (pre-compression)
const MAX_DIMENSION = 2048                      // Resize longest edge to this

export const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']
export const ALLOWED_FILE_ACCEPT = 'image/jpeg,image/png,image/heic,image/webp,application/pdf'

// ============================================
// Client-side image compression via Canvas API
// Only compresses images over 4MB. PDFs and small files pass through.
// ============================================

export async function compressImageFile(file: File): Promise<File> {
  // PDFs: never compress
  if (file.type === 'application/pdf') return file

  // Images under threshold: pass through untouched
  if (file.size <= COMPRESSION_THRESHOLD) return file

  // Image over 4MB — compress via Canvas API
  const img = await loadImage(file)
  const qualitySteps = [0.92, 0.85, 0.75]

  for (const quality of qualitySteps) {
    const compressedBlob = await resizeAndCompress(img, quality)

    if (compressedBlob.size <= COMPRESSION_THRESHOLD) {
      const compressedName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
      return new File([compressedBlob], compressedName, { type: 'image/jpeg' })
    }
  }

  // Even at 75% quality it's still over 4MB — use the last attempt anyway
  const lastBlob = await resizeAndCompress(img, 0.75)
  const compressedName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([lastBlob], compressedName, { type: 'image/jpeg' })
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      resolve(img)
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

async function resizeAndCompress(img: HTMLImageElement, quality: number): Promise<Blob> {
  let { width, height } = img
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    if (width > height) {
      height = Math.round(height * (MAX_DIMENSION / width))
      width = MAX_DIMENSION
    } else {
      width = Math.round(width * (MAX_DIMENSION / height))
      height = MAX_DIMENSION
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, width, height)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error('Canvas compression failed')),
      'image/jpeg',
      quality
    )
  })
}

// ============================================
// Format file size for display
// ============================================

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ============================================
// Validate a file for upload
// Returns error message or null if valid
// ============================================

export function validateFile(file: File): string | null {
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return 'File type not allowed. Accepted: JPEG, PNG, HEIC, WebP, PDF'
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    return 'File too large. Maximum size is 10MB.'
  }
  return null
}

// ============================================
// Upload a file to Vercel Blob (compress first if needed)
// Does NOT call POST /api/attachments — that happens separately
// ============================================

export async function uploadToBlob(
  file: File,
  tenantSubdomain: string,
  blobPathPrefix: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<PendingAttachment> {
  // Step 1: Compress if needed (images >4MB)
  let fileToUpload = file
  if (file.size > COMPRESSION_THRESHOLD && file.type.startsWith('image/')) {
    onProgress?.({ status: 'compressing', message: 'Compressing image...' })
    fileToUpload = await compressImageFile(file)
    const savedPct = Math.round((1 - fileToUpload.size / file.size) * 100)
    onProgress?.({
      status: 'uploading',
      message: `Compressed: ${formatFileSize(file.size)} → ${formatFileSize(fileToUpload.size)} (${savedPct}% smaller) • Uploading...`,
    })
  } else {
    onProgress?.({ status: 'uploading', message: 'Uploading...' })
  }

  // Step 2: Upload directly to Vercel Blob via client upload
  const blobPath = `${blobPathPrefix}/${Date.now()}-${fileToUpload.name}`
  const blob = await upload(blobPath, fileToUpload, {
    access: 'public',
    handleUploadUrl: `/api/attachments/upload?tenant=${tenantSubdomain}`,
  })

  onProgress?.({ status: 'done' })

  return {
    blobUrl: blob.url,
    fileName: fileToUpload.name,
    fileType: fileToUpload.type,
    fileSize: fileToUpload.size,
  }
}

// ============================================
// Link a blob attachment to an expense (POST /api/attachments)
// ============================================

export async function linkAttachmentToExpense(
  attachment: PendingAttachment,
  expenseId: string,
  tenantSubdomain: string
): Promise<void> {
  const response = await fetch(`/api/attachments?tenant=${tenantSubdomain}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expenseId,
      blobUrl: attachment.blobUrl,
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      fileSize: attachment.fileSize,
    }),
  })

  if (!response.ok) {
    const data = await response.json()
    throw new Error(data.error || 'Failed to link attachment')
  }
}
