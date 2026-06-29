import re

with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'r') as f:
    content = f.read()

# Fix imports
old_imports = 'import { ParcelsService, GetEquityComparablesRequest, GetSalesComparablesRequest, ComparableCriteria, ParcelAttribute } from "@civil-labs/civil-api-js";'
new_imports = """import { create } from "@bufbuild/protobuf";
import type { ComparableCriteria } from "@civil-labs/civil-api-js";
import { ParcelsService, GetEquityComparablesRequestSchema, GetSalesComparablesRequestSchema, ComparableCriteriaSchema, ParcelAttribute } from "@civil-labs/civil-api-js";"""

content = content.replace(old_imports, new_imports)

# Fix creations
content = content.replace('new ComparableCriteria(', 'create(ComparableCriteriaSchema, ')
content = content.replace('new GetEquityComparablesRequest(', 'create(GetEquityComparablesRequestSchema, ')
content = content.replace('new GetSalesComparablesRequest(', 'create(GetSalesComparablesRequestSchema, ')

# Fix getFieldLabel usage
render_add_old = """out.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.field;
    option.textContent = `${entry.field} (${entry.type})`;
    els.addFieldSelect.appendChild(option);
  });"""

render_add_new = """out.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.field;
    option.textContent = `${getFieldLabel(getCompDataStore(), entry.field)} (${entry.type})`;
    els.addFieldSelect.appendChild(option);
  });"""
content = content.replace(render_add_old, render_add_new)

build_crit_old = """const text = document.createTextNode(row.field);"""
build_crit_new = """const text = document.createTextNode(getFieldLabel(getCompDataStore(), row.field));"""
content = content.replace(build_crit_old, build_crit_new)

render_table_old = """th.appendChild(buildCompColumnButton(entry.field, comp, () => {"""
render_table_new = """th.appendChild(buildCompColumnButton(getFieldLabel(getCompDataStore(), entry.field), comp, () => {"""
content = content.replace(render_table_old, render_table_new)

with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'w') as f:
    f.write(content)

