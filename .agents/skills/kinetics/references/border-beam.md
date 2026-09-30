# Border Beam

A light sweeps the border via a masked conic gradient

Keywords: border animation, glowing border, light sweep, conic, running light, highlight, frame, tracer, neon edge, card accent, orbit, premium

## CSS

```css
.beam { position: relative; padding: 1.5px; overflow: hidden; border-radius: 14px; }
.beam::before {
  content: ''; position: absolute; inset: -50%;
  background: conic-gradient(from 0deg, transparent 0 72%, #FF8A00 84%, #EDE9E0 90%, transparent 96%);
  animation: spin 3s linear infinite;
}
.beam-inner { position: relative; border-radius: 12.5px; background: #232326; }
@keyframes spin { to { transform: rotate(1turn); } }
```

## React

```jsx
function BorderBeam({ children }) {
  // Pure CSS: a spinning conic gradient sits behind an inset
  // inner panel, so only the sliver at the edge shows as a beam.
  return (
    <div className="beam">
      <div className="beam-inner">{children}</div>
    </div>
  );
}
```

## Prompt guidance

Build a card with a light beam traveling around its border, pure CSS. Put a spinning conic-gradient (mostly transparent with one bright arc) on a ::before behind an inset inner panel so only the sliver at the edge shows; rotate it 1turn over ~3s linear infinite.
