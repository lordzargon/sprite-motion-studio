// Exporters and Serialization Pipeline (Version 2)
// Exports Spritesheets, Animated GIFs, Frame Sequences, and Batch ZIPs
// with Native OS "Save As" file dialogs using the Web File System Access API.

import { GIFEncoder, quantize, applyPalette } from './gifenc.js?v=2.1.0';
import { NativeFileSystem } from './file-system.js?v=2.1.0';

export class Exporters {
  constructor(motionEngine) {
    this.engine = motionEngine;
  }

  get project() {
    return this.engine.project;
  }

  // --- Spritesheet Generation ---

  /**
   * Generates a spritesheet canvas for a character (Master Sprite or Variant) and clip.
   */
  generateSpritesheetCanvas(characterOrVariant, clip, layout = 'horizontal', padding = 0, scale = 1) {
    const frameCount = clip.frames.length;
    const baseW = this.project.width;
    const baseH = this.project.height;
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

    // Render each frame into sheet
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

      this.engine.renderCharacterFrame(characterOrVariant, i, fCtx, fw, fh, { clip });
      ctx.drawImage(frameCanvas, destX, destY);
    }

    return sheetCanvas;
  }

  /**
   * Generates individual frame canvases for a character and clip.
   */
  generateFrameCanvases(characterOrVariant, clip, scale = 1) {
    const baseW = this.project.width;
    const baseH = this.project.height;
    const fw = baseW * scale;
    const fh = baseH * scale;
    const frames = [];

    for (let i = 0; i < clip.frames.length; i++) {
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = fw;
      frameCanvas.height = fh;
      const fCtx = frameCanvas.getContext('2d');
      fCtx.imageSmoothingEnabled = false;

      this.engine.renderCharacterFrame(characterOrVariant, i, fCtx, fw, fh, { clip });
      frames.push({
        index: i,
        canvas: frameCanvas,
        filename: `${clip.name.toLowerCase()}_frame_${String(i + 1).padStart(3, '0')}.png`
      });
    }

    return frames;
  }

  /**
   * Generates Animated GIF binary bytes with 1-bit transparency.
   */
  generateGifBytes(characterOrVariant, clip, scale = 4) {
    const frameCount = clip.frames.length;
    const baseW = this.project.width;
    const baseH = this.project.height;
    const fw = baseW * scale;
    const fh = baseH * scale;
    const fps = Math.max(1, clip.fps || 8);
    const delay = Math.round(1000 / fps);

    const encoder = GIFEncoder();

    for (let i = 0; i < frameCount; i++) {
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = fw;
      frameCanvas.height = fh;
      const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;

      this.engine.renderCharacterFrame(characterOrVariant, i, ctx, fw, fh, { clip });
      const imgData = ctx.getImageData(0, 0, fw, fh);
      const rgba = imgData.data;

      // Quantize with 1-bit alpha for clean pixel art transparency
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
        dispose: 2 // Clear frame background
      });
    }

    encoder.finish();
    return encoder.bytes();
  }

  // --- Native Save As Export Actions ---

  /**
   * Export Single Spritesheet PNG with Native Save As Dialog
   */
  async exportSpritesheet(characterOrVariant, clip, layout = 'horizontal', scale = 1) {
    const charName = characterOrVariant ? characterOrVariant.name : 'master';
    const suggested = `${charName}_${clip.name.toLowerCase()}_sheet.png`;
    const canvas = this.generateSpritesheetCanvas(characterOrVariant, clip, layout, 0, scale);

    return new Promise((resolve) => {
      canvas.toBlob(async (blob) => {
        const res = await NativeFileSystem.saveFile(blob, suggested, [
          { description: 'PNG Image', accept: { 'image/png': ['.png'] } }
        ]);
        resolve(res);
      }, 'image/png');
    });
  }

  /**
   * Export Animated GIF with Native Save As Dialog
   */
  async exportGif(characterOrVariant, clip, scale = 4) {
    try {
      const charName = characterOrVariant ? characterOrVariant.name : 'master';
      const suggested = `${charName}_${clip.name.toLowerCase()}.gif`;
      const bytes = this.generateGifBytes(characterOrVariant, clip, scale);
      const blob = new Blob([bytes], { type: 'image/gif' });
      return await NativeFileSystem.saveFile(blob, suggested, [
        { description: 'GIF Animation', accept: { 'image/gif': ['.gif'] } }
      ]);
    } catch (err) {
      console.error('GIF export error:', err);
      alert('Failed to generate GIF: ' + err.message);
    }
  }

  /**
   * Export PNG Sequence ZIP with Native Save As Dialog
   */
  async exportFramesZip(characterOrVariant, clip, scale = 1) {
    if (!window.JSZip) {
      alert('JSZip library is required to export ZIP.');
      return;
    }

    const zip = new window.JSZip();
    const charName = characterOrVariant ? characterOrVariant.name : 'master';
    const frames = this.generateFrameCanvases(characterOrVariant, clip, scale);

    const promises = frames.map(f => new Promise(resolve => {
      f.canvas.toBlob(blob => {
        zip.file(f.filename, blob);
        resolve();
      }, 'image/png');
    }));

    await Promise.all(promises);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    return await NativeFileSystem.saveFile(zipBlob, `${charName}_${clip.name.toLowerCase()}_frames.zip`, [
      { description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }
    ]);
  }

  /**
   * Batch Export All Variants and All Animations into a structured ZIP
   */
  async batchExportZip(exportType = 'all', scale = 1) {
    if (!window.JSZip) {
      alert('JSZip library is required for batch ZIP download.');
      return;
    }

    const zip = new window.JSZip();
    const characters = [
      { name: 'master', obj: null },
      ...this.project.variants.map(v => ({ name: v.name.replace(/[^a-zA-Z0-9_-]/g, '_'), obj: v }))
    ];
    const clips = this.project.animations;

    const promises = [];

    for (const char of characters) {
      for (const clip of clips) {
        const safeClipName = clip.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

        // 1. Spritesheet
        if (exportType === 'spritesheet' || exportType === 'all') {
          const sheet = this.generateSpritesheetCanvas(char.obj, clip, 'horizontal', 0, scale);
          const p = new Promise(resolve => {
            sheet.toBlob(blob => {
              zip.file(`spritesheets/${char.name}/${char.name}_${safeClipName}_sheet.png`, blob);
              resolve();
            }, 'image/png');
          });
          promises.push(p);
        }

        // 2. Individual frames
        if (exportType === 'frames' || exportType === 'all') {
          const frames = this.generateFrameCanvases(char.obj, clip, scale);
          frames.forEach(f => {
            const p = new Promise(resolve => {
              f.canvas.toBlob(blob => {
                zip.file(`frames/${char.name}/${safeClipName}/${f.filename}`, blob);
                resolve();
              }, 'image/png');
            });
            promises.push(p);
          });
        }

        // 3. GIF
        if (exportType === 'gif' || exportType === 'all') {
          try {
            const gifBytes = this.generateGifBytes(char.obj, clip, scale);
            zip.file(`gifs/${char.name}/${char.name}_${safeClipName}.gif`, gifBytes);
          } catch (err) {
            console.error(`GIF error for ${char.name} ${clip.name}:`, err);
          }
        }
      }
    }

    // Also include project file in the batch export!
    const projectJSON = await this.project.toJSON();
    zip.file('project.spv2.json', JSON.stringify(projectJSON, null, 2));

    await Promise.all(promises);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const suggested = `${this.project.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_v2_export.zip`;
    return await NativeFileSystem.saveFile(zipBlob, suggested, [
      { description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }
    ]);
  }

  /**
   * Save Full Project File (.spv2.json) with Native Save As Dialog
   */
  async saveProjectAs() {
    const data = await this.project.toJSON();
    const jsonStr = JSON.stringify(data, null, 2);
    const safeName = (this.project.name || 'sprite_project').replace(/[^a-zA-Z0-9_-]/g, '_');
    const suggested = `${safeName}.spv2.json`;
    return await NativeFileSystem.saveFile(jsonStr, suggested, [
      { description: 'Sprite Studio V2 Project', accept: { 'application/json': ['.spv2.json', '.json'] } }
    ]);
  }
}
