(async function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const config = window.SQL_WORKSPACE_CONFIG;
  const sessions = window.SQLWorkspaceSession;
  const mode = document.body.dataset.workspace;
  let session;
  function showSessionGate(title, message) {
    $("session-title").textContent = title;
    $("session-message").textContent = message;
    $("session-retry").hidden = false;
  }
  $("session-retry").addEventListener("click", () => window.location.reload());
  try {
    let testSettings;
    if (mode === "test") {
      const response = await fetch("test-settings.json", { cache: "no-store" });
      if (!response.ok) throw new Error("The test settings could not be loaded.");
      testSettings = await response.json();
    }
    session = sessions.resolve(mode, config, testSettings);
  } catch (_) {
    showSessionGate("Workspace unavailable", "The workspace settings could not be verified. Check again, or ask your instructor for help.");
    return;
  }
  $("workspace-label").textContent = session.label;
  document.title = mode === "test" ? "SQL Workspace · Test" : "SQL Workspace · Practice";
  if (!session.open) {
    showSessionGate("The test is not open", "Wait for your instructor to open the test, then select Check again.");
    return;
  }
  $("session-gate").hidden = true;
  $("workspace").hidden = false;
  $("top-actions").hidden = false;
  const core = window.SQLWorkspaceCore;
  const support = window.SQLWorkspaceEditorSupport;
  const keywordNames = Object.keys(CodeMirror.resolveMode("text/x-sqlite").keywords);
  const limit = Math.max(1, Number(config.maxDisplayedRows) || 1000);
  const pageSize = Math.max(1, Number(config.pageSize) || 100);
  const state = { ready: false, busy: false, schema: [], expanded: new Set(), results: [], active: 0, page: 0, id: 0, timer: null, context: null };
  let worker, errorLine = null, errorWidget = null, cleanupUndo = null, draftWarning = false, activeView = null, viewSnapshot = null, draftLoadWarning = false;
  const editor = CodeMirror.fromTextArea($("sql-editor"), {
    mode: "text/x-sqlite", lineNumbers: true, lineWrapping: false, indentUnit: 2,
    tabSize: 2, autofocus: true, spellcheck: false, inputStyle: "textarea",
    gutters: ["CodeMirror-linenumbers", "sql-errors"],
    extraKeys: {
      "Ctrl-Enter": runSQL, "Cmd-Enter": runSQL, "Shift-Enter": runSQL,
      "Ctrl-Space": showCompletion, "Cmd-Space": showCompletion,
      "Tab": cm => cm.replaceSelection("  ", "end", "+input")
    }
  });
  editor.getInputField().setAttribute("aria-label", "SQL editor");
  editor.getInputField().setAttribute("autocorrect", "off");
  editor.getInputField().setAttribute("autocapitalize", "off");
  $("database-name").textContent = config.databaseName;
  let initial = mode === "test" ? "" : (config.initialSQL || "");
  if (config.preserveQueryInTab) {
    try {
      const saved = sessions.load(sessionStorage, session, initial);
      initial = saved.sql;
      if (saved.databasePath === config.databasePath) viewSnapshot = saved.views;
    }
    catch (_) { draftLoadWarning = true; }
  }
  editor.setValue(initial); editor.clearHistory();

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function notify(message, undo) {
    $("notice-text").textContent = message;
    $("notice").hidden = false;
    cleanupUndo = undo || null;
    $("notice-undo").hidden = !cleanupUndo;
  }
  function updateCursor() {
    const cursor = editor.getCursor();
    $("cursor-status").textContent = "Ln " + (cursor.line + 1) + ", Col " + (cursor.ch + 1);
    const selected = editor.somethingSelected();
    $("selection-hint").textContent = selected ? "Only selected SQL will run" : "Run executes all SQL";
    if (!state.busy) $("run-label").textContent = selected ? "Run selection" : "Run";
    $("copy-button").title = selected ? "Copy the selected SQL as plain text" : "Copy all SQL as plain text";
  }
  function clearErrorHighlight() {
    if (errorLine !== null) editor.removeLineClass(errorLine, "background", "error-line");
    errorLine = null;
    if (errorWidget) errorWidget.clear();
    errorWidget = null;
    editor.clearGutter("sql-errors");
  }
  function completionResult(cm) {
    if (!support) return null;
    const cursor = cm.getCursor();
    const token = cm.getTokenAt(cursor, true);
    const type = token.type || "";
    // Leave quoted values, comments, numeric literals, and quoted identifiers
    // unchanged. No suggestions are inserted without an explicit selection.
    if (/\b(comment|string|number)\b/.test(type) || /^[\u0022\u0027\u0060\[]/.test(token.string)) return null;
    const found = support.completeNames(cm.getLine(cursor.line), cursor.ch, state.ready ? state.schema : [], keywordNames);
    const list = found.list.map(item => Object.assign({}, item, {
      render: function (node) {
        node.append(element("span", "completion-name", item.displayText), element("span", "completion-detail", item.detail));
        node.title = item.displayText + " · " + item.detail;
      }
    }));
    return { list, from: CodeMirror.Pos(cursor.line, found.from), to: CodeMirror.Pos(cursor.line, found.to) };
  }
  function showCompletion() {
    if (!support || typeof editor.showHint !== "function") {
      notify("Completion is unavailable. You can continue typing and running SQL."); editor.focus(); return;
    }
    if (editor.somethingSelected()) {
      notify("Place the cursor in a word or at an insertion point to show completions.");
      editor.focus(); return;
    }
    const result = completionResult(editor);
    if (!result || !result.list.length) {
      notify("No matching completions at this position."); editor.focus(); return;
    }
    editor.focus();
    editor.showHint({
      hint: completionResult, completeSingle: false, closeOnUnfocus: true,
      extraKeys: {
        "Ctrl-Enter": function (cm, handle) { handle.close(); runSQL(); },
        "Cmd-Enter": function (cm, handle) { handle.close(); runSQL(); },
        "Shift-Enter": function (cm, handle) { handle.close(); runSQL(); }
      }
    });
  }
  function saveDraft() {
    if (!config.preserveQueryInTab) return;
    try { sessions.save(sessionStorage, session, editor.getValue(), viewSnapshot, config.databasePath); }
    catch (_) {
      if (!draftWarning) { notify("This browser could not save your SQL and views for recovery. Copy your work into Canvas before leaving."); draftWarning = true; }
    }
  }
  editor.on("cursorActivity", updateCursor);
  editor.on("changes", function (_, changes) {
    clearErrorHighlight();
    saveDraft();
    if (cleanupUndo && changes.some(c => c.origin !== "cleanup")) {
      cleanupUndo = null; $("notice-undo").hidden = true;
    }
    if (changes.some(c => c.origin === "paste")) setTimeout(() => cleanEditor(false), 0);
    updateCursor();
  });

  function cleanEditor(announceUnchanged) {
    const original = editor.getValue();
    const cleaned = core.normalizeSQL(original);
    if (!cleaned.changed) {
      if (announceUnchanged) notify("No formatting characters needed cleanup. Quoted values and comments are left unchanged.");
      return false;
    }
    const selections = editor.listSelections();
    const mapped = selections.map(range => ({
      anchor: core.normalizeSQL(original.slice(0, editor.indexFromPos(range.anchor))).text.length,
      head: core.normalizeSQL(original.slice(0, editor.indexFromPos(range.head))).text.length
    }));
    const scroll = editor.getScrollInfo();
    editor.operation(function () {
      editor.replaceRange(cleaned.text, { line: 0, ch: 0 }, editor.posFromIndex(original.length), "cleanup");
      editor.setSelections(mapped.map(r => ({ anchor: editor.posFromIndex(r.anchor), head: editor.posFromIndex(r.head) })));
      editor.scrollTo(scroll.left, scroll.top);
    });
    notify(core.changeDescription(cleaned.changes), function () {
      if (editor.getValue() !== cleaned.text) { notify("The SQL has changed since cleanup. Use the editor’s Undo command to review previous edits."); return; }
      editor.replaceRange(original, { line: 0, ch: 0 }, editor.posFromIndex(cleaned.text.length), "undo-cleanup");
      editor.setSelections(selections); editor.focus();
      notify("Original pasted text restored.");
    });
    return true;
  }

  function setBusy(busy) {
    state.busy = busy;
    $("query-workspace").classList.toggle("busy", busy);
    $("run-button").classList.toggle("running", busy);
    $("run-icon").textContent = busy ? "■" : "▶︎";
    $("run-label").textContent = busy ? "Stop" : (editor.somethingSelected() ? "Run selection" : "Run");
    $("run-button").disabled = !state.ready && !busy;
    $("reset-button").disabled = busy || !state.ready;
    $("schema-search").disabled = busy;
    $("clear-results").disabled = busy;
    document.querySelectorAll(".preview-button, .view-edit-button").forEach(b => { b.disabled = busy || !state.ready; });
    ["view-save", "view-delete", "view-copy", "view-query"].forEach(id => { $(id).disabled = busy || !activeView; });
    ["view-close", "view-done"].forEach(id => { $(id).disabled = busy; });
  }
  function updateDatabaseState(label, failed) {
    $("db-state").replaceChildren();
    const dot = element("i"); if (failed) dot.style.background = "#c45b48";
    $("db-state").append(dot, document.createTextNode(label));
  }
  function renderSchema(schema) {
    if (editor.closeHint) editor.closeHint();
    state.schema = schema;
    const filter = $("schema-search").value.toLowerCase().trim();
    const tableList = $("table-list");
    tableList.replaceChildren();
    $("table-count").textContent = String(schema.length);
    const filtered = schema.filter(table => !filter || table.name.toLowerCase().includes(filter) || table.columns.some(c => c.name.toLowerCase().includes(filter)));
    for (const table of filtered) {
      const open = state.expanded.has(table.name) || !!filter;
      const group = element("div", "table-group"), heading = element("div", "table-heading" + (open ? " open" : ""));
      const toggle = element("button", "table-toggle");
      toggle.type = "button"; toggle.setAttribute("aria-expanded", String(open)); toggle.title = table.name + " · " + table.columns.length + " columns";
      const glyph = element("span", "table-glyph");
      for (let i = 0; i < 4; i++) glyph.append(element("i"));
      glyph.setAttribute("aria-hidden", "true");
      toggle.append(element("span", "chevron", open ? "⌄" : "›"), glyph, element("span", "table-label", table.name));
      toggle.addEventListener("click", function () {
        if (state.expanded.has(table.name)) state.expanded.delete(table.name); else state.expanded.add(table.name);
        renderSchema(state.schema);
      });
      const preview = element("button", "preview-button", "Preview");
      preview.setAttribute("aria-label", "Preview " + table.name);
      preview.disabled = !state.ready || state.busy;
      preview.addEventListener("click", () => execute("SELECT * FROM main." + core.quoteName(table.name) + ";", { preview: table.name, baseOffset: 0, editorText: null }));
      heading.append(toggle, preview); group.append(heading);
      if (table.type === "view") {
        const actions = element("div", "view-actions");
        actions.append(element("span", "view-badge", "View"));
        const edit = element("button", "text-button view-edit-button", "View SQL / Edit");
        edit.setAttribute("aria-label", "View SQL or edit " + table.name);
        edit.disabled = !state.ready || state.busy;
        edit.addEventListener("click", () => openView(table.name));
        actions.append(edit); group.append(actions);
      }
      if (open) {
        const columns = element("div", "column-list");
        if (table.schemaError) columns.append(element("p", "view-schema-error", table.schemaError));
        for (const column of table.columns) {
          const row = element("div", "column-row"), name = element("span", "column-name");
          if (column.primary) { const key = element("span", "pk", "◆"); key.title = "Primary key"; name.append(key); }
          name.append(document.createTextNode(column.name));
          name.title = column.name + (column.primary ? " (primary key)" : "");
          const type = element("span", "column-type", column.type); type.title = column.type;
          row.append(name, type); columns.append(row);
        }
        group.append(columns);
      }
      tableList.append(group);
    }
    if (!filtered.length) tableList.append(element("p", "muted loading", schema.length ? "No matching tables or columns." : "No tables in this database."));
  }
  function emptyState(title, message, icon) {
    const wrapper = element("div", "empty-state");
    wrapper.append(element("div", "empty-icon", icon || "▤"), element("h3", null, title), element("p", null, message));
    $("results-body").replaceChildren(wrapper);
  }
  function clearResults() {
    state.results = []; state.active = 0; state.page = 0;
    $("results-heading").textContent = "Results";
    $("row-count").hidden = true; $("error-panel").hidden = true; $("result-tabs").hidden = true;
    $("pagination").hidden = true; $("clear-results").hidden = true; $("execution-time").textContent = "";
    $("result-detail").textContent = "Ready when you are.";
    clearErrorHighlight();
    emptyState("Your results will appear here", "Write a query and select Run, or preview a table from the left.");
  }
  function startWorker(message, stoppedReason, savedViews) {
    if ($("view-dialog").open) $("view-dialog").close();
    activeView = null;
    if (editor.closeHint) editor.closeHint();
    if (worker) worker.terminate();
    clearTimeout(state.timer);
    state.ready = false; state.context = null;
    setBusy(false); updateDatabaseState("Loading database");
    $("reset-button").disabled = true;
    const currentWorker = new Worker("worker.js?v=4");
    worker = currentWorker;
    state.timer = setTimeout(() => failLoading("The database took too long to load. Check your connection and select Retry database."), 30000);
    currentWorker.onmessage = function (event) {
      if (worker !== currentWorker) return;
      const data = event.data;
      if (data.type === "ready") {
        clearTimeout(state.timer); state.ready = true; setBusy(false);
        viewSnapshot = data.views; saveDraft();
        if (!state.expanded.size && data.schema.length) state.expanded.add(data.schema[0].name);
        renderSchema(data.schema); updateDatabaseState("Database ready");
        $("reset-button").textContent = "Reset database";
        if (stoppedReason) {
          emptyState(stoppedReason, "The original database has been restored. Your SQL is still in the editor.", "■");
          $("result-detail").textContent = "Database restored. Ready to run another query.";
        }
        if (message) notify(message);
        else if (data.recoveryError) notify("Saved views could not be restored: " + data.recoveryError + ". Your SQL was kept.");
        else if (draftLoadWarning) notify("The previous browser draft could not be restored. Copy your answers into Canvas as you work.");
        else if (data.restoredViews) notify("Restored " + data.restoredViews + (data.restoredViews === 1 ? " saved view." : " saved views.") + " Table data was reloaded from the original database.");
      } else if (data.type === "view-result" && state.context && state.context.kind === "view" && data.id === state.context.id) {
        clearTimeout(state.timer); setBusy(false);
        if (data.error) {
          $("view-error").textContent = data.error; $("view-error").hidden = false;
          $("view-status").textContent = "";
          return;
        }
        if (data.schema) renderSchema(data.schema);
        viewSnapshot = data.views; saveDraft();
        if (data.action === "drop") {
          const name = activeView.name;
          activeView = null; $("view-dialog").close(); clearResults();
          notify("View deleted: " + name + ". Your SQL was kept.");
        } else {
          activeView = data.view;
          $("view-query").value = activeView.query;
          $("view-definition").textContent = activeView.sql;
          setBusy(false);
          $("view-status").textContent = data.action === "save" ? "Changes saved." + (data.cleaned ? " Pasted formatting characters were cleaned." : "") : "";
          if (data.action === "save") clearResults();
        }
      } else if (data.type === "result" && state.context && data.id === state.context.id) {
        clearTimeout(state.timer); setBusy(false);
        viewSnapshot = data.views; saveDraft();
        if (data.schema) renderSchema(data.schema);
        presentResults(data);
        if (data.schemaWarning) notify("The query completed, but the table list could not refresh: " + data.schemaWarning);
      } else if (data.type === "fatal") {
        failLoading(data.message);
      }
    };
    currentWorker.onerror = function (event) {
      if (worker === currentWorker) failLoading(event.message || "The SQL engine could not start. Make sure all website files were uploaded.");
    };
    currentWorker.postMessage({ type: "init", path: config.databasePath, views: savedViews || null });
  }
  function failLoading(message) {
    clearTimeout(state.timer); if (worker) worker.terminate();
    state.ready = false; setBusy(false);
    updateDatabaseState("Database unavailable", true);
    $("reset-button").textContent = "Retry database"; $("reset-button").disabled = false;
    $("table-list").replaceChildren(element("p", "muted loading", "The database could not load."));
    showError({ title: "Database could not load", message, explanation: "Select Retry database. If this continues, ask your instructor to check that the database and SQL engine files are available at this website.", statementNo: null }, null);
    $("result-detail").textContent = "The editor is still available. Your SQL has been kept.";
  }
  function runSQL() {
    if (state.busy) { stopQuery(false); return; }
    if (!state.ready) return;
    cleanEditor(false);
    const allSQL = editor.getValue();
    const selected = editor.somethingSelected();
    const sql = selected ? editor.getSelection() : allSQL;
    if (!sql.trim()) { notify("Write a SQL statement, or preview a table from the left."); editor.focus(); return; }
    execute(sql, { preview: null, baseOffset: selected ? editor.indexFromPos(editor.getCursor("from")) : 0, editorText: allSQL });
  }
  function execute(sql, context) {
    if (!state.ready || state.busy) return;
    if (editor.closeHint) editor.closeHint();
    state.id++; state.context = Object.assign({ id: state.id, sql }, context);
    state.results = []; state.active = 0; state.page = 0;
    $("error-panel").hidden = true; $("result-tabs").hidden = true; $("pagination").hidden = true;
    $("row-count").hidden = true; $("execution-time").textContent = "";
    $("results-heading").textContent = context.preview ? "Preview · " + context.preview : "Results";
    $("clear-results").hidden = false;
    $("result-detail").textContent = "Running query…";
    clearErrorHighlight(); setBusy(true);
    emptyState("Running your SQL", "You can stop a long query using the Stop button. Stopping restores the original database.", "⋯");
    state.timer = setTimeout(() => stopQuery(true), Math.max(1000, Number(config.queryTimeoutMs) || 15000));
    worker.postMessage({ type: "query", id: state.id, sql, limit });
  }
  function stopQuery(timedOut) {
    if (!state.busy) return;
    clearResults();
    emptyState(timedOut ? "Query reached its time limit" : "Query stopped", "The original database is being restored. Your SQL is still in the editor.", "■");
    $("result-detail").textContent = "Resetting database…";
    startWorker((timedOut ? "Query stopped after " + Math.round((Number(config.queryTimeoutMs) || 15000) / 1000) + " seconds. " : "Query stopped. ") + "The database was reset; your SQL was kept.", timedOut ? "Query reached its time limit" : "Query stopped");
  }
  function openView(name) {
    if (!state.ready || state.busy) return;
    activeView = null;
    $("view-title").textContent = "View · " + name;
    $("view-query").value = ""; $("view-definition").textContent = "";
    $("view-original").open = false;
    $("view-dialog").showModal();
    requestView("read", name);
  }
  function requestView(action, name) {
    if (!state.ready || state.busy) return;
    $("view-error").hidden = true;
    $("view-status").textContent = action === "read" ? "Loading view…" : action === "save" ? "Saving changes…" : "Deleting view…";
    state.id++; state.context = { id: state.id, kind: "view", action, name };
    setBusy(true);
    state.timer = setTimeout(() => stopQuery(true), Math.max(1000, Number(config.queryTimeoutMs) || 15000));
    worker.postMessage({ type: "view", id: state.id, action, name, query: $("view-query").value });
  }
  function showError(error, context) {
    const panel = $("error-panel"); panel.replaceChildren(); panel.hidden = false;
    panel.append(element("h3", null, error.title || "SQL error"));
    if (error.explanation) panel.append(element("p", null, error.explanation));
    panel.append(element("pre", null, error.message));
    if (error.statementNo) {
      let line = 1;
      if (context) {
        const full = context.editorText || context.sql;
        const offset = (context.baseOffset || 0) + (error.start || 0);
        line = full.slice(0, offset).split("\n").length;
        if (!context.preview && context.editorText === editor.getValue()) {
          const anchor = support ? support.errorAnchor(context.editorText, context.sql, context.baseOffset || 0, error) : { line: line - 1, ch: 0 };
          errorLine = editor.addLineClass(anchor.line, "background", "error-line");
          const marker = element("span", "inline-error-marker", "!");
          marker.title = error.message;
          marker.setAttribute("aria-label", "Failed statement: " + error.message);
          editor.setGutterMarker(anchor.line, "sql-errors", marker);
          const inline = element("div", "inline-sql-error");
          inline.append(element("span", "inline-error-label", "Statement " + error.statementNo), element("code", null, error.message));
          inline.title = "Error reported after Run. Marker is at the statement start.";
          errorWidget = editor.addLineWidget(anchor.line, inline, { coverGutter: false, noHScroll: true });
          editor.scrollIntoView({ line: anchor.line, ch: anchor.ch }, 35);
        }
      }
      panel.append(element("p", "error-context", "Statement " + error.statementNo + " · starts near line " + line + "."));
    }
  }
  function presentResults(data) {
    state.results = data.results; state.active = Math.max(0, data.results.length - 1); state.page = 0;
    $("execution-time").textContent = data.elapsed < 1000 ? Math.round(data.elapsed) + " ms" : (data.elapsed / 1000).toFixed(2) + " s";
    if (data.error) showError(data.error, state.context);
    renderResultTabs();
    if (state.results.length) {
      renderActiveResult();
      if (data.error) $("result-detail").textContent += " Earlier statements completed; execution stopped at the error.";
    } else {
      $("row-count").hidden = true;
      emptyState(data.error ? "No result set returned" : "No executable statement", data.error ? "Execution stopped." : "The editor contains only comments, separators, or whitespace.");
      $("result-detail").textContent = data.error ? "Execution stopped at statement " + data.error.statementNo + "." : "No statements executed.";
    }
  }
  function renderResultTabs() {
    const tabs = $("result-tabs"); tabs.replaceChildren();
    tabs.hidden = state.results.length < 2;
    state.results.forEach((result, index) => {
      const label = "Statement " + result.statementNo + (result.columns.length ? " · " + result.rowCount.toLocaleString() + " rows" : " · done");
      const tab = element("button", "result-tab", label);
      tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", String(index === state.active));
      tab.title = result.sql;
      tab.addEventListener("click", () => { state.active = index; state.page = 0; renderResultTabs(); renderActiveResult(); });
      tabs.append(tab);
    });
  }
  function renderActiveResult() {
    const result = state.results[state.active]; if (!result) return;
    const body = $("results-body"); body.replaceChildren(); body.scrollTop = 0; body.scrollLeft = 0;
    $("pagination").hidden = true;
    if (!result.columns.length) {
      $("row-count").hidden = true;
      emptyState("Statement completed", result.changedRows ? result.changedRows.toLocaleString() + (result.changedRows === 1 ? " row changed." : " rows changed.") : "Executed successfully. This statement does not return a result set.", "✓");
      $("result-detail").textContent = "Statement " + result.statementNo + " completed.";
      return;
    }
    $("row-count").textContent = result.rowCount.toLocaleString() + (result.rowCount === 1 ? " row returned" : " rows returned");
    $("row-count").hidden = false;
    const table = element("table", "data-table");
    table.setAttribute("aria-label", state.context && state.context.preview ? state.context.preview + " records" : "SQL result set");
    const head = element("thead"), headRow = element("tr"), corner = element("th", "row-number", "#");
    corner.scope = "col"; headRow.append(corner);
    result.columns.forEach(column => { const th = element("th", null, column); th.scope = "col"; headRow.append(th); });
    head.append(headRow); table.append(head);
    const tbody = element("tbody"), first = state.page * pageSize;
    result.values.slice(first, first + pageSize).forEach((values, offset) => {
      const row = element("tr"); row.append(element("td", "row-number", String(first + offset + 1)));
      values.forEach(value => {
        const td = element("td");
        if (value === null) { td.className = "null-cell"; td.textContent = "NULL"; }
        else if (typeof value === "object" && value.blob) {
          td.textContent = "BLOB · " + value.length + " bytes"; td.title = value.hex + (value.length > 24 ? "…" : "");
        } else { td.textContent = String(value); if (typeof value === "number") td.className = "numeric"; }
        row.append(td);
      });
      tbody.append(row);
    });
    table.append(tbody); body.append(table);
    if (!result.rowCount) body.append(element("div", "empty-zero", "The query ran successfully and returned no rows."));
    const end = Math.min(first + pageSize, result.values.length);
    $("result-detail").textContent = result.rowCount ? "Showing " + (first + 1).toLocaleString() + "–" + end.toLocaleString() + " of " + result.rowCount.toLocaleString() + " rows" + (result.truncated ? " · Preview limited to the first " + limit.toLocaleString() + " rows." : ".") : "0 rows · " + result.columns.length + (result.columns.length === 1 ? " column" : " columns");
    if (result.values.length > pageSize) {
      $("pagination").hidden = false;
      $("page-label").textContent = (state.page + 1) + " / " + Math.ceil(result.values.length / pageSize);
      $("page-prev").disabled = state.page === 0;
      $("page-next").disabled = end >= result.values.length;
    }
  }

  async function copySQL() {
    const sql = editor.somethingSelected() ? editor.getSelection() : editor.getValue();
    if (!sql.length) { notify("There is no SQL to copy yet."); return; }
    const copied = await copyText(sql);
    notify(copied ? "SQL copied as plain text. Paste it into your Canvas answer." : "This browser blocked the Copy button. Select your SQL and try Ctrl+C (Cmd+C on Mac). Clipboard use still depends on your exam settings.");
  }
  async function copyText(sql) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(sql);
      return true;
    } catch (_) {
      // A regular user-initiated browser copy; exam-browser restrictions still apply.
      const input = element("textarea");
      input.value = sql; input.style.position = "fixed"; input.style.left = "-9999px";
      const target = document.activeElement;
      ($("view-dialog").open ? $("view-dialog") : document.body).append(input); input.select();
      let copied = false;
      try { copied = document.execCommand("copy"); } catch (_) {}
      input.remove(); if (target && target.focus) target.focus();
      return copied;
    }
  }
  $("run-button").addEventListener("click", runSQL);
  $("copy-button").addEventListener("click", copySQL);
  $("clean-button").addEventListener("click", () => cleanEditor(true));
  $("complete-button").addEventListener("click", showCompletion);
  $("schema-search").addEventListener("input", () => renderSchema(state.schema));
  $("clear-results").addEventListener("click", clearResults);
  $("page-prev").addEventListener("click", () => { state.page--; renderActiveResult(); });
  $("page-next").addEventListener("click", () => { state.page++; renderActiveResult(); });
  $("notice-close").addEventListener("click", () => { $("notice").hidden = true; cleanupUndo = null; });
  $("notice-undo").addEventListener("click", () => { const action = cleanupUndo; if (action) action(); });
  $("help-button").addEventListener("click", () => $("help-dialog").showModal());
  $("help-close").addEventListener("click", () => $("help-dialog").close());
  $("help-done").addEventListener("click", () => $("help-dialog").close());
  $("view-save").addEventListener("click", () => { if (activeView) requestView("save", activeView.name); });
  $("view-delete").addEventListener("click", () => {
    if (!activeView || !window.confirm("Delete view “" + activeView.name + "”? Its definition will be removed from this tab. The underlying tables will be kept.")) return;
    requestView("drop", activeView.name);
  });
  $("view-copy").addEventListener("click", async () => {
    if (!activeView) return;
    const copied = await copyText(activeView.prefix + "\n" + $("view-query").value);
    $("view-status").textContent = copied ? "View SQL copied. Unsaved edits are included." : "Copy was blocked. Select the query and use Ctrl+C (Cmd+C on Mac).";
  });
  ["view-close", "view-done"].forEach(id => $(id).addEventListener("click", () => $("view-dialog").close()));
  $("view-dialog").addEventListener("cancel", event => { if (state.busy) event.preventDefault(); });
  $("view-query").addEventListener("input", () => {
    $("view-status").textContent = "Unsaved changes";
    $("view-error").hidden = true;
  });
  $("reset-button").addEventListener("click", function () {
    if (state.ready && !window.confirm("Restore the original database? Any database changes in this tab will be lost. Your SQL will be kept.")) return;
    clearResults(); startWorker("The original database has been restored. Your SQL was kept.");
  });
  const splitter = $("splitter");
  function resize(percent) {
    const amount = Math.max(20, Math.min(80, percent));
    document.documentElement.style.setProperty("--editor-height", amount + "%");
    splitter.setAttribute("aria-valuenow", String(Math.round(amount))); editor.refresh();
  }
  splitter.addEventListener("pointerdown", function (event) {
    splitter.setPointerCapture(event.pointerId); document.body.classList.add("dragging");
    event.preventDefault();
  });
  splitter.addEventListener("pointermove", function (event) {
    if (!splitter.hasPointerCapture(event.pointerId)) return;
    const rect = $("query-workspace").getBoundingClientRect();
    resize((event.clientY - rect.top) / rect.height * 100);
  });
  function endResize() { document.body.classList.remove("dragging"); }
  splitter.addEventListener("pointerup", endResize);
  splitter.addEventListener("lostpointercapture", endResize);
  splitter.addEventListener("keydown", function (event) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault(); resize(Number(splitter.getAttribute("aria-valuenow")) + (event.key === "ArrowUp" ? -5 : 5));
    }
  });
  new ResizeObserver(() => editor.refresh()).observe($("editor-host"));
  window.addEventListener("beforeunload", saveDraft);
  updateCursor();
  startWorker(undefined, undefined, viewSnapshot);
}());
