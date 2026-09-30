# Momentum Picker

Wheel input rolls a weighted selector into its next detent

Keywords: wheel, picker, detent, vertical select, weighted, snap, density, scroll, options, dial, input, cylindrical

## CSS

```css
.picker-track {
  transform: translateY(calc(var(--i) * -38px));
  transition: transform .58s cubic-bezier(.34,1.56,.64,1);
}
.picker-track button:not(.active) { opacity: .32; transform: scale(.88); }
```

## Prompt guidance

Create a tactile vertical picker with three density options. Mouse-wheel, arrow keys, and taps should move one detent at a time; the list overshoots slightly while the focused row stays aligned behind a fixed highlight. Dim and scale peripheral rows to imply cylindrical depth.
