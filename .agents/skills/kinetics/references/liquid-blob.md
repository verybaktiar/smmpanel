# Liquid Blob

An organic shape endlessly morphs its border-radius — pure CSS

Keywords: blob, organic, morph, border radius, lava lamp, fluid, shape, amoeba, background element, abstract, gooey, living

## CSS

```css
.blob {
  background: linear-gradient(135deg, #FF8A00, #B36200);
  border-radius: 42% 58% 70% 30% / 45% 45% 55% 55%;
  animation: blob-morph 8s ease-in-out infinite;
}
@keyframes blob-morph {
  0%, 100% { border-radius: 42% 58% 70% 30% / 45% 45% 55% 55%; }
  33%      { border-radius: 70% 30% 46% 54% / 30% 60% 40% 70%; }
  66%      { border-radius: 34% 66% 60% 40% / 65% 35% 65% 35%; }
}
```

## React

```jsx
function LiquidBlob({ children }) {
  // Pure CSS: an 8-value border-radius is keyframed between
  // three asymmetric shapes on an ease-in-out infinite loop,
  // so the silhouette wobbles like a drop of liquid.
  return (
    <div className="blob">
      {children}
    </div>
  );
}
/* pair with the .blob @keyframes in the CSS tab */
```

## Prompt guidance

Build an organic "liquid" blob that endlessly morphs its outline, pure CSS. Use the 8-value border-radius syntax (horizontal / vertical radii) and animate it between three asymmetric sets of values on an ease-in-out infinite loop (~8s) so the gradient-filled shape wobbles and flows like a drop of liquid.
