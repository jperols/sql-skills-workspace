(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SQLWorkspaceSession = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function resolve(mode, config, testSettings) {
    if (mode === "practice") {
      return {
        mode, open: true, label: "Practice · " + config.label,
        draftKey: "sql-workspace:v2:practice:" + (config.draftVersion || "v1")
      };
    }
    if (mode !== "test") throw new Error("Unknown workspace mode.");
    if (!testSettings || typeof testSettings.open !== "boolean") {
      throw new Error("The test settings are incomplete.");
    }
    const label = "Test · " + (typeof testSettings.label === "string" && testSettings.label.trim() || config.label);
    if (!testSettings.open) return { mode, open: false, label, draftKey: null };
    const id = testSettings.testId;
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id) || id === "not-started") {
      throw new Error("A new test ID must be set before opening the test.");
    }
    return { mode, open: true, label, testId: id, draftKey: "sql-workspace:v2:test:" + id };
  }
  function load(storage, session, initialSQL) {
    if (!session.open || !session.draftKey) return { sql: "", views: null, databasePath: null };
    const saved = storage.getItem(session.draftKey);
    if (saved === null) return { sql: initialSQL || "", views: null, databasePath: null };
    if (saved.startsWith('{"kind":"sql-workspace-checkpoint"')) {
      const record = JSON.parse(saved);
      if (record.version !== 1 || typeof record.sql !== "string") throw new Error("The saved workspace could not be read.");
      return { sql: record.sql, views: record.views || null, databasePath: record.databasePath || null };
    }
    // Drafts saved by the earlier version contain SQL text only.
    return { sql: saved, views: null, databasePath: null };
  }
  function restore(storage, session, initialSQL) {
    return load(storage, session, initialSQL).sql;
  }
  function save(storage, session, sql, views, databasePath) {
    if (!session.open || !session.draftKey) return;
    storage.setItem(session.draftKey, JSON.stringify({ kind: "sql-workspace-checkpoint", version: 1, sql, views: views || null, databasePath: databasePath || null }));
  }
  return { resolve, restore, load, save };
}));
