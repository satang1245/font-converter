const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fontkit = require('fontkit');
const wawoff2 = require('wawoff2');
const archiver = require('archiver');

const app = express();
const PORT = 3000;

// 업로드 설정
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = './uploads';
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.random().toString(36).substr(2, 9) + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.ttf', '.otf', '.woff', '.woff2'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('지원하지 않는 파일 형식입니다.'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(express.static('public'));
app.use('/downloads', express.static('downloads'));

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
async function convertFont(inputPath, outputPath, targetFormat) {
  const inputExt = path.extname(inputPath).toLowerCase();
  const inputBuffer = await fs.readFile(inputPath);

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

  await fs.writeFile(outputPath, outputBuffer);
}

// 메인 페이지
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>폰트 변환 서비스</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
        }
        .container {
          background: white;
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          max-width: 700px;
          width: 100%;
        }
        h1 {
          color: #333;
          margin-bottom: 10px;
          text-align: center;
        }
        .subtitle {
          color: #666;
          text-align: center;
          margin-bottom: 30px;
          font-size: 14px;
        }
        .upload-area {
          border: 3px dashed #667eea;
          border-radius: 10px;
          padding: 40px;
          text-align: center;
          margin-bottom: 20px;
          cursor: pointer;
          transition: all 0.3s;
        }
        .upload-area:hover {
          background: #f8f9ff;
          border-color: #764ba2;
        }
        .upload-area.dragover {
          background: #f0f2ff;
          border-color: #764ba2;
        }
        input[type="file"] { display: none; }
        .files-list {
          margin: 20px 0;
          max-height: 300px;
          overflow-y: auto;
          display: none;
        }
        .file-item {
          padding: 12px;
          background: #f5f5f5;
          border-radius: 8px;
          margin-bottom: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .file-item-info {
          flex: 1;
          font-size: 14px;
        }
        .file-item-remove {
          background: #ff4444;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          width: 60px;
        }
        .file-item-remove:hover {
          background: #cc0000;
        }
        select, button {
          width: 100%;
          padding: 15px;
          margin: 10px 0;
          border: 2px solid #ddd;
          border-radius: 8px;
          font-size: 16px;
        }
        select {
          cursor: pointer;
          background: white;
        }
        button {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          cursor: pointer;
          font-weight: bold;
          transition: transform 0.2s;
        }
        button:hover:not(:disabled) {
          transform: translateY(-2px);
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .result {
          margin-top: 20px;
          padding: 20px;
          background: #e8f5e9;
          border-radius: 8px;
          display: none;
        }
        .error {
          background: #ffebee;
          color: #c62828;
        }
        .loader {
          border: 4px solid #f3f3f3;
          border-top: 4px solid #667eea;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
          margin: 20px auto;
          display: none;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .format-badge {
          display: inline-block;
          padding: 4px 8px;
          background: #667eea;
          color: white;
          border-radius: 4px;
          font-size: 11px;
          font-weight: bold;
        }
        .progress-container {
          display: none;
          margin: 20px 0;
        }
        .progress-bar {
          width: 100%;
          height: 30px;
          background: #f0f0f0;
          border-radius: 15px;
          overflow: hidden;
          position: relative;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          transition: width 0.3s;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 12px;
        }
        .clear-btn {
          background: #ff6b6b;
          margin-top: 10px;
        }
        .clear-btn:hover:not(:disabled) {
          background: #ee5a52;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔤 폰트 변환 서비스</h1>
        <p class="subtitle">여러 개의 폰트 파일을 한번에 변환하세요</p>
        
        <div class="upload-area" id="uploadArea">
          <p style="font-size: 48px; margin-bottom: 10px;">📁</p>
          <p>클릭하거나 파일을 드래그하여 업로드</p>
          <p style="font-size: 12px; color: #999; margin-top: 5px;">
            지원 형식: TTF, OTF, WOFF, WOFF2 (파일당 최대 10MB)
          </p>
          <input type="file" id="fileInput" accept=".ttf,.otf,.woff,.woff2" multiple>
        </div>

        <div class="files-list" id="filesList"></div>

        <select id="targetFormat">
          <option value="">변환할 형식 선택</option>
          <option value="ttf">TTF (TrueType Font)</option>
          <option value="otf">OTF (OpenType Font)</option>
          <option value="woff">WOFF (Web Open Font Format)</option>
          <option value="woff2">WOFF2 (Web Open Font Format 2)</option>
        </select>

        <button id="convertBtn" disabled>변환하기</button>
        <button id="clearBtn" class="clear-btn" style="display: none;">전체 삭제</button>

        <div class="progress-container" id="progressContainer">
          <div class="progress-bar">
            <div class="progress-fill" id="progressFill">0%</div>
          </div>
          <p style="text-align: center; margin-top: 10px; color: #666;" id="progressText"></p>
        </div>

        <div class="loader" id="loader"></div>
        <div class="result" id="result"></div>
      </div>

      <script>
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const filesList = document.getElementById('filesList');
        const targetFormat = document.getElementById('targetFormat');
        const convertBtn = document.getElementById('convertBtn');
        const clearBtn = document.getElementById('clearBtn');
        const loader = document.getElementById('loader');
        const result = document.getElementById('result');
        const progressContainer = document.getElementById('progressContainer');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        
        let selectedFiles = [];

        uploadArea.addEventListener('click', () => fileInput.click());
        
        uploadArea.addEventListener('dragover', (e) => {
          e.preventDefault();
          uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', () => {
          uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', (e) => {
          e.preventDefault();
          uploadArea.classList.remove('dragover');
          if (e.dataTransfer.files.length) {
            handleFiles(e.dataTransfer.files);
          }
        });

        fileInput.addEventListener('change', (e) => {
          handleFiles(e.target.files);
        });

        function handleFiles(files) {
          for (let file of files) {
            if (!selectedFiles.find(f => f.name === file.name && f.size === file.size)) {
              selectedFiles.push(file);
            }
          }
          updateFilesList();
          fileInput.value = '';
        }

        function updateFilesList() {
          if (selectedFiles.length === 0) {
            filesList.style.display = 'none';
            clearBtn.style.display = 'none';
            convertBtn.disabled = true;
            return;
          }

          filesList.style.display = 'block';
          clearBtn.style.display = 'block';
          
          filesList.innerHTML = selectedFiles.map((file, index) => {
            const ext = file.name.split('.').pop().toLowerCase();
            const sizeKB = (file.size / 1024).toFixed(2);
            return \`
              <div class="file-item">
                <div class="file-item-info">
                  <strong>\${file.name}</strong><br>
                  <span style="font-size: 12px; color: #666;">
                    \${sizeKB} KB • <span class="format-badge">\${ext.toUpperCase()}</span>
                  </span>
                </div>
                <button class="file-item-remove" onclick="removeFile(\${index})">삭제</button>
              </div>
            \`;
          }).join('');

          checkConvertButton();
        }

        window.removeFile = function(index) {
          selectedFiles.splice(index, 1);
          updateFilesList();
        };

        clearBtn.addEventListener('click', () => {
          selectedFiles = [];
          updateFilesList();
        });

        targetFormat.addEventListener('change', checkConvertButton);

        function checkConvertButton() {
          convertBtn.disabled = !(selectedFiles.length > 0 && targetFormat.value);
        }

        convertBtn.addEventListener('click', async () => {
          if (selectedFiles.length === 0 || !targetFormat.value) return;

          const formData = new FormData();
          selectedFiles.forEach(file => {
            formData.append('fonts', file);
          });
          formData.append('targetFormat', targetFormat.value);

          convertBtn.disabled = true;
          progressContainer.style.display = 'block';
          result.style.display = 'none';
          progressFill.style.width = '0%';
          progressFill.textContent = '0%';
          progressText.textContent = '변환 중...';

          try {
            const response = await fetch('/convert-multiple', {
              method: 'POST',
              body: formData
            });

            const data = await response.json();

            if (response.ok) {
              progressFill.style.width = '100%';
              progressFill.textContent = '100%';
              progressText.textContent = '완료!';

              result.className = 'result';
              result.innerHTML = \`
                <strong>✅ 변환 완료!</strong><br><br>
                <div style="margin: 15px 0;">
                  <strong>변환된 파일:</strong> \${data.totalFiles}개<br>
                  <strong>총 크기:</strong> \${data.totalSize}<br>
                  <strong>ZIP 파일:</strong> \${data.zipFileName}
                </div>
                <a href="\${data.downloadUrl}" download style="
                  display: inline-block;
                  padding: 12px 24px;
                  background: #667eea;
                  color: white;
                  text-decoration: none;
                  border-radius: 5px;
                  font-weight: bold;
                  margin-top: 10px;
                ">⬇️ ZIP 다운로드</a>
              \`;
              
              setTimeout(() => {
                progressContainer.style.display = 'none';
              }, 2000);
            } else {
              throw new Error(data.error || '변환 실패');
            }
          } catch (error) {
            result.className = 'result error';
            result.innerHTML = \`<strong>❌ 오류:</strong> \${error.message}\`;
            progressContainer.style.display = 'none';
          } finally {
            result.style.display = 'block';
            convertBtn.disabled = false;
          }
        });
      </script>
    </body>
    </html>
  `);
});

// 여러 폰트 파일 변환 엔드포인트
app.post('/convert-multiple', upload.array('fonts', 50), async (req, res) => {
  const uploadedFiles = [];
  const convertedFiles = [];
  let zipPath = null;

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }

    const { targetFormat } = req.body;
    
    if (!targetFormat || !['ttf', 'otf', 'woff', 'woff2'].includes(targetFormat)) {
      return res.status(400).json({ error: '올바른 변환 형식을 선택해주세요.' });
    }

    const downloadDir = './downloads';
    await fs.mkdir(downloadDir, { recursive: true });

    // 각 파일 변환
    for (const file of req.files) {
      uploadedFiles.push(file.path);
      
      const inputExt = path.extname(file.originalname).toLowerCase().slice(1);
      const baseName = path.basename(file.originalname, path.extname(file.originalname));
      
      // 같은 형식이면 스킵
      if (inputExt === targetFormat) {
        continue;
      }
      
      const outputFileName = `${baseName}.${targetFormat}`;
      const outputPath = path.join(downloadDir, outputFileName);

      await convertFont(file.path, outputPath, targetFormat);
      convertedFiles.push(outputPath);
    }

    if (convertedFiles.length === 0) {
      throw new Error('변환할 파일이 없습니다. 모든 파일이 이미 대상 형식입니다.');
    }

    // ZIP 파일 생성
    const zipFileName = `converted-fonts-${Date.now()}.zip`;
    zipPath = path.join(downloadDir, zipFileName);
    
    await createZip(convertedFiles, zipPath);

    // 파일 크기 계산
    const stats = await fs.stat(zipPath);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);

    res.json({
      success: true,
      downloadUrl: `/downloads/${zipFileName}`,
      zipFileName: zipFileName,
      totalFiles: convertedFiles.length,
      totalSize: `${fileSizeMB} MB`,
      message: '변환이 완료되었습니다.'
    });

    // 업로드된 파일 정리
    setTimeout(async () => {
      for (const filePath of uploadedFiles) {
        try {
          await fs.unlink(filePath);
        } catch (err) {
          console.error('업로드 파일 삭제 실패:', err);
        }
      }
    }, 1000);

    // 변환된 개별 파일 정리
    setTimeout(async () => {
      for (const filePath of convertedFiles) {
        try {
          await fs.unlink(filePath);
        } catch (err) {
          console.error('변환 파일 삭제 실패:', err);
        }
      }
    }, 5000);

    // ZIP 파일 정리 (30분 후)
    setTimeout(async () => {
      try {
        await fs.unlink(zipPath);
      } catch (err) {
        console.error('ZIP 파일 삭제 실패:', err);
      }
    }, 30 * 60 * 1000);

  } catch (error) {
    console.error('변환 오류:', error);
    
    // 오류 발생 시 모든 파일 정리
    for (const filePath of [...uploadedFiles, ...convertedFiles]) {
      try {
        await fs.unlink(filePath);
      } catch (err) {}
    }
    if (zipPath) {
      try {
        await fs.unlink(zipPath);
      } catch (err) {}
    }

    res.status(500).json({ 
      error: '변환 중 오류가 발생했습니다: ' + error.message 
    });
  }
});

// ZIP 파일 생성 함수
function createZip(files, outputPath) {
  return new Promise((resolve, reject) => {
    const output = require('fs').createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));

    archive.pipe(output);

    files.forEach(file => {
      archive.file(file, { name: path.basename(file) });
    });

    archive.finalize();
  });
}

// 단일 파일 변환 엔드포인트 (기존 기능 유지)
app.post('/convert', upload.single('font'), async (req, res) => {
  let inputPath = null;
  let outputPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }

    const { targetFormat } = req.body;
    
    if (!targetFormat || !['ttf', 'otf', 'woff', 'woff2'].includes(targetFormat)) {
      return res.status(400).json({ error: '올바른 변환 형식을 선택해주세요.' });
    }

    inputPath = req.file.path;
    const inputExt = path.extname(req.file.originalname).toLowerCase().slice(1);
    const baseName = path.basename(req.file.originalname, path.extname(req.file.originalname));
    
    if (inputExt === targetFormat) {
      await fs.unlink(inputPath);
      return res.status(400).json({ 
        error: `이미 \${targetFormat.toUpperCase()} 형식입니다.` 
      });
    }
    
    const downloadDir = './downloads';
    await fs.mkdir(downloadDir, { recursive: true });
    
    const outputFileName = `${baseName}.${targetFormat}`;
    outputPath = path.join(downloadDir, outputFileName);

    await convertFont(inputPath, outputPath, targetFormat);

    const stats = await fs.stat(outputPath);
    const fileSizeKB = (stats.size / 1024).toFixed(2);

    res.json({
      success: true,
      downloadUrl: `/downloads/${outputFileName}`,
      fileName: outputFileName,
      fileSize: `${fileSizeKB} KB`,
      message: '변환이 완료되었습니다.'
    });

    setTimeout(async () => {
      try {
        await fs.unlink(inputPath);
      } catch (err) {
        console.error('임시 파일 삭제 실패:', err);
      }
    }, 1000);

    setTimeout(async () => {
      try {
        await fs.unlink(outputPath);
      } catch (err) {
        console.error('변환 파일 삭제 실패:', err);
      }
    }, 30 * 60 * 1000);

  } catch (error) {
    console.error('변환 오류:', error);
    
    if (inputPath) {
      try {
        await fs.unlink(inputPath);
      } catch (err) {}
    }
    if (outputPath) {
      try {
        await fs.unlink(outputPath);
      } catch (err) {}
    }

    res.status(500).json({ 
      error: '변환 중 오류가 발생했습니다: ' + error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   🔤 폰트 변환 서비스가 시작되었습니다!      ║
║                                              ║
║   🌐 URL: http://localhost:\${PORT}            ║
║   📂 지원 형식: TTF, OTF, WOFF, WOFF2       ║
║   📦 다중 파일 변환 지원 (최대 50개)        ║
╚══════════════════════════════════════════════╝
  `);
});