# EVO CRM — UX/UI Design Brief

English version handed to the outsourced designer. Lives in Google Docs;
this file is the source of record.

EVO is an agency that helps students get into universities abroad. We take a
person from their very first message in a messenger all the way to enrolment
and a visa. Inside the company this work is done by staff, and they have an
internal tool that behaves like a CRM. We are redesigning its interface.

This brief is about the product, not about styling. How the interface should
look has already been decided by the client and is shown to you separately.
What is written here is different: what this product is, who uses it, what path
a client travels, and what decision a member of staff makes on each screen.

What already exists: a working prototype. Not pictures, but a live application
running on the company's real data. Seven sections that you can open and click
through, via a link you will receive separately.

## How to read this brief

Understand how the work is done before you draw. This is not a courtesy: most
decisions in the prototype were not made by taste. They were made because any
other arrangement contradicts the way people actually work.

If something looks awkward to you, say so out loud. What you should not do is
quietly redesign the logic of the work inside a mock-up.

Read the sections in order. Section 2, the client journey, is the important
one. Until that path is clear, the screens read as a set of tables and cards
with no meaning.

## Section 1. Product and roles

### The company in brief

A client arrives with the question "I want to study abroad". First the sales
team works with them: it establishes the goal, the country and the budget, and
helps choose a university. Once the client has signed a contract and made the
first payment, they are handed over to the admissions team. From there
admissions collect the documents, submit the application to the university and
run the visa process.

### The three roles

Sales run the client up to the handover: the lead queue and the conversations
with them.
Admissions run the client after the handover: university applications,
documents, visa, tasks.
An administrator sees and can do everything, plus two actions nobody else has.

The split is hard. Sales do not step into the work of admissions, and
admissions do not see a client before the handover. This is not a fine-grained
permission setting, it is how the work is organised, and it decides what a
person sees on screen at all.

### What only an administrator can do

Hand a client over to admissions bypassing the rules, with no contract and no
payment, stating a written reason that stays on the record forever.

Lift a finance hold.

### The seven sections

Dashboard. Company figures and the pipeline by stage.
Sales pipeline. A board of stage columns holding client cards.
Inbox. Conversations with clients from the messenger.
Profile. Everything known about one person.
Knowledge base. Company files: folders, search, a file table.
Calendar. A week of the employee's work.
Settings. System status, role permissions, activity log.

You will receive a link to the clickable prototype. There is one link and it
updates in place; there will be no separate versions. Nothing to download or
install.

## Section 2. The client journey

Read this straight through, it is one story. Almost everything that will look
puzzling on the screens is explained here.

### Step 1. The client writes to us on a messenger

Everything starts with a message. There is no other way in: the client does not
fill in a form on the website, and no member of staff enters them by hand. A
message arrives, and a person and a lead at stage "new" appear in the system on
their own.

For the design this means the sales screen is not a list that somebody fills
in, it is a queue that fills itself. There is no "add lead" button there, and
there will not be one.

### Step 2. Sales qualify the lead

A salesperson opens the card and moves the lead through the stages:

new, qualifying, qualified, ready for handover

or sideways: disqualified.

The stage does not change by itself and not by dragging a card. The employee
opens a form and one save sets four things at once: the stage, the
qualification summary, the next step and its date.

This matters. "Stage" and "next step" are not two screens and not two actions.
They are one decision, and in the design they belong next to each other.

A lead has exactly one next step: a pair of "what to do" and "when". Not a task
list and not several reminders.

A disqualification requires a written reason. The reason does not stay on the
card, it goes into the history.

### Step 3. Contract and first payment

This is the gate. Until the salesperson has recorded two confirmations, "the
contract exists" and "the first payment has arrived", the client goes no
further.

Each confirmation is a separate record: a decision (confirmed or rejected), a
reference to the evidence, and a date. The payment additionally carries an
amount and a currency.

This is the only place in the whole product where money exists at all.

### Step 4. Handover to admissions

The handover button appears only when both confirmations are in place.

One press does five things at once:

it opens a student case;
it creates three starter tasks with wording already written;
it creates six visa milestones in the state "not started";
it moves the lead to "handed over" and clears the next step;
it transfers every conversation with this person from sales to admissions.

After that sales no longer work on this person: the form disappears and changes
are refused. The handover cannot be undone, there is no reverse action in the
product.

Exception: an administrator may hand over without a contract and payment, but
must state a reason.

### Step 5. Admissions run the case

From here the work runs along three lines at the same time.

**University applications.** Admissions create an application by hand:
university, programme, intake (for example "Fall 2026"), next step and due
date. There is no directory of universities, these are free text fields. An
application is born as "not submitted" and moves through:

not submitted, submitted, accepted / rejected by the university / withdrawn

One person may have several applications and they are equal to each other.
There is no "main university" in the data: an accepted application does nothing
to the others.

**Documents.** Admissions upload files into the case. About a file the system
knows only the name, the format, the size and a checksum. It does not know
whether this is a passport or a school certificate. A new version does not
replace the old one: version N+1 is added and the whole history stays.

**Visa.** Six milestones: document preparation, submission, appointment,
biometrics, interview, decision. Each moves through:

not started, in progress, done

or gets blocked with a mandatory reason; from blocked the only way out is back
to in progress.

The order is not enforced: any milestone can be started first. Drawing them as
numbered mandatory steps would be wrong.

### Step 6. Tasks

A task can only be created inside a case. The shared task screen only displays
them.

A task has a title, an optional description and an optional due date. There is
no assignee: the task belongs to the admissions role, not to a person.

It can be closed in two ways: "done" (a reason is not allowed) or "cancelled"
(a reason is required). A closed task cannot be reopened.

### Step 7. Money after the handover

After the handover there is no money in the product any more. There is one
switch, the finance hold: admissions or an administrator turns it on with a
mandatory reason.

There is exactly one hold per case: it is either on or lifted. No history of
holds is kept.

While the hold is on, exactly two things stop: submitting an application to a
university, and the "submission" visa milestone. Everything else, tasks,
documents, messages and the other five milestones, carries on as usual.

Only an administrator can lift the hold.

### What this means for the design

The handover is the only real decision on the whole path. Everything before it
leads up to it, everything after it follows from it. That place should read as
a threshold, not as one button among others.

A person lives one of two lives. They are either still a sales lead or already
an admissions case. The profile has to look different in these two states,
rather than showing half of its sections empty.

Conversations belong to a team, not to everyone. While the client is with
sales, admissions cannot see their conversations, and the other way round.

## Section 3. Screens

For each screen: what it is for, what decision is made on it, and what has to
be drawn in addition to what the prototype shows.

Every screen is expected in three widths: 1360 px (desktop), 768 px (tablet),
393 px (phone).

### Dashboard

Company figures and the pipeline by stage. The decision: where to look today.

To add: the normal state, the state where there is no data for the period, the
state where there is only one figure.

### Sales pipeline

Columns by stage holding client cards. The decision: who is stuck and who to
deal with now.

A card carries a name and a date, nothing else: the card exists so that a
person is recognised and opened, not so that everything is read off it.

The "ready for handover" column is marked, because that is the only moment
where the decision is made by a human and not by the system.

To add: an empty column, a column with fifty cards, a card with a very long
name, the open move-to-stage list.

### Inbox

Conversations on the left, the thread on the right. The decision: who to answer
first.

A conversation belongs to a team: while the client is with sales, admissions
cannot see the thread, and the other way round. At the moment of the handover
all of a person's conversations move to admissions at once.

The reply field is switched off in the prototype, with the reason written next
to it.

To add: the reply field switched on for the future, an empty list, a
conversation with no replies from us, a very long message.

### Profile

Everything about one person. The decision: what to do with them next.

The screen behaves differently depending on the stage. While the person is
still a sales client, the sections about the university application and the
visa do not exist at all. When they move to admissions those appear, and the
sales part folds into a single block, "how they came to us".

To add: both stages, every tab, the state with a finance hold, the document
list when nothing has been collected and when everything has.

### Knowledge base

Company files: folders, search, a file table. The decision: find the file you
need.

To add: an empty folder, a long list, a search with no results.

### Calendar

A week of the employee's work. The decision: what is on today.

To add: an empty week, a day with ten entries, an entry with a very long title.

### Settings

System status, role permissions, activity log. Six sections in a left rail, two
of them visible to an administrator only.

The screen is read-only: these settings are not changed from the browser, so
next to a switched-off feature there is an explanation rather than a toggle.

To add: the left rail on a phone, the activity log with filters, an empty log.

## Section 4. What the data does not have

Do not invent fields. A screen that shows something the system does not hold is
worse than an empty one: it cannot be used, and it promises a feature that does
not exist.

### About a person the system knows three things

Name, phone, email. Nothing else.

There is no age, country, language level, education, previous school, parents'
contacts or preferred faculty. A client questionnaire does not exist.

### A lead does not have

A deal value or a budget. A priority, a temperature or a probability of
closing. Several next actions, there is exactly one. Notes and comments. A
country, a programme or a university. Any detail of the source: the campaign,
the tracking tag, where exactly a referral came from.

### A university application does not have

A priority or a "main option". A submission deadline set by the university. A
country, a degree level or a field of study: only three free text fields,
university, programme and intake.

### A document does not have

A type. The system does not know whether this is a passport, a school
certificate or a reference letter. There is no checklist of required documents,
so a counter such as "five of fifteen collected" cannot be computed: the
denominator does not exist.

There is no review status, no expiry date, no link to an application or a visa
milestone, no comment and no preview.

### There is almost no money

No payment plan, no instalments, no outstanding balance, no tuition cost, no
scholarship. There is only the amount of the first payment and the finance hold
switch.

### Actions that do not exist

Undoing a handover to admissions. Reopening a closed task. Creating a lead by
hand.

### Connections cannot be set up from the interface

The company's phone number is connected on the server, by hand. A "connect
WhatsApp" button must not be drawn: it would not work, and that decision was
taken deliberately rather than forgotten.

There are also no access keys and no list of active sessions.

### How to mark such fields

In the prototype they are underlined with a dashed line. Do the same: it has to
be visible that the field is drawn ahead of time and does not work yet.

A dashed line specifically, not colour. Colour in this interface means the
state of a record, and it must not be spent on a temporary marker.
