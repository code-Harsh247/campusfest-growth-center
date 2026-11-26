# Strategy model output

Generated on 27 Nov 2026 by `npm run strategy` from the supplied dataset. Rerun it and compare: every slide number comes from these lines.

```text
2025 (D): 2,050 verified attendees (125 walk-ins), spend ₹2,74,000, day one 1,430 (69.8%)

Channel | 2025 spend | attendees | show | ₹/attendee | per ₹1,000
Student Referrals | 19,000 | 275 | 85.9% | 69 | 14.5
Organic Search | 14,000 | 195 | 86.7% | 72 | 13.9
College Partnerships | 31,000 | 385 | 91.7% | 81 | 12.4
Community Groups | 16,000 | 165 | 89.2% | 97 | 10.3
Campus Ambassadors | 42,000 | 390 | 81.3% | 108 | 9.3
Paid Social | 93,000 | 340 | 58.6% | 274 | 3.7
Creator Partners | 59,000 | 175 | 60.3% | 337 | 3.0
Campaign confirmed 2,500, registered attendees 1,925, show 77.0%, no-shows 575; all-campaign ₹/attendee 142

BASE: 2,471 attendees (mix +349, show-rate bets +72), peak day 1,723 of 3,000; plan total ₹3,00,000
  funnel: reach 36,062 → identified 3,606 → registered 3,014 → confirmed 2,739 → attendees 2,471
  Student Referrals: ₹40,000 → 479 (2025 275; mix 463 + show 16)
  Organic Search: ₹20,000 → 259 (2025 195; mix 250 + show 9)
  College Partnerships: ₹70,000 → 681 (2025 385; mix 681 + show 0)
  Community Groups: ₹25,000 → 233 (2025 165; mix 226 + show 8)
  Campus Ambassadors: ₹45,000 → 424 (2025 390; mix 409 + show 15)
  Paid Social: ₹25,000 → 142 (2025 340; mix 136 + show 7)
  Creator Partners: ₹30,000 → 126 (2025 175; mix 109 + show 17)

STRETCH: 2,835 attendees (mix +622, show-rate bets +163), peak day 1,978 of 3,000; plan total ₹3,00,000
  funnel: reach 39,278 → identified 3,928 → registered 3,299 → confirmed 3,002 → attendees 2,835
  Student Referrals: ₹40,000 → 581 (2025 275; mix 537 + show 44)
  Organic Search: ₹20,000 → 271 (2025 195; mix 250 + show 20)
  College Partnerships: ₹95,000 → 880 (2025 385; mix 880 + show 0)
  Community Groups: ₹25,000 → 243 (2025 165; mix 226 + show 18)
  Campus Ambassadors: ₹45,000 → 445 (2025 390; mix 409 + show 35)
  Paid Social: ₹25,000 → 152 (2025 340; mix 136 + show 16)
  Creator Partners: ₹30,000 → 139 (2025 175; mix 109 + show 30)

Sensitivity (base case, verified attendees):
{"base":2471,"bend05":2319,"bend09":2666,"clubsAt75pct":2397,"clubsZero":2175,"noShowZero":2416,"worstTogether":2218,"extraBudget":26000,"costPerExtra":62,"avgCost2025":134,"avgCostBase":121,"avgCostStretch":106}
```

## 2025 evidence queries

```text

## Late-window cost per attendee (spend and sign-ups from 15 Mar), by campaign
{"campaign_name":"Student Referrals","late_spend":5350,"late_attendees":200,"late_cost_per_attendee":26}
{"campaign_name":"College Partnerships","late_spend":13675,"late_attendees":275,"late_cost_per_attendee":49}
{"campaign_name":"Organic Search","late_spend":4200,"late_attendees":63,"late_cost_per_attendee":66}
{"campaign_name":"Campus Ambassadors","late_spend":11900,"late_attendees":152,"late_cost_per_attendee":78}
{"campaign_name":"Community Groups","late_spend":7200,"late_attendees":91,"late_cost_per_attendee":79}
{"campaign_name":"Creator Partners","late_spend":16300,"late_attendees":87,"late_cost_per_attendee":187}
{"campaign_name":"Paid Social","late_spend":25800,"late_attendees":74,"late_cost_per_attendee":348}

## Share of 2025 spend vs share of campaign attendees
{"campaign_name":"Paid Social","spend_pct":33.9,"attendee_pct":17.7}
{"campaign_name":"Creator Partners","spend_pct":21.5,"attendee_pct":9.1}
{"campaign_name":"Campus Ambassadors","spend_pct":15.3,"attendee_pct":20.3}
{"campaign_name":"College Partnerships","spend_pct":11.3,"attendee_pct":20}
{"campaign_name":"Student Referrals","spend_pct":6.9,"attendee_pct":14.3}
{"campaign_name":"Community Groups","spend_pct":5.8,"attendee_pct":8.6}
{"campaign_name":"Organic Search","spend_pct":5.1,"attendee_pct":10.1}

## Statuses at the end (registrations)
{"status":"confirmed","count":2500}
{"status":"cancelled","count":183}
{"status":"waitlisted","count":88}
{"status":"interested","count":29}

## Did cancelled or waitlisted people attend?
{"status":"cancelled","attended":0}
{"status":"waitlisted","attended":0}

## Email engagement vs attendance among confirmed registrants
{"opened_or_clicked":false,"confirmed":2084,"attended":1604,"show_pct":77}
{"opened_or_clicked":true,"confirmed":416,"attended":321,"show_pct":77.2}

## Interaction event types
{"event_type":"page_visit","count":3500}
{"event_type":"registration_start","count":3075}
{"event_type":"brochure_download","count":1818}
{"event_type":"nurture_email_sent","count":1400}
{"event_type":"nurture_email_opened","count":992}
{"event_type":"nurture_email_clicked","count":409}
{"event_type":"opted_out","count":229}
{"event_type":"event_question_submitted","count":227}

## Registrations by 15 Mar vs straight line
{"by_15mar":1562,"total":2800,"pct_by_15mar":55.8}

## Days: day one, day two, both
{"d1":1430,"d2":1345,"both_days":725}

## Busiest hour of entries, day one
{"h":"2025-04-12 18:00:00","n":400}

## Paid Social click-through before and after 15 Mar
{"late":false,"ctr":2.53}
{"late":true,"ctr":1.28}

## Registration rate by campaign (identified → registered)
{"campaign_name":"Paid Social","identified":960,"registered":680,"never_registered":280,"pct":70.8}
{"campaign_name":"Creator Partners","identified":490,"registered":350,"never_registered":140,"pct":71.4}
{"campaign_name":"Community Groups","identified":250,"registered":200,"never_registered":50,"pct":80}
{"campaign_name":"Student Referrals","identified":410,"registered":350,"never_registered":60,"pct":85.4}
{"campaign_name":"Organic Search","identified":290,"registered":250,"never_registered":40,"pct":86.2}
{"campaign_name":"Campus Ambassadors","identified":600,"registered":520,"never_registered":80,"pct":86.7}
{"campaign_name":"College Partnerships","identified":500,"registered":450,"never_registered":50,"pct":90}

## Cost per confirmed, Paid Social
{"campaign_name":"Paid Social","round":160}
{"campaign_name":"Creator Partners","round":203}
```
