(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./sql-core.js"));
  else root.SQLViewManager = factory(root.SQLWorkspaceCore);
}(typeof self !== "undefined" ? self : this, function (core) {
  "use strict";
  const quote = core.quoteName;
  function rows(db, sql, parameters) {
    const statement = db.prepare(sql, parameters), result = [];
    try { while (statement.step()) result.push(statement.getAsObject()); }
    finally { statement.free(); }
    return result;
  }
  // Read only the CREATE VIEW header. SQLite validates the query itself.
  function splitDefinition(sql) {
    let position = 0;
    function next() {
      position = core.skipTrivia(sql, position);
      const start = position, first = sql[position];
      if (!first) return { text: "", start, end: position };
      if (first === '"' || first === "'" || first === "`" || first === "[") {
        const close = first === "[" ? "]" : first;
        position++;
        while (position < sql.length) {
          if (sql[position++] !== close) continue;
          if (close !== "]" && sql[position] === close) { position++; continue; }
          break;
        }
      } else if (/[().,]/.test(first)) position++;
      else while (position < sql.length && !/[\s().,]/.test(sql[position]) && sql.slice(position, position + 2) !== "/*" && sql.slice(position, position + 2) !== "--") position++;
      return { text: sql.slice(start, position), start, end: position };
    }
    function expect(word) { const token = next(); if (token.text.toUpperCase() !== word) throw new Error("The view definition could not be opened for editing."); return token; }
    expect("CREATE");
    let token = next();
    if (/^(TEMP|TEMPORARY)$/i.test(token.text)) token = next();
    if (token.text.toUpperCase() !== "VIEW") throw new Error("The selected object is not a view.");
    token = next();
    if (token.text.toUpperCase() === "IF") { expect("NOT"); expect("EXISTS"); token = next(); }
    if (!token.text) throw new Error("The view has no name.");
    token = next();
    if (token.text === ".") { next(); token = next(); }
    if (token.text === "(") {
      let depth = 1;
      while (depth) {
        token = next();
        if (!token.text) throw new Error("The view definition is incomplete.");
        if (token.text === "(") depth++;
        if (token.text === ")") depth--;
      }
      token = next();
    }
    if (token.text.toUpperCase() !== "AS") throw new Error("The view query could not be identified.");
    return { prefix: sql.slice(0, token.end), query: sql.slice(token.end).trim() };
  }
  function getDefinition(db, name) {
    const found = rows(db, "SELECT name, sql FROM main.sqlite_schema WHERE type='view' AND name=?", [name]);
    if (!found.length) throw new Error("no such view: " + name);
    const view = found[0];
    return Object.assign({ name: view.name, sql: view.sql }, splitDefinition(view.sql));
  }
  function runOne(db, sql) {
    const statement = db.prepare(sql);
    try {
      if (core.skipTrivia(sql, statement.getSQL().length) < sql.length) throw new Error("Enter only the query that defines this view.");
      while (statement.step()) { /* SQLite executes this one statement. */ }
    } finally { statement.free(); }
  }
  function saveView(db, name, query) {
    const old = getDefinition(db, name);
    const triggers = rows(db, "SELECT sql FROM main.sqlite_schema WHERE type='trigger' AND tbl_name=? ORDER BY rowid", [name]);
    // Temporary triggers cannot be safely rebound using a schema-less definition.
    if (rows(db, "SELECT name FROM temp.sqlite_schema WHERE type='trigger' AND tbl_name=?", [name]).length) {
      throw new Error("This view has temporary triggers. Manage its definition in the SQL editor.");
    }
    const cleaned = core.normalizeSQL(String(query));
    const sql = old.prefix + "\n" + cleaned.text;
    db.run("SAVEPOINT sql_workspace_view_edit");
    try {
      db.run("DROP VIEW main." + quote(name));
      runOne(db, sql);
      // CREATE VIEW alone accepts unresolved tables/columns. Prepare a read before
      // committing so an invalid edit cannot replace a working definition.
      const validation = db.prepare("SELECT * FROM main." + quote(name) + " LIMIT 0");
      validation.free();
      triggers.forEach(trigger => runOne(db, trigger.sql));
      db.run("RELEASE sql_workspace_view_edit");
    } catch (error) {
      db.run("ROLLBACK TO sql_workspace_view_edit");
      db.run("RELEASE sql_workspace_view_edit");
      throw error;
    }
    return { view: getDefinition(db, name), cleaned: cleaned.changed };
  }
  function dropView(db, name) {
    getDefinition(db, name); // Never let a UI request remove a table.
    db.run("DROP VIEW main." + quote(name));
  }
  function capture(db) {
    const definitions = rows(db, "SELECT name, sql FROM main.sqlite_schema WHERE type='view' ORDER BY rowid");
    return {
      version: 1,
      definitions: definitions.map(view => ({ name: view.name, sql: view.sql, triggers: rows(db, "SELECT name, sql FROM main.sqlite_schema WHERE type='trigger' AND tbl_name=? ORDER BY rowid", [view.name]) }))
    };
  }
  function restore(db, snapshot) {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.definitions)) throw new Error("The saved views could not be read.");
    const names = new Set();
    snapshot.definitions.forEach(view => {
      if (!view || typeof view.name !== "string" || typeof view.sql !== "string" || !Array.isArray(view.triggers) || names.has(view.name)) throw new Error("The saved views could not be read.");
      names.add(view.name); splitDefinition(view.sql);
      view.triggers.forEach(trigger => {
        if (!trigger || typeof trigger.name !== "string" || typeof trigger.sql !== "string" || !/^CREATE\s+TRIGGER\b/i.test(trigger.sql)) throw new Error("A saved view trigger could not be read.");
      });
    });
    db.run("SAVEPOINT sql_workspace_view_restore");
    try {
      rows(db, "SELECT name FROM main.sqlite_schema WHERE type='view'").forEach(view => db.run("DROP VIEW main." + quote(view.name)));
      snapshot.definitions.forEach(view => {
        runOne(db, view.sql);
        getDefinition(db, view.name);
      });
      snapshot.definitions.forEach(view => view.triggers.forEach(trigger => {
        runOne(db, trigger.sql);
        const found = rows(db, "SELECT tbl_name FROM main.sqlite_schema WHERE type='trigger' AND name=?", [trigger.name]);
        if (found.length !== 1 || found[0].tbl_name !== view.name) throw new Error("A saved trigger does not belong to its view.");
      }));
      db.run("RELEASE sql_workspace_view_restore");
    } catch (error) {
      db.run("ROLLBACK TO sql_workspace_view_restore");
      db.run("RELEASE sql_workspace_view_restore");
      throw error;
    }
    return snapshot.definitions.length;
  }
  return { splitDefinition, getDefinition, saveView, dropView, capture, restore };
}));
