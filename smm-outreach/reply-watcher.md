# SMM Reply Watcher

## Purpose

The Reply Watcher converts actual Gmail activity into durable, structured acquisition evidence.

It watches for responses, delivery failures, suppression events, and other outcome signals, classifies them using the canonical metrics schema, updates prospect state, stops inappropriate sequencing, and records evidence for the Outreach Optimizer.

The Reply Watcher does not change outreach strategy.

---

## Governing Files

Before processing SMM outreach responses, read:

* `smm-outreach/runtime.md`
* `smm-outreach/strategy.json`
* `smm-outreach/metrics-schema.json`
* `smm-outreach/outcome-ledger.json`

Use `metrics-schema.json` as the canonical classification system.

Do not invent new outcome categories when an existing canonical outcome applies.

---

## Gmail Evidence

Review relevant Gmail activity for SMM outreach, including:

* human replies
* meeting requests
* substantive questions
* objections
* referrals
* not-now responses
* negative replies
* opt-outs
* complaints
* hard bounces
* soft bounces
* out-of-office responses
* other automated responses

Where possible, connect each result to the relevant:

* prospect
* email address
* outbound touch
* touch number
* strategy version
* send timestamp

---

## Classification

Classify outcomes using `metrics-schema.json`.

Canonical outcome values include:

* `interested`
* `meeting_request`
* `question_objection`
* `referral`
* `not_now`
* `other_human_reply`
* `negative_reply`
* `bounce`
* `opt_out`
* `complaint`
* `ooo`
* `auto_reply`

Do not classify a response based only on subject line or snippet when the message body is available.

When classification is uncertain, record the uncertainty.

Use:

* `low`
* `medium`
* `high`

for classification confidence.

---

## Prospect Record

Each prospect entry in `outcome-ledger.json` should preserve, when available:

```json
{
  "prospect_id": null,
  "business_name": null,
  "email_address": null,
  "status": null,
  "suppressed": false,
  "suppression_reason": null,
  "last_outbound_at": null,
  "last_reply_at": null,
  "highest_value_outcome": null,
  "latest_outcome": null,
  "classification_confidence": null,
  "attribution_confidence": null,
  "sequence_stopped": false,
  "touches": []
}
```

---

## Touch Record

Each verified outbound touch may preserve:

```json
{
  "touch_number": null,
  "sent_at": null,
  "strategy_version": null,
  "subject_pattern": null,
  "opening_pattern": null,
  "cta_pattern": null,
  "personalization_depth": null,
  "delivery_status": null,
  "reply_at": null,
  "outcome": null,
  "classification_confidence": null,
  "attribution_confidence": null
}
```

Do not count a Gmail draft as a touch.

Do not count a scheduled message as sent until Gmail verifies that it was sent.

---

## Sequence Stop Rules

Routine sequencing must stop when appropriate after:

* interested reply
* meeting request
* substantive question or objection requiring handling
* referral requiring human handling
* explicit opt-out
* complaint
* unresolved hard bounce
* other state where continued automated follow-up would be inappropriate

A queued follow-up does not override a new reply.

Always perform a fresh reply and suppression check before any automated follow-up send.

---

## Opt-Out Handling

An explicit opt-out must:

1. be classified as `opt_out`
2. immediately mark the contact suppressed
3. stop the active sequence
4. prevent future routine outreach
5. preserve the suppression reason
6. be reflected in all connected systems available to the workflow

Do not reinterpret an opt-out as a generic negative reply.

---

## Complaint Handling

A complaint must:

1. be classified as `complaint`
2. immediately suppress the contact
3. stop sequencing
4. be retained as an optimizer guardrail event
5. be surfaced for Mike's attention when material

---

## Bounce Handling

Confirmed hard bounce:

* classify as `bounce`
* mark the specific email address invalid
* stop sends to that address
* require verified corrected contact information before reuse

Soft bounce:

* preserve as a delivery failure
* do not automatically suppress the entire business
* do not classify as `no_reply`

---

## OOO Handling

Out-of-office responses:

* classify as `ooo`
* do not count as human engagement
* do not count as a positive reply
* do not count as a negative reply
* preserve any useful return-date information when reliable

Do not fabricate a follow-up date when none is provided.

---

## Outcome Precedence

For the same reply event, use the strongest applicable canonical classification.

Examples:

* meeting scheduling beats generic interest
* opt-out beats negative reply
* complaint beats all other classifications

Preserve historical events even when the prospect later progresses to a stronger outcome.

---

## Attribution

When possible, associate the response with the most recent relevant outbound touch.

Do not claim that the latest touch caused the response merely because it came before it.

Record attribution confidence.

Preserve full sequence context.

---

## Ledger Updates

After processing relevant Gmail activity:

1. update the applicable prospect record
2. update the applicable touch record
3. update suppression state when required
4. update sequence state
5. update `last_updated`
6. preserve prior historical events
7. avoid duplicate event insertion

Never delete an unfavorable outcome merely because a later outcome is positive.

---

## Daily Rollups

Where sufficient verified data exists, maintain daily rollups using the outbound send date.

A daily rollup may include:

```json
{
  "confirmed_sends": 0,
  "confirmed_delivered": 0,
  "interested": 0,
  "meeting_requests": 0,
  "questions_objections": 0,
  "referrals": 0,
  "not_now": 0,
  "other_human_replies": 0,
  "negative_replies": 0,
  "opt_outs": 0,
  "complaints": 0,
  "bounces": 0,
  "ooo": 0,
  "auto_replies": 0
}
```

Do not add `no_reply` until the applicable measurement window in `metrics-schema.json` has matured.

---

## Reconciliation

Prefer authoritative evidence in this order:

1. Gmail verified message state
2. connected acquisition-system records
3. durable outcome ledger
4. model inference

When systems disagree:

* do not silently choose the more favorable result
* reconcile when evidence permits
* otherwise record the discrepancy under `data_quality.unresolved_records`

---

## Optimizer Relationship

The Reply Watcher gathers and classifies evidence.

The Outreach Optimizer interprets that evidence.

The Reply Watcher must not:

* modify `strategy.json`
* start experiments
* declare strategy winners
* alter optimizer thresholds

Its job is to make sure the optimizer receives clean, durable evidence.

---

## Core Rule

Observe what actually happened.

Classify it consistently.

Stop outreach when the prospect's response requires it.

Preserve the evidence.

Never turn uncertainty into invented certainty.
