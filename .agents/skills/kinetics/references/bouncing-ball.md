# Bouncing Ball

Squash-and-stretch drop with a reactive shadow

Keywords: bounce, gravity, squash stretch, ball, drop, physics, cartoon, animation principle, shadow, elastic, playful, fall

## CSS

```css
.ball  { animation: drop 1s cubic-bezier(0.7, 0, 0.3, 1) infinite; }
.shadow { animation: shade 1s cubic-bezier(0.7, 0, 0.3, 1) infinite; }
@keyframes drop {
  0%, 100% { transform: translateY(-54px) scaleY(1.05); }
  50%      { transform: translateY(0) scaleY(0.8) scaleX(1.15); }
}
@keyframes shade {
  0%, 100% { transform: scale(0.5); opacity: 0.25; }
  50%      { transform: scale(1);   opacity: 0.5; }
}
```

## React

```jsx
function BouncingBall() {
  return (
    <div style={{ position: 'relative' }}>
      <span
        style={{ animation: 'drop 1s cubic-bezier(.7,0,.3,1) infinite' }}
      />
      <span
        style={{ animation: 'shade 1s cubic-bezier(.7,0,.3,1) infinite' }}
      />
    </div>
  );
}
/* @keyframes drop {
     0%,100% { transform: translateY(-54px) scaleY(1.05); }
     50%     { transform: translateY(0) scaleY(.8) scaleX(1.15); }
   }
   @keyframes shade {
     0%,100% { transform: scale(.5); opacity: .25; }
     50%     { transform: scale(1);  opacity: .5; }
   } */
```

## Prompt guidance

Build a bouncing ball with squash and stretch, pure CSS. Animate the ball falling and rising (translateY between -54px and 0) on a sharp cubic-bezier(0.7, 0, 0.3, 1) infinite loop (~1s); at the bottom of the bounce flatten it with scaleY(0.8)/scaleX(1.15) and stretch it slightly vertically at the top. Sync a separate ellipse shadow underneath that grows darker and wider as the ball lands and shrinks as it rises.
