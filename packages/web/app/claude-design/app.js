/* NEAT — graph view runtime
   Renders the sample Bloomberg topology with Cytoscape.js.
   View-only: pan + zoom enabled; node/edge editing disabled.
*/
;(function () {
  const data = window.NEAT_GRAPH
  if (!data) {
    console.error('NEAT_GRAPH not loaded')
    return
  }

  // ---------- node-shape / color helpers --------------------------------
  // Map node types to color CSS variables resolved at runtime.
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

  const TYPE_STYLE = {
    service: { color: cssVar('--n-service'), shape: 'round-rectangle', size: 32 },
    db: { color: cssVar('--n-db'), shape: 'barrel', size: 34 },
    cache: { color: cssVar('--n-cache'), shape: 'barrel', size: 28 },
    stream: { color: cssVar('--n-stream'), shape: 'cut-rectangle', size: 32 },
    queue: { color: cssVar('--n-queue'), shape: 'cut-rectangle', size: 28 },
    lambda: { color: cssVar('--n-lambda'), shape: 'diamond', size: 30 },
    cron: { color: cssVar('--n-cron'), shape: 'tag', size: 26 },
    api: { color: cssVar('--n-api'), shape: 'round-rectangle', size: 22 },
    apigw: { color: cssVar('--n-apigw'), shape: 'round-rectangle', size: 36 },
    waf: { color: '#a89898', shape: 'hexagon', size: 28 },
    cdn: { color: '#a8a8b8', shape: 'hexagon', size: 28 },
    lb: { color: '#a8b8b0', shape: 'hexagon', size: 28 },
    compute: { color: cssVar('--n-compute'), shape: 'round-rectangle', size: 32 },
    storage: { color: cssVar('--n-storage'), shape: 'round-tag', size: 28 },
    external: { color: cssVar('--n-external'), shape: 'round-octagon', size: 30 },
    search: { color: cssVar('--n-search'), shape: 'barrel', size: 28 },
    cluster: { color: cssVar('--n-cluster'), shape: 'round-rectangle' },
    namespace: { color: cssVar('--n-namespace'), shape: 'round-rectangle' },
    vpc: { color: cssVar('--n-vpc'), shape: 'round-rectangle' },
    env: { color: cssVar('--n-env'), shape: 'round-rectangle' },
    cloud: { color: '#1d1d22', shape: 'round-rectangle' },
  }

  const provColor = {
    STATIC: cssVar('--prov-static'),
    OBSERVED: cssVar('--prov-observed'),
    INFERRED: cssVar('--prov-inferred'),
  }

  // ---------- build elements --------------------------------------------
  const elements = []
  data.nodes.forEach((n) => {
    const t = n.data.type
    const ts = TYPE_STYLE[t] || { color: '#888', shape: 'ellipse', size: 24 }
    elements.push({
      data: {
        ...n.data,
        _color: ts.color,
        _shape: ts.shape,
        _size: ts.size || 28,
        _isCompound: ['cloud', 'env', 'vpc', 'cluster', 'namespace'].includes(t),
      },
      classes: `t-${t} ${['cloud', 'env', 'vpc', 'cluster', 'namespace'].includes(t) ? 'compound' : 'leaf'}`,
    })
  })
  data.edges.forEach((e) => {
    elements.push({
      data: {
        ...e.data,
        _color: provColor[e.data.provenance] || '#888',
        _width: e.data.provenance === 'INFERRED' ? 1 : e.data.provenance === 'OBSERVED' ? 1.4 : 1.2,
        _style:
          e.data.provenance === 'INFERRED'
            ? 'dotted'
            : e.data.provenance === 'OBSERVED'
              ? 'dashed'
              : 'solid',
        _opacity:
          e.data.provenance === 'INFERRED' ? 0.55 : e.data.provenance === 'OBSERVED' ? 0.85 : 0.75,
      },
    })
  })

  // ---------- Cytoscape -------------------------------------------------
  const cy = cytoscape({
    container: document.getElementById('cy'),
    elements,

    minZoom: 0.001,
    maxZoom: 50,
    wheelSensitivity: 0.25,

    // VIEW-ONLY: pan + zoom allowed; nodes locked
    autoungrabify: true, // can't drag nodes
    autounselectify: false, // selection IS allowed (read-only inspector)
    boxSelectionEnabled: false,

    style: [
      // ---------- compound containers ----------
      {
        selector: 'node.compound',
        style: {
          'background-color': 'data(_color)',
          'background-opacity': 0.35,
          'border-width': 1,
          'border-color': '#2a2a30',
          'border-style': 'solid',
          shape: 'round-rectangle',
          'corner-radius': '4',
          label: 'data(label)',
          'text-valign': 'top',
          'text-halign': 'left',
          'text-margin-x': 8,
          'text-margin-y': 4,
          'font-family': 'JetBrains Mono, monospace',
          'font-size': 10.5,
          color: '#9b968c',
          padding: '24px',
          'text-transform': 'lowercase',
        },
      },
      {
        selector: 'node.t-cloud',
        style: { 'background-opacity': 0.18, padding: '32px', 'font-size': 11.5, color: '#d8d3c9' },
      },
      {
        selector: 'node.t-env',
        style: { 'background-opacity': 0.3, padding: '28px', 'font-size': 11, color: '#d8d3c9' },
      },
      {
        selector: 'node.t-vpc',
        style: { 'background-opacity': 0.4, padding: '22px', 'font-size': 10.5 },
      },
      { selector: 'node.t-cluster', style: { 'background-opacity': 0.55, padding: '20px' } },
      { selector: 'node.t-namespace', style: { 'background-opacity': 0.65, padding: '16px' } },

      // ---------- leaf nodes ----------
      {
        selector: 'node.leaf',
        style: {
          'background-color': 'data(_color)',
          'background-opacity': 0.92,
          shape: 'data(_shape)',
          width: 'data(_size)',
          height: 'data(_size)',
          label: 'data(label)',
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 5,
          'font-family': 'JetBrains Mono, monospace',
          'font-size': 9.5,
          color: '#d8d3c9',
          'text-outline-width': 2,
          'text-outline-color': '#0a0a0b',
          'border-width': 1,
          'border-color': '#0a0a0b',
          'min-zoomed-font-size': 7,
        },
      },
      // type-specific tweaks
      {
        selector: 'node.t-api',
        style: { width: 8, height: 8, 'font-size': 8.5, color: '#9b968c' },
      },
      { selector: 'node.t-cron', style: { width: 18, height: 14 } },
      {
        selector: 'node.t-external',
        style: {
          'background-opacity': 0.7,
          'border-color': '#46443f',
          'border-width': 1,
          'border-style': 'dashed',
          color: '#9b968c',
        },
      },
      {
        selector: 'node.t-lambda',
        style: { 'background-color': cssVar('--n-lambda'), width: 22, height: 22 },
      },
      { selector: 'node.t-storage', style: { 'background-color': cssVar('--n-storage') } },
      { selector: 'node.t-stream', style: { 'background-color': cssVar('--n-stream') } },
      {
        selector: 'node.t-queue',
        style: { 'background-color': cssVar('--n-queue'), width: 20, height: 20 },
      },

      // selected
      {
        selector: 'node:selected',
        style: {
          'border-color': cssVar('--accent'),
          'border-width': 2,
          'background-opacity': 1,
          color: '#f4efe6',
          'font-weight': 600,
          'z-index': 999,
        },
      },
      // dim non-neighbors when something is selected
      {
        selector: '.dim',
        style: {
          opacity: 0.18,
        },
      },
      {
        selector: 'edge.dim',
        style: { opacity: 0.08 },
      },
      {
        selector: 'node.hl, edge.hl',
        style: { opacity: 1 },
      },
      {
        selector: 'edge.hl',
        style: {
          width: 'mapData(_width, 0, 2, 1.6, 2.4)',
          opacity: 1,
        },
      },

      // ---------- edges ----------
      {
        selector: 'edge',
        style: {
          'curve-style': 'bezier',
          'control-point-step-size': 30,
          'line-color': 'data(_color)',
          'line-style': 'data(_style)',
          width: 'data(_width)',
          opacity: 'data(_opacity)',
          'target-arrow-shape': 'triangle-backcurve',
          'target-arrow-color': 'data(_color)',
          'arrow-scale': 0.85,
          'font-family': 'JetBrains Mono, monospace',
          'font-size': 8,
          color: '#6a675f',
          'text-rotation': 'autorotate',
          'text-background-color': '#0a0a0b',
          'text-background-opacity': 1,
          'text-background-padding': 2,
        },
      },
      {
        // show edge verb only on closer zoom
        selector: 'edge[type]',
        style: { label: 'data(type)', 'min-zoomed-font-size': 11 },
      },

      // ---------- node-type extras: special apigw/cdn/lb badges ----------
      {
        selector: 'node.t-apigw',
        style: {
          'background-color': cssVar('--n-apigw'),
          shape: 'round-rectangle',
          width: 36,
          height: 22,
          'font-size': 9,
        },
      },
    ],

    layout: {
      name: 'cose',
      animate: false,
      randomize: true,
      idealEdgeLength: 90,
      nodeRepulsion: 9000,
      edgeElasticity: 80,
      gravity: 0.4,
      numIter: 2200,
      nestingFactor: 1.4,
      componentSpacing: 100,
      padding: 30,
      fit: true,
    },
  })

  // status bar counts + legend counts
  document.getElementById('st-nodes').textContent = data.nodes.length
  document.getElementById('st-edges').textContent = data.edges.length
  const counts = { STATIC: 0, OBSERVED: 0, INFERRED: 0 }
  data.edges.forEach((e) => {
    counts[e.data.provenance] = (counts[e.data.provenance] || 0) + 1
  })
  document.getElementById('ct-static').textContent = counts.STATIC
  document.getElementById('ct-observed').textContent = counts.OBSERVED
  document.getElementById('ct-inferred').textContent = counts.INFERRED
  // also update canvas tag
  document.querySelector('.canvas-tag .meta').textContent =
    `live · ${data.nodes.length} nodes · ${data.edges.length} edges · cose layout`
  // edges tab count
  // (will be set on selection)

  // ---------- selection / inspector -------------------------------------
  const inspectBody = document.getElementById('inspect-body')

  function renderInspector(nodeId) {
    const n = cy.getElementById(nodeId)
    if (!n || n.length === 0 || !n.isNode()) return
    const d = n.data()
    // gather outgoing/incoming
    const out = n.outgoers('edge').map((e) => ({
      verb: e.data('type'),
      target: e.target().data('label') || e.target().id(),
      prov: e.data('provenance'),
      conf: e.data('confidence'),
    }))
    const inc = n.incomers('edge').map((e) => ({
      verb: e.data('type'),
      target: e.source().data('label') || e.source().id(),
      prov: e.data('provenance'),
      conf: e.data('confidence'),
    }))

    // metadata kvs (only the ones we have)
    const meta = []
    if (d.lang) meta.push(['language', d.lang])
    if (d.replicas) meta.push(['replicas', d.replicas])
    if (d.image) meta.push(['image', d.image])
    if (d.engine) meta.push(['engine', d.engine])
    if (d.version) meta.push(['version', d.version])
    if (d.size) meta.push(['instance', d.size])
    if (d.protocol) meta.push(['protocol', d.protocol])
    if (d.runtime) meta.push(['runtime', d.runtime])
    if (d.mem) meta.push(['memory', d.mem])
    if (d.schedule) meta.push(['schedule', d.schedule])
    if (d.tz) meta.push(['tz', d.tz])
    if (d.kind) meta.push(['kind', d.kind])
    if (d.region) meta.push(['region', d.region])
    if (d.stage) meta.push(['stage', d.stage])
    if (d.k8s_version) meta.push(['k8s', d.k8s_version])

    const parent = d.parent ? cy.getElementById(d.parent).data('label') : '—'

    // synthetic metrics so the panel feels alive
    const metricRPS = d.replicas
      ? Math.round(d.replicas * 480 + Math.random() * 220)
      : Math.round(40 + Math.random() * 80)
    const metricP99 = (38 + Math.random() * 64).toFixed(1)
    const metricErr = (Math.random() * 0.7).toFixed(2)

    // type-aware title decoration
    const labelParts = (d.label || d.id).split('/')
    const stem = labelParts.length > 1 ? labelParts[0] + '/' : ''
    const rest = labelParts.length > 1 ? labelParts.slice(1).join('/') : d.label || d.id

    inspectBody.innerHTML = `
      <section class="insp-section">
        <div class="insp-eyebrow">${escapeHtml(d.type || '').toUpperCase()} · ${escapeHtml(parent)}</div>
        <div class="insp-title"><span class="stem">${escapeHtml(stem)}</span>${escapeHtml(rest)}</div>
        <div class="insp-sub">${escapeHtml(d.id)}</div>
        <div class="insp-tags">
          ${d.replicas ? `<span class="tag alive">${d.replicas} replicas</span>` : ''}
          ${d.engine ? `<span class="tag">${escapeHtml(d.engine)}</span>` : ''}
          ${d.lang ? `<span class="tag">${escapeHtml(d.lang)}</span>` : ''}
          ${d.kind ? `<span class="tag">${escapeHtml(d.kind)}</span>` : ''}
          ${meta.length === 0 ? `<span class="tag">${escapeHtml(d.type)}</span>` : ''}
        </div>
      </section>

      ${metricsBlock(d.type, metricRPS, metricP99, metricErr)}

      ${
        meta.length
          ? `
      <section class="insp-section">
        <div class="insp-h">Properties <span class="ct">${meta.length}</span></div>
        <dl class="kv">
          ${meta.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}
        </dl>
      </section>`
          : ''
      }

      <section class="insp-section">
        <div class="insp-h">Outgoing <span class="ct">${out.length}</span></div>
        <ul class="edge-list">
          ${out.length ? out.map(edgeRow).join('') : `<li><span class="verb">—</span><span class="target" style="color:var(--paper-3)">no outgoing edges</span></li>`}
        </ul>
      </section>

      <section class="insp-section">
        <div class="insp-h">Incoming <span class="ct">${inc.length}</span></div>
        <ul class="edge-list">
          ${inc.length ? inc.map(edgeRow).join('') : `<li><span class="verb">—</span><span class="target" style="color:var(--paper-3)">no incoming edges</span></li>`}
        </ul>
      </section>

      <section class="insp-section">
        <div class="insp-h">Provenance summary <span class="ct">${out.length + inc.length}</span></div>
        ${provBars(out, inc)}
      </section>
    `

    // tab edge count
    document.querySelectorAll('.inspect-tab').forEach((t, i) => {
      if (i === 1) {
        const ct = t.querySelector('.ct')
        if (ct) ct.textContent = out.length + inc.length
      }
    })
  }

  function edgeRow(e) {
    return `<li>
      <span class="pdot ${e.prov}"></span>
      <span class="verb">${escapeHtml(e.verb || '').toLowerCase()}</span>
      <span class="target">${escapeHtml(e.target)}</span>
      <span class="conf">${typeof e.conf === 'number' ? e.conf.toFixed(2) : '—'}</span>
    </li>`
  }

  function metricsBlock(type, rps, p99, err) {
    if (!type || ['env', 'vpc', 'cluster', 'namespace', 'cloud', 'external', 'api'].includes(type))
      return ''
    return `<section class="insp-section">
      <div class="metrics">
        <div class="metric"><div class="lbl">req/s</div><div class="val">${rps.toLocaleString()}</div><div class="delta">+${(Math.random() * 4).toFixed(1)}%</div></div>
        <div class="metric"><div class="lbl">p99 ms</div><div class="val">${p99}</div><div class="delta ${parseFloat(p99) > 80 ? 'bad' : ''}">${parseFloat(p99) > 80 ? '+' : '−'}${(Math.random() * 8).toFixed(1)}%</div></div>
        <div class="metric"><div class="lbl">err %</div><div class="val">${err}</div><div class="delta ${parseFloat(err) > 0.4 ? 'bad' : ''}">${parseFloat(err) > 0.4 ? '+' : '−'}${(Math.random() * 0.3).toFixed(2)}</div></div>
      </div>
    </section>`
  }

  function provBars(out, inc) {
    const all = [...out, ...inc]
    const total = all.length || 1
    const c = { STATIC: 0, OBSERVED: 0, INFERRED: 0 }
    all.forEach((e) => {
      c[e.prov] = (c[e.prov] || 0) + 1
    })
    const row = (k) => {
      const pct = (c[k] / total) * 100
      return `<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;margin:5px 0">
        <span class="pdot ${k}" style="width:7px;height:7px;border-radius:50%;background:var(--prov-${k.toLowerCase()})"></span>
        <span class="serif" style="font-style:italic;width:70px;color:var(--paper-2)">${k.toLowerCase()}</span>
        <div style="flex:1;height:4px;background:var(--ink-3);border-radius:2px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:var(--prov-${k.toLowerCase()})"></div>
        </div>
        <span class="mono" style="font-size:10.5px;color:var(--paper-3);width:34px;text-align:right">${c[k]}</span>
      </div>`
    }
    return row('STATIC') + row('OBSERVED') + row('INFERRED')
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    )
  }

  // selection: highlight neighbors, dim others, render inspector
  function focusNode(id) {
    cy.elements().removeClass('hl dim')
    const n = cy.getElementById(id)
    if (!n || n.length === 0) return
    const neigh = n.neighborhood().add(n)
    cy.elements().not(neigh).addClass('dim')
    neigh.addClass('hl')
    renderInspector(id)
  }

  cy.on('tap', 'node', (evt) => {
    const id = evt.target.id()
    cy.$(':selected').unselect()
    evt.target.select()
    focusNode(id)
  })
  cy.on('tap', (evt) => {
    if (evt.target === cy) {
      cy.elements().removeClass('hl dim')
      cy.$(':selected').unselect()
      // re-render the default
      renderInspector('svc-oms')
    }
  })

  // initial selection: order management — central, interesting fan-out
  cy.ready(() => {
    setTimeout(() => {
      cy.$id('svc-oms').select()
      focusNode('svc-oms')
      cy.fit(undefined, 40)
      // if fit clamped to minZoom (huge graph), zoom in a touch toward center
      if (cy.zoom() < 0.25) {
        cy.zoom({ level: 0.45, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
        cy.center(cy.$id('svc-oms'))
      }
      drawMinimap()
    }, 80)
  })

  // ---------- trackpad two-finger pan -----------------------------------
  // Cytoscape binds its own wheel listener on its inner canvases. We attach
  // ours in the CAPTURE phase on the wrapper so we see the event first and
  // can stop it from reaching Cytoscape's zoom-on-wheel handler.
  const cyEl = document.getElementById('cy')
  const wheelHandler = (e) => {
    if (e.ctrlKey) {
      // pinch-zoom (browser synthesizes ctrlKey for trackpad pinch)
      e.preventDefault()
      e.stopPropagation()
      const factor = Math.exp(-e.deltaY * 0.015)
      const newZoom = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor))
      const rect = cyEl.getBoundingClientRect()
      cy.zoom({
        level: newZoom,
        renderedPosition: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      })
    } else {
      // two-finger drag → pan
      e.preventDefault()
      e.stopPropagation()
      cy.panBy({ x: -e.deltaX, y: -e.deltaY })
    }
  }
  cyEl.addEventListener('wheel', wheelHandler, { passive: false, capture: true })
  // also catch on the canvas-wrap in case cy mounts canvases that intercept
  document
    .querySelector('.canvas-wrap')
    .addEventListener('wheel', wheelHandler, { passive: false, capture: true })

  // ---------- zoom controls ---------------------------------------------
  document.getElementById('z-in').onclick = () =>
    cy.zoom({ level: cy.zoom() * 1.2, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
  document.getElementById('z-out').onclick = () =>
    cy.zoom({ level: cy.zoom() / 1.2, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } })
  document.getElementById('z-fit').onclick = () => cy.fit(undefined, 60)

  // ---------- minimap ---------------------------------------------------
  const mmCanvas = document.getElementById('minimap-canvas')
  const mmFrame = document.getElementById('minimap-frame')
  function drawMinimap() {
    const dpr = window.devicePixelRatio || 1
    const rect = mmCanvas.getBoundingClientRect()
    mmCanvas.width = rect.width * dpr
    mmCanvas.height = rect.height * dpr
    const ctx = mmCanvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)

    const bb = cy.elements().boundingBox()
    if (!isFinite(bb.x1)) return
    const pad = 8
    const sx = (rect.width - pad * 2) / (bb.w || 1)
    const sy = (rect.height - pad * 2) / (bb.h || 1)
    const s = Math.min(sx, sy)
    const ox = pad - bb.x1 * s + (rect.width - pad * 2 - bb.w * s) / 2
    const oy = pad - bb.y1 * s + (rect.height - pad * 2 - bb.h * s) / 2

    // edges (very faint)
    ctx.lineWidth = 0.5
    cy.edges().forEach((e) => {
      const a = e.source().position(),
        b = e.target().position()
      ctx.strokeStyle = e.data('_color') + '55'
      ctx.beginPath()
      ctx.moveTo(a.x * s + ox, a.y * s + oy)
      ctx.lineTo(b.x * s + ox, b.y * s + oy)
      ctx.stroke()
    })
    // nodes
    cy.nodes().forEach((n) => {
      if (n.data('_isCompound')) return
      const p = n.position()
      ctx.fillStyle = n.data('_color') || '#888'
      ctx.beginPath()
      ctx.arc(p.x * s + ox, p.y * s + oy, 1.4, 0, Math.PI * 2)
      ctx.fill()
    })

    // viewport frame
    const ext = cy.extent() // graph-coord viewport
    const fx = ext.x1 * s + ox
    const fy = ext.y1 * s + oy
    const fw = (ext.x2 - ext.x1) * s
    const fh = (ext.y2 - ext.y1) * s
    mmFrame.style.left = Math.max(0, fx) + 'px'
    mmFrame.style.top = Math.max(0, fy) + 'px'
    mmFrame.style.width = Math.min(rect.width - Math.max(0, fx), fw) + 'px'
    mmFrame.style.height = Math.min(rect.height - Math.max(0, fy), fh) + 'px'
  }
  cy.on('viewport zoom pan render', () => requestAnimationFrame(drawMinimap))
  window.addEventListener('resize', () => requestAnimationFrame(drawMinimap))

  // ---------- legend filtering ------------------------------------------
  const provFilter = new Set() // empty = show all; otherwise = hidden set
  document.querySelectorAll('.legend-row[data-prov]').forEach((row) => {
    row.addEventListener('click', () => {
      const p = row.dataset.prov
      if (provFilter.has(p)) {
        provFilter.delete(p)
        row.style.opacity = '1'
      } else {
        provFilter.add(p)
        row.style.opacity = '0.4'
      }
      cy.edges().forEach((e) => {
        e.style('display', provFilter.has(e.data('provenance')) ? 'none' : 'element')
      })
    })
  })

  // expose for debugging
  window.__cy = cy
})()
