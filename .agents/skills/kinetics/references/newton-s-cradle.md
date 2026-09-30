# Newton's Cradle

End pendulums trade momentum across the row

## CSS

```css
.ball { transform-origin: top center; }
.ball.first { animation: swing-l 1.2s ease-in-out infinite; }
.ball.last  { animation: swing-r 1.2s ease-in-out infinite; }
/* only the outer balls move; the middle three stay put,
   reading as transferred momentum */
@keyframes swing-l {
  0%, 50%, 100% { transform: rotate(0); }
  25%           { transform: rotate(48deg); }
}
@keyframes swing-r {
  0%, 50%, 100% { transform: rotate(0); }
  75%           { transform: rotate(-48deg); }
}
```

## React

```jsx
function NewtonsCradle() {
  return (
    <div style={{ display: 'flex' }}>
      {['first', '', '', '', 'last'].map((c, i) => (
        <span key={i} className={`ball ${c}`} />
      ))}
    </div>
  );
}
/* @keyframes swing-l { 0%,50%,100% { transform: rotate(0); }
                        25% { transform: rotate(48deg); } }
   @keyframes swing-r { 0%,50%,100% { transform: rotate(0); }
                        75% { transform: rotate(-48deg); } } */
```

## Prompt guidance

Build a Newton's cradle, pure CSS: a row of five balls hanging from a bar. Give each ball a top-center transform-origin. Animate only the leftmost ball swinging out and back (rotate to ~48deg in the first quarter) and the rightmost ball swinging out and back (rotate to ~-48deg in the third quarter) on the same ease-in-out infinite loop (~1.2s), so the impact reads as momentum passing through the three still middle balls.
