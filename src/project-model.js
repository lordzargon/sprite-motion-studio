// Sprite Pixel Motion Studio V2 - Project Data Model
// Implements Master Sprite, Layers Stack, Multi-Animation Clips,
// and Hierarchical Sprite Variants with Cascading Overrides.

export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Individual Layer in the Master Sprite or Variant
 */
export class Layer {
  constructor(id, name, width = 32, height = 32) {
    this.id = id || generateId('layer');
    this.name = name || 'Layer';
    this.width = width;
    this.height = height;
    this.visible = true;
    this.locked = false;
    this.isEditTarget = false;
    this.opacity = 1.0;

    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    } else {
      this.canvas = { width, height };
      this.ctx = {
        clearRect: () => {},
        drawImage: () => {},
        fillRect: () => {},
        getImageData: () => ({ data: [0, 0, 0, 0] })
      };
    }
  }

  clear() {
    if (this.ctx) this.ctx.clearRect(0, 0, this.width, this.height);
  }

  clone(newName = null, newId = null) {
    const copy = new Layer(newId || generateId('layer'), newName || `${this.name} Copy`, this.width, this.height);
    copy.visible = this.visible;
    copy.locked = this.locked;
    copy.isEditTarget = this.isEditTarget;
    copy.opacity = this.opacity;
    if (this.ctx && copy.ctx) {
      copy.ctx.drawImage(this.canvas, 0, 0);
    }
    return copy;
  }

  getPixel(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return [0, 0, 0, 0];
    const data = this.ctx.getImageData(x, y, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  }

  setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    if (a === 0) {
      this.ctx.clearRect(x, y, 1, 1);
    } else {
      this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
      this.ctx.fillRect(x, y, 1, 1);
    }
  }

  toDataURL() {
    return this.canvas.toDataURL('image/png');
  }

  async loadFromDataURL(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.clear();
        this.ctx.drawImage(img, 0, 0, this.width, this.height);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });
  }

  // Load from raw Image, Canvas, or ImageBitmap
  drawSource(imgOrCanvas) {
    this.clear();
    this.ctx.drawImage(imgOrCanvas, 0, 0, this.width, this.height);
  }
}

/**
 * Master Sprite containing ordered layers (lower index = bottom, higher index = top/over)
 */
export class MasterSprite {
  constructor(width = 32, height = 32) {
    this.width = width;
    this.height = height;
    this.layers = [];
  }

  addLayer(name = null, makeActive = true) {
    const layerName = name || `Layer ${this.layers.length + 1}`;
    const layer = new Layer(generateId('layer'), layerName, this.width, this.height);
    if (makeActive) {
      this.layers.forEach(l => l.isEditTarget = false);
      layer.isEditTarget = true;
    }
    this.layers.push(layer);
    return layer;
  }

  getLayer(id) {
    return this.layers.find(l => l.id === id);
  }

  getEditLayers() {
    const targets = this.layers.filter(l => l.isEditTarget && !l.locked);
    // If none marked, default to the top unlocked layer
    if (targets.length === 0) {
      const topUnlocked = [...this.layers].reverse().find(l => !l.locked);
      if (topUnlocked) {
        topUnlocked.isEditTarget = true;
        return [topUnlocked];
      }
      return this.layers.slice(-1);
    }
    return targets;
  }

  removeLayer(id) {
    if (this.layers.length <= 1) return false;
    const idx = this.layers.findIndex(l => l.id === id);
    if (idx !== -1) {
      const wasEdit = this.layers[idx].isEditTarget;
      this.layers.splice(idx, 1);
      if (wasEdit && this.layers.length > 0) {
        this.layers[this.layers.length - 1].isEditTarget = true;
      }
      return true;
    }
    return false;
  }

  moveLayer(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= this.layers.length) return;
    if (toIdx < 0 || toIdx >= this.layers.length) return;
    const [layer] = this.layers.splice(fromIdx, 1);
    this.layers.splice(toIdx, 0, layer);
  }

  // Composites visible layers into a single canvas context
  composite(targetCtx, targetWidth = null, targetHeight = null) {
    const tw = targetWidth || this.width;
    const th = targetHeight || this.height;
    targetCtx.imageSmoothingEnabled = false;
    targetCtx.clearRect(0, 0, tw, th);

    // Render lower layers first, upper layers over lower layers
    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      if (!layer.visible) continue;
      const prevAlpha = targetCtx.globalAlpha;
      targetCtx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1.0;
      targetCtx.drawImage(layer.canvas, 0, 0, tw, th);
      targetCtx.globalAlpha = prevAlpha;
    }
  }

  createCompositeCanvas() {
    const c = document.createElement('canvas');
    c.width = this.width;
    c.height = this.height;
    const ctx = c.getContext('2d');
    this.composite(ctx, this.width, this.height);
    return c;
  }
}

/**
 * Keyframe containing layer-masked displacements and custom pixel additions/removals
 */
export class AnimationFrame {
  constructor(width = 32, height = 32, name = 'Frame') {
    this.width = width;
    this.height = height;
    this.name = name;

    // Displacements per layer: { [layerId]: Float32Array(width * height * 2) }
    this.layerDisplacements = {};
    // Custom pixels per layer: { [layerId]: Map<"x,y", [r,g,b,a]> }
    this.layerCustomPixels = {};
    // Pins per layer: { [layerId]: Array<{ id, x, y, dx, dy, radius }> }
    this.layerPins = {};
  }

  getDisplacement(layerId) {
    if (!this.layerDisplacements[layerId]) {
      this.layerDisplacements[layerId] = new Float32Array(this.width * this.height * 2);
    }
    return this.layerDisplacements[layerId];
  }

  setDisplacement(layerId, arr) {
    this.layerDisplacements[layerId] = new Float32Array(arr);
  }

  getCustomPixels(layerId) {
    if (!this.layerCustomPixels[layerId]) {
      this.layerCustomPixels[layerId] = new Map();
    }
    return this.layerCustomPixels[layerId];
  }

  getPins(layerId) {
    if (!this.layerPins[layerId]) {
      this.layerPins[layerId] = [];
    }
    return this.layerPins[layerId];
  }

  clear(layerId = null) {
    if (layerId) {
      delete this.layerDisplacements[layerId];
      delete this.layerCustomPixels[layerId];
      delete this.layerPins[layerId];
    } else {
      this.layerDisplacements = {};
      this.layerCustomPixels = {};
      this.layerPins = {};
    }
  }

  clone(newName = null) {
    const copy = new AnimationFrame(this.width, this.height, newName || `${this.name} Copy`);
    for (const [lId, disp] of Object.entries(this.layerDisplacements)) {
      copy.layerDisplacements[lId] = new Float32Array(disp);
    }
    for (const [lId, pixMap] of Object.entries(this.layerCustomPixels)) {
      copy.layerCustomPixels[lId] = new Map(pixMap);
    }
    for (const [lId, pins] of Object.entries(this.layerPins)) {
      copy.layerPins[lId] = pins.map(p => ({ ...p }));
    }
    return copy;
  }
}

/**
 * Named Animation Clip ("Idle", "Run", "Walk", etc.)
 */
export class AnimationClip {
  constructor(id, name, width = 32, height = 32, fps = 8) {
    this.id = id || generateId('clip');
    this.name = name || 'Clip';
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.loop = true;
    this.frames = [];
  }

  addFrame(name = null, insertIndex = -1) {
    const frameName = name || `Frame ${this.frames.length + 1}`;
    const frame = new AnimationFrame(this.width, this.height, frameName);
    if (insertIndex >= 0 && insertIndex <= this.frames.length) {
      this.frames.splice(insertIndex, 0, frame);
    } else {
      this.frames.push(frame);
    }
    return frame;
  }

  duplicateFrame(index) {
    if (index < 0 || index >= this.frames.length) return null;
    const source = this.frames[index];
    const cloned = source.clone(`Frame ${this.frames.length + 1}`);
    this.frames.splice(index + 1, 0, cloned);
    return cloned;
  }

  deleteFrame(index) {
    if (this.frames.length <= 1) {
      this.frames[0].clear();
      return;
    }
    this.frames.splice(index, 1);
  }

  moveFrame(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= this.frames.length) return;
    if (toIdx < 0 || toIdx >= this.frames.length) return;
    const [f] = this.frames.splice(fromIdx, 1);
    this.frames.splice(toIdx, 0, f);
  }

  clone(newName = null, newId = null) {
    const copy = new AnimationClip(newId || generateId('clip'), newName || `${this.name} Copy`, this.width, this.height, this.fps);
    copy.loop = this.loop;
    copy.frames = this.frames.map(f => f.clone());
    return copy;
  }
}

/**
 * Sprite Variant with Cascading Animation & Layer Overrides
 */
export class SpriteVariant {
  constructor(id, name, parentId = null, width = 32, height = 32) {
    this.id = id || generateId('variant');
    this.name = name || 'Variant';
    this.parentId = parentId; // null => inherits directly from MasterSprite
    this.width = width;
    this.height = height;

    // Layer Overrides: { [layerId]: Layer }
    // Can override existing layer (same ID as master/parent) or add new layer (unique ID)
    this.layerOverrides = [];

    // Animation Overrides:
    // { [clipId]: { [frameIndex]: { [layerId]: { disp?: Float32Array, customPixels?: Map, pins?: Array } } } }
    this.animationOverrides = {};
  }

  /**
   * Resolves the effective layer stack for this variant,
   * walking parent hierarchy if needed.
   * @param {Project} project
   * @returns {Layer[]} Ordered layers from bottom to top
   */
  resolveLayers(project) {
    // 1. Get base layers from parent variant or master sprite
    let baseLayers = [];
    if (this.parentId) {
      const parent = project.getVariant(this.parentId);
      baseLayers = parent ? parent.resolveLayers(project) : project.masterSprite.layers;
    } else {
      baseLayers = project.masterSprite.layers;
    }

    // 2. Clone base layers as defaults
    const layerMap = new Map();
    const orderedIds = [];

    baseLayers.forEach(l => {
      layerMap.set(l.id, l);
      orderedIds.push(l.id);
    });

    // 3. Apply this variant's layer overrides / additions
    this.layerOverrides.forEach(ov => {
      if (!layerMap.has(ov.id)) {
        orderedIds.push(ov.id);
      }
      layerMap.set(ov.id, ov);
    });

    return orderedIds.map(id => layerMap.get(id)).filter(Boolean);
  }

  /**
   * Resolves the deformation / pixel edits for a given layer in a frame,
   * cascading from this variant up through parents to master animation.
   * @param {Project} project
   * @param {string} clipId
   * @param {number} frameIndex
   * @param {string} layerId
   */
  resolveLayerMotion(project, clipId, frameIndex, layerId) {
    // 1. Check if this variant has a local override for this clip, frame, and layer
    const localClip = this.animationOverrides[clipId];
    if (localClip && localClip[frameIndex] && localClip[frameIndex][layerId]) {
      return localClip[frameIndex][layerId];
    }

    // 2. Check parent variant if exists
    if (this.parentId) {
      const parent = project.getVariant(this.parentId);
      if (parent) {
        const parentMotion = parent.resolveLayerMotion(project, clipId, frameIndex, layerId);
        if (parentMotion) return parentMotion;
      }
    }

    // 3. Fallback to base clip frame in project
    const baseClip = project.getClip(clipId);
    if (baseClip && baseClip.frames[frameIndex]) {
      const frame = baseClip.frames[frameIndex];
      return {
        disp: frame.layerDisplacements[layerId] || null,
        customPixels: frame.layerCustomPixels[layerId] || null,
        pins: frame.layerPins[layerId] || null
      };
    }

    return null;
  }

  setLayerMotionOverride(clipId, frameIndex, layerId, data) {
    if (!this.animationOverrides[clipId]) {
      this.animationOverrides[clipId] = {};
    }
    if (!this.animationOverrides[clipId][frameIndex]) {
      this.animationOverrides[clipId][frameIndex] = {};
    }
    this.animationOverrides[clipId][frameIndex][layerId] = data;
  }

  clearLayerMotionOverride(clipId, frameIndex, layerId) {
    if (this.animationOverrides[clipId] && this.animationOverrides[clipId][frameIndex]) {
      delete this.animationOverrides[clipId][frameIndex][layerId];
    }
  }
}

/**
 * Full Project Container
 */
export class Project {
  constructor(name = 'New Project', width = 32, height = 32) {
    this.version = '2.0';
    this.name = name;
    this.width = width;
    this.height = height;

    this.masterSprite = new MasterSprite(width, height);
    this.animations = [];
    this.activeClipId = null;

    this.variants = [];
    this.activeVariantId = null; // null => Master Sprite is active

    // Initialize default master layer and default clip
    this.initDefaults();
  }

  initDefaults() {
    // Add default base layer
    const baseLayer = this.masterSprite.addLayer('Base Body', true);

    // Add default "Idle" clip with 4 frames
    const idleClip = new AnimationClip(generateId('clip'), 'Idle', this.width, this.height, 8);
    for (let i = 1; i <= 4; i++) {
      idleClip.addFrame(`Frame ${i}`);
    }
    this.animations.push(idleClip);
    this.activeClipId = idleClip.id;
  }

  getActiveClip() {
    const clip = this.animations.find(c => c.id === this.activeClipId);
    return clip || this.animations[0];
  }

  getClip(id) {
    return this.animations.find(c => c.id === id);
  }

  addClip(name = 'New Animation', fps = 8) {
    const clip = new AnimationClip(generateId('clip'), name, this.width, this.height, fps);
    clip.addFrame('Frame 1');
    clip.addFrame('Frame 2');
    clip.addFrame('Frame 3');
    clip.addFrame('Frame 4');
    this.animations.push(clip);
    this.activeClipId = clip.id;
    return clip;
  }

  duplicateClip(clipId) {
    const source = (clipId ? this.animations.find(c => c.id === clipId) : null) || this.getActiveClip();
    if (!source) return null;
    const copy = source.clone(`${source.name} (Copy)`);
    this.animations.push(copy);
    this.activeClipId = copy.id;

    // Clone variant animation overrides for this clip if any exist
    this.variants.forEach(variant => {
      if (variant.animationOverrides && variant.animationOverrides[source.id]) {
        variant.animationOverrides[copy.id] = {};
        for (const [fIdx, layerMap] of Object.entries(variant.animationOverrides[source.id])) {
          variant.animationOverrides[copy.id][fIdx] = {};
          for (const [lId, motion] of Object.entries(layerMap)) {
            variant.animationOverrides[copy.id][fIdx][lId] = {
              disp: motion.disp ? new Float32Array(motion.disp) : null,
              customPixels: motion.customPixels ? new Map(motion.customPixels) : null,
              pins: motion.pins ? motion.pins.map(p => ({ ...p })) : null
            };
          }
        }
      }
    });

    return copy;
  }

  deleteClip(id) {
    if (this.animations.length <= 1) return false;
    const idx = this.animations.findIndex(c => c.id === id);
    if (idx !== -1) {
      this.animations.splice(idx, 1);
      if (this.activeClipId === id) {
        this.activeClipId = this.animations[0].id;
      }
      this.variants.forEach(variant => {
        if (variant.animationOverrides && variant.animationOverrides[id]) {
          delete variant.animationOverrides[id];
        }
      });
      return true;
    }
    return false;
  }

  getVariant(id) {
    return this.variants.find(v => v.id === id);
  }

  getActiveVariant() {
    if (!this.activeVariantId) return null;
    return this.getVariant(this.activeVariantId);
  }

  addVariant(name, parentVariantId = null) {
    const variantName = name || `Variant ${this.variants.length + 1}`;
    const variant = new SpriteVariant(generateId('variant'), variantName, parentVariantId, this.width, this.height);

    // Duplicate layers from parent or master as initial override layers
    const sourceLayers = parentVariantId ? (this.getVariant(parentVariantId)?.resolveLayers(this) || this.masterSprite.layers) : this.masterSprite.layers;
    sourceLayers.forEach(l => {
      const copy = l.clone(l.name, l.id);
      variant.layerOverrides.push(copy);
    });

    this.variants.push(variant);
    this.activeVariantId = variant.id;
    return variant;
  }

  deleteVariant(id) {
    const idx = this.variants.findIndex(v => v.id === id);
    if (idx !== -1) {
      // Reparent children to parent of deleted variant
      const deleted = this.variants[idx];
      this.variants.forEach(v => {
        if (v.parentId === id) v.parentId = deleted.parentId;
      });
      this.variants.splice(idx, 1);
      if (this.activeVariantId === id) {
        this.activeVariantId = null;
      }
      return true;
    }
    return false;
  }

  /**
   * Serializes the entire project to a portable JSON object
   */
  async toJSON() {
    // 1. Export master layers
    const serializedMasterLayers = this.masterSprite.layers.map(l => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      isEditTarget: l.isEditTarget,
      opacity: l.opacity,
      pngData: l.toDataURL()
    }));

    // 2. Export animations
    const serializedAnimations = this.animations.map(clip => ({
      id: clip.id,
      name: clip.name,
      fps: clip.fps,
      loop: clip.loop,
      frames: clip.frames.map(f => {
        const displacements = {};
        for (const [lId, arr] of Object.entries(f.layerDisplacements)) {
          let hasVal = false;
          for (let k = 0; k < arr.length; k++) {
            if (arr[k] !== 0) { hasVal = true; break; }
          }
          if (hasVal) {
            displacements[lId] = Array.from(arr);
          }
        }

        const customPixels = {};
        for (const [lId, map] of Object.entries(f.layerCustomPixels)) {
          if (map.size > 0) {
            customPixels[lId] = Array.from(map.entries());
          }
        }

        const pins = {};
        for (const [lId, pList] of Object.entries(f.layerPins)) {
          if (pList.length > 0) {
            pins[lId] = pList;
          }
        }

        return {
          name: f.name,
          layerDisplacements: displacements,
          layerCustomPixels: customPixels,
          layerPins: pins
        };
      })
    }));

    // 3. Export variants
    const serializedVariants = this.variants.map(v => {
      const overrides = v.layerOverrides.map(l => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        locked: l.locked,
        isEditTarget: l.isEditTarget,
        opacity: l.opacity,
        pngData: l.toDataURL()
      }));

      // Serialize animation overrides
      const animOverrides = {};
      for (const [clipId, frameMap] of Object.entries(v.animationOverrides)) {
        animOverrides[clipId] = {};
        for (const [fIdx, layerMap] of Object.entries(frameMap)) {
          animOverrides[clipId][fIdx] = {};
          for (const [lId, motion] of Object.entries(layerMap)) {
            animOverrides[clipId][fIdx][lId] = {
              disp: motion.disp ? Array.from(motion.disp) : null,
              customPixels: motion.customPixels ? Array.from(motion.customPixels.entries()) : null,
              pins: motion.pins || null
            };
          }
        }
      }

      return {
        id: v.id,
        name: v.name,
        parentId: v.parentId,
        layerOverrides: overrides,
        animationOverrides: animOverrides
      };
    });

    return {
      version: this.version,
      name: this.name,
      width: this.width,
      height: this.height,
      activeClipId: this.activeClipId,
      activeVariantId: this.activeVariantId,
      masterLayers: serializedMasterLayers,
      animations: serializedAnimations,
      variants: serializedVariants
    };
  }

  /**
   * Restores a Project instance from a JSON object
   */
  static async fromJSON(data) {
    const width = data.width || 32;
    const height = data.height || 32;
    const project = new Project(data.name || 'Restored Project', width, height);
    project.version = data.version || '2.0';

    // Clear initial defaults
    project.masterSprite.layers = [];
    project.animations = [];
    project.variants = [];

    // 1. Restore master layers
    if (data.masterLayers && data.masterLayers.length > 0) {
      for (const lData of data.masterLayers) {
        const layer = new Layer(lData.id, lData.name, width, height);
        layer.visible = lData.visible !== undefined ? lData.visible : true;
        layer.locked = !!lData.locked;
        layer.isEditTarget = !!lData.isEditTarget;
        layer.opacity = lData.opacity !== undefined ? lData.opacity : 1.0;
        if (lData.pngData) {
          await layer.loadFromDataURL(lData.pngData);
        }
        project.masterSprite.layers.push(layer);
      }
    } else {
      project.masterSprite.addLayer('Base Body', true);
    }

    // 2. Restore animations
    if (data.animations && data.animations.length > 0) {
      for (const cData of data.animations) {
        const clip = new AnimationClip(cData.id, cData.name, width, height, cData.fps || 8);
        clip.loop = cData.loop !== undefined ? cData.loop : true;
        for (const fData of (cData.frames || [])) {
          const frame = new AnimationFrame(width, height, fData.name);
          if (fData.layerDisplacements) {
            for (const [lId, arr] of Object.entries(fData.layerDisplacements)) {
              frame.layerDisplacements[lId] = new Float32Array(arr);
            }
          }
          if (fData.layerCustomPixels) {
            for (const [lId, entries] of Object.entries(fData.layerCustomPixels)) {
              frame.layerCustomPixels[lId] = new Map(entries);
            }
          }
          if (fData.layerPins) {
            frame.layerPins = fData.layerPins;
          }
          clip.frames.push(frame);
        }
        project.animations.push(clip);
      }
    }

    project.activeClipId = data.activeClipId || (project.animations[0] ? project.animations[0].id : null);

    // 3. Restore variants
    if (data.variants && data.variants.length > 0) {
      for (const vData of data.variants) {
        const variant = new SpriteVariant(vData.id, vData.name, vData.parentId, width, height);
        for (const ovData of (vData.layerOverrides || [])) {
          const ovLayer = new Layer(ovData.id, ovData.name, width, height);
          ovLayer.visible = ovData.visible !== undefined ? ovData.visible : true;
          ovLayer.locked = !!ovData.locked;
          ovLayer.isEditTarget = !!ovData.isEditTarget;
          ovLayer.opacity = ovData.opacity !== undefined ? ovData.opacity : 1.0;
          if (ovData.pngData) {
            await ovLayer.loadFromDataURL(ovData.pngData);
          }
          variant.layerOverrides.push(ovLayer);
        }

        // Restore animation overrides
        if (vData.animationOverrides) {
          for (const [cId, fMap] of Object.entries(vData.animationOverrides)) {
            variant.animationOverrides[cId] = {};
            for (const [fIdx, lMap] of Object.entries(fMap)) {
              variant.animationOverrides[cId][fIdx] = {};
              for (const [lId, mData] of Object.entries(lMap)) {
                variant.animationOverrides[cId][fIdx][lId] = {
                  disp: mData.disp ? new Float32Array(mData.disp) : null,
                  customPixels: mData.customPixels ? new Map(mData.customPixels) : null,
                  pins: mData.pins || null
                };
              }
            }
          }
        }

        project.variants.push(variant);
      }
    }

    project.activeVariantId = data.activeVariantId || null;
    return project;
  }
}
