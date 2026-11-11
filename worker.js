"use strict";
importScripts("assets/sql-wasm.js", "sql-core.js");
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
      self.postMessage({ type: "ready", schema: SQLWorkspaceCore.getSchema(database) });
    } else if (request.type === "query") {
      if (!database) throw new Error("The database is still loading.");
      const start = performance.now();
      const output = SQLWorkspaceCore.executeSQL(database, request.sql, request.limit);
      let schema, schemaWarning;
      try { schema = SQLWorkspaceCore.getSchema(database); } catch (e) { schemaWarning = String(e.message || e); }
      self.postMessage(Object.assign({ type: "result", id: request.id, elapsed: performance.now() - start, schema, schemaWarning }, output));
    }
  } catch (error) {
    self.postMessage({ type: "fatal", message: String(error.message || error) });
  }
};
