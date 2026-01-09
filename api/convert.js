import wawoff2 from 'wawoff2';
import archiver from 'archiver';
import { Readable } from 'stream';
import zlib from 'zlib';
import { promisify } from 'util';

const deflate = promisify(zlib.deflate);

async function convertToTTF(inputBuffer, inputExt) {
  if (inputExt === '.woff2') {
    return await wawoff2.decompress(inputBuffer);
  } else if (inputExt === '.woff') {
    const signature = inputBuffer.readUInt32BE(0);
    if (signature === 0x774F4646) {
      const offset = 44;
      const length = inputBuffer.readUInt32BE(12);
      return inputBuffer.slice(offset, offset + length);
    }
    return inputBuffer;
  }
  return inputBuffer;
}

async function convertToWOFF2(ttfBuffer) {
  const result = await wawoff2.compress(ttfBuffer);
  if (!Buffer.isBuffer(result)) {
    return Buffer.from(result);
  }
  return result;
}

async function convertFont(inputBuffer, inputExt, targetFormat) {
  let outputBuffer;
  let ttfBuffer = inputBuffer;
  
  if (['.woff', '.woff2'].includes(inputExt)) {
    ttfBuffer = await convertToTTF(inputBuffer, inputExt);
  }

  switch (targetFormat) {
    case 'ttf':
    case 'otf':
      outputBuffer = Buffer.isBuffer(ttfBuffer) ? ttfBuffer : Buffer.from(ttfBuffer);
      break;

    case 'woff2':
      outputBuffer = await convertToWOFF2(ttfBuffer);
      if (!Buffer.isBuffer(outputBuffer)) {
        outputBuffer = Buffer.from(outputBuffer);
      }
      break;

    case 'woff':
      try {
        let numTables = 0;
        let flavor = 0x00010000;
        
        if (ttfBuffer.length >= 12) {
          const sfntVersion = ttfBuffer.readUInt32BE(0);
          numTables = ttfBuffer.readUInt16BE(4);
          
          if (sfntVersion === 0x4F54544F || sfntVersion === 0x74727565) {
            flavor = 0x4F54544F;
          } else {
            flavor = 0x00010000;
          }
        }
        
        if (numTables === 0) {
          throw new Error('Invalid font file. Cannot read table information.');
        }
        
        const compressedData = await deflate(ttfBuffer);
        
        const woffHeader = Buffer.alloc(44);
        woffHeader.writeUInt32BE(0x774F4646, 0);
        woffHeader.writeUInt32BE(flavor, 4);
        woffHeader.writeUInt32BE(compressedData.length + 44, 8);
        woffHeader.writeUInt16BE(numTables, 12);
        woffHeader.writeUInt16BE(0, 14);
        woffHeader.writeUInt32BE(ttfBuffer.length, 16);
        woffHeader.writeUInt16BE(0, 20);
        woffHeader.writeUInt16BE(0, 22);
        woffHeader.writeUInt32BE(0, 24);
        woffHeader.writeUInt32BE(0, 28);
        woffHeader.writeUInt32BE(0, 32);
        woffHeader.writeUInt32BE(0, 36);
        woffHeader.writeUInt32BE(0, 40);
        
        outputBuffer = Buffer.concat([woffHeader, compressedData]);
      } catch (compressError) {
        throw new Error(`WOFF conversion failed: ${compressError.message}`);
      }
      break;

    default:
      throw new Error('Unsupported output format.');
  }

  return outputBuffer;
}

function createZipBuffer(files) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', (err) => reject(err));

    files.forEach(({ buffer, name }) => {
      if (!Buffer.isBuffer(buffer)) {
        return reject(new Error(`Invalid buffer for file "${name}".`));
      }
      if (buffer.length === 0) {
        return reject(new Error(`Buffer is empty for file "${name}".`));
      }
      archive.append(buffer, { name });
    });

    archive.finalize();
  });
}

async function parseMultipartForm(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const boundary = req.headers['content-type'].split('boundary=')[1];
        
        if (!boundary) {
          return reject(new Error('No boundary found'));
        }

        const parts = buffer.toString('binary').split(`--${boundary}`);
        const files = [];
        let targetFormat = '';

        for (let part of parts) {
          if (part.includes('Content-Disposition')) {
            const nameMatch = part.match(/name="([^"]+)"/);
            const filenameMatch = part.match(/filename="([^"]+)"/);
            
            if (filenameMatch) {
              const filename = filenameMatch[1];
              const dataStart = part.indexOf('\r\n\r\n') + 4;
              const dataEnd = part.lastIndexOf('\r\n');
              const fileData = Buffer.from(part.substring(dataStart, dataEnd), 'binary');
              
              files.push({
                originalname: filename,
                buffer: fileData
              });
            } else if (nameMatch && nameMatch[1] === 'targetFormat') {
              const dataStart = part.indexOf('\r\n\r\n') + 4;
              const dataEnd = part.lastIndexOf('\r\n');
              targetFormat = part.substring(dataStart, dataEnd).trim();
            }
          }
        }

        resolve({ files, targetFormat });
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { files, targetFormat } = await parseMultipartForm(req);

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded.' });
    }

    if (!targetFormat || !['ttf', 'otf', 'woff', 'woff2'].includes(targetFormat)) {
      return res.status(400).json({ error: 'Please select a valid conversion format.' });
    }

    const convertedFiles = [];

    for (const file of files) {
      const inputExt = file.originalname.substring(file.originalname.lastIndexOf('.')).toLowerCase();
      const baseName = file.originalname.substring(0, file.originalname.lastIndexOf('.'));
      
      if (inputExt.slice(1) === targetFormat) {
        continue;
      }

      try {
        const convertedBuffer = await convertFont(file.buffer, inputExt, targetFormat);
        const outputFileName = `${baseName}.${targetFormat}`;
        
        if (!Buffer.isBuffer(convertedBuffer)) {
          throw new Error(`Invalid converted buffer. Type: ${typeof convertedBuffer}`);
        }
        
        convertedFiles.push({
          buffer: convertedBuffer,
          name: outputFileName
        });
      } catch (convertError) {
        return res.status(400).json({ 
          error: `Error converting file "${file.originalname}": ${convertError.message}` 
        });
      }
    }

    if (convertedFiles.length === 0) {
      return res.status(400).json({ 
        error: 'No files to convert. All files are already in the target format.' 
      });
    }

    if (convertedFiles.length === 1) {
      const file = convertedFiles[0];
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
      res.setHeader('Content-Length', file.buffer.length);
      return res.send(file.buffer);
    }

    const zipBuffer = await createZipBuffer(convertedFiles);
    const zipFileName = `converted-fonts-${Date.now()}.zip`;
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);

  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'An error occurred during conversion: ' + error.message 
      });
    }
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};