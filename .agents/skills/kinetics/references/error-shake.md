# Error Shake

Decaying horizontal oscillation, retriggerable

Keywords: validation error, wrong password, invalid input, form error, shake, wiggle, reject, deny, headshake, login failed, feedback, email

## CSS

```css
@keyframes shake-x {
  10%, 90% { transform: translateX(-1px); }
  20%, 80% { transform: translateX(2px); }
  30%, 50%, 70% { transform: translateX(-4px); }
  40%, 60% { transform: translateX(4px); }
}
.input.error {
  border-color: #FF5C5C;
  animation: shake-x 0.45s cubic-bezier(.36,.07,.19,.97) both;
}
```

## React

```jsx
function ShakeInput() {
  const [error, setError] = useState(false);

  const submit = () => {
    setError(false);
    requestAnimationFrame(() => setError(true));
    setTimeout(() => setError(false), 500);
  };

  return (
    <input
      onBlur={submit}
      className={error ? 'error' : ''}
      style={{ animation: error ? 'shake-x .45s cubic-bezier(.36,.07,.19,.97) both' : 'none' }}
    />
  );
}
```

## Prompt guidance

Build an input that shakes horizontally to signal an error and can be retriggered. Apply a keyframe oscillating translateX with decreasing, settling offsets over ~0.45s using cubic-bezier(0.36,0.07,0.19,0.97); turn the border red and reveal a message. Restart cleanly by removing and re-adding the class via a reflow.
