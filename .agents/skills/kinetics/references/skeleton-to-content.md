# Skeleton to Content

Shimmering placeholder resolves into real content on click

Keywords: skeleton, loading state, placeholder, shimmer, content loaded, lazy, fetch, cards, perceived performance, ghost, resolve, swap

## CSS

```css
.skel-bar {
  background: linear-gradient(90deg, #232326 25%, #34343a 50%, #232326 75%);
  background-size: 200% 100%;
  animation: shimmer-sweep 1.4s ease-in-out infinite;
}
@keyframes shimmer-sweep {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.skel-content.loaded .skel-bar { animation: none; opacity: 0; }
.skel-content.loaded .skel-real { opacity: 1; transform: translateY(0); }
```

## React

```jsx
function SkeletonCard() {
  const [loaded, setLoaded] = useState(false);
  return (
    <div
      className={loaded ? 'skel-content loaded' : 'skel-content'}
      onClick={() => setLoaded(true)}
    >
      {!loaded && (
        <>
          <div className="skel-avatar" />
          <div className="skel-bar" />
          <div className="skel-bar short" />
        </>
      )}
      {loaded && (
        <>
          <div className="skel-real-avatar">K</div>
          <div className="skel-real-name">Ada Lovelace</div>
          <div className="skel-real-meta">Analytical Engine</div>
        </>
      )}
    </div>
  );
}
```

## Prompt guidance

Build a skeleton loading card that shimmers with a gradient sweep and resolves into real content on click. Show a circular avatar placeholder and two text bars with a 200%-size linear-gradient background that animates its background-position back and forth (shimmer-sweep). On click, fade out the skeleton elements and fade in the real avatar, name, and metadata with a small translateY glide.
