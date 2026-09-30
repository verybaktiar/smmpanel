# Ripple Feedback

Radial fade-out anchored to the exact click point

Keywords: click, tap, material, touch, wave, button press, feedback, radial, splash, android, pulse, press

## CSS

```css
.ripple-btn {
  position: relative;
  overflow: hidden;
}
.ripple {
  position: absolute;
  border-radius: 50%;
  background: rgba(255,138,0,0.4);
  transform: scale(0);
  animation: ripple-out 0.6s ease-out;
}
@keyframes ripple-out {
  to { transform: scale(3); opacity: 0; }
}
```

## React

```jsx
function RippleButton({ children }) {
  const [ripples, setRipples] = useState([]);

  const addRipple = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const id = Date.now();
    setRipples(prev => [...prev, {
      id, size,
      x: e.clientX - r.left - size / 2,
      y: e.clientY - r.top - size / 2,
    }]);
    setTimeout(() => setRipples(prev => prev.filter(rp => rp.id !== id)), 650);
  };

  return (
    <button onClick={addRipple} style={{ position: 'relative', overflow: 'hidden' }}>
      {children}
      {ripples.map(rp => (
        <span key={rp.id} className="ripple" style={{
          width: rp.size, height: rp.size, left: rp.x, top: rp.y,
        }} />
      ))}
    </button>
  );
}
```

## Prompt guidance

Build a button with a material-style ripple that starts at the exact click point. On click, spawn an absolutely-positioned circle at the pointer coordinates inside an overflow-hidden button, animate it from scale(0) to scale(2.6) while fading out over ~0.6s, then remove it.
