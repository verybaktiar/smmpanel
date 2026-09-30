# Elastic Lasso

Drag a selection field across the constellation

Keywords: selection, marquee, drag select, multi select, box select, canvas, desktop, files, area, rubber band, group, click drag

## CSS

```css
.lasso-box { border: 1px solid #ff8a00; background: rgba(255,138,0,.1); }
.dot.selected { transform: scale(1.45); background: #ff8a00; }
```

## Prompt guidance

Build a miniature drag-to-select surface. Pointer drag stretches a translucent lasso rectangle from its origin; dots touched by the rectangle spring larger and turn amber. Clear the selection on the next drag.
