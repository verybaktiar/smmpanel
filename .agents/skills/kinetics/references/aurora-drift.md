# Aurora Drift

Soft blurred colour fields drift and rotate forever

Keywords: gradient background, ambient, blur, northern lights, mesh gradient, hero background, soft, dreamy, color fields, atmosphere, calm, backdrop

## CSS

```css
.aurora::before {
  content: ''; position: absolute; inset: -40%;
  background:
    radial-gradient(40% 50% at 30% 38%, #FF8A00aa, transparent 60%),
    radial-gradient(45% 55% at 72% 62%, #5B8DEFaa, transparent 60%),
    radial-gradient(40% 50% at 50% 82%, #4CD08A88, transparent 60%);
  filter: blur(16px);
  animation: drift 12s ease-in-out infinite alternate;
}
@keyframes drift {
  0%   { transform: translate(-6%, -4%) rotate(0deg) scale(1.1); }
  100% { transform: translate(6%, 4%) rotate(8deg) scale(1.3); }
}
```

## React

```jsx
function AuroraDrift({ children }) {
  // CSS-only: three blurred radial gradients on a ::before
  // layer, drifting on an infinite alternating keyframe.
  return (
    <div className="aurora">
      <span>{children}</span>
    </div>
  );
}
```

## Prompt guidance

Build a panel with soft, blurred aurora-like color fields that drift forever. Layer a few radial-gradients (different accent colors and positions) on a ::before, blur it ~16px, and animate its transform (translate, slight rotate, scale) on an ease-in-out alternating infinite loop (~12s).
