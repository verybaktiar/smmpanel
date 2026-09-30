# Float Bob

A card hovers and bobs with a shadow that breathes beneath —
                  pure CSS

Keywords: float, hover, levitate, bob, idle, shadow, drift, gentle, card, ambient, buoyant, suspended

## CSS

```css
.float-card {
  animation: float-bob 4s ease-in-out infinite;
}
@keyframes float-bob {
  0%, 100% {
    transform: translateY(0);
    box-shadow: 0 10px 20px -8px rgba(0,0,0,0.55);
  }
  50% {
    transform: translateY(-12px);
    box-shadow: 0 26px 30px -10px rgba(0,0,0,0.45);
  }
}
```

## React

```jsx
function FloatCard({ children }) {
  // Pure CSS: an ease-in-out infinite keyframe lifts the card
  // and softens its shadow at the top of the bob, so it reads
  // as hovering above the surface.
  return (
    <div className="float-card">
      {children}
    </div>
  );
}
/* pair with the .float-card @keyframes in the CSS tab */
```

## Prompt guidance

Build a card that gently floats and bobs forever, pure CSS. Use an ease-in-out infinite keyframe (~4s) that translates it up ~12px and back; at the top of the bob raise and soften the drop shadow (larger blur, more vertical offset) so it convincingly hovers above the surface.
