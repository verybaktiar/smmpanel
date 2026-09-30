# Contextual Dock

Nearby controls swell in a soft focus field

Keywords: dock, macos, magnify, toolbar, icons, hover, fisheye, taskbar, launcher, apps, zoom, proximity

## CSS

```css
.dock button:hover { transform: translateY(-14px) scale(1.35); }
.dock button:has(+ button:hover), .dock button:hover + button { transform: translateY(-7px) scale(1.14); }
```

## Prompt guidance

Create a modern contextual dock using CSS :has(). The hovered icon rises and enlarges; its immediate neighbours get a smaller lift and scale. Keep the icons monochrome until focus, use a short spring transition, and let the dock settle naturally when the pointer moves away.
