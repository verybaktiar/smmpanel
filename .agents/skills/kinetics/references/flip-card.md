# Flip Card

Two faces share a 3D space and rotate on click

Keywords: card flip, two sided, reveal back, 3d rotate, memory game, pricing, profile, front back, mirror, playing card, turn, perspective

## CSS

```css
.card { transform-style: preserve-3d; transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1); }
.card.flipped { transform: rotateY(180deg); }
.face { position: absolute; inset: 0; backface-visibility: hidden; }
.face.back { transform: rotateY(180deg); }
```

## React

```jsx
function FlipCard({ front, back }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div style={{ perspective: 800 }} onClick={() => setFlipped(f => !f)}>
      <div className={flipped ? 'card flipped' : 'card'}>
        <div className="face front">{front}</div>
        <div className="face back">{back}</div>
      </div>
    </div>
  );
}
```

## Prompt guidance

Build a card that flips in 3D between a front and back face on click. Set perspective on the wrapper, transform-style: preserve-3d and a spring transition on the inner element; rotateY(180deg) when flipped. Each face uses backface-visibility: hidden and the back is pre-rotated 180deg.
