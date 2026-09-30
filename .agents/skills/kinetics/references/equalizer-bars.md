# Equalizer Bars

Phase-offset bars pump like an audio meter — pure CSS

Keywords: audio, music, equalizer, visualizer, sound, bars, playing, spotify, volume, spectrum, dj, beat

## CSS

```css
.eq span {
  width: 6px; height: 100%;
  background: #FF8A00; border-radius: 3px;
  transform-origin: bottom;
  animation: eq-pump 1s ease-in-out infinite;
}
.eq span:nth-child(2) { animation-delay: -0.8s; }
.eq span:nth-child(3) { animation-delay: -0.4s; }
.eq span:nth-child(4) { animation-delay: -0.6s; }
.eq span:nth-child(5) { animation-delay: -0.2s; }
@keyframes eq-pump {
  0%, 100% { transform: scaleY(0.25); }
  50%      { transform: scaleY(1); }
}
```

## React

```jsx
function Equalizer({ count = 5 }) {
  const delays = [0, -0.8, -0.4, -0.6, -0.2];
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end', height: 48 }}>
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} style={{
          width: 6, height: '100%', background: '#FF8A00', borderRadius: 3,
          transformOrigin: 'bottom',
          animation: 'eq-pump 1s ease-in-out infinite',
          animationDelay: `${delays[i % delays.length]}s`,
        }} />
      ))}
    </div>
  );
}
```

## Prompt guidance

Build an audio-equalizer animation of vertical bars, pure CSS. Give each bar a bottom transform-origin and animate scaleY between ~0.25 and 1 on an ease-in-out infinite loop (~1s); offset each bar with a different negative animation-delay so they pump out of phase like a sound meter.
