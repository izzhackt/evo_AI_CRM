// Синтетические данные для постоянного мобильного стенда (scripts/local-dev/mobile-dev-stack.mjs).
// Идемпотентно: всё ищется по стабильным ключам (email, source_key, имя организации), недостающее досеивается.
// Где есть настоящая команда (чат, выбор страны, избранное, ссылка регистрации, логин) — идём через неё под нужным
// пользователем; где команды нет (реквизиты дела, чек-лист, файлы договора/чека) — тот же приём, что у существующих
// фикстур: транзакция SQL с session_replication_role=replica для строки дела (миграция 126 разрешает рантайму
// создавать только pending-дела, а «сопровождение» — это уже передача дела).
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const BUCKET = "platform-documents";
const ORG_NAME = "EVO Mobile Dev (синтетика)";
const DOMAIN = "example.test";

const newPassword = () => `Evo-${randomBytes(6).toString("hex")}-Aa1`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Настоящий (минимальный, но корректный) PDF с одной строкой текста: открывается в любом просмотрщике. */
function makePdf(line) {
  const text = line.replace(/[()\\]/g, "");
  const stream = `BT /F1 20 Tf 60 740 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

function universityContent(name, country, city, overview) {
  return {
    name, country, city, overview,
    websiteUrl: "https://university.example-mobiledev.edu", sourceUrl: "https://university.example-mobiledev.edu/admissions",
    verifiedOn: "2026-11-01", notes: "", photoKey: null,
    programs: [{
      id: "cs", title: "Computer Science (синтетическая программа)", level: "bachelor", duration: null, language: null,
      summary: "Синтетическая программа для проверки приложения", sourceUrl: "https://university.example-mobiledev.edu/programs/cs",
      intakes: [{ label: "September intake", startDate: "2027-09-01", startMonth: "2027-09", applicationDeadline: "2027-06-30",
        deadlineTime: null, timezone: null, status: "open", note: "", sourceUrl: "https://university.example-mobiledev.edu/admissions", verifiedOn: "2026-11-01" }],
    }],
  };
}

export async function seedMobileDevStack({ apiUrl, serviceKey, publishableKey, dbUrl, previous, log = console.log }) {
  assert.equal(new URL(apiUrl).hostname, "127.0.0.1");
  assert.equal(new URL(dbUrl).hostname, "127.0.0.1");
  const service = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const sql = postgres(dbUrl, { max: 2, onnotice: () => {}, prepare: false });
  const known = new Map((previous?.accounts ?? []).map((a) => [a.key, a]));
  const accounts = [];

  const signIn = async (email, password) => {
    const client = createClient(apiUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await client.auth.signInWithPassword({ email, password });
    assert.equal(error, null, `SIGN_IN_FAILED ${email}: ${error?.message}`);
    return client;
  };

  try {
    // ---- организация и роли ----
    // Организация создаётся вместе с первым администратором в одной транзакции (отложенный триггер требует живого админа).
    const [existingOrg] = await sql`SELECT id FROM platform.organizations WHERE name = ${ORG_NAME} LIMIT 1`;
    const organizationId = existingOrg?.id ?? randomUUID();
    let orgScope = { id: randomUUID() };
    if (existingOrg) {
      [orgScope] = await sql`SELECT id FROM platform.record_scopes WHERE organization_id=${organizationId} AND scope_kind='organization' AND scope_key=${organizationId}`;
    }
    const bundleOf = async (role) => {
      const [bundle] = await sql`SELECT id FROM platform.role_bundle_versions WHERE role=${role} AND status='published' ORDER BY version DESC LIMIT 1`;
      assert.ok(bundle, `MISSING_${role}_BUNDLE`);
      return bundle.id;
    };
    const grantScope = async (tx, membershipId, scopeId, reason) => {
      const [exists] = await tx`SELECT 1 FROM platform.membership_scope_assignments WHERE organization_id=${organizationId} AND membership_id=${membershipId} AND scope_id=${scopeId} AND granted LIMIT 1`;
      if (exists) return;
      await tx`INSERT INTO platform.membership_scope_assignments(id,organization_id,membership_id,scope_id,scope_version,assignment_version,granted,actor_kind,actor_profile_id,reason,request_id)
        VALUES (${randomUUID()},${organizationId},${membershipId},${scopeId},1,1,TRUE,'system',NULL,${reason},${randomUUID()})`;
    };

    /** Аккаунт Auth + профиль + членство. Пароль берётся из прошлого запуска и принудительно выравнивается в Auth. */
    const ensureUser = async ({ key, role, email, displayName, note, loginBase, temporary = false, systemAdmin = false }) => {
      if (systemAdmin) {
        // Настоящие кураторы EVO одновременно администраторы (иначе у curator нет прав на чат дела без выданной staff-роли).
        await sql`UPDATE platform.organization_memberships m SET is_system_admin = TRUE FROM platform.profiles p, auth.users u WHERE m.profile_id = p.id AND p.auth_user_id = u.id AND u.email = ${email} AND m.organization_id = ${organizationId} AND NOT m.is_system_admin`;
      }
      const password = known.get(key)?.password ?? newPassword();
      let [user] = await sql`SELECT id FROM auth.users WHERE lower(email)=${email}`;
      const appMetadata = temporary ? { evo_temporary_password: true } : {};
      if (!user) {
        const created = await service.auth.admin.createUser({ email, password, email_confirm: true, ...(temporary ? { app_metadata: appMetadata } : {}) });
        assert.equal(created.error, null, `AUTH_CREATE_FAILED ${key}: ${created.error?.message}`);
        user = { id: created.data.user.id };
      } else {
        const updated = await service.auth.admin.updateUserById(user.id, { password, email_confirm: true, ...(temporary ? { app_metadata: appMetadata } : {}) });
        assert.equal(updated.error, null, `AUTH_UPDATE_FAILED ${key}: ${updated.error?.message}`);
      }
      let [profile] = await sql`SELECT id FROM platform.profiles WHERE auth_user_id=${user.id}`;
      let [membership] = profile ? await sql`SELECT id FROM platform.organization_memberships WHERE organization_id=${organizationId} AND profile_id=${profile.id}` : [];
      if (!profile || !membership) {
        const profileId = profile?.id ?? randomUUID();
        const membershipId = randomUUID();
        const bundleId = await bundleOf(role);
        await sql.begin(async (tx) => {
          if (!existingOrg && role === "admin") {
            await tx`INSERT INTO platform.organizations(id,name) VALUES (${organizationId},${ORG_NAME})`;
            await tx`INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version) VALUES (${orgScope.id},${organizationId},'organization',${organizationId},1)`;
          }
          if (!profile) await tx`INSERT INTO platform.profiles(id,auth_user_id,display_name,status,access_version) VALUES (${profileId},${user.id},${displayName},'active',1)`;
          await tx`INSERT INTO platform.organization_memberships(id,organization_id,profile_id,status,"current_role",current_bundle_id,is_system_admin)
            VALUES (${membershipId},${organizationId},${profileId},'active',${role},${bundleId},${role === "admin" || systemAdmin})`;
          await grantScope(tx, membershipId, orgScope.id, `Mobile dev stack: ${key}`);
        });
        profile = { id: profileId };
        membership = { id: membershipId };
      }
      let login = null;
      if (loginBase) {
        const claimed = await service.schema("platform").rpc("claim_student_login_v1", { p_auth_user_id: user.id, p_base: loginBase });
        assert.equal(claimed.error, null, `LOGIN_CLAIM_FAILED ${key}: ${claimed.error?.message}`);
        login = claimed.data;
      }
      accounts.push({ key, role: role === "student" ? "student" : "staff", platformRole: role, login, email, password, note });
      return { key, authUserId: user.id, profileId: profile.id, membershipId: membership.id, email, password, login };
    };

    const admin = await ensureUser({ key: "admin", role: "admin", email: `test.admin@${DOMAIN}`, displayName: "Тест Администратор", note: "персонал (админ): должен получать отказ в мобильном входе" });
    const sales = await ensureUser({ key: "sales", role: "sales", email: `test.sales@${DOMAIN}`, displayName: "Тест Продажи", note: "персонал (менеджер продаж): ответственный по делам" });
    const curator = await ensureUser({ key: "staff", role: "curator", systemAdmin: true, email: `test.staff@${DOMAIN}`, displayName: "Тест Куратор", note: "персонал (куратор): куратор дела test.assisted; для проверки отказа в мобильном входе" });
    const approved = await ensureUser({ key: "approved", role: "student", email: `test.approved@${DOMAIN}`, displayName: "Тест Одобренный", loginBase: "test.approved", note: "уровень «одобрен»: дело pending, кабинет активирован, без документов и чата" });
    const assisted = await ensureUser({ key: "assisted", role: "student", email: `test.assisted@${DOMAIN}`, displayName: "Тест Сопровождаемый", loginBase: "test.assisted", note: "уровень «сопровождение»: активное дело, страна Китай, чек-лист, договор+чек, чат, уведомления, избранное" });
    const temporary = await ensureUser({ key: "temporary", role: "student", email: `test.temporary@${DOMAIN}`, displayName: "Тест Временный", loginBase: "test.temporary", temporary: true, note: "временный пароль: вход отдаёт must_set_password=true (экран «задайте свой пароль»)" });

    // ---- дела ----
    const ensureCase = async ({ sourceKey, student, state, displayName, stage, nextAction }) => {
      const [existing] = await sql`SELECT id FROM platform.student_cases WHERE organization_id=${organizationId} AND source_key=${sourceKey}`;
      if (existing) return existing.id;
      const caseId = randomUUID();
      const scopeId = randomUUID();
      await sql.begin(async (tx) => {
        await tx`INSERT INTO platform.record_scopes(id,organization_id,scope_kind,scope_key,scope_version) VALUES (${scopeId},${organizationId},'student_case',${caseId},1)`;
        for (const m of [student.membershipId, ...(state === "active" ? [curator.membershipId] : []), sales.membershipId, admin.membershipId]) {
          await grantScope(tx, m, scopeId, `Mobile dev stack: case scope ${sourceKey}`);
        }
        await tx`SET LOCAL session_replication_role = replica`;
        if (state === "active") {
          await tx`INSERT INTO platform.student_cases(id,organization_id,student_membership_id,responsible_sales_membership_id,current_curator_membership_id,
            source_key,contract_confirmation_ref,contract_confirmed_at,student_display_name,target_country,target_degree,program_direction,intake,
            route_approval_status,operational_stage,state,handoff_at,portal_activated_at,closed_at,next_action,current_scope_id,current_scope_version)
            VALUES (${caseId},${organizationId},${student.membershipId},${sales.membershipId},${curator.membershipId},${sourceKey},${`synthetic:${sourceKey}:contract`},
            '2026-10-01T08:00:00Z',${displayName},'CN','Bachelor','Computer Science','2027 Fall','approved',${stage},'active',
            '2026-10-01T09:00:00Z','2026-10-01T09:00:00Z',NULL,${nextAction},${scopeId},1)`;
        } else {
          await tx`INSERT INTO platform.student_cases(id,organization_id,student_membership_id,responsible_sales_membership_id,
            source_key,student_display_name,target_country,target_degree,program_direction,operational_stage,state,portal_activated_at,current_scope_id,current_scope_version)
            VALUES (${caseId},${organizationId},${student.membershipId},${sales.membershipId},${sourceKey},${displayName},'CN','Bachelor','Engineering',
            ${stage},'pending',clock_timestamp(),${scopeId},1)`;
        }
        await tx`SET LOCAL session_replication_role = origin`;
      });
      return caseId;
    };
    const approvedCase = await ensureCase({ sourceKey: "synthetic:mobile-dev:approved", student: approved, state: "pending", displayName: "Тест Одобренный", stage: "intake_review" });
    const assistedCase = await ensureCase({ sourceKey: "synthetic:mobile-dev:assisted", student: assisted, state: "active", displayName: "Тест Сопровождаемый", stage: "documents", nextAction: "Загрузить документы по чек-листу" });

    // Код страны (а не слово) — по нему кабинет определяет направление чек-листа.
    await sql`UPDATE platform.student_cases SET target_country='CN' WHERE organization_id=${organizationId} AND id IN (${approvedCase},${assistedCase}) AND target_country IS DISTINCT FROM 'CN'`;

    // ---- чек-лист (настоящая функция, которой кабинет сеет список при активации) ----
    await sql`SELECT platform_private.seed_default_document_checklist(${organizationId}, ${assistedCase})`;
    const slots = await sql`SELECT id, display_label, status FROM platform.document_slots WHERE organization_id=${organizationId} AND student_case_id=${assistedCase} AND removed_at IS NULL ORDER BY id`;
    assert.ok(slots.length >= 3, `CHECKLIST_NOT_SEEDED (${slots.length})`);
    const [versionsExist] = await sql`SELECT count(*)::int AS n FROM platform.document_versions WHERE organization_id=${organizationId} AND student_case_id=${assistedCase}`;
    if (versionsExist.n === 0) {
      const addVersion = async (tx, slot, filename, hashChar) => {
        const versionId = randomUUID();
        await tx`INSERT INTO platform.document_versions(id,organization_id,student_case_id,document_slot_id,version_no,original_filename,declared_mime_type,byte_size,sha256_hex,
          ingest_evidence_ref,submitted_by_membership_id,integrity_status,malware_status,validation_updated_at)
          VALUES (${versionId},${organizationId},${assistedCase},${slot.id},1,${filename},'application/pdf',2048,${hashChar.repeat(64)},'synthetic:mobile-dev:document',${assisted.membershipId},'verified','pending','2026-10-05T08:00:00Z')`;
        await tx`UPDATE platform.document_slots SET status='submitted', current_version_id=${versionId}, current_version_no=1 WHERE id=${slot.id}`;
        return versionId;
      };
      const reviewId = randomUUID();
      const notificationId = randomUUID();
      await sql.begin(async (tx) => {
        await addVersion(tx, slots[0], "synthetic-document-1.pdf", "c");                    // загружен, ждёт проверки
        const rejectedVersion = await addVersion(tx, slots[1], "synthetic-document-2.pdf", "d"); // отклонён -> нужна замена
        await tx`UPDATE platform.document_slots SET status='rejected' WHERE id=${slots[1].id}`;
        await tx`INSERT INTO platform.document_reviews(id,organization_id,student_case_id,document_slot_id,document_version_id,decision,reason,reviewer_membership_id,request_id,created_at)
          VALUES (${reviewId},${organizationId},${assistedCase},${slots[1].id},${rejectedVersion},'rejected','Загрузите более чёткую копию.',${curator.membershipId},${randomUUID()},'2026-10-05T09:00:00Z')`;
        await tx`INSERT INTO platform.notifications(id,organization_id,student_case_id,recipient_membership_id,category,title,body,dedupe_key,created_by_membership_id,created_at,updated_at)
          VALUES (${notificationId},${organizationId},${assistedCase},${assisted.membershipId},'document.review','Требуется исправление документа','Загрузите более чёткую копию.',
          ${`synthetic:mobile-dev:notification:${notificationId}`},${curator.membershipId},'2026-10-05T09:00:00Z','2026-10-05T09:00:00Z')`;
        await tx`INSERT INTO platform.student_portal_notification_projection_v1(notification_id,organization_id,student_case_id,recipient_membership_id,source_record_id,
          document_slot_id,document_version_id,document_requirement_id,review_decision,requirement_label,created_at)
          VALUES (${notificationId},${organizationId},${assistedCase},${assisted.membershipId},${reviewId},${slots[1].id},${rejectedVersion},NULL,'rejected',
          ${slots[1].display_label},'2026-10-05T09:00:00Z')`;
      });
      log("чек-лист: 1 загружен, 1 отклонён (с уведомлением), остальные обязательные");
    }

    // ---- заявка в вуз, виза, оплата ----
    const [hasApplication] = await sql`SELECT 1 FROM platform.university_applications WHERE organization_id=${organizationId} AND student_case_id=${assistedCase} LIMIT 1`;
    if (!hasApplication) {
      const applicationId = randomUUID();
      const visaId = randomUUID();
      await sql.begin(async (tx) => {
        await tx`INSERT INTO platform.university_applications(id,organization_id,student_case_id,institution_name,program_name,status,latest_evidence_reference,created_by_membership_id,is_primary,university_deadline_on,country,degree)
          VALUES (${applicationId},${organizationId},${assistedCase},'Test University Alpha','Computer Science','submitted','synthetic:mobile-dev:application',${curator.membershipId},TRUE,'2027-01-15',NULL,'Bachelor')`;
        await tx`INSERT INTO platform.university_application_events(id,organization_id,application_id,student_case_id,previous_status,new_status,evidence_reference,note,actor_membership_id,request_id,created_at)
          VALUES (${randomUUID()},${organizationId},${applicationId},${assistedCase},'ready','submitted','synthetic:mobile-dev:application',NULL,${curator.membershipId},${randomUUID()},'2026-10-10T10:00:00Z')`;
        await tx`INSERT INTO platform.visa_cases(id,organization_id,student_case_id,status,latest_evidence_reference,created_by_membership_id) VALUES (${visaId},${organizationId},${assistedCase},'docs',NULL,${curator.membershipId})`;
        await tx`INSERT INTO platform.visa_case_events(id,organization_id,visa_case_id,student_case_id,previous_status,new_status,evidence_reference,note,actor_membership_id,request_id,created_at)
          VALUES (${randomUUID()},${organizationId},${visaId},${assistedCase},NULL,'docs',NULL,NULL,${curator.membershipId},${randomUUID()},'2026-10-10T11:00:00Z')`;
      });
      log("заявка в вуз и виза созданы");
    }

    const putFile = async (objectName, bytes) => {
      const uploaded = await service.storage.from(BUCKET).upload(objectName, bytes, { contentType: "application/pdf", upsert: true });
      assert.equal(uploaded.error, null, `STORAGE_UPLOAD_FAILED ${uploaded.error?.message}`);
    };
    const [hasContract] = await sql`SELECT 1 FROM platform.case_contract_files WHERE organization_id=${organizationId} AND student_case_id=${assistedCase} AND superseded_at IS NULL`;
    if (!hasContract) {
      const bytes = makePdf("EVO synthetic contract (test data)");
      const objectName = `case-contracts/${organizationId}/${assistedCase}/${randomUUID()}`;
      await putFile(objectName, bytes);
      await sql`INSERT INTO platform.case_contract_files(id,organization_id,student_case_id,original_filename,declared_mime_type,byte_size,sha256_hex,storage_object_name,uploaded_by_membership_id)
        VALUES (${randomUUID()},${organizationId},${assistedCase},'contract.pdf','application/pdf',${bytes.byteLength},${sha256(bytes)},${objectName},${curator.membershipId})`;
      log("договор (PDF) загружен в Storage");
    }
    const [hasReceipt] = await sql`SELECT 1 FROM platform.payment_receipt_files WHERE organization_id=${organizationId} AND student_case_id=${assistedCase}`;
    if (!hasReceipt) {
      const bytes = makePdf("EVO synthetic payment receipt (test data)");
      const objectName = `payment-receipts/${organizationId}/${assistedCase}/${randomUUID()}`;
      await putFile(objectName, bytes);
      const obligationId = randomUUID();
      const eventId = randomUUID();
      await sql.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = replica`;
        await tx`INSERT INTO platform.payment_obligations(id,organization_id,student_case_id,label,category,amount_minor,currency,due_at,next_action,total_paid_minor,total_refunded_minor,created_by_membership_id)
          VALUES (${obligationId},${organizationId},${assistedCase},'Сервисный сбор EVO (синтетика)','evo_service_fee',100000,'USD','2027-01-20T08:00:00Z','Оплатить остаток',40000,0,${curator.membershipId})`;
        await tx`INSERT INTO platform.payment_events(id,organization_id,student_case_id,payment_obligation_id,event_type,amount_minor,currency,occurred_at,source_key,actor_membership_id,request_id)
          VALUES (${eventId},${organizationId},${assistedCase},${obligationId},'payment',40000,'USD','2026-10-02T10:00:00Z','synthetic:mobile-dev:payment',${curator.membershipId},${randomUUID()})`;
        await tx`INSERT INTO platform.payment_receipt_files(id,organization_id,student_case_id,payment_obligation_id,payment_event_id,original_filename,declared_mime_type,byte_size,sha256_hex,storage_object_name,uploaded_by_membership_id)
          VALUES (${randomUUID()},${organizationId},${assistedCase},${obligationId},${eventId},'receipt.pdf','application/pdf',${bytes.byteLength},${sha256(bytes)},${objectName},${curator.membershipId})`;
        await tx`SET LOCAL session_replication_role = origin`;
      });
      log("оплата 400 из 1000 USD и чек (PDF) созданы");
    }

    // ---- каталог вузов (синтетический, опубликованный) ----
    const catalog = [
      { key: "a", name: "Test University Alpha", country: "CN", city: "Beijing", overview: "Синтетический университет для проверки приложения (Китай)." },
      { key: "b", name: "Test University Beta", country: "CN", city: "Shanghai", overview: "Синтетический университет для проверки приложения (Китай)." },
      { key: "c", name: "Test University Gamma", country: "MY", city: "Kuala Lumpur", overview: "Синтетический университет для проверки приложения (Малайзия)." },
    ];
    const institutions = {};
    for (const [index, uni] of catalog.entries()) {
      let [row] = await sql`SELECT id FROM platform.catalog_institutions WHERE organization_id=${organizationId} AND institution_name=${uni.name}`;
      if (!row) {
        const id = randomUUID();
        const registry = randomUUID();
        await sql.begin(async (tx) => {
          await tx`SET LOCAL session_replication_role = replica`;
          await tx`INSERT INTO platform.catalog_institutions(id,organization_id,institution_kind,institution_name,country_code,city,source_registry_id,source_revision,import_batch_id,source_record_key,approved_by_membership_id)
            VALUES (${id},${organizationId},'university',${uni.name},${uni.country},${uni.city},${registry},'synthetic-mobile-dev',${randomUUID()},${`rec_${String(index + 1).repeat(32)}`},${admin.membershipId})`;
          await tx`INSERT INTO platform_private.university_catalog_publications(id,organization_id,institution_id,base_version,version,content,source_registry_id,status,reason,created_by_membership_id,reviewed_by_membership_id,reviewed_at)
            VALUES (${randomUUID()},${organizationId},${id},0,1,${tx.json(universityContent(uni.name, uni.country, uni.city, uni.overview))},${registry},'published','synthetic mobile dev',${admin.membershipId},${admin.membershipId},clock_timestamp())`;
          await tx`SET LOCAL session_replication_role = origin`;
        });
        row = { id };
      }
      institutions[uni.key] = row.id;
    }

    // ---- команды от имени самих пользователей ----
    const assistedClient = await signIn(assisted.email, assisted.password);
    const approvedClient = await signIn(approved.email, approved.password);
    const curatorClient = await signIn(curator.email, curator.password);

    const country = await assistedClient.schema("platform").rpc("set_student_country_choice_v1", { p_country: "CN", p_request_id: randomUUID() });
    assert.equal(country.error, null, `COUNTRY_CHOICE_FAILED ${country.error?.message}`);
    for (const [client, keys] of [[assistedClient, ["a", "b"]], [approvedClient, ["c"]]]) {
      for (const key of keys) {
        const fav = await client.schema("platform").rpc("set_university_favorite_v1", { p_institution_id: institutions[key], p_favored: true });
        assert.equal(fav.error, null, `FAVORITE_FAILED ${fav.error?.message}`);
      }
    }

    const [chat] = await sql`SELECT count(*)::int AS n FROM platform.case_chat_messages WHERE organization_id=${organizationId} AND student_case_id=${assistedCase}`;
    if (chat.n === 0) {
      const staffSays = async (body) => {
        const r = await curatorClient.schema("platform").rpc("case_chat_command", { p_organization_id: organizationId, p_student_case_id: assistedCase, p_request_id: randomUUID(), p_input: { mode: "post", body } });
        assert.equal(r.error, null, `STAFF_CHAT_FAILED ${r.error?.message}`);
      };
      const studentSays = async (body) => {
        const r = await assistedClient.schema("platform").rpc("portal_case_chat_post_v1", { p_request_id: randomUUID(), p_body: body });
        assert.equal(r.error, null, `STUDENT_CHAT_FAILED ${r.error?.message}`);
      };
      await staffSays("Здравствуйте! Я ваш куратор. Загрузите, пожалуйста, паспорт и аттестат по чек-листу.");
      await studentSays("Добрый день! Паспорт загрузил, аттестат пришлю завтра.");
      await staffSays("Отлично. Паспорт проверим сегодня, ответ придёт в уведомлении.");
      await studentSays("Спасибо! Какой срок подачи в университет?");
      await staffSays("Подача до 15 января 2027. Напомню заранее.");
      log("чат: 5 сообщений (куратор/студент), последнее непрочитано");
    }

    // ---- личная ссылка регистрации (не использована) ----
    let invite = previous?.registrationInvite ?? null;
    if (invite) {
      const hash = createHash("sha256").update(invite.token, "utf8").digest("hex");
      const [link] = await sql`SELECT used_at, expires_at FROM platform_private.student_registration_links WHERE token_hash=${hash}`;
      if (!link || link.used_at || new Date(link.expires_at) < new Date(Date.now() + 86_400_000)) invite = null;
    }
    if (!invite) {
      const clientId = randomUUID();
      const leadId = randomUUID();
      const registrantEmail = `test.invited.${randomBytes(3).toString("hex")}@${DOMAIN}`;
      await sql.begin(async (tx) => {
        await tx`INSERT INTO platform.clients(id,organization_id,display_name,normalized_name,email,normalized_email)
          VALUES (${clientId},${organizationId},'Тест Приглашённый','тест приглашённый',${registrantEmail},${registrantEmail})`;
        await tx`INSERT INTO platform.leads(id,organization_id,client_id,current_owner_membership_id,stage_key,source_key,lifecycle_state)
          VALUES (${leadId},${organizationId},${clientId},${sales.membershipId},'qualified','synthetic_mobile_dev','open')`;
      });
      const token = randomBytes(24).toString("base64url");
      const hash = createHash("sha256").update(token, "utf8").digest("hex");
      const adminClient = await signIn(admin.email, admin.password);
      const link = await adminClient.schema("platform").rpc("create_student_registration_link_v1", { p_organization_id: organizationId, p_lead_id: leadId, p_token_hash: hash });
      assert.equal(link.error, null, `REGISTRATION_LINK_FAILED ${link.error?.code} ${link.error?.message}`);
      invite = { token, email: registrantEmail, expiresAt: link.data?.expires_at ?? null };
      log("личная ссылка регистрации создана");
    }

    return {
      organizationId,
      cases: { approved: approvedCase, assisted: assistedCase },
      institutions,
      accounts,
      registrationInvite: { ...invite, path: `/apply?invite=${invite.token}` },
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
