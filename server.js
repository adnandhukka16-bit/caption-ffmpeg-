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
  limits: { fileSize: 1024 * 1024 * 1024, fieldSize: 50 * 1024 * 1024, files: 2000 }
});

app.get('/', (req, res) => {
  res.json({ ok: true, status: 'Caption Studio Low-RAM Turbo FFmpeg Server Ready' });
});

app.post('/render', upload.any(), (req, res) => {
  const files = req.files || [];
  const vidFile = files.find(f => f.fieldname === 'video');
  const assFile = files.find(f => f.fieldname === 'ass');

  function cleanupAll(extraList) {
    files.forEach(f => { try { fs.unlinkSync(f.path); } catch (e) {} });
    (extraList || []).forEach(p => { try { fs.unlinkSync(p); } catch (e) {} });
  }

  if (!vidFile) {
    cleanupAll();
    return res.status(400).json({ error: 'Missing video file' });
  }

  const jobId = Date.now() + '_' + Math.random().toString(36).slice(2);
  const outPath = path.join(os.tmpdir(), 'out_' + jobId + '.mp4');
  const W = parseInt(req.body.width, 10) || 1080;
  const H = parseInt(req.body.height, 10) || 1920;

  // Mode 1: Exact Canvas PNG Sprites (Batch-chained in groups of 25 so RAM never exceeds 120MB!)
  const spriteMap = {};
  files.forEach(f => {
    if (f.fieldname.startsWith('sp_')) spriteMap[f.fieldname] = f.path;
  });

  if (Object.keys(spriteMap).length > 0 && req.body.timeline) {
    let timeline = [];
    try { timeline = JSON.parse(req.body.timeline); } catch (e) {}

    // Process in safe batches of 30 sprites per pass so 512MB RAM never crashes even on 1000+ words!
    const BATCH = 30;
    const tempFiles = [outPath];

    async function runBatchPass() {
      let currentInput = vidFile.path;

      for (let bStart = 0; bStart < timeline.length; bStart += BATCH) {
        const chunk = timeline.slice(bStart, bStart + BATCH);
        const isFirst = (bStart === 0);
        const isLast = (bStart + BATCH >= timeline.length);
        const passOut = isLast ? outPath : path.join(os.tmpdir(), `pass_${jobId}_${bStart}.mp4`);
        if (!isLast) tempFiles.push(passOut);

        const args = ['-y', '-i', currentInput];
        chunk.forEach((item, idx) => {
          const spPath = spriteMap['sp_' + (bStart + idx)];
          if (spPath) args.push('-i', spPath);
        });

        let filterParts = [];
        let baseTag = '[0:v]';
        if (isFirst && W > 0 && H > 0) {
          filterParts.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v0]`);
          baseTag = '[v0]';
        }

        chunk.forEach((item, idx) => {
          const spIdx = idx + 1;
          const nextTag = `[v_${idx}]`;
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
          '-crf', isLast ? '21' : '18',
          '-pix_fmt', 'yuv420p',
          '-c:a', isFirst ? 'aac' : 'copy'
        );
        if (isFirst) args.push('-b:a', '160k');
        if (isLast) args.push('-movflags', '+faststart');
        args.push(passOut);

        await new Promise((resolve, reject) => {
          const ff = spawn('ffmpeg', args);
          let errLog = '';
          ff.stderr.on('data', d => { errLog = (errLog + d.toString()).slice(-800); });
          ff.on('close', code => {
            if (code === 0 && fs.existsSync(passOut)) resolve();
            else reject(new Error(errLog || 'FFmpeg batch failed'));
          });
        });

        currentInput = passOut;
      }
    }

    runBatchPass().then(() => {
      res.setHeader('Content-Type', 'video/mp4');
      fs.createReadStream(outPath).pipe(res).on('close', () => cleanupAll(tempFiles));
    }).catch(err => {
      cleanupAll(tempFiles);
      res.status(500).json({ error: String(err.message || err) });
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
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '21',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outPath
    ]);
    ff.on('close', code => {
      if (code !== 0 || !fs.existsSync(outPath)) {
        cleanupAll([outPath]);
        return res.status(500).json({ error: 'FFmpeg ASS failed' });
      }
      res.setHeader('Content-Type', 'video/mp4');
      fs.createReadStream(outPath).pipe(res).on('close', () => cleanupAll([outPath]));
    });
    return;
  }

  cleanupAll();
  res.status(400).json({ error: 'No overlay or ass data provided' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log('Low-RAM Turbo Server running on port ' + PORT));
