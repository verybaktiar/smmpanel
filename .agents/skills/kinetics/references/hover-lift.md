# Hover Lift

Surface rises with a soft cast shadow

Keywords: elevation, raise, shadow, card hover, lift, float, material, depth, affordance, interactive, tile, subtle

## CSS

```css
.card {
  transition:
    transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.card:hover {
  transform: translateY(-10px);
  box-shadow: 0 18px 40px -12px rgba(0, 0, 0, 0.7);
}
```

## React

```jsx
function LiftCard({ children }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        transform: hover ? 'translateY(-10px)' : 'translateY(0)',
        boxShadow: hover ? '0 18px 40px -12px rgba(0,0,0,0.7)' : 'none',
        transition: 'all 0.5s cubic-bezier(0.34,1.56,0.64,1)',
      }}
    >
      {children}
    </div>
  );
}
```

## Prompt guidance

Make a card that lifts on hover: translateY(-10px) with a soft, large cast shadow (0 18px 40px -12px rgba(0,0,0,0.7)). Animate both transform and box-shadow together over ~0.5s with an overshooting spring cubic-bezier(0.34, 1.56, 0.64, 1) so it gently bobs as it settles up and back down.
