// Core Motion & Pixel Offset Engine
// Handles recording, manipulation, deformation algorithms (RBF/Puppet Warp, Selection Shifts, Smudge),
// and universal playback onto any target sprite.

export class MotionEngine {
  constructor(refWidth = 32, refHeight = 32) {
    this.refWidth = refWidth;
    this.refHeight = refHeight;
    this.fps = 8;
    this.loop = true;
    this.currentFrameIndex = 0;
    this.samplingMode = 'nearest'; // 'nearest' for pixel art, 'bilinear' for smooth
    
    // Animation frames list
    this.frames = [];
    this.initDefaultFrames();
  }

  setReferenceDimensions(width, height) {
    if (this.refWidth === width && this.refHeight === height) return;
    const oldW = this.refWidth;
    const oldH = this.refHeight;
    this.refWidth = width;
    this.refHeight = height;

    // Rescale existing frames
    this.frames.forEach(frame => {
      frame.rescale(oldW, oldH, width, height);
    });
  }

  initDefaultFrames() {
    this.frames = [
      new MotionFrame(this.refWidth, this.refHeight, 'Frame 1'),
      new MotionFrame(this.refWidth, this.refHeight, 'Frame 2'),
      new MotionFrame(this.refWidth, this.refHeight, 'Frame 3'),
      new MotionFrame(this.refWidth, this.refHeight, 'Frame 4'),
    ];
    this.currentFrameIndex = 0;
  }

  getCurrentFrame() {
    if (this.frames.length === 0) {
      this.frames.push(new MotionFrame(this.refWidth, this.refHeight, 'Frame 1'));
    }
    if (this.currentFrameIndex >= this.frames.length) {
      this.currentFrameIndex = this.frames.length - 1;
    }
    return this.frames[this.currentFrameIndex];
  }

  addFrame(name = null) {
    const frameName = name || `Frame ${this.frames.length + 1}`;
    const newFrame = new MotionFrame(this.refWidth, this.refHeight, frameName);
    // If we have a previous frame, start with a clean or cloned state
    this.frames.splice(this.currentFrameIndex + 1, 0, newFrame);
    this.currentFrameIndex++;
    return newFrame;
  }

  duplicateCurrentFrame() {
    const current = this.getCurrentFrame();
    const cloned = current.clone(`Frame ${this.frames.length + 1} (Copy)`);
    this.frames.splice(this.currentFrameIndex + 1, 0, cloned);
    this.currentFrameIndex++;
    return cloned;
  }

  deleteCurrentFrame() {
    if (this.frames.length <= 1) {
      // Clear current frame instead of deleting last one
      this.getCurrentFrame().clear();
      return;
    }
    this.frames.splice(this.currentFrameIndex, 1);
    if (this.currentFrameIndex >= this.frames.length) {
      this.currentFrameIndex = this.frames.length - 1;
    }
  }

  moveFrame(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.frames.length) return;
    if (toIndex < 0 || toIndex >= this.frames.length) return;
    const [moved] = this.frames.splice(fromIndex, 1);
    this.frames.splice(toIndex, 0, moved);
    this.currentFrameIndex = toIndex;
  }

  // Renders a specific frame for any sprite onto a target canvas context
  renderSpriteFrame(spriteImgOrCanvas, frameIndex, targetCtx, targetWidth, targetHeight, options = {}) {
    const frame = this.frames[frameIndex];
    if (!frame) return;

    const srcW = spriteImgOrCanvas.naturalWidth || spriteImgOrCanvas.width || spriteImgOrCanvas.videoWidth || 32;
    const srcH = spriteImgOrCanvas.naturalHeight || spriteImgOrCanvas.height || spriteImgOrCanvas.videoHeight || 32;
    const outW = targetWidth || srcW;
    const outH = targetHeight || srcH;

    // Get source pixel data
    const tempSrcCanvas = document.createElement('canvas');
    tempSrcCanvas.width = srcW;
    tempSrcCanvas.height = srcH;
    const tempSrcCtx = tempSrcCanvas.getContext('2d', { willReadFrequently: true });
    tempSrcCtx.imageSmoothingEnabled = false;
    tempSrcCtx.drawImage(spriteImgOrCanvas, 0, 0, srcW, srcH);
    const srcImgData = tempSrcCtx.getImageData(0, 0, srcW, srcH);
    const srcPixels = srcImgData.data;

    // Target image data buffer
    const outImgData = targetCtx.createImageData(outW, outH);
    const outPixels = outImgData.data;

    const mode = options.samplingMode || this.samplingMode;
    const onionAlpha = options.alpha !== undefined ? options.alpha : 1.0;
    const tintColor = options.tintColor || null; // e.g. [255, 50, 50] for red ghost

    // Precalculate displacement map if puppet pins or transforms are active
    const disp = frame.getComputedDisplacement(this.refWidth, this.refHeight);

    for (let y = 0; y < outH; y++) {
      const normY = (y + 0.5) / outH;
      const refGridY = Math.min(Math.max(Math.floor(normY * this.refHeight), 0), this.refHeight - 1);

      for (let x = 0; x < outW; x++) {
        const normX = (x + 0.5) / outW;
        const refGridX = Math.min(Math.max(Math.floor(normX * this.refWidth), 0), this.refWidth - 1);

        // Check for custom added pixel at this reference grid coordinate
        const customCol = frame.customPixels ? frame.customPixels.get(`${refGridX},${refGridY}`) : null;
        if (customCol) {
          const outIdx = (y * outW + x) * 4;
          if (tintColor) {
            outPixels[outIdx] = tintColor[0];
            outPixels[outIdx + 1] = tintColor[1];
            outPixels[outIdx + 2] = tintColor[2];
            outPixels[outIdx + 3] = Math.round((customCol[3] !== undefined ? customCol[3] : 255) * onionAlpha);
          } else {
            outPixels[outIdx] = customCol[0];
            outPixels[outIdx + 1] = customCol[1];
            outPixels[outIdx + 2] = customCol[2];
            outPixels[outIdx + 3] = Math.round((customCol[3] !== undefined ? customCol[3] : 255) * onionAlpha);
          }
          continue;
        }

        const gridIdx = (refGridY * this.refWidth + refGridX) * 2;
        const dx = disp[gridIdx];
        const dy = disp[gridIdx + 1];

        if (dx <= -9000 && dy <= -9000) {
          // Marked empty / vacated pixel
          continue;
        }

        // Backward sampling: compute normalized source coordinate
        const srcNormX = normX - (dx / this.refWidth);
        const srcNormY = normY - (dy / this.refHeight);

        // Map to source image pixel coordinates
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
          // Bilinear sampling
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
            outPixels[outIdx + 3] = Math.round(a * onionAlpha);
          } else {
            outPixels[outIdx] = r;
            outPixels[outIdx + 1] = g;
            outPixels[outIdx + 2] = b;
            outPixels[outIdx + 3] = Math.round(a * onionAlpha);
          }
        }
      }
    }

    targetCtx.putImageData(outImgData, 0, 0);
  }

  // Serializes motion data to JSON format (.spritemotion.json)
  exportToJson(name = 'sprite_animation') {
    return {
      version: '1.0.0',
      format: 'spritemotion',
      name: name,
      fps: this.fps,
      loop: this.loop,
      resolution: { width: this.refWidth, height: this.refHeight },
      frameCount: this.frames.length,
      frames: this.frames.map((f, idx) => f.toJSON(idx))
    };
  }

  // Imports motion data from JSON
  loadFromJson(jsonObj) {
    if (!jsonObj || !jsonObj.frames) {
      throw new Error('Invalid sprite motion format');
    }
    this.fps = jsonObj.fps || 8;
    this.loop = jsonObj.loop !== undefined ? jsonObj.loop : true;
    if (jsonObj.resolution) {
      this.refWidth = jsonObj.resolution.width || 32;
      this.refHeight = jsonObj.resolution.height || 32;
    }
    this.frames = jsonObj.frames.map((fData, idx) => {
      return MotionFrame.fromJSON(fData, this.refWidth, this.refHeight, `Frame ${idx + 1}`);
    });
    this.currentFrameIndex = 0;
  }
}

// Represents a single animation frame containing displacement vectors, custom pixels, and pins
export class MotionFrame {
  constructor(width = 32, height = 32, name = 'Frame') {
    this.width = width;
    this.height = height;
    this.name = name;
    this.duration = 1.0; // multiplier (1.0 = normal frame duration)

    // Raw displacement field: Float32Array of length width * height * 2 [dx, dy, dx, dy...]
    this.displacementField = new Float32Array(width * height * 2);

    // Custom added/painted pixels: Map of "x,y" => [r, g, b, a]
    this.customPixels = new Map();

    // Puppet warp pins: Array of { id, restX, restY, currX, currY, radius }
    this.pins = [];

    // Region selections & transforms
    this.selectionMask = null; // Uint8Array (0 or 1) for active selection
    this.activeTransform = null; // { dx, dy, rotation, originX, originY, bounds }
  }

  clear() {
    this.displacementField.fill(0);
    this.pins = [];
    this.selectionMask = null;
    this.activeTransform = null;
    this.customPixels.clear();
  }

  clone(newName = null) {
    const copy = new MotionFrame(this.width, this.height, newName || `${this.name} (Copy)`);
    copy.duration = this.duration;
    copy.displacementField.set(this.displacementField);
    copy.pins = this.pins.map(p => ({ ...p }));
    if (this.selectionMask) {
      copy.selectionMask = new Uint8Array(this.selectionMask);
    }
    if (this.activeTransform) {
      copy.activeTransform = { ...this.activeTransform };
    }
    this.customPixels.forEach((col, key) => {
      copy.customPixels.set(key, [...col]);
    });
    return copy;
  }

  // --- Pixel Add & Remove ---
  setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = (y * this.width + x) * 2;
    // If pixel was previously vacated, clear displacement to 0
    if (this.displacementField[idx] <= -9000 && this.displacementField[idx + 1] <= -9000) {
      this.displacementField[idx] = 0;
      this.displacementField[idx + 1] = 0;
    }
    this.customPixels.set(`${x},${y}`, [r, g, b, a]);
  }

  removePixel(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    this.customPixels.delete(`${x},${y}`);
    const idx = (y * this.width + x) * 2;
    this.displacementField[idx] = -9999;
    this.displacementField[idx + 1] = -9999;
  }

  getCustomPixel(x, y) {
    return this.customPixels.get(`${x},${y}`) || null;
  }

  rescale(oldW, oldH, newW, newH) {
    const newField = new Float32Array(newW * newH * 2);
    const scaleX = newW / oldW;
    const scaleY = newH / oldH;

    for (let y = 0; y < newH; y++) {
      const srcY = Math.min(Math.floor(y / scaleY), oldH - 1);
      for (let x = 0; x < newW; x++) {
        const srcX = Math.min(Math.floor(x / scaleX), oldW - 1);
        const oldIdx = (srcY * oldW + srcX) * 2;
        const newIdx = (y * newW + x) * 2;
        newField[newIdx] = this.displacementField[oldIdx] * scaleX;
        newField[newIdx + 1] = this.displacementField[oldIdx + 1] * scaleY;
      }
    }

    this.width = newW;
    this.height = newH;
    this.displacementField = newField;

    // Rescale custom pixels
    const newCustomPixels = new Map();
    this.customPixels.forEach((col, key) => {
      const [pxStr, pyStr] = key.split(',');
      const newPx = Math.min(Math.floor(parseInt(pxStr, 10) * scaleX), newW - 1);
      const newPy = Math.min(Math.floor(parseInt(pyStr, 10) * scaleY), newH - 1);
      newCustomPixels.set(`${newPx},${newPy}`, col);
    });
    this.customPixels = newCustomPixels;

    // Rescale pins
    this.pins.forEach(pin => {
      pin.restX *= scaleX;
      pin.restY *= scaleY;
      pin.currX *= scaleX;
      pin.currY *= scaleY;
      pin.radius *= Math.min(scaleX, scaleY);
    });
  }

  // --- Puppet Pin System ---
  addPin(x, y, radius = 12) {
    const pin = {
      id: 'pin_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      restX: x,
      restY: y,
      currX: x,
      currY: y,
      radius: radius
    };
    this.pins.push(pin);
    return pin;
  }

  movePin(pinId, newX, newY) {
    const pin = this.pins.find(p => p.id === pinId);
    if (pin) {
      pin.currX = newX;
      pin.currY = newY;
    }
  }

  removePin(pinId) {
    this.pins = this.pins.filter(p => p.id !== pinId);
  }

  // --- Smear / Push Brush ---
  applySmear(fromX, fromY, toX, toY, radius = 4, strength = 1.0) {
    const dirX = toX - fromX;
    const dirY = toY - fromY;
    if (dirX === 0 && dirY === 0) return;

    const minX = Math.max(0, Math.floor(fromX - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(fromX + radius));
    const minY = Math.max(0, Math.floor(fromY - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(fromY + radius));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dist = Math.hypot(x - fromX, y - fromY);
        if (dist <= radius) {
          // Smooth cosine falloff
          const falloff = 0.5 * (1 + Math.cos((dist / radius) * Math.PI)) * strength;
          const idx = (y * this.width + x) * 2;
          this.displacementField[idx] += dirX * falloff;
          this.displacementField[idx + 1] += dirY * falloff;
        }
      }
    }
  }

  // --- Region / Selection Shift ---
  applySelectionOffset(mask, dx, dy, rotation = 0, originX = 0, originY = 0) {
    if (!mask || (dx === 0 && dy === 0)) return;

    // 1. Mark source positions as empty/transparent (-9999) so the old pixels vanish
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const maskIdx = y * this.width + x;
        if (mask[maskIdx] > 0) {
          const idx = (y * this.width + x) * 2;
          this.displacementField[idx] = -9999;
          this.displacementField[idx + 1] = -9999;
        }
      }
    }

    // 2. Set target positions to sample from source (x, y)
    const newMask = new Uint8Array(this.width * this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const maskIdx = y * this.width + x;
        if (mask[maskIdx] > 0) {
          const targetX = x + dx;
          const targetY = y + dy;
          if (targetX >= 0 && targetX < this.width && targetY >= 0 && targetY < this.height) {
            const targetIdx = (targetY * this.width + targetX) * 2;
            this.displacementField[targetIdx] = dx;
            this.displacementField[targetIdx + 1] = dy;
            newMask[targetY * this.width + targetX] = 1;
          }
        }
      }
    }

    // 3. Update the mask buffer in-place
    mask.set(newMask);
  }

  // --- Pixel Pick & Place / Chain Move Helpers ---
  getPixelSourceAt(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    const idx = (y * this.width + x) * 2;
    const dx = this.displacementField[idx];
    const dy = this.displacementField[idx + 1];
    if (dx <= -9000 && dy <= -9000) return null; // marked empty / vacated
    return {
      srcX: Math.round(x - dx),
      srcY: Math.round(y - dy),
      dx,
      dy
    };
  }

  vacatePixel(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = (y * this.width + x) * 2;
    this.displacementField[idx] = -9999;
    this.displacementField[idx + 1] = -9999;
  }

  placePixel(targetX, targetY, origSourceX, origSourceY) {
    if (targetX < 0 || targetX >= this.width || targetY < 0 || targetY >= this.height) return;
    const idx = (targetY * this.width + targetX) * 2;
    this.displacementField[idx] = targetX - origSourceX;
    this.displacementField[idx + 1] = targetY - origSourceY;
  }

  // Whole Image Shift (Global Nudge)
  applyGlobalShift(dx, dy) {
    for (let i = 0; i < this.displacementField.length; i += 2) {
      this.displacementField[i] += dx;
      this.displacementField[i + 1] += dy;
    }
  }

  // Calculates combined displacement taking into account pins + direct displacement field
  getComputedDisplacement(w, h) {
    // If no pins, return displacement field directly
    if (this.pins.length === 0) {
      return this.displacementField;
    }

    const combined = new Float32Array(this.displacementField);

    // Puppet warp RBF / TPS calculation
    const pinDisplacements = this.pins.map(p => ({
      dx: p.currX - p.restX,
      dy: p.currY - p.restY,
      x: p.restX,
      y: p.restY,
      radius: p.radius || 12
    }));

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let totalWeight = 0;
        let pinDx = 0;
        let pinDy = 0;

        for (let i = 0; i < pinDisplacements.length; i++) {
          const p = pinDisplacements[i];
          const distSq = (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y);
          const sigma = p.radius;
          // Gaussian / inverse distance weighting with falloff
          const weight = Math.exp(-distSq / (2 * sigma * sigma));
          pinDx += p.dx * weight;
          pinDy += p.dy * weight;
          totalWeight += weight;
        }

        if (totalWeight > 0.001) {
          // Normalize influence
          const factor = Math.min(totalWeight, 1.0);
          const idx = (y * w + x) * 2;
          combined[idx] += (pinDx / Math.max(totalWeight, 1.0)) * factor;
          combined[idx + 1] += (pinDy / Math.max(totalWeight, 1.0)) * factor;
        }
      }
    }

    return combined;
  }

  toJSON(frameIndex) {
    return {
      frameIndex: frameIndex,
      name: this.name,
      duration: this.duration,
      pins: this.pins,
      // Store non-zero displacement offsets compactly or full array
      displacement: Array.from(this.displacementField),
      customPixels: Array.from(this.customPixels.entries())
    };
  }

  static fromJSON(data, width, height, defaultName) {
    const frame = new MotionFrame(width, height, data.name || defaultName);
    frame.duration = data.duration || 1.0;
    if (data.pins && Array.isArray(data.pins)) {
      frame.pins = data.pins.map(p => ({ ...p }));
    }
    if (data.displacement && Array.isArray(data.displacement)) {
      frame.displacementField = new Float32Array(data.displacement);
    }
    if (data.customPixels && Array.isArray(data.customPixels)) {
      frame.customPixels = new Map(data.customPixels);
    }
    return frame;
  }
}
