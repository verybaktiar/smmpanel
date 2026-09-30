# Gradient Border Morph

A rotating conic gradient creates a living border — pure CSS

Keywords: animated border, conic gradient, rotating, frame, living border, colorful, card, highlight, rainbow, spin, outline, accent

## CSS

```css
.gradborder {
  position: relative;
  padding: 2px;
  overflow: hidden;
  border-radius: 14px;
  background: #2A2A2E;
}
.gradborder::before {
  content: '';
  position: absolute;
  inset: -50%;
  background: conic-gradient(
    from 0deg,
    #FF8A00, #5B8DEF, #4CD08A, #FF5C5C, #FF8A00
  );
  animation: gradborder-spin 4s linear infinite;
}
@keyframes gradborder-spin {
  to { transform: rotate(1turn); }
}
.gradborder-inner {
  position: relative;
  z-index: 1;
  background: #232326;
  border-radius: 12px;
}
```

## React

```jsx
function GradientBorder({ children }) {
  return (
    <div className="gradborder">
      <div className="gradborder-inner">
        {children}
      </div>
    </div>
  );
}
```

## Prompt guidance

Build a card with an animated gradient border, pure CSS. Give the card 2px padding and overflow:hidden; place a pseudo-element behind the inner content that is a conic-gradient cycling through 4 accent colors and is 200% the card size. Rotate it 360 degrees on a 4s linear infinite loop so the colors flow around the border. The inner content sits on top with a solid background and slightly smaller border-radius to reveal the 2px gradient ring.
