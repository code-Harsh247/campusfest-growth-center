/**
 * The metric catalog: one definition per metric, worded as the dashboard and
 * the copilot both show it (Data Foundation PRD, metric dictionary).
 */

export interface MetricDef {
  id: string;
  name: string;
  definition: string;
  unit: "people" | "events" | "INR" | "ratio" | "INR per person" | "people per INR 1,000" | "person-days";
  caveat?: string;
}

export const METRICS: MetricDef[] = [
  { id: "identified", name: "Identified people", unit: "people",
    definition: "Distinct external people first seen by the selected date, walk-ins included." },
  { id: "registered", name: "Registered people", unit: "people",
    definition: "Distinct external people with a registration, whatever its later status." },
  { id: "confirmed", name: "Confirmed registrations", unit: "people",
    definition: "Registrations whose latest status at the selected date is confirmed." },
  { id: "attendees", name: "Verified attendees", unit: "people",
    definition: "Distinct external people with at least one admitted and verified check-in, on either day.",
    caveat: "Admission rows are not people: 3,290 admitted rows belong to 2,090 people, 2,050 of them external." },
  { id: "walk_in_attendees", name: "Walk-in attendees", unit: "people",
    definition: "Verified attendees with no registration. They are not credited to any campaign." },
  { id: "visitor_days", name: "Visitor-days", unit: "person-days",
    definition: "Distinct person-and-day pairs with a verified admission." },
  { id: "registration_rate", name: "Registration rate", unit: "ratio",
    definition: "Registered people divided by identified people credited to the same campaign." },
  { id: "confirmation_rate", name: "Confirmation rate", unit: "ratio",
    definition: "Confirmed registrations divided by registered people." },
  { id: "show_rate", name: "Show rate", unit: "ratio",
    definition: "Attending registrants divided by confirmed registrations.",
    caveat: "Not the same as attendance yield, which divides by all registrants." },
  { id: "attendance_yield", name: "Attendance yield", unit: "ratio",
    definition: "Attending registrants divided by all registered people." },
  { id: "ctr", name: "Click-through rate", unit: "ratio",
    definition: "Clicks divided by impressions. Both are anonymous platform events, not people." },
  { id: "form_start_rate", name: "Form-start rate", unit: "ratio",
    definition: "Registration form starts divided by landing-page sessions. Both are anonymous events." },
  { id: "spend", name: "Spend", unit: "INR",
    definition: "Net posted marketing spend, vendor credits included, by activity date.",
    caveat: "Spend posts in lumps every 5 to 12 days, so periods shorter than 14 days are misleading." },
  { id: "cost_per_registration", name: "Cost per registration", unit: "INR per person",
    definition: "Spend divided by registered people." },
  { id: "cost_per_confirmed", name: "Cost per confirmed registration", unit: "INR per person",
    definition: "Spend divided by confirmed registrations." },
  { id: "cost_per_attendee", name: "Cost per attendee", unit: "INR per person",
    definition: "Campaign spend divided by verified attendees credited to the campaign.",
    caveat: "An average, not the cost of the next attendee." },
  { id: "attendees_per_1000", name: "Attendees per INR 1,000", unit: "people per INR 1,000",
    definition: "Verified attendees (or, before the event, confirmed registrations times the show-rate assumption) per INR 1,000 of spend." },
  { id: "target_attainment", name: "Target attainment", unit: "ratio",
    definition: "Actual divided by the target in force on the selected date." },
  { id: "pace", name: "Pace", unit: "ratio",
    definition: "Actual against a straight line from the pacing start to the deadline.",
    caveat: "The straight line is an assumption; in 2025, 56% of registrations had arrived by 15 Mar against 67% on a straight line." },
];

/** Questions the data cannot answer, and what would answer them. */
export const UNANSWERABLE: { topic: string; why: string; needed: string }[] = [
  { topic: "Venue capacity or peak crowd", why: "There are entry scans but no exit scans and no venue limit.", needed: "The venue's capacity and exit counts." },
  { topic: "Who attendees are (college, year, age, gender, home city)", why: "No such fields exist.", needed: "Fields collected at registration." },
  { topic: "Why people cancelled or did not attend", why: "Statuses carry no reasons.", needed: "A reason field or a survey." },
  { topic: "Unique reach across days", why: "Platform reach is reported per day with no identity overlap.", needed: "De-duplicated reach from the platforms." },
  { topic: "Incremental lift of a campaign", why: "There are no holdout groups.", needed: "A holdout test." },
  { topic: "Ticket revenue, prices or non-marketing costs", why: "Only marketing spend is recorded.", needed: "Finance records." },
  { topic: "Sponsor outcomes", why: "Sponsor data is a separate dataset not loaded here.", needed: "The sponsor dataset." },
  { topic: "Anything after 20 Apr 2025", why: "The data ends on 20 Apr 2025.", needed: "Newer data." },
];
