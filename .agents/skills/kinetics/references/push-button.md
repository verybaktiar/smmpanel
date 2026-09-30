# Push Button

A tactile depress with a real bottom edge — pure CSS

Keywords: 3d button, press, tactile, depth, keyboard, mechanical, click, physical, skeuomorphic, shadow, depress, arcade

## CSS

```css
.push-btn {
  border-radius: 12px;
  background: #FF8A00;
  color: #0E0E10;
  box-shadow: 0 6px 0 #B36200;
  transition: transform 0.06s ease, box-shadow 0.06s ease;
}
.push-btn:active {
  transform: translateY(5px);
  box-shadow: 0 1px 0 #B36200;
}
```

## React

```jsx
function PushButton({ children }) {
  // Pure CSS: the bottom box-shadow is the button's "edge".
  // :active drops it down and shrinks the edge so it reads
  // as a physical press — pair this with the .push-btn rule.
  return (
    <button className="push-btn">
      {children}
    </button>
  );
}
```

## Prompt guidance

Build a button that physically depresses when pressed, pure CSS. Give it a solid bottom box-shadow to act as a 3D edge; on :active translateY it down by the edge height and shrink the shadow to ~1px over ~0.06s so it reads as a tactile push.
