# Skeleton Sweep

Gradient position animates across a fixed-size placeholder

Keywords: skeleton, placeholder, shimmer, loading, gradient, ghost, sweep, content, lazy, perceived performance, gray, lines

## CSS

```css
.skel-line {
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, #1A1A1D 25%, #34343a 50%, #1A1A1D 75%);
  background-size: 200% 100%;
  animation: shimmer-sweep 1.4s ease-in-out infinite;
}
@keyframes shimmer-sweep {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

## React

```jsx
function SkeletonLine({ width = '100%' }) {
  return (
    <div style={{
      height: 12, width, borderRadius: 6,
      background: 'linear-gradient(90deg, #1A1A1D 25%, #34343a 50%, #1A1A1D 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer-sweep 1.4s ease-in-out infinite',
    }} />
  );
}
```

## Prompt guidance

Build skeleton placeholder lines with a shimmer sweeping across them. Use a 3-stop linear-gradient background sized 200% and animate background-position from 200% to -200% with an ease-in-out infinite loop (~1.4s).
