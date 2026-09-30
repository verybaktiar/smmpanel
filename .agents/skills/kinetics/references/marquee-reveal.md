# Marquee Reveal

Cards scroll horizontally, pausing on hover — pure CSS

Keywords: carousel, scroll, cards, horizontal, showcase, testimonials, gallery, loop, auto scroll, pause, strip, slider

## CSS

```css
.reveal-track {
  display: flex;
  gap: 12px;
  width: max-content;
  animation: reveal-scroll 6s linear infinite;
}
.reveal-zone:hover .reveal-track {
  animation-play-state: paused;
}
@keyframes reveal-scroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
```

## React

```jsx
function MarqueeReveal({ items }) {
  return (
    <div style={{ overflow: 'hidden' }}>
      <div
        className="reveal-track"
        style={{
          display: 'flex',
          gap: 12,
          width: 'max-content',
          animation: 'reveal-scroll 6s linear infinite',
        }}
      >
        {[...items, ...items].map((item, i) => (
          <div key={i} className="reveal-card">{item}</div>
        ))}
      </div>
    </div>
  );
}
```

## Prompt guidance

Build a horizontal marquee of small cards that scrolls infinitely, pure CSS. Duplicate the card list so the track is 2x wide; animate translateX from 0 to -50% on a 6s linear infinite loop so the second copy seamlessly takes over. Pause the animation on hover. Mask the edges with a fade gradient so cards appear and disappear smoothly.
