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
  limits: { fileSize: 1024 * 1024 * 1024, fieldSize: 50 * 1024 * 1024 }
});

app.get('/', (req, res) => {
  res.json({ ok: true, status: 'Caption Studio Exact-Canvas FFmpeg Server Ready' });
});

app.post('/render', upload.any(), (req, res) => {
  const files = req.files || [];
  const vidFile = files.find(f => f.fieldname === 'video');
  const ovFile = files.find(f => f.fieldname === 'overlay'); // Transparent WebM/MOV or sprite from Canvas
  const assFile = files.find(f => f.fieldname === 'ass');

  function cleanupAll(extra) {
    files.forEach(f => { try { fs.unlinkSync(f.path); } catch (e) {} });
    if (extra) { try { fs.unlinkSync(extra); } catch (e) {} }
  }

  if (!vidFile) {
    cleanupAll();
    return res.status(400).json({ error: 'Missing video file' });
  }

  const outPath = path.join(os.tmpdir(), 'out_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.mp4');
  const W = parseInt(req.body.width, 10) || 0;
  const H = parseInt(req.body.height, 10) || 0;

  // Mode 1: Exact Canvas PNG Sprite Overlay (100% identical to screen preview!)
  const sprites = files.filter(f => f.fieldname.startsWith('sp_'));
  if (sprites.length > 0 && req.body.timeline) {
    let timeline = [];
    try { timeline = JSON.parse(req.body.timeline); } catch (e) {}

    const args = ['-y', '-i', vidFile.path];
    sprites.forEach(sp => args.push('-i', sp.path));

    let filterParts = [];
    let baseTag = '[0:v]';
    if (W > 0 && H > 0) {
      filterParts.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v0]`);
      baseTag = '[v0]';
    }

    timeline.forEach((item, idx) => {
      const spIdx = idx + 1;
      const nextTag = `[v${ spIdx }]`;
      const x = Math.round(item.x || 0);
      const y = Math.round(item.y || 0);
      const s = Number(item.s).toFixed(3);
      const e = Number(item.e).toFixed(3);
      filterParts.push(`${baseTag}[${spIdx}:v]overlay=${x}:${y}:enable='between(t,${s},${e})'${nextTag}`);
      baseTag = nextTag;
    });

    args.push(
      '-filter_complex', filterParts.join(';'),
      '-map', baseTag,
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-movflags', '+faststart',
      outPath
    );

    const ff = spawn('ffmpeg', args);
    let errLog = '';
    ff.stderr.on('data', d => { errLog = (errLog + d.toString()).slice(-1000); });
    ff.on('close', code => {
      if (code !== 0 || !fs.existsSync(outPath)) {
        cleanupAll(outPath);
        return res.status(500).json({ error: 'FFmpeg overlay failed: ' + errLog });
      }
      res.setHeader('Content-Type', 'video/mp4');
      fs.createReadStream(outPath).pipe(res).on('close', () => cleanupAll(outPath));
    });
    return;
  }

  // Fallback Mode: ASS Subtitle Burn
  if (assFile) {
    const assEscaped = assFile.path.replace(/\\/g, '/').replace(/:/g, '\\:');
    let vfFilter = `ass='${assEscaped}'`;
    if (W > 0 && H > 0) {
      vfFilter = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,ass='${assEscaped}'`;
    }
    const ff = spawn('ffmpeg', [
      '-y', '-i', vidFile.path, '-vf', vfFilter,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outPath
    ]);
    ff.on('close', code => {
      if (code !== 0 || !fs.existsSync(outPath)) {
        cleanupAll(outPath);
        return res.status(500).json({ error: 'FFmpeg ASS failed' });
      }
      res.setHeader('Content-Type', 'video/mp4');
      fs.createReadStream(outPath).pipe(res).on('close', () => cleanupAll(outPath));
    });
    return;
  }

  cleanupAll();
  res.status(400).json({ error: 'No overlay or ass data provided' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log('Server running on port ' + PORT));
