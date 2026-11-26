/** Placeholder shapes at their final size, so nothing jumps when numbers arrive. */

const Bar = ({ w = "100%", h = 12, r = 6 }: { w?: string; h?: number; r?: number }) => (
  <div className="skel" style={{ width: w, height: h, borderRadius: r }} />
);

function Head({ title }: { title: string }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        <div style={{ marginTop: 10 }}><Bar w="320px" h={14} /></div>
      </div>
    </header>
  );
}

export function OverviewSkeleton() {
  return (
    <div className="stack" style={{ gap: 24 }} aria-busy="true" aria-label="Loading numbers">
      <Head title="Are we on track?" />
      <section className="stack">
        <h2 className="eyebrow">Targets</h2>
        <div className="grid-auto-250" aria-hidden="true">
          {[1, 2, 3, 4].map((k) => (
            <div key={k} className="card" style={{ height: 196 }}>
              <Bar w="45%" /><Bar w="70%" h={32} /><Bar h={6} r={3} /><Bar w="85%" />
            </div>
          ))}
        </div>
      </section>
      <div className="grid-auto-460" aria-hidden="true">
        <div className="card">
          <Bar w="40%" h={16} />
          {["100%", "80%", "71%", "55%"].map((w) => <Bar key={w} w={w} h={28} />)}
        </div>
        <div className="card dashed">
          <Bar w="40%" h={16} />
          <div className="tiles">{[1, 2, 3, 4].map((k) => <div key={k} className="skel" style={{ height: 72, borderRadius: 8 }} />)}</div>
        </div>
      </div>
      <div className="grid-auto-460" aria-hidden="true">
        <div className="card">
          <Bar w="40%" h={16} />
          {[1, 2, 3].map((k) => <div key={k} className="skel" style={{ height: 56, borderRadius: 8 }} />)}
        </div>
        <div className="card">
          <Bar w="50%" h={20} />
          <div className="skel" style={{ height: 96, borderRadius: 8 }} />
          <div className="skel" style={{ height: 60, borderRadius: 8 }} />
        </div>
      </div>
    </div>
  );
}

export function CampaignsSkeleton() {
  return (
    <div className="stack" style={{ gap: 20 }} aria-busy="true" aria-label="Loading numbers">
      <Head title="Which campaigns work?" />
      <div className="chips" aria-hidden="true">{[1, 2, 3].map((k) => <Bar key={k} w="72px" h={28} r={999} />)}</div>
      <div className="table-card" aria-hidden="true" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {Array.from({ length: 9 }, (_, i) => <Bar key={i} h={i === 0 ? 14 : 22} />)}
      </div>
    </div>
  );
}

export function TasksSkeleton() {
  return (
    <div className="stack" style={{ gap: 24 }} aria-busy="true" aria-label="Loading tasks">
      <Head title="What are we doing about it?" />
      <div className="tasks-layout" aria-hidden="true">
        <div className="card new-task" style={{ height: 420 }}><Bar w="30%" h={16} /><Bar h={44} r={8} /><Bar h={44} r={8} /><Bar h={84} r={8} /></div>
        <div className="task-list">
          <Bar w="20%" h={16} />
          {[1, 2].map((k) => <div key={k} className="skel" style={{ height: 120, borderRadius: 12 }} />)}
        </div>
      </div>
    </div>
  );
}

export function PlanSkeleton() {
  return (
    <div className="stack" style={{ gap: 24 }} aria-busy="true" aria-label="Loading numbers">
      <Head title="Where should the money go?" />
      <div className="card" aria-hidden="true">
        <Bar w="20%" h={16} />
        {[1, 2, 3, 4, 5, 6, 7].map((k) => <Bar key={k} h={40} r={8} />)}
      </div>
      <div className="card" aria-hidden="true">
        <Bar w="30%" h={16} />
        <div className="sim-grid">
          <div className="stack">{[1, 2, 3, 4, 5, 6, 7].map((k) => <Bar key={k} h={32} r={8} />)}</div>
          <div className="stack"><Bar h={104} r={10} /><Bar h={104} r={10} /></div>
        </div>
      </div>
    </div>
  );
}
