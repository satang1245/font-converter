const express = require('express');
const path = require('path');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/convert', express.raw({ type: '*/*', limit: '50mb' }));

app.post('/api/convert', async (req, res) => {
  let headersSent = false;
  
  try {
    const convertModule = await import('./api/convert.js');
    const convertHandler = convertModule.default;

    const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    
    const vercelReq = {
      method: req.method,
      headers: req.headers,
      on: (event, callback) => {
        if (event === 'data') {
          process.nextTick(() => {
            if (bodyBuffer.length > 0) {
              callback(bodyBuffer);
            }
          });
        } else if (event === 'end') {
          process.nextTick(() => callback());
        } else if (event === 'error') {
        }
      }
    };

    const vercelRes = {
      setHeader: (name, value) => {
        if (!headersSent) {
          res.setHeader(name, value);
        }
      },
      status: (code) => {
        if (!headersSent) {
          res.status(code);
        }
        return vercelRes;
      },
      json: (data) => {
        if (!headersSent) {
          headersSent = true;
          res.json(data);
        }
      },
      send: (data) => {
        if (!headersSent) {
          headersSent = true;
          res.send(data);
        }
      },
      end: () => {
        if (!headersSent) {
          headersSent = true;
          res.end();
        }
      },
      get headersSent() {
        return headersSent;
      }
    };

    await convertHandler(vercelReq, vercelRes);
  } catch (error) {
    if (!headersSent) {
      headersSent = true;
      res.status(500).json({ error: error.message });
    }
  }
});

app.options('/api/convert', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(200).end();
});

app.listen(PORT);
