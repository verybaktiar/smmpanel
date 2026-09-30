# Gradient Shimmer Text

A light band flows through clipped gradient text — pure CSS

Keywords: text gradient, shimmer, heading, metallic text, flowing, clip text, headline, premium, gold, sheen, sparkle, brand

## CSS

```css
.shimmer-text {
  background: linear-gradient(100deg,
    #6E6C68 30%, #FF8A00 50%, #6E6C68 70%);
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: shimmer 3s linear infinite;
}
@keyframes shimmer {
  to { background-position: -200% center; }
}
```

## React

```jsx
function ShimmerText({ children }) {
  // Pure CSS: a wide gradient is clipped to the text and its
  // background-position scrolls, so a highlight sweeps across.
  return <span className="shimmer-text">{children}</span>;
}
/* pair with the .shimmer-text rule + shimmer keyframe */
```

## Prompt guidance

Build text with a highlight that endlessly sweeps through it, pure CSS. Fill the text with a wide linear-gradient (dim, bright accent in the middle, dim), set background-size 200%, clip the background to the text (color: transparent + background-clip: text), and animate background-position on a linear infinite loop (~3s).
