# PIN Input

Each digit pops and auto-advances to the next box

Keywords: otp, one time password, verification code, 2fa, mfa, security code, credit card, card number, cvv, ssn, social security, passcode, digits, sms code, authentication, phone verification, numeric, segmented input

## CSS

```css
.pin-box {
  width: 44px; height: 52px;
  text-align: center;
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
    border-color 0.2s ease;
}
.pin-box.filled { border-color: var(--amber); }
.pin-box.pop { transform: scale(1.14); }
.pin-box:focus { border-color: var(--amber); outline: none; }
```

## React

```jsx
function PinInput({ length = 4 }) {
  const refs = useRef([]);
  const onChange = (i, e) => {
    const el = e.target;
    if (el.value) {
      el.classList.add('filled', 'pop');
      setTimeout(() => el.classList.remove('pop'), 350);
      refs.current[i + 1]?.focus();
    } else {
      el.classList.remove('filled');
    }
  };
  const onKey = (i, e) => {
    if (e.key === 'Backspace' && !e.target.value)
      refs.current[i - 1]?.focus();
  };
  return (
    <div>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          maxLength={1}
          ref={(el) => (refs.current[i] = el)}
          onChange={(e) => onChange(i, e)}
          onKeyDown={(e) => onKey(i, e)}
        />
      ))}
    </div>
  );
}
```

## Prompt guidance

Build a one-time-code / PIN input of four single-character boxes. When a digit is typed, mark that box filled (accent border) and give it a brief spring pop (scale ~1.14 with cubic-bezier(0.34, 1.56, 0.64, 1)), then move focus to the next box automatically. On Backspace in an empty box, move focus to the previous box. Keep focus rings on the active box.
