# Keycap Press

Mechanical keycap depresses on its shadow

Keywords: keyboard, key, shortcut, mechanical, typing, hotkey, kbd, press, tactile, cherry, input, hint

## CSS

```css
.key {
  box-shadow: 0 7px 0 0 #0c0c0e, 0 10px 16px -4px rgba(0,0,0,0.6);
  transition: transform 0.09s ease-out, box-shadow 0.09s ease-out;
}
.key:active {
  transform: translateY(6px);
  box-shadow: 0 1px 0 0 #0c0c0e, 0 2px 6px -2px rgba(0,0,0,0.6);
}
```

## React

```jsx
function Keycap({ label }) {
  return <button className="key">{label}</button>;
  // The :active state collapses the 7px bottom shadow
  // and pushes the cap down 6px — a 1:1 travel illusion.
}
```

## Prompt guidance

Style a button as a 3D mechanical keycap. Give it a solid offset box-shadow (0 7px 0 a dark colour) to act as the key's side wall, plus a soft ambient shadow below. On :active, translate the cap down by the same 6–7px and shrink the side shadow to ~1px so it reads as physically bottoming out. Use a fast ~0.09s ease-out so the press feels crisp.
