// High-Performance Interactive Pixel Canvas Viewport (Version 2)
// Supports Dual Mode:
//   1. 'design' mode: Paint Master/Variant sprite layers directly (Pencil, Eraser, Fill Bucket, Eyedropper).
//   2. 'animate' mode: Layer-masked deformations & per-frame custom pixels (Box, Lasso, Pins, Smear, Pick & Place).

export class CanvasViewport {
  constructor(canvasElement, motionEngine, options = {}) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.engine = motionEngine;
    this.onStateChange = options.onStateChange || (() => {});
    this.onHistoryPush = options.onHistoryPush || (() => {});
    this.onColorChange = options.onColorChange || (() => {});

    // Work Mode: 'design' (paint layers) vs 'animate' (frame deformations)
    this.workMode = 'animate';

    // Viewport Transform
    this.zoom = 16;
    this.panX = 0;
    this.panY = 0;
    this.minZoom = 1;
    this.maxZoom = 64;

    // Display Options
    this.showGrid = true;
    this.showOnionSkin = true;
    this.onionPrev = 1;
    this.onionNext = 1;
    this.onionOpacity = 0.35;

    // Active Tool
    // 'box_select', 'lasso_select', 'pin_warp', 'smear', 'nudge', 'pick_place', 'add_pixel', 'remove_pixel', 'color_dropper', 'paint_bucket'
    this.activeTool = 'box_select';
    this.brushRadius = 4;
    this.brushStrength = 1.0;
    this.pinRadius = 10;
    this.brushSize = 1;

    // Color Management
    this.currentColor = [0, 168, 232, 255];
    this.currentColorHex = '#00a8e8';

    // Tool Interaction State
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0, screenX: 0, screenY: 0 };
    this.dragCurrent = { x: 0, y: 0, screenX: 0, screenY: 0 };
    this.isPanning = false;

    // Selection State
    this.selectionMask = null;
    this.selectionBounds = null;
    this.isTransformingSelection = false;
    this.selectionOffset = { dx: 0, dy: 0 };
    this.initialSelectionMask = null;
    this.initialSelectionBounds = null;
    this.initialLayerDisp = null;
    this.initialLayerCustomPixels = null;
    this.initialLayerImageData = null;
    this.lassoPoints = [];

    // Pin State
    this.selectedPin = null;
    this.hoveredPin = null;

    // Pixel Pick & Place Tool State
    this.heldPixel = null; // { fromX, fromY, color: [r, g, b, a], layers: [{ layerId, color }] }
    this.hasDraggedPixel = false;

    // Hover Coord
    this.hoverPixel = { x: 0, y: 0, valid: false };

    this.setupEventListeners();
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  get project() {
    return this.engine.project;
  }

  get spriteWidth() {
    return this.project ? this.project.width : 32;
  }

  get spriteHeight() {
    return this.project ? this.project.height : 32;
  }

  getActiveEditLayers() {
    if (!this.project) return [];
    const activeVariant = this.project.getActiveVariant();
    const layers = activeVariant ? activeVariant.resolveLayers(this.project) : this.project.masterSprite.layers;
    const editLayers = layers.filter(l => l.isEditTarget && !l.locked);
    if (editLayers.length === 0) {
      const topUnlocked = [...layers].reverse().find(l => !l.locked);
      if (topUnlocked) {
        topUnlocked.isEditTarget = true;
        return [topUnlocked];
      }
      return layers.slice(-1);
    }
    return editLayers;
  }

  setColor(r, g, b, a = 255) {
    this.currentColor = [r, g, b, a];
    const hexR = r.toString(16).padStart(2, '0');
    const hexG = g.toString(16).padStart(2, '0');
    const hexB = b.toString(16).padStart(2, '0');
    this.currentColorHex = `#${hexR}${hexG}${hexB}`;
    this.onColorChange(this.currentColor, this.currentColorHex);
    this.render();
  }

  setColorHex(hex) {
    const clean = hex.replace('#', '');
    if (clean.length === 6) {
      const r = parseInt(clean.substring(0, 2), 16);
      const g = parseInt(clean.substring(2, 4), 16);
      const b = parseInt(clean.substring(4, 6), 16);
      this.currentColor = [r, g, b, 255];
      this.currentColorHex = `#${clean.toLowerCase()}`;
      this.onColorChange(this.currentColor, this.currentColorHex);
      this.render();
    }
  }

  getPixelInfoAt(x, y) {
    if (x < 0 || x >= this.spriteWidth || y < 0 || y >= this.spriteHeight) return null;
    const editLayers = this.getActiveEditLayers();
    // Search top-to-bottom (visual order) among active edit layers
    const reversed = [...editLayers].reverse();
    for (const layer of reversed) {
      if (!layer.visible) continue;
      const col = (this.workMode === 'design')
        ? layer.getPixel(x, y)
        : this.engine.getLayerPixel(layer, x, y);
      if (col && col[3] > 0) {
        return { color: col, layer };
      }
    }
    return null;
  }

  sampleColorAt(x, y) {
    if (x < 0 || x >= this.spriteWidth || y < 0 || y >= this.spriteHeight) return null;
    const editLayers = this.getActiveEditLayers();
    // Sample from active edit layers first, from top to bottom
    const reversed = [...editLayers].reverse();
    for (const l of reversed) {
      if (!l.visible) continue;
      const col = (this.workMode === 'design')
        ? l.getPixel(x, y)
        : this.engine.getLayerPixel(l, x, y);
      if (col && col[3] > 0) return col;
    }
    // Fallback: sample from active variant or master composite
    const activeChar = this.project?.getActiveVariant() || null;
    const temp = document.createElement('canvas');
    temp.width = this.spriteWidth;
    temp.height = this.spriteHeight;
    const tCtx = temp.getContext('2d');
    if (this.workMode === 'design') {
      if (activeChar) {
        const layers = activeChar.resolveLayers(this.project);
        layers.forEach(l => {
          if (l.visible) {
            tCtx.globalAlpha = l.opacity !== undefined ? l.opacity : 1.0;
            tCtx.drawImage(l.canvas, 0, 0);
          }
        });
      } else if (this.project) {
        this.project.masterSprite.composite(tCtx, this.spriteWidth, this.spriteHeight);
      }
    } else {
      this.engine.renderCharacterFrame(activeChar, this.engine.currentFrameIndex, tCtx, this.spriteWidth, this.spriteHeight);
    }
    const data = tCtx.getImageData(x, y, 1, 1).data;
    if (data[3] > 0) return [data[0], data[1], data[2], data[3]];
    return null;
  }

  // Bresenham's line algorithm
  plotLine(x0, y0, x1, y1, callback) {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    let sx = (x0 < x1) ? 1 : -1;
    let sy = (y0 < y1) ? 1 : -1;
    let err = dx - dy;

    let curX = x0;
    let curY = y0;

    while (true) {
      callback(curX, curY);
      if (curX === x1 && curY === y1) break;
      let e2 = 2 * err;
      if (e2 > -dy) { err -= dy; curX += sx; }
      if (e2 < dx) { err += dx; curY += sy; }
    }
  }

  applyBrushAt(px, py, isErase = false) {
    const editLayers = this.getActiveEditLayers();
    if (editLayers.length === 0) return;

    const half = Math.floor(this.brushSize / 2);
    for (let dy = -half; dy < this.brushSize - half; dy++) {
      for (let dx = -half; dx < this.brushSize - half; dx++) {
        const tx = px + dx;
        const ty = py + dy;
        if (tx >= 0 && tx < this.spriteWidth && ty >= 0 && ty < this.spriteHeight) {
          if (this.workMode === 'design') {
            // Paint directly on active layer's canvas
            for (const l of editLayers) {
              if (isErase) {
                l.setPixel(tx, ty, 0, 0, 0, 0);
              } else {
                l.setPixel(tx, ty, this.currentColor[0], this.currentColor[1], this.currentColor[2], this.currentColor[3]);
              }
            }
          } else {
            // Animate mode: per-frame custom pixels / removal
            for (const l of editLayers) {
              if (isErase) {
                this.engine.removeFramePixel(l.id, tx, ty);
              } else {
                this.engine.setFramePixel(l.id, tx, ty, this.currentColor[0], this.currentColor[1], this.currentColor[2], this.currentColor[3]);
              }
            }
          }
        }
      }
    }
  }

  floodFill(startXOrLayer, startYOrX, fillColorOrY, optionalFillColor) {
    let startX, startY, fillColor;
    if (typeof startXOrLayer === 'object' && startXOrLayer !== null && typeof startYOrX === 'number') {
      startX = startYOrX;
      startY = fillColorOrY;
      fillColor = optionalFillColor;
    } else {
      startX = startXOrLayer;
      startY = startYOrX;
      fillColor = fillColorOrY;
    }

    if (!fillColor) fillColor = this.currentColor;
    const fillRGBA = [
      fillColor[0] !== undefined ? fillColor[0] : 0,
      fillColor[1] !== undefined ? fillColor[1] : 0,
      fillColor[2] !== undefined ? fillColor[2] : 0,
      fillColor[3] !== undefined ? fillColor[3] : 255
    ];

    const editLayers = this.getActiveEditLayers();
    if (editLayers.length === 0) return false;
    const primaryEditLayer = editLayers[0];

    const W = this.spriteWidth;
    const H = this.spriteHeight;
    if (startX < 0 || startX >= W || startY < 0 || startY >= H) return false;

    const visibleEditLayers = editLayers.filter(l => l.visible);
    if (visibleEditLayers.length === 0) return false;
    const targetEditLayer = visibleEditLayers.find(l => l.id === primaryEditLayer.id) || visibleEditLayers[0];

    const colorMatches = (c1, c2, tolerance = 2) => {
      if (!c1 || !c2) return false;
      const a1 = c1[3] !== undefined ? c1[3] : 255;
      const a2 = c2[3] !== undefined ? c2[3] : 255;
      if (a1 === 0 && a2 === 0) return true;
      if (a1 === 0 || a2 === 0) return false;
      return Math.abs(c1[0] - c2[0]) <= tolerance &&
             Math.abs(c1[1] - c2[1]) <= tolerance &&
             Math.abs(c1[2] - c2[2]) <= tolerance &&
             Math.abs(a1 - a2) <= tolerance;
    };

    // Determine target color at startX, startY:
    // First inspect active edit layers (top to bottom)
    let targetColor = null;
    const reversed = [...visibleEditLayers].reverse();
    for (const l of reversed) {
      const col = (this.workMode === 'design')
        ? l.getPixel(startX, startY)
        : this.engine.getLayerPixel(l, startX, startY);
      if (col && col[3] > 0) {
        targetColor = [...col];
        break;
      }
    }

    // If none of the active edit layers have a non-transparent pixel here,
    // check if the clicked pixel corresponds to an unedited layer or empty canvas
    if (!targetColor) {
      const sampled = this.sampleColorAt(startX, startY);
      if (sampled && sampled[3] > 0) {
        targetColor = [...sampled];
      } else {
        targetColor = [0, 0, 0, 0];
      }
    }

    if (colorMatches(targetColor, fillRGBA)) {
      return false; // Already the same color
    }

    const isTransparentTarget = (targetColor[3] === 0);

    // Setup reading and writing per workMode
    let getPixelAt = null;
    let finalize = null;
    const toFill = []; // { layer, x, y }

    if (this.workMode === 'design') {
      const layerContexts = new Map();
      visibleEditLayers.forEach(l => {
        const img = l.ctx.getImageData(0, 0, W, H);
        layerContexts.set(l.id, {
          layer: l,
          img,
          data: img.data,
          modified: false
        });
      });

      getPixelAt = (layer, x, y) => {
        const lc = layerContexts.get(layer.id);
        if (!lc) return [0, 0, 0, 0];
        const idx = (y * W + x) * 4;
        return [lc.data[idx], lc.data[idx + 1], lc.data[idx + 2], lc.data[idx + 3]];
      };

      finalize = () => {
        for (const item of toFill) {
          const lc = layerContexts.get(item.layer.id);
          if (lc) {
            const idx = (item.y * W + item.x) * 4;
            lc.data[idx] = fillRGBA[0];
            lc.data[idx + 1] = fillRGBA[1];
            lc.data[idx + 2] = fillRGBA[2];
            lc.data[idx + 3] = fillRGBA[3];
            lc.modified = true;
          }
        }
        layerContexts.forEach(lc => {
          if (lc.modified) {
            lc.layer.ctx.putImageData(lc.img, 0, 0);
          }
        });
      };
    } else {
      // Animate mode
      getPixelAt = (layer, x, y) => {
        return this.engine.getLayerPixel(layer, x, y);
      };

      finalize = () => {
        for (const item of toFill) {
          if (fillRGBA[3] === 0) {
            this.engine.removeFramePixel(item.layer.id, item.x, item.y);
          } else {
            this.engine.setFramePixel(item.layer.id, item.x, item.y, fillRGBA[0], fillRGBA[1], fillRGBA[2], fillRGBA[3]);
          }
        }
      };
    }

    // Helper: does (x, y) match the targetColor across visible edit layers?
    const coordMatches = (x, y) => {
      if (isTransparentTarget) {
        for (const l of visibleEditLayers) {
          const col = getPixelAt(l, x, y);
          if (col && col[3] > 0) return false;
        }
        return true;
      } else {
        for (const l of visibleEditLayers) {
          const col = getPixelAt(l, x, y);
          if (colorMatches(col, targetColor)) {
            return true;
          }
        }
        return false;
      }
    };

    if (!coordMatches(startX, startY)) {
      return false;
    }

    const queue = [[startX, startY]];
    const visited = new Uint8Array(W * H);
    visited[startY * W + startX] = 1;

    while (queue.length > 0) {
      const [cx, cy] = queue.pop();

      // Collect layer fills at this coordinate
      if (isTransparentTarget) {
        toFill.push({ layer: targetEditLayer, x: cx, y: cy });
      } else {
        for (const l of visibleEditLayers) {
          const col = getPixelAt(l, cx, cy);
          if (colorMatches(col, targetColor)) {
            toFill.push({ layer: l, x: cx, y: cy });
          }
        }
      }

      // Check 4-connected neighbors
      const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
          const nIdx = ny * W + nx;
          if (!visited[nIdx]) {
            if (coordMatches(nx, ny)) {
              visited[nIdx] = 1;
              queue.push([nx, ny]);
            }
          }
        }
      }
    }

    if (toFill.length > 0) {
      finalize();
      return true;
    }
    return false;
  }

  // --- Coordinate Transforms ---
  screenToCanvas(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (screenX - rect.left - this.panX) / this.zoom;
    const y = (screenY - rect.top - this.panY) / this.zoom;
    return {
      x: Math.floor(x),
      y: Math.floor(y),
      exactX: x,
      exactY: y
    };
  }

  canvasToScreen(canvasX, canvasY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + this.panX + canvasX * this.zoom,
      y: rect.top + this.panY + canvasY * this.zoom
    };
  }

  centerView() {
    const rect = this.canvas.getBoundingClientRect();
    const targetZoom = Math.min(
      (rect.width * 0.75) / this.spriteWidth,
      (rect.height * 0.75) / this.spriteHeight
    );
    this.zoom = Math.max(2, Math.min(32, Math.floor(targetZoom)));
    this.panX = Math.round((rect.width - this.spriteWidth * this.zoom) / 2);
    this.panY = Math.round((rect.height - this.spriteHeight * this.zoom) / 2);
    this.render();
  }

  resizeCanvas() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.scale(dpr, dpr);
    if (!this.panX && !this.panY) {
      this.centerView();
    } else {
      this.render();
    }
  }

  // --- Main Render Loop ---
  render() {
    const rect = this.canvas.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    this.ctx.clearRect(0, 0, W, H);

    // Save transform state
    this.ctx.save();
    this.ctx.translate(this.panX, this.panY);
    this.ctx.scale(this.zoom, this.zoom);

    // 1. Checkerboard background
    this.renderCheckerboard();

    // 2. Onion skinning (in animate mode)
    if (this.showOnionSkin && this.workMode === 'animate' && !this.engine.isPlaying) {
      this.renderOnionSkin();
    }

    // 3. Composite Character Frame
    const activeChar = this.project?.getActiveVariant() || null;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.spriteWidth;
    tempCanvas.height = this.spriteHeight;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.imageSmoothingEnabled = false;

    if (this.workMode === 'design') {
      // Direct layer composite
      if (activeChar) {
        const layers = activeChar.resolveLayers(this.project);
        layers.forEach(l => {
          if (l.visible) {
            tempCtx.globalAlpha = l.opacity !== undefined ? l.opacity : 1.0;
            tempCtx.drawImage(l.canvas, 0, 0);
          }
        });
      } else if (this.project) {
        this.project.masterSprite.composite(tempCtx, this.spriteWidth, this.spriteHeight);
      }
    } else {
      // Deformed animation frame
      this.engine.renderCharacterFrame(activeChar, this.engine.currentFrameIndex, tempCtx, this.spriteWidth, this.spriteHeight);
    }

    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(tempCanvas, 0, 0);

    // 4. Pixel Grid
    if (this.showGrid && this.zoom >= 8) {
      this.renderPixelGrid();
    }

    // 5. Active Tool Overlays (Selection, Pins, Smear, Hover)
    this.renderToolOverlays();

    this.ctx.restore();

    // 6. Viewport HUD overlay (e.g. active layer / edit mode indicator)
    this.renderViewportHUD();
  }

  renderCheckerboard() {
    const sw = this.spriteWidth;
    const sh = this.spriteHeight;
    const size = 1;
    for (let y = 0; y < sh; y += size) {
      for (let x = 0; x < sw; x += size) {
        this.ctx.fillStyle = ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0) ? '#282828' : '#202020';
        this.ctx.fillRect(x, y, size, size);
      }
    }
    // Border around sprite boundary
    this.ctx.strokeStyle = '#3c3c3c';
    this.ctx.lineWidth = 1 / this.zoom;
    this.ctx.strokeRect(0, 0, sw, sh);
  }

  renderPixelGrid() {
    const sw = this.spriteWidth;
    const sh = this.spriteHeight;
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    this.ctx.lineWidth = 1 / this.zoom;

    this.ctx.beginPath();
    for (let x = 0; x <= sw; x++) {
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, sh);
    }
    for (let y = 0; y <= sh; y++) {
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(sw, y);
    }
    this.ctx.stroke();
  }

  renderOnionSkin() {
    const total = this.engine.frames.length;
    if (total <= 1) return;
    const cur = this.engine.currentFrameIndex;
    const activeChar = this.project?.getActiveVariant() || null;

    // Previous frame (Red ghost)
    const prevIdx = (cur - 1 + total) % total;
    const prevCanvas = document.createElement('canvas');
    prevCanvas.width = this.spriteWidth;
    prevCanvas.height = this.spriteHeight;
    const prevCtx = prevCanvas.getContext('2d');
    this.engine.renderCharacterFrame(activeChar, prevIdx, prevCtx, this.spriteWidth, this.spriteHeight, {
      tintColor: [239, 68, 68],
      alpha: this.onionOpacity
    });
    this.ctx.drawImage(prevCanvas, 0, 0);

    // Next frame (Blue ghost)
    const nextIdx = (cur + 1) % total;
    const nextCanvas = document.createElement('canvas');
    nextCanvas.width = this.spriteWidth;
    nextCanvas.height = this.spriteHeight;
    const nextCtx = nextCanvas.getContext('2d');
    this.engine.renderCharacterFrame(activeChar, nextIdx, nextCtx, this.spriteWidth, this.spriteHeight, {
      tintColor: [59, 130, 246],
      alpha: this.onionOpacity
    });
    this.ctx.drawImage(nextCanvas, 0, 0);
  }

  renderToolOverlays() {
    const editLayers = this.getActiveEditLayers();
    const primaryEditLayer = editLayers[0];

    // 1. Box Selection / Marquee
    if (this.selectionMask) {
      this.ctx.fillStyle = 'rgba(0, 168, 232, 0.2)';
      this.ctx.strokeStyle = '#00a8e8';
      this.ctx.lineWidth = 1 / this.zoom;

      for (let y = 0; y < this.spriteHeight; y++) {
        for (let x = 0; x < this.spriteWidth; x++) {
          if (this.selectionMask[y * this.spriteWidth + x] > 0) {
            this.ctx.fillRect(x, y, 1, 1);
          }
        }
      }

      if (this.selectionBounds) {
        const b = this.selectionBounds;
        this.ctx.setLineDash([2 / this.zoom, 2 / this.zoom]);
        this.ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX + 1, b.maxY - b.minY + 1);
        this.ctx.setLineDash([]);
      }
    }

    // 2. Dragging box selection marquee
    if (this.isDragging && this.activeTool === 'box_select' && !this.isTransformingSelection) {
      const minX = Math.min(this.dragStart.x, this.dragCurrent.x);
      const maxX = Math.max(this.dragStart.x, this.dragCurrent.x);
      const minY = Math.min(this.dragStart.y, this.dragCurrent.y);
      const maxY = Math.max(this.dragStart.y, this.dragCurrent.y);

      this.ctx.fillStyle = 'rgba(0, 168, 232, 0.15)';
      this.ctx.strokeStyle = '#00a8e8';
      this.ctx.lineWidth = 1 / this.zoom;
      this.ctx.fillRect(minX, minY, maxX - minX + 1, maxY - minY + 1);
      this.ctx.strokeRect(minX, minY, maxX - minX + 1, maxY - minY + 1);
    }

    // 3. Lasso Points
    if (this.isDragging && this.activeTool === 'lasso_select' && this.lassoPoints.length > 1) {
      this.ctx.strokeStyle = '#00a8e8';
      this.ctx.lineWidth = 1.5 / this.zoom;
      this.ctx.beginPath();
      this.ctx.moveTo(this.lassoPoints[0].x + 0.5, this.lassoPoints[0].y + 0.5);
      for (let i = 1; i < this.lassoPoints.length; i++) {
        this.ctx.lineTo(this.lassoPoints[i].x + 0.5, this.lassoPoints[i].y + 0.5);
      }
      this.ctx.stroke();
    }

    // 4. Puppet Pins
    if (this.activeTool === 'pin_warp' && primaryEditLayer) {
      const motionCtx = this.engine.getActiveMotionContext(primaryEditLayer.id);
      const pins = motionCtx.pins || [];

      pins.forEach(pin => {
        const isHovered = (this.hoveredPin && this.hoveredPin.id === pin.id);
        const isSelected = (this.selectedPin && this.selectedPin.id === pin.id);

        // Falloff circle
        this.ctx.strokeStyle = isSelected ? 'rgba(0, 168, 232, 0.6)' : 'rgba(255, 255, 255, 0.15)';
        this.ctx.lineWidth = 1 / this.zoom;
        this.ctx.beginPath();
        this.ctx.arc(pin.restX + 0.5, pin.restY + 0.5, pin.radius, 0, Math.PI * 2);
        this.ctx.stroke();

        // Pin Head
        this.ctx.fillStyle = isSelected ? '#00a8e8' : (isHovered ? '#1ab8f8' : '#e53e3e');
        this.ctx.beginPath();
        this.ctx.arc(pin.currX + 0.5, pin.currY + 0.5, 4 / this.zoom, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1 / this.zoom;
        this.ctx.stroke();
      });
    }

    // 5. Smear Brush Circle
    if (this.activeTool === 'smear' && this.hoverPixel.valid) {
      this.ctx.strokeStyle = 'rgba(0, 168, 232, 0.8)';
      this.ctx.lineWidth = 1.5 / this.zoom;
      this.ctx.beginPath();
      this.ctx.arc(this.hoverPixel.x + 0.5, this.hoverPixel.y + 0.5, this.brushRadius, 0, Math.PI * 2);
      this.ctx.stroke();
    }

    // 6. Held Pixels (Pick & Place)
    if (this.heldPixel && this.hoverPixel.valid) {
      const heldSize = this.heldPixel.size || 1;
      const half = this.heldPixel.half !== undefined ? this.heldPixel.half : Math.floor(heldSize / 2);
      const rx = this.hoverPixel.x - half;
      const ry = this.hoverPixel.y - half;

      // 1. Draw each held pixel with true color & crisp cell border
      const heldList = this.heldPixel.pixels || [{
        dx: 0,
        dy: 0,
        color: this.heldPixel.color || [0, 168, 232, 255]
      }];

      for (const p of heldList) {
        const px = this.hoverPixel.x + (p.dx || 0);
        const py = this.hoverPixel.y + (p.dy || 0);
        const col = p.color || [0, 168, 232, 255];
        const alpha = (col[3] !== undefined ? col[3] / 255 : 1) * 0.9;
        this.ctx.fillStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${alpha})`;
        this.ctx.fillRect(px, py, 1, 1);

        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        this.ctx.lineWidth = 0.5 / this.zoom;
        this.ctx.strokeRect(px, py, 1, 1);
      }

      // 2. Accurate square cursor bounding box for the held stamp
      // Outer dark contrasting border
      this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      this.ctx.lineWidth = 2.5 / this.zoom;
      this.ctx.strokeRect(rx, ry, heldSize, heldSize);

      // Inner crisp cyan outline
      this.ctx.strokeStyle = '#00e5ff';
      this.ctx.lineWidth = 1.2 / this.zoom;
      this.ctx.strokeRect(rx, ry, heldSize, heldSize);

      // Grid dividers if heldSize > 1
      if (heldSize > 1) {
        this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
        this.ctx.lineWidth = 0.5 / this.zoom;
        this.ctx.beginPath();
        for (let i = 1; i < heldSize; i++) {
          this.ctx.moveTo(rx + i, ry);
          this.ctx.lineTo(rx + i, ry + heldSize);
          this.ctx.moveTo(rx, ry + i);
          this.ctx.lineTo(rx + heldSize, ry + i);
        }
        this.ctx.stroke();
      }
    }

    // 7. Hover Cursor Reticle (When not holding pixels)
    if (this.hoverPixel.valid && this.activeTool !== 'smear' && !this.heldPixel) {
      if (this.activeTool === 'pick_place') {
        // Accurate Square Cursor Overlay for Pick & Place
        const bSize = Math.max(1, this.brushSize || 1);
        const half = Math.floor(bSize / 2);
        const rx = this.hoverPixel.x - half;
        const ry = this.hoverPixel.y - half;
        const editLayers = this.getActiveEditLayers();

        // Highlight candidate pixels in the footprint that will be moved
        for (let dy = 0; dy < bSize; dy++) {
          for (let dx = 0; dx < bSize; dx++) {
            const px = rx + dx;
            const py = ry + dy;
            if (px < 0 || px >= this.spriteWidth || py < 0 || py >= this.spriteHeight) continue;

            let hasPixel = false;
            for (const layer of editLayers) {
              if (!layer.visible) continue;
              const col = (this.workMode === 'design')
                ? layer.getPixel(px, py)
                : this.engine.getLayerPixel(layer, px, py);
              if (col && col[3] > 0) {
                hasPixel = true;
                break;
              }
            }

            if (hasPixel) {
              this.ctx.fillStyle = 'rgba(0, 168, 232, 0.35)';
              this.ctx.fillRect(px, py, 1, 1);
              this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.7)';
              this.ctx.lineWidth = 0.5 / this.zoom;
              this.ctx.strokeRect(px, py, 1, 1);
            }
          }
        }

        // Outer contrasting border
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        this.ctx.lineWidth = 2.5 / this.zoom;
        this.ctx.strokeRect(rx, ry, bSize, bSize);

        // Inner crisp cyan reticle
        this.ctx.strokeStyle = '#00e5ff';
        this.ctx.lineWidth = 1.2 / this.zoom;
        this.ctx.strokeRect(rx, ry, bSize, bSize);

        // Grid dividers inside the stamp for bSize > 1
        if (bSize > 1) {
          this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
          this.ctx.lineWidth = 0.5 / this.zoom;
          this.ctx.beginPath();
          for (let i = 1; i < bSize; i++) {
            this.ctx.moveTo(rx + i, ry);
            this.ctx.lineTo(rx + i, ry + bSize);
            this.ctx.moveTo(rx, ry + i);
            this.ctx.lineTo(rx + bSize, ry + i);
          }
          this.ctx.stroke();
        }

        // Center reticle pip for bSize >= 3
        if (bSize >= 3) {
          this.ctx.strokeStyle = '#ffffff';
          this.ctx.lineWidth = 1 / this.zoom;
          this.ctx.strokeRect(this.hoverPixel.x + 0.25, this.hoverPixel.y + 0.25, 0.5, 0.5);
        }
      } else {
        const isBrushTool = (this.activeTool === 'add_pixel' || this.activeTool === 'remove_pixel');
        const bSize = isBrushTool ? (this.brushSize || 1) : 1;
        const half = isBrushTool ? Math.floor(bSize / 2) : 0;
        const rx = this.hoverPixel.x - half;
        const ry = this.hoverPixel.y - half;

        if (this.activeTool === 'add_pixel') {
          const [r, g, b, a] = this.currentColor || [0, 168, 232, 255];
          const alpha = Math.min(0.4, (a !== undefined ? a / 255 : 1) * 0.4);
          this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          this.ctx.fillRect(rx, ry, bSize, bSize);
        } else if (this.activeTool === 'remove_pixel') {
          this.ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
          this.ctx.fillRect(rx, ry, bSize, bSize);
        } else if (this.activeTool === 'paint_bucket') {
          const [r, g, b, a] = this.currentColor || [0, 168, 232, 255];
          const alpha = Math.min(0.35, (a !== undefined ? a / 255 : 1) * 0.35);
          this.ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          this.ctx.fillRect(rx, ry, bSize, bSize);
        }

        // Outer contrasting border (so cursor remains visible on white/bright backgrounds)
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
        this.ctx.lineWidth = 2.5 / this.zoom;
        this.ctx.strokeRect(rx, ry, bSize, bSize);

        // Inner crisp white reticle (so cursor remains visible on dark backgrounds)
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        this.ctx.lineWidth = 1 / this.zoom;
        this.ctx.strokeRect(rx, ry, bSize, bSize);

        // If brush size > 1, draw subtle pixel grid dividers inside the stamp
        if (isBrushTool && bSize > 1) {
          this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
          this.ctx.lineWidth = 0.5 / this.zoom;
          this.ctx.beginPath();
          for (let i = 1; i < bSize; i++) {
            this.ctx.moveTo(rx + i, ry);
            this.ctx.lineTo(rx + i, ry + bSize);
            this.ctx.moveTo(rx, ry + i);
            this.ctx.lineTo(rx + bSize, ry + i);
          }
          this.ctx.stroke();
        }
      }
    }
  }

  renderViewportHUD() {
    const editLayers = this.getActiveEditLayers();
    const activeChar = this.project?.getActiveVariant();
    const charName = activeChar ? `Variant: ${activeChar.name}` : 'Master Sprite';
    const layerNames = editLayers.map(l => l.name).join(', ') || 'None';

    const info = `Mode: ${this.workMode === 'design' ? '🎨 Paint Layers' : '🎬 Animate Frames'} | Target: ${charName} | Edit Layer: ${layerNames}`;
    const hudEl = document.getElementById('tip-general');
    if (hudEl) {
      hudEl.textContent = info;
    }
  }

  pickUpPixel(sourceX, sourceY) {
    if (this.heldPixel) return false;
    if (sourceX < 0 || sourceX >= this.spriteWidth || sourceY < 0 || sourceY >= this.spriteHeight) return false;

    const editLayers = this.getActiveEditLayers();
    if (editLayers.length === 0) return false;

    const bSize = Math.max(1, this.brushSize || 1);
    const half = Math.floor(bSize / 2);

    // 1. Scan the square footprint to see if any pixels exist on visible edit layers
    let hasAnyPixel = false;
    for (let dy = -half; dy < bSize - half; dy++) {
      for (let dx = -half; dx < bSize - half; dx++) {
        const px = sourceX + dx;
        const py = sourceY + dy;
        if (px < 0 || px >= this.spriteWidth || py < 0 || py >= this.spriteHeight) continue;

        for (const layer of editLayers) {
          if (!layer.visible) continue;
          const col = (this.workMode === 'design')
            ? layer.getPixel(px, py)
            : this.engine.getLayerPixel(layer, px, py);
          if (col && col[3] > 0) {
            hasAnyPixel = true;
            break;
          }
        }
        if (hasAnyPixel) break;
      }
      if (hasAnyPixel) break;
    }

    if (!hasAnyPixel) return false;

    // 2. Extract and vacate pixels from all visible edit layers across footprint
    const pickedPixels = [];
    for (let dy = -half; dy < bSize - half; dy++) {
      for (let dx = -half; dx < bSize - half; dx++) {
        const px = sourceX + dx;
        const py = sourceY + dy;
        if (px < 0 || px >= this.spriteWidth || py < 0 || py >= this.spriteHeight) continue;

        const cellLayers = [];
        for (const layer of editLayers) {
          if (!layer.visible) continue;
          if (this.workMode === 'design') {
            const col = layer.getPixel(px, py);
            if (col && col[3] > 0) {
              cellLayers.push({
                layer,
                layerId: layer.id,
                color: [...col]
              });
              layer.setPixel(px, py, 0, 0, 0, 0); // Vacate in design mode
            }
          } else {
            const picked = this.engine.pickPixel(layer, px, py);
            if (picked) {
              cellLayers.push({
                layer,
                ...picked
              });
            }
          }
        }

        if (cellLayers.length > 0) {
          pickedPixels.push({
            dx,
            dy,
            layers: cellLayers,
            color: cellLayers[cellLayers.length - 1].color
          });
        }
      }
    }

    if (pickedPixels.length === 0) return false;

    this.heldPixel = {
      fromX: sourceX,
      fromY: sourceY,
      size: bSize,
      half,
      pixels: pickedPixels,
      color: pickedPixels[pickedPixels.length - 1].color,
      layers: pickedPixels.flatMap(p => p.layers)
    };

    this.hasDraggedPixel = false;
    this.updatePickStatus();
    this.render();
    return true;
  }

  placeHeldPixel(targetX, targetY) {
    if (!this.heldPixel) return false;
    if (targetX < 0 || targetX >= this.spriteWidth || targetY < 0 || targetY >= this.spriteHeight) return false;

    const editLayers = this.getActiveEditLayers();
    const primaryEditLayer = editLayers[0];
    const activeVariant = this.project?.getActiveVariant();
    const allLayers = activeVariant ? activeVariant.resolveLayers(this.project) : (this.project ? this.project.masterSprite.layers : []);

    const size = this.heldPixel.size || Math.max(1, this.brushSize || 1);
    const half = this.heldPixel.half !== undefined ? this.heldPixel.half : Math.floor(size / 2);

    // 1. Check target footprint for existing pixels on edit layers (for chain swap)
    const targetPicked = [];
    for (let dy = -half; dy < size - half; dy++) {
      for (let dx = -half; dx < size - half; dx++) {
        const tx = targetX + dx;
        const ty = targetY + dy;
        if (tx < 0 || tx >= this.spriteWidth || ty < 0 || ty >= this.spriteHeight) continue;

        const cellLayers = [];
        for (const layer of editLayers) {
          if (!layer.visible) continue;
          if (this.workMode === 'design') {
            const col = layer.getPixel(tx, ty);
            if (col && col[3] > 0) {
              cellLayers.push({
                layer,
                layerId: layer.id,
                color: [...col]
              });
              layer.setPixel(tx, ty, 0, 0, 0, 0); // Vacate target position
            }
          } else {
            const picked = this.engine.pickPixel(layer, tx, ty);
            if (picked) {
              cellLayers.push({
                layer,
                ...picked
              });
            }
          }
        }

        if (cellLayers.length > 0) {
          targetPicked.push({
            dx,
            dy,
            layers: cellLayers,
            color: cellLayers[cellLayers.length - 1].color
          });
        }
      }
    }

    // 2. Place held pixel(s) into target position
    const heldList = this.heldPixel.pixels || [{
      dx: 0,
      dy: 0,
      layers: this.heldPixel.layers || (this.heldPixel.layerId ? [{ layerId: this.heldPixel.layerId, color: this.heldPixel.color }] : [])
    }];

    for (const p of heldList) {
      const tx = targetX + (p.dx || 0);
      const ty = targetY + (p.dy || 0);
      if (tx < 0 || tx >= this.spriteWidth || ty < 0 || ty >= this.spriteHeight) continue;

      for (const item of p.layers) {
        const layer = allLayers.find(l => l.id === item.layerId) || primaryEditLayer;
        if (layer) {
          if (this.workMode === 'design') {
            layer.setPixel(tx, ty, item.color[0], item.color[1], item.color[2], item.color[3]);
          } else {
            this.engine.placePixel(layer, tx, ty, item);
          }
        }
      }
    }

    // 3. Chain swap: if target had pixels, hold them; otherwise clear
    if (targetPicked.length > 0) {
      this.heldPixel = {
        fromX: targetX,
        fromY: targetY,
        size,
        half,
        pixels: targetPicked,
        color: targetPicked[targetPicked.length - 1].color,
        layers: targetPicked.flatMap(p => p.layers)
      };
    } else {
      this.heldPixel = null;
    }

    this.hasDraggedPixel = false;
    this.updatePickStatus();
    this.onHistoryPush();
    this.onStateChange();
    this.render();
    return true;
  }

  cancelHeldPixel() {
    if (!this.heldPixel) return;
    const activeVariant = this.project?.getActiveVariant();
    const allLayers = activeVariant ? activeVariant.resolveLayers(this.project) : (this.project ? this.project.masterSprite.layers : []);

    const heldList = this.heldPixel.pixels || [{
      dx: 0,
      dy: 0,
      layers: this.heldPixel.layers || (this.heldPixel.layerId ? [{ layerId: this.heldPixel.layerId, color: this.heldPixel.color }] : [])
    }];

    for (const p of heldList) {
      const sx = this.heldPixel.fromX + (p.dx || 0);
      const sy = this.heldPixel.fromY + (p.dy || 0);
      if (sx < 0 || sx >= this.spriteWidth || sy < 0 || sy >= this.spriteHeight) continue;

      for (const item of p.layers) {
        const layer = allLayers.find(l => l.id === item.layerId);
        if (layer) {
          if (this.workMode === 'design') {
            layer.setPixel(sx, sy, item.color[0], item.color[1], item.color[2], item.color[3]);
          } else {
            this.engine.placePixel(layer, sx, sy, item);
          }
        }
      }
    }

    this.heldPixel = null;
    this.hasDraggedPixel = false;
    this.updatePickStatus();
    this.render();
  }

  updatePickStatus() {
    const dot = document.getElementById('pick-status-dot');
    const label = document.getElementById('val-pick-status');
    if (!dot || !label) return;

    if (this.heldPixel) {
      const size = this.heldPixel.size || 1;
      const count = this.heldPixel.pixels ? this.heldPixel.pixels.length : 1;
      dot.className = 'w-2 h-2 rounded-full ring-1 ring-white/50';
      dot.style.backgroundColor = `rgb(${this.heldPixel.color[0]}, ${this.heldPixel.color[1]}, ${this.heldPixel.color[2]})`;
      label.textContent = `Held ${size}x${size} (${count} px) at (${this.heldPixel.fromX}, ${this.heldPixel.fromY}) — Click to place / Esc to cancel`;
    } else {
      const size = Math.max(1, this.brushSize || 1);
      dot.className = 'w-2 h-2 rounded-full bg-slate-500';
      dot.style.backgroundColor = '';
      label.textContent = `Click to pick up (${size}x${size})`;
    }
  }

  // --- Event Handling ---
  setupEventListeners() {
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    window.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverPixel = { x: 0, y: 0, valid: false };
      this.render();
    });
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Cancel held pixel or selection on right click
      if (this.heldPixel) {
        this.cancelHeldPixel();
      } else if (this.selectionMask) {
        this.selectionMask = null;
        this.selectionBounds = null;
        this.render();
      }
    });
  }

  handleMouseDown(e) {
    if (e.button === 1 || e.altKey) {
      this.isPanning = true;
      this.dragStart = { screenX: e.clientX, screenY: e.clientY };
      return;
    }

    if (e.button !== 0) return;

    const pt = this.screenToCanvas(e.clientX, e.clientY);
    this.isDragging = true;
    this.dragStart = { x: pt.x, y: pt.y, screenX: e.clientX, screenY: e.clientY };
    this.dragCurrent = { ...this.dragStart };

    const editLayers = this.getActiveEditLayers();
    const primaryEditLayer = editLayers[0];

    // Color Dropper
    if (this.activeTool === 'color_dropper') {
      this.isDragging = false;
      const col = this.sampleColorAt(pt.x, pt.y);
      if (col) {
        this.setColor(col[0], col[1], col[2], col[3]);
      }
      return;
    }

    // Paint Bucket (Flood Fill)
    if (this.activeTool === 'paint_bucket' && primaryEditLayer) {
      this.isDragging = false;
      const changed = this.floodFill(pt.x, pt.y, this.currentColor);
      if (changed) {
        this.onHistoryPush();
        this.onStateChange();
        this.render();
      }
      return;
    }

    // Drawing Tools: Pencil & Eraser
    if (this.activeTool === 'add_pixel' || this.activeTool === 'remove_pixel') {
      this.lastPlotPoint = { x: pt.x, y: pt.y };
      this.applyBrushAt(pt.x, pt.y, this.activeTool === 'remove_pixel');
      this.render();
      return;
    }

    // Puppet Pin Placement or Selection
    if (this.activeTool === 'pin_warp' && primaryEditLayer) {
      const motionCtx = this.engine.getActiveMotionContext(primaryEditLayer.id);
      const pins = motionCtx.pins || [];

      // Check if clicked near an existing pin
      const hit = pins.find(p => Math.hypot(pt.exactX - (p.currX + 0.5), pt.exactY - (p.currY + 0.5)) <= Math.max(1.5, 6 / this.zoom));
      if (hit) {
        this.selectedPin = hit;
      } else {
        const newPin = this.engine.addPin(primaryEditLayer.id, pt.x, pt.y, this.pinRadius);
        this.selectedPin = newPin;
        this.onHistoryPush();
      }
      this.render();
      return;
    }

    // Pick & Place
    if (this.activeTool === 'pick_place') {
      if (editLayers.length === 0) return;
      if (!this.heldPixel) {
        this.pickUpPixel(pt.x, pt.y);
      } else {
        this.placeHeldPixel(pt.x, pt.y);
      }
      return;
    }

    // Selection Drag or Create
    if (this.activeTool === 'box_select' || this.activeTool === 'lasso_select') {
      const isInsideSelection = this.selectionMask && (
        this.selectionMask[pt.y * this.spriteWidth + pt.x] > 0 ||
        (this.activeTool === 'box_select' && this.selectionBounds &&
         pt.x >= this.selectionBounds.minX && pt.x <= this.selectionBounds.maxX &&
         pt.y >= this.selectionBounds.minY && pt.y <= this.selectionBounds.maxY)
      );

      if (isInsideSelection) {
        this.isTransformingSelection = true;
        this.selectionOffset = { dx: 0, dy: 0 };
        this.initialSelectionMask = new Uint8Array(this.selectionMask);
        this.initialSelectionBounds = this.selectionBounds ? { ...this.selectionBounds } : null;

        if (this.workMode === 'design') {
          this.initialLayerImageData = new Map();
          editLayers.forEach(l => {
            this.initialLayerImageData.set(l.id, l.ctx.getImageData(0, 0, this.spriteWidth, this.spriteHeight));
          });
        } else {
          this.initialLayerDisp = new Map();
          this.initialLayerCustomPixels = new Map();
          editLayers.forEach(l => {
            const motionCtx = this.engine.getActiveMotionContext(l.id);
            this.initialLayerDisp.set(l.id, new Float32Array(motionCtx.disp));
            this.initialLayerCustomPixels.set(l.id, new Map(motionCtx.customPixels));
          });
        }
        return;
      } else {
        this.selectionMask = null;
        this.selectionBounds = null;
        this.isTransformingSelection = false;
        this.initialSelectionMask = null;
        this.initialSelectionBounds = null;
        this.initialLayerDisp = null;
        this.initialLayerCustomPixels = null;
        this.initialLayerImageData = null;
        if (this.activeTool === 'lasso_select') {
          this.lassoPoints = [{ x: pt.x, y: pt.y }];
        }
      }
    }
  }

  handleMouseMove(e) {
    const pt = this.screenToCanvas(e.clientX, e.clientY);
    const isSizedTool = (this.activeTool === 'add_pixel' || this.activeTool === 'remove_pixel' || this.activeTool === 'pick_place');
    const bSize = this.heldPixel ? (this.heldPixel.size || 1) : (isSizedTool ? Math.max(1, this.brushSize || 1) : 1);
    const half = this.heldPixel ? (this.heldPixel.half !== undefined ? this.heldPixel.half : Math.floor(bSize / 2)) : (isSizedTool ? Math.floor(bSize / 2) : 0);
    const minX = pt.x - half;
    const maxX = minX + bSize;
    const minY = pt.y - half;
    const maxY = minY + bSize;
    const overlapsSprite = (maxX > 0 && minX < this.spriteWidth && maxY > 0 && minY < this.spriteHeight);

    const rect = this.canvas.getBoundingClientRect();
    const isOverCanvas = (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom);

    this.hoverPixel = {
      x: pt.x,
      y: pt.y,
      valid: isOverCanvas && overlapsSprite
    };

    if (this.isPanning) {
      this.panX += e.clientX - this.dragStart.screenX;
      this.panY += e.clientY - this.dragStart.screenY;
      this.dragStart.screenX = e.clientX;
      this.dragStart.screenY = e.clientY;
      this.render();
      return;
    }

    // Dynamic cursor styling for selection tools
    if ((this.activeTool === 'box_select' || this.activeTool === 'lasso_select') && !this.isPanning) {
      if (this.isTransformingSelection) {
        this.canvas.style.cursor = 'grabbing';
      } else {
        const isOverSelection = this.selectionMask && (
          this.selectionMask[pt.y * this.spriteWidth + pt.x] > 0 ||
          (this.activeTool === 'box_select' && this.selectionBounds &&
           pt.x >= this.selectionBounds.minX && pt.x <= this.selectionBounds.maxX &&
           pt.y >= this.selectionBounds.minY && pt.y <= this.selectionBounds.maxY)
        );
        this.canvas.style.cursor = isOverSelection ? 'grab' : 'crosshair';
      }
    }

    if (!this.isDragging) {
      this.render();
      return;
    }

    const editLayers = this.getActiveEditLayers();
    const primaryEditLayer = editLayers[0];

    // Drawing drag
    if ((this.activeTool === 'add_pixel' || this.activeTool === 'remove_pixel') && this.lastPlotPoint) {
      this.plotLine(this.lastPlotPoint.x, this.lastPlotPoint.y, pt.x, pt.y, (lx, ly) => {
        this.applyBrushAt(lx, ly, this.activeTool === 'remove_pixel');
      });
      this.lastPlotPoint = { x: pt.x, y: pt.y };
      this.render();
      return;
    }

    // Smear drag
    if (this.activeTool === 'smear' && primaryEditLayer) {
      if (this.workMode === 'animate') {
        this.engine.applySmear(primaryEditLayer.id, this.dragCurrent.x, this.dragCurrent.y, pt.x, pt.y, this.brushRadius, this.brushStrength);
      }
      this.dragCurrent = { x: pt.x, y: pt.y };
      this.render();
      return;
    }

    // Pin Move
    if (this.activeTool === 'pin_warp' && this.selectedPin && primaryEditLayer) {
      this.engine.movePin(primaryEditLayer.id, this.selectedPin.id, pt.x, pt.y);
      this.render();
      return;
    }

    // Selection Transforming (Box Select & Lasso Select)
    if ((this.activeTool === 'box_select' || this.activeTool === 'lasso_select') && this.isTransformingSelection && primaryEditLayer) {
      const totalDx = pt.x - this.dragStart.x;
      const totalDy = pt.y - this.dragStart.y;
      if (totalDx !== this.selectionOffset.dx || totalDy !== this.selectionOffset.dy) {
        this.selectionOffset = { dx: totalDx, dy: totalDy };

        const W = this.spriteWidth;
        const H = this.spriteHeight;

        // 1. Update selection mask
        if (this.initialSelectionMask) {
          const newMask = new Uint8Array(W * H);
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              if (this.initialSelectionMask[y * W + x] > 0) {
                const tx = x + totalDx;
                const ty = y + totalDy;
                if (tx >= 0 && tx < W && ty >= 0 && ty < H) {
                  newMask[ty * W + tx] = 1;
                }
              }
            }
          }
          this.selectionMask = newMask;
        }

        // 2. Update selection bounds (moves marquee with cursor)
        if (this.initialSelectionBounds) {
          this.selectionBounds = {
            minX: this.initialSelectionBounds.minX + totalDx,
            minY: this.initialSelectionBounds.minY + totalDy,
            maxX: this.initialSelectionBounds.maxX + totalDx,
            maxY: this.initialSelectionBounds.maxY + totalDy
          };
        }

        // 3. Apply transformation strictly to edit layers
        if (this.workMode === 'design') {
          editLayers.forEach(l => {
            const initImgData = this.initialLayerImageData?.get(l.id);
            if (initImgData) {
              this.transformDesignLayerSelection(l, this.initialSelectionMask, initImgData, totalDx, totalDy);
            }
          });
        } else {
          editLayers.forEach(l => {
            const initDisp = this.initialLayerDisp?.get(l.id);
            const initCustom = this.initialLayerCustomPixels?.get(l.id);
            if (initDisp) {
              this.engine.transformLayerSelection(l.id, this.initialSelectionMask, initDisp, initCustom, totalDx, totalDy);
            }
          });
        }

        this.render();
      }
      return;
    }

    // Lasso Drag
    if (this.activeTool === 'lasso_select' && !this.isTransformingSelection) {
      this.lassoPoints.push({ x: pt.x, y: pt.y });
      this.render();
      return;
    }

    if (this.isDragging && this.activeTool === 'pick_place' && this.heldPixel) {
      if (pt.x !== this.dragStart.x || pt.y !== this.dragStart.y) {
        this.hasDraggedPixel = true;
      }
    }

    this.dragCurrent = { x: pt.x, y: pt.y };
    this.render();
  }

  handleMouseUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      return;
    }

    if (!this.isDragging) return;
    this.isDragging = false;
    this.lastPlotPoint = null;

    // Drag-and-drop placement for Pick & Place
    if (this.activeTool === 'pick_place' && this.heldPixel && this.hasDraggedPixel) {
      const pt = this.screenToCanvas(e.clientX, e.clientY);
      this.placeHeldPixel(pt.x, pt.y);
      return;
    }

    const editLayers = this.getActiveEditLayers();

    // Finish Box Select creation (masked by active edit layers!)
    if (this.activeTool === 'box_select' && !this.isTransformingSelection) {
      const minX = Math.max(0, Math.min(this.dragStart.x, this.dragCurrent.x));
      const maxX = Math.min(this.spriteWidth - 1, Math.max(this.dragStart.x, this.dragCurrent.x));
      const minY = Math.max(0, Math.min(this.dragStart.y, this.dragCurrent.y));
      const maxY = Math.min(this.spriteHeight - 1, Math.max(this.dragStart.y, this.dragCurrent.y));

      if (maxX >= minX && maxY >= minY) {
        this.selectionMask = new Uint8Array(this.spriteWidth * this.spriteHeight);
        let selectedCount = 0;

        for (let y = minY; y <= maxY; y++) {
          for (let x = minX; x <= maxX; x++) {
            // Mask by pixels belonging to edit layer(s)
            let hasPixelOnEditLayer = false;
            for (const l of editLayers) {
              const col = (this.workMode === 'design') ? l.getPixel(x, y) : this.engine.getLayerPixel(l, x, y);
              if (col[3] > 0) { hasPixelOnEditLayer = true; break; }
            }
            if (hasPixelOnEditLayer) {
              this.selectionMask[y * this.spriteWidth + x] = 1;
              selectedCount++;
            }
          }
        }

        if (selectedCount > 0) {
          this.selectionBounds = { minX, minY, maxX, maxY };
        } else {
          this.selectionMask = null;
          this.selectionBounds = null;
        }
      }
    }

    // Finish Lasso Select
    if (this.activeTool === 'lasso_select' && this.lassoPoints.length > 2) {
      this.buildLassoMask();
    }

    if (this.isTransformingSelection) {
      this.isTransformingSelection = false;
      const moved = (this.selectionOffset.dx !== 0 || this.selectionOffset.dy !== 0);
      this.initialSelectionMask = null;
      this.initialSelectionBounds = null;
      this.initialLayerDisp = null;
      this.initialLayerCustomPixels = null;
      this.initialLayerImageData = null;

      if (moved) {
        this.onHistoryPush();
        this.onStateChange();
      }
    } else if (this.activeTool === 'add_pixel' || this.activeTool === 'remove_pixel' || this.activeTool === 'smear' || this.activeTool === 'pin_warp') {
      this.onHistoryPush();
      this.onStateChange();
    }

    this.render();
  }

  transformDesignLayerSelection(layer, initialMask, initialImageData, totalDx, totalDy) {
    const W = layer.width;
    const H = layer.height;

    // 1. Reset canvas to clean initial snapshot
    layer.ctx.putImageData(initialImageData, 0, 0);

    if (totalDx === 0 && totalDy === 0) return;

    // 2. Clear initial positions that won't be filled by another selected pixel
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (initialMask[y * W + x] > 0) {
          const prevX = x - totalDx;
          const prevY = y - totalDy;
          const landsHere = (prevX >= 0 && prevX < W && prevY >= 0 && prevY < H && initialMask[prevY * W + prevX] > 0);
          if (!landsHere) {
            layer.ctx.clearRect(x, y, 1, 1);
          }
        }
      }
    }

    // 3. Draw moved pixels at (tx, ty)
    const srcData = initialImageData.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (initialMask[y * W + x] > 0) {
          const tx = x + totalDx;
          const ty = y + totalDy;
          if (tx >= 0 && tx < W && ty >= 0 && ty < H) {
            const sIdx = (y * W + x) * 4;
            const a = srcData[sIdx + 3];
            if (a > 0) {
              layer.setPixel(tx, ty, srcData[sIdx], srcData[sIdx + 1], srcData[sIdx + 2], a);
            } else {
              layer.ctx.clearRect(tx, ty, 1, 1);
            }
          }
        }
      }
    }
  }

  buildLassoMask() {
    const editLayers = this.getActiveEditLayers();
    const W = this.spriteWidth;
    const H = this.spriteHeight;
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = W;
    maskCanvas.height = H;
    const mCtx = maskCanvas.getContext('2d');
    mCtx.fillStyle = '#ffffff';

    mCtx.beginPath();
    mCtx.moveTo(this.lassoPoints[0].x + 0.5, this.lassoPoints[0].y + 0.5);
    for (let i = 1; i < this.lassoPoints.length; i++) {
      mCtx.lineTo(this.lassoPoints[i].x + 0.5, this.lassoPoints[i].y + 0.5);
    }
    mCtx.closePath();
    mCtx.fill();

    const imgData = mCtx.getImageData(0, 0, W, H);
    this.selectionMask = new Uint8Array(W * H);
    let count = 0;
    let minX = W, minY = H, maxX = 0, maxY = 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        if (imgData.data[idx * 4 + 3] > 128) {
          let hasLayerPixel = false;
          for (const l of editLayers) {
            const col = (this.workMode === 'design') ? l.getPixel(x, y) : this.engine.getLayerPixel(l, x, y);
            if (col[3] > 0) { hasLayerPixel = true; break; }
          }
          if (hasLayerPixel) {
            this.selectionMask[idx] = 1;
            count++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    }

    if (count > 0) {
      this.selectionBounds = { minX, minY, maxX, maxY };
    } else {
      this.selectionMask = null;
      this.selectionBounds = null;
    }
    this.lassoPoints = [];
  }

  handleWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mouseScreenX = e.clientX - rect.left;
    const mouseScreenY = e.clientY - rect.top;

    const prevZoom = this.zoom;
    const zoomFactor = e.deltaY < 0 ? 1.2 : 0.833;
    let newZoom = Math.round(prevZoom * zoomFactor);
    newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));

    if (newZoom !== prevZoom) {
      this.panX = mouseScreenX - (mouseScreenX - this.panX) * (newZoom / prevZoom);
      this.panY = mouseScreenY - (mouseScreenY - this.panY) * (newZoom / prevZoom);
      this.zoom = newZoom;
      this.render();
    }
  }
}
