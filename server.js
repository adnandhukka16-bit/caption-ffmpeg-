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
  res.json({ ok: true, status: '24x7 Permanent FFmpeg Server Running' });
});

app.post('/render', upload.fields([{ name: 'video', maxCount: 1 }, { name: 'ass', maxCount: 1 }]), (req, res) => {
  const vidFile = req.files && req.files.video && req.files.video[0];
  const assFile = req.files && req.files.ass && req.files.ass[0];
  if (!vidFile || !assFile) return res.status(400).json({ error: 'Missing files' });

  const outPath = path.join(os.tmpdir(), 'out_' + Date.now() + '.mp4');
  const assEscaped = assFile.path.replace(/\\/g, '/').replace(/:/g, '\\:');
  const W = parseInt(req.body.width, 10) || 0;
  const H = parseInt(req.body.height, 10) || 0;

  let vfFilter = `ass='${assEscaped}'`;
  if (W > 0 && H > 0) {
    vfFilter = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,ass='${assEscaped}'`;
  }

  const ff = spawn('ffmpeg', [
    '-y', '-i', vidFile.path, '-vf', vfFilter,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '21',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', outPath
  ]);

  ff.on('close', (code) => {
    try { fs.unlinkSync(vidFile.path); } catch (e) {}
    try { fs.unlinkSync(assFile.path); } catch (e) {}
    if (code !== 0 || !fs.existsSync(outPath)) {
      return res.status(500).json({ error: 'FFmpeg failed' });
    }
    res.setHeader('Content-Type', 'video/mp4');
    fs.createReadStream(outPath).pipe(res).on('close', () => {
      try { fs.unlinkSync(outPath); } catch (e) {}
    });
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log('Running on ' + PORT));
