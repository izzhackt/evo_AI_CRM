import { createHmac } from "crypto";

export function createScenarios({ assert, rowCount, scalar, unique }) {
const admin = "admin@demo.kg";
const sales = "sales@demo.kg";
const curator = "curator@demo.kg";
const finance = "finance@demo.kg";
const client = "client@demo.kg";

return [
  {
    id: "S01",
    capability: "Auth and route protection",
    scenario: "Unauthenticated staff request is redirected to login.",
    criteria: "GET /dashboard without a session returns a redirect to /login.",
    async run(ctx) {
      const res = await ctx.get("/dashboard");
      assert([303, 307, 308].includes(res.status), `expected redirect, got ${res.status}`);
      assert(res.location?.includes("/login"), `expected /login location, got ${res.location}`);
      return `status ${res.status}, location ${res.location}`;
    },
  },
  {
    id: "S02",
    capability: "Auth and route protection",
    scenario: "Staff credentials authenticate to the role-specific workspace.",
    criteria: "Submitting the real login form with the seeded sales account sets edu_session and redirects to its /sales home.",
    async run(ctx) {
      const post = await ctx.submit("/login", undefined, { names: ["email", "password"] }, {
        email: sales,
        password: "sales123",
      });
      assert(post.setCookie.some((cookie) => cookie.includes("edu_session=")), "login did not set edu_session");
      const redirectTarget = post.location ?? post.actionRedirect;
      assert(redirectTarget?.includes("/sales"), `expected /sales redirect, got ${redirectTarget}`);
      return `login form accepted ${sales}; set edu_session and redirected to ${redirectTarget}`;
    },
  },
  {
    id: "S03",
    capability: "Auth and route protection",
    scenario: "Client portal renders while staff routes reject client sessions.",
    criteria: "Client session can load /portal and is redirected away from /dashboard to /portal.",
    async run(ctx) {
      const cookie = ctx.cookie(client);
      const portal = await ctx.get("/portal", cookie);
      const dashboard = await ctx.get("/dashboard", cookie);
      assert(portal.status === 200, `portal status ${portal.status}`);
      assert(portal.text.includes("EVO") || portal.text.includes("Admissions"), "portal did not render branded content");
      assert([303, 307, 308].includes(dashboard.status), `dashboard status ${dashboard.status}`);
      assert(dashboard.location?.includes("/portal"), `expected /portal redirect, got ${dashboard.location}`);
      return `portal ${portal.status}, dashboard ${dashboard.status} -> ${dashboard.location}`;
    },
  },
  {
    id: "S04",
    capability: "Navigation and admissions copy",
    scenario: "Staff shell exposes admissions CRM navigation and metadata copy.",
    criteria: "Admin dashboard includes EVO Admissions CRM shell plus applications/documents/finance navigation labels.",
    async run(ctx) {
      const res = await ctx.get("/dashboard", ctx.cookie(admin));
      assert(res.status === 200, `dashboard status ${res.status}`);
      for (const text of ["Admissions CRM", "/applications", "/documents", "/finance"]) {
        assert(res.text.includes(text), `missing ${text}`);
      }
      assert(res.text.includes("Command") || res.text.includes("Команд") || res.text.includes("Башкар"), "missing command center copy");
      return "dashboard shell contains EVO Admissions CRM nav links for applications, documents, and finance";
    },
  },
  {
    id: "S05",
    capability: "Role visibility",
    scenario: "Finance role can use finance overview but not admissions document/application queues.",
    criteria: "Finance session loads /finance and receives a server-guarded no-access state for /applications and /documents.",
    async run(ctx) {
      const cookie = ctx.cookie(finance);
      const financePage = await ctx.get("/finance", cookie);
      const apps = await ctx.get("/applications", cookie);
      const docs = await ctx.get("/documents", cookie);
      assert(financePage.status === 200, `finance status ${financePage.status}`);
      assert(!financePage.text.includes("name=\"title\"") || financePage.text.includes("name=\"amount\""), "finance form did not render for finance");
      const noAccessEvidence = [];
      for (const [name, res, protectedValues] of [
        [
          "applications",
          apps,
          ctx.db
            .prepare("SELECT university, program FROM applications")
            .all()
            .flatMap((row) => [row.university, row.program])
            .filter(Boolean),
        ],
        [
          "documents",
          docs,
          ctx.db
            .prepare("SELECT name FROM documents")
            .all()
            .map((row) => row.name)
            .filter(Boolean),
        ],
      ]) {
        const target = `/access-denied?from=%2F${name}`;
        const headerRedirect = [303, 307, 308].includes(res.status);
        assert(
          headerRedirect && res.location?.includes(target),
          `${name} did not redirect to its no-access state: status ${res.status}, location ${res.location}`,
        );
        for (const protectedValue of protectedValues) {
          assert(
            !res.text.includes(String(protectedValue)),
            `${name} exposed protected queue content before its no-access redirect`,
          );
        }
        noAccessEvidence.push(`${name} ${res.status} header no-access`);
      }
      return `finance ${financePage.status}; ${noAccessEvidence.join("; ")}`;
    },
  },
  {
    id: "S06",
    capability: "Command Center",
    scenario: "Command Center metrics, charts, and queue links are admissions-specific.",
    criteria: "Dashboard renders stats from all CRM queues with links to sales, applications, documents, tasks, finance, and clients.",
    async run(ctx) {
      const res = await ctx.get("/dashboard", ctx.cookie(admin));
      assert(res.status === 200, `dashboard status ${res.status}`);
      for (const href of ["/sales", "/applications", "/documents", "/tasks", "/finance", "/clients"]) {
        assert(res.text.includes(`href="${href}"`) || res.text.includes(`href="${href}?`), `missing ${href}`);
      }
      const stats = scalar(ctx, "SELECT COUNT(*) AS clients FROM clients");
      assert(res.text.includes(String(stats.clients)), "dashboard did not include real client count");
      return `dashboard links all core queues; client count evidence ${stats.clients}`;
    },
  },
  {
    id: "S07",
    capability: "Admissions Pipeline",
    scenario: "Admissions Pipeline renders operational columns and existing lead cards.",
    criteria: "GET /sales shows lead statuses, pipeline metrics, and at least one seeded lead card link.",
    async run(ctx) {
      const res = await ctx.get("/sales", ctx.cookie(sales));
      const lead = scalar(ctx, "SELECT id, name FROM leads ORDER BY id LIMIT 1");
      assert(res.status === 200, `sales status ${res.status}`);
      for (const text of ["В обработке МП", "Лид квалифицирован", "Назначена встреча", "Встреча проведена", "Договор подписан", "Лиды без запроса"]) {
        assert(res.text.includes(text), `missing lead status ${text}`);
      }
      assert(res.text.includes(`/sales/${lead.id}`), "missing seeded lead link");
      return `sales page rendered seeded lead ${lead.id} ${lead.name}`;
    },
  },
  {
    id: "S08",
    capability: "Admissions Pipeline",
    scenario: "Add lead Server Action creates an EVO admissions lead.",
    criteria: "Submitting the real Sales /sales lead form inserts a lead with source, target country, amount, and the authenticated Sales owner.",
    async run(ctx) {
      const name = unique("Scenario Lead");
      await ctx.submit("/sales", ctx.cookie(sales), { names: ["name", "phone", "email", "source", "target_country", "amount"] }, {
        name,
        phone: "+996700800801",
        email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
        source: "scenario-web",
        target_country: "Canada",
        amount: "120000",
      });
      const row = scalar(ctx, "SELECT id, status, target_country, amount, manager_id FROM leads WHERE name = ?", [name]);
      assert(row, "lead was not inserted");
      assert(
        row.status === "processing_mp"
          && row.target_country === "Canada"
          && row.amount === 120000
          && row.manager_id === ctx.user(sales).id,
        "lead fields or authenticated owner incorrect",
      );
      return `created lead ${row.id} status ${row.status}, ${row.target_country}, ${row.amount} KGS; owner forced to Sales ${row.manager_id}`;
    },
  },
  {
    id: "S09",
    capability: "Admissions Pipeline",
    scenario: "Move lead Server Action updates lead status and activity.",
    criteria: "Submitting a lead move form changes status to meeting scheduled and records a status activity.",
    async run(ctx) {
      const leadId = ctx.firstLeadId("status != 'contract_signed' AND status != 'no_request'");
      await ctx.submit(`/sales/${leadId}`, ctx.cookie(sales), { names: ["id", "status"], includes: [`value="${leadId}"`] }, {
        id: leadId,
        status: "meeting_scheduled",
      });
      const lead = scalar(ctx, "SELECT status FROM leads WHERE id = ?", [leadId]);
      const activity = rowCount(ctx, "lead_activities", "lead_id = ? AND type = 'status' AND text = 'meeting_scheduled'", [leadId]);
      assert(lead.status === "meeting_scheduled", `lead status ${lead.status}`);
      assert(activity > 0, "missing status activity");
      return `lead ${leadId} moved to ${lead.status}; status activities ${activity}`;
    },
  },
  {
    id: "S08B",
    capability: "Admissions Pipeline",
    scenario: "Active pipeline risk views exclude terminal no-request leads.",
    criteria: "A terminal no_request lead without tasks does not inflate active no-task drill-downs.",
    async run(ctx) {
      const name = unique("Terminal No Request");
      ctx.db.prepare("INSERT INTO leads (name, phone, source, status, manager_id, amount) VALUES (?, ?, ?, 'no_request', ?, ?)")
        .run(name, "+996700800802", "scenario-terminal", ctx.user(sales).id, 125000);
      const page = await ctx.get("/sales?risk=no_task", ctx.cookie(admin));
      assert(page.status === 200, `risk page ${page.status}`);
      assert(!page.text.includes(name), "terminal no_request lead appeared in active no-task drill-down");
      const activeNoTask = scalar(ctx, `
        SELECT COUNT(*) AS count
        FROM leads l
        WHERE l.client_id IS NULL
          AND l.status IN ('processing_mp', 'qualified', 'meeting_scheduled', 'meeting_done')
          AND NOT EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.status != 'done' AND (t.lead_id = l.id OR (l.client_id IS NOT NULL AND t.client_id = l.client_id))
          )
      `);
      assert(activeNoTask.count >= 0, "active no-task query failed");
      return `terminal no_request lead ${name} excluded; active no-task count ${activeNoTask.count}`;
    },
  },
  {
    id: "S10",
    capability: "Admissions Pipeline",
    scenario: "Contract status and Student 360 conversion stay locked until the canonical amoCRM mapping exists.",
    criteria: "A forged contract_signed move neither changes the lead nor creates a linked client.",
    async run(ctx) {
      const name = unique("Contract Locked Lead");
      ctx.db.prepare("INSERT INTO leads (name, phone, email, source, status, manager_id, target_country, amount) VALUES (?, ?, ?, ?, 'meeting_done', ?, ?, ?)")
        .run(name, "+996700900901", `${name.toLowerCase().replaceAll(" ", ".")}@example.com`, "scenario", ctx.user(sales).id, "Germany", 95000);
      const leadId = ctx.db.prepare("SELECT last_insert_rowid() AS id").get().id;
      await ctx.submit(`/sales/${leadId}`, ctx.cookie(sales), {
        names: ["id", "status"],
        includes: [`value="${leadId}"`],
      }, {
        id: leadId,
        status: "contract_signed",
      });
      const lead = scalar(ctx, "SELECT status, client_id FROM leads WHERE id = ?", [leadId]);
      assert(lead.status === "meeting_done", "forged contract status was accepted");
      assert(lead.client_id === null, "forged contract status created or linked a client");
      return `lead ${leadId} remained meeting_done and unlinked after forged contract_signed`;
    },
  },
  {
    id: "S11",
    capability: "Admissions Pipeline",
    scenario: "Lead note action persists staff activity.",
    criteria: "Submitting note form on lead detail inserts a note activity visible on the lead.",
    async run(ctx) {
      const leadId = ctx.firstLeadId();
      const text = unique("Scenario note");
      await ctx.submit(`/sales/${leadId}`, ctx.cookie(sales), { names: ["lead_id", "text"] }, {
        lead_id: leadId,
        text,
      });
      const activity = scalar(ctx, "SELECT id, text FROM lead_activities WHERE lead_id = ? AND type = 'note' AND text = ?", [leadId, text]);
      assert(activity, "lead note not inserted");
      return `lead ${leadId} note activity ${activity.id}`;
    },
  },
  {
    id: "S12",
    capability: "Student 360",
    scenario: "Student 360 list filters and add-student action create a profile.",
    criteria: "Student list stage filter renders and add-student form creates a client plus linked client user.",
    async run(ctx) {
      const filtered = await ctx.get("/clients?stage=documents", ctx.cookie(admin));
      assert(filtered.status === 200, `filtered clients status ${filtered.status}`);
      const name = unique("Scenario Student");
      const email = `${name.toLowerCase().replaceAll(" ", ".")}@example.com`;
      await ctx.submit("/clients", ctx.cookie(admin), { names: ["name", "email", "phone", "target_country", "target_degree", "source", "manager_id"] }, {
        name,
        email,
        phone: "+996555101202",
        target_country: "Italy",
        target_degree: "Bachelor",
        source: "scenario-referral",
        manager_id: ctx.user(sales).id,
      });
      const created = scalar(ctx, "SELECT clients.id, clients.stage, clients.manager_id, users.role FROM clients JOIN users ON users.id = clients.user_id WHERE users.email = ?", [email]);
      assert(created, "client/user not created");
      assert(created.role === "client" && created.stage === "lead", "created student role/stage incorrect");
      assert(created.manager_id === ctx.user(sales).id, "created student is not owned by Sales");
      return `created student client ${created.id} with linked ${created.role} user`;
    },
  },
  {
    id: "S13",
    capability: "Student 360",
    scenario: "Student profile renders profile, applications, documents, visa, finance, updates, deadline, and open work.",
    criteria: "GET /clients/:id includes sections/forms for profile, application, document, visa, payment, task, update, and queue links.",
    async run(ctx) {
      const clientId = ctx.firstClientId();
      const res = await ctx.get(`/clients/${clientId}`, ctx.cookie(admin));
      assert(res.status === 200, `client page status ${res.status}`);
      for (const marker of ["name=\"stage\"", "name=\"university\"", "name=\"name\"", "name=\"appointment_at\"", "name=\"amount\"", "name=\"title\"", "name=\"message\"", "/applications", "/documents", "/tasks", "/finance"]) {
        assert(res.text.includes(marker), `missing profile marker ${marker}`);
      }
      return `student ${clientId} profile exposes core operating sections`;
    },
  },
  {
    id: "S14",
    capability: "Student 360",
    scenario: "General profile updates persist allowed fields without changing canonical manager or Curator ownership.",
    criteria: "Forged ownership fields are ignored while stage and study-target changes persist.",
    async run(ctx) {
      const clientId = ctx.firstClientId();
      const before = scalar(ctx, "SELECT manager_id, curator_id FROM clients WHERE id = ?", [clientId]);
      await ctx.submit(`/clients/${clientId}`, ctx.cookie(admin), {
        names: ["client_id", "stage", "target_country", "target_degree", "notes"],
        excludes: ["name=\"manager_id\"", "name=\"curator_id\""],
      }, {
        client_id: clientId,
        stage: "documents",
        manager_id: ctx.user("finance@demo.kg").id,
        curator_id: ctx.user(admin).id,
        target_country: "United Kingdom",
        target_degree: "Master",
        notes: "Scenario profile update",
      });
      const updated = scalar(ctx, "SELECT stage, manager_id, curator_id, target_country, target_degree, notes FROM clients WHERE id = ?", [clientId]);
      assert(updated.stage === "documents" && updated.target_country === "United Kingdom", "student profile did not update");
      assert(updated.manager_id === before.manager_id, "general profile update changed canonical manager ownership");
      assert(updated.curator_id === before.curator_id, "general profile update changed Curator ownership");
      return `student ${clientId} updated allowed fields; manager ${updated.manager_id} and Curator ${updated.curator_id} stayed unchanged`;
    },
  },
  {
    id: "S15",
    capability: "Applications queue",
    scenario: "Add application action persists admissions application context.",
    criteria: "Responsible Sales can add an application to their pre-handoff Student 360; the action persists university, country, program, degree, deadline, and preparing status.",
    async run(ctx) {
      const preHandoffClient = scalar(
        ctx,
        `SELECT c.id
         FROM clients c
         WHERE c.manager_id = ? AND c.case_state = 'pending'
         ORDER BY c.id
         LIMIT 1`,
        [ctx.user(sales).id],
      );
      assert(preHandoffClient, "no Sales-owned pre-handoff client available for application scenario");
      const clientId = preHandoffClient.id;
      const university = unique("Scenario University");
      await ctx.submit(`/clients/${clientId}`, ctx.cookie(sales), { names: ["client_id", "university", "country", "program", "degree", "deadline"] }, {
        client_id: clientId,
        university,
        country: "Netherlands",
        program: "Business Analytics",
        degree: "Master",
        deadline: "2026-12-15",
      });
      const app = scalar(ctx, "SELECT id, status, country, program FROM applications WHERE client_id = ? AND university = ?", [clientId, university]);
      assert(app?.status === "preparing" && app.country === "Netherlands", "application not inserted correctly");
      return `application ${app.id} created for client ${clientId}: ${app.program}, ${app.status}`;
    },
  },
  {
    id: "S16",
    capability: "Applications queue",
    scenario: "Applications queue filter and status update flow work.",
    criteria: "Assigned Curator can use the post-handoff filtered queue, update an application to submitted, and follow its Student 360 link.",
    async run(ctx) {
      const app = scalar(
        ctx,
        `SELECT a.id, a.client_id
         FROM applications a
         JOIN clients c ON c.id = a.client_id
         WHERE a.status = 'preparing'
           AND c.curator_id = ?
           AND c.case_state IN ('active', 'closed')
         ORDER BY a.id
         LIMIT 1`,
        [ctx.user(curator).id],
      );
      assert(app, "no Curator-owned preparing application available for queue scenario");
      const filtered = await ctx.get("/applications?status=preparing", ctx.cookie(curator));
      assert(filtered.status === 200, `applications filter status ${filtered.status}`);
      assert(filtered.text.includes("/clients/"), "applications rows do not link to Student 360");
      await ctx.submit("/applications", ctx.cookie(curator), { names: ["id", "client_id", "status"], includes: [`value="${app.id}"`] }, {
        id: app.id,
        client_id: app.client_id,
        status: "submitted",
      });
      const updated = scalar(ctx, "SELECT status FROM applications WHERE id = ?", [app.id]);
      assert(updated.status === "submitted", `application status ${updated.status}`);
      return `application ${app.id} updated to ${updated.status}; filtered queue status ${filtered.status}`;
    },
  },
  {
    id: "S17",
    capability: "Documents queue",
    scenario: "Add document action persists admissions document request.",
    criteria: "Responsible Sales can add a required document request to their pre-handoff Student 360.",
    async run(ctx) {
      const preHandoffClient = scalar(
        ctx,
        `SELECT c.id
         FROM clients c
         WHERE c.manager_id = ? AND c.case_state = 'pending'
         ORDER BY c.id
         LIMIT 1`,
        [ctx.user(sales).id],
      );
      assert(preHandoffClient, "no Sales-owned pre-handoff client available for document scenario");
      const clientId = preHandoffClient.id;
      const name = unique("Scenario Document");
      await ctx.submit(`/clients/${clientId}`, ctx.cookie(sales), { names: ["client_id", "name"], excludes: ["name=\"id\"", "name=\"status\""] }, {
        client_id: clientId,
        name,
      });
      const doc = scalar(ctx, "SELECT id, status FROM documents WHERE client_id = ? AND name = ?", [clientId, name]);
      assert(doc?.status === "required", "document not inserted correctly");
      return `document ${doc.id} created with status ${doc.status}`;
    },
  },
  {
    id: "S18",
    capability: "Documents queue",
    scenario: "Documents queue filter and status update flow work.",
    criteria: "Assigned Curator can use the post-handoff filtered queue, reopen an approved document for review with a reason, and follow its Student 360 link.",
    async run(ctx) {
      const doc = scalar(
        ctx,
        `SELECT d.id, d.client_id, d.status
         FROM documents d
         JOIN clients c ON c.id = d.client_id
         WHERE d.status = 'approved'
           AND c.curator_id = ?
           AND c.case_state IN ('active', 'closed')
         ORDER BY d.id
         LIMIT 1`,
        [ctx.user(curator).id],
      );
      assert(doc, "no Curator-owned approved document available for review scenario");
      const filtered = await ctx.get("/documents?status=approved", ctx.cookie(curator));
      assert(filtered.status === 200, `documents filter status ${filtered.status}`);
      assert(filtered.text.includes("/clients/"), "documents rows do not link to Student 360");
      await ctx.submit(`/documents/${doc.id}`, ctx.cookie(curator), {
        names: ["id", "status", "comment"],
        includes: [`value="${doc.id}"`, "value=\"review\""],
      }, {
        id: doc.id,
        status: "review",
        comment: "Scenario review reopened after an internal quality check.",
      });
      const updated = scalar(ctx, "SELECT status FROM documents WHERE id = ?", [doc.id]);
      assert(updated.status === "review", `document status ${updated.status}`);
      return `document ${doc.id} reopened as ${updated.status}; filtered queue status ${filtered.status}`;
    },
  },
  {
    id: "S19",
    capability: "Visa operations",
    scenario: "Visa upsert persists valid case status and dates.",
    criteria: "Submitting visa form creates/updates visa case with allowed status and appointment date.",
    async run(ctx) {
      const clientId = ctx.firstClientId();
      await ctx.submit(`/clients/${clientId}`, ctx.cookie(admin), { names: ["client_id", "country", "status", "appointment_at", "notes"] }, {
        client_id: clientId,
        country: "United Kingdom",
        status: "appointment",
        appointment_at: "2026-11-20",
        notes: "Scenario embassy appointment",
      });
      const visa = scalar(ctx, "SELECT status, appointment_at, notes FROM visa_cases WHERE client_id = ?", [clientId]);
      assert(visa?.status === "appointment" && visa.appointment_at === "2026-11-20", "visa case not upserted");
      return `visa case for client ${clientId}: ${visa.status} on ${visa.appointment_at}`;
    },
  },
  {
    id: "S20",
    capability: "Tasks",
    scenario: "Tasks board metrics/status columns and add-task action are useful.",
    criteria: "Sales task board renders metrics/columns, and Sales can add a task linked to their pre-handoff student with priority, assignee, and due date.",
    async run(ctx) {
      const page = await ctx.get("/tasks", ctx.cookie(sales));
      assert(page.status === 200, `tasks status ${page.status}`);
      for (const col of ["todo", "in_progress", "review", "done"]) assert(page.text.includes(col), `missing ${col}`);
      const title = unique("Scenario Task");
      const preHandoffClient = scalar(
        ctx,
        `SELECT c.id
         FROM clients c
         WHERE c.manager_id = ? AND c.case_state = 'pending'
         ORDER BY c.id
         LIMIT 1`,
        [ctx.user(sales).id],
      );
      assert(preHandoffClient, "no Sales-owned pre-handoff client available for task scenario");
      const clientId = preHandoffClient.id;
      await ctx.submit("/tasks", ctx.cookie(sales), { names: ["title", "priority", "description", "assignee_id", "client_id", "due_date"] }, {
        title,
        priority: "urgent",
        description: "Scenario task description",
        assignee_id: ctx.user(sales).id,
        client_id: clientId,
        due_date: "2026-10-05",
      });
      const task = scalar(ctx, "SELECT id, priority, assignee_id, client_id, status FROM tasks WHERE title = ?", [title]);
      assert(task?.priority === "urgent" && task.client_id === clientId, "task not inserted correctly");
      return `task ${task.id} ${task.priority}, client ${task.client_id}, status ${task.status}`;
    },
  },
  {
    id: "S21",
    capability: "Tasks",
    scenario: "Move task action persists status changes.",
    criteria: "Sales can move a task in their own pre-handoff or personal queue to review.",
    async run(ctx) {
      const task = scalar(
        ctx,
        `SELECT t.id
         FROM tasks t
         LEFT JOIN clients c ON c.id = t.client_id
         WHERE t.status != 'done'
           AND (
             (t.client_id IS NOT NULL AND c.manager_id = ? AND c.case_state = 'pending')
             OR (t.client_id IS NULL AND t.assignee_id = ?)
           )
         ORDER BY t.client_id IS NULL, t.id
         LIMIT 1`,
        [ctx.user(sales).id, ctx.user(sales).id],
      );
      assert(task, "no Sales-accessible task available for move scenario");
      await ctx.submit("/tasks", ctx.cookie(sales), { names: ["id", "status"], includes: [`value="${task.id}"`] }, {
        id: task.id,
        status: "review",
      });
      const updated = scalar(ctx, "SELECT status FROM tasks WHERE id = ?", [task.id]);
      assert(updated.status === "review", `task status ${updated.status}`);
      return `task ${task.id} moved to ${updated.status}`;
    },
  },
  {
    id: "S22",
    capability: "Finance",
    scenario: "Finance overview shows paid, pending, overdue, and role-safe actions.",
    criteria: "Finance page renders payment status logic; sales staff receives a no-access state and finance staff sees mutation controls.",
    async run(ctx) {
      const salesPage = await ctx.get("/finance", ctx.cookie(sales));
      const financePage = await ctx.get("/finance", ctx.cookie(finance));
      assert([303, 307, 308].includes(salesPage.status) && financePage.status === 200, `finance statuses ${salesPage.status}/${financePage.status}`);
      assert(
        salesPage.location?.includes("/access-denied") && salesPage.location.includes("from=%2Ffinance"),
        `sales finance access did not reach no-access state: ${salesPage.location}`,
      );
      assert(financePage.text.includes("overdue") || financePage.text.includes("pay.overdue") || financePage.text.includes("Проср"), "missing overdue semantics");
      assert(financePage.text.includes("name=\"amount\""), "finance user cannot see add-payment form");
      return "sales finance blocked; finance role mutation form visible";
    },
  },
  {
    id: "S23",
    capability: "Finance",
    scenario: "Add payment rejects invalid amount and accepts positive role-safe payment.",
    criteria: "Finance can select a student with no prior payments; negative amount does not insert, while a positive submission creates the first pending payment with currency.",
    async run(ctx) {
      let clientWithoutPayment = scalar(
        ctx,
        `SELECT c.id
         FROM clients c
         LEFT JOIN payments p ON p.client_id = c.id
         GROUP BY c.id
         HAVING COUNT(p.id) = 0
         ORDER BY c.id
         LIMIT 1`,
      );
      if (!clientWithoutPayment) {
        const fixtureName = unique("Finance First Payment");
        const fixtureEmail = `${fixtureName.toLowerCase().replaceAll(" ", "-")}@example.test`;
        const userInsert = ctx.db.prepare(`
          INSERT INTO users (email, phone, password_hash, name, role)
          SELECT ?, NULL, password_hash, ?, 'client'
          FROM users
          WHERE lower(email) = ?
        `).run(fixtureEmail, fixtureName, client);
        assert(userInsert.changes === 1, "could not create zero-payment finance fixture user");
        const clientInsert = ctx.db.prepare(`
          INSERT INTO clients (user_id, stage, source, case_state)
          VALUES (?, 'new', 'scenario', 'pending')
        `).run(Number(userInsert.lastInsertRowid));
        clientWithoutPayment = { id: Number(clientInsert.lastInsertRowid) };
      }
      const clientId = clientWithoutPayment.id;
      const financePage = await ctx.get("/finance", ctx.cookie(finance));
      assert(financePage.status === 200, `finance page status ${financePage.status}`);
      assert(
        financePage.text.includes(`value="${clientId}"`),
        `zero-payment client ${clientId} is missing from the finance selector`,
      );
      const before = rowCount(ctx, "payments");
      await ctx.submit("/finance", ctx.cookie(finance), { names: ["client_id", "title", "amount", "currency", "due_date"] }, {
        client_id: clientId,
        title: unique("Invalid Payment"),
        amount: "-100",
        currency: "USD",
        due_date: "2026-09-01",
      });
      const afterInvalid = rowCount(ctx, "payments");
      assert(afterInvalid === before, `negative payment inserted rows ${afterInvalid - before}`);
      const title = unique("Scenario Payment");
      await ctx.submit("/finance", ctx.cookie(finance), { names: ["client_id", "title", "amount", "currency", "due_date"] }, {
        client_id: clientId,
        title,
        amount: "2500",
        currency: "USD",
        due_date: "2026-09-01",
      });
      const payment = scalar(ctx, "SELECT id, status, amount, currency FROM payments WHERE title = ?", [title]);
      assert(payment?.status === "pending" && payment.amount === 2500 && payment.currency === "USD", "positive payment not inserted correctly");
      return `negative rejected; payment ${payment.id} ${payment.amount} ${payment.currency} ${payment.status}`;
    },
  },
  {
    id: "S24",
    capability: "Finance",
    scenario: "Mark payment paid action persists payment completion.",
    criteria: "Submitting mark-paid form updates a pending payment to paid and sets paid_at.",
    async run(ctx) {
      const payment = ctx.firstPaymentId("status != 'paid'");
      await ctx.submit("/finance", ctx.cookie(finance), { names: ["id"], includes: [`value="${payment.id}"`] }, {
        id: payment.id,
      });
      const updated = scalar(ctx, "SELECT status, paid_at FROM payments WHERE id = ?", [payment.id]);
      assert(updated.status === "paid" && updated.paid_at, "payment not marked paid");
      return `payment ${payment.id} status ${updated.status}, paid_at ${updated.paid_at}`;
    },
  },
  {
    id: "S25",
    capability: "Student portal updates",
    scenario: "Staff update becomes visible in the client portal.",
    criteria: "Posting an update from Student 360 inserts a client update and the seeded client portal renders it.",
    async run(ctx) {
      const clientRow = scalar(ctx, "SELECT clients.id FROM clients JOIN users ON users.id = clients.user_id WHERE users.email = ?", [client]);
      assert(clientRow, "seeded portal client missing");
      const message = unique("Scenario portal update");
      await ctx.submit(`/clients/${clientRow.id}`, ctx.cookie(admin), { names: ["client_id", "message"] }, {
        client_id: clientRow.id,
        message,
      });
      const portal = await ctx.get("/portal", ctx.cookie(client));
      assert(portal.status === 200, `portal status ${portal.status}`);
      assert(portal.text.includes(message), "portal did not render staff update");
      return `portal rendered update for client ${clientRow.id}`;
    },
  },
  {
    id: "S31",
    capability: "Student portal experience",
    scenario: "Client portal renders a sectioned, client-scoped admissions dashboard.",
    criteria: "The signed-in student sees own stage, target, applications, documents, payments, highest-priority next action, team contacts, and section navigation without another student's data.",
    async run(ctx) {
      const cookie = ctx.cookie(client);
      const portal = await ctx.get("/portal", cookie);
      assert(portal.status === 200, `portal status ${portal.status}`);
      const sectionRoutes = [
        "/portal/applications",
        "/portal/documents",
        "/portal/payments",
        "/portal/team",
      ];
      const sections = [];
      for (const route of sectionRoutes) {
        const response = await ctx.get(route, cookie);
        assert(response.status === 200, `${route} status ${response.status}`);
        sections.push(response);
      }
      const portalText = [portal, ...sections].map((response) => response.text).join("\n");
      const own = scalar(ctx, `
        SELECT c.id, u.name, c.target_country, c.target_degree, m.name AS manager_name, cu.name AS curator_name
        FROM clients c
        JOIN users u ON u.id = c.user_id
        LEFT JOIN users m ON m.id = c.manager_id
        LEFT JOIN users cu ON cu.id = c.curator_id
        WHERE u.email = ?
      `, [client]);
      const other = scalar(ctx, `
        SELECT u.name, c.target_country
        FROM clients c JOIN users u ON u.id = c.user_id
        WHERE u.email != ? AND u.role = 'client'
        ORDER BY c.id LIMIT 1
      `, [client]);
      assert(own, "seeded client portal record missing");
      const urgentTask = scalar(ctx, `
        SELECT title
        FROM tasks
        WHERE client_id = ? AND status != 'done' AND priority IN ('urgent', 'high')
        ORDER BY CASE priority WHEN 'urgent' THEN 0 ELSE 1 END,
          due_date IS NULL, due_date, created_at DESC
        LIMIT 1
      `, [own.id]);
      const requiredDocument = scalar(ctx, `
        SELECT name
        FROM documents
        WHERE client_id = ? AND status IN ('required', 'rejected')
        ORDER BY id
        LIMIT 1
      `, [own.id]);
      const expectedNextAction = urgentTask?.title ?? requiredDocument?.name;
      assert(expectedNextAction, "seeded portal next action missing");
      assert(portal.text.includes(expectedNextAction), `portal missing next action ${expectedNextAction}`);
      for (const text of [
        "href=\"/portal\"",
        "href=\"/portal/applications\"",
        "href=\"/portal/documents\"",
        "href=\"/portal/payments\"",
        "href=\"/portal/team\"",
        own.name,
        own.target_country,
        own.target_degree,
        own.manager_name,
        own.curator_name,
        "TU München",
        "Мотивационное письмо",
        "Консалтинговый пакет",
      ]) {
        assert(portalText.includes(text), `portal missing ${text}`);
      }
      assert(!other || !portalText.includes(other.name), `portal leaked other student ${other.name}`);
      const staffPortal = await ctx.get("/portal", ctx.cookie(sales));
      assert([303, 307, 308].includes(staffPortal.status), `staff portal status ${staffPortal.status}`);
      assert(staffPortal.location?.includes("/dashboard"), `staff portal redirect ${staffPortal.location}`);
      return `portal rendered scoped dashboard for client ${own.id} with navigation, contacts, and open work`;
    },
  },
  {
    id: "S26",
    capability: "Team chat",
    scenario: "Chat renders and channel/message actions persist team communication.",
    criteria: "Creating a channel redirects to chat detail, and sending a message inserts it for that channel.",
    async run(ctx) {
      const name = unique("Scenario Channel");
      const create = await ctx.submit("/chat/1", ctx.cookie(admin), { names: ["name", "description"] }, {
        name,
        description: "Scenario admissions coordination",
      });
      const normalizedName = name.toLowerCase().replace(/[^a-zа-яё0-9_-]/gi, "-");
      const channel = scalar(ctx, "SELECT id FROM channels WHERE name = ?", [normalizedName]);
      assert(channel, "channel not created");
      const message = unique("Scenario chat message");
      await ctx.submit(`/chat/${channel.id}`, ctx.cookie(admin), { names: ["channel_id", "text"] }, {
        channel_id: channel.id,
        text: message,
      });
      const inserted = scalar(ctx, "SELECT id FROM channel_messages WHERE channel_id = ? AND text = ?", [channel.id, message]);
      assert(inserted, "chat message not inserted");
      return `channel ${channel.id} created (${create.status}); message ${inserted.id} inserted`;
    },
  },
  {
    id: "S27",
    capability: "WhatsApp operations",
    scenario: "Manual WhatsApp creation is Admin-only and missing credentials are visibly blocked.",
    criteria: "Sales has no manual-create form; Admin can create an unlinked conversation and see its detail while Sales cannot see its link; absent Cloud API credentials show a not-connected state instead of success.",
    async run(ctx) {
      const salesInboxBefore = await ctx.get("/whatsapp", ctx.cookie(sales));
      assert(salesInboxBefore.status === 200, `Sales inbox status ${salesInboxBefore.status}`);
      assert(!salesInboxBefore.text.includes('name="phone"'), "Sales inbox exposed manual conversation creation");

      const phone = `+996700${Math.floor(100000 + Math.random() * 899999)}`;
      await ctx.submit("/whatsapp", ctx.cookie(admin), { names: ["phone", "name"] }, {
        phone,
        name: "Scenario WhatsApp",
      });
      const conv = scalar(ctx, "SELECT id FROM wa_conversations WHERE phone = ?", [phone]);
      assert(conv, "conversation not created");
      const detail = await ctx.get(`/whatsapp/${conv.id}`, ctx.cookie(admin));
      assert(detail.status === 200 && detail.text.includes("Scenario WhatsApp"), `Admin conversation detail status ${detail.status}`);
      const inbox = await ctx.get("/whatsapp", ctx.cookie(admin));
      assert(inbox.status === 200 && inbox.text.includes(`/whatsapp/${conv.id}`), "Admin inbox did not link new conversation");
      const salesInbox = await ctx.get("/whatsapp", ctx.cookie(sales));
      assert(!salesInbox.text.includes(`/whatsapp/${conv.id}`), "Sales inbox leaked unlinked Admin-only conversation");
      const waToken = scalar(ctx, "SELECT value FROM settings WHERE key = 'wa_token'");
      const waPhone = scalar(ctx, "SELECT value FROM settings WHERE key = 'wa_phone_id'");
      assert(!waToken?.value && !waPhone?.value, "scenario expected missing WhatsApp credentials");
      assert(inbox.text.includes("⚠") || inbox.text.includes("demo") || inbox.text.includes("не"), "missing not-connected WhatsApp notice");
      return `Admin-only conversation ${conv.id}; Sales create/link denied; WhatsApp Cloud credentials absent and inbox shows blocked state`;
    },
  },
  {
    id: "S28",
    capability: "WhatsApp webhook and settings",
    scenario: "Settings save integration token, verify endpoint works, and incoming webhook creates lead/conversation.",
    criteria: "Admin settings form saves verify token; GET webhook echoes challenge; POST incoming message creates conversation and linked lead.",
    async run(ctx) {
      const token = unique("wa-token");
      const appSecret = unique("wa-secret");
      await ctx.submit("/settings", ctx.cookie(admin), { names: ["wa_token", "wa_phone_id", "wa_verify_token", "wa_app_secret", "tel_provider", "tel_api_key", "anthropic_api_key"] }, {
        wa_token: "",
        wa_phone_id: "",
        wa_verify_token: token,
        wa_app_secret: appSecret,
        tel_provider: "other",
        tel_api_key: "",
        anthropic_api_key: "",
      });
      const verify = await ctx.get(`/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=ok-challenge`);
      assert(verify.status === 200 && verify.text === "ok-challenge", `verify ${verify.status}/${verify.text}`);
      const from = `996700${Math.floor(100000 + Math.random() * 899999)}`;
      const payload = {
        entry: [{
          changes: [{
            value: {
              contacts: [{ wa_id: from, profile: { name: "Scenario Inbound" } }],
              messages: [{ id: unique("wamid"), from, type: "text", text: { body: "Interested in admissions" } }],
            },
          }],
        }],
      };
      const rawPayload = JSON.stringify(payload);
      const signature = `sha256=${createHmac("sha256", appSecret).update(rawPayload).digest("hex")}`;
      const post = await ctx.postJson("/api/webhooks/whatsapp", payload, {
        headers: { "x-hub-signature-256": signature },
      });
      assert(post.status === 200, `webhook post ${post.status}`);
      const conv = scalar(ctx, "SELECT id, lead_id FROM wa_conversations WHERE phone = ?", [`+${from}`]);
      const lead = conv?.lead_id ? scalar(ctx, "SELECT id, source FROM leads WHERE id = ?", [conv.lead_id]) : null;
      assert(conv && lead?.source === "WhatsApp", "webhook did not create linked WhatsApp lead");
      return `verify ok; inbound conversation ${conv.id}, lead ${lead.id}`;
    },
  },
  {
    id: "S28B",
    capability: "WAHA WhatsApp integration",
    scenario: "WAHA settings create a session account, signed webhook imports messages, status events update the account, retries are idempotent, and provider errors stay visible.",
    criteria: "Admin can save WAHA config; unsigned WAHA webhook is rejected; signed message creates one account-bound conversation; duplicate delivery is ignored; a stored provider failure renders as blocked in the staff shell and settings overview.",
    async run(ctx) {
      const session = `crm_${Math.random().toString(36).slice(2, 8)}`;
      const webhookSecret = unique("waha-hook");
      await ctx.submit("/settings", ctx.cookie(admin), {
        names: [
          "wa_provider",
          "waha_account_name",
          "waha_base_url",
          "waha_session_name",
          "waha_api_key",
          "waha_webhook_secret",
          "waha_webhook_url",
        ],
      }, {
        wa_provider: "waha",
        waha_account_name: "Scenario WAHA",
        waha_base_url: "http://127.0.0.1:3000",
        waha_session_name: session,
        waha_api_key: unique("waha-api"),
        waha_webhook_secret: webhookSecret,
        waha_webhook_url: "https://crm.evo.example/api/webhooks/waha",
      });
      const account = scalar(ctx, "SELECT id, provider, session_name, status FROM wa_accounts WHERE session_name = ?", [session]);
      assert(account?.provider === "waha", "WAHA account was not created from settings");

      const from = `996700${Math.floor(100000 + Math.random() * 899999)}`;
      const messageId = unique("waha-msg");
      const messagePayload = {
        event: "message",
        session,
        engine: "WEBJS",
        payload: {
          id: messageId,
          timestamp: Math.floor(Date.now() / 1000),
          from: `${from}@c.us`,
          fromMe: false,
          to: "996700111222@c.us",
          body: "WAHA inbound admissions question",
          hasMedia: false,
          ack: 1,
        },
      };

      const rejected = await ctx.postJson("/api/webhooks/waha", messagePayload, {
        headers: { "x-webhook-hmac": "bad", "x-webhook-hmac-algorithm": "sha512" },
      });
      assert(rejected.status === 403, `bad WAHA webhook status ${rejected.status}`);

      const rawMessage = JSON.stringify(messagePayload);
      const signature = createHmac("sha512", webhookSecret).update(rawMessage).digest("hex");
      const firstPost = await ctx.postJson("/api/webhooks/waha", messagePayload, {
        headers: { "x-webhook-hmac": signature, "x-webhook-hmac-algorithm": "sha512" },
      });
      const retryPost = await ctx.postJson("/api/webhooks/waha", messagePayload, {
        headers: { "x-webhook-hmac": signature, "x-webhook-hmac-algorithm": "sha512" },
      });
      assert(firstPost.status === 200 && retryPost.status === 200, `WAHA posts ${firstPost.status}/${retryPost.status}`);

      const conv = scalar(ctx, "SELECT id, lead_id, wa_account_id FROM wa_conversations WHERE phone = ? AND wa_account_id = ?", [`+${from}`, account.id]);
      assert(conv?.wa_account_id === account.id, "WAHA webhook did not create account-bound conversation");
      const messages = rowCount(ctx, "wa_messages", "wa_id = ?", [messageId]);
      assert(messages === 1, `expected one deduped WAHA message, got ${messages}`);

      const statusPayload = {
        event: "session.status",
        session,
        engine: "WEBJS",
        me: { id: "996700111222@c.us", pushName: "Scenario WAHA" },
        payload: { status: "WORKING", statuses: [] },
      };
      const rawStatus = JSON.stringify(statusPayload);
      const statusSignature = createHmac("sha512", webhookSecret).update(rawStatus).digest("hex");
      const statusPost = await ctx.postJson("/api/webhooks/waha", statusPayload, {
        headers: { "x-webhook-hmac": statusSignature, "x-webhook-hmac-algorithm": "sha512" },
      });
      assert(statusPost.status === 200, `WAHA status post ${statusPost.status}`);
      const updated = scalar(ctx, "SELECT status, phone FROM wa_accounts WHERE id = ?", [account.id]);
      assert(updated?.status === "WORKING" && updated.phone === "+996700111222", "WAHA status event did not update account state");
      ctx.db
        .prepare("INSERT INTO settings (key, value) VALUES ('waha_last_error', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run("provider_unreachable");
      const blockedShell = await ctx.get("/dashboard", ctx.cookie(admin));
      const blockedLabels = [
        "WhatsApp: заблокировано",
        "WhatsApp: бөгөттөлгөн",
        "WhatsApp: blocked",
      ];
      assert(
        blockedLabels.some((label) => blockedShell.text.includes(label)),
        `staff shell hid the configured WAHA provider failure; labels=${blockedShell.text.match(/WhatsApp.{0,90}/g)?.slice(0, 3).join(" | ") ?? "none"}`,
      );
      const blockedSettings = await ctx.get("/settings?tab=overview", ctx.cookie(admin));
      const blockedSettingsLabels = [
        "WhatsApp заблокирован",
        "WhatsApp бөгөттөлгөн",
        "WhatsApp is blocked",
      ];
      assert(
        blockedSettingsLabels.some((label) => blockedSettings.text.includes(label)),
        "settings overview mislabeled the configured WAHA provider failure",
      );
      ctx.db.prepare("UPDATE settings SET value = '' WHERE key = 'waha_last_error'").run();
      return `WAHA session ${session}; conversation ${conv.id}; duplicate message ignored; account ${updated.status}; provider failure rendered blocked in shell and settings`;
    },
  },
  {
    id: "S28C",
    capability: "Lead-agent CRM sync",
    scenario: "Signed lead-agent sync persists receive-only draft review evidence without creating sent outbound WhatsApp.",
    criteria: "Bad signatures are rejected; signed sync stores inbound state, amoCRM identity, agent state, and Gemini draft-review text; Operator UI labels the draft as not sent.",
    async run(ctx) {
      const session = `crm_sync_${Math.random().toString(36).slice(2, 8)}`;
      const syncSecret = unique("lead-agent-sync");
      await ctx.submit("/settings", ctx.cookie(admin), {
        names: [
          "wa_provider",
          "waha_account_name",
          "waha_base_url",
          "waha_session_name",
          "waha_api_key",
          "waha_webhook_secret",
          "lead_agent_sync_secret",
        ],
      }, {
        wa_provider: "waha",
        waha_account_name: "Scenario lead-agent",
        waha_base_url: "http://127.0.0.1:3000",
        waha_session_name: session,
        waha_api_key: unique("waha-api"),
        waha_webhook_secret: unique("waha-hook"),
        lead_agent_sync_secret: syncSecret,
      });

      const inboundWaId = unique("lead-agent-in");
      const phone = `+996700${Math.floor(100000 + Math.random() * 899999)}`;
      const amoLeadId = Math.floor(4_200_000 + Math.random() * 100_000);
      const amoContactId = Math.floor(8_400_000 + Math.random() * 100_000);
      const draftText = "Gemini draft review: ask the lead for IELTS score, target intake, and preferred German universities.";
      const payload = {
        event: "whatsapp.message",
        session,
        phone,
        pushName: "Scenario Draft Lead",
        text: "I want to study in Germany next intake.",
        providerMessageId: inboundWaId,
        amoLeadId,
        amoContactId,
        agentState: "draft_review_ready",
        agentSummary: "Resolved to marked amoCRM test identity before CRM sync.",
        draftReviewText: draftText,
        draftReviewStatus: "generated",
        draftReviewProvider: "gemini",
        draftReviewModel: "gemini-3.5-flash",
        outboundText: draftText,
      };

      const rejected = await ctx.postJson("/api/internal/lead-agent/whatsapp", payload, {
        headers: { "x-evo-agent-timestamp": String(Math.floor(Date.now() / 1000)), "x-evo-agent-signature": "bad" },
      });
      assert(rejected.status === 403, `bad lead-agent sync status ${rejected.status}`);

      const rawBody = JSON.stringify(payload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac("sha256", syncSecret).update(`${timestamp}.${rawBody}`).digest("hex");
      const accepted = await ctx.request("POST", "/api/internal/lead-agent/whatsapp", {
        body: rawBody,
        headers: {
          "content-type": "application/json",
          "x-evo-agent-timestamp": timestamp,
          "x-evo-agent-signature": signature,
          "x-evo-agent-signature-algorithm": "sha256",
        },
      });
      assert(accepted.status === 200, `signed lead-agent sync status ${accepted.status}: ${accepted.text}`);
      const acceptedBody = JSON.parse(accepted.text);
      assert(acceptedBody.insertedInbound === true, "signed sync did not insert inbound message");
      assert(acceptedBody.insertedOutbound === false, "receive-only draft sync inserted outbound message");

      const conv = scalar(ctx, `
        SELECT id, lead_id, amo_lead_id, amo_contact_id, agent_state,
          agent_draft_review_text, agent_draft_review_status,
          agent_draft_review_provider, agent_draft_review_model
        FROM wa_conversations
        WHERE amo_lead_id = ?
      `, [amoLeadId]);
      assert(conv?.amo_contact_id === amoContactId, "conversation did not persist amoCRM identity");
      assert(conv.agent_state === "draft_review_ready", `unexpected agent state ${conv.agent_state}`);
      assert(conv.agent_draft_review_text === draftText, "conversation did not persist draft review text");
      assert(conv.agent_draft_review_provider === "gemini", "conversation did not persist draft review provider");

      const lead = scalar(ctx, `
        SELECT amo_lead_id, amo_contact_id, agent_state, agent_draft_review_text
        FROM leads
        WHERE id = ?
      `, [conv.lead_id]);
      assert(lead?.amo_lead_id === amoLeadId && lead.amo_contact_id === amoContactId, "lead did not persist amoCRM identity");
      assert(lead.agent_state === "draft_review_ready" && lead.agent_draft_review_text === draftText, "lead did not persist agent draft state");

      const inboundRows = rowCount(ctx, "wa_messages", "conversation_id = ? AND direction = 'in' AND status = 'received'", [conv.id]);
      const outboundRows = rowCount(ctx, "wa_messages", "conversation_id = ? AND direction = 'out'", [conv.id]);
      assert(inboundRows === 1, `expected one received inbound row, got ${inboundRows}`);
      assert(outboundRows === 0, `expected no outbound rows, got ${outboundRows}`);

      const page = await ctx.get(`/whatsapp/${conv.id}`, ctx.cookie(admin));
      assert(page.status === 200, `operator conversation page ${page.status}`);
      assert(page.text.includes("Черновик на проверку"), "Operator UI did not label draft review");
      assert(page.text.includes("не отправлено"), "Operator UI did not mark draft as not sent");
      assert(page.text.includes("gemini-3.5-flash"), "Operator UI did not show draft model evidence");
      assert(page.text.includes("I want to study in Germany next intake."), "Operator UI did not show inbound message");
      assert(!page.text.includes("✓✓"), "Operator UI rendered a sent marker for receive-only draft sync");
      return `signed sync accepted conversation ${conv.id}; rejected bad signature; draft visible with ${outboundRows} outbound rows`;
    },
  },
  {
    id: "S29",
    capability: "Calls and telephony",
    scenario: "Calls page and telephony webhook enforce key handling and insert calls.",
    criteria: "Missing telephony provider or key is explicitly blocked without inserting a call; configured provider/key blocks invalid webhook; valid webhook inserts a call and links by lead phone.",
    async run(ctx) {
      await ctx.submit("/settings", ctx.cookie(admin), { names: ["wa_token", "wa_phone_id", "wa_verify_token", "tel_provider", "tel_api_key", "anthropic_api_key"] }, {
        wa_token: "",
        wa_phone_id: "",
        wa_verify_token: "",
        tel_provider: "other",
        tel_api_key: "",
        anthropic_api_key: "",
      });
      const page = await ctx.get("/calls", ctx.cookie(sales));
      assert(page.status === 200, `calls page ${page.status}`);
      assert(
        page.text.includes("Не настроено") && page.text.includes("Телефония не настроена"),
        "calls page did not show the user-facing telephony unavailable state",
      );
      assert(!page.text.includes("Demo mode") && !page.text.includes("Демо-режим"), "calls page still shows demo-mode copy");
      const lead = scalar(ctx, "SELECT id, phone FROM leads WHERE phone IS NOT NULL ORDER BY id LIMIT 1");
      assert(lead?.phone, "no lead with phone available");
      const beforeUnconfigured = scalar(ctx, "SELECT COUNT(*) AS count FROM calls WHERE phone = ?", [lead.phone]);
      const unconfigured = await ctx.postJson("/api/webhooks/telephony", { phone: lead.phone });
      assert(unconfigured.status === 503, `missing telephony key status ${unconfigured.status}`);
      const unconfiguredBody = JSON.parse(unconfigured.text);
      assert(unconfiguredBody.error === "not_configured", `missing key error ${unconfiguredBody.error}`);
      assert(unconfiguredBody.missing.includes("tel_api_key"), "missing key response did not name tel_api_key");
      const afterUnconfigured = scalar(ctx, "SELECT COUNT(*) AS count FROM calls WHERE phone = ?", [lead.phone]);
      assert(afterUnconfigured.count === beforeUnconfigured.count, "unconfigured telephony webhook inserted a call");

      const key = unique("tel-key");
      await ctx.submit("/settings", ctx.cookie(admin), { names: ["wa_token", "wa_phone_id", "wa_verify_token", "tel_provider", "tel_api_key", "anthropic_api_key"] }, {
        wa_token: "",
        wa_phone_id: "",
        wa_verify_token: "",
        tel_provider: "",
        tel_api_key: key,
        anthropic_api_key: "",
      });
      const partialPage = await ctx.get("/calls", ctx.cookie(sales));
      assert(partialPage.status === 200, `calls page partial provider ${partialPage.status}`);
      assert(
        partialPage.text.includes("Не настроено") && partialPage.text.includes("Телефония не настроена"),
        "calls page hid the user-facing telephony unavailable state for a missing provider",
      );
      const beforeMissingProvider = scalar(ctx, "SELECT COUNT(*) AS count FROM calls WHERE phone = ?", [lead.phone]);
      const missingProvider = await ctx.postJson("/api/webhooks/telephony", { api_key: key, phone: lead.phone });
      assert(missingProvider.status === 503, `missing telephony provider status ${missingProvider.status}`);
      const missingProviderBody = JSON.parse(missingProvider.text);
      assert(missingProviderBody.error === "not_configured", `missing provider error ${missingProviderBody.error}`);
      assert(missingProviderBody.missing.includes("tel_provider"), "missing provider response did not name tel_provider");
      const afterMissingProvider = scalar(ctx, "SELECT COUNT(*) AS count FROM calls WHERE phone = ?", [lead.phone]);
      assert(afterMissingProvider.count === beforeMissingProvider.count, "missing-provider telephony webhook inserted a call");

      await ctx.submit("/settings", ctx.cookie(admin), { names: ["wa_token", "wa_phone_id", "wa_verify_token", "tel_provider", "tel_api_key", "anthropic_api_key"] }, {
        wa_token: "",
        wa_phone_id: "",
        wa_verify_token: "",
        tel_provider: "other",
        tel_api_key: key,
        anthropic_api_key: "",
      });
      const bad = await ctx.postJson("/api/webhooks/telephony", { api_key: "bad", phone: lead.phone });
      assert(bad.status === 403, `invalid key status ${bad.status}`);
      const good = await ctx.postJson("/api/webhooks/telephony", {
        api_key: key,
        phone: lead.phone,
        direction: "in",
        duration_sec: 93,
        status: "answered",
        notes: "Scenario telephony",
      });
      assert(good.status === 200, `valid webhook status ${good.status}`);
      const call = scalar(ctx, "SELECT id, lead_id, duration_sec, status FROM calls WHERE phone = ? ORDER BY id DESC LIMIT 1", [lead.phone]);
      assert(call?.lead_id === lead.id && call.duration_sec === 93, "call not inserted or linked");
      const digits = lead.phone.replace(/[^\d]/g, "");
      const formattedPhone = `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
      const formatted = await ctx.postJson("/api/webhooks/telephony", {
        api_key: key,
        phone: formattedPhone,
        direction: "out",
        duration_sec: 31,
        status: "answered",
        notes: "Scenario normalized telephony",
      });
      assert(formatted.status === 200, `formatted phone webhook status ${formatted.status}`);
      const normalizedCall = scalar(ctx, "SELECT id, lead_id, duration_sec, status FROM calls WHERE phone = ? ORDER BY id DESC LIMIT 1", [lead.phone]);
      assert(normalizedCall?.lead_id === lead.id && normalizedCall.duration_sec === 31, "formatted phone call not normalized or linked");
      return `user-facing unavailable state shown; missing key ${unconfigured.status}; missing provider ${missingProvider.status}; invalid key 403; calls ${call.id}/${normalizedCall.id} linked to lead ${lead.id}`;
    },
  },
  {
    id: "S30",
    capability: "Reports and prepared AI boundary",
    scenario: "Reports render and AI summary endpoint returns not_configured without Anthropic key.",
    criteria: "Reports page loads real CRM totals; AI summary API for staff returns explicit not_configured instead of fake success.",
    async run(ctx) {
      const reports = await ctx.get("/reports", ctx.cookie(admin));
      assert(reports.status === 200, `reports status ${reports.status}`);
      const clientId = ctx.firstClientId();
      const ai = await ctx.postJson("/api/ai/summary", { clientId }, { cookie: ctx.cookie(admin) });
      assert(ai.status === 400, `AI status ${ai.status}`);
      const body = JSON.parse(ai.text);
      assert(body.error === "not_configured", `AI error ${body.error}`);
      return `reports ${reports.status}; AI summary client ${clientId} -> ${body.error}`;
    },
  },
  {
    id: "S32",
    capability: "amoCRM integration",
    scenario: "Settings page shows amoCRM as not_configured and check does not call the provider without credentials.",
    criteria: "Admin settings render amoCRM status with exact missing fields, and the real check Server Action records not_configured without credentials.",
    async run(ctx) {
      const page = await ctx.get("/settings", ctx.cookie(admin));
      assert(page.status === 200, `settings status ${page.status}`);
      assert(page.text.includes("amoCRM"), "settings page missing amoCRM section");
      assert(page.text.includes("accountBaseUrl") && page.text.includes("refreshToken"), "settings page missing required amoCRM fields status");
      await ctx.submit("/settings", ctx.cookie(admin), { includes: ["amoCRM"], excludes: ["name=\"wa_token\""] });
      const check = scalar(ctx, "SELECT value FROM settings WHERE key = 'amocrm_last_check'");
      assert(check?.value?.startsWith("not_configured:"), `unexpected amoCRM check ${check?.value}`);
      return `amoCRM check returned ${check.value}`;
    },
  },
  {
    id: "S33",
    capability: "amoCRM integration",
    scenario: "Admin can save sanitized amoCRM settings without leaking secrets in the rendered settings page.",
    criteria: "Submitting the real settings form stores a normalized amoCRM URL and secret rows, while the follow-up page omits raw secret values.",
    async run(ctx) {
      const clientSecret = unique("client-secret");
      const refreshToken = unique("refresh-token");
      await ctx.submit("/settings", ctx.cookie(admin), { names: ["amocrm_account_base_url", "amocrm_client_id", "amocrm_client_secret", "amocrm_redirect_uri", "amocrm_refresh_token"] }, {
        amocrm_account_base_url: "evoadmissions.amocrm.ru",
        amocrm_client_id: "scenario-client-id",
        amocrm_client_secret: clientSecret,
        amocrm_redirect_uri: "https://crm.evo.example/amocrm/oauth/callback",
        amocrm_refresh_token: refreshToken,
        amocrm_pipeline_id: "12345",
        amocrm_status_id: "67890",
        amocrm_responsible_user_id: "111",
        amocrm_target_country_field_id: "222",
        amocrm_source_field_id: "333",
      });
      const saved = scalar(ctx, "SELECT value FROM settings WHERE key = 'amocrm_account_base_url'");
      const savedSecret = scalar(ctx, "SELECT value FROM settings WHERE key = 'amocrm_client_secret'");
      assert(saved?.value === "https://evoadmissions.amocrm.ru", `unexpected amoCRM URL ${saved?.value}`);
      assert(savedSecret?.value?.startsWith("enc:v1:") && savedSecret.value !== clientSecret, "amoCRM client secret was not encrypted at rest");
      const page = await ctx.get("/settings", ctx.cookie(admin));
      assert(page.status === 200, `settings status ${page.status}`);
      assert(!page.text.includes(clientSecret), "settings page leaked amoCRM client secret");
      assert(!page.text.includes(refreshToken), "settings page leaked amoCRM refresh token");
      assert(page.text.includes("https://evoadmissions.amocrm.ru"), "settings page missing normalized amoCRM account URL");
      return "amoCRM settings saved with normalized account URL and masked secrets";
    },
  },
  {
    id: "S34",
    capability: "amoCRM integration",
    scenario: "Invalid amoCRM domains are rejected server-side.",
    criteria: "Submitting a Cyrillic or unrelated amoCRM account domain does not replace the saved account URL and records a blocked validation state.",
    async run(ctx) {
      await ctx.submit("/settings", ctx.cookie(admin), { names: ["amocrm_account_base_url", "amocrm_client_id", "amocrm_client_secret", "amocrm_redirect_uri", "amocrm_refresh_token"] }, {
        amocrm_account_base_url: "пример.amocrm.ru",
        amocrm_client_id: "bad-client-id",
        amocrm_client_secret: "bad-secret",
        amocrm_redirect_uri: "https://crm.evo.example/amocrm/oauth/callback",
        amocrm_refresh_token: "bad-refresh",
      });
      const saved = scalar(ctx, "SELECT value FROM settings WHERE key = 'amocrm_account_base_url'");
      const error = scalar(ctx, "SELECT value FROM settings WHERE key = 'amocrm_last_error'");
      assert(saved?.value === "https://evoadmissions.amocrm.ru", `invalid domain replaced setting with ${saved?.value}`);
      assert(error?.value === "invalid_account_domain", `missing invalid domain error ${error?.value}`);
      const page = await ctx.get("/settings", ctx.cookie(admin));
      assert(page.text.includes("invalid_account_domain"), "settings page did not show invalid amoCRM domain state");
      return "invalid Cyrillic amoCRM domain rejected and previous account URL preserved";
    },
  },
  {
    id: "S36",
    capability: "amoCRM integration",
    scenario: "Real amoCRM OAuth failure is surfaced as blocked instead of configured.",
    criteria: "When required credentials are present but the real OAuth exchange fails, the settings status records and renders blocked without leaking token values.",
    async run(ctx) {
      const clientSecret = unique("provider-secret");
      const refreshToken = unique("provider-refresh");
      await ctx.submit("/settings", ctx.cookie(admin), { names: ["amocrm_account_base_url", "amocrm_client_id", "amocrm_client_secret", "amocrm_redirect_uri", "amocrm_refresh_token"] }, {
        amocrm_account_base_url: "evoadmissions.amocrm.ru",
        amocrm_client_id: "invalid-client-id",
        amocrm_client_secret: clientSecret,
        amocrm_redirect_uri: "https://crm.evo.example/amocrm/oauth/callback",
        amocrm_refresh_token: refreshToken,
        amocrm_pipeline_id: "12345",
        amocrm_status_id: "67890",
      });
      await ctx.submit("/settings", ctx.cookie(admin), { includes: ["amoCRM"], excludes: ["name=\"wa_token\""] });
      const check = scalar(ctx, "SELECT value FROM settings WHERE key = 'amocrm_last_check'");
      assert(check?.value?.startsWith("blocked:provider_"), `expected blocked provider check, got ${check?.value}`);
      const page = await ctx.get("/settings", ctx.cookie(admin));
      assert(page.text.includes("blocked") || page.text.includes("заблок") || page.text.includes("бөгөт"), "settings page did not render blocked amoCRM status");
      assert(!page.text.includes(clientSecret), "settings page leaked provider-check client secret");
      assert(!page.text.includes(refreshToken), "settings page leaked provider-check refresh token");
      return `amoCRM real OAuth check stored ${check.value}`;
    },
  },
  {
    id: "S35",
    capability: "amoCRM integration",
    scenario: "Non-admin staff cannot save amoCRM settings through the real Server Action path.",
    criteria: "A sales session posting an admin-rendered settings Server Action is redirected and cannot mutate amoCRM settings.",
    async run(ctx) {
      const before = scalar(ctx, "SELECT value FROM settings WHERE key = 'amocrm_account_base_url'");
      const post = await ctx.submitWithPostCookie(
        "/settings",
        ctx.cookie(admin),
        ctx.cookie(sales),
        { names: ["amocrm_account_base_url", "amocrm_client_id", "amocrm_client_secret", "amocrm_redirect_uri", "amocrm_refresh_token"] },
        {
          amocrm_account_base_url: "saleschange.amocrm.com",
          amocrm_client_id: "sales-client-id",
          amocrm_client_secret: "sales-secret",
          amocrm_redirect_uri: "https://sales.example/callback",
          amocrm_refresh_token: "sales-refresh",
        },
      );
      const after = scalar(ctx, "SELECT value FROM settings WHERE key = 'amocrm_account_base_url'");
      assert(post.actionRedirect?.includes("/dashboard") || post.location?.includes("/dashboard"), `expected dashboard redirect, got ${post.actionRedirect ?? post.location}`);
      assert(after?.value === before?.value, "sales user mutated amoCRM settings");
      return `sales settings post redirected to ${post.actionRedirect ?? post.location}; amoCRM account unchanged`;
    },
  },
];
}
