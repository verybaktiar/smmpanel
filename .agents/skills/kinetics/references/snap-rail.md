# Snap Rail

A soft selection pill springs to the hovered option

Keywords: segmented control, pill, snap, day week month, filter, toggle group, magnetic, selection, tabs, spring, options, range

## CSS

```css
.rail {
  display: flex;
  padding: 4px;
  --i: 0;
}
.rail::before {
  position: absolute;
  top: 4px; bottom: 4px; left: 4px;
  width: calc((100% - 8px) / 3); /* one equal third */
  transform: translateX(calc(var(--i) * 100%));
  transition: transform .45s cubic-bezier(0.34,1.56,0.64,1);
}
.rail:has(button:nth-child(2):hover) { --i: 1; }
.rail:has(button:nth-child(3):hover) { --i: 2; }
.rail button {
  flex: 1 1 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

## Prompt guidance

Build a segmented snap rail for Day / Week / Month. Use flex with three equal flex:1 buttons so labels stay horizontally centered in identical cells. A single pill pseudo-element is exactly calc((100% - padding) / 3) wide and slides with translateX(calc(var(--i) * 100%)) where --i is set via :has() on hover. Never size the pill to the text — always to the equal column.
