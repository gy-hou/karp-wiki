const kb = window.KB_DATA || { schema_version: 1, built_at: null, manifest: { total: 0, counts: {} }, nodes: [], edges: [], pages: [] };

const app = document.querySelector('#app');
const title = document.querySelector('#page-title');
const buildTime = document.querySelector('#build-time');
const searchInput = document.querySelector('#global-search');

const TYPES = ['concept', 'entity', 'source', 'output'];
const typeLabels = {
  concept: '概念',
  entity: '实体',
  source: '来源',
  output: '产出',
};
const typePlurals = {
  concept: 'concepts',
  entity: 'entities',
  source: 'sources',
  output: 'outputs',
};
const typeColors = {
  concept: '#2f6f9f',
  entity: '#8a5a9d',
  source: '#c87932',
  output: '#3d8058',
};
const relationLabels = {
  derived_from: '派生自',
  links_to: '链接到',
};

const pagesById = new Map(kb.pages.map((page) => [page.id, page]));
const state = {
  view: 'dashboard',
  query: '',
  type: 'all',
  tag: 'all',
  visibility: 'all',
  relation: 'all',
  selectedId: kb.nodes[0]?.id || null,
};

buildTime.textContent = kb.built_at
  ? new Date(kb.built_at).toLocaleString('zh-CN')
  : '未构建';

searchInput.addEventListener('input', (event) => {
  state.query = event.target.value.trim().toLocaleLowerCase();
  render();
});

document.querySelectorAll('[data-nav]').forEach((button) => {
  button.addEventListener('click', () => {
    state.view = button.dataset.nav;
    updateNav();
    render();
  });
});

app.addEventListener('change', (event) => {
  const target = event.target;
  if (target.id === 'type-filter') state.type = target.value;
  if (target.id === 'tag-filter') state.tag = target.value;
  if (target.id === 'visibility-filter') state.visibility = target.value;
  if (target.id === 'relation-filter') state.relation = target.value;
  ensureSelection(filteredNodes());
  render();
});

app.addEventListener('keydown', (event) => {
  const target = event.target.closest('[data-select]');
  if (!target || !target.closest('svg') || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  state.selectedId = target.dataset.select;
  render();
});

app.addEventListener('click', (event) => {
  const target = event.target.closest('[data-select], [data-open-view], [data-type]');
  if (!target) return;

  if (target.dataset.openView) {
    state.view = target.dataset.openView;
    if (target.dataset.type) state.type = target.dataset.type;
    updateNav();
    render();
    return;
  }

  if (target.dataset.select) {
    state.selectedId = target.dataset.select;
    if (target.closest('svg')) {
      render();
    } else {
      state.view = 'library';
      updateNav();
      render();
    }
  }
});

function updateNav() {
  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.classList.toggle('active', button.dataset.nav === state.view);
  });
}

function render() {
  const names = { dashboard: '概览', library: '资料库', graph: '知识图谱' };
  title.textContent = names[state.view] || '概览';

  if (!kb.built_at) {
    renderMissingData();
    return;
  }
  if (state.view === 'dashboard') renderDashboard();
  if (state.view === 'library') renderLibrary();
  if (state.view === 'graph') renderGraph();
}

function renderMissingData() {
  app.innerHTML = `
    <section class="panel empty">
      <strong>还没有可视化数据</strong>
      请先在知识库根目录运行 <code class="mono">npm run build-web</code>，再刷新本页。
    </section>
  `;
}

function renderDashboard() {
  const counts = kb.manifest.counts || {};
  app.innerHTML = `
    <div class="grid stats-grid">
      <button class="stat-card" data-open-view="library" data-type="all">
        <span>全部页面</span><strong>${kb.manifest.total || 0}</strong><i class="type-stripe"></i>
      </button>
      ${TYPES.map((type) => statCard(type, counts[type] || 0)).join('')}
    </div>
    <div class="grid two-col">
      <section class="panel">
        <div class="panel-heading">
          <div><h3>关系概览</h3><p>typed edges 直接来自冻结的 graph 契约</p></div>
        </div>
        ${relationSummary()}
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div><h3>类型图例</h3><p>四类页面使用固定配色</p></div>
        </div>
        <div class="legend">${typeLegend()}</div>
      </section>
    </div>
    <section class="panel">
      <div class="panel-heading">
        <div><h3>知识页</h3><p>${state.query ? `匹配“${escapeHtml(state.query)}”` : '按 id 稳定排序'}</p></div>
        <button class="nav-button-inline" data-open-view="library">进入资料库</button>
      </div>
      <div class="item-list">
        ${filteredNodes().slice(0, 5).map((node) => itemCard(node)).join('') || '<div class="empty">没有匹配结果</div>'}
      </div>
    </section>
  `;
}

function statCard(type, count) {
  return `
    <button class="stat-card" data-open-view="library" data-type="${type}" style="--type-color:${typeColors[type]}">
      <span>${typeLabels[type]}</span><strong>${count}</strong><i class="type-stripe"></i>
    </button>
  `;
}

function relationSummary() {
  const counts = Object.fromEntries(Object.keys(relationLabels).map((relation) => [
    relation,
    kb.edges.filter((edge) => edge.relation === relation).length,
  ]));
  const max = Math.max(1, ...Object.values(counts));
  return `
    <div class="relation-bars">
      ${Object.entries(relationLabels).map(([relation, label]) => `
        <div class="relation-row">
          <span>${label}</span>
          <div class="relation-track"><i style="width:${(counts[relation] / max) * 100}%"></i></div>
          <strong>${counts[relation]}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function renderLibrary() {
  const nodes = filteredNodes();
  ensureSelection(nodes);
  const selected = nodes.find((node) => node.id === state.selectedId) || null;
  app.innerHTML = `
    ${filters({ includeRelation: false })}
    <div class="grid two-col">
      <section class="item-list">
        ${nodes.map((node) => itemCard(node, node.id === state.selectedId)).join('') || '<div class="panel empty">没有匹配结果</div>'}
      </section>
      ${selected ? detailPanel(selected) : '<section class="detail-panel empty">请选择一个知识页</section>'}
    </div>
  `;
}

function renderGraph() {
  let nodes = filteredNodes();
  let nodeIds = new Set(nodes.map((node) => node.id));
  let edges = kb.edges.filter((edge) => (
    nodeIds.has(edge.from)
    && nodeIds.has(edge.to)
    && (state.relation === 'all' || edge.relation === state.relation)
  ));

  if (state.relation !== 'all') {
    const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
    nodes = nodes.filter((node) => connected.has(node.id));
    nodeIds = new Set(nodes.map((node) => node.id));
    edges = edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  }

  ensureSelection(nodes);
  const selected = nodes.find((node) => node.id === state.selectedId) || null;
  const positions = graphPositions(nodes);

  app.innerHTML = `
    ${filters({ includeRelation: true })}
    <div class="graph-layout">
      <section class="panel graph-wrap">
        <div class="panel-heading">
          <div><h3>关系图</h3><p>${nodes.length} 个节点 · ${edges.length} 条边</p></div>
          <div class="legend">
            <span class="legend-item"><i class="legend-line"></i>派生自</span>
            <span class="legend-item"><i class="legend-line links"></i>链接到</span>
          </div>
        </div>
        ${nodes.length ? graphSvg(nodes, edges, positions) : '<div class="empty">当前条件下没有可显示的图谱</div>'}
      </section>
      ${selected ? detailPanel(selected) : '<section class="detail-panel empty">点击节点查看详情</section>'}
    </div>
  `;
}

function filters({ includeRelation }) {
  return `
    <section class="panel toolbar">
      <label class="filter-label">页面类型
        <select id="type-filter" class="select">
          ${selectOptions([['all', '全部类型'], ...TYPES.map((type) => [type, typeLabels[type]])], state.type)}
        </select>
      </label>
      <label class="filter-label">标签
        <select id="tag-filter" class="select">
          ${selectOptions([['all', '全部标签'], ...allTags().map((tag) => [tag, tag])], state.tag)}
        </select>
      </label>
      <label class="filter-label">可见性
        <select id="visibility-filter" class="select">
          ${selectOptions([['all', '全部可见性'], ['shareable', 'shareable'], ['private', 'private']], state.visibility)}
        </select>
      </label>
      ${includeRelation ? `
        <label class="filter-label">关系
          <select id="relation-filter" class="select">
            ${selectOptions([['all', '全部关系'], ...Object.entries(relationLabels)], state.relation)}
          </select>
        </label>
      ` : ''}
    </section>
  `;
}

function filteredNodes() {
  return kb.nodes.filter((node) => {
    const tags = Array.isArray(node.tags) ? node.tags : [];
    const haystack = [node.title, node.summary, ...tags].join(' ').toLocaleLowerCase();
    return (state.type === 'all' || node.type === state.type)
      && (state.tag === 'all' || tags.includes(state.tag))
      && (state.visibility === 'all' || node.content_visibility === state.visibility)
      && (!state.query || haystack.includes(state.query));
  });
}

function ensureSelection(nodes) {
  if (!nodes.some((node) => node.id === state.selectedId)) {
    state.selectedId = nodes[0]?.id || null;
  }
}

function itemCard(node, active = false) {
  return `
    <button class="item-card ${active ? 'active' : ''}" data-select="${node.id}" style="--type-color:${typeColors[node.type]}">
      <div class="meta-row">
        <span class="pill type">${typeLabels[node.type]}</span>
        <span class="pill mono">${escapeHtml(node.id)}</span>
      </div>
      <h4>${escapeHtml(node.title)}</h4>
      <p>${escapeHtml(node.summary)}</p>
      <div class="tag-row">${tagPills(node.tags)}</div>
    </button>
  `;
}

function detailPanel(node) {
  const page = pagesById.get(node.id);
  const file = page?.file || `${node.id}.md`;
  const folder = typePlurals[node.type] || '';
  const href = `../wiki/${folder}/${encodeURIComponent(file)}`;
  return `
    <section class="detail-panel" style="--type-color:${typeColors[node.type]}">
      <div class="meta-row">
        <span class="pill type">${typeLabels[node.type]}</span>
        <span class="pill mono">${escapeHtml(node.id)}</span>
      </div>
      <h3>${escapeHtml(node.title)}</h3>
      <p class="detail-summary">${escapeHtml(node.summary)}</p>
      <div class="tag-row">${tagPills(node.tags)}</div>
      <div class="detail-section">
        <h4>Markdown 页面</h4>
        <a class="page-link" href="${href}">打开 ${escapeHtml(file)} <span aria-hidden="true">↗</span></a>
      </div>
    </section>
  `;
}

function graphSvg(nodes, edges, positions) {
  const labels = TYPES.map((type, index) => `
    <text class="graph-column-label" x="${130 + index * 235}" y="32" text-anchor="middle">${typeLabels[type]}</text>
  `).join('');
  return `
    <svg class="graph-svg" viewBox="0 0 940 590" role="img" aria-label="karp-wiki 知识图谱">
      <defs>
        <marker id="arrow-derived" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#287d73"></path>
        </marker>
        <marker id="arrow-links" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#7c8a94"></path>
        </marker>
      </defs>
      ${labels}
      ${edges.map((edge) => edgeElement(edge, positions)).join('')}
      ${nodes.map((node) => nodeElement(node, positions.get(node.id))).join('')}
    </svg>
  `;
}

function edgeElement(edge, positions) {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  if (!from || !to) return '';
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const start = { x: from.x + (dx / length) * 20, y: from.y + (dy / length) * 20 };
  const end = { x: to.x - (dx / length) * 20, y: to.y - (dy / length) * 20 };
  const bend = edge.relation === 'derived_from' ? -18 : 18;
  const cx = (start.x + end.x) / 2 - (dy / length) * bend;
  const cy = (start.y + end.y) / 2 + (dx / length) * bend;
  const marker = edge.relation === 'derived_from' ? 'arrow-derived' : 'arrow-links';
  return `
    <path class="graph-edge ${edge.relation}" d="M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}" marker-end="url(#${marker})">
      <title>${escapeHtml(edge.from)} ${relationLabels[edge.relation]} ${escapeHtml(edge.to)}</title>
    </path>
  `;
}

function nodeElement(node, point) {
  if (!point) return '';
  const active = node.id === state.selectedId ? 'active' : '';
  return `
    <g class="graph-node ${active}" data-select="${node.id}" transform="translate(${point.x}, ${point.y})" tabindex="0" role="button" aria-label="${escapeHtml(node.title)}">
      <circle r="16" fill="${typeColors[node.type]}"></circle>
      <text x="22" y="4">${escapeHtml(shortLabel(node.title))}</text>
    </g>
  `;
}

function graphPositions(nodes) {
  const positions = new Map();
  for (const [typeIndex, type] of TYPES.entries()) {
    const group = nodes.filter((node) => node.type === type);
    const spacing = 500 / Math.max(1, group.length);
    group.forEach((node, index) => {
      positions.set(node.id, {
        x: 130 + typeIndex * 235,
        y: Math.round(62 + spacing * (index + 0.5)),
      });
    });
  }
  return positions;
}

function typeLegend() {
  return TYPES.map((type) => `
    <span class="legend-item"><i class="legend-dot" style="--legend-color:${typeColors[type]}"></i>${typeLabels[type]}</span>
  `).join('');
}

function tagPills(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`)
    .join('');
}

function allTags() {
  return [...new Set(kb.nodes.flatMap((node) => Array.isArray(node.tags) ? node.tags : []))]
    .sort((left, right) => left.localeCompare(right));
}

function selectOptions(options, selected) {
  return options.map(([value, label]) => (
    `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`
  )).join('');
}

function shortLabel(value) {
  const text = String(value ?? '');
  return text.length > 22 ? `${text.slice(0, 20)}…` : text;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

render();
