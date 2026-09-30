# Dither Bloom

A low-bit dot field grows into a soft spectral bloom

Keywords: dither, ordered dots, pixel, low bit, halftone, bloom, retro modern, mask, dot matrix, spectral, stepped, shader

## CSS

```css
.dither::before {
  background: radial-gradient(circle, #ff8a00 0 1px, transparent 1.5px);
  background-size: 7px 7px;
  mask-image: radial-gradient(circle at var(--x) var(--y), #000, transparent 62%);
  animation: dither-drift 6s steps(12) infinite;
}
```

## Prompt guidance

Create a refined ordered-dither surface from a tiny repeating dot grid, not random film grain. Move a soft radial mask across the grid in stepped frames so sparse amber pixels accumulate into a dense spectral bloom, then disperse. Preserve hard pixel edges inside a softly lit panel.
