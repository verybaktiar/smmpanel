# Shimmer Skeleton

Sweeping highlight over placeholder lines

Keywords: skeleton, placeholder, loading, shimmer, ghost, content loading, lines, sweep, lazy, wait, gray boxes, perceived performance

## CSS

```css
.line {
  background: linear-gradient(90deg, #232326 0%, #2a2a2e 20%, #232326 40%);
  background-size: 280% 100%;
  animation: shimmer 1.5s linear infinite;
}
@keyframes shimmer {
  0%   { background-position: 140% 0; }
  100% { background-position: -140% 0; }
}
```

## React

```jsx
function Skeleton({ lines = 3 }) {
  return (
    <div className="skeleton">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="line" />
      ))}
    </div>
  );
}
```

## Prompt guidance

Build a loading skeleton of stacked rounded bars. Give each bar a wide linear-gradient (muted, lighter highlight, muted) sized to ~280% width and animate background-position from 140% to -140% on a 1.5s linear infinite loop so a soft highlight sweeps across. Make the last line shorter (~60%) to imply a paragraph.
