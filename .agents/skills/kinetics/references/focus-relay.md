# Focus Relay

A shared focus ring leaps between fields with a spring morph

Keywords: focus ring, shared outline, morph, leap, form fields, input focus, relay, linear, apple focus, keyboard, active field, outline

## CSS

```css
.focus-ring {
  position: absolute;
  width: var(--w); height: var(--h);
  translate: var(--x) var(--y);
  border: 1.5px solid var(--amber);
  transition: translate .48s cubic-bezier(.34,1.56,.64,1),
              width .48s cubic-bezier(.34,1.56,.64,1),
              height .48s cubic-bezier(.34,1.56,.64,1);
  pointer-events: none;
}
```

## Prompt guidance

Build a shared focus ring that is a single absolutely positioned element, not a per-field outline. Measure the active field and write --x --y --w --h onto the host. The ring springs to the new box with a cubic-bezier overshoot so the leap reads as one object relocating, not two outlines fading. Hover and keyboard focus must share the same path. Never reflow the fields.
