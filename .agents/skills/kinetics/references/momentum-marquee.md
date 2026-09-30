# Momentum Marquee

Infinite scroll that pauses smoothly on hover

Keywords: ticker, scroll, infinite, logos, news, banner, carousel, loop, pause on hover, brands, strip, headline

## CSS

```css
.marquee-track {
  display: flex;
  width: max-content;
  animation: marquee-scroll 14s linear infinite;
}
.marquee-zone:hover .marquee-track {
  animation-play-state: paused;
}
@keyframes marquee-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
/* Duplicate the chip list once so -50% loops seamlessly */
```

## React

```jsx
function Marquee({ items }) {
  const [paused, setPaused] = useState(false);
  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{ overflow: 'hidden' }}
    >
      <div style={{
        display: 'flex',
        width: 'max-content',
        animation: 'marquee-scroll 14s linear infinite',
        animationPlayState: paused ? 'paused' : 'running',
      }}>
        {[...items, ...items].map((item, i) => (
          <span key={i}>{item}</span>
        ))}
      </div>
    </div>
  );
}
```

## Prompt guidance

Build an infinite horizontal marquee of chips that pauses smoothly on hover. Duplicate the chip list and animate the track translateX from 0 to -50% with a linear infinite keyframe so it loops seamlessly; set animation-play-state: paused on hover and add edge mask-image fades.
