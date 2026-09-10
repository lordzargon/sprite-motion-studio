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

  addBlankFrame(name = null) {
    return this.addFrame(name);
  }

  /**
   * Serializes the specified (or current) frame's layer motion data
   * (displacements, per-frame custom pixels, pins) for copying to clipboard.
   * @param {number|null} frameIndex
   * @returns {Object|null}
   */
  copyFrameData(frameIndex = null) {
    const clip = this.currentClip;
    if (!clip || clip.frames.length === 0) return null;
    const fIdx = (frameIndex !== null && frameIndex !== undefined) ? frameIndex : this.currentFrameIndex;
    const frame = clip.frames[fIdx];
    if (!frame) return null;

    const activeVariant = this.project?.getActiveVariant();
    const layers = activeVariant
      ? activeVariant.resolveLayers(this.project)
      : (this.project?.masterSprite?.layers || []);

    const serializedLayers = [];
    for (const layer of layers) {
      let disp = null;
      let customPixels = null;
      let pins = null;

      if (activeVariant) {
        const motion = activeVariant.resolveLayerMotion(this.project, clip.id, fIdx, layer.id);
        if (motion) {
          if (motion.disp) {
            let hasVal = false;
            for (let k = 0; k < motion.disp.length; k++) {
              if (motion.disp[k] !== 0) { hasVal = true; break; }
            }
            if (hasVal) disp = Array.from(motion.disp);
          }
          if (motion.customPixels && motion.customPixels.size > 0) {
            customPixels = Array.from(motion.customPixels.entries());
          }
          if (motion.pins && motion.pins.length > 0) {
            pins = motion.pins.map(p => ({ ...p }));
          }
        }
      } else {
        const rawDisp = frame.layerDisplacements[layer.id];
        if (rawDisp) {
          let hasVal = false;
          for (let k = 0; k < rawDisp.length; k++) {
            if (rawDisp[k] !== 0) { hasVal = true; break; }
          }
          if (hasVal) disp = Array.from(rawDisp);
        }

        const rawCustom = frame.layerCustomPixels[layer.id];
        if (rawCustom && rawCustom.size > 0) {
          customPixels = Array.from(rawCustom.entries());
        }

        const rawPins = frame.layerPins[layer.id];
        if (rawPins && rawPins.length > 0) {
          pins = rawPins.map(p => ({ ...p }));
        }
      }

      serializedLayers.push({
        layerId: layer.id,
        layerName: layer.name,
        disp,
        customPixels,
        pins
      });
    }

    return {
      type: 'sprite-motion-studio/frame',
      version: 1,
      sourceClipId: clip.id,
      sourceClipName: clip.name,
      sourceFrameIndex: fIdx,
      sourceVariantId: activeVariant ? activeVariant.id : null,
      sourceVariantName: activeVariant ? activeVariant.name : null,
      width: this.refWidth,
      height: this.refHeight,
      frameName: frame.name,
      layers: serializedLayers
    };
  }

  /**
   * Applies serialized frame data onto a target frame (defaults to currentFrameIndex).
   * Maps layers by layerId, with fallback to layerName.
   * @param {Object} frameData
   * @param {number|null} targetFrameIndex
   * @returns {boolean}
   */
  pasteFrameData(frameData, targetFrameIndex = null) {
    if (!frameData || !frameData.layers) return false;
    const clip = this.currentClip;
    if (!clip) return false;

    // Ensure there is at least one frame
    if (clip.frames.length === 0) {
      clip.addFrame('Frame 1');
      this.currentFrameIndex = 0;
    }

    const fIdx = (targetFrameIndex !== null && targetFrameIndex !== undefined) ? targetFrameIndex : this.currentFrameIndex;
    if (fIdx < 0 || fIdx >= clip.frames.length) return false;
    const targetFrame = clip.frames[fIdx];

    const activeVariant = this.project?.getActiveVariant();
    const availableLayers = activeVariant
      ? activeVariant.resolveLayers(this.project)
      : (this.project?.masterSprite?.layers || []);

    if (activeVariant) {
      // Clear current variant overrides on this frame
      if (activeVariant.animationOverrides[clip.id]?.[fIdx]) {
        delete activeVariant.animationOverrides[clip.id][fIdx];
      }
    } else {
      // Clear displacements/custom pixels/pins on target frame
      targetFrame.clear();
    }

    for (const item of frameData.layers) {
      // Find matching layer: first by ID, then by name
      let targetLayer = availableLayers.find(l => l.id === item.layerId);
      if (!targetLayer) {
        targetLayer = availableLayers.find(l => l.name.toLowerCase() === (item.layerName || '').toLowerCase());
      }
      if (!targetLayer) continue;

      const layerId = targetLayer.id;

      if (activeVariant) {
        const localDisp = item.disp ? new Float32Array(item.disp) : new Float32Array(this.refWidth * this.refHeight * 2);
        const localCustom = item.customPixels ? new Map(item.customPixels) : new Map();
        const localPins = item.pins ? item.pins.map(p => ({ ...p })) : [];
        activeVariant.setLayerMotionOverride(clip.id, fIdx, layerId, {
          disp: localDisp,
          customPixels: localCustom,
          pins: localPins
        });
      } else {
        if (item.disp) {
          targetFrame.setDisplacement(layerId, item.disp);
        }
        if (item.customPixels && item.customPixels.length > 0) {
          const map = targetFrame.getCustomPixels(layerId);
          for (const [coord, rgba] of item.customPixels) {
            map.set(coord, rgba);
          }
        }
        if (item.pins && item.pins.length > 0) {
          targetFrame.layerPins[layerId] = item.pins.map(p => ({ ...p }));
        }
      }
    }

    this.notifyChange();
    return true;
  }

  /**
   * Pastes serialized frame data as a new keyframe after the current frame.
   * @param {Object} frameData
   * @returns {AnimationFrame|null}
   */
  pasteAsNewFrame(frameData) {
    if (!frameData || !frameData.layers) return null;
    const clip = this.currentClip;
    if (!clip) return null;

    const insertIdx = this.currentFrameIndex + 1;
    const frameName = `Frame ${clip.frames.length + 1}`;
    const newFrame = clip.addFrame(frameName, insertIdx);
    this.currentFrameIndex = insertIdx;

    this.pasteFrameData(frameData, insertIdx);
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
   * Transforms a selection on the designated layer (Move, Rotate, Skew).
   * Supports both legacy (totalDx, totalDy) and transform options object { dx, dy, angle, skewX, skewY, cx, cy, initialBounds }.
   * Resets to initial snapshot and cleanly computes new target displacements.
   */
  transformLayerSelection(layerId, initialMask, initDisp, initCustomPixels, transformOrDx, totalDy = 0) {
    if (!initialMask) return null;
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

    const isSimpleDxDy = (typeof transformOrDx === 'number');
    const transform = isSimpleDxDy
      ? { dx: transformOrDx, dy: totalDy || 0, angle: 0, skewX: 0, skewY: 0 }
      : (transformOrDx || {});

    const dx = transform.dx || 0;
    const dy = transform.dy || 0;
    const angle = transform.angle || 0;
    const skewX = transform.skewX || 0;
    const skewY = transform.skewY || 0;

    const isIdentity = (dx === 0 && dy === 0 && angle === 0 && skewX === 0 && skewY === 0);
    if (isIdentity) {
      this.notifyChange();
      return { newMask: new Uint8Array(initialMask), bounds: transform.initialBounds || null };
    }

    // Fast path for pure integer translation
    if (angle === 0 && skewX === 0 && skewY === 0 && Number.isInteger(dx) && Number.isInteger(dy)) {
      const targetLands = new Uint8Array(W * H);
      let bMinX = W, bMinY = H, bMaxX = -1, bMaxY = -1;

      // Identify which initial positions are vacated
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const mIdx = y * W + x;
          if (initialMask[mIdx] > 0) {
            const prevX = x - dx;
            const prevY = y - dy;
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

      // Move selected pixels to their target positions (tx, ty)
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const mIdx = y * W + x;
          if (initialMask[mIdx] > 0) {
            const tx = x + dx;
            const ty = y + dy;
            if (tx >= 0 && tx < W && ty >= 0 && ty < H) {
              targetLands[ty * W + tx] = 1;
              if (tx < bMinX) bMinX = tx;
              if (tx > bMaxX) bMaxX = tx;
              if (ty < bMinY) bMinY = ty;
              if (ty > bMaxY) bMaxY = ty;

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
                ctx.disp[tIdx] = origDispX + dx;
                ctx.disp[tIdx + 1] = origDispY + dy;
              }
            }
          }
        }
      }

      this.notifyChange();
      return {
        newMask: targetLands,
        bounds: (bMaxX >= bMinX ? { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY } : null)
      };
    }

    // General Inverse Affine Transformation (Rotate, Skew, Move)
    let initBounds = transform.initialBounds;
    if (!initBounds) {
      let iMinX = W, iMinY = H, iMaxX = -1, iMaxY = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (initialMask[y * W + x] > 0) {
            if (x < iMinX) iMinX = x;
            if (x > iMaxX) iMaxX = x;
            if (y < iMinY) iMinY = y;
            if (y > iMaxY) iMaxY = y;
          }
        }
      }
      initBounds = (iMaxX >= iMinX) ? { minX: iMinX, minY: iMinY, maxX: iMaxX, maxY: iMaxY } : { minX: 0, minY: 0, maxX: W - 1, maxY: H - 1 };
    }

    const cx = transform.cx !== undefined ? transform.cx : (initBounds.minX + initBounds.maxX + 1) / 2;
    const cy = transform.cy !== undefined ? transform.cy : (initBounds.minY + initBounds.maxY + 1) / 2;

    const det = 1 - skewX * skewY;
    const safeDet = Math.abs(det) < 1e-5 ? (det < 0 ? -1e-5 : 1e-5) : det;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    // Forward map corner points to estimate target scan bounds
    const forwardPoint = (px, py) => {
      const u = px - cx;
      const v = py - cy;
      const us = u + skewX * v;
      const vs = v + skewY * u;
      const ur = us * cosA - vs * sinA;
      const vr = us * sinA + vs * cosA;
      return { x: cx + ur + dx, y: cy + vr + dy };
    };

    const c0 = forwardPoint(initBounds.minX, initBounds.minY);
    const c1 = forwardPoint(initBounds.maxX + 1, initBounds.minY);
    const c2 = forwardPoint(initBounds.maxX + 1, initBounds.maxY + 1);
    const c3 = forwardPoint(initBounds.minX, initBounds.maxY + 1);

    const minTargetX = Math.min(c0.x, c1.x, c2.x, c3.x);
    const maxTargetX = Math.max(c0.x, c1.x, c2.x, c3.x);
    const minTargetY = Math.min(c0.y, c1.y, c2.y, c3.y);
    const maxTargetY = Math.max(c0.y, c1.y, c2.y, c3.y);

    const dstMinX = Math.max(0, Math.floor(minTargetX) - 2);
    const dstMaxX = Math.min(W - 1, Math.ceil(maxTargetX) + 2);
    const dstMinY = Math.max(0, Math.floor(minTargetY) - 2);
    const dstMaxY = Math.min(H - 1, Math.ceil(maxTargetY) + 2);

    const targetLands = new Uint8Array(W * H);
    const targetMap = [];
    let bMinX = W, bMinY = H, bMaxX = -1, bMaxY = -1;

    // Scan target area and sample using inverse mapping
    for (let ty = dstMinY; ty <= dstMaxY; ty++) {
      for (let tx = dstMinX; tx <= dstMaxX; tx++) {
        const u0 = (tx + 0.5) - cx - dx;
        const v0 = (ty + 0.5) - cy - dy;
        const us = u0 * cosA + v0 * sinA;
        const vs = -u0 * sinA + v0 * cosA;
        const u = (us - skewX * vs) / safeDet;
        const v = (-skewY * us + vs) / safeDet;
        const sxExact = cx + u;
        const syExact = cy + v;
        const sx = Math.floor(sxExact);
        const sy = Math.floor(syExact);

        if (sx >= 0 && sx < W && sy >= 0 && sy < H && initialMask[sy * W + sx] > 0) {
          targetLands[ty * W + tx] = 1;
          targetMap.push({ tx, ty, sx, sy });
          if (tx < bMinX) bMinX = tx;
          if (tx > bMaxX) bMaxX = tx;
          if (ty < bMinY) bMinY = ty;
          if (ty > bMaxY) bMaxY = ty;
        }
      }
    }

    // Vacate positions that were initially selected and not covered by target
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (initialMask[y * W + x] > 0 && targetLands[y * W + x] === 0) {
          const idx = (y * W + x) * 2;
          ctx.disp[idx] = -9999;
          ctx.disp[idx + 1] = -9999;
          ctx.customPixels.delete(`${x},${y}`);
        }
      }
    }

    // Apply displacements to destination pixels
    for (let i = 0; i < targetMap.length; i++) {
      const { tx, ty, sx, sy } = targetMap[i];
      const origIdx = (sy * W + sx) * 2;
      const origDispX = initDisp ? initDisp[origIdx] : 0;
      const origDispY = initDisp ? initDisp[origIdx + 1] : 0;

      const customCol = initCustomPixels?.get(`${sx},${sy}`);
      if (customCol) {
        ctx.customPixels.set(`${tx},${ty}`, customCol);
      }

      const tIdx = (ty * W + tx) * 2;
      if (origDispX <= -9000 && origDispY <= -9000) {
        ctx.disp[tIdx] = -9999;
        ctx.disp[tIdx + 1] = -9999;
      } else {
        ctx.disp[tIdx] = origDispX + (tx - sx);
        ctx.disp[tIdx + 1] = origDispY + (ty - sy);
      }
    }

    this.notifyChange();
    return {
      newMask: targetLands,
      bounds: (bMaxX >= bMinX ? { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY } : null)
    };
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

  pickPixel(layer, x, y) {
    if (!layer || x < 0 || x >= this.refWidth || y < 0 || y >= this.refHeight) return null;
    const ctx = this.getActiveMotionContext(layer.id);
    const key = `${x},${y}`;
    const idx = (y * this.refWidth + x) * 2;

    if (ctx.customPixels && ctx.customPixels.has(key)) {
      const col = ctx.customPixels.get(key);
      ctx.customPixels.delete(key);
      ctx.disp[idx] = -9999;
      ctx.disp[idx + 1] = -9999;
      this.notifyChange();
      return {
        layerId: layer.id,
        isCustom: true,
        color: [col[0], col[1], col[2], col[3] !== undefined ? col[3] : 255]
      };
    }

    const curDx = ctx.disp[idx];
    const curDy = ctx.disp[idx + 1];
    if (curDx <= -9000 && curDy <= -9000) {
      return null;
    }

    const origX = Math.round(x - curDx);
    const origY = Math.round(y - curDy);
    if (origX < 0 || origX >= layer.width || origY < 0 || origY >= layer.height) {
      return null;
    }

    const col = layer.getPixel(origX, origY);
    if (!col || col[3] === 0) {
      return null;
    }

    ctx.disp[idx] = -9999;
    ctx.disp[idx + 1] = -9999;
    this.notifyChange();

    return {
      layerId: layer.id,
      isCustom: false,
      origX,
      origY,
      color: col
    };
  }

  placePixel(layer, x, y, pickedData) {
    if (!layer || x < 0 || x >= this.refWidth || y < 0 || y >= this.refHeight || !pickedData) return;
    const ctx = this.getActiveMotionContext(layer.id);
    const key = `${x},${y}`;
    const idx = (y * this.refWidth + x) * 2;

    if (pickedData.isCustom) {
      ctx.customPixels.set(key, pickedData.color);
      if (ctx.disp[idx] <= -9000 && ctx.disp[idx + 1] <= -9000) {
        ctx.disp[idx] = 0;
        ctx.disp[idx + 1] = 0;
      }
    } else {
      ctx.customPixels.delete(key);
      ctx.disp[idx] = x - pickedData.origX;
      ctx.disp[idx + 1] = y - pickedData.origY;
    }
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
