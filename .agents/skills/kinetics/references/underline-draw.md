# Underline Draw

Scale-transform underline, draws left to right on hover

Keywords: link hover, underline, nav, text decoration, draw, left to right, menu item, anchor, highlight, scale, hover effect, line

## CSS

```css
.underline-link {
  position: relative;
  text-decoration: none;
}
.underline-link::after {
  content: '';
  position: absolute;
  left: 0; bottom: -4px;
  width: 100%; height: 2px;
  background: currentColor;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.4s cubic-bezier(0.65, 0, 0.35, 1);
}
.underline-link:hover::after {
  transform: scaleX(1);
}
```

## React

```jsx
function DrawUnderline({ children, href }) {
  return (
    <a href={href} style={{ position: 'relative', textDecoration: 'none' }}
       className="draw-underline-link">
      {children}
    </a>
  );
}
/* :hover state still needs a real CSS rule —
   pair this component with the .draw-underline-link
   class above since inline styles can't hover. */
```

## Prompt guidance

Build a link whose underline draws in from left to right on hover. Use an ::after bar with transform: scaleX(0) and transform-origin: left, transitioning to scaleX(1) on hover with cubic-bezier(0.65,0,0.35,1) over ~0.4s. Pure CSS.
