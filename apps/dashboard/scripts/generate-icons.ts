import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '../public')
const svgPath = join(publicDir, 'icon.svg')
const svgBuffer = readFileSync(svgPath)

async function generatePng(size: number, name: string) {
  const out = join(publicDir, name)
  await sharp(svgBuffer).resize(size, size).png().toFile(out)
  console.log(`Generated ${name} (${size}×${size})`)
}

async function generateFavicon() {
  // Generate a 32×32 PNG first, then wrap it as ico
  const pngBuffer = await sharp(svgBuffer).resize(32, 32).png().toBuffer()

  // Minimal ICO: 1-image, 32×32, 32bpp (RGBA)
  const rgba = await sharp(pngBuffer).raw().ensureAlpha().toBuffer()
  const width = 32
  const height = 32
  const bmpDataSize = 40 + width * height * 4
  const icoSize = 6 + 16 + bmpDataSize

  const buf = Buffer.alloc(icoSize)
  let offset = 0

  // ICO header
  buf.writeUInt16LE(0, offset); offset += 2 // reserved
  buf.writeUInt16LE(1, offset); offset += 2 // type: icon
  buf.writeUInt16LE(1, offset); offset += 2 // image count

  // Image directory entry
  buf.writeUInt8(width, offset); offset += 1
  buf.writeUInt8(height, offset); offset += 1
  buf.writeUInt8(0, offset); offset += 1  // color palette
  buf.writeUInt8(0, offset); offset += 1  // reserved
  buf.writeUInt16LE(1, offset); offset += 2 // color planes
  buf.writeUInt16LE(32, offset); offset += 2 // bits per pixel
  buf.writeUInt32LE(bmpDataSize, offset); offset += 4 // size of image data
  buf.writeUInt32LE(6 + 16, offset); offset += 4 // offset to image data

  // BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(40, offset); offset += 4 // header size
  buf.writeInt32LE(width, offset); offset += 4
  buf.writeInt32LE(height * 2, offset); offset += 4 // negative = top-down; positive = bottom-up for ico
  buf.writeUInt16LE(1, offset); offset += 2  // planes
  buf.writeUInt16LE(32, offset); offset += 2 // bits per pixel
  buf.writeUInt32LE(0, offset); offset += 4  // compression (none)
  buf.writeUInt32LE(0, offset); offset += 4  // image size (0 for uncompressed)
  buf.writeInt32LE(0, offset); offset += 4   // x pixels per meter
  buf.writeInt32LE(0, offset); offset += 4   // y pixels per meter
  buf.writeUInt32LE(0, offset); offset += 4  // colors in table
  buf.writeUInt32LE(0, offset); offset += 4  // important colors

  // Pixel data: ICO BMP is bottom-up, BGRA
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4
      buf[offset++] = rgba[src + 2]! // B
      buf[offset++] = rgba[src + 1]! // G
      buf[offset++] = rgba[src + 0]! // R
      buf[offset++] = rgba[src + 3]! // A
    }
  }

  const out = join(publicDir, 'favicon.ico')
  writeFileSync(out, buf)
  console.log('Generated favicon.ico (32×32)')
}

async function main() {
  await generatePng(32, 'icon-32.png')
  await generatePng(180, 'apple-touch-icon.png')
  await generatePng(192, 'icon-192.png')
  await generatePng(512, 'icon-512.png')
  await generateFavicon()
  console.log('All icons generated.')
}

main().catch(err => { console.error(err); process.exit(1) })
