# Page Peel

Top card rotates around its left edge like a page turning

Keywords: page turn, book, flip, peel, paper, magazine, reveal, corner, rotate, reading, sheet, transition

## CSS

```css
.peel-zone { perspective: 1000px; }
.peel-card {
  transform-origin: left center;
  transition: transform 0.6s cubic-bezier(0.65, 0, 0.35, 1), opacity 0.6s;
  backface-visibility: hidden;
}
.peel-card.peeled {
  transform: rotateY(-130deg) translateX(-20px);
  opacity: 0;
}
```

## React

```jsx
function PagePeel({ pages }) {
  const [peeledCount, setPeeledCount] = useState(0);

  return (
    <div style={{ perspective: 1000, position: 'relative' }}>
      {pages.map((page, i) => (
        <div key={i} style={{
          position: 'absolute',
          transformOrigin: 'left center',
          transform: i < peeledCount ? 'rotateY(-130deg) translateX(-20px)' : 'none',
          opacity: i < peeledCount ? 0 : 1,
          transition: 'transform .6s cubic-bezier(.65,0,.35,1), opacity .6s',
        }}>
          {page}
        </div>
      ))}
      <button onClick={() => setPeeledCount(c => (c + 1) % (pages.length + 1))}>
        Peel
      </button>
    </div>
  );
}
```

## Prompt guidance

Build a stack of cards where the top one peels away like a turning page. Set perspective on the container and transform-origin: left center on the cards; on trigger rotate the top card rotateY(-130deg) translateX(-20px) and fade it out over ~0.6s with cubic-bezier(0.65,0,0.35,1), revealing the one beneath.
