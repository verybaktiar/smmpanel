# Confetti Burst

Radially-distributed particles with randomized arc and spin

Keywords: celebration, party, success, achievement, reward, particles, congratulations, winner, complete, milestone, fun, burst

## CSS

```css
.confetti-particle {
  position: absolute;
  width: 6px; height: 6px;
  animation: confetti-fly 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes confetti-fly {
  to {
    transform: translate(var(--tx), var(--ty)) rotate(var(--rot));
    opacity: 0;
  }
}
/* JS spawns N particles in a circle, sets --tx/--ty/--rot
   per particle, removes them after the animation ends */
```

## React

```jsx
function ConfettiButton({ children }) {
  const [particles, setParticles] = useState([]);

  const burst = () => {
    const next = Array.from({ length: 16 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 16 + Math.random() * 0.3;
      const dist = 60 + Math.random() * 50;
      return {
        id: Date.now() + i,
        tx: Math.cos(angle) * dist,
        ty: Math.sin(angle) * dist,
        rot: Math.random() * 360,
      };
    });
    setParticles(next);
    setTimeout(() => setParticles([]), 950);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={burst}>{children}</button>
      {particles.map(p => (
        <span key={p.id} className="confetti-particle" style={{
          '--tx': `${p.tx}px`, '--ty': `${p.ty}px`, '--rot': `${p.rot}deg`,
        }} />
      ))}
    </div>
  );
}
```

## Prompt guidance

Build a button that bursts confetti from its center. On click spawn ~16 small squares, each sent along an evenly-spaced angle (with slight randomness) a random distance, translating out with random rotation while fading and shrinking over ~0.9s using cubic-bezier(0.16,1,0.3,1); remove them after.
