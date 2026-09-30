# 3D Cube Rotate

Click to roll a face in with depth

Keywords: cube, 3d, rotate, faces, transition, perspective, box, roll, dice, panel switch, depth, spatial

## CSS

```css
.scene { perspective: 620px; }
.cube {
  transform-style: preserve-3d;
  transform: translateZ(-56px) rotateY(0deg);
  transition: transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.front { transform: rotateY(0deg)   translateZ(56px); }
.right { transform: rotateY(90deg)  translateZ(56px); }
.back  { transform: rotateY(180deg) translateZ(56px); }
.left  { transform: rotateY(-90deg) translateZ(56px); }
```

## React

```jsx
function Cube({ faces }) {
  const [n, setN] = useState(0);
  return (
    <div className="scene" onClick={() => setN(n + 1)}>
      <div
        className="cube"
        style={{ transform: `translateZ(-56px) rotateY(${-90 * n}deg)` }}
      >
        {faces.map((f, i) => (
          <div key={i} className={`face ${f.side}`}>{f.label}</div>
        ))}
      </div>
    </div>
  );
}
```

## Prompt guidance

Build a 3D cube you can click to rotate. Use a scene with perspective and a preserve-3d cube whose four side faces are placed with rotateY(0/90/180/-90deg) translateZ(56px). Pull the cube back by translateZ(-56px) so faces sit around the centre. On each click, rotate the cube by -90deg on Y using a spring cubic-bezier(0.34, 1.56, 0.64, 1) over ~0.7s so the next face rolls into view with a slight overshoot.
