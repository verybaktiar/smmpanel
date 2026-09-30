# Folding Doors

Two panels swing open in 3D on hover

Keywords: fold, doors, open, 3d panels, saloon, hinge, reveal, gates, swing, entrance, unfold, split

## CSS

```css
.fold { perspective: 820px; overflow: hidden; }
.panel {
  backface-visibility: hidden;
  transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}
.panel.left  { transform-origin: left center; }
.panel.right { transform-origin: right center; }
.fold:hover .panel.left  { transform: rotateY(-108deg); }
.fold:hover .panel.right { transform: rotateY(108deg); }
```

## React

```jsx
function FoldReveal({ children }) {
  return (
    <div className="fold">
      <div className="inner">{children}</div>
      <div className="panel left" />
      <div className="panel right" />
    </div>
  );
}
```

## Prompt guidance

Build a content box hidden behind two folding doors. Place an inner layer with the reveal content, then two half-width panels covering it. Give the parent perspective and each panel a transform-origin at its outer edge (left panel: left, right panel: right) with backface-visibility hidden. On hover, swing them open with rotateY(±108deg) over ~0.6s using a glide cubic-bezier(0.16, 1, 0.3, 1).
