# Neon Glow Pulse

Text and outline breathe a soft neon halo — pure CSS

Keywords: neon, glow, sign, cyberpunk, halo, pulse, night, bar sign, retro, luminous, text glow, electric

## CSS

```css
.neon {
  color: #FF8A00;
  border: 1px solid #FF8A00;
  border-radius: 100px;
  animation: neon-pulse 2s ease-in-out infinite;
}
@keyframes neon-pulse {
  0%, 100% {
    text-shadow: 0 0 4px #FF8A00;
    box-shadow: 0 0 6px -1px #FF8A00, inset 0 0 6px -2px #FF8A00;
  }
  50% {
    text-shadow: 0 0 12px #FF8A00, 0 0 22px #FF8A00;
    box-shadow: 0 0 18px 0 #FF8A00, inset 0 0 12px -2px #FF8A00;
  }
}
```

## React

```jsx
function NeonTag({ children }) {
  // Pure CSS: an ease-in-out infinite keyframe grows and
  // shrinks the text-shadow and box-shadow halo in sync.
  return <span className="neon">{children}</span>;
}
/* pair with the .neon rule + neon-pulse keyframe */
```

## Prompt guidance

Build a neon-style pill whose glow pulses, pure CSS. Color the text and a thin border the accent, then animate text-shadow and box-shadow (plus a faint inset) between a dim and a bright, wider blur on an ease-in-out infinite loop (~2s) so the halo breathes.
