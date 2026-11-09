const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(cors());
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 1024 * 1024 * 1024 } });

app.get('/', (req, res) => res.json({ ok: true, status: 'Turbo ASS Server Ready' }));

app.post('/render', upload.fields([{ name: 'video', maxCount: 1 }, { name: 'ass', maxCount: 1 }]), (req, res) => {
  const vidFile = req.files && req.files.video && req.files.video[0];
  const assFile = req.files && req.files.ass && req.files.ass[0];
  function clean(extra) {
    if (vidFile) try { fs.unlinkSync(vidFile.path); } catch (e) {}
    if (assFile) try { fs.unlinkSync(assFile.path); } catch (e) {}
    if (extra) try { fs.unlinkSync(extra); } catch (e) {}
  }
  if (!vidFile || !assFile) { clean(); return res.status(400).json({ error: 'Missing files' }); }

  const outPath = path.join(os.tmpdir(), 'out_' + Date.now() + '.mp4');
  const assEscaped = assFile.path.replace(/\\/g, '/').replace(/:/g, '\\:');
  const W = parseInt(req.body.width, 10) || 0;
  const H = parseInt(req.body.height, 10) || 0;

  let vfFilter = `ass='${assEscaped}'`;
  if (W > 0 && H > 0) {
    vfFilter = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,ass='${assEscaped}'`;
  }

  const args = [
    '-y', '-i', vidFile.path,
    '-vf', vfFilter,
    '-vsync', 'cfr',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-threads', '0',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    outPath
  ];

  const ff = spawn('ffmpeg', args);
  ff.on('close', code => {
    if (code !== 0 || !fs.existsSync(outPath)) { clean(outPath); return res.status(500).json({ error: 'FFmpeg failed' }); }
    res.setHeader('Content-Type', 'video/mp4');
    fs.createReadStream(outPath).pipe(res).on('close', () => clean(outPath));
  });
});

app.listen(process.env.PORT || 10000, '0.0.0.0');
