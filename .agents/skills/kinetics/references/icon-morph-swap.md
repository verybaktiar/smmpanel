# Icon Morph Swap

Outgoing icon blurs and rotates out, incoming settles in

Keywords: icon transition, toggle icon, crossfade, swap, menu to x, play pause, state change, rotate, blur, morph, replace, switch

## CSS

```css
.morph-icon svg {
  position: absolute;
  transition: opacity 0.3s, filter 0.3s, transform 0.3s;
}
.morph-icon svg.hide {
  opacity: 0;
  filter: blur(6px);
  transform: scale(0.7) rotate(-20deg);
}
.morph-icon svg.show {
  opacity: 1;
  filter: blur(0);
  transform: scale(1) rotate(0deg);
}
```

## React

```jsx
function MorphIcon({ IconA, IconB }) {
  const [showA, setShowA] = useState(true);
  const style = (visible) => ({
    position: 'absolute',
    opacity: visible ? 1 : 0,
    filter: visible ? 'blur(0)' : 'blur(6px)',
    transform: visible ? 'scale(1) rotate(0deg)' : 'scale(0.7) rotate(-20deg)',
    transition: 'opacity .3s, filter .3s, transform .3s',
  });
  return (
    <div onClick={() => setShowA(!showA)} style={{ position: 'relative', width: 28, height: 28 }}>
      <IconA style={style(showA)} />
      <IconB style={style(!showA)} />
    </div>
  );
}
```

## Prompt guidance

Build an icon that morphs between two glyphs on click. Crossfade the two SVGs while the outgoing one blurs and scales/rotates out (blur(6px), scale(0.7), rotate(-20deg)) and the incoming one settles in, all over ~0.3s with a spring transform curve.
