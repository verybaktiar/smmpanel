# Orbit Spinner

A dual-arc ring rotates on a tight infinite loop — pure CSS

Keywords: loading spinner, loader, wait, busy, fetch, circular, ring, activity indicator, async, buffering, processing, infinite

## CSS

```css
.spinner {
  width: 44px; height: 44px;
  border-radius: 50%;
  border: 4px solid #232326;
  border-top-color: #FF8A00;
  border-right-color: #FF8A00;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(1turn); } }
```

## React

```jsx
function Spinner() {
  // Pure CSS: a transparent ring with two adjacent borders
  // tinted the accent color, rotated on a fast linear loop.
  return <div className="spinner" />;
}
/* pair with the .spinner rule + spin keyframe in the CSS tab */
```

## Prompt guidance

Build a circular loading spinner, pure CSS. Make a round element with a thick neutral border, tint two adjacent sides (top and right) the accent color to form an arc, and rotate it 1turn on a linear infinite loop (~0.8s).
