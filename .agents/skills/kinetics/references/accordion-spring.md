# Accordion Spring

Max-height transition with rotating chevron

Keywords: faq, collapse, expand, disclosure, dropdown, details, chevron, list, menu, show hide, toggle, section

## CSS

```css
.acc-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}
.acc-item.open .acc-body {
  max-height: 100px;
}
.chev {
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.acc-item.open .chev {
  transform: rotate(180deg);
}
```

## React

```jsx
function AccordionItem({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)}>
        {title}
        <span style={{ transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform .35s cubic-bezier(.34,1.56,.64,1)' }}>⌄</span>
      </button>
      <div style={{
        maxHeight: open ? 100 : 0,
        overflow: 'hidden',
        transition: 'max-height .45s cubic-bezier(.16,1,.3,1)',
      }}>
        {children}
      </div>
    </div>
  );
}
```

## Prompt guidance

Build an accordion whose panels open with a springy feel and a rotating chevron. Animate max-height (0 to content height) with cubic-bezier(0.16,1,0.3,1) and rotate the chevron 180deg with a springy cubic-bezier(0.34,1.56,0.64,1). Pure CSS toggled by an .open class.
