const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(cors());

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 1024 * 1024 * 1024 }
});

app.get('/', (req, res) => {
  res.json({ ok: true, status: 'Single-Pass Turbo ASS Server Ready' });
});

app.post('/render', upload.fields([{ name: 'video', maxCount: 1 }, { name: 'ass', maxCount: 1 }]), (req, res) => {
  const vidFile = req.files && req.files.video && req.files.video[0];
  const assFile = req.files && req.files.ass && req.files.ass[0];

  function clean(extra) {
    if (vidFile) try { fs.unlinkSync(vidFile.path); } catch (e) {}
    if (assFile) try { fs.unlinkSync(assFile.path); } catch (e) {}
    if (extra) try { fs.unlinkSync(extra); } catch (e) {}
  }

  if (!vidFile || !assFile) {
    clean();
    return res.status(400).json({ error: 'Missing video or ass file' });
  }

  const outPath = path.join(os.tmpdir(), 'out_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.mp4');
  const assEscaped = assFile.path.replace(/\\/g, '/').replace(/:/g, '\\:');

  // Single-pass C++ libass burn + direct audio stream copy (Zero audio re-encoding overhead!)
  const args = [
    '-y',
    '-i', vidFile.path,
    '-vf', `ass='${assEscaped}'`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'fastdecode',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    outPath
  ];

  const ff = spawn('ffmpeg', args);
  let errLog = '';
  ff.stderr.on('data', d => { errLog = (errLog + d.toString()).slice(-800); });

  ff.on('close', code => {
    if (code !== 0 || !fs.existsSync(outPath)) {
      clean(outPath);
      return res.status(500).json({ error: 'FFmpeg failed: ' + errLog });
    }
    res.setHeader('Content-Type', 'video/mp4');
    fs.createReadStream(outPath).pipe(res).on('close', () => clean(outPath));
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log('Turbo ASS Server on ' + PORT));
