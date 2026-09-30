# Bento Expand

Hover focuses one tile; the rest quietly recede

Keywords: bento, grid, dashboard, tiles, hover focus, editorial layout, cards, asymmetric, recede, spotlight, layout, apple

## CSS

```css
.bento { display: grid; grid-template-columns: 1.1fr .9fr; gap: 7px; }
.bento span:hover {
  background: var(--amber);
  transform: scale(1.04);
}
.bento:has(span:hover) span:not(:hover) {
  opacity: .45;
  transform: scale(.96);
}
```

## Prompt guidance

Create a miniature bento grid where hovering a tile lifts it with a spring scale and amber fill while siblings dim and shrink slightly via :has(). Keep labels monospaced and the layout uneven (one tall hero cell) so it feels editorial rather than a uniform dashboard grid.
