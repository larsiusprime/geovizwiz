export function makeFieldCheckbox(name: string, checked: boolean, fieldType: 'numeric' | 'categorical' = 'numeric', locked = false) {
  const label = document.createElement('label');
  label.style.display = 'flex';
  label.style.gap = '8px';
  label.style.alignItems = 'center';
  if (locked) label.style.opacity = '0.55';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.name = name;
  cb.checked = checked;
  cb.dataset.fieldType = fieldType;
  if (locked) cb.disabled = true;

  const span = document.createElement('span');
  span.textContent = name;

  label.append(cb, span);
  return label;
}

export function divider() {
  const d = document.createElement('div');
  d.className = 'divider';
  return d;
}
