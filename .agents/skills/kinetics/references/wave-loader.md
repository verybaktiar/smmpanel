# Wave Loader

Three dots in a phase-offset vertical bounce

Keywords: loading dots, bounce, loader, wait, three dots, pulse, wave, busy, typing, indicator, sequence, rhythm

## CSS

```css
.dots span {
  width: 10px; height: 10px;
  border-radius: 50%;
  animation: dot-wave 1.1s ease-in-out infinite;
}
.dots span:nth-child(2) { animation-delay: 0.12s; }
.dots span:nth-child(3) { animation-delay: 0.24s; }
.dots span:nth-child(4) { animation-delay: 0.36s; }
@keyframes dot-wave {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
  30% { transform: translateY(-10px); opacity: 1; }
}
```

## React

```jsx
function WaveLoader({ count = 4 }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 10, height: 10, borderRadius: '50%',
            background: '#FF8A00',
            animation: 'dot-wave 1.1s ease-in-out infinite',
            animationDelay: `${i * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}
```

## Prompt guidance

Build a row of dots that bounce in a phase-offset wave. Animate each dot's translateY up and back with an ease-in-out infinite keyframe (~1.1s), offset each dot's animation-delay by ~0.12s, and dip opacity at the bottom of the bounce.
