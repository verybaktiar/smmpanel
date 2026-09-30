# Lattice Snap

A tile follows the pointer, then springs onto the nearest cell

Keywords: grid, snap, magnet, tile, drag, cells, lattice, align, figma, board, drop, spring snap

## CSS

```css
.lattice-tile {
  translate: calc(var(--c) * (100% + 8px))
             calc(var(--r) * (100% + 8px));
  transition: translate .5s cubic-bezier(.34,1.56,.64,1);
}
.lattice.dragging .lattice-tile {
  translate: calc(var(--tx) * 1px) calc(var(--ty) * 1px);
  transition-duration: 80ms;
}
.lattice span.hot { border-color: var(--amber); background: rgba(255,138,0,.08); }
```

## Prompt guidance

Build a 3 by 2 magnetic lattice. While dragging, the tile tracks the pointer with a short trail and the cell under it lights. On release it springs to that cell using column and row custom properties — 100% of the tile size plus the gap — so the same rule works for every slot. Arrow keys should step one cell. Never reflow the grid.
