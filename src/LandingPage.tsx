import "./landing.css";

const playground = `${import.meta.env.BASE_URL}playground/`;
const repository = "https://github.com/nakano16180/vite-react-three";

export default function Landing() {
  return (
    <>
      <header className="site-header">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <span className="brand-mark">◈</span> DuckDB Spatial Lab
        </a>
        <nav aria-label="メインナビゲーション">
          <a href="#explore">できること</a>
          <a href={repository}>GitHub ↗</a>
          <a className="nav-launch" href={playground}>
            Playground ↗
          </a>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <span /> A BROWSER-BASED SPATIAL LAB
            </p>
            <h1>
              空間SQLを、
              <br />
              <em>目で見て試す。</em>
            </h1>
            <p className="intro">
              図形を描く。SQLで問いかける。結果をキャンバスで確かめる。
              <br />
              DuckDB Spatialを、ブラウザーひとつで実験できる場所。
            </p>
            <div className="hero-actions">
              <a className="button" href={playground}>
                Playgroundを開く <span>↗</span>
              </a>
              <a className="text-link" href="#explore">
                何ができる？ ↓
              </a>
            </div>
            <p className="hero-note">インストール不要 · PCブラウザー向け · オープンソース</p>
          </div>
          <div className="sql-card">
            <div className="card-bar">
              <span>EXPERIMENT / 001</span>
              <span className="live-dot">SQL → GEOMETRY</span>
            </div>
            <svg viewBox="0 0 420 225" role="img" aria-label="SQLから生成する線の模式図">
              <defs>
                <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="1" fill="#c5cfc5" />
                </pattern>
              </defs>
              <rect width="420" height="225" fill="url(#grid)" />
              <path d="M80 165 L310 65" stroke="#23785a" strokeWidth="3" />
              <circle cx="80" cy="165" r="6" fill="#e9c655" stroke="#183d31" strokeWidth="2" />
              <circle cx="310" cy="65" r="6" fill="#e9c655" stroke="#183d31" strokeWidth="2" />
              <text x="92" y="190">
                100, 100
              </text>
              <text x="320" y="55">
                300, 200
              </text>
            </svg>
            <pre>
              <code>{`SELECT ST_AsGeoJSON(\n  ST_GeomFromText(\n    'LINESTRING (100 100, 300 200)'\n  )\n) AS geometry_geojson;`}</code>
            </pre>
            <div className="card-caption">
              ひとつのクエリから、ひとつの形へ。<span>↗</span>
            </div>
          </div>
        </section>
        <div className="technology">
          <span>POWERED BY</span>
          <strong>DuckDB WASM</strong>
          <span>＋</span>
          <strong>Spatial</strong>
          <span>＋</span>
          <strong>React Three Fiber</strong>
          <span className="technology-note">計算も描画も、ブラウザーで。</span>
        </div>
        <section className="explore" id="explore">
          <div className="section-heading">
            <div>
              <p className="eyebrow">DRAW. QUERY. EXPLORE.</p>
              <h2>考えたことを、すぐに試す。</h2>
            </div>
            <p>描画・SQL・属性を、ひとつのワークスペースに。</p>
          </div>
          <div className="features">
            <article>
              <span className="feature-number">01 / DRAW</span>
              <h3>まずは、形をつくる。</h3>
              <p>線やポリゴンをクリックで描画。頂点の編集、長さ・面積の計測、GeoJSONの読み込みまで。</p>
            </article>
            <article>
              <span className="feature-number">02 / QUERY</span>
              <h3>SQLで、確かめる。</h3>
              <p>サンプルから空間SQLを実行。結果をテーブルと図形で確認し、気に入った結果はレイヤーとして保存。</p>
            </article>
            <article>
              <span className="feature-number">03 / EXPLORE</span>
              <h3>結果を、深く見る。</h3>
              <p>レイヤーの表示を切り替え、属性を絞り込み・編集。キャンバスとテーブルの選択を連動させて探索。</p>
            </article>
          </div>
        </section>
        <section className="preview-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE PLAYGROUND</p>
              <h2>形とデータを、同じ視点で。</h2>
            </div>
            <a className="text-link" href={playground}>
              自分で試す ↗
            </a>
          </div>
          <a className="screenshot-link" href={playground} aria-label="Playgroundを開く">
            <img
              src={`${import.meta.env.BASE_URL}screenshots/playground.png`}
              alt="レイヤー、図形キャンバス、属性テーブル、SQLの実行結果を並べたPlaygroundの実画面"
              width="1600"
              height="1000"
              loading="lazy"
            />
          </a>
          <p className="preview-caption">
            ピクセル座標の2Dジオメトリを扱う実験環境です。地理座標の地図ビューアーではありません。
          </p>
        </section>
        <section className="start">
          <p className="eyebrow">YOUR NEXT EXPERIMENT</p>
          <h2>最初の一行から、はじめよう。</h2>
          <p>
            Playgroundの「Examples」で「Construct geometry」を選び、
            <br />
            「Run query」を押すと、SQLから線を描けます。
          </p>
          <a className="button" href={playground}>
            Playgroundを開く <span>↗</span>
          </a>
          <small>Spatial拡張の読み込みが必要です。保存方式は画面下部で確認できます。</small>
        </section>
      </main>
      <footer className="site-footer">
        <a className="brand" href={import.meta.env.BASE_URL}>
          ◈ DuckDB Spatial Lab
        </a>
        <span>Built for curiosity. Open source.</span>
        <a href={repository}>Source on GitHub ↗</a>
      </footer>
    </>
  );
}
