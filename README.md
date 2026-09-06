# Sprite Pixel Motion Studio V2.0
> **"Author Once, Apply to Many"** — Next-Generation 2D Master Sprite, Multi-Layer & Hierarchical Variant Studio with Cascading Animations.

---

## What's New in Version 2

1. **Master Sprite & Multi-Layer System**:
   - Create custom canvas dimensions (16×16, 24×24, 32×32, 48×48, 64×64, or custom).
   - Full Photoshop / Aseprite style Layer Stack: Upper layers render over lower ones.
   - Per-layer visibility (eye), lock, opacity slider, reordering (up/down), and **[EDIT]** target mode.
   - Dual Work Modes:
     - **Paint Layers (`🎨`)**: Use Pencil (`7`), Eraser (`8`), Paint Bucket / Flood Fill (`B`), and Eyedropper (`9`) to design base sprite layers directly.
     - **Animate Clips (`🎬`)**: Frame-by-frame deformation strictly masked by active edit layers.

2. **Layer-Masked Deformations**:
   - Mark any layer as **[EDIT]** (e.g. *"Left Arm"* or *"Right Arm & Sword"*).
   - Deformation tools (**Box Select `1`**, **Lasso Select `2`**, **Puppet Pins `3`**, **Smear Brush `4`**, **Pick & Place `6`**) operate **strictly on pixels belonging to that layer**. Other layers remain locked in position.

3. **Multiple Animation Clips Manager**:
   - Manage named animation clips in one project: `"Idle"`, `"Walk"`, `"Run"`, `"Attack"`, `"Hurt"`, `"Death"`.
   - Per-clip FPS controls, looping toggles, frame filmstrip, and onion skinning.

4. **Sprite Variants & Cascading (Inherited) Animations**:
   - Create variants (e.g. *"Knight"* $\rightarrow$ *"Paladin with Cape"* or *"Hero with Ponytail"*).
   - Add variant-specific layers or modify pixels to reskin characters.
   - **Cascading Overrides**: Base sprite animations automatically propagate down the variant tree! Any animation tweaks made on a variant remain local to that variant, while parent updates continue to cascade down to child variants.

5. **Native OS "Save As" Dialogs**:
   - Powered by the modern Web File System Access API (`window.showSaveFilePicker`).
   - Prompts the native Windows "Save As..." dialog so you can choose the exact directory and file name directly (no more automatic dumping to Downloads).
   - Full project serialization to `.spv2.json` preserving all layers, variants, clips, and keyframe deformations.

6. **Comprehensive Export Pipeline**:
   - Spritesheet PNGs (Horizontal, Vertical, Grid layouts).
   - Transparent Animated GIFs.
   - Individual PNG Frame Sequences (ZIP).
   - One-click Batch ZIP containing all variants across all animations.

---

## Quick Start / How to Run

### Method 1: Double-Click the Launcher
Double-click `start_studio.bat` in Windows Explorer. It starts the local server and automatically opens the studio in your browser.

### Method 2: Manual Terminal Command
```bash
# Using Python
python -m http.server 8000

# Or using Node.js npx
npx serve .
```
Then open `http://localhost:8000`.

---

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / Pause Animation |
| `[` / `]` | Previous / Next Frame |
| `1` | Box Select & Move Tool |
| `2` | Lasso Select Tool |
| `3` | Puppet Pin Warp Tool |
| `4` | Pixel Smear / Push Brush |
| `6` | Pixel Pick & Place / Chain Swap Tool |
| `7` | Pencil / Draw Pixel |
| `8` | Eraser / Remove Pixel |
| `B` | Paint Bucket / Flood Fill |
| `9` | Eyedropper / Color Picker |
| `Ctrl + Z` / `Ctrl + Y` | Undo / Redo |
| `Escape` / `Right Click` | Clear selection or cancel held pixel |
| `Mouse Wheel` | Zoom in / out (centered on cursor) |
| `Middle Click` or `Alt + Drag` | Pan Canvas Viewport |
