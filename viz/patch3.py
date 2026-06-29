import re

with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'r') as f:
    content = f.read()

# line 496
content = content.replace("option.textContent = entry.field;", "option.textContent = `${getFieldLabel(getCompDataStore(), entry.field)} (${entry.type})`;")

# text node for row.field in buildCriteriaRow
content = content.replace("const text = document.createTextNode(row.field);", "const text = document.createTextNode(getFieldLabel(getCompDataStore(), row.field));")

# fieldTd.appendChild(renderSortableRowLabel(entry.field, entry.field));
content = content.replace("fieldTd.appendChild(renderSortableRowLabel(entry.field, entry.field));", "fieldTd.appendChild(renderSortableRowLabel(getFieldLabel(getCompDataStore(), entry.field), entry.field));")

with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'w') as f:
    f.write(content)

