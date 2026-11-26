"""Independent cross-check of the SQL metric layer.

Recomputes the core metrics straight from the source workbook with pandas,
sharing no code with the app, and writes them to a JSON file. The test
tests/crosscheck.test.ts compares the app's numbers against this file, so a
logic error in either implementation shows up as a disagreement.

Usage: python -I check/crosscheck.py data/attendee-dataset.xlsx check/expected.json
"""
import json
import sys

import pandas as pd

DATES = ["2025-02-01", "2025-02-15", "2025-03-01", "2025-03-15", "2025-04-01", "2025-04-10", "2025-04-12", "2025-04-13", "2025-04-20"]


def load(path):
    keys = {
        "Targets": "effective_at", "Campaigns": "campaign_id", "Daily Marketing": "activity_id",
        "People": "person_id", "Registrations": "registration_id",
        "Registration History": "history_id", "Check-ins": "event_id",
    }
    return {name: pd.read_excel(path, sheet_name=name).drop_duplicates(subset=key) for name, key in keys.items()}


def at(data, day):
    cutoff = pd.Timestamp(day) + pd.Timedelta(days=1)  # end of the selected day, India time
    P, R, H, C, M, T = (data[k] for k in ["People", "Registrations", "Registration History", "Check-ins", "Daily Marketing", "Targets"])

    external = P[P.person_type == "external"]
    ext_ids = set(external.person_id)
    identified = external[external.first_seen_at < cutoff]

    regs = R[(R.registered_at < cutoff) & R.person_id.isin(ext_ids)]
    hist = H[H.effective_at < cutoff].sort_values(["registration_id", "effective_at", "history_id"])
    latest = hist.groupby("registration_id").tail(1).set_index("registration_id").status
    regs = regs.assign(status=regs.registration_id.map(latest).fillna("interested"))

    adm = C[(C.result == "admitted") & (C.verification == "verified") & (C.occurred_at < cutoff) & C.person_id.isin(ext_ids)]
    attendees = set(adm.person_id)
    visitor_days = adm.assign(day=adm.occurred_at.dt.date)[["person_id", "day"]].drop_duplicates().shape[0]

    reg_campaign = regs.sort_values("registered_at").drop_duplicates("person_id").set_index("person_id").campaign_id
    credit = external.set_index("person_id").first_campaign_id.copy()
    credit.loc[reg_campaign.index] = reg_campaign
    registered_people = set(regs.person_id)

    spend_rows = M[M.activity_date <= pd.Timestamp(day)]
    totals = {
        "identified": len(identified),
        "registered": regs.person_id.nunique(),
        "confirmed": int((regs.status == "confirmed").sum()),
        "cancelled": int((regs.status == "cancelled").sum()),
        "waitlisted": int((regs.status == "waitlisted").sum()),
        "attendees": len(attendees),
        "walk_in_attendees": len(attendees - registered_people),
        "visitor_days": int(visitor_days),
        "spend": int(spend_rows.marketing_spend_inr.sum()),
        "clicks": int(spend_rows.clicks.sum()),
        "impressions": int(spend_rows.impressions.sum()),
    }

    campaigns = {}
    for cid in sorted(set(credit.dropna()) | set(spend_rows.campaign_id)):
        people = set(credit[credit == cid].index)
        cr = regs[regs.campaign_id == cid]
        campaigns[cid] = {
            "spend": int(spend_rows[spend_rows.campaign_id == cid].marketing_spend_inr.sum()),
            "identified": int(identified.person_id.isin(people).sum()),
            "registered": cr.person_id.nunique(),
            "confirmed": int((cr.status == "confirmed").sum()),
            "attendees": len(attendees & people),
        }
    unattributed = set(credit[credit.isna()].index)
    campaigns["Unattributed"] = {
        "identified": int(identified.person_id.isin(unattributed).sum()),
        "attendees": len(attendees & unattributed),
    }

    in_force = T[T.effective_at < cutoff].sort_values("effective_at").tail(1)
    targets = None
    if len(in_force):
        t = in_force.iloc[0]
        targets = {
            "version": t.target_version,
            "people": int(t.identified_external_people_goal),
            "registrations": int(t.registration_goal),
            "attendees": int(t.unique_external_visitors_goal),
            "budget": int(t.marketing_budget_inr),
        }
    return {"totals": totals, "campaigns": campaigns, "targets": targets}


def main(src, out):
    data = load(src)
    result = {day: at(data, day) for day in DATES}
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"source": "check/crosscheck.py (pandas)", "dates": result}, f, indent=1, default=int)
    print(f"wrote {out}: {len(DATES)} dates")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
