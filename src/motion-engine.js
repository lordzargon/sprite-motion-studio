// Core Motion & Layer Deformation Engine (Version 2)
// Handles layer-masked deformations, cascading variant animations,
// puppet pin solves, liquid smearing, and high-performance playback.

export class MotionEngine {
  constructor(project) {
    this.project = project;
    this.currentFrameIndex = 0;
    this.isPlaying = false;
    this.samplingMode = 'nearest'; // 'nearest' or 'bilinear'
    this.playTimer = null;
    this.listeners = new Set();
  }

  get refWidth() {
    return this.project ? this.project.width : 32;
  }

  get refHeight() {
    return this.project ? this.project.height : 32;
  }

  get fps() {
    const clip = this.project?.getActiveClip();
    return clip ? clip.fps : 8;
  }

  set fps(val) {
    const clip = this.project?.getActiveClip();
    if (clip) {
      clip.fps = Math.max(1, Math.min(60, val));
      if (this.isPlaying) {
        this.stopPlayback();
        this.startPlayback();
      }
    }
  }

  get currentClip() {
    return this.project?.getActiveClip();
  }

  get frames() {
    const clip = this.currentClip;
    return clip ? clip.frames : [];
  }

  getCurrentFrame() {
    const frames = this.frames;
    if (frames.length === 0) return null;
    if (this.currentFrameIndex >= frames.length) {
      this.currentFrameIndex = frames.length - 1;
    }
    return frames[this.currentFrameIndex];
  }

  addFrame(name = null) {
    const clip = this.currentClip;
    if (!clip) return null;
    const newFrame = clip.addFrame(name, this.currentFrameIndex + 1);
    this.currentFrameIndex++;
    this.notifyChange();
    return newFrame;
  }

  duplicateCurrentFrame() {
    const clip = this.currentClip;
    if (!clip) return null;
    const cloned = clip.duplicateFrame(this.currentFrameIndex);
    if (cloned) {
      this.currentFrameIndex++;
      this.notifyChange();
    }
    return cloned;
  }

  deleteCurrentFrame() {
    const clip = this.currentClip;
    if (!clip) return;
    clip.deleteFrame(this.currentFrameIndex);
    if (this.currentFrameIndex >= clip.frames.length) {
      this.currentFrameIndex = Math.max(0, clip.frames.length - 1);
    }
    this.notifyChange();
  }

  moveFrame(fromIndex, toIndex) {
    const clip = this.currentClip;
    if (!clip) return;
    clip.moveFrame(fromIndex, toIndex);
    this.currentFrameIndex = toIndex;
    this.notifyChange();
  }

  // --- Motion Target Helper (Master vs Variant) ---
  /**
   * Returns whether we are editing a variant or master sprite,
   * and provides a setter for layer motion on the current frame.
   */
  getActiveMotionContext(layerId) {
    const clip = this.currentClip;
    const frameIndex = this.currentFrameIndex;
    const activeVariant = this.project.getActiveVariant();

    if (activeVariant) {
      // Return variant-specific motion store
      let motion = activeVariant.resolveLayerMotion(this.project, clip.id, frameIndex, layerId);
      // Create local clone if currently inheriting
      if (!activeVariant.animationOverrides[clip.id] ||
          !activeVariant.animationOverrides[clip.id][frameIndex] ||
          !activeVariant.animationOverrides[clip.id][frameIndex][layerId]) {
        const baseMotion = motion || {};
        const localDisp = baseMotion.disp ? new Float32Array(baseMotion.disp) : new Float32Array(this.refWidth * this.refHeight * 2);
        const localCustom = baseMotion.customPixels ? new Map(baseMotion.customPixels) : new Map();
        const localPins = baseMotion.pins ? baseMotion.pins.map(p => ({ ...p })) : [];
        motion = { disp: localDisp, customPixels: localCustom, pins: localPins };
        activeVariant.setLayerMotionOverride(clip.id, frameIndex, layerId, motion);
      }
      return {
        isVariant: true,
        variant: activeVariant,
        disp: motion.disp,
        customPixels: motion.customPixels,
        pins: motion.pins
      };
    } else {
      // Editing Master Sprite frame
      const frame = this.getCurrentFrame();
      return {
        isVariant: false,
        disp: frame.getDisplacement(layerId),
        customPixels: frame.getCustomPixels(layerId),
        pins: frame.getPins(layerId)
      };
    }
  }

  // --- Layer-Masked Tool Modifications ---

  /**
   * Transforms a selection offset on the designated layer.
   * Resets to initial snapshot and cleanly computes new target displacements.
   */
  transformLayerSelection(layerId, initialMask, initDisp, initCustomPixels, totalDx, totalDy) {
    if (!initialMask) return;
    const ctx = this.getActiveMotionContext(layerId);
    const W = this.refWidth;
    const H = this.refHeight;

    // 1. Reset to the clean initial snapshot of this frame
    if (initDisp) {
      ctx.disp.set(initDisp);
    }
    ctx.customPixels.clear();
    if (initCustomPixels) {
      for (const [k, v] of initCustomPixels.entries()) {
        ctx.customPixels.set(k, v);
      }
    }

    if (totalDx === 0 && totalDy === 0) {
      this.notifyChange();
      return;
    }

    // 2. Identify which initial positions are vacated
    // An initial selected pixel at (x, y) vacates (x, y) UNLESS another selected pixel lands on (x, y).
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const mIdx = y * W + x;
        if (initialMask[mIdx] > 0) {
          const prevX = x - totalDx;
          const prevY = y - totalDy;
          const landsHere = (prevX >= 0 && prevX < W && prevY >= 0 && prevY < H && initialMask[prevY * W + prevX] > 0);
          if (!landsHere) {
            const idx = (y * W + x) * 2;
            ctx.disp[idx] = -9999;
            ctx.disp[idx + 1] = -9999;
            ctx.customPixels.delete(`${x},${y}`);
          }
        }
      }
    }

    // 3. Move selected pixels to their target positions (tx, ty)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const mIdx = y * W + x;
        if (initialMask[mIdx] > 0) {
          const tx = x + totalDx;
          const ty = y + totalDy;
          if (tx >= 0 && tx < W && ty >= 0 && ty < H) {
            const origIdx = (y * W + x) * 2;
            const origDispX = initDisp ? initDisp[origIdx] : 0;
            const origDispY = initDisp ? initDisp[origIdx + 1] : 0;

            const customCol = initCustomPixels?.get(`${x},${y}`);
            if (customCol) {
              ctx.customPixels.set(`${tx},${ty}`, customCol);
            }

            const tIdx = (ty * W + tx) * 2;
            if (origDispX <= -9000 && origDispY <= -9000) {
              ctx.disp[tIdx] = -9999;
              ctx.disp[tIdx + 1] = -9999;
            } else {
              ctx.disp[tIdx] = origDispX + totalDx;
              ctx.disp[tIdx + 1] = origDispY + totalDy;
            }
          }
        }
      }
    }

    this.notifyChange();
  }

  // Backwards compatibility alias
  applySelectionOffset(layerId, mask, dx, dy) {
    const ctx = this.getActiveMotionContext(layerId);
    this.transformLayerSelection(layerId, mask, new Float32Array(ctx.disp), new Map(ctx.customPixels), dx, dy);
  }

  applySmear(layerId, fromX, fromY, toX, toY, radius = 4, strength = 1.0) {
    const dirX = toX - fromX;
    const dirY = toY - fromY;
    if (dirX === 0 && dirY === 0) return;

    const ctx = this.getActiveMotionContext(layerId);
    const disp = ctx.disp;
    const W = this.refWidth;
    const H = this.refHeight;

    const minX = Math.max(0, Math.floor(fromX - radius));
    const maxX = Math.min(W - 1, Math.ceil(fromX + radius));
    const minY = Math.max(0, Math.floor(fromY - radius));
    const maxY = Math.min(H - 1, Math.ceil(fromY + radius));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dist = Math.hypot(x - fromX, y - fromY);
        if (dist <= radius) {
          const falloff = 0.5 * (1 + Math.cos((dist / radius) * Math.PI)) * strength;
          const idx = (y * W + x) * 2;
          disp[idx] += dirX * falloff;
          disp[idx + 1] += dirY * falloff;
        }
      }
    }
    this.notifyChange();
  }

  addPin(layerId, x, y, radius = 12) {
    const ctx = this.getActiveMotionContext(layerId);
    const pin = {
      id: 'pin_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      restX: x,
      restY: y,
      currX: x,
      currY: y,
      radius: radius
    };
    ctx.pins.push(pin);
    this.notifyChange();
    return pin;
  }

  movePin(layerId, pinId, newX, newY) {
    const ctx = this.getActiveMotionContext(layerId);
    const pin = ctx.pins.find(p => p.id === pinId);
    if (pin) {
      pin.currX = newX;
      pin.currY = newY;
      this.notifyChange();
    }
  }

  removePin(layerId, pinId) {
    const ctx = this.getActiveMotionContext(layerId);
    const idx = ctx.pins.findIndex(p => p.id === pinId);
    if (idx !== -1) {
      ctx.pins.splice(idx, 1);
      this.notifyChange();
    }
  }

  setFramePixel(layerId, x, y, r, g, b, a = 255) {
    if (x < 0 || x >= this.refWidth || y < 0 || y >= this.refHeight) return;
    const ctx = this.getActiveMotionContext(layerId);
    const idx = (y * this.refWidth + x) * 2;
    if (ctx.disp[idx] <= -9000 && ctx.disp[idx + 1] <= -9000) {
      ctx.disp[idx] = 0;
      ctx.disp[idx + 1] = 0;
    }
    ctx.customPixels.set(`${x},${y}`, [r, g, b, a]);
    this.notifyChange();
  }

  removeFramePixel(layerId, x, y) {
    if (x < 0 || x >= this.refWidth || y < 0 || y >= this.refHeight) return;
    const ctx = this.getActiveMotionContext(layerId);
    ctx.customPixels.delete(`${x},${y}`);
    const idx = (y * this.refWidth + x) * 2;
    ctx.disp[idx] = -9999;
    ctx.disp[idx + 1] = -9999;
    this.notifyChange();
  }

  clearFrameMotion(layerId = null) {
    const activeVariant = this.project.getActiveVariant();
    const clip = this.currentClip;
    if (activeVariant) {
      if (layerId) {
        activeVariant.clearLayerMotionOverride(clip.id, this.currentFrameIndex, layerId);
      } else {
        delete activeVariant.animationOverrides[clip.id]?.[this.currentFrameIndex];
      }
    } else {
      const frame = this.getCurrentFrame();
      if (frame) {
        frame.clear(layerId);
      }
    }
    this.notifyChange();
  }

  // --- Read Motion Data for a Layer (Non-mutating) ---
  getLayerMotion(layerId) {
    const clip = this.currentClip;
    if (!clip) return null;
    const frameIndex = this.currentFrameIndex;
    const activeVariant = this.project ? this.project.getActiveVariant() : null;
    if (activeVariant) {
      return activeVariant.resolveLayerMotion(this.project, clip.id, frameIndex, layerId);
    }
    const frame = this.getCurrentFrame();
    if (!frame) return null;
    return {
      disp: frame.getDisplacement(layerId),
      customPixels: frame.getCustomPixels(layerId),
      pins: frame.getPins(layerId)
    };
  }

  // --- Query Rendered Pixel for a Layer on Current Frame ---
  getLayerPixel(layer, x, y, options = {}) {
    if (!layer || x < 0 || x >= this.refWidth || y < 0 || y >= this.refHeight) return [0, 0, 0, 0];
    const motionData = this.getLayerMotion(layer.id);

    // 1. Check per-frame custom pixels
    if (motionData && motionData.customPixels && motionData.customPixels.has(`${x},${y}`)) {
      const c = motionData.customPixels.get(`${x},${y}`);
      return [c[0], c[1], c[2], c[3] !== undefined ? c[3] : 255];
    }

    // 2. Check displacement
    const disp = this.getComputedLayerDisplacement(layer.id, motionData);
    const gridIdx = (y * this.refWidth + x) * 2;
    const dx = disp[gridIdx];
    const dy = disp[gridIdx + 1];

    if (dx <= -9000 && dy <= -9000) {
      return [0, 0, 0, 0]; // Vacated / removed pixel
    }

    const normX = (x + 0.5) / this.refWidth;
    const normY = (y + 0.5) / this.refHeight;
    const srcNormX = normX - (dx / this.refWidth);
    const srcNormY = normY - (dy / this.refHeight);
    const srcX = srcNormX * layer.width;
    const srcY = srcNormY * layer.height;

    const mode = options.samplingMode || this.samplingMode;
    if (mode === 'nearest') {
      const sx = Math.floor(srcX);
      const sy = Math.floor(srcY);
      if (sx < 0 || sx >= layer.width || sy < 0 || sy >= layer.height) {
        return [0, 0, 0, 0];
      }
      return layer.getPixel(sx, sy);
    } else {
      const x0 = Math.floor(srcX - 0.5);
      const y0 = Math.floor(srcY - 0.5);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const fx = (srcX - 0.5) - x0;
      const fy = (srcY - 0.5) - y0;

      const getPix = (px, py) => {
        if (px < 0 || px >= layer.width || py < 0 || py >= layer.height) return [0, 0, 0, 0];
        return layer.getPixel(px, py);
      };

      const p00 = getPix(x0, y0);
      const p10 = getPix(x1, y0);
      const p01 = getPix(x0, y1);
      const p11 = getPix(x1, y1);

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const r = Math.round(p00[0] * w00 + p10[0] * w10 + p01[0] * w01 + p11[0] * w11);
      const g = Math.round(p00[1] * w00 + p10[1] * w10 + p01[1] * w01 + p11[1] * w11);
      const b = Math.round(p00[2] * w00 + p10[2] * w10 + p01[2] * w01 + p11[2] * w11);
      const a = Math.round(p00[3] * w00 + p10[3] * w10 + p01[3] * w01 + p11[3] * w11);
      return [r, g, b, a];
    }
  }

  // --- Compute Total Displacement Map for a Layer (incorporating Pins) ---
  getComputedLayerDisplacement(layerId, motionData) {
    const W = this.refWidth;
    const H = this.refHeight;
    const result = new Float32Array(W * H * 2);
    if (!motionData) return result;

    const baseDisp = motionData.disp;
    if (baseDisp) {
      result.set(baseDisp);
    }

    const pins = motionData.pins;
    if (pins && pins.length > 0) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const idx = (y * W + x) * 2;
          if (result[idx] <= -9000) continue;

          let sumWeight = 0;
          let pinDx = 0;
          let pinDy = 0;

          for (let i = 0; i < pins.length; i++) {
            const p = pins[i];
            const dist = Math.hypot(x - p.restX, y - p.restY);
            if (dist < p.radius) {
              const w = 0.5 * (1 + Math.cos((dist / p.radius) * Math.PI));
              sumWeight += w;
              pinDx += (p.currX - p.restX) * w;
              pinDy += (p.currY - p.restY) * w;
            }
          }

          if (sumWeight > 0) {
            result[idx] += pinDx / Math.max(sumWeight, 1);
            result[idx + 1] += pinDy / Math.max(sumWeight, 1);
          }
        }
      }
    }

    return result;
  }

  // --- Rendering Layer Deformations ---

  /**
   * Deforms a single layer canvas onto targetCtx
   */
  renderDeformedLayer(layer, motionData, targetCtx, outW, outH, options = {}) {
    const srcW = layer.width;
    const srcH = layer.height;
    const mode = options.samplingMode || this.samplingMode;
    const alpha = (options.alpha !== undefined ? options.alpha : 1.0) * (layer.opacity !== undefined ? layer.opacity : 1.0);
    const tintColor = options.tintColor || null;

    const srcImgData = layer.ctx.getImageData(0, 0, srcW, srcH);
    const srcPixels = srcImgData.data;

    const outImgData = targetCtx.createImageData(outW, outH);
    const outPixels = outImgData.data;

    const disp = this.getComputedLayerDisplacement(layer.id, motionData);
    const customPixels = motionData ? motionData.customPixels : null;

    for (let y = 0; y < outH; y++) {
      const normY = (y + 0.5) / outH;
      const refGridY = Math.min(Math.max(Math.floor(normY * this.refHeight), 0), this.refHeight - 1);

      for (let x = 0; x < outW; x++) {
        const normX = (x + 0.5) / outW;
        const refGridX = Math.min(Math.max(Math.floor(normX * this.refWidth), 0), this.refWidth - 1);

        // Check custom pixel addition
        const customCol = customPixels ? customPixels.get(`${refGridX},${refGridY}`) : null;
        if (customCol) {
          const outIdx = (y * outW + x) * 4;
          if (tintColor) {
            outPixels[outIdx] = tintColor[0];
            outPixels[outIdx + 1] = tintColor[1];
            outPixels[outIdx + 2] = tintColor[2];
            outPixels[outIdx + 3] = Math.round((customCol[3] !== undefined ? customCol[3] : 255) * alpha);
          } else {
            outPixels[outIdx] = customCol[0];
            outPixels[outIdx + 1] = customCol[1];
            outPixels[outIdx + 2] = customCol[2];
            outPixels[outIdx + 3] = Math.round((customCol[3] !== undefined ? customCol[3] : 255) * alpha);
          }
          continue;
        }

        const gridIdx = (refGridY * this.refWidth + refGridX) * 2;
        const dx = disp[gridIdx];
        const dy = disp[gridIdx + 1];

        if (dx <= -9000 && dy <= -9000) {
          continue; // Vacated pixel
        }

        // Backward sampling
        const srcNormX = normX - (dx / this.refWidth);
        const srcNormY = normY - (dy / this.refHeight);
        const srcX = srcNormX * srcW;
        const srcY = srcNormY * srcH;

        let r = 0, g = 0, b = 0, a = 0;

        if (mode === 'nearest') {
          const sx = Math.floor(srcX);
          const sy = Math.floor(srcY);
          if (sx >= 0 && sx < srcW && sy >= 0 && sy < srcH) {
            const sIdx = (sy * srcW + sx) * 4;
            r = srcPixels[sIdx];
            g = srcPixels[sIdx + 1];
            b = srcPixels[sIdx + 2];
            a = srcPixels[sIdx + 3];
          }
        } else {
          // Bilinear
          const x0 = Math.floor(srcX - 0.5);
          const y0 = Math.floor(srcY - 0.5);
          const x1 = x0 + 1;
          const y1 = y0 + 1;
          const fx = (srcX - 0.5) - x0;
          const fy = (srcY - 0.5) - y0;

          const getPix = (px, py) => {
            if (px < 0 || px >= srcW || py < 0 || py >= srcH) return [0, 0, 0, 0];
            const idx = (py * srcW + px) * 4;
            return [srcPixels[idx], srcPixels[idx + 1], srcPixels[idx + 2], srcPixels[idx + 3]];
          };

          const p00 = getPix(x0, y0);
          const p10 = getPix(x1, y0);
          const p01 = getPix(x0, y1);
          const p11 = getPix(x1, y1);

          const w00 = (1 - fx) * (1 - fy);
          const w10 = fx * (1 - fy);
          const w01 = (1 - fx) * fy;
          const w11 = fx * fy;

          r = Math.round(p00[0] * w00 + p10[0] * w10 + p01[0] * w01 + p11[0] * w11);
          g = Math.round(p00[1] * w00 + p10[1] * w10 + p01[1] * w01 + p11[1] * w11);
          b = Math.round(p00[2] * w00 + p10[2] * w10 + p01[2] * w01 + p11[2] * w11);
          a = Math.round(p00[3] * w00 + p10[3] * w10 + p01[3] * w01 + p11[3] * w11);
        }

        if (a > 0) {
          const outIdx = (y * outW + x) * 4;
          if (tintColor) {
            outPixels[outIdx] = tintColor[0];
            outPixels[outIdx + 1] = tintColor[1];
            outPixels[outIdx + 2] = tintColor[2];
            outPixels[outIdx + 3] = Math.round(a * alpha);
          } else {
            outPixels[outIdx] = r;
            outPixels[outIdx + 1] = g;
            outPixels[outIdx + 2] = b;
            outPixels[outIdx + 3] = Math.round(a * alpha);
          }
        }
      }
    }

    // Blend onto target context using a temporary canvas to support transparency blending
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = outW;
    tempCanvas.height = outH;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(outImgData, 0, 0);

    targetCtx.drawImage(tempCanvas, 0, 0);
  }

  /**
   * Renders the complete composite character frame (Master Sprite or Variant)
   * onto targetCtx. Draws lower layers first, upper layers over lower layers.
   */
  renderCharacterFrame(characterOrVariant, frameIndex, targetCtx, outW, outH, options = {}) {
    if (!this.project) return;
    const clip = options.clip || this.currentClip;
    if (!clip) return;
    const fIdx = (frameIndex !== undefined && frameIndex >= 0) ? frameIndex : this.currentFrameIndex;

    const isVariant = !!(characterOrVariant && characterOrVariant.resolveLayers);
    const layers = isVariant
      ? characterOrVariant.resolveLayers(this.project)
      : this.project.masterSprite.layers;

    if (options.clear !== false) {
      targetCtx.clearRect(0, 0, outW, outH);
    }

    // Render layers from bottom to top
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer.visible) continue;

      let motion = null;
      if (isVariant) {
        motion = characterOrVariant.resolveLayerMotion(this.project, clip.id, fIdx, layer.id);
      } else {
        const frame = clip.frames[fIdx];
        if (frame) {
          motion = {
            disp: frame.getDisplacement(layer.id),
            customPixels: frame.getCustomPixels(layer.id),
            pins: frame.getPins(layer.id)
          };
        }
      }

      this.renderDeformedLayer(layer, motion, targetCtx, outW, outH, options);
    }
  }

  // --- Playback Control ---
  startPlayback(onFrameTick = null) {
    if (this.isPlaying) return;
    this.isPlaying = true;

    const tick = () => {
      if (!this.isPlaying) return;
      const clip = this.currentClip;
      if (clip && clip.frames.length > 0) {
        this.currentFrameIndex = (this.currentFrameIndex + 1) % clip.frames.length;
        if (onFrameTick) onFrameTick(this.currentFrameIndex);
        this.notifyChange();
      }
      const interval = 1000 / Math.max(1, this.fps);
      this.playTimer = setTimeout(tick, interval);
    };

    const interval = 1000 / Math.max(1, this.fps);
    this.playTimer = setTimeout(tick, interval);
  }

  stopPlayback() {
    this.isPlaying = false;
    if (this.playTimer) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
  }

  togglePlayback(onFrameTick = null) {
    if (this.isPlaying) {
      this.stopPlayback();
    } else {
      this.startPlayback(onFrameTick);
    }
    return this.isPlaying;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyChange() {
    this.listeners.forEach(cb => cb());
  }
}
