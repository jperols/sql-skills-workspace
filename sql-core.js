(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SQLWorkspaceCore = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const unicodeSpaces = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/;
  const invisible = /[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/;
  const word = /[A-Za-z0-9\u00c0-\u02af]/;

  function normalizeSQL(input) {
    const changes = { spaces: 0, invisible: 0, controls: 0, quotes: 0, lines: 0 };
    let out = "", mode = "normal", close = "", curlyClose = "";
    for (let i = 0; i < input.length; i++) {
      const c = input[i], next = input[i + 1] || "";
      if (mode === "line") {
        out += c;
        if (c === "\n" || c === "\r") mode = "normal";
        continue;
      }
      if (mode === "block") {
        out += c;
        if (c === "*" && next === "/") { out += next; i++; mode = "normal"; }
        continue;
      }
      if (mode === "quote") {
        if (curlyClose && c === curlyClose && !(word.test(input[i - 1] || "") && word.test(next))) {
          out += close; changes.quotes++; mode = "normal"; curlyClose = ""; continue;
        }
        out += c;
        if (c === close) {
          if (next === close && close !== "]") { out += next; i++; }
          else { mode = "normal"; curlyClose = ""; }
        }
        continue;
      }
      if (c === "-" && next === "-") { out += "--"; i++; mode = "line"; continue; }
      if (c === "/" && next === "*") { out += "/*"; i++; mode = "block"; continue; }
      if (c === "'" || c === '"' || c === "\u0060" || c === "[") {
        mode = "quote"; close = c === "[" ? "]" : c; curlyClose = ""; out += c; continue;
      }
      if (/[\u2018\u2019\u201c\u201d]/.test(c)) {
        close = c === "\u2018" || c === "\u2019" ? "'" : '"';
        curlyClose = close === "'" ? "\u2019" : "\u201d";
        out += close; changes.quotes++; mode = "quote"; continue;
      }
      if (unicodeSpaces.test(c)) { out += " "; changes.spaces++; continue; }
      if (invisible.test(c)) { changes.invisible++; continue; }
      if (c === "\r") { if (next === "\n") i++; out += "\n"; changes.lines++; continue; }
      if (c === "\u2028" || c === "\u2029") { out += "\n"; changes.lines++; continue; }
      if ((c.charCodeAt(0) < 32 && c !== "\n" && c !== "\t") || c === "\u007f") {
        out += " "; changes.controls++; continue;
      }
      out += c;
    }
    return { text: out, changes, changed: out !== input };
  }

  function changeDescription(changes) {
    const labels = { spaces: "unusual space", invisible: "invisible character", controls: "control character", quotes: "curly quotation mark", lines: "line break" };
    const parts = Object.keys(changes).filter(k => changes[k]).map(k => changes[k] + " " + labels[k] + (changes[k] === 1 ? "" : "s"));
    return "Cleaned " + parts.join(", ") + ". Quoted values and comments were preserved.";
  }

  function quoteName(name) { return '"' + String(name).replace(/"/g, '""') + '"'; }

  function getSchema(db) {
    const response = db.exec("SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name COLLATE NOCASE");
    if (!response.length) return [];
    return response[0].values.map(function (row) {
      let info = [], schemaError;
      try { info = db.exec("PRAGMA main.table_xinfo(" + quoteName(row[0]) + ")"); }
      catch (e) { schemaError = String(e.message || e); }
      return {
        name: row[0], type: row[1], schemaError,
        columns: info.length ? info[0].values.filter(c => c[6] !== 1).map(c => ({
          name: c[1], type: c[2] || "ANY", primary: !!c[5], nullable: !c[3]
        })) : []
      };
    });
  }

  // Skip only leading separators and comments. SQLite itself parses each statement,
  // so semicolons in strings, comments, and trigger bodies remain intact.
  function skipTrivia(sql, start) {
    let p = start;
    while (p < sql.length) {
      if (/[\s;]/.test(sql[p])) { p++; continue; }
      if (sql.slice(p, p + 2) === "--") {
        const end = sql.indexOf("\n", p + 2); p = end < 0 ? sql.length : end + 1; continue;
      }
      if (sql.slice(p, p + 2) === "/*") {
        const end = sql.indexOf("*/", p + 2); p = end < 0 ? sql.length : end + 2; continue;
      }
      break;
    }
    return p;
  }

  function cellValue(value) {
    if (value instanceof Uint8Array) return { blob: true, length: value.length, hex: Array.from(value.slice(0, 24), b => b.toString(16).padStart(2, "0")).join("") };
    return value;
  }

  function executeSQL(db, sql, limit) {
    const results = [];
    let cursor = 0, start = 0, statement = null;
    try {
      while ((cursor = skipTrivia(sql, cursor)) < sql.length) {
        start = cursor;
        const before = db.exec("SELECT total_changes()")[0].values[0][0];
        statement = db.prepare(sql.slice(cursor));
        const statementSQL = statement.getSQL();
        if (!statementSQL.length) throw new Error("SQLite could not identify a complete statement.");
        const columns = statement.getColumnNames(), values = [];
        let rowCount = 0;
        while (statement.step()) {
          rowCount++;
          if (values.length < limit) values.push(statement.get().map(cellValue));
        }
        statement.free(); statement = null;
        const changedRows = db.exec("SELECT total_changes()")[0].values[0][0] - before;
        cursor += statementSQL.length;
        results.push({
          statementNo: results.length + 1, columns, values, rowCount, changedRows,
          truncated: rowCount > values.length, sql: statementSQL, start, end: cursor
        });
      }
      return { results, completed: results.length, error: null };
    } catch (error) {
      const message = String(error.message || error);
      return { results, completed: results.length, error: {
        message, statementNo: results.length + 1, start, end: cursor > start ? cursor : sql.length
      } };
    } finally {
      if (statement) statement.free();
    }
  }
  return { normalizeSQL, changeDescription, quoteName, getSchema, executeSQL, skipTrivia };
}));
