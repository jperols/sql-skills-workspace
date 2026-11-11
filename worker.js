"use strict";
importScripts("assets/sql-wasm.js", "sql-core.js?v=3", "view-manager.js?v=4");
let database;
const engine = initSqlJs({ locateFile: file => "assets/" + file });

self.onmessage = async function (event) {
  const request = event.data;
  try {
    if (request.type === "init") {
      const SQL = await engine;
      const path = new URL(request.path, self.location.href);
      if (path.origin !== self.location.origin) throw new Error("The database must be hosted on the same website.");
      const response = await fetch(path.href, { cache: "no-store" });
      if (!response.ok) throw new Error("Database download failed (HTTP " + response.status + ").");
      const data = new Uint8Array(await response.arrayBuffer());
      if (database) database.close();
      database = new SQL.Database(data);
      let restoredViews = 0, recoveryError;
      if (request.views) {
        try { restoredViews = SQLViewManager.restore(database, request.views); }
        catch (error) { recoveryError = String(error.message || error); }
      }
      self.postMessage({ type: "ready", schema: SQLWorkspaceCore.getSchema(database), views: SQLViewManager.capture(database), restoredViews, recoveryError });
    } else if (request.type === "view") {
      if (!database) throw new Error("The database is still loading.");
      try {
        let result = {};
        if (request.action === "read") result.view = SQLViewManager.getDefinition(database, request.name);
        else if (request.action === "save") result = SQLViewManager.saveView(database, request.name, request.query);
        else if (request.action === "drop") SQLViewManager.dropView(database, request.name);
        else throw new Error("Unknown view action.");
        self.postMessage(Object.assign({ type: "view-result", id: request.id, action: request.action, schema: SQLWorkspaceCore.getSchema(database), views: SQLViewManager.capture(database) }, result));
      } catch (error) {
        self.postMessage({ type: "view-result", id: request.id, action: request.action, error: String(error.message || error) });
      }
    } else if (request.type === "query") {
      if (!database) throw new Error("The database is still loading.");
      const start = performance.now();
      const output = SQLWorkspaceCore.executeSQL(database, request.sql, request.limit);
      let schema, schemaWarning;
      try { schema = SQLWorkspaceCore.getSchema(database); } catch (e) { schemaWarning = String(e.message || e); }
      self.postMessage(Object.assign({ type: "result", id: request.id, elapsed: performance.now() - start, schema, schemaWarning, views: SQLViewManager.capture(database) }, output));
    }
  } catch (error) {
    self.postMessage({ type: "fatal", message: String(error.message || error) });
  }
};
