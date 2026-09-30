# Depth Stack

Layered cards fan apart on hover

Keywords: stack, layers, cards fan, deck, spread, pile, z axis, hover fan, sheets, parallax layers, unstack, shuffle

## CSS

```css
.card { transition: transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1); }
.card:nth-child(2) { transform: translateY(7px)  scale(0.93); }
.card:nth-child(3) { transform: translateY(14px) scale(0.86); }
.stack:hover .card:nth-child(1) { transform: translateY(-48px) rotate(-5deg); }
.stack:hover .card:nth-child(3) { transform: translateY(48px)  rotate(5deg); }
```

## React

```jsx
function DepthStack({ cards }) {
  return (
    <div className="stack">
      {cards.map((c, i) => (
        <div key={i} className="card" style={{ zIndex: cards.length - i }}>
          {c}
        </div>
      ))}
    </div>
  );
  // depth via translateY + scale; :hover fans them apart
}
```

## Prompt guidance

Build a stack of 3 overlapping cards that look like a deck — each lower card pushed down a few px and scaled slightly smaller, with descending z-index. On hover, fan them apart vertically: the top card lifts up and tilts left, the bottom drops and tilts right, the middle squares up to full size. Animate transforms with a spring cubic-bezier(0.34, 1.56, 0.64, 1) over ~0.55s.
