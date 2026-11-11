# SQL Skills Workspace

A self-contained SQLite editor for Johan Perols’s skills tests.

The student-facing site has a searchable table/column browser on the left,
a SQL editor at upper right, results below it, and a Run button at the top.
Table previews do not replace students’ SQL. SQL errors show the original
SQLite message in the results panel and inline at the failed statement.
Completion offers SQLite keywords and names from the current database.
There are no added error explanations, suggested query corrections, or AI.

## Practice and test separation

- **Practice:** https://jperols.github.io/sql-skills-workspace/
- **Test:** https://jperols.github.io/sql-skills-workspace/test.html

The original link is the practice workspace. Both pages are open continuously;
the test page uses `northwind-test-v1`. Closing the test remains optional.
Each page has its own saved SQL draft and view definitions. Test drafts and views
also belong to one test ID.
Practice drafts and drafts from the earlier unseparated editor are never restored
on the test page. Both pages load a fresh copy of the same bundled database;
student-created views and changes are not shared.

### Start each new test with fresh work

1. In this repository, open `test-settings.json`, then select the pencil to edit.
2. Change `testId` to a **new, never-used value** for this test, for example
   `mgt153-2026-11-16-section1`. Use letters, numbers, hyphens, or underscores.
   Change `label` if you want a different displayed test name.
3. Leave `open` set to `true` and commit the change to `main`. To prevent prepared
   work from returning, publish the new ID at the start of the exam rather than
   in advance. Leave `config.js` unchanged.
4. Wait for the GitHub Pages deployment to succeed. Reload the test link and
   verify that the right label appears and the editor starts empty in a fresh tab.
5. Give students the **test** link in Canvas. Students already on the waiting
   page select **Check again**. Have students open/reload this link for each new
   test; an old page left open is still the old running session.

For example, the complete settings file for a new test can be:

```json
{
  "open": true,
  "testId": "mgt153-2026-11-16-section1",
  "label": "MGT 153 · Skills Test 1"
}
```

You can leave both pages open at all times. If you want to close the test,
set `open` to `false` and commit; set it back to `true` to reopen. Closing affects
new visits and refreshes after deployment, not tabs already open.
For the next exam, use another new ID and have students reload. Reusing an ID
can restore that test's old draft and views in a surviving browser session.
If the test page stays open under the same ID, students can prepare work there
before the exam; separation from the practice page alone does not prevent that.

Refreshing during the same test restores that test's SQL and saved view
definitions, if session storage is available. The original database is loaded
first and saved views are recreated; table data changes and newly created tables
are not restored. After a browser crash or restart, recovery works only if the
browser restores the same session storage. Students must submit answers through Canvas;
this workspace is not permanent storage or a submission system.

The test page fetches the settings anew before it reads any saved draft. Closed,
missing, or invalid settings show a waiting/error page without starting the
editor. The query string cannot select a different test or draft ID. Practice
has no link or switch into the test workspace, and the test workspace has no link
back to practice.

This separates drafts and prevents automatic practice-to-test carryover. The
closed screen and test ID are **not authentication or a security boundary**:
this is a public static website. They do not stop deliberate copying, retyping,
or manipulation outside LockDown Browser. Test the actual Canvas/Respondus
workflow, including whether practice pages remain reachable, before an exam.

## Publish with your own GitHub account

GitHub Pages is available with GitHub Free for public repositories.
You control the files and updates; students do not need GitHub accounts to use
the published website. A public site makes its database and source files public.
The included Northwind database was already publicly available at the source
linked below. Keep exam answers, credentials, and private student records out
of the site.

1. Extract **SQL_Workspace_GitHub_Pages.zip** on your computer.
2. Create a new **public** repository in your GitHub account, for example
   **sql-skills-workspace**. This keeps the application separate from your
   existing Skills-Test-Data-Source repository.
3. Open the new repository, select **Add file → Upload files**, and drag the
   **contents of the extracted folder** into the upload area. Include the
   **assets** and **data** folders and their contents. **index.html** must be at the
   repository root, alongside config.js, app.js, worker.js, sql-core.js,
   styles.css, editor-support.js, and icon.svg. Commit the upload to **main**.
4. Open **Settings → Pages**. Under **Build and deployment**, choose
   **Deploy from a branch**. Choose **main** and **/(root)**, then **Save**.
5. Wait for GitHub Pages to finish deploying, then use the **Visit site** link
   displayed by GitHub. This is the link to put in your Canvas exam.
6. Run a short practice quiz through your actual LockDown Browser setup,
   using the checks below.

Upload the extracted files, not the ZIP itself. The page must be served by a
website; double-clicking the HTML on your computer is not a supported way to
load its database and worker.

Official GitHub instructions:
- https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

The private review copy supplied in ChatGPT is for the instructor’s review.
Use your own published GitHub Pages version for student access.

## View controls

A view runs in the current browser tab's in-memory database. Its saved definition
is also kept in that tab's session storage, alongside the SQL draft, so a refresh
can restore it for the same practice or test ID. Nothing is uploaded or shared
with another student, device, or test ID. A full browser restart recovers work
only if the browser restores that session; manually opening a new tab is not a
recovery guarantee.

Recovery saves definitions after SQL runs and after successful view edits or
deletions. It does not automatically run the editor's SQL. Deleted views stay
deleted after refresh. Unsaved edits in the view dialog are not recovered.
**Reset database**, **Stop**, and the execution time limit deliberately reset
the database and saved view definitions while keeping the main SQL draft.

Table data changes and newly created tables are not recovered. A restored view
that depends on a student-created table may show SQLite's missing-table error
until that table is created again. Main-database view triggers are recovered;
temporary or attached database objects and transaction state are not.

- **Preview** shows the view's rows without changing the main editor.
- **View SQL / Edit** opens the saved query. Students edit the SELECT query and
  select **Save changes**, without entering DROP VIEW or CREATE VIEW commands.
- **Full saved CREATE VIEW statement** shows the complete stored definition.
- **Copy view SQL** copies the complete definition with the current dialog edits,
  including unsaved edits, so it can be submitted through Canvas.
- **Delete view** asks for confirmation, then removes the view. It does not delete
  the underlying tables. SQLite also removes triggers attached to a deleted view.

Saving preserves the view name and any explicit column list. SQLite validates the
replacement before the change is accepted. If validation fails, the original
view and its triggers are restored, and the original SQLite error appears in the
dialog. The main SQL editor is never overwritten by these controls. A successful
save clears stale displayed results; use Preview to see the updated rows.

An edit uses a savepoint, so it does not commit an explicit transaction started
by the student. Normal INSTEAD OF triggers are preserved during an edit. Views
with temporary triggers must be managed in the SQL editor. The sidebar lists
objects in the main database; temporary/attached database objects can still be
used through SQL. Other views that depend on changed column names may need to be
updated by the student as well.

## Student workflow

- Expand a table to see its columns and types. **Preview** displays its rows
  without editing the SQL.
- Write SQLite SQL. **Run**, Ctrl+Enter, Cmd+Enter, or Shift+Enter runs all SQL.
  When text is selected, only the selected text runs.
- Separate statements with semicolons. Results are shown in separate tabs.
  Execution stops at the first error; earlier successful statements remain
  applied. Use explicit transactions if your exercise requires them.
- Press **Ctrl+Space** or select **Complete** for matching keywords, table/view
  names, and column names. Use arrows and Enter or Tab to choose; Escape closes
  the menu. Nothing is inserted automatically, even if only one match exists.
  Choosing a completion replaces only the current word. The popup does not
  open automatically while typing or pasting.
- A known table name followed by a period narrows completion to its columns.
  Otherwise, matching columns are listed with their source tables. Completion
  does not infer aliases, joins, CTEs, or the validity of the surrounding SQL.
  Suggestions are not shown inside comments, text values, or identifiers
  already being entered in quotes.
- **Copy SQL** copies selected text, or the full editor when nothing is selected,
  as plain text. Paste that into the Canvas answer. Clipboard restrictions
  imposed by the exam browser still apply.
- SQL pasted back from Canvas is checked for nonbreaking spaces, common
  invisible formatting characters, control characters, unusual line breaks,
  and curly quote delimiters. The cleanup preserves characters inside existing
  quoted values, quoted identifiers, and comments. A notice lists changes and
  provides Undo cleanup. The **Clean text** button and Run also check the buffer.
  Cleanup cannot recover content that Canvas or the browser removed, and it
  deliberately does not rewrite SQL logic or decode arbitrary HTML entities.
- Errors display SQLite’s own message plus the statement number and statement
  start line. After **Run**, a gutter marker and inline message appear at the
  start of the failed statement. This is not an exact character error location.
  Editing clears the inline marker; errors are not checked in the background.
  There are no extra SQL explanations or correction hints.
- **Reset database** restores the included database while keeping SQL.
  **Stop**, or the execution time limit, terminates the worker and also resets
  the database. Normal queries are not automatically reset.
- When browser storage is available, the SQL draft and saved view definitions
  survive refreshes in the same tab and test ID. A full browser restart depends
  on restoring that same browser session. This is not a cloud backup, exam
  submission, or cross-device save. Table edits do not survive refresh.

## Instructor settings

### Windows and macOS

The same SQLite engine and workspace features are used on both platforms.
In the SQL editor, use Ctrl+Enter on Windows or Command+Enter on Mac to run SQL;
Shift+Enter is an alternative on either platform. Copy/paste and Undo use Ctrl
on Windows and Command on Mac. Redo uses Ctrl+Y or Ctrl+Shift+Z on Windows and
Command+Shift+Z on Mac. Select all uses Ctrl+A or Command+A.

Completion is bound to Control+Space on both platforms, with a Command+Space
binding if the browser receives it. macOS commonly uses Command+Space for
Spotlight and can use Control+Space for switching input sources, so the visible
**Complete** button is the reliable fallback. The Run button is also available.
Clipboard and shortcut availability in LockDown Browser depend on its settings;
test the actual exam flow on both systems. Development browser checks used
Chrome on Linux, not macOS or Respondus.

### Configuration

Edit **config.js** to change these settings:

| Setting | Default | Purpose |
| --- | --- | --- |
| label | Northwind | Practice subtitle and default test label |
| databaseName | northwind_skills_test.db | Displayed database filename |
| databasePath | data/northwind_skills_test.db | Same-site database file to load |
| initialSQL | empty | Initial editor contents for a new draft |
| maxDisplayedRows | 1000 | Maximum stored/displayed rows per result |
| pageSize | 100 | Rows shown on each page |
| queryTimeoutMs | 15000 | Maximum query run time before stop and reset |
| preserveQueryInTab | true | Restore SQL and saved views after refreshing this tab |
| draftVersion | northwind-practice-v1 | Practice draft key only; test IDs are in test-settings.json |

The returned-row count covers the whole executed result, even when only the
first 1,000 rows are available to view. If the query times out, no completed
total is reported. Increase the preview or timeout settings only as needed.

To use a different database, replace data/northwind_skills_test.db or upload a
new SQLite .db file to data/ and update both database settings in config.js.
Keep it on this same website. Commit the update and wait for Pages to redeploy.
The application uses a bundled snapshot: changes to the original GitHub source
database do not automatically update this copy.

For a different exam, change testId in test-settings.json so an older test draft is not
restored. draftVersion affects only practice. Set preserveQueryInTab to false if you do not want draft restoration.

## Practice-quiz checks before an exam

These must be tested in your actual Canvas/LockDown Browser configuration.
The development checks were in ordinary Chrome, not Respondus.

1. Open the website from a Canvas practice quiz in LockDown Browser.
2. Verify all three tables and their columns are visible.
3. Preview a table. Run a query and confirm the expected row count.
4. Copy SQL into the same type of Canvas answer field students will use.
   Paste the answer back into this editor and run it again.
5. Try a misspelled column name and confirm the original SQLite error appears.
6. Try **Complete**, choose a table or column, and run the completed SQL.
   Try Ctrl+Space too; use the visible button if the browser reserves that key.
7. Confirm students can return to the quiz and submit their answers.

Keep all assets on the same website. The application does not contact
SQLiteOnline, an AI service, a CDN, or a remote database, and has no sign-in UI.
This removes SQLiteOnline’s account/AI pathway from this SQL tool. It does not
replace the access controls of Canvas or LockDown Browser, or control other
websites or devices.

## Included data and software

Database snapshot: **northwind_skills_test.db**, retrieved November 11, 2026 from
https://raw.githubusercontent.com/johanperols/Skills-Test-Data-Source/main/northwind_skills_test.db

| Table | Rows | Columns |
| --- | ---: | ---: |
| Customers | 4 | 11 |
| Orders | 12 | 14 |
| OrderDetails | 34 | 5 |

- sql.js 1.13.0 (SQLite compiled to WebAssembly), distributed by the official
  sql.js npm package. License: assets/SQLJS-LICENSE.txt.
- CodeMirror 5.65.16, with the SQL mode, placeholder and completion popup addons, distributed by
  the official codemirror npm package. License: assets/CODEMIRROR-LICENSE.txt.
- Database rights remain with their respective owner.

All runtime dependencies are included. There is no package installation,
build step, database server, subscription, or API key needed to host the
student-facing version on a static web host.

This is SQLite. Functions, extensions, and error wording can differ from the
specific SQLite versions/builds included in SQLiteOnline or Letos.

## Development

The source project keeps the deployable files in **dist/**.
Run checks with: node --test tests/core.test.js tests/editor-support.test.js tests/workspace-session.test.js tests/view-manager.test.js

The portable ZIP places the contents of dist/ at its root for easy GitHub
Pages upload. Instructor documentation accompanies those files.
All source JavaScript is readable in the portable package.
