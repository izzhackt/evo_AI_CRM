-- CN/MY editorial playbooks on canonical cases, applications, visas and tasks.
-- Official RPC/locking foundations: https://supabase.com/docs/guides/database/functions
-- https://www.postgresql.org/docs/current/explicit-locking.html
BEGIN;

CREATE TABLE platform_private.admissions_playbook_versions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), direction TEXT NOT NULL CHECK(direction IN ('CN','MY')),
 version TEXT NOT NULL CHECK(version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
 title TEXT NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 content JSONB NOT NULL CHECK(jsonb_typeof(content)='object'),
 published_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(), UNIQUE(direction,version),
 UNIQUE(id,direction)
);
ALTER TABLE platform_private.admissions_playbook_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.admissions_playbook_versions FORCE ROW LEVEL SECURITY;
CREATE TRIGGER admissions_playbooks_immutable BEFORE UPDATE OR DELETE ON platform_private.admissions_playbook_versions
 FOR EACH ROW EXECUTE FUNCTION private.forbid_case_note_change();
CREATE TRIGGER admissions_playbooks_no_truncate BEFORE TRUNCATE ON platform_private.admissions_playbook_versions
 FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_case_note_change();

ALTER TABLE platform.student_cases
 ADD COLUMN admissions_direction TEXT CHECK(admissions_direction IN ('CN','MY','EUROPE','AE','TR')),
 ADD COLUMN admissions_playbook_version_id UUID,
 ADD COLUMN admissions_version BIGINT NOT NULL DEFAULT 0 CHECK(admissions_version>=0),
 ADD COLUMN admissions_facts JSONB NOT NULL DEFAULT '{}'::JSONB CHECK(jsonb_typeof(admissions_facts)='object'),
 ADD COLUMN admissions_outcome TEXT CHECK(admissions_outcome IN ('active','arrived','cancelled')),
 ADD COLUMN next_action_due_on DATE,
 ADD CONSTRAINT admissions_playbook_direction_fk FOREIGN KEY(admissions_playbook_version_id,admissions_direction)
   REFERENCES platform_private.admissions_playbook_versions(id,direction) ON DELETE RESTRICT,
 ADD CONSTRAINT admissions_binding_shape CHECK(admissions_playbook_version_id IS NULL OR
   (admissions_direction IN ('CN','MY') AND admissions_version>0 AND admissions_outcome IS NOT NULL)),
 ADD CONSTRAINT admissions_due_on_range CHECK(next_action_due_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31');
ALTER TABLE platform.university_applications ADD COLUMN admissions_details JSONB NOT NULL DEFAULT '{}'::JSONB CHECK(jsonb_typeof(admissions_details)='object');
ALTER TABLE platform.visa_cases ADD COLUMN admissions_details JSONB NOT NULL DEFAULT '{}'::JSONB CHECK(jsonb_typeof(admissions_details)='object');
CREATE INDEX admissions_case_direction_queue_idx ON platform.student_cases(organization_id,admissions_direction,current_curator_membership_id,updated_at DESC,id DESC);
CREATE INDEX admissions_case_next_action_idx ON platform.student_cases(organization_id,next_action_due_on) WHERE state='active' AND admissions_playbook_version_id IS NOT NULL;

CREATE TABLE platform_private.admissions_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL, student_case_id UUID NOT NULL,
 actor_membership_id UUID NOT NULL, request_id UUID NOT NULL, input_hash TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('configured','facts_updated','transition','application_updated','visa_updated')),
 stage TEXT NOT NULL, outcome TEXT, reason TEXT NOT NULL, before_snapshot JSONB NOT NULL,
 after_snapshot JSONB NOT NULL, receipt JSONB NOT NULL, effective_on DATE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,student_case_id) REFERENCES platform.student_cases(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,actor_membership_id) REFERENCES platform.organization_memberships(organization_id,id) ON DELETE RESTRICT,
 UNIQUE(actor_membership_id,request_id)
);
CREATE INDEX admissions_events_case_history_idx ON platform_private.admissions_events(organization_id,student_case_id,created_at DESC,id DESC);
CREATE INDEX admissions_events_arrival_period_idx ON platform_private.admissions_events(organization_id,effective_on,student_case_id) WHERE kind='transition' AND outcome='arrived';
ALTER TABLE platform_private.admissions_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_private.admissions_events FORCE ROW LEVEL SECURITY;
CREATE TRIGGER admissions_events_immutable BEFORE UPDATE OR DELETE ON platform_private.admissions_events
 FOR EACH ROW EXECUTE FUNCTION private.forbid_case_note_change();
CREATE TRIGGER admissions_events_no_truncate BEFORE TRUNCATE ON platform_private.admissions_events
 FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_case_note_change();

CREATE FUNCTION platform_private.admissions_stage_index(p_stage TEXT) RETURNS INTEGER
 LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
 SELECT array_position(ARRAY['intake','profile_and_route','documents','applications','decisions','visa_and_predeparture','arrival_and_adaptation']::TEXT[],p_stage)
$$;

CREATE FUNCTION platform_private.admissions_primary_application(p_case_id UUID) RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT id FROM platform.university_applications WHERE student_case_id=p_case_id AND is_primary
$$;
CREATE FUNCTION platform_private.admissions_primary_changed() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.is_primary) OR (TG_OP='UPDATE' AND NEW.is_primary IS DISTINCT FROM OLD.is_primary) THEN
   UPDATE platform.student_cases SET admissions_version=admissions_version+1
    WHERE organization_id=NEW.organization_id AND id=NEW.student_case_id AND admissions_playbook_version_id IS NOT NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admissions_primary_revision AFTER INSERT OR UPDATE OF is_primary ON platform.university_applications FOR EACH ROW EXECUTE FUNCTION platform_private.admissions_primary_changed();

CREATE FUNCTION platform_private.admissions_validate_playbook() RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item JSONB; expected TEXT[]:=ARRAY['intake','profile_and_route','documents','applications','decisions','visa_and_predeparture','arrival_and_adaptation']; keys TEXT[];
BEGIN
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(NEW.content) key)
   IS DISTINCT FROM ARRAY['limitations','messages','sources','stages','tasks']::TEXT[] THEN
   RAISE EXCEPTION 'Invalid playbook sections' USING ERRCODE='22023'; END IF;
 FOREACH item IN ARRAY ARRAY[NEW.content->'stages',NEW.content->'tasks',NEW.content->'messages',NEW.content->'sources',NEW.content->'limitations'] LOOP
   IF jsonb_typeof(item)<>'array' THEN RAISE EXCEPTION 'Playbook sections must be arrays' USING ERRCODE='22023'; END IF;
 END LOOP;
 SELECT array_agg(e->>'key' ORDER BY n) INTO keys FROM jsonb_array_elements(NEW.content->'stages') WITH ORDINALITY t(e,n);
 IF keys IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Exactly seven ordered canonical stages required' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.content->'tasks') LOOP
   IF COALESCE(item->>'key','') !~ '^[a-z][a-z0-9_.-]{0,63}$' OR NOT(item->>'stageKey'=ANY(expected))
      OR COALESCE(item->>'title','')='' OR item->>'priority' NOT IN ('normal','high')
      OR item->'studentVisible' IS DISTINCT FROM 'false'::JSONB THEN
      RAISE EXCEPTION 'Invalid playbook task' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.content->'tasks') e GROUP BY e->>'key' HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.content->'messages') e GROUP BY e->>'id' HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.content->'sources') e GROUP BY e->>'id' HAVING count(*)>1) THEN
   RAISE EXCEPTION 'Duplicate playbook stable ID' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admissions_playbooks_validate BEFORE INSERT ON platform_private.admissions_playbook_versions
 FOR EACH ROW EXECUTE FUNCTION platform_private.admissions_validate_playbook();

CREATE FUNCTION platform_private.admissions_field_schema(p_kind TEXT) RETURNS JSONB
 LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
 SELECT ('{"case":{"referralAgency":"text","contactConfirmedOn":"date","serviceScopeEvidence":"text","campus":"text","intake":"text","programme":"text","selectionConfirmedOn":"date","selectionConfirmedBy":"text","selectionEvidence":"text","housingApplicability":["needs_confirmation","required","not_required"],"housingNotRequiredReason":"text","housingBudget":"text","housingCurrency":"text","housingCampus":"text","housingMoveInOn":"date","housingApprovedOption":"text","housingApprovedOn":"date","housingContractTerms":"text","housingDepositTerms":"text","housingBookingEvidence":"text","financeReferences":"text","departureOn":"date","departureEvidence":"text","plannedArrivalOn":"date","receivingContact":"text","receivingPartyNotifiedOn":"date","receivingPartyEvidence":"text","flightReference":"text","arrivalOn":"date","arrivalConfirmedBy":"text","arrivalEvidence":"text","medicalStatus":["pending","confirmed","not_required"],"medicalOn":"date","medicalEvidence":"text","registrationStatus":["pending","confirmed","not_required"],"registrationOn":"date","registrationEvidence":"text","studentPassStatus":["pending","confirmed","not_required"],"studentPassOn":"date","studentPassEvidence":"text","postArrivalInstructionsOn":"date","postArrivalInstructionsEvidence":"text"},"application":{"submissionPartner":"text","partnerContact":"text","receivingRole":"text","packageReference":"text","packageVersion":"text","partnerReplyDueOn":"date","lastContactOn":"date","partnerSentOn":"date","partnerReceivedOn":"date","partnerReceiptEvidence":"text","universitySubmittedOn":"date","universitySubmissionReference":"text","universitySubmissionEvidence":"text","correctionRequest":"text","correctionDeadline":"date","correctionResolvedOn":"date","decisionType":["pending","pre_admission","conditional","unconditional","rejected","enrolled"],"decisionReference":"text","decisionOn":"date","decisionEvidence":"text","offerConditions":"text","offerDeadline":"date","conditionsFulfilledOn":"date","conditionsEvidence":"text","selectedOn":"date","selectedBy":"text","selectionEvidence":"text","documentsApplicability":["needs_confirmation","required","not_required"],"documentsSource":"text","documentsCheckedOn":"date","documentSlotIds":"text","documentExceptionSlotIds":"text","documentsExceptionReason":"text","documentsExceptionEvidence":"text"},"visa":{"passportExpiresOn":"date","applicability":["needs_confirmation","required","not_required"],"applicabilityReason":"text","applicabilitySource":"text","applicabilityCheckedOn":"date","visaType":"text","jwReference":"text","visaIssuedOn":"date","visaExpiresOn":"date","emgsReference":"text","emgsStatus":"text","eValStatus":["pending","approved","rejected"],"eValReference":"text","eValIssuedOn":"date","eValExpiresOn":"date","eValEvidence":"text","entryVisaApplicability":["needs_confirmation","required","not_required"],"entryVisaReason":"text","entryVisaSource":"text","entryVisaCheckedOn":"date","entryVisaStatus":["pending","approved","rejected"],"entryVisaEvidence":"text","entryVisaExpiresOn":"date","mdacApplicability":["needs_confirmation","required","not_required"],"mdacReason":"text","mdacSource":"text","mdacCheckedOn":"date","mdacSubmittedOn":"date","mdacEvidence":"text"}}'::JSONB)->p_kind
$$;
CREATE FUNCTION platform_private.admissions_validate_fields(p_kind TEXT,p_value JSONB) RETURNS JSONB
 LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE field RECORD; schema JSONB:=platform_private.admissions_field_schema(p_kind); rule JSONB; val TEXT; parsed_date DATE;
BEGIN
 IF schema IS NULL OR p_value IS NULL OR jsonb_typeof(p_value)<>'object' OR octet_length(p_value::TEXT)>65536 THEN
   RAISE EXCEPTION 'Invalid admissions details' USING ERRCODE='22023'; END IF;
 FOR field IN SELECT * FROM jsonb_each(p_value) LOOP
   rule:=schema->field.key; val:=field.value#>>'{}';
   IF rule IS NULL OR jsonb_typeof(field.value)<>'string' OR length(btrim(val)) NOT BETWEEN 1 AND 2000
     OR val ~ '[\x01-\x08\x0B\x0C\x0E-\x1F]' THEN
     RAISE EXCEPTION 'Invalid admissions field: %',field.key USING ERRCODE='22023'; END IF;
   IF jsonb_typeof(rule)='array' AND NOT(rule ? val) THEN RAISE EXCEPTION 'Invalid admissions choice: %',field.key USING ERRCODE='22023'; END IF;
   IF rule='"date"'::JSONB THEN
     BEGIN parsed_date:=val::DATE; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid calendar date' USING ERRCODE='22023'; END;
     IF val !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR parsed_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
       OR to_char(parsed_date,'YYYY-MM-DD')<>val THEN RAISE EXCEPTION 'Invalid calendar date' USING ERRCODE='22023'; END IF;
   END IF;
 END LOOP;
 IF p_kind='case' THEN
   FOREACH val IN ARRAY ARRAY['medical','registration','studentPass'] LOOP
     IF p_value->>(val||'Status')='confirmed' AND
       (NOT p_value ? (val||'On') OR NOT p_value ? (val||'Evidence')) THEN
       RAISE EXCEPTION 'Confirmed post-arrival fact requires date and evidence' USING ERRCODE='22023'; END IF;
     IF p_value->>(val||'Status')='not_required' AND NOT p_value ? (val||'Evidence') THEN
       RAISE EXCEPTION 'Post-arrival exception requires evidence' USING ERRCODE='22023'; END IF;
   END LOOP;
   IF p_value ? 'arrivalOn' AND ((p_value->>'arrivalOn')::DATE > CURRENT_DATE
     OR (p_value ? 'departureOn' AND (p_value->>'arrivalOn')::DATE < (p_value->>'departureOn')::DATE)) THEN
     RAISE EXCEPTION 'Actual arrival cannot be future or before departure' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN p_value;
END $$;

CREATE FUNCTION platform_private.admissions_gate(p_case_id UUID,p_stage TEXT) RETURNS TEXT[]
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c platform.student_cases%ROWTYPE; app platform.university_applications%ROWTYPE; visa platform.visa_cases%ROWTYPE;
 f JSONB; d JSONB; v JSONB; blocked TEXT[]:=ARRAY[]::TEXT[]; ids UUID[]; exceptions UUID[]; planned DATE; ack TEXT;
BEGIN
 SELECT * INTO STRICT c FROM platform.student_cases WHERE id=p_case_id;
 f:=c.admissions_facts;
 SELECT * INTO app FROM platform.university_applications WHERE is_primary AND student_case_id=c.id AND organization_id=c.organization_id;
 d:=COALESCE(app.admissions_details,'{}');
 SELECT * INTO visa FROM platform.visa_cases WHERE student_case_id=c.id AND organization_id=c.organization_id;
 v:=COALESCE(visa.admissions_details,'{}');
 IF p_stage='intake' THEN
   IF NOT EXISTS(SELECT 1 FROM platform.sales_admissions_handoffs WHERE student_case_id=c.id AND organization_id=c.organization_id) THEN blocked:=array_append(blocked,'Нет подтверждённой передачи из Sales'); END IF;
   SELECT r.decision INTO ack FROM platform.student_case_handoff_acknowledgements r
    JOIN platform.student_case_assignment_events a ON a.id=r.assignment_event_id
    WHERE r.student_case_id=c.id AND r.organization_id=c.organization_id AND a.new_scope_version=c.current_scope_version
     AND r.curator_membership_id=c.current_curator_membership_id ORDER BY r.revision DESC LIMIT 1;
   IF ack IS DISTINCT FROM 'accepted' THEN blocked:=array_append(blocked,'Куратор ещё не подтвердил приём текущей передачи'); END IF;
   IF c.next_action IS NULL OR c.next_action_due_on IS NULL THEN blocked:=array_append(blocked,'Укажите следующий шаг и дату'); END IF;
 ELSIF p_stage='profile_and_route' THEN
   IF c.route_approval_status<>'approved' THEN blocked:=array_append(blocked,'Маршрут не согласован'); END IF;
   IF app.id IS NULL OR app.status IN ('rejected','withdrawn','closed') THEN blocked:=array_append(blocked,'Выберите актуальную основную заявку'); END IF;
   IF NOT(f ?& ARRAY['selectionConfirmedOn','selectionConfirmedBy','selectionEvidence','programme','intake']) THEN blocked:=array_append(blocked,'Нужны программа, набор и подтверждение выбора клиента'); END IF;
 ELSIF p_stage='documents' THEN
   IF app.id IS NULL THEN blocked:=array_append(blocked,'Основная заявка не выбрана'); END IF;
   IF NOT(d ?& ARRAY['documentsSource','documentsCheckedOn']) OR COALESCE(d->>'documentsApplicability','needs_confirmation')='needs_confirmation' THEN
     blocked:=array_append(blocked,'Подтвердите применимые документы основной заявки по датированному источнику');
   ELSIF d->>'documentsApplicability'='required' THEN
     ids:=platform_private.admissions_document_ids(d->>'documentSlotIds'); exceptions:=platform_private.admissions_document_ids(d->>'documentExceptionSlotIds');
     IF cardinality(ids)=0 THEN blocked:=array_append(blocked,'Не выбраны документы основной заявки'); END IF;
     IF EXISTS(SELECT 1 FROM unnest(ids) wanted(slot_id) LEFT JOIN platform.document_slots s ON s.id=wanted.slot_id AND s.organization_id=c.organization_id AND s.student_case_id=c.id AND s.removed_at IS NULL
       WHERE s.id IS NULL OR NOT EXISTS(SELECT 1 FROM platform.document_slot_case_links l WHERE l.organization_id=c.organization_id AND l.student_case_id=c.id AND l.document_slot_id=s.id AND l.university_application_id=app.id)
        OR (s.status<>'approved' AND NOT(s.id=ANY(exceptions)))) THEN blocked:=array_append(blocked,'Документы основной заявки ещё не приняты или не привязаны к этой заявке'); END IF;
     IF cardinality(exceptions)>0 AND (NOT exceptions<@ids OR NOT(d ?& ARRAY['documentsExceptionReason','documentsExceptionEvidence'])) THEN blocked:=array_append(blocked,'Исключение должно относиться к выбранным документам и иметь причину с основанием'); END IF;
   END IF;
 ELSIF p_stage='applications' THEN
   IF app.id IS NULL OR app.status NOT IN ('submitted','under_review','offer','enrolled')
     OR NOT(d ?& ARRAY['universitySubmittedOn','universitySubmissionReference','universitySubmissionEvidence']) THEN blocked:=array_append(blocked,'Нужна фактическая подача в университет, а не только получение партнёром'); END IF;
   IF d ? 'correctionRequest' AND NOT d ? 'correctionResolvedOn' THEN blocked:=array_append(blocked,'Запрос исправлений ещё не закрыт'); END IF;
 ELSIF p_stage='decisions' THEN
   IF app.id IS NULL OR app.status NOT IN ('offer','enrolled') OR COALESCE(d->>'decisionType','pending') NOT IN ('conditional','unconditional','enrolled')
     OR NOT(d ?& ARRAY['decisionOn','decisionReference','decisionEvidence','selectedOn','selectedBy','selectionEvidence']) THEN blocked:=array_append(blocked,'Нужно подтверждённое решение университета и выбор клиента; предварительное зачисление недостаточно'); END IF;
   IF d->>'decisionType'='conditional' AND NOT(d ?& ARRAY['offerConditions','conditionsFulfilledOn','conditionsEvidence']) THEN blocked:=array_append(blocked,'Условия предложения ещё не подтверждены как выполненные'); END IF;
 ELSIF p_stage='visa_and_predeparture' THEN
   planned:=COALESCE((f->>'plannedArrivalOn')::DATE,(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE);
   IF visa.id IS NULL OR COALESCE(v->>'applicability','needs_confirmation')='needs_confirmation' OR NOT(v ?& ARRAY['applicabilityReason','applicabilitySource','applicabilityCheckedOn']) THEN blocked:=array_append(blocked,'Требования к визе требуют подтверждения по официальному источнику');
   -- MY's existing visa-case approval records pre-arrival clearance. Its eVAL
   -- and applicable entry visa have separate dates below; Student Pass
   -- endorsement is a post-arrival fact, never a fabricated generic visa date.
   ELSIF v->>'applicability'='required' AND (visa.status<>'approved' OR visa.latest_evidence_reference IS NULL OR
     (c.admissions_direction='CN' AND (NOT(v ?& ARRAY['visaIssuedOn','visaExpiresOn']) OR (v->>'visaExpiresOn')::DATE<planned))) THEN
     blocked:=array_append(blocked,CASE WHEN c.admissions_direction='MY' THEN 'Нет подтверждённой готовности к въезду; Student Pass оформляется отдельно после прибытия' ELSE 'Нет подтверждённой действующей визы для планового въезда' END);
   ELSIF v->>'applicability'='not_required' AND visa.status<>'not_required' THEN blocked:=array_append(blocked,'Статус визы не соответствует подтверждённому исключению'); END IF;
   IF NOT v ? 'passportExpiresOn' OR (v->>'passportExpiresOn')::DATE<=planned THEN blocked:=array_append(blocked,'Проверьте действительность паспорта на плановый въезд'); END IF;
   IF c.admissions_direction='MY' THEN
     IF v->>'applicability'='required' AND (v->>'eValStatus' IS DISTINCT FROM 'approved' OR NOT(v ?& ARRAY['emgsReference','eValReference','eValIssuedOn','eValExpiresOn','eValEvidence']) OR (v->>'eValExpiresOn')::DATE<planned) THEN blocked:=array_append(blocked,'EMGS / eVAL требуют отдельного подтверждения'); END IF;
     IF COALESCE(v->>'entryVisaApplicability','needs_confirmation')='needs_confirmation' OR NOT(v ?& ARRAY['entryVisaReason','entryVisaSource','entryVisaCheckedOn']) THEN blocked:=array_append(blocked,'Применимость SEV / eVISA не подтверждена');
     ELSIF v->>'entryVisaApplicability'='required' AND (v->>'entryVisaStatus' IS DISTINCT FROM 'approved' OR NOT(v ?& ARRAY['entryVisaEvidence','entryVisaExpiresOn']) OR (v->>'entryVisaExpiresOn')::DATE<planned) THEN blocked:=array_append(blocked,'Нужна действующая SEV / eVISA'); END IF;
     IF COALESCE(v->>'mdacApplicability','needs_confirmation')='needs_confirmation' OR NOT(v ?& ARRAY['mdacReason','mdacSource','mdacCheckedOn']) THEN blocked:=array_append(blocked,'Применимость MDAC не подтверждена');
     ELSIF v->>'mdacApplicability'='required' AND NOT(v ?& ARRAY['mdacSubmittedOn','mdacEvidence']) THEN blocked:=array_append(blocked,'Нет подтверждения MDAC'); END IF;
   END IF;
   IF COALESCE(f->>'housingApplicability','needs_confirmation')='needs_confirmation' THEN blocked:=array_append(blocked,'Уточните, нужен ли подбор жилья');
   ELSIF f->>'housingApplicability'='required' AND NOT(f ?& ARRAY['housingApprovedOption','housingApprovedOn','housingBookingEvidence','housingMoveInOn']) THEN blocked:=array_append(blocked,'Нет подтверждённого варианта и бронирования жилья');
   ELSIF f->>'housingApplicability'='not_required' AND NOT f ? 'housingNotRequiredReason' THEN blocked:=array_append(blocked,'Объясните, почему подбор жилья не нужен'); END IF;
   IF NOT(f ?& ARRAY['plannedArrivalOn','receivingContact','receivingPartyNotifiedOn','receivingPartyEvidence']) THEN blocked:=array_append(blocked,'Согласуйте плановое прибытие и встречающую сторону'); END IF;
 ELSIF p_stage='arrival_and_adaptation' THEN
   IF NOT(f ?& ARRAY['arrivalOn','arrivalConfirmedBy','arrivalEvidence']) THEN blocked:=array_append(blocked,'Нужны фактическая дата прибытия, подтвердивший человек и основание'); END IF;
 ELSE RAISE EXCEPTION 'Invalid stage' USING ERRCODE='22023'; END IF;
 IF p_stage IN ('documents','applications','visa_and_predeparture','arrival_and_adaptation') AND EXISTS(SELECT 1 FROM platform.stop_factors WHERE organization_id=c.organization_id AND student_case_id=c.id AND status='active') THEN
   blocked:=array_append(blocked,'Есть активный финансовый стоп-фактор: решить в Finance'); END IF;
 RETURN blocked;
END $$;

CREATE FUNCTION platform_private.admissions_guard_case() RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.admissions_playbook_version_id IS NOT NULL THEN
   IF NEW.admissions_playbook_version_id IS DISTINCT FROM OLD.admissions_playbook_version_id OR NEW.admissions_direction IS DISTINCT FROM OLD.admissions_direction THEN RAISE EXCEPTION 'Applied admissions playbook is immutable' USING ERRCODE='55000'; END IF;
   IF ROW(NEW.operational_stage,NEW.state,NEW.admissions_facts,NEW.admissions_outcome,NEW.next_action,NEW.next_action_due_on,NEW.route_approval_status,NEW.target_country,NEW.target_degree,NEW.program_direction,NEW.intake,NEW.language_assumption,NEW.funding_assumption)
      IS DISTINCT FROM ROW(OLD.operational_stage,OLD.state,OLD.admissions_facts,OLD.admissions_outcome,OLD.next_action,OLD.next_action_due_on,OLD.route_approval_status,OLD.target_country,OLD.target_degree,OLD.program_direction,OLD.intake,OLD.language_assumption,OLD.funding_assumption)
      AND NEW.admissions_version<>OLD.admissions_version+1 THEN RAISE EXCEPTION 'Use versioned admissions command for configured case' USING ERRCODE='PT409'; END IF;
 END IF;
 IF NEW.admissions_playbook_version_id IS NOT NULL THEN
   IF platform_private.admissions_stage_index(NEW.operational_stage) IS NULL OR
      (NEW.admissions_outcome='active') IS DISTINCT FROM (NEW.state='active') OR
      (NEW.admissions_outcome='arrived' AND (NEW.operational_stage<>'arrival_and_adaptation' OR NOT(NEW.admissions_facts ?& ARRAY['arrivalOn','arrivalConfirmedBy','arrivalEvidence']))) THEN
      RAISE EXCEPTION 'Invalid admissions lifecycle' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admissions_case_command_guard BEFORE UPDATE ON platform.student_cases FOR EACH ROW EXECUTE FUNCTION platform_private.admissions_guard_case();

CREATE FUNCTION platform_private.admissions_guard_related() RETURNS TRIGGER LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c platform.student_cases%ROWTYPE; d JSONB:=NEW.admissions_details; status_changed BOOLEAN; old_details JSONB:='{}'; keys TEXT[];
BEGIN
 SELECT * INTO c FROM platform.student_cases WHERE id=NEW.student_case_id AND organization_id=NEW.organization_id;
 IF c.admissions_playbook_version_id IS NULL THEN RETURN NEW; END IF;
 IF c.state<>'active' THEN RAISE EXCEPTION 'Reopen the case before changing application or visa facts' USING ERRCODE='22023'; END IF;
 status_changed:=TG_OP='INSERT';
 IF TG_OP='UPDATE' THEN status_changed:=NEW.status IS DISTINCT FROM OLD.status; old_details:=OLD.admissions_details; END IF;
 IF TG_TABLE_NAME='university_applications' THEN
   PERFORM platform_private.admissions_validate_fields('application',d);
   keys:=ARRAY['universitySubmittedOn','universitySubmissionReference','universitySubmissionEvidence'];
   IF NEW.status IN ('submitted','under_review','offer','enrolled') AND (status_changed OR old_details ?& keys) AND NOT(d ?& keys) THEN RAISE EXCEPTION 'University submission evidence required' USING ERRCODE='22023'; END IF;
   keys:=ARRAY['decisionType','decisionOn','decisionReference','decisionEvidence'];
   IF NEW.status IN ('offer','enrolled') AND (status_changed OR old_details ?& keys) AND (COALESCE(d->>'decisionType','pending') NOT IN ('conditional','unconditional','enrolled') OR NOT(d ?& keys)) THEN RAISE EXCEPTION 'Actual offer decision evidence required' USING ERRCODE='22023'; END IF;
   IF NEW.status='enrolled' AND (status_changed OR old_details ?& ARRAY['conditionsFulfilledOn','conditionsEvidence']) AND (d->>'decisionType'='conditional' AND NOT(d ?& ARRAY['conditionsFulfilledOn','conditionsEvidence'])) THEN RAISE EXCEPTION 'Offer conditions are unresolved' USING ERRCODE='22023'; END IF;
 ELSE
   PERFORM platform_private.admissions_validate_fields('visa',d);
   keys:=ARRAY['applicability','applicabilityReason','applicabilitySource','applicabilityCheckedOn'];
   IF c.admissions_direction='CN' THEN keys:=keys||ARRAY['visaIssuedOn','visaExpiresOn']; END IF;
   IF NEW.status='approved' AND (status_changed OR old_details ?& keys) AND (d->>'applicability' IS DISTINCT FROM 'required' OR NOT(d ?& keys)) THEN RAISE EXCEPTION 'Visa approval requires country details and applicability evidence' USING ERRCODE='22023'; END IF;
   keys:=ARRAY['applicability','applicabilityReason','applicabilitySource','applicabilityCheckedOn'];
   IF NEW.status='not_required' AND (status_changed OR old_details ?& keys) AND (d->>'applicability' IS DISTINCT FROM 'not_required' OR NOT(d ?& keys)) THEN RAISE EXCEPTION 'Visa exception needs a dated official basis' USING ERRCODE='22023'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER admissions_application_evidence_guard BEFORE INSERT OR UPDATE ON platform.university_applications FOR EACH ROW EXECUTE FUNCTION platform_private.admissions_guard_related();
CREATE TRIGGER admissions_visa_evidence_guard BEFORE INSERT OR UPDATE ON platform.visa_cases FOR EACH ROW EXECUTE FUNCTION platform_private.admissions_guard_related();

CREATE FUNCTION platform_private.admissions_seed_stage_tasks(p_case_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c platform.student_cases%ROWTYPE; a RECORD; item JSONB; task_id UUID; task_source TEXT; event_request UUID;
BEGIN
 SELECT * INTO a FROM platform_private.u7_require_case_workspace_actor(p_case_id);
 SELECT * INTO STRICT c FROM platform.student_cases WHERE id=p_case_id AND organization_id=a.organization_id;
 FOR item IN SELECT t.value FROM platform_private.admissions_playbook_versions v, LATERAL jsonb_array_elements(v.content->'tasks') t
  WHERE v.id=c.admissions_playbook_version_id AND t.value->>'stageKey'=c.operational_stage LOOP
   task_source:='admissions.'||c.admissions_playbook_version_id::TEXT||'.'||(item->>'key');
   task_id:=NULL; event_request:=gen_random_uuid();
   INSERT INTO platform.case_tasks(organization_id,student_case_id,task_type,title,assignee_membership_id,priority,status,student_visible,created_by_membership_id,source_key)
    VALUES(c.organization_id,c.id,'admissions',item->>'title',c.current_curator_membership_id,(item->>'priority')::platform.case_task_priority,'open',FALSE,a.membership_id,task_source)
    ON CONFLICT(organization_id,student_case_id,source_key) WHERE source_key IS NOT NULL DO NOTHING RETURNING id INTO task_id;
   IF task_id IS NOT NULL THEN
    INSERT INTO platform.case_task_events(organization_id,case_task_id,student_case_id,previous_status,new_status,previous_assignee_membership_id,new_assignee_membership_id,actor_membership_id,request_id)
    VALUES(c.organization_id,task_id,c.id,NULL,'open',NULL,c.current_curator_membership_id,a.membership_id,event_request);
   END IF;
 END LOOP;
END $$;

-- Same organization assignment lock as curator reassignment, then live identity,
-- case row, and related rows. Repeat scope checks after lock waits.
CREATE FUNCTION platform_private.admissions_lock_case(p_case_id UUID,p_permission TEXT DEFAULT 'case.route.manage')
 RETURNS platform.student_cases LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor RECORD; c platform.student_cases%ROWTYPE;
BEGIN
 SELECT * INTO actor FROM platform_private.u7_require_case_workspace_actor(p_case_id);
 PERFORM platform_private.lock_student_case_note_assignment_domain(actor.organization_id);
 PERFORM platform_private.require_domain_actor(actor.organization_id,p_permission);
 SELECT * INTO c FROM platform.student_cases WHERE organization_id=actor.organization_id AND id=p_case_id FOR UPDATE;
 PERFORM platform_private.u7_require_case_workspace_actor(p_case_id);
 PERFORM platform_private.require_case_operator(c.organization_id,c.id,p_permission);
 RETURN c;
END $$;

CREATE FUNCTION platform_private.admissions_request(p_case_id UUID,p_request_id UUID,p_input JSONB)
 RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; event platform_private.admissions_events%ROWTYPE; hashed TEXT;
BEGIN
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'request_id required' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM platform_private.u7_require_case_workspace_actor(p_case_id);
 PERFORM platform_private.lock_p2d_request(p_request_id);
 hashed:=encode(sha256(convert_to(p_input::TEXT,'UTF8')),'hex');
 SELECT * INTO event FROM platform_private.admissions_events WHERE actor_membership_id=a.membership_id AND request_id=p_request_id;
 IF FOUND THEN
   IF event.student_case_id<>p_case_id OR event.input_hash<>hashed THEN RAISE EXCEPTION 'Request ID reused with different payload' USING ERRCODE='22023'; END IF;
   RETURN event.receipt;
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION platform_private.admissions_record(p_case_id UUID,p_request_id UUID,p_input JSONB,p_kind TEXT,p_reason TEXT,p_before JSONB,p_after JSONB,p_receipt JSONB,p_effective_on DATE DEFAULT NULL)
 RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; c platform.student_cases%ROWTYPE;
BEGIN
 SELECT * INTO a FROM platform_private.u7_require_case_workspace_actor(p_case_id);
 SELECT * INTO STRICT c FROM platform.student_cases WHERE id=p_case_id AND organization_id=a.organization_id;
 INSERT INTO platform_private.admissions_events(organization_id,student_case_id,actor_membership_id,request_id,input_hash,kind,stage,outcome,reason,before_snapshot,after_snapshot,receipt,effective_on)
 VALUES(c.organization_id,c.id,a.membership_id,p_request_id,encode(sha256(convert_to(p_input::TEXT,'UTF8')),'hex'),p_kind,c.operational_stage,c.admissions_outcome,p_reason,p_before,p_after,p_receipt,p_effective_on);
 RETURN p_receipt;
END $$;

CREATE FUNCTION platform_private.admissions_document_ids(p_text TEXT) RETURNS UUID[]
 LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE ids UUID[]; item TEXT;
BEGIN
 IF p_text IS NULL THEN RETURN ARRAY[]::UUID[]; END IF;
 FOREACH item IN ARRAY string_to_array(p_text,',') LOOP
   IF btrim(item) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Invalid document selection' USING ERRCODE='22023'; END IF;
   ids:=array_append(ids,btrim(item)::UUID);
 END LOOP;
 IF cardinality(ids)>50 OR cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) THEN RAISE EXCEPTION 'Duplicate or excessive document selection' USING ERRCODE='22023'; END IF;
 RETURN COALESCE(ids,ARRAY[]::UUID[]);
END $$;

CREATE FUNCTION platform_private.admissions_case_command(p_case_id UUID,p_request_id UUID,p_mode TEXT,p_payload JSONB)
 RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c platform.student_cases%ROWTYPE; changed platform.student_cases%ROWTYPE; prior JSONB; replay JSONB; input JSONB;
 expected BIGINT; direction TEXT; playbook UUID; facts JSONB; primary_id UUID; stage TEXT; outcome TEXT; reason TEXT;
 blocked TEXT[]; i INTEGER; target_index INTEGER; old_index INTEGER; next_date DATE; receipt JSONB; actor RECORD;
BEGIN
 PERFORM platform_private.lock_p2d_request(p_request_id);
 c:=platform_private.admissions_lock_case(p_case_id);
 input:=jsonb_build_object('mode',p_mode,'caseId',p_case_id,'payload',p_payload);
 replay:=platform_private.admissions_request(c.id,p_request_id,input); IF replay IS NOT NULL THEN RETURN replay; END IF;
 expected:=(p_payload->>'expectedVersion')::BIGINT;
 IF expected IS NULL OR expected<>c.admissions_version OR expected=9223372036854775807 THEN RAISE EXCEPTION 'admissions_version_conflict' USING ERRCODE='PT409'; END IF;
 prior:=jsonb_build_object('version',c.admissions_version::TEXT,'direction',c.admissions_direction,'playbookVersionId',c.admissions_playbook_version_id,'facts',c.admissions_facts,'stage',c.operational_stage,'outcome',c.admissions_outcome,'primaryApplicationId',platform_private.admissions_primary_application(c.id),'routeApprovalStatus',c.route_approval_status,'nextAction',c.next_action,'nextActionDueOn',c.next_action_due_on);
 IF p_mode IN ('configured','facts_updated') THEN
   next_date:=(p_payload->>'nextActionDueOn')::DATE;
   IF length(btrim(COALESCE(p_payload->>'nextAction',''))) NOT BETWEEN 1 AND 1000 OR next_date IS NULL OR next_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' THEN RAISE EXCEPTION 'Next action and calendar date required' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_mode='configured' THEN
   direction:=p_payload->>'direction'; playbook:=(p_payload->>'playbookVersionId')::UUID;
   IF c.state<>'active' OR NOT EXISTS(SELECT 1 FROM platform.sales_admissions_handoffs WHERE student_case_id=c.id AND organization_id=c.organization_id) THEN RAISE EXCEPTION 'Configure admissions after the actual Sales handoff' USING ERRCODE='22023'; END IF;
   IF c.admissions_playbook_version_id IS NOT NULL THEN RAISE EXCEPTION 'Case already bound to immutable playbook' USING ERRCODE='22023'; END IF;
   IF direction IS NULL OR direction NOT IN ('CN','MY','EUROPE','AE','TR') OR
     (direction IN ('CN','MY') AND NOT EXISTS(SELECT 1 FROM platform_private.admissions_playbook_versions pv WHERE pv.id=playbook AND pv.direction=p_payload->>'direction')) OR
     (direction NOT IN ('CN','MY') AND playbook IS NOT NULL) THEN RAISE EXCEPTION 'Direction and published playbook mismatch' USING ERRCODE='22023'; END IF;
   UPDATE platform.student_cases SET admissions_direction=direction,admissions_playbook_version_id=playbook,admissions_version=admissions_version+1,
    operational_stage=CASE WHEN playbook IS NOT NULL THEN 'intake' ELSE operational_stage END,
    admissions_outcome=CASE WHEN playbook IS NOT NULL THEN 'active' ELSE NULL END,
    next_action=btrim(p_payload->>'nextAction'),next_action_due_on=next_date
    WHERE id=c.id AND organization_id=c.organization_id RETURNING * INTO changed;
   reason:='Направление и рабочий регламент выбраны вручную';
 ELSIF p_mode='facts_updated' THEN
   IF c.admissions_playbook_version_id IS NULL THEN RAISE EXCEPTION 'Configure a country playbook first' USING ERRCODE='22023'; END IF;
   facts:=platform_private.admissions_validate_fields('case',p_payload->'facts'); primary_id:=(p_payload->>'primaryApplicationId')::UUID;
   IF primary_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform.university_applications WHERE id=primary_id AND organization_id=c.organization_id AND student_case_id=c.id) THEN RAISE EXCEPTION 'Primary application unavailable' USING ERRCODE='42501'; END IF;
   IF p_payload->>'routeApprovalStatus' IS NULL OR p_payload->>'routeApprovalStatus' NOT IN ('draft','approved','rework') THEN RAISE EXCEPTION 'Invalid route approval' USING ERRCODE='22023'; END IF;
   IF c.admissions_outcome='cancelled' THEN RAISE EXCEPTION 'Reopen the cancelled case before changing facts' USING ERRCODE='22023'; END IF;
   IF c.admissions_outcome='arrived' AND (
     (facts-ARRAY['medicalStatus','medicalOn','medicalEvidence','registrationStatus','registrationOn','registrationEvidence','studentPassStatus','studentPassOn','studentPassEvidence','postArrivalInstructionsOn','postArrivalInstructionsEvidence']) IS DISTINCT FROM
     (c.admissions_facts-ARRAY['medicalStatus','medicalOn','medicalEvidence','registrationStatus','registrationOn','registrationEvidence','studentPassStatus','studentPassOn','studentPassEvidence','postArrivalInstructionsOn','postArrivalInstructionsEvidence']) OR
     primary_id IS DISTINCT FROM platform_private.admissions_primary_application(c.id) OR p_payload->>'routeApprovalStatus' IS DISTINCT FROM c.route_approval_status::TEXT) THEN RAISE EXCEPTION 'Only post-arrival facts can change without reopening' USING ERRCODE='22023'; END IF;
   IF c.admissions_outcome='arrived' AND (facts->'arrivalOn' IS DISTINCT FROM c.admissions_facts->'arrivalOn' OR facts->'arrivalConfirmedBy' IS DISTINCT FROM c.admissions_facts->'arrivalConfirmedBy' OR facts->'arrivalEvidence' IS DISTINCT FROM c.admissions_facts->'arrivalEvidence') THEN RAISE EXCEPTION 'Reopen with a reason before correcting confirmed arrival' USING ERRCODE='22023'; END IF;
   IF platform_private.admissions_primary_application(c.id) IS DISTINCT FROM primary_id THEN
     PERFORM platform_private.require_case_operator(c.organization_id,c.id,'application.manage');
     PERFORM 1 FROM platform.university_applications WHERE organization_id=c.organization_id AND student_case_id=c.id ORDER BY id FOR UPDATE;
     UPDATE platform.university_applications SET is_primary=FALSE,version=version+1 WHERE organization_id=c.organization_id AND student_case_id=c.id AND is_primary;
     UPDATE platform.university_applications SET is_primary=TRUE,version=version+1 WHERE organization_id=c.organization_id AND student_case_id=c.id AND id=primary_id;
   END IF;
   UPDATE platform.student_cases SET admissions_facts=facts,
    route_approval_status=(p_payload->>'routeApprovalStatus')::platform.route_approval_status,
    next_action=btrim(p_payload->>'nextAction'),next_action_due_on=next_date,admissions_version=admissions_version+1
    WHERE id=c.id AND organization_id=c.organization_id RETURNING * INTO changed;
   reason:='Обновлены подтверждённые факты маршрута';
 ELSIF p_mode='transition' THEN
   IF c.admissions_playbook_version_id IS NULL THEN RAISE EXCEPTION 'Configure a country playbook first' USING ERRCODE='22023'; END IF;
   stage:=p_payload->>'stage'; outcome:=p_payload->>'outcome'; reason:=btrim(p_payload->>'reason');
   IF outcome IN ('arrived','cancelled') OR c.state='closed' THEN PERFORM platform_private.require_case_operator(c.organization_id,c.id,'case.lifecycle.change'); END IF;
   target_index:=platform_private.admissions_stage_index(stage); old_index:=platform_private.admissions_stage_index(c.operational_stage);
   IF target_index IS NULL OR outcome IS NULL OR outcome NOT IN ('active','arrived','cancelled') OR COALESCE(length(reason),0) NOT BETWEEN 1 AND 1000 OR
      (target_index>old_index+1) OR (outcome='cancelled' AND stage<>c.operational_stage) OR (outcome='arrived' AND (stage<>'arrival_and_adaptation' OR c.operational_stage<>'arrival_and_adaptation')) OR
      (c.admissions_outcome=outcome AND stage=c.operational_stage) THEN RAISE EXCEPTION 'Invalid reasoned stage transition' USING ERRCODE='22023'; END IF;
   -- Cancellation is explicit, not a successful arrival; back-steps keep every fact.
   IF outcome<>'cancelled' AND (target_index>old_index OR outcome='arrived') THEN
     -- Lock the exact evidence rows before checking; case-first command paths
     -- below serialize related edits and all existing finance-stop assertions.
     PERFORM 1 FROM platform.university_applications WHERE student_case_id=c.id AND organization_id=c.organization_id ORDER BY id FOR UPDATE;
     PERFORM 1 FROM platform.visa_cases WHERE student_case_id=c.id AND organization_id=c.organization_id ORDER BY id FOR UPDATE;
     PERFORM 1 FROM platform.document_slots WHERE student_case_id=c.id AND organization_id=c.organization_id ORDER BY id FOR UPDATE;
     PERFORM 1 FROM platform.document_slot_case_links WHERE student_case_id=c.id AND organization_id=c.organization_id ORDER BY id FOR UPDATE;
     PERFORM 1 FROM platform.stop_factors WHERE student_case_id=c.id AND organization_id=c.organization_id ORDER BY id FOR UPDATE;
     FOR i IN 1..CASE WHEN outcome='arrived' THEN 7 ELSE target_index-1 END LOOP
       blocked:=platform_private.admissions_gate(c.id,(ARRAY['intake','profile_and_route','documents','applications','decisions','visa_and_predeparture','arrival_and_adaptation'])[i]);
       IF cardinality(blocked)>0 THEN RAISE EXCEPTION '%',array_to_string(blocked,'; ') USING ERRCODE='22023'; END IF;
     END LOOP;
   END IF;
   UPDATE platform.student_cases SET operational_stage=stage,admissions_outcome=outcome,admissions_version=admissions_version+1,
     state=CASE WHEN outcome='active' THEN 'active'::platform.student_case_state ELSE 'closed'::platform.student_case_state END,
     closed_at=CASE WHEN outcome='active' THEN NULL ELSE clock_timestamp() END
     WHERE id=c.id AND organization_id=c.organization_id RETURNING * INTO changed;
   IF changed.state<>c.state THEN
     SELECT * INTO actor FROM platform_private.u7_require_case_workspace_actor(c.id);
     INSERT INTO platform.student_case_lifecycle_events(organization_id,student_case_id,event_type,previous_state,new_state,actor_membership_id,reason,request_id)
      VALUES(c.organization_id,c.id,CASE WHEN changed.state='closed' THEN 'closed' ELSE 'reopened' END,c.state,changed.state,actor.membership_id,reason,p_request_id);
   END IF;
 ELSE RAISE EXCEPTION 'Unknown admissions command' USING ERRCODE='22023'; END IF;
 IF changed.admissions_playbook_version_id IS NOT NULL AND changed.state='active' AND p_mode IN ('configured','transition') THEN PERFORM platform_private.admissions_seed_stage_tasks(c.id); END IF;
 receipt:=jsonb_build_object('caseId',c.id,'version',changed.admissions_version::TEXT,'stage',changed.operational_stage,'outcome',changed.admissions_outcome,'requestId',p_request_id,'changedAt',changed.updated_at);
 RETURN platform_private.admissions_record(c.id,p_request_id,input,p_mode,reason,prior,
   jsonb_build_object('facts',changed.admissions_facts,'primaryApplicationId',platform_private.admissions_primary_application(c.id),'routeApprovalStatus',changed.route_approval_status,'nextAction',changed.next_action,'nextActionDueOn',changed.next_action_due_on),receipt,
   CASE WHEN p_mode='transition' AND outcome='arrived' THEN (changed.admissions_facts->>'arrivalOn')::DATE ELSE NULL END);
END $$;

CREATE FUNCTION platform.configure_case_admissions_v1(p_student_case_id UUID,p_expected_version BIGINT,p_direction TEXT,p_playbook_version_id UUID,p_next_action TEXT,p_next_action_due_on DATE,p_request_id UUID)
 RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT platform_private.admissions_case_command(p_student_case_id,p_request_id,'configured',jsonb_build_object('expectedVersion',p_expected_version,'direction',p_direction,'playbookVersionId',p_playbook_version_id,'nextAction',p_next_action,'nextActionDueOn',p_next_action_due_on))
$$;
CREATE FUNCTION platform.update_case_admissions_facts_v1(p_student_case_id UUID,p_expected_version BIGINT,p_facts JSONB,p_primary_application_id UUID,p_route_approval_status TEXT,p_next_action TEXT,p_next_action_due_on DATE,p_request_id UUID)
 RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT platform_private.admissions_case_command(p_student_case_id,p_request_id,'facts_updated',jsonb_build_object('expectedVersion',p_expected_version,'facts',p_facts,'primaryApplicationId',p_primary_application_id,'routeApprovalStatus',p_route_approval_status,'nextAction',p_next_action,'nextActionDueOn',p_next_action_due_on))
$$;
CREATE FUNCTION platform.transition_case_admissions_v1(p_student_case_id UUID,p_expected_version BIGINT,p_stage TEXT,p_outcome TEXT,p_reason TEXT,p_request_id UUID)
 RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT platform_private.admissions_case_command(p_student_case_id,p_request_id,'transition',jsonb_build_object('expectedVersion',p_expected_version,'stage',p_stage,'outcome',p_outcome,'reason',p_reason))
$$;

CREATE FUNCTION platform_private.admissions_related_command(p_case_id UUID,p_resource_id UUID,p_expected_version BIGINT,p_details JSONB,p_request_id UUID,p_kind TEXT)
 RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c platform.student_cases%ROWTYPE; a platform.university_applications%ROWTYPE; v platform.visa_cases%ROWTYPE;
 input JSONB; replay JSONB; receipt JSONB; prior JSONB; next_version BIGINT; changed_at TIMESTAMPTZ; ids UUID[]; exceptions UUID[];
BEGIN
 PERFORM platform_private.lock_p2d_request(p_request_id);
 c:=platform_private.admissions_lock_case(p_case_id,CASE WHEN p_kind='application' THEN 'application.manage' ELSE 'visa.manage' END);
 IF c.admissions_playbook_version_id IS NULL THEN RAISE EXCEPTION 'Configure a country playbook first' USING ERRCODE='22023'; END IF;
 input:=jsonb_build_object('mode',p_kind,'caseId',p_case_id,'resourceId',p_resource_id,'expectedVersion',p_expected_version,'details',p_details);
 replay:=platform_private.admissions_request(c.id,p_request_id,input); IF replay IS NOT NULL THEN RETURN replay; END IF;
 PERFORM platform_private.admissions_validate_fields(p_kind,p_details);
 IF p_kind='application' THEN
   SELECT * INTO a FROM platform.university_applications WHERE organization_id=c.organization_id AND student_case_id=c.id AND id=p_resource_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Application unavailable for this case' USING ERRCODE='42501'; END IF;
   IF p_expected_version IS NULL OR a.version<>p_expected_version OR a.version=9223372036854775807 THEN RAISE EXCEPTION 'admissions_version_conflict' USING ERRCODE='PT409'; END IF;
   ids:=platform_private.admissions_document_ids(p_details->>'documentSlotIds'); exceptions:=platform_private.admissions_document_ids(p_details->>'documentExceptionSlotIds');
   IF NOT exceptions<@ids OR EXISTS(SELECT 1 FROM unnest(ids) item WHERE NOT EXISTS(SELECT 1 FROM platform.document_slots s JOIN platform.document_slot_case_links l ON l.organization_id=s.organization_id AND l.student_case_id=s.student_case_id AND l.document_slot_id=s.id WHERE s.id=item AND s.organization_id=c.organization_id AND s.student_case_id=c.id AND s.removed_at IS NULL AND l.university_application_id=a.id)) THEN RAISE EXCEPTION 'Document selection unavailable or not linked to this application' USING ERRCODE='42501'; END IF;
   prior:=a.admissions_details;
   UPDATE platform.university_applications SET admissions_details=p_details,version=version+1 WHERE id=a.id RETURNING version,updated_at INTO next_version,changed_at;
 ELSE
   SELECT * INTO v FROM platform.visa_cases WHERE organization_id=c.organization_id AND student_case_id=c.id AND id=p_resource_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Visa unavailable for this case' USING ERRCODE='42501'; END IF;
   IF p_expected_version IS NULL OR v.version<>p_expected_version OR v.version=9223372036854775807 THEN RAISE EXCEPTION 'admissions_version_conflict' USING ERRCODE='PT409'; END IF;
   prior:=v.admissions_details;
   UPDATE platform.visa_cases SET admissions_details=p_details,version=version+1 WHERE id=v.id RETURNING version,updated_at INTO next_version,changed_at;
 END IF;
 receipt:=jsonb_build_object('caseId',c.id,'version',next_version::TEXT,'requestId',p_request_id,'changedAt',changed_at)||
   CASE WHEN p_kind='application' THEN jsonb_build_object('applicationId',p_resource_id) ELSE jsonb_build_object('visaCaseId',p_resource_id) END;
 RETURN platform_private.admissions_record(c.id,p_request_id,input,p_kind||'_updated','Обновлены факты '||p_kind,prior,p_details,receipt);
END $$;
CREATE FUNCTION platform.update_application_admissions_details_v1(p_student_case_id UUID,p_application_id UUID,p_expected_version BIGINT,p_details JSONB,p_request_id UUID)
 RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT platform_private.admissions_related_command(p_student_case_id,p_application_id,p_expected_version,p_details,p_request_id,'application')
$$;
CREATE FUNCTION platform.update_visa_admissions_details_v1(p_student_case_id UUID,p_visa_case_id UUID,p_expected_version BIGINT,p_details JSONB,p_request_id UUID)
 RETURNS JSONB LANGUAGE SQL VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT platform_private.admissions_related_command(p_student_case_id,p_visa_case_id,p_expected_version,p_details,p_request_id,'visa')
$$;

CREATE FUNCTION platform_private.admissions_playbook_json(p_id UUID) RETURNS JSONB LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',id,'direction',direction,'version',version,'title',title,'content',content,'publishedAt',published_at)
 FROM platform_private.admissions_playbook_versions WHERE id=p_id
$$;
CREATE FUNCTION platform.admissions_playbook_catalog_v1() RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD;
BEGIN
 SELECT * INTO a FROM platform.current_actor_authority();
 IF a.membership_id IS NULL OR a.platform_role NOT IN ('admin','curator') OR NOT private.platform_has_permission(a.organization_id,'case.read.full') THEN RAISE EXCEPTION 'Staff admissions authority required' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('playbooks',COALESCE((SELECT jsonb_agg(platform_private.admissions_playbook_json(v.id) ORDER BY v.direction,v.published_at DESC,v.id) FROM platform_private.admissions_playbook_versions v),'[]'::JSONB));
END $$;
CREATE FUNCTION platform.staff_case_admissions_workspace_v1(p_student_case_id UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; c platform.student_cases%ROWTYPE; gates JSONB:='[]'; stage TEXT; blocked TEXT[];
BEGIN
 SELECT * INTO a FROM platform_private.u7_require_case_workspace_actor(p_student_case_id);
 SELECT * INTO STRICT c FROM platform.student_cases WHERE organization_id=a.organization_id AND id=p_student_case_id;
 IF c.admissions_playbook_version_id IS NOT NULL THEN
  FOREACH stage IN ARRAY ARRAY['intake','profile_and_route','documents','applications','decisions','visa_and_predeparture','arrival_and_adaptation'] LOOP
   blocked:=platform_private.admissions_gate(c.id,stage); gates:=gates||jsonb_build_array(jsonb_build_object('stage',stage,'ready',cardinality(blocked)=0,'blockers',to_jsonb(blocked)));
  END LOOP;
 END IF;
 RETURN jsonb_build_object(
  'case',jsonb_build_object('id',c.id,'organizationId',c.organization_id,'direction',c.admissions_direction,'playbookVersionId',c.admissions_playbook_version_id,'version',c.admissions_version::TEXT,'stage',c.operational_stage,'outcome',c.admissions_outcome,'state',c.state,'primaryApplicationId',platform_private.admissions_primary_application(c.id),'routeApprovalStatus',c.route_approval_status,'nextAction',c.next_action,'nextActionDueOn',c.next_action_due_on,'facts',c.admissions_facts),
  'playbook',platform_private.admissions_playbook_json(c.admissions_playbook_version_id),
  'applications',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'institutionName',x.institution_name,'programName',x.program_name,'status',x.status,'version',x.version::TEXT,'details',x.admissions_details) ORDER BY x.created_at,x.id) FROM platform.university_applications x WHERE x.organization_id=c.organization_id AND x.student_case_id=c.id),'[]'::JSONB),
  'visa',(SELECT jsonb_build_object('id',x.id,'status',x.status,'version',x.version::TEXT,'details',x.admissions_details) FROM platform.visa_cases x WHERE x.organization_id=c.organization_id AND x.student_case_id=c.id),
  'handoff',NULL,'gates',gates,
  'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'stage',e.stage,'outcome',e.outcome,'reason',e.reason,'createdAt',e.created_at,'effectiveOn',e.effective_on) ORDER BY e.created_at DESC,e.id DESC) FROM (SELECT * FROM platform_private.admissions_events history WHERE history.organization_id=c.organization_id AND history.student_case_id=c.id ORDER BY history.created_at DESC,history.id DESC LIMIT 100) e),'[]'::JSONB));
END $$;

CREATE FUNCTION platform_private.admissions_attention_flags(p_case_id UUID) RETURNS TEXT[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c platform.student_cases%ROWTYPE; d JSONB; flags TEXT[]:=ARRAY[]::TEXT[]; ack TEXT; app_status TEXT; today DATE:=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bishkek')::DATE;
BEGIN
 SELECT * INTO STRICT c FROM platform.student_cases WHERE id=p_case_id;
 IF c.state<>'active' THEN RETURN flags; END IF;
 SELECT admissions_details,status::TEXT INTO d,app_status FROM platform.university_applications WHERE is_primary AND student_case_id=c.id;
 IF c.next_action_due_on<today OR (d ? 'partnerReplyDueOn' AND (d->>'partnerReplyDueOn')::DATE<today AND NOT d ? 'universitySubmittedOn')
   OR (d ? 'correctionDeadline' AND (d->>'correctionDeadline')::DATE<today AND NOT d ? 'correctionResolvedOn')
   OR EXISTS(SELECT 1 FROM platform.case_tasks t WHERE t.organization_id=c.organization_id AND t.student_case_id=c.id AND t.status NOT IN ('done','cancelled') AND (t.due_at<CURRENT_TIMESTAMP OR t.due_on<today))
 THEN flags:=array_append(flags,'overdue'); END IF;
 IF d ? 'partnerSentOn' AND NOT d ? 'universitySubmittedOn' THEN flags:=array_append(flags,'awaiting_partner'); END IF;
 IF c.operational_stage='applications' AND d ? 'universitySubmittedOn' AND app_status IN ('submitted','under_review','offer','enrolled') THEN flags:=array_append(flags,'submitted'); END IF;
 IF c.operational_stage='decisions' THEN flags:=array_append(flags,'decisions'); END IF;
 IF c.operational_stage='visa_and_predeparture' THEN flags:=array_append(flags,'visas'); END IF;
 IF c.operational_stage='arrival_and_adaptation' THEN flags:=array_append(flags,'arrivals'); END IF;
 SELECT r.decision INTO ack FROM platform.student_case_handoff_acknowledgements r JOIN platform.student_case_assignment_events x ON x.id=r.assignment_event_id
   WHERE r.organization_id=c.organization_id AND r.student_case_id=c.id AND x.new_scope_version=c.current_scope_version AND r.curator_membership_id=c.current_curator_membership_id ORDER BY r.revision DESC LIMIT 1;
 IF ack IS DISTINCT FROM 'accepted' AND EXISTS(SELECT 1 FROM platform.sales_admissions_handoffs WHERE organization_id=c.organization_id AND student_case_id=c.id) THEN flags:=array_append(flags,'awaiting_ack'); END IF;
 RETURN flags;
END $$;
CREATE FUNCTION platform.admissions_direction_summary_v1(p_direction TEXT DEFAULT NULL,p_curator_membership_id UUID DEFAULT NULL,p_period_from DATE DEFAULT NULL,p_period_to DATE DEFAULT NULL)
 RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a RECORD; result JSONB;
BEGIN
 SELECT * INTO a FROM platform.current_actor_authority();
 IF a.membership_id IS NULL OR a.platform_role NOT IN ('admin','curator') OR NOT private.platform_has_permission(a.organization_id,'case.read.full') THEN RAISE EXCEPTION 'Staff admissions authority required' USING ERRCODE='42501'; END IF;
 IF p_direction IS NOT NULL AND p_direction NOT IN ('CN','MY','EUROPE','AE','TR','unknown') OR (p_period_from IS NULL)<>(p_period_to IS NULL) OR p_period_to<p_period_from THEN RAISE EXCEPTION 'Invalid admissions summary filters' USING ERRCODE='22023'; END IF;
 WITH visible AS MATERIALIZED (
  SELECT c.*,COALESCE(c.admissions_direction,'unknown') AS direction_key,platform_private.admissions_attention_flags(c.id) AS flags
  FROM platform.student_cases c WHERE c.organization_id=a.organization_id AND private.platform_can_read_student_case(c.organization_id,c.id)
   AND (p_direction IS NULL OR COALESCE(c.admissions_direction,'unknown')=p_direction)
   AND (p_curator_membership_id IS NULL OR c.current_curator_membership_id=p_curator_membership_id)
 ), stock AS (
  SELECT direction_key,jsonb_build_object('direction',direction_key,'active',count(*) FILTER(WHERE state='active'),'overdue',count(*) FILTER(WHERE 'overdue'=ANY(flags)),
   'awaiting_ack',count(*) FILTER(WHERE 'awaiting_ack'=ANY(flags)),'awaiting_partner',count(*) FILTER(WHERE 'awaiting_partner'=ANY(flags)),
   'submitted',count(*) FILTER(WHERE 'submitted'=ANY(flags)),'decisions',count(*) FILTER(WHERE 'decisions'=ANY(flags)),
   'visas',count(*) FILTER(WHERE 'visas'=ANY(flags)),'arrivals',count(*) FILTER(WHERE 'arrivals'=ANY(flags)),
   'cancelled',count(*) FILTER(WHERE admissions_outcome='cancelled'),'arrived',count(*) FILTER(WHERE admissions_outcome='arrived')) AS row
  FROM visible GROUP BY direction_key
 ), arrival AS (
  -- Business result, not a count of historical clicks: reopening/cancellation
  -- removes a case; a reasoned date correction moves it to the confirmed month.
  -- Keep every prior event immutable, but verify the latest transition supports
  -- the currently recorded outcome and date before counting this case once.
  SELECT v.direction_key,count(*) AS total FROM visible v
   JOIN LATERAL (SELECT e.outcome,e.effective_on FROM platform_private.admissions_events e
    WHERE e.organization_id=v.organization_id AND e.student_case_id=v.id AND e.kind='transition'
    ORDER BY e.created_at DESC,e.id DESC LIMIT 1) confirmed ON TRUE
   WHERE v.state='closed' AND v.admissions_outcome='arrived' AND confirmed.outcome='arrived'
    AND confirmed.effective_on=(v.admissions_facts->>'arrivalOn')::DATE
    AND (p_period_from IS NULL OR confirmed.effective_on BETWEEN p_period_from AND p_period_to)
   GROUP BY v.direction_key
 ) SELECT jsonb_build_object('periodFrom',p_period_from,'periodTo',p_period_to,'stock',COALESCE((SELECT jsonb_agg(row ORDER BY direction_key) FROM stock),'[]'::JSONB),
   'periodArrivals',COALESCE((SELECT jsonb_agg(jsonb_build_object('direction',direction_key,'count',total) ORDER BY direction_key) FROM arrival),'[]'::JSONB)) INTO result;
 RETURN result;
END $$;

-- Amend, do not retain a second copy of, the currently authoritative directory.
-- Exact anchors fail closed if an upstream migration changes its contract.
DO $migration$
DECLARE body TEXT; original TEXT;
BEGIN
 SELECT pg_get_functiondef('platform.staff_student_case_page(integer,timestamptz,uuid,platform.student_case_state,text,uuid)'::regprocedure) INTO original;
 body:=replace(original,'p_student_case_id uuid DEFAULT NULL::uuid)','p_student_case_id uuid DEFAULT NULL::uuid, p_direction text DEFAULT NULL::text, p_curator_membership_id uuid DEFAULT NULL::uuid, p_attention text DEFAULT NULL::text)');
 body:=replace(body,'rejected_document_count bigint)','rejected_document_count bigint, admissions_direction text, next_action_due_on date, admissions_version bigint)');
 body:=replace(body,E'      student_case.applied_ozo_workflow_contract_version_id\n',E'      student_case.applied_ozo_workflow_contract_version_id,\n      student_case.admissions_direction,student_case.next_action_due_on,student_case.admissions_version\n');
 body:=replace(body,E'      NULL::UUID\n    FROM platform.current_actor_authority()',E'      NULL::UUID, NULL::TEXT, NULL::DATE, NULL::BIGINT\n    FROM platform.current_actor_authority()');
 body:=replace(body,E'    WHERE (p_state IS NULL OR visible.state = p_state)',E'    WHERE (p_state IS NULL OR visible.state = p_state)\n      AND (p_direction IS NULL OR (visible.access_mode = ''full'' AND COALESCE(visible.admissions_direction,''unknown'')=p_direction))\n      AND (p_curator_membership_id IS NULL OR (visible.access_mode = ''full'' AND EXISTS(SELECT 1 FROM platform.student_cases f WHERE f.organization_id=visible.organization_id AND f.id=visible.student_case_id AND f.current_curator_membership_id=p_curator_membership_id)))\n      AND (p_attention IS NULL OR (visible.access_mode = ''full'' AND p_attention=ANY(platform_private.admissions_attention_flags(visible.student_case_id))))');
 body:=replace(body,E'    ) END\n  FROM page',E'    ) END, page.admissions_direction,page.next_action_due_on,page.admissions_version\n  FROM page');
 body:=replace(body,E'BEGIN\n  IF p_limit',E'BEGIN\n  IF (p_direction IS NOT NULL AND p_direction NOT IN (''CN'',''MY'',''EUROPE'',''AE'',''TR'',''unknown'')) OR (p_attention IS NOT NULL AND p_attention NOT IN (''overdue'',''awaiting_partner'',''submitted'',''decisions'',''visas'',''arrivals'',''awaiting_ack'')) THEN RAISE EXCEPTION ''Invalid admissions filters'' USING ERRCODE=''22023''; END IF;\n  IF p_limit');
 IF body=original OR strpos(body,'page.admissions_version')=0 OR strpos(body,'p_direction text DEFAULT')=0 OR strpos(body,'visible.admissions_direction')=0 THEN RAISE EXCEPTION 'Admissions directory source anchor drift'; END IF;
 DROP FUNCTION platform.staff_student_case_page(INTEGER,TIMESTAMPTZ,UUID,platform.student_case_state,TEXT,UUID);
 EXECUTE body;

 -- The existing detail snapshot has a fixed legacy return signature. Its SQL
 -- body is validated lazily, so page.* would shift handoff columns at runtime
 -- after the directory gains fields. Keep its projection and authority intact.
 SELECT pg_get_functiondef('platform.staff_student_case_read_snapshot(uuid)'::regprocedure) INTO original;
 IF strpos(original,E'    page.*,')=0 THEN RAISE EXCEPTION 'Admissions snapshot source anchor drift'; END IF;
 body:=replace(original,E'    page.*,',E'    page.access_mode, page.sort_at, page.organization_id, page.student_case_id,\n    page.student_display_name, page.target_country, page.target_degree,\n    page.program_direction, page.intake, page.language_assumption,\n    page.funding_assumption, page.route_approval_status, page.operational_stage,\n    page.state, page.created_at, page.updated_at, page.handoff_at, page.next_action,\n    page.responsible_sales_display_name, page.current_curator_display_name,\n    page.applied_ozo_workflow_contract_version_id, page.overdue_task_count,\n    page.overdue_obligation_count, page.rejected_document_count,');
 EXECUTE body;
END $migration$;

-- Old status RPCs keep their single canonical implementation, with a shared
-- case-first lock before replay/object locking when a playbook is configured.
DO $migration$
DECLARE body TEXT; name TEXT; relation TEXT; arg TEXT; permission TEXT;
BEGIN
 FOREACH name IN ARRAY ARRAY['change_university_application','change_visa_case'] LOOP
  IF name='change_university_application' THEN relation:='university_applications'; arg:='p_application_id'; permission:='application.manage';
  ELSE relation:='visa_cases'; arg:='p_visa_case_id'; permission:='visa.manage'; END IF;
  SELECT pg_get_functiondef(p.oid) INTO STRICT body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='platform' AND p.proname=name;
  IF strpos(body,'  PERFORM platform_private.lock_p2d_request(p_request_id);')=0 THEN RAISE EXCEPTION 'Admissions legacy status anchor drift'; END IF;
  body:=replace(body,'  PERFORM platform_private.lock_p2d_request(p_request_id);',format(E'  PERFORM platform_private.lock_p2d_request(p_request_id);\n  IF EXISTS(SELECT 1 FROM platform.%I x JOIN platform.student_cases c ON c.id=x.student_case_id AND c.organization_id=x.organization_id WHERE x.id=%s AND x.organization_id=p_organization_id AND c.admissions_playbook_version_id IS NOT NULL) THEN\n    PERFORM platform_private.admissions_lock_case((SELECT student_case_id FROM platform.%I WHERE id=%s AND organization_id=p_organization_id),%L);\n  END IF;',relation,arg,relation,arg,permission));
  EXECUTE body;
 END LOOP;
END $migration$;

REVOKE ALL ON TABLE platform_private.admissions_playbook_versions,platform_private.admissions_events FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
DO $grants$
DECLARE f RECORD;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='platform_private' AND p.proname LIKE 'admissions_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin',f.signature);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='platform' AND p.proname IN ('admissions_playbook_catalog_v1','staff_case_admissions_workspace_v1','configure_case_admissions_v1','update_case_admissions_facts_v1','transition_case_admissions_v1','update_application_admissions_details_v1','update_visa_admissions_details_v1','admissions_direction_summary_v1','staff_student_case_page') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
 END LOOP;
END $grants$;
COMMIT;
