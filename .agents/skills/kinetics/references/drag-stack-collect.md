# Drag Stack Collect

Loose items gather into a fanned pile under the pointer

Keywords: drag and drop, multi select, files, finder, gather, pile, stack, batch, move items, collect, fan, desktop, upload, bulk action

## CSS

```css
.dragstack-row button {
  transition: translate .5s cubic-bezier(.34,1.56,.64,1), rotate .5s var(--spring);
}
.dragstack.gathered button {
  translate: calc(var(--dx) * 1px) calc(var(--dy) * 1px);
  rotate: calc(var(--i) * 5deg - 5deg);
  transition-duration: 120ms;              /* tight while dragging */
}
.dragstack.gathered .dragstack-badge { transform: scale(1); }
```

## Prompt guidance

Build a Finder-style drag collection. Press on any item in a row and every item converges into a single fanned pile that follows the pointer, each card rotated a few degrees and stacked with a slight z-offset, with a count badge popping in beside them. Track the pointer with a short transition while dragging, and on release let all items spring back to their original slots on a stagger. Never reflow the row — the movement is transform-only.
