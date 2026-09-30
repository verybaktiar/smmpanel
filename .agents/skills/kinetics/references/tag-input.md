# Tag Input

Enter pops a chip in; × pops it out

Keywords: chips, tokens, keywords, labels, categories, multi value, email recipients, skills, autocomplete, form, enter, taxonomy

## CSS

```css
.tag { animation: pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
.tag.removing { animation: out 0.24s ease forwards; }
@keyframes pop { from { transform: scale(0.4); opacity: 0; } }
@keyframes out { to   { transform: scale(0.4); opacity: 0; } }
```

## React

```jsx
function TagInput() {
  const [tags, setTags] = useState(['design', 'motion']);
  const add = (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      setTags([...tags, e.target.value.trim()]);
      e.target.value = '';
    }
  };
  return (
    <div className="tags">
      {tags.map((t, i) => (
        <span key={i} className="tag">
          {t}
          <button onClick={() => setTags(tags.filter((_, j) => j !== i))}>×</button>
        </span>
      ))}
      <input onKeyDown={add} placeholder="Add tag…" />
    </div>
  );
}
```

## Prompt guidance

Build a tag/token input. Typing a value and pressing Enter appends a pill that springs in from scale(0.4) with a cubic-bezier(0.34, 1.56, 0.64, 1) pop. Each pill has a × button that removes it with a quick scale-down fade. Pressing Backspace in the empty field removes the last tag. The field shares a bordered container with the pills and highlights on focus-within.
