# Expanding Search

Field grows on hover or focus, glide easing

Keywords: search bar, find, magnifier, filter, lookup, query, grow, navbar, toolbar, input, discover, spotlight

## CSS

```css
.search {
  width: 56px;
  overflow: hidden;
  transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
/* label wrapper: click anywhere focuses the input */
.search:hover,
.search:focus-within {
  width: 230px;
}
```

## React

```jsx
function ExpandingSearch() {
  return (
    <div
      style={{
        width: 56,
        overflow: 'hidden',
        transition: 'width 0.4s cubic-bezier(0.16,1,0.3,1)',
      }}
      onFocusCapture={(e) => (e.currentTarget.style.width = '230px')}
      onBlurCapture={(e) => (e.currentTarget.style.width = '56px')}
    >
      <SearchIcon />
      <input placeholder="Search…" />
    </div>
  );
}
```

## Prompt guidance

Build a pill-shaped search field that starts collapsed to just its icon (~56px) and expands to full width when focused. Use :focus-within and animate only the width over ~0.4s with a glide cubic-bezier(0.16, 1, 0.3, 1). Keep overflow hidden so the input text is clipped while collapsed, and let the icon stay pinned on the left.
