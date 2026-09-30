# Radar Pulse

Concentric rings expand and fade like sonar

Keywords: radar, sonar, ping, scanning, location, map marker, expanding rings, detect, sweep, live location, beacon, gps

## CSS

```css
.wave {
  position: absolute; inset: 0; margin: auto;
  width: 24px; height: 24px; border-radius: 50%;
  border: 2px solid var(--amber);
  animation: ping 2.4s cubic-bezier(0, 0.4, 0.2, 1) infinite;
}
.wave:nth-child(3) { animation-delay: 0.8s; }
.wave:nth-child(4) { animation-delay: 1.6s; }
@keyframes ping {
  0%   { transform: scale(0.4); opacity: 0.9; }
  100% { transform: scale(4.2); opacity: 0; }
}
```

## React

```jsx
function RadarPulse() {
  return (
    <div style={{ position: 'relative', width: 120, height: 120 }}>
      <span className="core" />
      {[0, 0.8, 1.6].map((d, i) => (
        <span
          key={i}
          className="wave"
          style={{
            animation: 'ping 2.4s cubic-bezier(0,.4,.2,1) infinite',
            animationDelay: `${d}s`,
          }}
        />
      ))}
    </div>
  );
}
/* @keyframes ping {
     0%   { transform: scale(.4); opacity: .9; }
     100% { transform: scale(4.2); opacity: 0; }
   } */
```

## Prompt guidance

Build a sonar / radar pulse with a solid center dot and several rings that expand outward and fade, pure CSS. Stack centered ring elements and animate each from scale(0.4)/opacity 0.9 to scale(4.2)/opacity 0 on an infinite loop (~2.4s, ease-out); stagger their animation-delay evenly across the duration so a new ripple launches before the previous one finishes.
