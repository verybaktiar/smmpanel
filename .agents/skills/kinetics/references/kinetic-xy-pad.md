# Kinetic XY Pad

A two-axis puck trails the pointer, then springs home

Keywords: xy pad, two axis, pointer, drag, joystick, coordinates, position, spring home, puck, spatial input, control surface, touch

## CSS

```css
.xy-puck {
  translate: calc(var(--x) * 1px) calc(var(--y) * 1px);
  transition: translate .52s cubic-bezier(.34,1.56,.64,1);
}
.xy-pad.dragging .xy-puck { transition-duration: 70ms; }
```

## Prompt guidance

Create a compact two-axis input pad with a luminous puck. While dragging, map pointer coordinates to clamped X and Y values and move the puck with a short trailing transition. On release, spring it back to dead centre and reset a monospaced coordinate readout.
