# Tab Pill Glide

Indicator measures target width before moving

Keywords: tabs, navigation, segmented control, indicator, switcher, menu, filter, active state, slide, nav, pill, underline

## CSS

```css
.pill {
  position: absolute;
  transition: left 0.4s cubic-bezier(0.65, 0, 0.35, 1),
              width 0.4s cubic-bezier(0.65, 0, 0.35, 1);
}
/* JS sets pill.style.left/width to the active
   button's offsetLeft/offsetWidth on click */
```

## React

```jsx
function GlidingTabs({ tabs }) {
  const [active, setActive] = useState(0);
  const refs = useRef([]);
  const [style, setStyle] = useState({});

  useEffect(() => {
    const el = refs.current[active];
    if (el) setStyle({ left: el.offsetLeft, width: el.offsetWidth });
  }, [active]);

  return (
    <div style={{ position: 'relative' }}>
      <span
        style={{
          position: 'absolute',
          ...style,
          transition: 'left .4s cubic-bezier(.65,0,.35,1), width .4s cubic-bezier(.65,0,.35,1)',
        }}
      />
      {tabs.map((t, i) => (
        <button key={t} ref={el => (refs.current[i] = el)} onClick={() => setActive(i)}>
          {t}
        </button>
      ))}
    </div>
  );
}
```

## Prompt guidance

Build a segmented tab control where a highlighted pill slides between tabs. On click, read the target button's offsetLeft and offsetWidth and animate the pill's left and width to match with cubic-bezier(0.65,0,0.35,1) over ~0.4s; the active label color crossfades as the pill arrives.
