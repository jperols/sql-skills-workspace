(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SQLWorkspaceEditorSupport = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // Completion is a name lookup, not a SQL parser. It does not validate or
  // rewrite queries, infer joins, or invent names for aliases and CTEs.
  function completeNames(line, ch, schema, keywordNames) {
    ch = Math.max(0, Math.min(line.length, ch));
    const left = line.slice(0, ch);
    const match = left.match(/[\p{L}\p{N}_$]*$/u);
    const prefix = match ? match[0] : "";
    const from = ch - prefix.length;
    const right = line.slice(ch).match(/^[\p{L}\p{N}_$]*/u)[0];
    const to = ch + right.length;
    const before = line.slice(0, from);
    // Parameter names and identifiers already inside quotes are left alone.
    if (prefix.startsWith("$") || /[:@$?"'\u0060\[]$/.test(before)) return { list: [], from, to };
    const qualifier = before.match(/("(?:[^"]|"")*"|[\p{L}_][\p{L}\p{N}_$]*)\s*\.\s*$/u);
    const qualified = /\.\s*$/.test(before);
    const qualifierName = qualifier ? qualifier[1].replace(/^"|"$/g, "").replace(/""/g, '"') : null;
    const table = qualifierName && schema.find(t => t.name.toLowerCase() === qualifierName.toLowerCase());
    const keywords = new Set(keywordNames.map(k => k.toUpperCase()));
    const list = [];
    const matches = text => text.toLowerCase().startsWith(prefix.toLowerCase());
    const quote = name => /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name) && !keywords.has(name.toUpperCase()) ? name : '"' + name.replace(/"/g, '""') + '"';
    if (!qualified) {
      for (const item of schema) {
        if (matches(item.name)) list.push({ text: quote(item.name), displayText: item.name, kind: item.type === "view" ? "view" : "table", detail: item.type === "view" ? "view" : "table" });
      }
    }
    const columns = new Map();
    for (const item of table ? [table] : schema) {
      for (const column of item.columns) {
        if (!matches(column.name)) continue;
        const key = column.name.toLowerCase();
        if (!columns.has(key)) columns.set(key, { name: column.name, sources: [] });
        columns.get(key).sources.push(item.name);
      }
    }
    for (const column of columns.values()) list.push({
      text: quote(column.name), displayText: column.name, kind: "column",
      detail: "column · " + column.sources.join(", ")
    });
    if (!qualified) {
      for (const keyword of keywords) if (matches(keyword)) list.push({ text: keyword, displayText: keyword, kind: "keyword", detail: "keyword" });
    }
    const order = { table: 0, view: 0, column: 1, keyword: 2 };
    list.sort((a, b) => order[a.kind] - order[b.kind] || a.displayText.localeCompare(b.displayText));
    return { list, from, to };
  }

  function errorAnchor(editorText, queryText, baseOffset, error) {
    const relative = Math.max(0, Math.min(queryText.length, error.start || 0));
    const offset = Math.max(0, Math.min(editorText.length, baseOffset + relative));
    const prefix = editorText.slice(0, offset);
    const line = prefix.split("\n").length - 1;
    return { line, ch: offset - (prefix.lastIndexOf("\n") + 1), offset };
  }
  return { completeNames, errorAnchor };
}));
