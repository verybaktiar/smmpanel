# Badge Counter

Count springs on every add

Keywords: notification count, unread, cart count, badge, number, inbox, increment, bubble, red dot, counter, items, alerts

## CSS

```css
.count { transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.count.pop { transform: scale(1.4); }
/* toggle .pop off after ~320ms to let it spring back */
```

## React

```jsx
function CartBadge() {
  const [n, setN] = useState(1);
  const [pop, setPop] = useState(false);
  const add = () => {
    setN(n + 1);
    setPop(true);
    setTimeout(() => setPop(false), 320);
  };
  return (
    <button onClick={add}>
      <CartIcon />
      <span className={pop ? 'count pop' : 'count'}>{n}</span>
    </button>
  );
}
```

## Prompt guidance

Build a cart icon with a numeric badge in the corner. On each click, increment the number and pop the badge to scale(1.4) with a spring cubic-bezier(0.34, 1.56, 0.64, 1), then remove the class after ~320ms so it springs back to rest. Force a reflow between removing and re-adding the class so rapid clicks re-trigger the bump every time.
