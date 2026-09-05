// High-Performance Interactive Pixel Canvas Viewport
// Manages rendering, zoom, pan, grid, onion skinning, tool interactions, handles, and gizmos.

export class CanvasViewport {
  constructor(canvasElement, motionEngine, options = {}) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.engine = motionEngine;
    this.onStateChange = options.onStateChange || (() => {});
    this.onHistoryPush = options.onHistoryPush || (() => {});
    this.onColorChange = options.onColorChange || (() => {});

    // Source Base Sprite
    this.baseImage = null; // HTMLImageElement or HTMLCanvasElement
    this.spriteWidth = 32;
    this.spriteHeight = 32;

    // Viewport Transform
    this.zoom = 16; // default 16x zoom for crisp pixel art
    this.panX = 0;
    this.panY = 0;
    this.minZoom = 1;
    this.maxZoom = 64;

    // Display Options
    this.showGrid = true;
    this.showOnionSkin = true;
    this.onionPrev = 1;
    this.onionNext = 1;
    this.onionOpacity = 0.4;
    this.showDisplacementVectors = false;

    // Active Tool
    // 'box_select', 'lasso_select', 'pin_warp', 'smear', 'nudge', 'pick_place', 'add_pixel', 'remove_pixel', 'color_dropper', 'pan'
    this.activeTool = 'box_select';
    this.brushRadius = 4;
    this.brushStrength = 1.0;
    this.pinRadius = 10;
    this.brushSize = 1; // for add/remove pixel tools (1, 2, 3...)

    // Color Management
    this.currentColor = [99, 102, 241, 255]; // RGBA
    this.currentColorHex = '#6366f1';

    // Tool Interaction State
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0, screenX: 0, screenY: 0 };
    this.dragCurrent = { x: 0, y: 0, screenX: 0, screenY: 0 };
    this.isPanning = false;

    // Selection State
    this.selectionMask = null; // Uint8Array(w * h)
    this.selectionBounds = null; // { minX, minY, maxX, maxY }
    this.isTransformingSelection = false;
    this.selectionOffset = { dx: 0, dy: 0, rotation: 0 };
    this.lassoPoints = [];

    // Pin State
    this.selectedPin = null;
    this.hoveredPin = null;

    // Pixel Pick & Place Tool State
    this.heldPixel = null; // { origSourceX, origSourceY, fromX, fromY, color: [r, g, b, a] }
    this.baseImageData = null;

    // Hover Coord
    this.hoverPixel = { x: 0, y: 0, valid: false };

    this.setupEventListeners();
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
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

  sampleColorAt(x, y) {
    if (x < 0 || x >= this.spriteWidth || y < 0 || y >= this.spriteHeight) return null;
    const frame = this.engine.getCurrentFrame();
    if (!frame) return null;

    // 1. Check custom painted pixel
    const custom = frame.getCustomPixel(x, y);
    if (custom && custom[3] > 0) return [...custom];

    // 2. Check displaced pixel from base sprite
    const src = frame.getPixelSourceAt(x, y);
    if (src && this.baseImageData) {
      const color = this.getBasePixelColor(src.srcX, src.srcY);
      if (color && color[3] > 0) return color;
    }

    return null;
  }

  // Bresenham's line algorithm for continuous brush strokes
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
    const frame = this.engine.getCurrentFrame();
    if (!frame) return;
    const half = Math.floor(this.brushSize / 2);
    for (let dy = -half; dy < this.brushSize - half; dy++) {
      for (let dx = -half; dx < this.brushSize - half; dx++) {
        const tx = px + dx;
        const ty = py + dy;
        if (tx >= 0 && tx < this.spriteWidth && ty >= 0 && ty < this.spriteHeight) {
          if (isErase) {
            frame.removePixel(tx, ty);
          } else {
            frame.setPixel(tx, ty, this.currentColor[0], this.currentColor[1], this.currentColor[2], this.currentColor[3] !== undefined ? this.currentColor[3] : 255);
          }
        }
      }
    }
  }

  setBaseImage(img, width = null, height = null) {
    this.baseImage = img;
    this.spriteWidth = width || img.width || 32;
    this.spriteHeight = height || img.height || 32;
    this.engine.setReferenceDimensions(this.spriteWidth, this.spriteHeight);

    // Cache base image pixel data for instant lookup
    const temp = document.createElement('canvas');
    temp.width = this.spriteWidth;
    temp.height = this.spriteHeight;
    const tctx = temp.getContext('2d', { willReadFrequently: true });
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(img, 0, 0, this.spriteWidth, this.spriteHeight);
    this.baseImageData = tctx.getImageData(0, 0, this.spriteWidth, this.spriteHeight);
    this.heldPixel = null;

    this.centerView();
    this.render();
  }

  getBasePixelColor(srcX, srcY) {
    if (!this.baseImageData) return null;
    if (srcX < 0 || srcX >= this.spriteWidth || srcY < 0 || srcY >= this.spriteHeight) return null;
    const idx = (srcY * this.spriteWidth + srcX) * 4;
    return [
      this.baseImageData.data[idx],
      this.baseImageData.data[idx + 1],
      this.baseImageData.data[idx + 2],
      this.baseImageData.data[idx + 3]
    ];
  }

  getBasePixelAlpha(srcX, srcY) {
    if (!this.baseImageData) return 0;
    if (srcX < 0 || srcX >= this.spriteWidth || srcY < 0 || srcY >= this.spriteHeight) return 0;
    return this.baseImageData.data[(srcY * this.spriteWidth + srcX) * 4 + 3];
  }

  cancelPixelPickup() {
    if (this.heldPixel) {
      const frame = this.engine.getCurrentFrame();
      frame.placePixel(this.heldPixel.fromX, this.heldPixel.fromY, this.heldPixel.origSourceX, this.heldPixel.origSourceY);
      this.heldPixel = null;
      this.render();
      this.onStateChange();
    }
  }

  resizeCanvas() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
    this.render();
  }

  centerView() {
    if (!this.canvas.width || !this.canvas.height) return;
    this.zoom = Math.min(
      Math.floor((this.canvas.width * 0.7) / this.spriteWidth),
      Math.floor((this.canvas.height * 0.7) / this.spriteHeight)
    );
    this.zoom = Math.max(8, Math.min(32, this.zoom));
    this.panX = Math.round((this.canvas.width - this.spriteWidth * this.zoom) / 2);
    this.panY = Math.round((this.canvas.height - this.spriteHeight * this.zoom) / 2);
  }

  // --- Coordinate Mapping ---
  screenToSprite(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = screenX - rect.left;
    const clientY = screenY - rect.top;
    const spriteX = (clientX - this.panX) / this.zoom;
    const spriteY = (clientY - this.panY) / this.zoom;
    return {
      x: spriteX,
      y: spriteY,
      pixelX: Math.floor(spriteX),
      pixelY: Math.floor(spriteY),
      inBounds: spriteX >= 0 && spriteX < this.spriteWidth && spriteY >= 0 && spriteY < this.spriteHeight
    };
  }

  spriteToScreen(spriteX, spriteY) {
    return {
      x: this.panX + spriteX * this.zoom,
      y: this.panY + spriteY * this.zoom
    };
  }

  // --- Event Handling ---
  setupEventListeners() {
    this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    window.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  handleWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const prevZoom = this.zoom;
    const zoomFactor = e.deltaY < 0 ? 1.25 : 0.8;
    let newZoom = Math.round(this.zoom * zoomFactor);
    newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));

    if (newZoom !== prevZoom) {
      // Zoom toward cursor
      this.panX = mouseX - (mouseX - this.panX) * (newZoom / prevZoom);
      this.panY = mouseY - (mouseY - this.panY) * (newZoom / prevZoom);
      this.zoom = newZoom;
      this.render();
    }
  }

  handleMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = e.clientX;
    const screenY = e.clientY;
    const spritePos = this.screenToSprite(screenX, screenY);

    // Middle click or Space/Alt held -> Pan
    if (e.button === 1 || e.altKey || this.activeTool === 'pan' || (e.button === 0 && e.spaceKey)) {
      this.isPanning = true;
      this.dragStart = { screenX, screenY, panX: this.panX, panY: this.panY };
      return;
    }

    if (e.button === 2) {
      // Right Click
      if (this.activeTool === 'pick_place') {
        if (this.heldPixel) {
          this.cancelPixelPickup();
        }
        return;
      } else if (this.activeTool === 'pin_warp') {
        // Delete hovered pin
        const pin = this.findPinAt(spritePos.x, spritePos.y);
        if (pin) {
          this.onHistoryPush();
          this.engine.getCurrentFrame().removePin(pin.id);
          this.render();
          this.onStateChange();
        }
      } else {
        // Clear selection
        this.clearSelection();
        this.render();
      }
      return;
    }

    if (e.button === 0) {
      if (this.activeTool === 'color_dropper') {
        if (spritePos.inBounds) {
          const sampled = this.sampleColorAt(spritePos.pixelX, spritePos.pixelY);
          if (sampled) {
            this.setColor(sampled[0], sampled[1], sampled[2], sampled[3] !== undefined ? sampled[3] : 255);
          }
        }
        return;
      }

      if (this.activeTool === 'add_pixel') {
        if (!spritePos.inBounds) return;
        this.isDragging = true;
        this.dragStart = { ...spritePos, screenX, screenY };
        this.dragCurrent = { ...spritePos, screenX, screenY };
        this.onHistoryPush();
        this.applyBrushAt(spritePos.pixelX, spritePos.pixelY, false);
        this.render();
        this.onStateChange();
        return;
      }

      if (this.activeTool === 'remove_pixel') {
        if (!spritePos.inBounds) return;
        this.isDragging = true;
        this.dragStart = { ...spritePos, screenX, screenY };
        this.dragCurrent = { ...spritePos, screenX, screenY };
        this.onHistoryPush();
        this.applyBrushAt(spritePos.pixelX, spritePos.pixelY, true);
        this.render();
        this.onStateChange();
        return;
      }

      if (this.activeTool === 'pick_place') {
        if (!spritePos.inBounds) return;
        const px = spritePos.pixelX;
        const py = spritePos.pixelY;
        const frame = this.engine.getCurrentFrame();
        const currentSource = frame.getPixelSourceAt(px, py);
        const hasPixelUnderCursor = currentSource !== null && this.getBasePixelAlpha(currentSource.srcX, currentSource.srcY) > 0;

        if (this.heldPixel === null) {
          if (hasPixelUnderCursor) {
            this.onHistoryPush();
            const color = this.getBasePixelColor(currentSource.srcX, currentSource.srcY);
            this.heldPixel = {
              origSourceX: currentSource.srcX,
              origSourceY: currentSource.srcY,
              fromX: px,
              fromY: py,
              color: color
            };
            frame.vacatePixel(px, py);
            this.render();
            this.onStateChange();
          }
        } else {
          this.onHistoryPush();
          const prevHeld = this.heldPixel;

          if (hasPixelUnderCursor) {
            // There is an existing pixel under new location -> pick it up to be placed next
            const nextColor = this.getBasePixelColor(currentSource.srcX, currentSource.srcY);
            const nextHeld = {
              origSourceX: currentSource.srcX,
              origSourceY: currentSource.srcY,
              fromX: px,
              fromY: py,
              color: nextColor
            };
            frame.placePixel(px, py, prevHeld.origSourceX, prevHeld.origSourceY);
            this.heldPixel = nextHeld;
          } else {
            // Empty space under new location -> place pixel and end chain
            frame.placePixel(px, py, prevHeld.origSourceX, prevHeld.origSourceY);
            this.heldPixel = null;
          }
          this.render();
          this.onStateChange();
        }
        return;
      }

      this.isDragging = true;
      this.dragStart = { ...spritePos, screenX, screenY };
      this.dragCurrent = { ...spritePos, screenX, screenY };

      const frame = this.engine.getCurrentFrame();

      if (this.activeTool === 'pin_warp') {
        const pin = this.findPinAt(spritePos.x, spritePos.y);
        if (pin) {
          this.selectedPin = pin;
        } else if (spritePos.inBounds) {
          // Add new pin
          this.onHistoryPush();
          this.selectedPin = frame.addPin(spritePos.x, spritePos.y, this.pinRadius);
          this.onStateChange();
        }
      } else if (this.activeTool === 'box_select') {
        // If clicking inside existing selection, begin transforming/moving selection
        if (this.isPointInSelection(spritePos.pixelX, spritePos.pixelY)) {
          this.isTransformingSelection = true;
          this.onHistoryPush();
        } else {
          this.clearSelection();
        }
      } else if (this.activeTool === 'lasso_select') {
        if (this.isPointInSelection(spritePos.pixelX, spritePos.pixelY)) {
          this.isTransformingSelection = true;
          this.onHistoryPush();
        } else {
          this.clearSelection();
          this.lassoPoints = [{ x: spritePos.pixelX, y: spritePos.pixelY }];
        }
      } else if (this.activeTool === 'smear') {
        this.onHistoryPush();
      }

      this.render();
    }
  }

  handleMouseMove(e) {
    const screenX = e.clientX;
    const screenY = e.clientY;
    const spritePos = this.screenToSprite(screenX, screenY);
    this.hoverPixel = { x: spritePos.pixelX, y: spritePos.pixelY, valid: spritePos.inBounds };

    if (this.isPanning) {
      this.panX = this.dragStart.panX + (screenX - this.dragStart.screenX);
      this.panY = this.dragStart.panY + (screenY - this.dragStart.screenY);
      this.render();
      return;
    }

    // Hover pin detection
    if (this.activeTool === 'pin_warp') {
      const pin = this.findPinAt(spritePos.x, spritePos.y);
      if (pin !== this.hoveredPin) {
        this.hoveredPin = pin;
        this.render();
      }
    }

    if (!this.isDragging) {
      this.render();
      return;
    }

    const frame = this.engine.getCurrentFrame();
    const prevDrag = { ...this.dragCurrent };
    this.dragCurrent = { ...spritePos, screenX, screenY };

    if (this.activeTool === 'add_pixel') {
      this.plotLine(prevDrag.pixelX, prevDrag.pixelY, spritePos.pixelX, spritePos.pixelY, (x, y) => {
        this.applyBrushAt(x, y, false);
      });
      this.render();
      this.onStateChange();
    } else if (this.activeTool === 'remove_pixel') {
      this.plotLine(prevDrag.pixelX, prevDrag.pixelY, spritePos.pixelX, spritePos.pixelY, (x, y) => {
        this.applyBrushAt(x, y, true);
      });
      this.render();
      this.onStateChange();
    } else if (this.activeTool === 'pin_warp' && this.selectedPin) {
      frame.movePin(this.selectedPin.id, spritePos.x, spritePos.y);
      this.render();
      this.onStateChange();
    } else if (this.activeTool === 'smear' && spritePos.inBounds) {
      frame.applySmear(
        prevDrag.x, prevDrag.y,
        spritePos.x, spritePos.y,
        this.brushRadius,
        this.brushStrength
      );
      this.render();
      this.onStateChange();
    } else if (this.activeTool === 'box_select') {
      if (this.isTransformingSelection) {
        const dx = spritePos.pixelX - this.dragStart.pixelX;
        const dy = spritePos.pixelY - this.dragStart.pixelY;
        this.selectionOffset.dx = dx;
        this.selectionOffset.dy = dy;
      }
      this.render();
    } else if (this.activeTool === 'lasso_select') {
      if (this.isTransformingSelection) {
        const dx = spritePos.pixelX - this.dragStart.pixelX;
        const dy = spritePos.pixelY - this.dragStart.pixelY;
        this.selectionOffset.dx = dx;
        this.selectionOffset.dy = dy;
      } else {
        // Add point to lasso path
        const lastPt = this.lassoPoints[this.lassoPoints.length - 1];
        if (!lastPt || lastPt.x !== spritePos.pixelX || lastPt.y !== spritePos.pixelY) {
          this.lassoPoints.push({ x: spritePos.pixelX, y: spritePos.pixelY });
        }
      }
      this.render();
    }
  }

  handleMouseUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      return;
    }

    if (this.isDragging) {
      this.isDragging = false;
      const frame = this.engine.getCurrentFrame();

      if (this.activeTool === 'box_select') {
        if (this.isTransformingSelection) {
          // Commit transform into frame displacement
          if (this.selectionMask && (this.selectionOffset.dx !== 0 || this.selectionOffset.dy !== 0)) {
            frame.applySelectionOffset(
              this.selectionMask,
              this.selectionOffset.dx,
              this.selectionOffset.dy
            );
            this.updateSelectionBounds();
          }
          this.isTransformingSelection = false;
          this.selectionOffset = { dx: 0, dy: 0, rotation: 0 };
        } else {
          // Finalize box selection
          const x0 = Math.min(this.dragStart.pixelX, this.dragCurrent.pixelX);
          const y0 = Math.min(this.dragStart.pixelY, this.dragCurrent.pixelY);
          const x1 = Math.max(this.dragStart.pixelX, this.dragCurrent.pixelX);
          const y1 = Math.max(this.dragStart.pixelY, this.dragCurrent.pixelY);

          if (x1 >= x0 && y1 >= y0 && x1 >= 0 && y1 >= 0 && x0 < this.spriteWidth && y0 < this.spriteHeight) {
            this.createBoxSelection(x0, y0, x1, y1);
          }
        }
      } else if (this.activeTool === 'lasso_select') {
        if (this.isTransformingSelection) {
          if (this.selectionMask && (this.selectionOffset.dx !== 0 || this.selectionOffset.dy !== 0)) {
            frame.applySelectionOffset(
              this.selectionMask,
              this.selectionOffset.dx,
              this.selectionOffset.dy
            );
            this.updateSelectionBounds();
          }
          this.isTransformingSelection = false;
          this.selectionOffset = { dx: 0, dy: 0, rotation: 0 };
        } else if (this.lassoPoints.length > 2) {
          this.createLassoSelection(this.lassoPoints);
        }
        this.lassoPoints = [];
      }

      this.selectedPin = null;
      this.render();
      this.onStateChange();
    }
  }

  handleKeyDown(e) {
    // Arrow keys nudge
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 4 : 1;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowUp') dy = -step;
      if (e.key === 'ArrowDown') dy = step;
      if (e.key === 'ArrowLeft') dx = -step;
      if (e.key === 'ArrowRight') dx = step;

      const frame = this.engine.getCurrentFrame();
      this.onHistoryPush();

      if (this.selectionMask) {
        // Nudge selection
        frame.applySelectionOffset(this.selectionMask, dx, dy);
        this.updateSelectionBounds();
      } else {
        // Global whole-sprite nudge
        frame.applyGlobalShift(dx, dy);
      }

      this.render();
      this.onStateChange();
    } else if (e.key === 'Escape') {
      if (this.heldPixel) {
        this.cancelPixelPickup();
      }
      this.clearSelection();
      this.render();
    }
  }

  // --- Selection Helpers ---
  createBoxSelection(x0, y0, x1, y1) {
    const mask = new Uint8Array(this.spriteWidth * this.spriteHeight);
    const minX = Math.max(0, x0);
    const maxX = Math.min(this.spriteWidth - 1, x1);
    const minY = Math.max(0, y0);
    const maxY = Math.min(this.spriteHeight - 1, y1);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        mask[y * this.spriteWidth + x] = 1;
      }
    }
    this.selectionMask = mask;
    this.selectionBounds = { minX, minY, maxX, maxY };
  }

  createLassoSelection(points) {
    const mask = new Uint8Array(this.spriteWidth * this.spriteHeight);
    let minX = this.spriteWidth, maxX = 0, minY = this.spriteHeight, maxY = 0;

    // Point in polygon test
    const insidePoly = (px, py) => {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x, yi = points[i].y;
        const xj = points[j].x, yj = points[j].y;
        const intersect = ((yi > py) !== (yj > py)) &&
          (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };

    for (let y = 0; y < this.spriteHeight; y++) {
      for (let x = 0; x < this.spriteWidth; x++) {
        if (insidePoly(x, y)) {
          mask[y * this.spriteWidth + x] = 1;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (minX <= maxX && minY <= maxY) {
      this.selectionMask = mask;
      this.selectionBounds = { minX, minY, maxX, maxY };
    } else {
      this.clearSelection();
    }
  }

  clearSelection() {
    this.selectionMask = null;
    this.selectionBounds = null;
    this.selectionOffset = { dx: 0, dy: 0, rotation: 0 };
    this.isTransformingSelection = false;
  }

  isPointInSelection(px, py) {
    if (!this.selectionMask) return false;
    if (px < 0 || px >= this.spriteWidth || py < 0 || py >= this.spriteHeight) return false;
    return this.selectionMask[py * this.spriteWidth + px] === 1;
  }

  updateSelectionBounds() {
    if (!this.selectionMask) return;
    let minX = this.spriteWidth, maxX = 0, minY = this.spriteHeight, maxY = 0;
    let hasPixels = false;
    for (let y = 0; y < this.spriteHeight; y++) {
      for (let x = 0; x < this.spriteWidth; x++) {
        if (this.selectionMask[y * this.spriteWidth + x] === 1) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          hasPixels = true;
        }
      }
    }
    if (hasPixels) {
      this.selectionBounds = { minX, minY, maxX, maxY };
    } else {
      this.clearSelection();
    }
  }

  // --- Pin Helpers ---
  findPinAt(spriteX, spriteY) {
    const frame = this.engine.getCurrentFrame();
    for (let i = frame.pins.length - 1; i >= 0; i--) {
      const pin = frame.pins[i];
      const dist = Math.hypot(spriteX - pin.currX, spriteY - pin.currY);
      if (dist <= 1.5) { // 1.5 pixel radius detection
        return pin;
      }
    }
    return null;
  }

  // --- Main Render Loop ---
  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);

    // 1. Draw Background Checkerboard
    this.drawCheckerboard(ctx, w, h);

    // 2. Draw Sprite Bounds Border / Drop Shadow
    const spriteOrigin = this.spriteToScreen(0, 0);
    const spritePixelW = this.spriteWidth * this.zoom;
    const spritePixelH = this.spriteHeight * this.zoom;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = 'rgba(30, 41, 59, 0.5)';
    ctx.fillRect(spriteOrigin.x, spriteOrigin.y, spritePixelW, spritePixelH);
    ctx.restore();

    if (!this.baseImage) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Load a base sprite to start authoring', w / 2, h / 2);
      return;
    }

    // 3. Render Onion Skinning (Previous & Next Frames)
    if (this.showOnionSkin && this.engine.frames.length > 1) {
      const curIdx = this.engine.currentFrameIndex;
      // Previous frame in Red/Orange tint
      if (curIdx > 0 || this.engine.loop) {
        const prevIdx = (curIdx - 1 + this.engine.frames.length) % this.engine.frames.length;
        if (prevIdx !== curIdx) {
          this.renderDeformedSpriteToScreen(prevIdx, {
            alpha: this.onionOpacity,
            tintColor: [239, 68, 68] // Red ghost
          });
        }
      }
      // Next frame in Green/Cyan tint
      if (curIdx < this.engine.frames.length - 1 || this.engine.loop) {
        const nextIdx = (curIdx + 1) % this.engine.frames.length;
        if (nextIdx !== curIdx) {
          this.renderDeformedSpriteToScreen(nextIdx, {
            alpha: this.onionOpacity * 0.8,
            tintColor: [16, 185, 129] // Green ghost
          });
        }
      }
    }

    // 4. Render Current Active Frame
    this.renderDeformedSpriteToScreen(this.engine.currentFrameIndex, { alpha: 1.0 });

    // 5. Draw Pixel Grid Overlay (when zoom >= 4)
    if (this.showGrid && this.zoom >= 4) {
      this.drawPixelGrid(ctx);
    }

    // 6. Draw Sprite Bounding Outline
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.6)'; // Indigo border
    ctx.lineWidth = 1;
    ctx.strokeRect(spriteOrigin.x - 0.5, spriteOrigin.y - 0.5, spritePixelW + 1, spritePixelH + 1);

    // 7. Draw Active Selection & Marquee
    this.drawSelectionOverlay(ctx);

    // 8. Draw Puppet Pins & Influence
    if (this.activeTool === 'pin_warp') {
      this.drawPins(ctx);
    }

    // 9. Draw Tool Cursors / Brush outline
    if (this.activeTool === 'smear' && this.hoverPixel.valid) {
      this.drawBrushCursor(ctx);
    }

    // 10. Draw Pixel Pick & Place Overlay
    if (this.activeTool === 'pick_place') {
      this.drawPickPlaceOverlay(ctx);
    }

    // 11. Draw Add Pixel (Pencil) Cursor
    if (this.activeTool === 'add_pixel') {
      this.drawAddPixelCursor(ctx);
    }

    // 12. Draw Remove Pixel (Eraser) Cursor
    if (this.activeTool === 'remove_pixel') {
      this.drawRemovePixelCursor(ctx);
    }

    // 13. Draw Color Dropper (Eyedropper) Cursor
    if (this.activeTool === 'color_dropper') {
      this.drawColorDropperCursor(ctx);
    }
  }

  drawAddPixelCursor(ctx) {
    if (!this.hoverPixel.valid) return;
    const half = Math.floor(this.brushSize / 2);
    const startX = this.hoverPixel.x - half;
    const startY = this.hoverPixel.y - half;
    const sPos = this.spriteToScreen(startX, startY);
    const size = this.brushSize * this.zoom;

    ctx.save();
    // Fill preview
    const [r, g, b] = this.currentColor;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.75)`;
    ctx.fillRect(sPos.x, sPos.y, size, size);

    // Reticle border
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sPos.x + 0.5, sPos.y + 0.5, size - 1, size - 1);
    ctx.restore();
  }

  drawRemovePixelCursor(ctx) {
    if (!this.hoverPixel.valid) return;
    const half = Math.floor(this.brushSize / 2);
    const startX = this.hoverPixel.x - half;
    const startY = this.hoverPixel.y - half;
    const sPos = this.spriteToScreen(startX, startY);
    const size = this.brushSize * this.zoom;

    ctx.save();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.35)'; // Red translucent
    ctx.fillRect(sPos.x, sPos.y, size, size);

    // Red X / Eraser indicator
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sPos.x + 0.5, sPos.y + 0.5, size - 1, size - 1);
    ctx.beginPath();
    ctx.moveTo(sPos.x + 2, sPos.y + 2);
    ctx.lineTo(sPos.x + size - 2, sPos.y + size - 2);
    ctx.moveTo(sPos.x + size - 2, sPos.y + 2);
    ctx.lineTo(sPos.x + 2, sPos.y + size - 2);
    ctx.stroke();
    ctx.restore();
  }

  drawColorDropperCursor(ctx) {
    if (!this.hoverPixel.valid) return;
    const sPos = this.spriteToScreen(this.hoverPixel.x, this.hoverPixel.y);
    const sampled = this.sampleColorAt(this.hoverPixel.x, this.hoverPixel.y);

    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sPos.x + 0.5, sPos.y + 0.5, this.zoom - 1, this.zoom - 1);

    if (sampled) {
      const badgePos = this.spriteToScreen(this.hoverPixel.x + 0.85, this.hoverPixel.y - 0.85);
      const bSize = Math.max(14, Math.min(24, Math.round(this.zoom * 0.85)));
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = `rgb(${sampled[0]}, ${sampled[1]}, ${sampled[2]})`;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.fillRect(badgePos.x, badgePos.y, bSize, bSize);
      ctx.strokeRect(badgePos.x, badgePos.y, bSize, bSize);
    }
    ctx.restore();
  }

  renderDeformedSpriteToScreen(frameIndex, renderOptions = {}) {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.spriteWidth;
    tempCanvas.height = this.spriteHeight;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.imageSmoothingEnabled = false;

    // Let the motion engine render the frame
    this.engine.renderSpriteFrame(
      this.baseImage,
      frameIndex,
      tempCtx,
      this.spriteWidth,
      this.spriteHeight,
      renderOptions
    );

    // Draw magnified to main canvas
    const origin = this.spriteToScreen(0, 0);
    this.ctx.save();
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(
      tempCanvas,
      origin.x,
      origin.y,
      this.spriteWidth * this.zoom,
      this.spriteHeight * this.zoom
    );
    this.ctx.restore();
  }

  drawCheckerboard(ctx, w, h) {
    const size = 16;
    ctx.fillStyle = '#0f172a'; // slate-900
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1e293b'; // slate-800
    for (let y = 0; y < h; y += size) {
      for (let x = 0; x < w; x += size) {
        if (((x / size) + (y / size)) % 2 === 0) {
          ctx.fillRect(x, y, size, size);
        }
      }
    }
  }

  drawPixelGrid(ctx) {
    const origin = this.spriteToScreen(0, 0);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = 0; x <= this.spriteWidth; x++) {
      const sx = Math.floor(origin.x + x * this.zoom) + 0.5;
      ctx.moveTo(sx, origin.y);
      ctx.lineTo(sx, origin.y + this.spriteHeight * this.zoom);
    }
    for (let y = 0; y <= this.spriteHeight; y++) {
      const sy = Math.floor(origin.y + y * this.zoom) + 0.5;
      ctx.moveTo(origin.x, sy);
      ctx.lineTo(origin.x + this.spriteWidth * this.zoom, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawSelectionOverlay(ctx) {
    ctx.save();

    // Draw active drag box
    if (this.isDragging && this.activeTool === 'box_select' && !this.isTransformingSelection) {
      const x0 = Math.min(this.dragStart.pixelX, this.dragCurrent.pixelX);
      const y0 = Math.min(this.dragStart.pixelY, this.dragCurrent.pixelY);
      const x1 = Math.max(this.dragStart.pixelX, this.dragCurrent.pixelX) + 1;
      const y1 = Math.max(this.dragStart.pixelY, this.dragCurrent.pixelY) + 1;
      const s0 = this.spriteToScreen(x0, y0);
      const s1 = this.spriteToScreen(x1, y1);

      ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
      ctx.fillRect(s0.x, s0.y, s1.x - s0.x, s1.y - s0.y);
      ctx.strokeStyle = '#3b82f6';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(s0.x, s0.y, s1.x - s0.x, s1.y - s0.y);
    }

    // Draw active lasso path
    if (this.isDragging && this.activeTool === 'lasso_select' && !this.isTransformingSelection && this.lassoPoints.length > 1) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const first = this.spriteToScreen(this.lassoPoints[0].x + 0.5, this.lassoPoints[0].y + 0.5);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < this.lassoPoints.length; i++) {
        const pt = this.spriteToScreen(this.lassoPoints[i].x + 0.5, this.lassoPoints[i].y + 0.5);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }

    // Draw confirmed selection bounding box & marching ants
    if (this.selectionMask && this.selectionBounds) {
      const offX = this.isTransformingSelection ? this.selectionOffset.dx : 0;
      const offY = this.isTransformingSelection ? this.selectionOffset.dy : 0;

      const minS = this.spriteToScreen(this.selectionBounds.minX + offX, this.selectionBounds.minY + offY);
      const maxS = this.spriteToScreen(this.selectionBounds.maxX + 1 + offX, this.selectionBounds.maxY + 1 + offY);
      const width = maxS.x - minS.x;
      const height = maxS.y - minS.y;

      ctx.strokeStyle = '#fbbf24'; // Amber marching ants
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(minS.x, minS.y, width, height);

      // Highlight selected pixels
      ctx.fillStyle = 'rgba(251, 191, 36, 0.15)';
      for (let y = 0; y < this.spriteHeight; y++) {
        for (let x = 0; x < this.spriteWidth; x++) {
          if (this.selectionMask[y * this.spriteWidth + x] === 1) {
            const pS = this.spriteToScreen(x + offX, y + offY);
            ctx.fillRect(pS.x, pS.y, this.zoom, this.zoom);
          }
        }
      }
    }

    ctx.restore();
  }

  drawPins(ctx) {
    const frame = this.engine.getCurrentFrame();
    ctx.save();

    frame.pins.forEach(pin => {
      const isSelected = this.selectedPin && this.selectedPin.id === pin.id;
      const isHovered = this.hoveredPin && this.hoveredPin.id === pin.id;
      const restPos = this.spriteToScreen(pin.restX, pin.restY);
      const currPos = this.spriteToScreen(pin.currX, pin.currY);

      // Influence radius circle
      if (isSelected || isHovered) {
        ctx.strokeStyle = 'rgba(236, 72, 153, 0.25)'; // Pink influence circle
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(currPos.x, currPos.y, pin.radius * this.zoom, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Displacement line from rest to current
      if (pin.currX !== pin.restX || pin.currY !== pin.restY) {
        ctx.strokeStyle = '#ec4899';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(restPos.x, restPos.y);
        ctx.lineTo(currPos.x, currPos.y);
        ctx.stroke();

        // Rest position anchor
        ctx.fillStyle = '#64748b';
        ctx.beginPath();
        ctx.arc(restPos.x, restPos.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Pin handle
      ctx.setLineDash([]);
      ctx.fillStyle = isSelected ? '#f43f5e' : (isHovered ? '#fb7185' : '#ec4899');
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(currPos.x, currPos.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    ctx.restore();
  }

  drawBrushCursor(ctx) {
    const screenPos = this.spriteToScreen(this.hoverPixel.x + 0.5, this.hoverPixel.y + 0.5);
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(screenPos.x, screenPos.y, this.brushRadius * this.zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawPickPlaceOverlay(ctx) {
    ctx.save();

    if (this.hoverPixel.valid) {
      const sPos = this.spriteToScreen(this.hoverPixel.x, this.hoverPixel.y);
      const frame = this.engine.getCurrentFrame();
      const curSrc = frame.getPixelSourceAt(this.hoverPixel.x, this.hoverPixel.y);
      const hasTargetPixel = curSrc !== null && this.getBasePixelAlpha(curSrc.srcX, curSrc.srcY) > 0;

      if (this.heldPixel) {
        // Draw ghost preview of held pixel inside hover cell
        if (this.heldPixel.color) {
          const [r, g, b] = this.heldPixel.color;
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.75)`;
          ctx.fillRect(sPos.x, sPos.y, this.zoom, this.zoom);
        }

        // Cell border: Amber if chaining swap on existing pixel, Emerald if placing on empty cell
        if (hasTargetPixel) {
          ctx.strokeStyle = '#f59e0b'; // Amber swap
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 2]);
          ctx.strokeRect(sPos.x + 0.5, sPos.y + 0.5, this.zoom - 1, this.zoom - 1);
        } else {
          ctx.strokeStyle = '#10b981'; // Emerald place
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 2]);
          ctx.strokeRect(sPos.x + 0.5, sPos.y + 0.5, this.zoom - 1, this.zoom - 1);
        }
        ctx.setLineDash([]);
      } else {
        // No pixel currently held
        if (hasTargetPixel) {
          // Highlight pickable pixel with violet/indigo reticle and corner brackets
          ctx.strokeStyle = '#a855f7';
          ctx.lineWidth = 2;
          ctx.strokeRect(sPos.x + 0.5, sPos.y + 0.5, this.zoom - 1, this.zoom - 1);

          ctx.fillStyle = '#c084fc';
          const cSize = Math.max(2, Math.floor(this.zoom / 4));
          ctx.fillRect(sPos.x, sPos.y, cSize, cSize);
          ctx.fillRect(sPos.x + this.zoom - cSize, sPos.y, cSize, cSize);
          ctx.fillRect(sPos.x, sPos.y + this.zoom - cSize, cSize, cSize);
          ctx.fillRect(sPos.x + this.zoom - cSize, sPos.y + this.zoom - cSize, cSize, cSize);
        } else {
          // Subtle neutral grid cell outline
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 1;
          ctx.strokeRect(sPos.x + 0.5, sPos.y + 0.5, this.zoom - 1, this.zoom - 1);
        }
      }
    }

    // If holding a pixel, draw a floating pixel preview badge attached near cursor
    if (this.heldPixel && this.hoverPixel.valid) {
      const badgePos = this.spriteToScreen(this.hoverPixel.x + 0.85, this.hoverPixel.y - 0.85);
      if (this.heldPixel.color) {
        const [r, g, b] = this.heldPixel.color;
        const bSize = Math.max(14, Math.min(24, Math.round(this.zoom * 0.85)));

        ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.fillRect(badgePos.x, badgePos.y, bSize, bSize);
        ctx.strokeRect(badgePos.x, badgePos.y, bSize, bSize);
      }
    }

    ctx.restore();
  }
}
