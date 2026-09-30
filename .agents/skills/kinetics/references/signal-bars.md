# Signal Bars

Bars light up in sequence while connecting

Keywords: wifi, connection, signal strength, network, connectivity, bars, cellular, reception, online, status, connecting, phone signal

## CSS

```css
.bar::after {
  background: #4cd08a;
  animation: fill 2.4s ease-in-out infinite;
}
.bar:nth-child(2)::after { animation-delay: 0.18s; }
.bar:nth-child(3)::after { animation-delay: 0.36s; }
.bar:nth-child(4)::after { animation-delay: 0.54s; }
@keyframes fill {
  0% { opacity: 0; } 12%,70% { opacity: 1; } 82%,100% { opacity: 0; }
}
```

## React

```jsx
function SignalBars() {
  const heights = [32, 55, 78, 100];
  return (
    <div className="signal">
      {heights.map((h, i) => (
        <span
          key={i}
          className="bar"
          style={{ height: `${h}%`, animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  );
}
```

## Prompt guidance

Build a "connecting" signal-strength indicator: four bars of increasing height. Each has a green fill overlay that animates opacity 0→1→0 on an infinite 2.4s loop, with the four bars staggered by ~0.18s so they light up left-to-right in sequence, hold briefly, then clear and repeat — like a device searching for signal.
