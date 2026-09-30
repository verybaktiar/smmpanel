# Segment Loader

Stepped bars fill one after another on each run

Keywords: loading, steps, progress, bars, sequence, boot, loading bar, stepped, blocks, fill, wait, chunks

## CSS

```css
.segment {
  flex: 1; height: 8px; border-radius: 4px;
  background: #232326;
  overflow: hidden;
}
.segment::after {
  content: '';
  display: block; height: 100%;
  background: linear-gradient(90deg, #B36200, #FF8A00);
  transform: scaleX(0); transform-origin: left;
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
.segment.filled::after { transform: scaleX(1); }
/* JS adds .filled to each segment on an i * 120ms stagger. */
```

## React

```jsx
function SegmentLoader({ count = 5 }) {
  const [filled, setFilled] = useState(0);

  const run = () => {
    setFilled(0);
    for (let i = 1; i <= count; i++) {
      setTimeout(() => setFilled(i), i * 120);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6 }}>
        {Array.from({ length: count }).map((_, i) => (
          <span key={i} className={i < filled ? 'segment filled' : 'segment'} />
        ))}
      </div>
      <button onClick={run}>Load</button>
    </div>
  );
}
```

## Prompt guidance

Build a segmented progress loader that fills its bars in sequence on demand. Each segment's fill is an ::after scaled with scaleX from a left origin; on trigger, reset all then add a .filled class to each segment on an index * 120ms stagger so they sweep in left to right with cubic-bezier(0.16,1,0.3,1).
