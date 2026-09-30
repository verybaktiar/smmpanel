# Shine Sweep

A diagonal light streak sweeps across on hover — pure CSS

Keywords: shine, gloss, highlight, sweep, button hover, metallic, streak, polish, glimmer, cta, attention, light

## CSS

```css
.shine { position: relative; overflow: hidden; }
.shine::before {
  content: '';
  position: absolute; top: 0; left: -120%;
  width: 60%; height: 100%;
  transform: skewX(-20deg);
  background: linear-gradient(90deg, transparent,
    rgba(237,233,224,0.25), transparent);
}
.shine:hover::before {
  left: 120%;
  transition: left 0.9s cubic-bezier(0.65, 0, 0.35, 1);
}
```

## React

```jsx
function ShineCard({ children }) {
  // Pure CSS: a skewed translucent gradient sits off the left
  // edge and slides across on :hover via a left transition.
  return (
    <div className="shine">
      {children}
    </div>
  );
}
/* pair with the .shine ::before rule in the CSS tab */
```

## Prompt guidance

Build a surface with a diagonal light streak that sweeps across on hover, pure CSS. Inside an overflow-hidden element, place a skewed (-20deg) translucent linear-gradient ::before parked off the left edge; on :hover transition its left from -120% to 120% over ~0.9s so the highlight glides across once.
