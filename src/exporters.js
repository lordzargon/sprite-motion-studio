import { GIFEncoder, quantize, applyPalette } from './gifenc.js';

export class Exporters {
  constructor(motionEngine) {
    this.engine = motionEngine;
  }

  // Generates a spritesheet canvas for any sprite image
  generateSpritesheetCanvas(spriteImg, layout = 'horizontal', padding = 0, scale = 1) {
    const frameCount = this.engine.frames.length;
    const baseW = spriteImg.naturalWidth || spriteImg.width || 32;
    const baseH = spriteImg.naturalHeight || spriteImg.height || 32;
    const fw = baseW * scale;
    const fh = baseH * scale;

    let cols = frameCount;
    let rows = 1;

    if (layout === 'vertical') {
      cols = 1;
      rows = frameCount;
    } else if (layout === 'grid') {
      cols = Math.ceil(Math.sqrt(frameCount));
      rows = Math.ceil(frameCount / cols);
    }

    const totalWidth = cols * fw + (cols + 1) * padding;
    const totalHeight = rows * fh + (rows + 1) * padding;

    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = totalWidth;
    sheetCanvas.height = totalHeight;
    const ctx = sheetCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Render each frame into the sheet
    for (let i = 0; i < frameCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const destX = padding + col * (fw + padding);
      const destY = padding + row * (fh + padding);

      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = fw;
      frameCanvas.height = fh;
      const fCtx = frameCanvas.getContext('2d');
      fCtx.imageSmoothingEnabled = false;

      this.engine.renderSpriteFrame(spriteImg, i, fCtx, fw, fh);
      ctx.drawImage(frameCanvas, destX, destY);
    }

    return sheetCanvas;
  }

  // Exports individual PNG frame canvases for a sprite
  generateFrameCanvases(spriteImg, scale = 1) {
    const baseW = spriteImg.naturalWidth || spriteImg.width || 32;
    const baseH = spriteImg.naturalHeight || spriteImg.height || 32;
    const fw = baseW * scale;
    const fh = baseH * scale;
    const frames = [];

    for (let i = 0; i < this.engine.frames.length; i++) {
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = fw;
      frameCanvas.height = fh;
      const fCtx = frameCanvas.getContext('2d');
      fCtx.imageSmoothingEnabled = false;

      this.engine.renderSpriteFrame(spriteImg, i, fCtx, fw, fh);
      frames.push({
        index: i,
        canvas: frameCanvas,
        filename: `frame_${String(i + 1).padStart(3, '0')}.png`
      });
    }

    return frames;
  }

  // Trigger browser download for a Blob / DataUrl
  static downloadFile(blobOrUrl, filename) {
    const link = document.createElement('a');
    if (typeof blobOrUrl === 'string') {
      link.href = blobOrUrl;
    } else {
      link.href = URL.createObjectURL(blobOrUrl);
    }
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (typeof blobOrUrl !== 'string') {
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    }
  }

  // Download Spritesheet PNG
  exportSpritesheet(spriteImg, spriteName, layout = 'horizontal', scale = 1) {
    const canvas = this.generateSpritesheetCanvas(spriteImg, layout, 0, scale);
    canvas.toBlob((blob) => {
      Exporters.downloadFile(blob, `${spriteName}_spritesheet.png`);
    }, 'image/png');
  }

  // Download PNG Frame Sequence ZIP
  async exportFramesZip(spriteImg, spriteName, scale = 1) {
    if (!window.JSZip) {
      alert('JSZip library is required to download frames as ZIP.');
      return;
    }

    const zip = new window.JSZip();
    const frames = this.generateFrameCanvases(spriteImg, scale);
    const folder = zip.folder(spriteName);

    const promises = frames.map(f => {
      return new Promise(resolve => {
        f.canvas.toBlob(blob => {
          folder.file(f.filename, blob);
          resolve();
        }, 'image/png');
      });
    });

    await Promise.all(promises);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    Exporters.downloadFile(zipBlob, `${spriteName}_frames.zip`);
  }

  // Download Motion Preset JSON
  exportMotionPreset(animName = 'sprite_animation') {
    const data = this.engine.exportToJson(animName);
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    Exporters.downloadFile(blob, `${animName}.spritemotion.json`);
  }

  // Generates raw animated GIF Uint8Array with 1-bit transparent background support
  generateGifBytes(spriteImg, scale = 4) {
    const baseW = spriteImg.naturalWidth || spriteImg.width || 32;
    const baseH = spriteImg.naturalHeight || spriteImg.height || 32;
    const fw = baseW * scale;
    const fh = baseH * scale;
    const frameCount = this.engine.frames.length;
    const delay = Math.round(1000 / this.engine.fps);

    const encoder = GIFEncoder();

    for (let i = 0; i < frameCount; i++) {
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = fw;
      frameCanvas.height = fh;
      const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;

      this.engine.renderSpriteFrame(spriteImg, i, ctx, fw, fh);
      const imgData = ctx.getImageData(0, 0, fw, fh);
      const rgba = imgData.data;

      // Quantize with rgba4444 to extract 1-bit alpha transparent color
      const palette = quantize(rgba, 256, {
        format: 'rgba4444',
        oneBitAlpha: 0x44,
        clearAlpha: true,
        clearAlphaColor: 0x00
      });

      const index = applyPalette(rgba, palette, 'rgba4444');
      const transparentIndex = palette.findIndex(p => p[3] === 0);

      encoder.writeFrame(index, fw, fh, {
        palette,
        delay,
        transparent: transparentIndex >= 0,
        transparentIndex: Math.max(0, transparentIndex),
        dispose: 2 // Restore to background color for clean transparent frame transitions
      });
    }

    encoder.finish();
    return encoder.bytes();
  }

  // Generate and export Animated GIF with transparent background
  exportGif(spriteImg, spriteName, scale = 4) {
    try {
      const bytes = this.generateGifBytes(spriteImg, scale);
      const blob = new Blob([bytes], { type: 'image/gif' });
      Exporters.downloadFile(blob, `${spriteName}_anim.gif`);
    } catch (err) {
      console.error('GIF export error:', err);
      alert('Failed to generate GIF: ' + err.message);
    }
  }

  // Batch Export All sprites to a single ZIP
  async batchExportZip(targetSprites, fallbackSprite = null, exportType = 'spritesheet', scale = 1) {
    if (!window.JSZip) {
      alert('JSZip library is required for batch ZIP download.');
      return;
    }

    const zip = new window.JSZip();
    let allSprites = [];
    if (targetSprites && targetSprites.length > 0) {
      allSprites = targetSprites.map(s => ({ name: s.name, img: s.img }));
    } else if (fallbackSprite) {
      allSprites.push({ name: 'sprite_anim', img: fallbackSprite });
    }

    // Include the .spritemotion.json preset in the zip
    const motionData = this.engine.exportToJson('shared_animation');
    zip.file('animation.spritemotion.json', JSON.stringify(motionData, null, 2));

    const promises = [];

    allSprites.forEach(sprite => {
      if (exportType === 'spritesheet' || exportType === 'all') {
        const sheetCanvas = this.generateSpritesheetCanvas(sprite.img, 'horizontal', 0, scale);
        const p = new Promise((resolve) => {
          sheetCanvas.toBlob((blob) => {
            zip.file(`spritesheets/${sprite.name}_sheet.png`, blob);
            resolve();
          }, 'image/png');
        });
        promises.push(p);
      }

      if (exportType === 'frames' || exportType === 'all') {
        const frames = this.generateFrameCanvases(sprite.img, scale);
        frames.forEach(f => {
          const p = new Promise((resolve) => {
            f.canvas.toBlob((blob) => {
              zip.file(`frames/${sprite.name}/${f.filename}`, blob);
              resolve();
            }, 'image/png');
          });
          promises.push(p);
        });
      }

      if (exportType === 'gif' || exportType === 'all') {
        try {
          const gifBytes = this.generateGifBytes(sprite.img, scale);
          zip.file(`gifs/${sprite.name}_anim.gif`, gifBytes);
        } catch (err) {
          console.error(`Failed to generate GIF for ${sprite.name}:`, err);
        }
      }
    });

    await Promise.all(promises);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    Exporters.downloadFile(zipBlob, `sprite_motion_batch_${exportType}.zip`);
  }
}
