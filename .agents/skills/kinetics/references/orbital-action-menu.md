# Orbital Action Menu

Actions escape a magnetic centre on hover

Keywords: radial menu, context menu, hover, satellite, actions, circular, fan, escape, magnetic, quick actions, pie menu, orbit

## CSS

```css
.menu:hover .action-n { transform: translateY(-52px); opacity: 1; }
.menu:hover .action-e { transform: translateX(52px); opacity: 1; }
/* give each action a different translate vector and spring transition */
```

## Prompt guidance

Build a compact radial action menu. A dark circular + button anchors the centre; four tiny actions begin stacked behind it, then orbit outward in cardinal directions on hover. Use independent translate transforms with a slightly overshooting spring so the menu feels magnetic rather than mechanically radial.
