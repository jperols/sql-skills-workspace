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
  function restore(storage, session, initialSQL) {
    if (!session.open || !session.draftKey) return "";
    const saved = storage.getItem(session.draftKey);
    return saved === null ? (initialSQL || "") : saved;
  }
  function save(storage, session, sql) {
    if (!session.open || !session.draftKey) return;
    storage.setItem(session.draftKey, sql);
  }
  return { resolve, restore, save };
}));
