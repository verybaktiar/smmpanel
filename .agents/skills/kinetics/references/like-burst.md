# Like Burst

Toggles, pops the heart, and emits a radial particle ring

Keywords: heart, favorite, love, reaction, social, twitter, instagram, particles, celebrate, upvote, save, emoji

## CSS

```css
.heart { transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.like-btn.pop .heart { transform: scale(1.35); }
.like-btn.liked .heart { fill: #FF8A00; stroke: #FF8A00; }

.particle { animation: fly 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
@keyframes fly { to { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; } }
/* JS spawns 8 particles on a circle each time it's liked. */
```

## React

```jsx
function LikeButton({ start = 128 }) {
  const [liked, setLiked] = useState(false);
  const [bits, setBits] = useState([]);

  const toggle = () => {
    const next = !liked;
    setLiked(next);
    if (next) {
      setBits(Array.from({ length: 8 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 8, d = 28;
        return { id: Date.now() + i, tx: Math.cos(a) * d, ty: Math.sin(a) * d };
      }));
      setTimeout(() => setBits([]), 600);
    }
  };

  return (
    <button className={liked ? 'like-btn liked pop' : 'like-btn'} onClick={toggle}>
      <Heart /> <span>{start + (liked ? 1 : 0)}</span>
      {bits.map(b => (
        <span key={b.id} className="particle"
          style={{ '--tx': `${b.tx}px`, '--ty': `${b.ty}px` }} />
      ))}
    </button>
  );
}
```

## Prompt guidance

Build a like button that pops its heart and emits a particle burst when toggled on. Scale the heart to ~1.35 and back with a spring curve, fill it with the accent color, increment the count, and spawn ~8 small particles outward on an even circle that translate out and shrink to scale(0) over ~0.6s.
