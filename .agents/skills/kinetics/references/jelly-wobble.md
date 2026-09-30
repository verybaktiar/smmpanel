# Jelly Wobble

Squash-and-stretch settle on hover

Keywords: jelly, wobble, squash, elastic, gelatin, playful, hover, bounce, cartoon, springy, soft body, fun

## CSS

```css
.jelly:hover {
  animation: wobble 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes wobble {
  0%   { transform: scale(1, 1); }
  25%  { transform: scale(1.14, 0.86); }
  45%  { transform: scale(0.9, 1.1); }
  65%  { transform: scale(1.05, 0.95); }
  100% { transform: scale(1, 1); }
}
```

## React

```jsx
function Jelly({ children }) {
  const [k, setK] = useState(0);
  return (
    <div
      key={k}
      onMouseEnter={() => setK((x) => x + 1)}
      className="jelly"
    >
      {children}
    </div>
  );
  // re-keying restarts the wobble keyframes on each enter
}
```

## Prompt guidance

Give an element a jelly squash-and-stretch wobble on hover. Run a single ~0.8s keyframe animation with an overshooting spring easing that alternates non-uniform scales: stretch wide and short (1.14, 0.86), then tall and narrow (0.9, 1.1), then progressively smaller corrections until it settles back to scale(1,1). The conservation-of-volume feel (one axis grows as the other shrinks) is what sells it.
