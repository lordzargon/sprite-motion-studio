# Sprite Pixel Motion Studio
> **"Author Once, Apply to Many"** — An interactive 2D sprite deformation & motion transfer tool.

---

## What It Does
1. **Load a Base 2D Sprite**: Upload your source sprite or use one of the built-in pixel-art characters.
2. **Author Frame-by-Frame Pixel Movements**:
   - **Box Selection & Move (`1`)**: Select pixel rectangles, drag or nudge them with arrow keys.
   - **Lasso Selection & Move (`2`)**: Freehand lasso select arbitrary pixel clusters (weapons, heads, limbs) and move them.
   - **Puppet Warp Pins (`3`)**: Click pins onto the sprite (e.g. joints, hat, tentacles) and drag them to deform smoothly.
   - **Pixel Smear / Push (`4`)**: Liquid brush to smudge and push pixels with custom brush radii.
   - **Whole-Image Shift (`5`)**: Global sprite offset/bobbing.
   - **Pixel Pick & Place / Chain Move (`6`)**: Click any pixel to pick it up, then click down to place it. If another pixel is under the destination, it chain-picks that pixel up to place on the next click.
3. **Record Pixel Offsets**:
   - Every movement is recorded as normalized displacement fields and pin vectors.
   - Resolution-independent: Works seamlessly whether sprites are 16×16, 32×32, 64×64, or 128×128.
4. **Instant Multi-Sprite Replay ("Target Sprites Deck")**:
   - Drop in any number of secondary sprites (different characters, weapons, armor sets, monsters).
   - Watch them all play the exact same animation in synchronized real-time preview!
5. **Batch Exporting**:
   - **Baked Spritesheet PNGs** (Horizontal strip, Vertical strip, Grid).
   - **Animated GIFs** (Instant in-browser rendering).
   - **Individual PNG Frame Sequences**.
   - **Batch `.zip` Exporter**: One click to export all spritesheets and PNG sequences for all loaded target sprites.
   - **Reusable Motion Presets (`.spritemotion.json`)**: Save your animations to disk and load them onto any future sprite.

---

## Quick Start / How to Run

### Method 1: Double-Click the Launcher (Easiest)
Simply double-click `start_studio.bat` in Windows Explorer. It will start the local server and automatically open the application in your default browser.

### Method 2: Manual Terminal Command
You can also run from terminal:

```bash
# Using Python
python -m http.server 8000

# Or using Node.js npx
npx serve .
```

Then open your browser at `http://localhost:8000`.

---

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / Pause Animation |
| `[` / `]` | Previous / Next Frame |
| `Arrow Keys` | 1-Pixel Nudge (Selection or Whole Sprite) |
| `Shift + Arrows` | 4-Pixel Nudge |
| `1` | Box Select Tool |
| `2` | Lasso Select Tool |
| `3` | Puppet Pin Warp Tool |
| `4` | Pixel Smear / Push Brush |
| `5` | Whole Image Shift Tool |
| `6` | Pixel Pick & Place / Chain Swap Tool |
| `Ctrl + Z` / `Ctrl + Y` | Undo / Redo |
| `Escape` / `Right Click` | Clear selection or cancel held pixel |
| `Mouse Wheel` | Zoom in / out (centered on cursor) |
| `Middle Click` or `Alt + Drag` | Pan Canvas Viewport |
