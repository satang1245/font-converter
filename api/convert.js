const wawoff2 = require('wawoff2');
const archiver = require('archiver');
const { Readable } = require('stream');

// WOFF/WOFF2를 TTF로 변환
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

// TTF를 WOFF2로 변환
async function convertToWOFF2(ttfBuffer) {
  return await wawoff2.compress(ttfBuffer);
}

// 폰트 변환 함수
async function convertFont(inputBuffer, inputExt, targetFormat) {
  let outputBuffer;
  let ttfBuffer = inputBuffer;
  
  if (['.woff', '.woff2'].includes(inputExt)) {
    ttfBuffer = await convertToTTF(inputBuffer, inputExt);
  }

  switch (targetFormat) {
    case 'ttf':
    case 'otf':
      outputBuffer = ttfBuffer;
      break;

    case 'woff2':
      outputBuffer = await convertToWOFF2(ttfBuffer);
      break;

    case 'woff':
      const woffHeader = Buffer.alloc(44);
      woffHeader.writeUInt32BE(0x774F4646, 0);
      woffHeader.writeUInt32BE(0x00010000, 4);
      woffHeader.writeUInt32BE(ttfBuffer.length + 44, 8);
      woffHeader.writeUInt32BE(ttfBuffer.length, 12);
      outputBuffer = Buffer.concat([woffHeader, ttfBuffer]);
      break;

    default:
      throw new Error('지원하지 않는 출력 형식입니다.');
  }

  return outputBuffer;
}

// ZIP 파일 생성
function createZipBuffer(files) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', (err) => reject(err));

    files.forEach(({ buffer, name }) => {
      archive.append(buffer, { name });
    });

    archive.finalize();
  });
}

// Vercel의 파일 파싱
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
  // CORS 설정
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
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }

    if (!targetFormat || !['ttf', 'otf', 'woff', 'woff2'].includes(targetFormat)) {
      return res.status(400).json({ error: '올바른 변환 형식을 선택해주세요.' });
    }

    const convertedFiles = [];

    // 각 파일 변환
    for (const file of files) {
      const inputExt = file.originalname.substring(file.originalname.lastIndexOf('.')).toLowerCase();
      const baseName = file.originalname.substring(0, file.originalname.lastIndexOf('.'));
      
      // 같은 형식이면 스킵
      if (inputExt.slice(1) === targetFormat) {
        continue;
      }

      const convertedBuffer = await convertFont(file.buffer, inputExt, targetFormat);
      const outputFileName = `${baseName}.${targetFormat}`;
      
      convertedFiles.push({
        buffer: convertedBuffer,
        name: outputFileName
      });
    }

    if (convertedFiles.length === 0) {
      return res.status(400).json({ 
        error: '변환할 파일이 없습니다. 모든 파일이 이미 대상 형식입니다.' 
      });
    }

    // 단일 파일인 경우 직접 반환
    if (convertedFiles.length === 1) {
      const file = convertedFiles[0];
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
      res.setHeader('Content-Length', file.buffer.length);
      return res.send(file.buffer);
    }

    // 여러 파일인 경우 ZIP으로 반환
    const zipBuffer = await createZipBuffer(convertedFiles);
    const zipFileName = `converted-fonts-${Date.now()}.zip`;
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);

  } catch (error) {
    console.error('변환 오류:', error);
    res.status(500).json({ 
      error: '변환 중 오류가 발생했습니다: ' + error.message 
    });
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};