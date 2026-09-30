# Lenticular Shift

Micro-ridges swap one word for another as the angle changes

Keywords: lenticular, ridges, angle, interleave, word swap, optical, type, hover, parallax print, mask stripes, matter motion, perspective

## CSS

```css
.lenticular span::before,
.lenticular span::after { position: absolute; content: attr(data-a); }
.lenticular span::after {
  content: attr(data-b);
  mask: repeating-linear-gradient(90deg, #000 0 6px, transparent 6px 12px);
}
.lenticular:hover span { transform: skewY(-5deg) translateX(3px); }
```

## Prompt guidance

Build a lenticular type panel that alternates between MATTER and MOTION through fine vertical ridges. Interleave the second word with narrow mask strips, then shift the layers in opposite directions on hover so the perceived label changes with viewing angle rather than crossfading.
