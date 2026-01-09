import { NextRequest, NextResponse } from 'next/server'
import wawoff2 from 'wawoff2'
import archiver from 'archiver'
import zlib from 'zlib'
import { promisify } from 'util'

const deflate = promisify(zlib.deflate)

async function convertToTTF(inputBuffer: Buffer, inputExt: string) {
  if (inputExt === '.woff2') {
    return await wawoff2.decompress(inputBuffer)
  } else if (inputExt === '.woff') {
    const signature = inputBuffer.readUInt32BE(0)
    if (signature === 0x774F4646) {
      const offset = 44
      const length = inputBuffer.readUInt32BE(12)
      return inputBuffer.slice(offset, offset + length)
    }
    return inputBuffer
  }
  return inputBuffer
}

async function convertToWOFF2(ttfBuffer: Buffer) {
  const result = await wawoff2.compress(ttfBuffer)
  if (!Buffer.isBuffer(result)) {
    return Buffer.from(result)
  }
  return result
}

async function convertFont(inputBuffer: Buffer, inputExt: string, targetFormat: string) {
  let outputBuffer: Buffer
  let ttfBuffer = inputBuffer
  
  if (['.woff', '.woff2'].includes(inputExt)) {
    ttfBuffer = await convertToTTF(inputBuffer, inputExt)
  }

  switch (targetFormat) {
    case 'ttf':
    case 'otf':
      outputBuffer = Buffer.isBuffer(ttfBuffer) ? ttfBuffer : Buffer.from(ttfBuffer)
      break

    case 'woff2':
      outputBuffer = await convertToWOFF2(ttfBuffer)
      if (!Buffer.isBuffer(outputBuffer)) {
        outputBuffer = Buffer.from(outputBuffer)
      }
      break

    case 'woff':
      try {
        let numTables = 0
        let flavor = 0x00010000
        
        if (ttfBuffer.length >= 12) {
          const sfntVersion = ttfBuffer.readUInt32BE(0)
          numTables = ttfBuffer.readUInt16BE(4)
          
          if (sfntVersion === 0x4F54544F || sfntVersion === 0x74727565) {
            flavor = 0x4F54544F
          } else {
            flavor = 0x00010000
          }
        }
        
        if (numTables === 0) {
          throw new Error('Invalid font file. Cannot read table information.')
        }
        
        const compressedData = await deflate(ttfBuffer) as Buffer
        
        const woffHeader = Buffer.alloc(44)
        woffHeader.writeUInt32BE(0x774F4646, 0)
        woffHeader.writeUInt32BE(flavor, 4)
        woffHeader.writeUInt32BE(compressedData.length + 44, 8)
        woffHeader.writeUInt16BE(numTables, 12)
        woffHeader.writeUInt16BE(0, 14)
        woffHeader.writeUInt32BE(ttfBuffer.length, 16)
        woffHeader.writeUInt16BE(0, 20)
        woffHeader.writeUInt16BE(0, 22)
        woffHeader.writeUInt32BE(0, 24)
        woffHeader.writeUInt32BE(0, 28)
        woffHeader.writeUInt32BE(0, 32)
        woffHeader.writeUInt32BE(0, 36)
        woffHeader.writeUInt32BE(0, 40)
        
        outputBuffer = Buffer.concat([woffHeader, compressedData])
      } catch (compressError: any) {
        throw new Error(`WOFF conversion failed: ${compressError.message}`)
      }
      break

    default:
      throw new Error('Unsupported output format.')
  }

  return outputBuffer
}

function createZipBuffer(files: { buffer: Buffer; name: string }[]) {
  return new Promise<Buffer>((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } })
    const chunks: Buffer[] = []

    archive.on('data', (chunk) => chunks.push(chunk))
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.on('error', (err) => reject(err))

    files.forEach(({ buffer, name }) => {
      if (!Buffer.isBuffer(buffer)) {
        return reject(new Error(`Invalid buffer for file "${name}".`))
      }
      if (buffer.length === 0) {
        return reject(new Error(`Buffer is empty for file "${name}".`))
      }
      archive.append(buffer, { name })
    })

    archive.finalize()
  })
}

async function parseMultipartForm(formData: FormData) {
  const files: { originalname: string; buffer: Buffer }[] = []
  let targetFormat = ''

  const entries = Array.from(formData.entries())
  for (const [key, value] of entries) {
    if (key === 'targetFormat') {
      targetFormat = value as string
    } else if (key === 'fonts' && value instanceof File) {
      const arrayBuffer = await value.arrayBuffer()
      files.push({
        originalname: value.name,
        buffer: Buffer.from(arrayBuffer)
      })
    }
  }

  return { files, targetFormat }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const { files, targetFormat } = await parseMultipartForm(formData)

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files uploaded.' }, { status: 400 })
    }

    if (!targetFormat || !['ttf', 'otf', 'woff', 'woff2'].includes(targetFormat)) {
      return NextResponse.json({ error: 'Please select a valid conversion format.' }, { status: 400 })
    }

    const convertedFiles: { buffer: Buffer; name: string }[] = []

    for (const file of files) {
      const inputExt = file.originalname.substring(file.originalname.lastIndexOf('.')).toLowerCase()
      const baseName = file.originalname.substring(0, file.originalname.lastIndexOf('.'))
      
      if (inputExt.slice(1) === targetFormat) {
        continue
      }

      try {
        const convertedBuffer = await convertFont(file.buffer, inputExt, targetFormat)
        const outputFileName = `${baseName}.${targetFormat}`
        
        if (!Buffer.isBuffer(convertedBuffer)) {
          throw new Error(`Invalid converted buffer. Type: ${typeof convertedBuffer}`)
        }
        
        convertedFiles.push({
          buffer: convertedBuffer,
          name: outputFileName
        })
      } catch (convertError: any) {
        return NextResponse.json({ 
          error: `Error converting file "${file.originalname}": ${convertError.message}` 
        }, { status: 400 })
      }
    }

    if (convertedFiles.length === 0) {
      return NextResponse.json({ 
        error: 'No files to convert. All files are already in the target format.' 
      }, { status: 400 })
    }

    if (convertedFiles.length === 1) {
      const file = convertedFiles[0]
      return new NextResponse(new Uint8Array(file.buffer), {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${file.name}"`,
          'Content-Length': file.buffer.length.toString(),
        },
      })
    }

    const zipBuffer = await createZipBuffer(convertedFiles)
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const hours = String(now.getHours()).padStart(2, '0')
    const minutes = String(now.getMinutes()).padStart(2, '0')
    const seconds = String(now.getSeconds()).padStart(2, '0')
    const dateStr = `${year}${month}${day}-${hours}${minutes}${seconds}`
    const zipFileName = `webfont-satang1245-${dateStr}.zip`
    
    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFileName}"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    })

  } catch (error: any) {
    return NextResponse.json({ 
      error: 'An error occurred during conversion: ' + error.message 
    }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'