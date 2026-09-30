# Toast Stack

Multiple toasts stack upward and auto-dismiss in sequence

Keywords: toasts, notifications, stack, queue, multiple, auto dismiss, messages, alerts, pile, sequence, corner, system

## CSS

```css
.toaststack-item {
  transform: translateY(100%) scale(0.9);
  opacity: 0;
  transition: transform 0.5s cubic-bezier(0.18, 1.25, 0.4, 1),
              opacity 0.3s ease;
}
.toaststack-item.show {
  transform: translateY(0) scale(1);
  opacity: 1;
}
.toaststack-item.hide {
  transform: translateY(20px) scale(0.9);
  opacity: 0;
}
```

## React

```jsx
function ToastStack({ max = 3 }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const push = () => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev.slice(-max + 1), { id, msg: 'Saved ' + id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2400);
  };

  return (
    <>
      <button onClick={push}>Push toast</button>
      <div className="toaststack">
        {toasts.map((t) => (
          <div key={t.id} className="toaststack-item show">
            <span className="dot" /> {t.msg}
          </div>
        ))}
      </div>
    </>
  );
}
```

## Prompt guidance

Build a toast stack that can hold up to 3 toasts. On button click, push a new toast that slides up from the bottom with an overshoot cubic-bezier(0.18,1.25,0.4,1) and auto-dismisses after ~2.4s by sliding down and fading. When a new toast is pushed beyond the max, the oldest is removed. Stack them vertically with a small gap.
