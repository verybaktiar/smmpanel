# Copy Button

Icon crossfades to a check and the label swaps, then reverts

Keywords: clipboard, copy paste, code, snippet, share, duplicate, check, confirmation, api key, token, url, success

## CSS

```css
.copy-icon { position: relative; }
.copy-icon svg {
  position: absolute; inset: 0;
  transition: opacity 0.2s, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ic-check { opacity: 0; transform: scale(0.5); color: #4CD08A; }
.copy-btn.copied .ic-copy  { opacity: 0; transform: scale(0.5); }
.copy-btn.copied .ic-check { opacity: 1; transform: scale(1); }
/* JS writes to the clipboard, adds .copied + swaps the
   label to "Copied", then reverts after ~1.4s. */
```

## React

```jsx
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button className={copied ? 'copy-btn copied' : 'copy-btn'} onClick={copy}>
      <span className="copy-icon">
        <CopyIcon className="ic-copy" />
        <CheckIcon className="ic-check" />
      </span>
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}
```

## Prompt guidance

Build a copy-to-clipboard button that confirms with a crossfade. On click write the value to the clipboard, then crossfade the copy glyph out and a green check in with a spring scale while the label swaps from "Copy" to "Copied"; revert both after ~1.4s.
