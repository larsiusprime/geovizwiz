export function makeFieldCheckbox(name: string, checked: boolean, fieldType: 'numeric' | 'categorical' = 'numeric') {
  const label = document.createElement('label');
  label.style.display = 'flex'; 
  label.style.gap = '8px'; 
  label.style.alignItems = 'center';
  
  const cb = document.createElement('input'); 
  cb.type = 'checkbox'; 
  cb.name = name; 
  cb.checked = checked;
  cb.dataset.fieldType = fieldType;
  
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
