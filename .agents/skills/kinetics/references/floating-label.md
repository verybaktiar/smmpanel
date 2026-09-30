# Floating Label

Placeholder lifts into a label on focus — pure CSS

Keywords: form, input, text field, placeholder, label, material design, email, phone number, telephone, name field, date, birthday, address, signup, login, register, focus, entry

## CSS

```css
.field { position: relative; }
.field label {
  position: absolute;
  left: 14px; top: 50%;
  transform: translateY(-50%);
  color: #6E6C68;
  pointer-events: none;
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
              color 0.2s, font-size 0.2s;
}
/* Empty uses :placeholder-shown; lift on focus or value */
.field input:focus + label,
.field input:not(:placeholder-shown) + label {
  transform: translateY(-26px) scale(0.85);
  color: #FF8A00;
}
```

## React

```jsx
function FloatingField({ label }) {
  // The motion is pure CSS: keep a " " placeholder so
  // :placeholder-shown tracks emptiness, and animate the
  // adjacent label on :focus / :not(:placeholder-shown).
  return (
    <div className="field">
      <input id="email" placeholder=" " />
      <label htmlFor="email">{label}</label>
    </div>
  );
}
```

## Prompt guidance

Build a text field whose placeholder floats up into a label when focused or filled, pure CSS. Give the input a single-space placeholder so :placeholder-shown reflects emptiness; position the label over the input and, on input:focus or :not(:placeholder-shown), translate it up and scale it down into the accent color over ~0.2s.
