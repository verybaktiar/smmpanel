# Stagger Entrance

List items rise in sequence on scroll into view

Keywords: scroll reveal, list animation, cascade, sequence, entrance, fade up, on scroll, intersection observer, items, waterfall, delay, appear

## CSS

```css
.stagger-item {
  opacity: 0;
  transform: translateY(14px);
  transition: opacity 0.45s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}
.stagger-item.in {
  opacity: 1;
  transform: translateY(0);
}
/* JS adds .in to each item with i * 90ms setTimeout,
   or via IntersectionObserver for scroll-trigger */
```

## React

```jsx
function StaggerList({ items }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setVisible(true);
    }, { threshold: 0.4 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref}>
      {items.map((item, i) => (
        <div key={item} style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(14px)',
          transition: `opacity .45s cubic-bezier(.16,1,.3,1) ${i * 90}ms,
                       transform .45s cubic-bezier(.16,1,.3,1) ${i * 90}ms`,
        }}>
          {item}
        </div>
      ))}
    </div>
  );
}
```

## Prompt guidance

Build a list whose items rise and fade in one after another when scrolled into view. Trigger with an IntersectionObserver; transition each item from opacity 0 / translateY(14px) to visible with cubic-bezier(0.16,1,0.3,1), delaying each by index * 90ms.
