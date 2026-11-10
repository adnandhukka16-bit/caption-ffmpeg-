const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(cors({ exposedHeaders: ['Content-Length'] }));
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 1024 * 1024 * 1024 } });

const PRESET = process.env.PRESET || 'ultrafast';
const MAX_PARALLEL = parseInt(process.env.MAX_PARALLEL || '1', 10);
const FONTS_DIR = '/usr/share/fonts/truetype/viral';

// Simple job queue so small instances don't run out of RAM
let running = 0;
const waiting = [];
function acquire() {
  return new Promise(res => {
    if (running < MAX_PARALLEL) { running++; res(); } else waiting.push(res);
  });
}
function release() {
  const next = waiting.shift();
  if (next) next(); else running--;
}

function probeAudio(file) {
  return new Promise(resolve => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file],
      { timeout: 15000 },
      (err, out) => resolve(err ? '' : String(out).trim())
    );
  });
}

app.get('/', (req, res) => res.json({ ok: true, status: 'Turbo ASS Server Ready', queued: waiting.length, running }));

app.post('/render', upload.fields([{ name: 'video', maxCount: 1 }, { name: 'ass', maxCount: 1 }]), async (req, res) => {
  const vidFile = req.files && req.files.video && req.files.video[0];
  const assFile = req.files && req.files.ass && req.files.ass[0];
  const outPath = path.join(os.tmpdir(), 'out_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.mp4');
  let ff = null, gotSlot = false;

  function clean() {
    [vidFile && vidFile.path, assFile && assFile.path, outPath].forEach(p => {
      if (p) try { fs.unlinkSync(p); } catch (e) {}
    });
    if (gotSlot) { gotSlot = false; release(); }
  }

  // Stop ffmpeg if the browser cancels / disconnects
  res.on('close', () => {
    if (!res.writableFinished && ff) { try { ff.kill('SIGKILL'); } catch (e) {} }
  });

  if (!vidFile || !assFile) { clean(); return res.status(400).json({ error: 'Missing files' }); }

  await acquire();
  gotSlot = true;

  const W = parseInt(req.body.width, 10) || 0;
  const H = parseInt(req.body.height, 10) || 0;
  const assEscaped = assFile.path.replace(/\\/g, '/').replace(/:/g, '\\:');
  const assFilter = `ass='${assEscaped}':fontsdir=${FONTS_DIR}`;
  const vf = (W > 0 && H > 0)
    ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,${assFilter}`
    : assFilter;

  // Copy audio only when it is already AAC; otherwise re-encode (or drop if none)
  const aCodec = await probeAudio(vidFile.path);
  const audioArgs = aCodec === 'aac' ? ['-c:a', 'copy']
    : aCodec ? ['-c:a', 'aac', '-b:a', '128k']
    : ['-an'];

  const args = [
    '-y', '-i', vidFile.path,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', vf,
    '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-preset', PRESET, '-threads', '0', '-crf', '23', '-pix_fmt', 'yuv420p',
    ...audioArgs,
    '-movflags', '+faststart',
    outPath
  ];

  let errTail = '';
  ff = spawn('ffmpeg', args);
  ff.stderr.on('data', d => { errTail = (errTail + d.toString()).slice(-1500); });
  ff.on('error', e => {
    console.error('spawn error', e);
    clean();
    if (!res.headersSent) res.status(500).json({ error: 'FFmpeg not available' });
  });
  ff.on('close', code => {
    if (code !== 0 || !fs.existsSync(outPath)) {
      console.error('ffmpeg failed', code, errTail);
      clean();
      if (!res.headersSent && !res.destroyed) res.status(500).json({ error: 'FFmpeg failed' });
      return;
    }
    const size = fs.statSync(outPath).size;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', size);
    fs.createReadStream(outPath).pipe(res).on('close', clean);
  });
});

app.listen(process.env.PORT || 10000, '0.0.0.0');
