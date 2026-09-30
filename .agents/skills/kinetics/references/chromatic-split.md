# Chromatic Split

Type separates into prismatic channels, then snaps back

Keywords: chromatic aberration, rgb, prism, split, lens, distortion, hover, spectral, fringe, photography, glitch, color channels

## CSS

```css
.chromatic::before, .chromatic::after { content: attr(data-text); position: absolute; }
.chromatic:hover::before { transform: translateX(-3px); color: #5b8def; }
.chromatic:hover::after { transform: translateX(3px); color: #ff5d73; }
```

## Prompt guidance

Make a display word that gets a subtle prismatic RGB split on hover. Duplicate the text with pseudo-elements, offset the blue and red channels by only a few pixels, then use a quick elastic return so it reads like an optical glitch, not a harsh cyberpunk effect.
