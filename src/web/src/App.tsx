import { useQuery } from '@tanstack/react-query'
import { getSystemVersion } from './system-api'

const navigation = [
  'Dashboard',
  'Projects',
  'Baselines',
  'Software',
  'Machines',
  'Deployments',
  'Compare',
  'Imports',
]

const foundations = [
  { code: 'FND-01', label: 'Single IIS Host', state: 'READY' },
  { code: 'FND-02', label: 'PostgreSQL Migration', state: 'READY' },
  { code: 'FND-03', label: 'Background Worker', state: 'READY' },
  { code: 'FND-04', label: 'Core Domain Slices', state: 'NEXT' },
]

function App() {
  const system = useQuery({
    queryKey: ['system-version'],
    queryFn: getSystemVersion,
  })

  const connectivity = system.isSuccess ? 'ONLINE' : system.isError ? 'OFFLINE' : 'CHECKING'

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand-block">
          <span className="brand-mark">CH</span>
          <div>
            <strong>ConfigHub</strong>
            <small>CONFIGURATION CONTROL</small>
          </div>
        </div>

        <nav aria-label="主导航">
          {navigation.map((item, index) => (
            <button className={index === 0 ? 'nav-item active' : 'nav-item'} key={item} type="button">
              <span>{String(index + 1).padStart(2, '0')}</span>
              {item}
            </button>
          ))}
        </nav>

        <div className="rail-footer">
          <span className="signal-dot" />
          LAN / WINDOWS
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">ENGINEERING OPERATIONS / FOUNDATION</span>
            <h1>System Backbone</h1>
          </div>
          <div className={`connection-state ${connectivity.toLowerCase()}`}>
            <span>API</span>
            <strong>{connectivity}</strong>
          </div>
        </header>

        <div className="content-grid">
          <section className="hero-panel">
            <div className="hero-copy">
              <span className="section-index">STEP 01</span>
              <h2>Windows production skeleton</h2>
              <p>
                单一 IIS 入口承载 REST API 与 React UI。数据库迁移、持久化幂等记录和独立后台 Worker
                已建立实施边界，业务 Vertical Slice 将从 Project 开始逐段接入。
              </p>
            </div>
            <div className="topology" aria-label="生产拓扑">
              <div className="topology-node primary">IIS + ASP.NET CORE</div>
              <div className="topology-line" />
              <div className="topology-row">
                <div className="topology-node">REACT / WWWROOT</div>
                <div className="topology-node">REST / API V1</div>
              </div>
              <div className="topology-line" />
              <div className="topology-row">
                <div className="topology-node">POSTGRESQL</div>
                <div className="topology-node">WINDOWS WORKER</div>
              </div>
            </div>
          </section>

          <section className="status-panel">
            <div className="panel-heading">
              <div>
                <span className="section-index">FOUNDATION REGISTER</span>
                <h3>Runtime boundaries</h3>
              </div>
              <span className="count">04</span>
            </div>

            <div className="foundation-list">
              {foundations.map((foundation) => (
                <div className="foundation-row" key={foundation.code}>
                  <code>{foundation.code}</code>
                  <span>{foundation.label}</span>
                  <b className={foundation.state === 'READY' ? 'ready' : 'next'}>{foundation.state}</b>
                </div>
              ))}
            </div>
          </section>

          <section className="telemetry-panel">
            <div className="panel-heading">
              <div>
                <span className="section-index">LIVE HANDSHAKE</span>
                <h3>Application identity</h3>
              </div>
              <button type="button" onClick={() => system.refetch()} disabled={system.isFetching}>
                {system.isFetching ? 'CHECKING' : 'REFRESH'}
              </button>
            </div>

            <dl className="telemetry-grid">
              <div>
                <dt>Product</dt>
                <dd>{system.data?.product ?? '—'}</dd>
              </div>
              <div>
                <dt>Build</dt>
                <dd>{system.data?.version ?? '—'}</dd>
              </div>
              <div>
                <dt>API contract</dt>
                <dd>{system.data?.apiVersion ?? '—'}</dd>
              </div>
              <div>
                <dt>Topology</dt>
                <dd>{system.data?.architecture ?? '—'}</dd>
              </div>
            </dl>

            {system.isError && (
              <p className="error-strip">
                Host 尚未连接。前端骨架仍可独立预览；配置 ConnectionStrings__ConfigHub 后启动 API。
              </p>
            )}
          </section>

          <section className="decision-panel">
            <span className="section-index">DECISION LOCK / 2026-08-29</span>
            <blockquote>
              “历史事实不可覆盖。标准、目标与实际独立。匹配状态与风险状态独立。”
            </blockquote>
            <div className="decision-meta">
              <span>15 ADR ACCEPTED</span>
              <span>CORE V1 SCHEMA FROZEN</span>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
