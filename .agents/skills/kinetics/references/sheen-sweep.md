# Sheen Sweep

Specular highlight glides across on hover

Keywords: sheen, specular, gloss, highlight, hover, light pass, metal, reflective, polish, shine, glass, streak

## CSS

```css
.surface { position: relative; overflow: hidden; }
.surface::after {
  content: "";
  position: absolute;
  top: 0; left: -60%;
  width: 50%; height: 100%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.18), transparent);
  transform: skewX(-18deg);
  transition: left 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}
.surface:hover::after { left: 120%; }
```

## React

```jsx
function Sheen({ children }) {
  return <div className="surface">{children}</div>;
  // ::after is a skewed translucent stripe;
  // :hover slides it from left: -60% to 120%
  // over 0.7s with a glide curve.
}
```

## Prompt guidance

Add a moving specular sheen to a surface on hover. Use an ::after pseudo-element: a ~50%-wide vertical stripe with a translucent white linear-gradient, skewed by -18deg, positioned off-screen left (left: -60%). On :hover transition its left to 120% over ~0.7s with a glide cubic-bezier(0.16, 1, 0.3, 1) so a glint sweeps across. Keep the parent overflow hidden.
