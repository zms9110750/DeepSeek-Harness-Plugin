(() => {
  // node_modules/.pnpm/@dagrejs+dagre@3.1.1/node_modules/@dagrejs/dagre/dist/dagre.esm.js
  var Te = Object.defineProperty;
  var In = (e, n, t) => n in e ? Te(e, n, { enumerable: true, configurable: true, writable: true, value: t }) : e[n] = t;
  var Sn = (e, n) => {
    for (var t in n) Te(e, t, { get: n[t], enumerable: true });
  };
  var je = (e, n, t) => In(e, typeof n != "symbol" ? n + "" : n, t);
  var ie = {};
  Sn(ie, { Graph: () => T, alg: () => H });
  var Mn = Object.defineProperty;
  var Se = (e, n) => {
    for (var t in n) Mn(e, t, { get: n[t], enumerable: true });
  };
  var Q = class {
    constructor(e) {
      this._isDirected = true, this._isMultigraph = false, this._isCompound = false, this._nodes = {}, this._in = {}, this._preds = {}, this._out = {}, this._sucs = {}, this._edgeObjs = {}, this._edgeLabels = {}, this._nodeCount = 0, this._edgeCount = 0, this._defaultNodeLabelFn = () => {
      }, this._defaultEdgeLabelFn = () => {
      }, e && (this._isDirected = "directed" in e ? e.directed : true, this._isMultigraph = "multigraph" in e ? e.multigraph : false, this._isCompound = "compound" in e ? e.compound : false), this._isCompound && (this._parent = {}, this._children = {}, this._children["\0"] = {});
    }
    isDirected() {
      return this._isDirected;
    }
    isMultigraph() {
      return this._isMultigraph;
    }
    isCompound() {
      return this._isCompound;
    }
    setGraph(e) {
      return this._label = e, this;
    }
    graph() {
      return this._label;
    }
    setDefaultNodeLabel(e) {
      return typeof e != "function" ? this._defaultNodeLabelFn = () => e : this._defaultNodeLabelFn = e, this;
    }
    nodeCount() {
      return this._nodeCount;
    }
    nodes() {
      return Object.keys(this._nodes);
    }
    sources() {
      return this.nodes().filter((e) => Object.keys(this._in[e]).length === 0);
    }
    sinks() {
      return this.nodes().filter((e) => Object.keys(this._out[e]).length === 0);
    }
    setNodes(e, n) {
      return e.forEach((t) => {
        n !== void 0 ? this.setNode(t, n) : this.setNode(t);
      }), this;
    }
    setNode(e, n) {
      return e in this._nodes ? (arguments.length > 1 && (this._nodes[e] = n), this) : (this._nodes[e] = arguments.length > 1 ? n : this._defaultNodeLabelFn(e), this._isCompound && (this._parent[e] = "\0", this._children[e] = {}, this._children["\0"][e] = true), this._in[e] = {}, this._preds[e] = {}, this._out[e] = {}, this._sucs[e] = {}, ++this._nodeCount, this);
    }
    node(e) {
      return this._nodes[e];
    }
    hasNode(e) {
      return e in this._nodes;
    }
    removeNode(e) {
      if (e in this._nodes) {
        let n = (t) => this.removeEdge(this._edgeObjs[t]);
        delete this._nodes[e], this._isCompound && (this._removeFromParentsChildList(e), delete this._parent[e], this.children(e).forEach((t) => {
          this.setParent(t);
        }), delete this._children[e]), Object.keys(this._in[e]).forEach(n), delete this._in[e], delete this._preds[e], Object.keys(this._out[e]).forEach(n), delete this._out[e], delete this._sucs[e], --this._nodeCount;
      }
      return this;
    }
    setParent(e, n) {
      if (!this._isCompound) throw new Error("Cannot set parent in a non-compound graph");
      if (n === void 0) n = "\0";
      else {
        n += "";
        for (let t = n; t !== void 0; t = this.parent(t)) if (t === e) throw new Error("Setting " + n + " as parent of " + e + " would create a cycle");
        this.setNode(n);
      }
      return this.setNode(e), this._removeFromParentsChildList(e), this._parent[e] = n, this._children[n][e] = true, this;
    }
    parent(e) {
      if (this._isCompound) {
        let n = this._parent[e];
        if (n !== "\0") return n;
      }
    }
    children(e = "\0") {
      if (this._isCompound) {
        let n = this._children[e];
        if (n) return Object.keys(n);
      } else {
        if (e === "\0") return this.nodes();
        if (this.hasNode(e)) return [];
      }
      return [];
    }
    predecessors(e) {
      let n = this._preds[e];
      if (n) return Object.keys(n);
    }
    successors(e) {
      let n = this._sucs[e];
      if (n) return Object.keys(n);
    }
    neighbors(e) {
      let n = this.predecessors(e);
      if (n) {
        let t = new Set(n), r = this.successors(e);
        if (r) for (let o of r) t.add(o);
        return Array.from(t.values());
      }
    }
    isLeaf(e) {
      var n;
      let t;
      return this.isDirected() ? t = this.successors(e) : t = this.neighbors(e), ((n = t == null ? void 0 : t.length) != null ? n : 0) === 0;
    }
    filterNodes(e) {
      let n = new this.constructor({ directed: this._isDirected, multigraph: this._isMultigraph, compound: this._isCompound });
      n.setGraph(this.graph()), Object.entries(this._nodes).forEach(([o, i]) => {
        e(o) && n.setNode(o, i);
      }), Object.values(this._edgeObjs).forEach((o) => {
        n.hasNode(o.v) && n.hasNode(o.w) && n.setEdge(o, this.edge(o));
      });
      let t = {}, r = (o) => {
        let i = this.parent(o);
        return !i || n.hasNode(i) ? (t[o] = i, i) : i in t ? t[i] : r(i);
      };
      return this._isCompound && n.nodes().forEach((o) => n.setParent(o, r(o))), n;
    }
    setDefaultEdgeLabel(e) {
      return typeof e != "function" ? this._defaultEdgeLabelFn = () => e : this._defaultEdgeLabelFn = e, this;
    }
    edgeCount() {
      return this._edgeCount;
    }
    edges() {
      return Object.values(this._edgeObjs);
    }
    setPath(e, n) {
      return e.reduce((t, r) => (n !== void 0 ? this.setEdge(t, r, n) : this.setEdge(t, r), r)), this;
    }
    setEdge(e, n, t, r) {
      let o, i, s, a, l = false;
      typeof e == "object" && e !== null && "v" in e ? (o = e.v, i = e.w, s = e.name, arguments.length === 2 && (a = n, l = true)) : (o = e, i = n, s = r, arguments.length > 2 && (a = t, l = true)), o = "" + o, i = "" + i, s !== void 0 && (s = "" + s);
      let u = z(this._isDirected, o, i, s);
      if (u in this._edgeLabels) return l && (this._edgeLabels[u] = a), this;
      if (s !== void 0 && !this._isMultigraph) throw new Error("Cannot set a named edge when isMultigraph = false");
      this.setNode(o), this.setNode(i), this._edgeLabels[u] = l ? a : this._defaultEdgeLabelFn(o, i, s);
      let d = Pn(this._isDirected, o, i, s);
      return o = d.v, i = d.w, Object.freeze(d), this._edgeObjs[u] = d, Re(this._preds[i], o), Re(this._sucs[o], i), this._in[i][u] = d, this._out[o][u] = d, this._edgeCount++, this;
    }
    edge(e, n, t) {
      let r = arguments.length === 1 ? oe(this._isDirected, e) : z(this._isDirected, e, n, t);
      return this._edgeLabels[r];
    }
    edgeAsObj(e, n, t) {
      let r = arguments.length === 1 ? this.edge(e) : this.edge(e, n, t);
      return typeof r != "object" || r === null ? { label: r } : r;
    }
    hasEdge(e, n, t) {
      return (arguments.length === 1 ? oe(this._isDirected, e) : z(this._isDirected, e, n, t)) in this._edgeLabels;
    }
    removeEdge(e, n, t) {
      let r = arguments.length === 1 ? oe(this._isDirected, e) : z(this._isDirected, e, n, t), o = this._edgeObjs[r];
      if (o) {
        let i = o.v, s = o.w;
        delete this._edgeLabels[r], delete this._edgeObjs[r], Ie(this._preds[s], i), Ie(this._sucs[i], s), delete this._in[s][r], delete this._out[i][r], this._edgeCount--;
      }
      return this;
    }
    inEdges(e, n) {
      return this.isDirected() ? this.filterEdges(this._in[e], e, n) : this.nodeEdges(e, n);
    }
    outEdges(e, n) {
      return this.isDirected() ? this.filterEdges(this._out[e], e, n) : this.nodeEdges(e, n);
    }
    nodeEdges(e, n) {
      if (e in this._nodes) return this.filterEdges({ ...this._in[e], ...this._out[e] }, e, n);
    }
    _removeFromParentsChildList(e) {
      delete this._children[this._parent[e]][e];
    }
    filterEdges(e, n, t) {
      if (!e) return;
      let r = Object.values(e);
      return t ? r.filter((o) => o.v === n && o.w === t || o.v === t && o.w === n) : r;
    }
  };
  function Re(e, n) {
    e[n] ? e[n]++ : e[n] = 1;
  }
  function Ie(e, n) {
    e[n] !== void 0 && !--e[n] && delete e[n];
  }
  function z(e, n, t, r) {
    let o = "" + n, i = "" + t;
    if (!e && o > i) {
      let s = o;
      o = i, i = s;
    }
    return o + "" + i + "" + (r === void 0 ? "\0" : r);
  }
  function Pn(e, n, t, r) {
    let o = "" + n, i = "" + t;
    if (!e && o > i) {
      let a = o;
      o = i, i = a;
    }
    let s = { v: o, w: i };
    return r && (s.name = r), s;
  }
  function oe(e, n) {
    return z(e, n.v, n.w, n.name);
  }
  var Fn = {};
  Se(Fn, { read: () => Yn, write: () => An });
  function An(e) {
    let n = { options: { directed: e.isDirected(), multigraph: e.isMultigraph(), compound: e.isCompound() }, nodes: Vn(e), edges: Dn(e) }, t = e.graph();
    return t !== void 0 && (n.value = structuredClone(t)), n;
  }
  function Vn(e) {
    return e.nodes().map((n) => {
      let t = e.node(n), r = e.parent(n), o = { v: n };
      return t !== void 0 && (o.value = t), r !== void 0 && (o.parent = r), o;
    });
  }
  function Dn(e) {
    return e.edges().map((n) => {
      let t = e.edge(n), r = { v: n.v, w: n.w };
      return n.name !== void 0 && (r.name = n.name), t !== void 0 && (r.value = t), r;
    });
  }
  function Yn(e) {
    let n = new Q(e.options);
    return e.value !== void 0 && n.setGraph(e.value), e.nodes.forEach((t) => {
      n.setNode(t.v, t.value), t.parent && n.setParent(t.v, t.parent);
    }), e.edges.forEach((t) => {
      n.setEdge({ v: t.v, w: t.w, name: t.name }, t.value);
    }), n;
  }
  var H = {};
  Se(H, { CycleException: () => K, bellmanFord: () => Me, components: () => Xn, dijkstra: () => J, dijkstraAll: () => qn, findCycles: () => $n, floydWarshall: () => Jn, isAcyclic: () => Qn, postorder: () => et, preorder: () => nt, prim: () => tt, shortestPaths: () => rt, tarjan: () => Fe, topsort: () => Ae });
  var Wn = () => 1;
  function Me(e, n, t, r) {
    return Bn(e, String(n), t || Wn, r || function(o) {
      var i;
      return (i = e.outEdges(o)) != null ? i : [];
    });
  }
  function Bn(e, n, t, r) {
    let o = {}, i, s = 0, a = e.nodes(), l = function(c) {
      let f = o[c.v], h = o[c.w];
      if (!f || !h) return;
      let p = t(c);
      f.distance + p < h.distance && (o[c.w] = { distance: f.distance + p, predecessor: c.v }, i = true);
    }, u = function() {
      a.forEach(function(c) {
        r(c).forEach(function(f) {
          let h = f.v === c ? f.v : f.w, p = h === f.v ? f.w : f.v;
          l({ v: h, w: p });
        });
      });
    };
    a.forEach(function(c) {
      let f = c === n ? 0 : Number.POSITIVE_INFINITY;
      o[c] = { distance: f, predecessor: "" };
    });
    let d = a.length;
    for (let c = 1; c < d && (i = false, s++, u(), !!i); c++) ;
    if (s === d - 1 && (i = false, u(), i)) throw new Error("The graph contains a negative weight cycle");
    return o;
  }
  function Xn(e) {
    let n = {}, t = [], r;
    function o(i) {
      var s, a;
      i in n || (n[i] = true, r.push(i), (s = e.successors(i)) == null || s.forEach(o), (a = e.predecessors(i)) == null || a.forEach(o));
    }
    return e.nodes().forEach(function(i) {
      r = [], o(i), r.length && t.push(r);
    }), t;
  }
  var Pe = class {
    constructor() {
      this._arr = [], this._keyIndices = {};
    }
    size() {
      return this._arr.length;
    }
    keys() {
      return this._arr.map((e) => e.key);
    }
    has(e) {
      return e in this._keyIndices;
    }
    priority(e) {
      let n = this._keyIndices[e];
      if (n !== void 0) return this._arr[n].priority;
    }
    min() {
      if (this.size() === 0) throw new Error("Queue underflow");
      return this._arr[0].key;
    }
    add(e, n) {
      let t = this._keyIndices, r = String(e);
      if (!(r in t)) {
        let o = this._arr, i = o.length;
        return t[r] = i, o.push({ key: r, priority: n }), this._decrease(i), true;
      }
      return false;
    }
    removeMin() {
      if (this.size() === 0) throw new Error("Queue underflow");
      this._swap(0, this._arr.length - 1);
      let e = this._arr.pop();
      return delete this._keyIndices[e.key], this._heapify(0), e.key;
    }
    decrease(e, n) {
      let t = this._keyIndices[e];
      if (t === void 0) throw new Error(`Key not found: ${e}`);
      let r = this._arr[t].priority;
      if (n > r) throw new Error(`New priority is greater than current priority. Key: ${e} Old: ${r} New: ${n}`);
      this._arr[t].priority = n, this._decrease(t);
    }
    _heapify(e) {
      let n = this._arr, t = 2 * e, r = t + 1, o = e;
      t < n.length && (o = n[t].priority < n[o].priority ? t : o, r < n.length && (o = n[r].priority < n[o].priority ? r : o), o !== e && (this._swap(e, o), this._heapify(o)));
    }
    _decrease(e) {
      let n = this._arr, t = n[e].priority, r;
      for (; e !== 0 && (r = e >> 1, !(n[r].priority < t)); ) this._swap(e, r), e = r;
    }
    _swap(e, n) {
      let t = this._arr, r = this._keyIndices, o = t[e], i = t[n];
      t[e] = i, t[n] = o, r[i.key] = e, r[o.key] = n;
    }
  };
  var zn = () => 1;
  function J(e, n, t, r) {
    let o = function(i) {
      var s;
      return (s = e.outEdges(i)) != null ? s : [];
    };
    return Hn(e, String(n), t || zn, r || o);
  }
  function Hn(e, n, t, r) {
    let o = {}, i = new Pe(), s, a, l = function(u) {
      let d = u.v !== s ? u.v : u.w, c = o[d];
      if (!c) return;
      let f = t(u), h = a.distance + f;
      if (f < 0) throw new Error("dijkstra does not allow negative edge weights. Bad edge: " + u + " Weight: " + f);
      h < c.distance && (c.distance = h, c.predecessor = s, i.decrease(d, h));
    };
    for (e.nodes().forEach(function(u) {
      let d = u === n ? 0 : Number.POSITIVE_INFINITY;
      o[u] = { distance: d, predecessor: "" }, i.add(u, d);
    }); i.size() > 0; ) {
      s = i.removeMin();
      let u = o[s];
      if (!u || u.distance === Number.POSITIVE_INFINITY) break;
      a = u, r(s).forEach(l);
    }
    return o;
  }
  function qn(e, n, t) {
    return e.nodes().reduce(function(r, o) {
      return r[o] = J(e, o, n, t), r;
    }, {});
  }
  function Fe(e) {
    let n = 0, t = [], r = {}, o = [];
    function i(s) {
      var a;
      let l = r[s] = { onStack: true, lowlink: n, index: n++ };
      if (t.push(s), (a = e.successors(s)) == null || a.forEach(function(u) {
        if (u in r) {
          let d = r[u];
          d != null && d.onStack && (l.lowlink = Math.min(l.lowlink, d.index));
        } else {
          i(u);
          let d = r[u];
          d && (l.lowlink = Math.min(l.lowlink, d.lowlink));
        }
      }), l.lowlink === l.index) {
        let u = [], d;
        do {
          d = t.pop();
          let c = r[d];
          c && (c.onStack = false), u.push(d);
        } while (s !== d);
        o.push(u);
      }
    }
    return e.nodes().forEach(function(s) {
      s in r || i(s);
    }), o;
  }
  function $n(e) {
    return Fe(e).filter(function(n) {
      var t;
      let r = n[0];
      return r ? n.length > 1 || n.length === 1 && ((t = e.outEdges(r, r)) != null ? t : []).length > 0 : false;
    });
  }
  var Un = () => 1;
  function Jn(e, n, t) {
    return Kn(e, n || Un, t || function(r) {
      var o;
      return (o = e.outEdges(r)) != null ? o : [];
    });
  }
  function Kn(e, n, t) {
    let r = {}, o = e.nodes();
    return o.forEach(function(i) {
      let s = {};
      r[i] = s, s[i] = { distance: 0, predecessor: "" }, o.forEach(function(a) {
        i !== a && (s[a] = { distance: Number.POSITIVE_INFINITY, predecessor: "" });
      }), t(i).forEach(function(a) {
        let l = a.v === i ? a.w : a.v, u = n(a);
        s[l] = { distance: u, predecessor: i };
      });
    }), o.forEach(function(i) {
      let s = r[i];
      s && o.forEach(function(a) {
        let l = r[a];
        l && o.forEach(function(u) {
          let d = l[i], c = s[u], f = l[u];
          if (d && c && f) {
            let h = d.distance + c.distance;
            h < f.distance && (f.distance = h, f.predecessor = c.predecessor);
          }
        });
      });
    }), r;
  }
  var K = class extends Error {
    constructor(e) {
      super(e), this.name = "CycleException";
    }
  };
  function Ae(e) {
    let n = {}, t = {}, r = [];
    function o(i) {
      var s;
      if (i in t) throw new K();
      i in n || (t[i] = true, n[i] = true, (s = e.predecessors(i)) == null || s.forEach(o), delete t[i], r.push(i));
    }
    if (e.sinks().forEach(o), Object.keys(n).length !== e.nodeCount()) throw new K();
    return r;
  }
  function Qn(e) {
    try {
      Ae(e);
    } catch (n) {
      if (n instanceof K) return false;
      throw n;
    }
    return true;
  }
  function Zn(e, n, t, r, o) {
    Array.isArray(n) || (n = [n]);
    let i = ((a) => {
      var l;
      return (l = e.isDirected() ? e.successors(a) : e.neighbors(a)) != null ? l : [];
    }), s = {};
    return n.forEach(function(a) {
      if (!e.hasNode(a)) throw new Error("Graph does not have node: " + a);
      o = Ve(e, a, t === "post", s, i, r, o);
    }), o;
  }
  function Ve(e, n, t, r, o, i, s) {
    return n in r || (r[n] = true, t || (s = i(s, n)), o(n).forEach(function(a) {
      s = Ve(e, a, t, r, o, i, s);
    }), t && (s = i(s, n))), s;
  }
  function De(e, n, t) {
    return Zn(e, n, t, function(r, o) {
      return r.push(o), r;
    }, []);
  }
  function et(e, n) {
    return De(e, n, "post");
  }
  function nt(e, n) {
    return De(e, n, "pre");
  }
  function tt(e, n) {
    var t;
    let r = new Q(), o = {}, i = new Pe(), s;
    function a(d) {
      let c = d.v === s ? d.w : d.v, f = i.priority(c);
      if (f !== void 0) {
        let h = n(d);
        h < f && (o[c] = s, i.decrease(c, h));
      }
    }
    if (e.nodeCount() === 0) return r;
    e.nodes().forEach(function(d) {
      i.add(d, Number.POSITIVE_INFINITY), r.setNode(d);
    });
    let l = e.nodes()[0];
    l !== void 0 && i.decrease(l, 0);
    let u = false;
    for (; i.size() > 0; ) {
      if (s = i.removeMin(), s in o) r.setEdge(s, o[s]);
      else {
        if (u) throw new Error("Input graph is not connected: " + e);
        u = true;
      }
      (t = e.nodeEdges(s)) == null || t.forEach(a);
    }
    return r;
  }
  function rt(e, n, t, r) {
    return ot(e, n, t, r != null ? r : ((o) => {
      var i;
      return (i = e.outEdges(o)) != null ? i : [];
    }));
  }
  function ot(e, n, t, r) {
    if (t === void 0) return J(e, n, t, r);
    let o = false, i = e.nodes();
    for (let s = 0; s < i.length; s++) {
      let a = i[s];
      if (a === void 0) continue;
      let l = r(a);
      for (let u = 0; u < l.length; u++) {
        let d = l[u];
        if (!d) continue;
        let c = d.v === a ? d.v : d.w, f = c === d.v ? d.w : d.v;
        t({ v: c, w: f }) < 0 && (o = true);
      }
      if (o) return Me(e, n, t, r);
    }
    return J(e, n, t, r);
  }
  var T = Q;
  function M(e, n, t, r) {
    let o = r;
    for (; e.hasNode(o); ) o = $(r);
    return t.dummy = n, e.setNode(o, t), o;
  }
  function Ye(e) {
    let n = new T().setGraph(e.graph());
    return e.nodes().forEach((t) => n.setNode(t, e.node(t))), e.edges().forEach((t) => {
      let r = n.edge(t.v, t.w) || { weight: 0, minlen: 1 }, o = e.edge(t);
      n.setEdge(t.v, t.w, { weight: r.weight + o.weight, minlen: Math.max(r.minlen, o.minlen) });
    }), n;
  }
  function Z(e) {
    let n = new T({ multigraph: e.isMultigraph() }).setGraph(e.graph());
    return e.nodes().forEach((t) => {
      e.children(t).length || n.setNode(t, e.node(t));
    }), e.edges().forEach((t) => {
      n.setEdge(t, e.edge(t));
    }), n;
  }
  function se(e, n) {
    let t = e.x, r = e.y, o = n.x - t, i = n.y - r, s = e.width / 2, a = e.height / 2;
    if (!o && !i) throw new Error("Not possible to find intersection inside of the rectangle");
    let l, u;
    return Math.abs(i) * s > Math.abs(o) * a ? (i < 0 && (a = -a), l = a * o / i, u = a) : (o < 0 && (s = -s), l = s, u = s * i / o), { x: t + l, y: r + u };
  }
  function P(e) {
    let n = A(de(e) + 1).map(() => []);
    return e.nodes().forEach((t) => {
      let r = e.node(t), o = r.rank;
      o !== void 0 && (n[o] || (n[o] = []), n[o][r.order] = t);
    }), n;
  }
  function We(e) {
    let n = e.nodes().map((r) => {
      let o = e.node(r).rank;
      return o === void 0 ? Number.MAX_VALUE : o;
    }), t = R(Math.min, n);
    e.nodes().forEach((r) => {
      let o = e.node(r);
      Object.hasOwn(o, "rank") && (o.rank -= t);
    });
  }
  function Be(e) {
    let n = e.nodes().map((s) => e.node(s).rank).filter((s) => s !== void 0), t = R(Math.min, n), r = [];
    e.nodes().forEach((s) => {
      let a = e.node(s).rank - t;
      r[a] || (r[a] = []), r[a].push(s);
    });
    let o = 0, i = e.graph().nodeRankFactor;
    Array.from(r).forEach((s, a) => {
      s === void 0 && a % i !== 0 ? --o : s !== void 0 && o && s.forEach((l) => e.node(l).rank += o);
    });
  }
  function ae(e, n, t, r) {
    let o = { width: 0, height: 0 };
    return arguments.length >= 4 && (o.rank = t, o.order = r), M(e, "border", o, n);
  }
  function it(e, n = Xe) {
    let t = [];
    for (let r = 0; r < e.length; r += n) {
      let o = e.slice(r, r + n);
      t.push(o);
    }
    return t;
  }
  var Xe = 65535;
  function R(e, n) {
    if (n.length > Xe) {
      let t = it(n);
      return e(...t.map((r) => e(...r)));
    } else return e(...n);
  }
  function de(e) {
    let t = e.nodes().map((r) => {
      let o = e.node(r).rank;
      return o === void 0 ? Number.MIN_VALUE : o;
    });
    return R(Math.max, t);
  }
  function ze(e, n) {
    let t = { lhs: [], rhs: [] };
    return e.forEach((r) => {
      n(r) ? t.lhs.push(r) : t.rhs.push(r);
    }), t;
  }
  function le(e, n) {
    let t = Date.now();
    try {
      return n();
    } finally {
      console.log(e + " time: " + (Date.now() - t) + "ms");
    }
  }
  function q(e, n) {
    return n();
  }
  var st = 0;
  function $(e) {
    let n = ++st;
    return e + ("" + n);
  }
  function A(e, n, t = 1) {
    n == null && (n = e, e = 0);
    let r = (i) => i < n;
    t < 0 && (r = (i) => n < i);
    let o = [];
    for (let i = e; r(i); i += t) o.push(i);
    return o;
  }
  function B(e, n) {
    let t = {};
    for (let r of n) e[r] !== void 0 && (t[r] = e[r]);
    return t;
  }
  function X(e, n) {
    let t;
    return typeof n == "string" ? t = (r) => r[n] : t = n, Object.entries(e).reduce((r, [o, i]) => (r[o] = t(i, o), r), {});
  }
  function He(e, n) {
    return e.reduce((t, r, o) => (t[r] = n[o], t), {});
  }
  var D = "\0";
  function ee(e, n, t) {
    var u, d, c, f, h, p;
    if (!(e && n && t && n.dummy === "edge" && t.dummy === "edge" && n.edgeObj && t.edgeObj && e[n.edgeObj.v] && e[t.edgeObj.v] && e[n.edgeObj.w] && e[t.edgeObj.w])) return 0;
    let r = true;
    n.edgeObj.w === t.edgeObj.w && (r = false);
    let o = r ? (d = (u = e[n.edgeObj.v]) == null ? void 0 : u.rank) != null ? d : NaN + 1 : (f = (c = e[n.edgeObj.w]) == null ? void 0 : c.rank) != null ? f : NaN - 1, i = Object.entries(e).find((E) => {
      var y, L;
      return ((y = E[1].edgeObj) == null ? void 0 : y.v) === n.edgeObj.v && ((L = E[1].edgeObj) == null ? void 0 : L.w) === n.edgeObj.w && E[1].rank === o;
    }), s = Object.entries(e).find((E) => {
      var y, L;
      return ((y = E[1].edgeObj) == null ? void 0 : y.v) === t.edgeObj.v && ((L = E[1].edgeObj) == null ? void 0 : L.w) === t.edgeObj.w && E[1].rank === o;
    });
    if (!i || !s) return 0;
    let a = (h = i[1].order) != null ? h : NaN, l = (p = s[1].order) != null ? p : NaN;
    return isNaN(a - l) ? 0 : a - l;
  }
  var ue = "3.1.1";
  var ce = class {
    constructor() {
      je(this, "_sentinel");
      let n = {};
      n._next = n._prev = n, this._sentinel = n;
    }
    dequeue() {
      let n = this._sentinel, t = n._prev;
      if (t !== n) return qe(t), t;
    }
    enqueue(n) {
      let t = this._sentinel;
      n._prev && n._next && qe(n), n._next = t._next, t._next._prev = n, t._next = n, n._prev = t;
    }
    toString() {
      let n = [], t = this._sentinel, r = t._prev;
      for (; r !== t; ) n.push(JSON.stringify(r, at)), r = r._prev;
      return "[" + n.join(", ") + "]";
    }
  };
  function qe(e) {
    e._prev._next = e._next, e._next._prev = e._prev, delete e._next, delete e._prev;
  }
  function at(e, n) {
    if (e !== "_next" && e !== "_prev") return n;
  }
  var $e = ce;
  var dt = () => 1;
  function be(e, n) {
    if (e.nodeCount() <= 1) return [];
    let t = ut(e, n || dt);
    return lt(t.graph, t.buckets, t.zeroIdx).flatMap((o) => e.outEdges(o.v, o.w) || []);
  }
  function lt(e, n, t) {
    var a;
    let r = [], o = n[n.length - 1], i = n[0], s;
    for (; e.nodeCount(); ) {
      for (; s = i.dequeue(); ) fe(e, n, t, s);
      for (; s = o.dequeue(); ) fe(e, n, t, s);
      if (e.nodeCount()) {
        for (let l = n.length - 2; l > 0; --l) if (s = (a = n[l]) == null ? void 0 : a.dequeue(), s) {
          r = r.concat(fe(e, n, t, s, true) || []);
          break;
        }
      }
    }
    return r;
  }
  function fe(e, n, t, r, o) {
    let i = [], s = o ? i : void 0;
    return (e.inEdges(r.v) || []).forEach((a) => {
      let l = e.edge(a), u = e.node(a.v);
      o && i.push({ v: a.v, w: a.w }), u.out -= l, he(n, t, u);
    }), (e.outEdges(r.v) || []).forEach((a) => {
      let l = e.edge(a), u = a.w, d = e.node(u);
      d.in -= l, he(n, t, d);
    }), e.removeNode(r.v), s;
  }
  function ut(e, n) {
    let t = new T(), r = 0, o = 0;
    e.nodes().forEach((a) => {
      t.setNode(a, { v: a, in: 0, out: 0 });
    }), e.edges().forEach((a) => {
      let l = t.edge(a.v, a.w) || 0, u = n(a), d = l + u;
      t.setEdge(a.v, a.w, d);
      let c = t.node(a.v), f = t.node(a.w);
      o = Math.max(o, c.out += u), r = Math.max(r, f.in += u);
    });
    let i = ct(o + r + 3).map(() => new $e()), s = r + 1;
    return t.nodes().forEach((a) => {
      he(i, s, t.node(a));
    }), { graph: t, buckets: i, zeroIdx: s };
  }
  function he(e, n, t) {
    var r, o, i;
    t.out ? t.in ? (i = e[t.out - t.in + n]) == null || i.enqueue(t) : (o = e[e.length - 1]) == null || o.enqueue(t) : (r = e[0]) == null || r.enqueue(t);
  }
  function ct(e) {
    let n = [];
    for (let t = 0; t < e; t++) n.push(t);
    return n;
  }
  function Ue(e, n) {
    (e.graph().acyclicer === "greedy" ? be(e, r(e)) : ft(e, n != null ? n : null)).forEach((o) => {
      let i = e.edge(o);
      e.removeEdge(o), i.forwardName = o.name, i.reversed = true, e.setEdge(o.w, o.v, i, $("rev"));
    });
    function r(o) {
      return (i) => o.edge(i).weight;
    }
  }
  function ft(e, n) {
    let t = [], r = {}, o = {};
    function i(l) {
      Object.hasOwn(o, l) || (o[l] = true, r[l] = true, e.outEdges(l).forEach((u) => {
        Object.hasOwn(r, u.w) ? t.push(u) : i(u.w);
      }), delete r[l]);
    }
    function s(l) {
      var u;
      Object.hasOwn(o, l) || (o[l] = true, r[l] = true, (u = e.outEdges(l)) == null || u.forEach((d) => {
        var c, f;
        Object.hasOwn(r, d.w) || ((c = n.node(l)) == null ? void 0 : c.rank) > ((f = n.node(d.w)) == null ? void 0 : f.rank) && ht(e, d.w, d) ? t.push(d) : s(d.w);
      }), delete r[l]);
    }
    let a = i;
    return n && typeof n.node == "function" && (a = s), e.sources().forEach(a), e.nodes().forEach(a), t;
  }
  function Je(e) {
    e.edges().forEach((n) => {
      let t = e.edge(n);
      if (t.reversed) {
        e.removeEdge(n);
        let r = t.forwardName;
        delete t.reversed, delete t.forwardName, e.setEdge(n.w, n.v, t, r);
      }
    });
  }
  function ht(e, n, t) {
    let r = /* @__PURE__ */ new Set();
    function o(i) {
      var s;
      if (e.sources().includes(i)) return true;
      r.add(i);
      for (let a of (s = e.inEdges(i)) != null ? s : []) if (!(a.v === t.v && a.w === t.w) && !r.has(a.v) && o(a.v)) return true;
      return false;
    }
    return o(n);
  }
  function Ke(e) {
    e.graph().dummyChains = [], e.edges().forEach((n) => gt(e, n));
  }
  function gt(e, n) {
    let t = n.v, r = e.node(t).rank, o = n.w, i = e.node(o).rank, s = n.name, a = e.edge(n), l = a.labelRank;
    if (i === r + 1) return;
    e.removeEdge(n);
    let u, d, c;
    for (c = 0, ++r; r < i; ++c, ++r) a.points = [], d = { width: 0, height: 0, edgeLabel: a, edgeObj: n, rank: r }, u = M(e, "edge", d, "_d"), r === l && (d.width = a.width, d.height = a.height, d.dummy = "edge-label", d.labelpos = a.labelpos), e.setEdge(t, u, { weight: a.weight }, s), c === 0 && e.graph().dummyChains.push(u), t = u;
    e.setEdge(t, o, { weight: a.weight }, s);
  }
  function Qe(e) {
    e.graph().dummyChains.forEach((n) => {
      let t = e.node(n), r = t.edgeLabel, o;
      for (e.setEdge(t.edgeObj, r); t.dummy; ) o = e.successors(n)[0], e.removeNode(n), r.points.push({ x: t.x, y: t.y }), t.dummy === "edge-label" && (r.x = t.x, r.y = t.y, r.width = t.width, r.height = t.height), n = o, t = e.node(n);
    });
  }
  function U(e) {
    let n = {};
    function t(r) {
      let o = e.node(r);
      if (Object.hasOwn(n, r)) return o.rank;
      n[r] = true;
      let i = e.outEdges(r), s = i ? i.map((l) => l == null ? Number.POSITIVE_INFINITY : t(l.w) - e.edge(l).minlen) : [], a = R(Math.min, s);
      return a === Number.POSITIVE_INFINITY && (a = 0), o.rank = a;
    }
    e.sources().forEach(t);
  }
  function V(e, n) {
    return e.node(n.w).rank - e.node(n.v).rank - e.edge(n).minlen;
  }
  var ne = mt;
  function mt(e) {
    let n = new T({ directed: false }), t = e.nodes();
    if (t.length === 0) throw new Error("Graph must have at least one node");
    let r = t[0], o = e.nodeCount();
    n.setNode(r, {});
    let i, s;
    for (; Et(n, e) < o && (i = Lt(n, e), !!i); ) s = n.hasNode(i.v) ? V(e, i) : -V(e, i), yt(n, e, s);
    return n;
  }
  function Et(e, n) {
    function t(r) {
      let o = n.nodeEdges(r);
      o && o.forEach((i) => {
        let s = i.v, a = r === s ? i.w : s;
        !e.hasNode(a) && !V(n, i) && (e.setNode(a, {}), e.setEdge(r, a, {}), t(a));
      });
    }
    return e.nodes().forEach(t), e.nodeCount();
  }
  function Lt(e, n) {
    return n.edges().reduce((r, o) => {
      let i = Number.POSITIVE_INFINITY;
      return e.hasNode(o.v) !== e.hasNode(o.w) && (i = V(n, o)), i < r[0] ? [i, o] : r;
    }, [Number.POSITIVE_INFINITY, null])[1];
  }
  function yt(e, n, t) {
    e.nodes().forEach((r) => n.node(r).rank += t);
  }
  var { preorder: wt, postorder: Nt } = H;
  var en = Y;
  Y.initLowLimValues = pe;
  Y.initCutValues = ge;
  Y.calcCutValue = nn;
  Y.leaveEdge = rn;
  Y.enterEdge = on;
  Y.exchangeEdges = sn;
  function Y(e) {
    e = Ye(e), U(e);
    let n = ne(e);
    pe(n), ge(n, e);
    let t, r;
    for (; t = rn(n); ) r = on(n, e, t), sn(n, e, t, r);
  }
  function ge(e, n) {
    let t = Nt(e, e.nodes());
    t = t.slice(0, t.length - 1), t.forEach((r) => Gt(e, n, r));
  }
  function Gt(e, n, t) {
    let o = e.node(t).parent, i = e.edge(t, o);
    i.cutvalue = nn(e, n, t);
  }
  function nn(e, n, t) {
    let o = e.node(t).parent, i = true, s = n.edge(t, o), a = 0;
    s || (i = false, s = n.edge(o, t)), a = s.weight;
    let l = n.nodeEdges(t);
    return l && l.forEach((u) => {
      let d = u.v === t, c = d ? u.w : u.v;
      if (c !== o) {
        let f = d === i, h = n.edge(u).weight;
        if (a += f ? h : -h, kt(e, t, c)) {
          let E = e.edge(t, c).cutvalue;
          a += f ? -E : E;
        }
      }
    }), a;
  }
  function pe(e, n) {
    arguments.length < 2 && (n = e.nodes()[0]), tn(e, {}, 1, n);
  }
  function tn(e, n, t, r, o) {
    let i = t, s = e.node(r);
    n[r] = true;
    let a = e.neighbors(r);
    return a && a.forEach((l) => {
      Object.hasOwn(n, l) || (t = tn(e, n, t, l, r));
    }), s.low = i, s.lim = t++, o ? s.parent = o : delete s.parent, t;
  }
  function rn(e) {
    return e.edges().find((n) => e.edge(n).cutvalue < 0);
  }
  function on(e, n, t) {
    let r = t.v, o = t.w;
    n.hasEdge(r, o) || (r = t.w, o = t.v);
    let i = e.node(r), s = e.node(o), a = i, l = false;
    return i.lim > s.lim && (a = s, l = true), n.edges().filter((d) => l === Ze(e, e.node(d.v), a) && l !== Ze(e, e.node(d.w), a)).reduce((d, c) => V(n, c) < V(n, d) ? c : d);
  }
  function sn(e, n, t, r) {
    let o = t.v, i = t.w;
    e.removeEdge(o, i), e.setEdge(r.v, r.w, {}), pe(e), ge(e, n), vt(e, n);
  }
  function vt(e, n) {
    let t = e.nodes().find((o) => !e.node(o).parent);
    if (!t) return;
    let r = wt(e, [t]);
    r = r.slice(1), r.forEach((o) => {
      let s = e.node(o).parent, a = n.edge(o, s), l = false;
      a || (a = n.edge(s, o), l = true), n.node(o).rank = n.node(s).rank + (l ? a.minlen : -a.minlen);
    });
  }
  function kt(e, n, t) {
    return e.hasEdge(n, t);
  }
  function Ze(e, n, t) {
    return t.low <= n.lim && n.lim <= t.lim;
  }
  var dn = xt;
  function xt(e) {
    let n = e.graph().ranker;
    if (typeof n == "function") return n(e);
    switch (n) {
      case "network-simplex":
        an(e);
        break;
      case "tight-tree":
        Ot(e);
        break;
      case "longest-path":
        _t(e);
        break;
      case "none":
        break;
      default:
        an(e);
    }
  }
  var _t = U;
  function Ot(e) {
    U(e), ne(e);
  }
  function an(e) {
    en(e);
  }
  var ln = Ct;
  function Ct(e) {
    let n = jt(e), t = e.graph();
    if (!Array.isArray(t.dummyChains)) return;
    t.dummyChains.forEach((o) => {
      let i = e.node(o), s = i.edgeObj, a = Tt(e, n, s.v, s.w), l = a.path, u = a.lca, d = 0, c = l[d], f = true;
      for (; o !== s.w; ) {
        if (i = e.node(o), f) {
          for (; (c = l[d]) !== u && e.node(c).maxRank < i.rank; ) d++;
          c === u && (f = false);
        }
        if (!f) {
          for (; d < l.length - 1 && e.node(l[d + 1]).minRank <= i.rank; ) d++;
          c = l[d];
        }
        c !== void 0 && e.setParent(o, c), o = e.successors(o)[0];
      }
    });
  }
  function Tt(e, n, t, r) {
    let o = [], i = [], s = Math.min(n[t].low, n[r].low), a = Math.max(n[t].lim, n[r].lim), l;
    l = t;
    do
      l = e.parent(l), o.push(l);
    while (l && (n[l].low > s || a > n[l].lim));
    let u = l, d = r;
    for (; (d = e.parent(d)) !== u; ) i.push(d);
    return { path: o.concat(i.reverse()), lca: u };
  }
  function jt(e) {
    let n = {}, t = 0;
    function r(o) {
      let i = t;
      e.children(o).forEach(r), n[o] = { low: i, lim: t++ };
    }
    return e.children(D).forEach(r), n;
  }
  function un(e) {
    let n = M(e, "root", {}, "_root"), t = Rt(e), r = Object.values(t), o = R(Math.max, r) - 1, i = 2 * o + 1;
    e.graph().nestingRoot = n, e.edges().forEach((a) => e.edge(a).minlen *= i);
    let s = It(e) + 1;
    e.children(D).forEach((a) => {
      cn(e, n, i, s, o, t, a);
    }), e.graph().nodeRankFactor = i;
  }
  function cn(e, n, t, r, o, i, s) {
    var c;
    let a = e.children(s);
    if (!a.length) {
      s !== n && e.setEdge(n, s, { weight: 0, minlen: t });
      return;
    }
    let l = ae(e, "_bt"), u = ae(e, "_bb"), d = e.node(s);
    e.setParent(l, s), d.borderTop = l, e.setParent(u, s), d.borderBottom = u, a.forEach((f) => {
      var b;
      cn(e, n, t, r, o, i, f);
      let h = e.node(f), p = h.borderTop ? h.borderTop : f, E = h.borderBottom ? h.borderBottom : f, y = h.borderTop ? r : 2 * r, L = p !== E ? 1 : o - ((b = i[s]) != null ? b : 0) + 1;
      e.setEdge(l, p, { weight: y, minlen: L, nestingEdge: true }), e.setEdge(E, u, { weight: y, minlen: L, nestingEdge: true });
    }), e.parent(s) || e.setEdge(n, l, { weight: 0, minlen: o + ((c = i[s]) != null ? c : 0) });
  }
  function Rt(e) {
    let n = {};
    function t(r, o) {
      let i = e.children(r);
      i && i.length && i.forEach((s) => t(s, o + 1)), n[r] = o;
    }
    return e.children(D).forEach((r) => t(r, 1)), n;
  }
  function It(e) {
    return e.edges().reduce((n, t) => n + e.edge(t).weight, 0);
  }
  function fn(e) {
    let n = e.graph();
    e.removeNode(n.nestingRoot), delete n.nestingRoot, e.edges().forEach((t) => {
      e.edge(t).nestingEdge && e.removeEdge(t);
    });
  }
  var bn = Mt;
  function Mt(e) {
    function n(t) {
      let r = e.children(t), o = e.node(t);
      if (r.length && r.forEach(n), o && Object.hasOwn(o, "minRank")) {
        o.borderLeft = [], o.borderRight = [];
        for (let i = o.minRank, s = o.maxRank + 1; i < s; ++i) hn(e, "borderLeft", "_bl", t, o, i), hn(e, "borderRight", "_br", t, o, i);
      }
    }
    e.children(D).forEach(n);
  }
  function hn(e, n, t, r, o, i) {
    let s = { width: 0, height: 0, rank: i, borderType: n }, a = o[n][i - 1], l = M(e, "border", s, t);
    o[n][i] = l, e.setParent(l, r), a && e.setEdge(a, l, { weight: 1 });
  }
  function pn(e) {
    var t;
    let n = (t = e.graph().rankdir) == null ? void 0 : t.toLowerCase();
    (n === "lr" || n === "rl") && En(e);
  }
  function mn(e) {
    var t;
    let n = (t = e.graph().rankdir) == null ? void 0 : t.toLowerCase();
    (n === "bt" || n === "rl") && Pt(e), (n === "lr" || n === "rl") && (Ft(e), En(e));
  }
  function En(e) {
    e.nodes().forEach((n) => gn(e.node(n))), e.edges().forEach((n) => gn(e.edge(n)));
  }
  function gn(e) {
    let n = e.width;
    e.width = e.height, e.height = n;
  }
  function Pt(e) {
    e.nodes().forEach((n) => me(e.node(n))), e.edges().forEach((n) => {
      var r;
      let t = e.edge(n);
      (r = t.points) == null || r.forEach(me), Object.hasOwn(t, "y") && me(t);
    });
  }
  function me(e) {
    e.y = -e.y;
  }
  function Ft(e) {
    e.nodes().forEach((n) => Ee(e.node(n))), e.edges().forEach((n) => {
      var r;
      let t = e.edge(n);
      (r = t.points) == null || r.forEach(Ee), Object.hasOwn(t, "x") && Ee(t);
    });
  }
  function Ee(e) {
    let n = e.x;
    e.x = e.y, e.y = n;
  }
  function Le(e, n = null) {
    let t = {}, r = e.nodes().filter((d) => !e.children(d).length), o = r.map((d) => e.node(d).rank), i = R(Math.max, o), s = A(i + 1).map(() => []);
    function a(d) {
      if (t[d]) return;
      t[d] = true;
      let c = e.node(d);
      s[c.rank].push(d);
      let f = e.successors(d);
      f && [...f].sort((p, E) => u(p, E)).forEach(a);
    }
    r.sort((d, c) => e.node(d).rank - e.node(c).rank).forEach(a);
    function u(d, c) {
      let f = e.node(d), h = e.node(c);
      return ee(n, f, h);
    }
    return s;
  }
  function ye(e, n) {
    let t = 0;
    for (let r = 1; r < n.length; ++r) t += Vt(e, n[r - 1], n[r]);
    return t;
  }
  function Vt(e, n, t) {
    let r = He(t, t.map((u, d) => d)), o = n.flatMap((u) => {
      let d = e.outEdges(u);
      return d ? d.map((c) => ({ pos: r[c.w], weight: e.edge(c).weight })).sort((c, f) => c.pos - f.pos) : [];
    }), i = 1;
    for (; i < t.length; ) i <<= 1;
    let s = 2 * i - 1;
    i -= 1;
    let a = new Array(s).fill(0), l = 0;
    return o.forEach((u) => {
      let d = u.pos + i;
      a[d] += u.weight;
      let c = 0;
      for (; d > 0; ) d % 2 && (c += a[d + 1]), d = d - 1 >> 1, a[d] += u.weight;
      l += u.weight * c;
    }), l;
  }
  function we(e, n = []) {
    return n.map((t) => {
      let r = e.inEdges(t);
      if (!r || !r.length) return { v: t };
      {
        let o = r.reduce((i, s) => {
          let a = e.edge(s), l = e.node(s.v);
          return { sum: i.sum + a.weight * l.order, weight: i.weight + a.weight };
        }, { sum: 0, weight: 0 });
        return { v: t, barycenter: o.sum / o.weight, weight: o.weight };
      }
    });
  }
  function Ne(e, n) {
    let t = {};
    e.forEach((o, i) => {
      let s = { indegree: 0, in: [], out: [], vs: [o.v], i };
      o.barycenter !== void 0 && (s.barycenter = o.barycenter, s.weight = o.weight), t[o.v] = s;
    }), n.edges().forEach((o) => {
      let i = t[o.v], s = t[o.w];
      i !== void 0 && s !== void 0 && (s.indegree++, i.out.push(s));
    });
    let r = Object.values(t).filter((o) => !o.indegree);
    return Dt(r);
  }
  function Dt(e) {
    let n = [];
    function t(o) {
      return (i) => {
        i.merged || (i.barycenter === void 0 || o.barycenter === void 0 || i.barycenter >= o.barycenter) && Yt(o, i);
      };
    }
    function r(o) {
      return (i) => {
        i.in.push(o), --i.indegree === 0 && e.push(i);
      };
    }
    for (; e.length; ) {
      let o = e.pop();
      n.push(o), o.in.reverse().forEach(t(o)), o.out.forEach(r(o));
    }
    return n.filter((o) => !o.merged).map((o) => B(o, ["vs", "i", "barycenter", "weight"]));
  }
  function Yt(e, n) {
    let t = 0, r = 0;
    e.weight && (t += e.barycenter * e.weight, r += e.weight), n.weight && (t += n.barycenter * n.weight, r += n.weight), e.vs = n.vs.concat(e.vs), e.barycenter = t / r, e.weight = r, e.i = Math.min(n.i, e.i), n.merged = true;
  }
  function Ge(e, n, t, r, o) {
    let i = {}, s = null, a = null, l = o;
    typeof n == "boolean" ? (l = n, i = {}) : n && (i = n, s = t != null ? t : null, a = r != null ? r : null);
    let u = ze(e, (L) => Object.hasOwn(L, "barycenter")), d = u.lhs, c = u.rhs.sort((L, b) => b.i - L.i), f = [], h = 0, p = 0, E = 0;
    d.sort(Wt(a, s, !!l));
    for (let [L, b] of Object.entries(i)) {
      let g = d.findIndex((m) => m.vs[0] === L);
      d.splice(g + 1, 0, b);
    }
    E = Ln(f, c, E), d.forEach((L) => {
      E += L.vs.length, f.push(L.vs), h += L.barycenter * L.weight, p += L.weight, E = Ln(f, c, E);
    });
    let y = { vs: f.flat(1) };
    return p && (y.barycenter = h / p, y.weight = p), y;
  }
  function Ln(e, n, t) {
    let r;
    for (; n.length && (r = n[n.length - 1]).i <= t; ) n.pop(), e.push(r.vs), t++;
    return t;
  }
  function Wt(e, n, t) {
    return (r, o) => {
      if (r.barycenter < o.barycenter) return -1;
      if (r.barycenter > o.barycenter) return 1;
      if (e && (typeof r.vs[0] == "string" || typeof o.vs[0] == "string")) {
        let i = e.node(r.vs[0]), s = e.node(o.vs[0]), a = ee(n, i, s);
        if (a !== 0) return a;
      }
      return t ? o.i - r.i : r.i - o.i;
    };
  }
  function te(e, n, t, r, o) {
    var L, b, g, m, w, k, _, C, j, I, S;
    let i = null, s = o;
    typeof r == "boolean" ? (s = r, i = null) : r !== void 0 && (i = r);
    let a = e.children(n), l = e.node(n), u = l ? l.borderLeft : void 0, d = l ? l.borderRight : void 0, c = {};
    u && (a = a.filter((G) => G !== u && G !== d));
    let f = we(e, a);
    f.forEach((G) => {
      if (e.children(G.v).length) {
        let { result: x } = te(e, G.v, t, i, s);
        c[G.v] = x, Object.hasOwn(x, "barycenter") && Xt(G, x);
      }
    });
    let h = Ne(f, t);
    Bt(h, c);
    let p = {}, E = false;
    for (let G = 0; G < h.length; G++) for (let x = G + 1; x < h.length; x++) if (!(!h[G] || !h[x] || !((L = h[G]) != null && L.barycenter) || !((b = h[x]) != null && b.barycenter)) && ((g = h[G]) == null ? void 0 : g.barycenter) === h[x].barycenter) {
      let v = (w = (m = h[G]) == null ? void 0 : m.vs[0]) != null ? w : "", N = (_ = (k = h[x]) == null ? void 0 : k.vs[0]) != null ? _ : "", O = e.node(v), W = e.node(N);
      if (O.dummy === "edge" && W.dummy === "edge" && ((C = O.edgeObj) == null ? void 0 : C.v) === ((j = W.edgeObj) == null ? void 0 : j.v) && ((I = O.edgeObj) == null ? void 0 : I.w) === ((S = W.edgeObj) == null ? void 0 : S.w)) if (O.edgeLabel.reversed) {
        p[N] = h[G], h.splice(G, 1), G--;
        break;
      } else p[v] = h[x], h.splice(x, 1), x--;
      else E = true;
    }
    let y = Ge(h, p, i, e, s);
    if (u && d) {
      y.vs = [u, y.vs, d].flat(1);
      let G = e.predecessors(u);
      if (G && G.length) {
        let x = e.node(G[0]), v = e.predecessors(d), N = e.node(v[0]);
        Object.hasOwn(y, "barycenter") || (y.barycenter = 0, y.weight = 0), y.barycenter = (y.barycenter * y.weight + x.order + N.order) / (y.weight + 2), y.weight += 2;
      }
    }
    return Object.defineProperty(y, "result", { value: y, enumerable: false, configurable: true, writable: true }), Object.defineProperty(y, "usedBias", { value: E, enumerable: false, configurable: true, writable: true }), y;
  }
  function Bt(e, n) {
    e.forEach((t) => {
      t.vs = t.vs.flatMap((r) => n[r] ? n[r].vs : r);
    });
  }
  function Xt(e, n) {
    e.barycenter !== void 0 ? (e.barycenter = (e.barycenter * e.weight + n.barycenter * n.weight) / (e.weight + n.weight), e.weight += n.weight) : (e.barycenter = n.barycenter, e.weight = n.weight);
  }
  function ve(e, n, t, r) {
    r || (r = e.nodes());
    let o = zt(e), i = new T({ compound: true }).setGraph({ root: o }).setDefaultNodeLabel((s) => e.node(s));
    return r.forEach((s) => {
      let a = e.node(s), l = e.parent(s);
      if (a.rank === n || a.minRank <= n && n <= a.maxRank) {
        i.setNode(s), i.setParent(s, l || o);
        let u = e[t](s);
        u && u.forEach((d) => {
          let c = d.v === s ? d.w : d.v, f = i.edge(c, s), h = f !== void 0 ? f.weight : 0;
          i.setEdge(c, s, { weight: e.edge(d).weight + h });
        }), Object.hasOwn(a, "minRank") && i.setNode(s, { borderLeft: a.borderLeft[n], borderRight: a.borderRight[n] });
      }
    }), i;
  }
  function zt(e) {
    let n;
    for (; e.hasNode(n = $("_root")); ) ;
    return n;
  }
  function ke(e, n, t) {
    let r = {}, o;
    t.forEach((i) => {
      let s = e.parent(i), a, l;
      for (; s; ) {
        if (a = e.parent(s), a ? (l = r[a], r[a] = s) : (l = o, o = s), l && l !== s) {
          n.setEdge(l, s);
          return;
        }
        s = a;
      }
    });
  }
  function re(e, n = {}, t = null) {
    if (typeof n.customOrder == "function") {
      n.customOrder(e, re);
      return;
    }
    let r = de(e), o = yn(e, A(1, r + 1), "inEdges"), i = yn(e, A(r - 1, -1, -1), "outEdges"), s = Le(e, t);
    if (wn(e, s), n.disableOptimalOrderHeuristic) return;
    let a = Number.POSITIVE_INFINITY, l, u = n.constraints || [];
    for (let d = 0, c = 0; c < 4; ++d, ++c) {
      Ht(d % 2 ? o : i, d % 4 >= 2, u, t), s = P(e);
      let f = ye(e, s);
      f < a ? (c = 0, l = Object.assign({}, s), a = f) : f === a && (l = structuredClone(s));
    }
    wn(e, l);
  }
  function yn(e, n, t) {
    let r = /* @__PURE__ */ new Map(), o = (i, s) => {
      r.has(i) || r.set(i, []), r.get(i).push(s);
    };
    for (let i of e.nodes()) {
      let s = e.node(i);
      if (typeof s.rank == "number" && o(s.rank, i), typeof s.minRank == "number" && typeof s.maxRank == "number") for (let a = s.minRank; a <= s.maxRank; a++) a !== s.rank && o(a, i);
    }
    return n.map(function(i) {
      return ve(e, i, t, r.get(i) || []);
    });
  }
  function Ht(e, n, t, r) {
    let o = true, i = new T();
    e.forEach(function(s) {
      t.forEach((d) => i.setEdge(d.left, d.right));
      let a = s.graph().root, { result: l, usedBias: u } = te(s, a, i, r, o);
      n && u && (o = !o), l.vs.forEach((d, c) => s.node(d).order = c), ke(s, i, l.vs);
    });
  }
  function wn(e, n) {
    Object.values(n).forEach((t) => t.forEach((r, o) => e.node(r).order = o));
  }
  function qt(e, n) {
    let t = {};
    function r(o, i) {
      let s = 0, a = 0, l = o.length, u = i[i.length - 1];
      return i.forEach((d, c) => {
        let f = Ut(e, d), h = f ? e.node(f).order : l;
        (f || d === u) && (i.slice(a, c + 1).forEach((p) => {
          let E = e.predecessors(p);
          E && E.forEach((y) => {
            let L = e.node(y), b = L.order;
            (b < s || h < b) && !(L.dummy && e.node(p).dummy) && Gn(t, y, p);
          });
        }), a = c + 1, s = h);
      }), i;
    }
    return n.length && n.reduce(r), t;
  }
  function $t(e, n) {
    let t = {};
    function r(i, s, a, l, u) {
      A(s, a).forEach((d) => {
        let c = i[d];
        if (c !== void 0 && e.node(c).dummy) {
          let f = e.predecessors(c);
          f && f.forEach((h) => {
            if (h === void 0) return;
            let p = e.node(h);
            p.dummy && (p.order < l || p.order > u) && Gn(t, h, c);
          });
        }
      });
    }
    function o(i, s) {
      let a = -1, l = -1, u = 0;
      return s.forEach((d, c) => {
        if (e.node(d).dummy === "border") {
          let f = e.predecessors(d);
          if (f && f.length) {
            let h = f[0];
            if (h === void 0) return;
            l = e.node(h).order, r(s, u, c, a, l), u = c, a = l;
          }
        }
        r(s, u, s.length, l, i.length);
      }), s;
    }
    return n.length && n.reduce(o), t;
  }
  function Ut(e, n) {
    if (e.node(n).dummy) {
      let t = e.predecessors(n);
      if (t) return t.find((r) => e.node(r).dummy);
    }
  }
  function Gn(e, n, t) {
    if (n > t) {
      let o = n;
      n = t, t = o;
    }
    let r = e[n];
    r || (e[n] = r = {}), r[t] = true;
  }
  function Jt(e, n, t) {
    if (n > t) {
      let o = n;
      n = t, t = o;
    }
    let r = e[n];
    return r !== void 0 && Object.hasOwn(r, t);
  }
  function Kt(e, n, t, r, o) {
    let i = {}, s = {}, a = {};
    return n.forEach((l) => {
      l.forEach((u, d) => {
        i[u] = u, s[u] = u, a[u] = d;
      });
    }), n.forEach((l) => {
      let u = -1, d = -1, c = false, f = l, h = l.findIndex((p) => (o == null ? void 0 : o.includes(p)) || Nn(p, e, o));
      h > 0 && (f = [l[h], ...l.slice(0, h), ...l.slice(h + 1)], c = true), f.forEach((p) => {
        var y;
        let E = r(p);
        if (E && E.length) {
          o != null && o.includes(p) && (E = E.filter((g) => Nn(g, e, o)));
          let L = E.sort((g, m) => {
            let w = a[g], k = a[m];
            return (w !== void 0 ? w : 0) - (k !== void 0 ? k : 0);
          }), b = (L.length - 1) / 2;
          for (let g = Math.floor(b), m = Math.ceil(b); g <= m; ++g) {
            let w = L[g];
            if (w === void 0) continue;
            let k = a[w];
            if (k !== void 0 && s[p] === p && u < k && a[w] !== d && !Jt(t, p, w)) {
              let _ = i[w];
              _ !== void 0 && (s[w] = p, s[p] = i[p] = _, u = k, c && (u = -1, d = (y = a[w]) != null ? y : -1, c = false));
            }
          }
        }
      });
    }), { root: i, align: s };
  }
  function Qt(e, n, t, r, o = false) {
    let i = {}, s = Zt(e, n, t, o), a = o ? "borderLeft" : "borderRight";
    function l(h, p) {
      let E = s.nodes().slice(), y = {}, L = E.pop();
      for (; L; ) {
        if (y[L]) h(L);
        else {
          y[L] = true, E.push(L);
          for (let b of p(L)) E.push(b);
        }
        L = E.pop();
      }
    }
    function u(h) {
      let p = s.inEdges(h);
      p ? i[h] = p.reduce((E, y) => {
        var g;
        let L = (g = i[y.v]) != null ? g : 0, b = s.edge(y);
        return Math.max(E, L + (b !== void 0 ? b : 0));
      }, 0) : i[h] = 0;
    }
    function d(h) {
      let p = s.outEdges(h), E = Number.POSITIVE_INFINITY;
      p && (E = p.reduce((L, b) => {
        let g = i[b.w], m = s.edge(b);
        return Math.min(L, (g !== void 0 ? g : 0) - (m !== void 0 ? m : 0));
      }, Number.POSITIVE_INFINITY));
      let y = e.node(h);
      E !== Number.POSITIVE_INFINITY && y.borderType !== a && (i[h] = Math.max(i[h] !== void 0 ? i[h] : 0, E));
    }
    function c(h) {
      return s.predecessors(h) || [];
    }
    function f(h) {
      return s.successors(h) || [];
    }
    return l(u, c), l(d, f), Object.keys(r).forEach((h) => {
      var E;
      let p = t[h];
      p !== void 0 && (i[h] = (E = i[p]) != null ? E : 0);
    }), i;
  }
  function Zt(e, n, t, r) {
    let o = new T(), i = e.graph(), s = rr(i.nodesep, i.edgesep, r);
    return n.forEach((a) => {
      let l;
      a.forEach((u) => {
        let d = t[u];
        if (d !== void 0) {
          if (o.setNode(d), l !== void 0) {
            let c = t[l];
            if (c !== void 0) {
              let f = o.edge(c, d);
              o.setEdge(c, d, Math.max(s(e, u, l), f || 0));
            }
          }
          l = u;
        }
      });
    }), o;
  }
  function er(e, n) {
    return Object.values(n).reduce((t, r) => {
      let o = Number.NEGATIVE_INFINITY, i = Number.POSITIVE_INFINITY;
      Object.entries(r).forEach(([a, l]) => {
        let u = or(e, a) / 2;
        o = Math.max(l + u, o), i = Math.min(l - u, i);
      });
      let s = o - i;
      return s < t[0] && (t = [s, r]), t;
    }, [Number.POSITIVE_INFINITY, null])[1];
  }
  function nr(e, n) {
    let t = Object.values(n), r = R(Math.min, t), o = R(Math.max, t);
    ["u", "d"].forEach((i) => {
      ["l", "r"].forEach((s) => {
        let a = i + s, l = e[a];
        if (!l || l === n) return;
        let u = Object.values(l), d = r - R(Math.min, u);
        s !== "l" && (d = o - R(Math.max, u)), d && (e[a] = X(l, (c) => c + d));
      });
    });
  }
  function tr(e, n = void 0) {
    let t = e.ul;
    return t ? X(t, (r, o) => {
      var s, a;
      if (n) {
        let l = n.toLowerCase(), u = e[l];
        if (u && u[o] !== void 0) return u[o];
      }
      let i = Object.values(e).map((l) => {
        let u = l[o];
        return u !== void 0 ? u : 0;
      }).sort((l, u) => l - u);
      return (((s = i[1]) != null ? s : 0) + ((a = i[2]) != null ? a : 0)) / 2;
    }) : {};
  }
  function vn(e, n) {
    let t = P(e), r = Object.assign(qt(e, t), $t(e, t)), o = {}, i;
    ["u", "d"].forEach((a) => {
      i = a === "u" ? t : Object.values(t).reverse(), ["l", "r"].forEach((l) => {
        l === "r" && (i = i.map((f) => Object.values(f).reverse()));
        let d = Kt(e, i, r, (f) => (a === "u" ? e.predecessors(f) : e.successors(f)) || [], n), c = Qt(e, i, d.root, d.align, l === "r");
        l === "r" && (c = X(c, (f) => -f)), o[a + l] = c;
      });
    });
    let s = er(e, o);
    return nr(o, s), tr(o, e.graph().align);
  }
  function rr(e, n, t) {
    return (r, o, i) => {
      let s = r.node(o), a = r.node(i), l = 0, u;
      if (l += s.width / 2, Object.hasOwn(s, "labelpos")) switch (s.labelpos.toLowerCase()) {
        case "l":
          u = -s.width / 2;
          break;
        case "r":
          u = s.width / 2;
          break;
      }
      if (u && (l += t ? u : -u), u = void 0, l += (s.dummy ? n : e) / 2, l += (a.dummy ? n : e) / 2, l += a.width / 2, Object.hasOwn(a, "labelpos")) switch (a.labelpos.toLowerCase()) {
        case "l":
          u = a.width / 2;
          break;
        case "r":
          u = -a.width / 2;
          break;
      }
      return u && (l += t ? u : -u), l;
    };
  }
  function or(e, n) {
    return e.node(n).width;
  }
  function Nn(e, n, t) {
    var s;
    if (!t) return false;
    let r = (s = n.node(e)) == null ? void 0 : s.edgeObj;
    if (!r || n.node(e).edgeLabel.reversed) return false;
    let o = t.indexOf(r == null ? void 0 : r.v), i = t.indexOf(r == null ? void 0 : r.w);
    return o !== -1 && i !== -1 && o === (i + 1) % t.length || o === (i - 1) % t.length;
  }
  function kn(e, n) {
    e = Z(e), ir(e), Object.entries(vn(e, n)).forEach(([t, r]) => e.node(t).x = r);
  }
  function ir(e) {
    let n = P(e), t = e.graph(), r = t.ranksep, o = t.rankalign, i = 0;
    n.forEach((s) => {
      let a = s.reduce((l, u) => {
        var c;
        let d = (c = e.node(u).height) != null ? c : 0;
        return l > d ? l : d;
      }, 0);
      s.forEach((l) => {
        let u = e.node(l);
        o === "top" ? u.y = i + u.height / 2 : o === "bottom" ? u.y = i + a - u.height / 2 : u.y = i + a / 2;
      }), i += a + r;
    });
  }
  var xn = /* @__PURE__ */ new WeakMap();
  function Oe(e, n = {}) {
    return Rn(e, q, n), e;
  }
  function _n(e, n, t) {
    let r = n;
    for (; r !== void 0; ) {
      let o = e.parent(r);
      if (o === t) return r;
      r = o;
    }
  }
  function Rn(e, n, t) {
    var L;
    let r = e.nodes().filter((b) => e.children(b).length), o = {};
    r.forEach((b) => {
      let g = e.node(b);
      if (g && g.rankdir) {
        let m = new T({ multigraph: true, compound: true });
        m.setGraph({ rankdir: g.rankdir });
        let w = e.children(b);
        w.forEach((v) => {
          let N = { ...e.node(v) };
          m.setNode(v, N);
          let O = e.parent(v);
          O && O !== b && w.includes(O) && m.setParent(v, O);
        });
        let k = /* @__PURE__ */ new Set();
        e.edges().forEach((v) => {
          let N = _n(e, v.v, b), O = _n(e, v.w, b);
          if (N && O && N !== O) {
            let W = `${N}\0${O}`;
            k.has(W) || (k.add(W), m.setEdge(N, O, { ...e.edge(v) }));
          }
        }), Rn(m, n, t);
        let _ = jn(m);
        On(_, n, t, null), Cn(m, _);
        let C = 1 / 0, j = 1 / 0, I = -1 / 0, S = -1 / 0;
        m.nodes().forEach((v) => {
          if (v === b) return;
          let N = m.node(v);
          N && typeof N.x == "number" && typeof N.y == "number" && typeof N.width == "number" && typeof N.height == "number" && (C = Math.min(C, N.x - N.width / 2), I = Math.max(I, N.x + N.width / 2), j = Math.min(j, N.y - N.height / 2), S = Math.max(S, N.y + N.height / 2));
        }), (!isFinite(C) || !isFinite(j) || !isFinite(I) || !isFinite(S)) && (C = j = 0, I = S = 0);
        let G = I - C, x = S - j;
        o[b] = { minX: C, minY: j, maxX: I, maxY: S, width: G, height: x, offsetX: C, offsetY: j }, g._dagreClusterSubgraph = m;
      }
    });
    let i = [], s = (b) => {
      let g = [], m = (e.children(b) || []).filter((w) => w !== b);
      for (; m.length > 0; ) {
        let w = m.shift();
        g.push(w), (e.children(w) || []).filter((k) => k !== w).forEach((k) => m.push(k));
      }
      return g;
    }, a = /* @__PURE__ */ new Map();
    r.forEach((b) => {
      let g = e.node(b);
      g && g.rankdir && o[b] && a.set(b, (e.children(b) || []).filter((m) => m !== b));
    });
    let l = new Set([...a.values()].flat()), u = /* @__PURE__ */ new Map();
    a.forEach((b, g) => {
      l.has(g) || u.set(g, s(g));
    });
    let d = new Set([...u.values()].flat()), c = (b) => {
      for (let [g, m] of u) if (m.includes(b)) return g;
      return b;
    }, f = [];
    e.edges().forEach((b) => {
      (d.has(b.v) || d.has(b.w)) && f.push({ edge: b, label: e.edge(b) });
    });
    let h = /* @__PURE__ */ new Map();
    d.forEach((b) => {
      let g = e.parent(b);
      h.set(b, typeof g == "string" ? g : void 0);
    }), u.forEach((b, g) => {
      let m = e.node(g), w = [];
      b.forEach((C) => {
        let j = e.node(C);
        j && (w.push({ id: C, node: j, parent: h.get(C) }), e.removeNode(C));
      });
      let k = f.filter(({ edge: C }) => b.includes(C.v) || b.includes(C.w)), _ = o[g];
      m && (i.push({ clusterId: g, subgraph: m._dagreClusterSubgraph, bounds: _, children: b, removedNodes: w, removedEdges: k }), m.width = _.width, m.height = _.height);
    });
    let p = /* @__PURE__ */ new Set();
    f.forEach(({ edge: b, label: g }) => {
      let m = c(b.v), w = c(b.w);
      if (m !== w && e.hasNode(m) && e.hasNode(w)) {
        let k = `${m}\0${w}`;
        p.has(k) || (p.add(k), e.setEdge(m, w, { ...g, width: 0, height: 0 }));
      }
    });
    let E = jn(e), y = On(E, n, t, (L = xn.get(e)) != null ? L : null);
    xn.set(e, y), Cn(e, E), p.forEach((b) => {
      let g = b.indexOf("\0"), m = b.slice(0, g), w = b.slice(g + 1);
      e.hasEdge(m, w) && e.removeEdge(m, w);
    }), i.forEach(({ clusterId: b, subgraph: g, bounds: m, removedNodes: w, removedEdges: k }) => {
      var G, x;
      let _ = e.node(b), C = (G = _ == null ? void 0 : _.x) != null ? G : 0, j = (x = _ == null ? void 0 : _.y) != null ? x : 0, I = (m.minX + m.maxX) / 2, S = (m.minY + m.maxY) / 2;
      w.forEach(({ id: v, node: N, parent: O }) => {
        e.setNode(v, N), O !== void 0 && e.setParent(v, O);
      }), k.forEach(({ edge: v, label: N }) => {
        e.setEdge(v, N);
      }), g.nodes().forEach((v) => {
        if (v === b) return;
        let N = g.node(v), O = e.node(v);
        O && N && typeof N.x == "number" && typeof N.y == "number" && (O.x = C + (N.x - I), O.y = j + (N.y - S));
      }), delete _._dagreClusterSubgraph;
    }), r.forEach((b) => {
      var w, k;
      let g = e.node(b), m = o[b];
      if (g && g.rankdir && g._dagreClusterSubgraph && m) {
        let _ = g._dagreClusterSubgraph, C = (w = g.x) != null ? w : 0, j = (k = g.y) != null ? k : 0, I = (m.minX + m.maxX) / 2, S = (m.minY + m.maxY) / 2;
        _.nodes().forEach((G) => {
          if (G === b) return;
          let x = _.node(G), v = e.node(G);
          if (v && x && typeof x.x == "number" && typeof x.y == "number") {
            let N = x.x - I, O = x.y - S;
            v.x = C + N, v.y = j + O;
          }
        }), delete g._dagreClusterSubgraph;
      }
    });
  }
  function On(e, n, t, r = null) {
    var l, u;
    let o = (t == null ? void 0 : t.useDynamic) !== false, i = o && (l = r == null ? void 0 : r.graph) != null ? l : null, s = o && (u = r == null ? void 0 : r.rawNodes) != null ? u : null;
    n("    makeSpaceForEdgeLabels", () => hr(e)), n("    removeSelfEdges", () => Nr(e)), n("    acyclic", () => Ue(e, i)), n("    nestingGraph.run", () => un(e)), n("    rank", () => dn(Z(e))), n("    injectEdgeLabelProxies", () => br(e)), n("    removeEmptyRanks", () => Be(e)), n("    nestingGraph.cleanup", () => fn(e)), n("    normalizeRanks", () => We(e)), n("    assignRankMinMax", () => gr(e)), n("    removeEdgeLabelProxies", () => pr(e)), n("    normalize.run", () => Ke(e)), n("    parentDummyChains", () => ln(e)), n("    addBorderSegments", () => bn(e)), n("    order", () => re(e, t, s)), n("    insertSelfEdges", () => Gr(e)), n("    adjustCoordinateSystem", () => pn(e)), n("    position", () => kn(e, t.corePath)), n("    positionSelfEdges", () => vr(e));
    let a = JSON.parse(JSON.stringify(e._nodes));
    return n("    removeBorderNodes", () => wr(e)), n("    normalize.undo", () => Qe(e)), n("    fixupEdgeLabelCoords", () => Lr(e)), n("    undoCoordinateSystem", () => mn(e)), n("    translateGraph", () => mr(e)), n("    assignNodeIntersects", () => Er(e)), n("    reversePoints", () => yr(e)), n("    acyclic.undo", () => Je(e)), { graph: e, rawNodes: a };
  }
  function Cn(e, n) {
    e.nodes().forEach((t) => {
      let r = e.node(t), o = n.node(t);
      r && (r.x = o.x, r.y = o.y, r.order = o.order, r.rank = o.rank, n.children(t).length && (r.width = o.width, r.height = o.height));
    }), e.edges().forEach((t) => {
      let r = e.edge(t), o = n.edge(t);
      r.points = o.points, Object.hasOwn(o, "x") && (r.x = o.x, r.y = o.y);
    }), e.graph().width = n.graph().width, e.graph().height = n.graph().height;
  }
  var sr = ["nodesep", "edgesep", "ranksep", "marginx", "marginy"];
  var ar = { ranksep: 50, edgesep: 20, nodesep: 50, rankdir: "TB", rankalign: "center" };
  var dr = ["acyclicer", "ranker", "rankdir", "align", "rankalign"];
  var lr = ["width", "height", "rank"];
  var Tn = { width: 0, height: 0 };
  var ur = ["minlen", "weight", "width", "height", "labeloffset"];
  var cr = { minlen: 1, weight: 1, width: 0, height: 0, labeloffset: 10, labelpos: "r" };
  var fr = ["labelpos"];
  function jn(e) {
    let n = new T({ multigraph: true, compound: true }), t = _e(e.graph());
    return n.setGraph(Object.assign({}, ar, xe(t, sr), B(t, dr))), e.nodes().forEach((r) => {
      let o = _e(e.node(r)), i = xe(o, lr);
      Object.keys(Tn).forEach((a) => {
        i[a] === void 0 && (i[a] = Tn[a]);
      }), n.setNode(r, i);
      let s = e.parent(r);
      s !== void 0 && n.setParent(r, s);
    }), e.edges().forEach((r) => {
      let o = _e(e.edge(r));
      n.setEdge(r, Object.assign({}, cr, xe(o, ur), B(o, fr)));
    }), n;
  }
  function hr(e) {
    let n = e.graph();
    n.ranksep /= 2, e.edges().forEach((t) => {
      var o;
      let r = e.edge(t);
      r.minlen *= 2, ((o = r.labelpos) != null ? o : "r").toLowerCase() !== "c" && (n.rankdir === "TB" || n.rankdir === "BT" ? r.width += r.labeloffset : r.height += r.labeloffset);
    });
  }
  function br(e) {
    e.edges().forEach((n) => {
      let t = e.edge(n);
      if (t.width && t.height) {
        let r = e.node(n.v), i = { rank: (e.node(n.w).rank - r.rank) / 2 + r.rank, e: n };
        M(e, "edge-proxy", i, "_ep");
      }
    });
  }
  function gr(e) {
    let n = 0;
    e.nodes().forEach((t) => {
      let r = e.node(t);
      r.borderTop && (r.minRank = e.node(r.borderTop).rank, r.maxRank = e.node(r.borderBottom).rank, n = Math.max(n, r.maxRank));
    }), e.graph().maxRank = n;
  }
  function pr(e) {
    e.nodes().forEach((n) => {
      let t = e.node(n);
      if (t.dummy === "edge-proxy") {
        let r = t;
        e.edge(r.e).labelRank = t.rank, e.removeNode(n);
      }
    });
  }
  function mr(e) {
    let n = Number.POSITIVE_INFINITY, t = 0, r = Number.POSITIVE_INFINITY, o = 0, i = e.graph(), s = i.marginx || 0, a = i.marginy || 0;
    function l(u) {
      let d = u.x, c = u.y, f = u.width, h = u.height;
      n = Math.min(n, d - f / 2), t = Math.max(t, d + f / 2), r = Math.min(r, c - h / 2), o = Math.max(o, c + h / 2);
    }
    e.nodes().forEach((u) => l(e.node(u))), e.edges().forEach((u) => {
      let d = e.edge(u);
      Object.hasOwn(d, "x") && l(d);
    }), n -= s, r -= a, e.nodes().forEach((u) => {
      let d = e.node(u);
      d.x -= n, d.y -= r;
    }), e.edges().forEach((u) => {
      let d = e.edge(u);
      d.points.forEach((c) => {
        c.x -= n, c.y -= r;
      }), Object.hasOwn(d, "x") && (d.x -= n), Object.hasOwn(d, "y") && (d.y -= r);
    }), i.width = t - n + s, i.height = o - r + a;
  }
  function Er(e) {
    e.edges().forEach((n) => {
      if (n.v === n.w) return;
      let t = e.edge(n), r = e.node(n.v), o = e.node(n.w), i, s;
      t.points ? (i = t.points[0], s = t.points[t.points.length - 1]) : (t.points = [], i = o, s = r), t.points.unshift(se(r, i)), t.points.push(se(o, s));
    });
  }
  function Lr(e) {
    e.edges().forEach((n) => {
      let t = e.edge(n);
      if (Object.hasOwn(t, "x")) switch ((t.labelpos === "l" || t.labelpos === "r") && (t.width -= t.labeloffset), t.labelpos) {
        case "l":
          t.x -= t.width / 2 + t.labeloffset;
          break;
        case "r":
          t.x += t.width / 2 + t.labeloffset;
          break;
      }
    });
  }
  function yr(e) {
    e.edges().forEach((n) => {
      let t = e.edge(n);
      t.reversed && t.points.reverse();
    });
  }
  function wr(e) {
    e.nodes().forEach((n) => {
      if (e.children(n).length) {
        let t = e.node(n), r = e.node(t.borderTop), o = e.node(t.borderBottom), i = e.node(t.borderLeft[t.borderLeft.length - 1]), s = e.node(t.borderRight[t.borderRight.length - 1]);
        t.width = Math.abs(s.x - i.x), t.height = Math.abs(o.y - r.y), t.x = i.x + t.width / 2, t.y = r.y + t.height / 2;
      }
    }), e.nodes().forEach((n) => {
      e.node(n).dummy === "border" && e.removeNode(n);
    });
  }
  function Nr(e) {
    e.edges().forEach((n) => {
      if (n.v === n.w) {
        let t = e.node(n.v);
        t.selfEdges || (t.selfEdges = []), t.selfEdges.push({ e: n, label: e.edge(n) }), e.removeEdge(n);
      }
    });
  }
  function Gr(e) {
    P(e).forEach((t) => {
      let r = 0;
      t.forEach((o, i) => {
        let s = e.node(o);
        typeof s.rank != "number" && (s.rank = 0), s.order = i + r, (s.selfEdges || []).forEach((a) => {
          M(e, "selfedge", { width: a.label.width, height: a.label.height, rank: s.rank, order: i + ++r, e: a.e, edgeLabel: a.label }, "_se"), (!Array.isArray(a.label.points) || a.label.points.length !== 7) && (a.label.points = [{ x: 0, y: -10 }, { x: 0, y: -10 }, { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
        }), delete s.selfEdges;
      });
    });
  }
  function vr(e) {
    e.nodes().forEach((n) => {
      let t = e.node(n), r = (o) => typeof o == "number" && isFinite(o);
      if (t.dummy === "selfedge") {
        let o = t, i = e.node(o.e.v), s = r(i == null ? void 0 : i.x) ? i.x : 0, a = r(i == null ? void 0 : i.y) ? i.y : 0, l = r(i == null ? void 0 : i.width) ? i.width : 0, u = r(i == null ? void 0 : i.height) ? i.height : 0, d = r(t.x) ? t.x : s, c = r(t.y) ? t.y : a, f = l / 2, h = u / 2;
        o.edgeLabel.points = [{ x: d + f, y: c - h }, { x: d + f, y: c - h }, { x: d, y: c }, { x: d - f, y: c + h }, { x: d - f, y: c + h }, { x: d, y: c }, { x: d, y: c }], o.edgeLabel.x = d, o.edgeLabel.y = c, e.setEdge(o.e, o.edgeLabel), e.removeNode(n);
      } else t && Array.isArray(t.selfEdges) && t.selfEdges.forEach((o) => {
        if (!Array.isArray(o.label.points) || o.label.points.length !== 7) {
          let i = r(t.x) ? t.x : 0, s = r(t.y) ? t.y : 0, a = r(t.width) ? t.width : 0, l = r(t.height) ? t.height : 0, u = a / 2, d = l / 2;
          o.label.points = [{ x: i + u, y: s - d }, { x: i + u, y: s - d }, { x: i, y: s }, { x: i - u, y: s + d }, { x: i - u, y: s + d }, { x: i, y: s }, { x: i, y: s }];
        }
      });
    });
  }
  function xe(e, n) {
    return X(B(e, n), Number);
  }
  function _e(e) {
    let n = {};
    return e && Object.entries(e).forEach(([t, r]) => {
      typeof t == "string" && (t = t.toLowerCase()), n[t] = r;
    }), n;
  }
  function Ce(e) {
    let n = P(e), t = new T({ compound: true, multigraph: true }).setGraph({});
    return e.nodes().forEach((r) => {
      t.setNode(r, { label: r }), t.setParent(r, "layer" + e.node(r).rank);
    }), e.edges().forEach((r) => t.setEdge(r.v, r.w, {}, r.name)), n.forEach((r, o) => {
      let i = "layer" + o;
      t.setNode(i, { rank: "same" }), r.reduce((s, a) => (t.setEdge(s, a, { style: "invis" }), a));
    }), t;
  }
  var kr = { graphlib: ie, version: ue, layout: Oe, debug: Ce, util: { time: le, notime: q } };
  var $o = kr;

  // client.src.js
  window.__ModuleLoader__.load({
    id: "@local/composer-drawer",
    factory(require2) {
      const React = require2("react");
      const h = React.createElement;
      const NS = "composerDrawer";
      const PANEL_ID = "composer-drawer-panel";
      const FALLBACK = {
        "button.expand": "\u5C55\u5F00\u9762\u677F",
        "button.collapse": "\u6536\u8D77\u9762\u677F",
        "panel.title": "\u4EFB\u52A1",
        "panel.body": "\u8FD9\u91CC\u5C06\u6765\u653E\u9762\u677F\u5185\u5BB9\u3002",
        "panel.note": "\u9762\u677F\u4F1A\u4E00\u76F4\u4FDD\u6301\u6253\u5F00\uFF0C\u53EA\u6709\u518D\u6B21\u70B9\u51FB\u4E0A\u9762\u7684\u7BAD\u5934\u6309\u94AE\u624D\u4F1A\u6536\u8D77\u3002",
        "board.count": "\u5171 {n} \u6761 \xB7 \u5DF2\u542F\u7528 {on} \u6761",
        "board.expandAll": "\u5168\u90E8\u5C55\u5F00",
        "board.collapseAll": "\u5168\u90E8\u6536\u8D77",
        "board.off": "\u672A\u542F\u7528",
        "board.empty": "\u8FD8\u6CA1\u6709\u4EFB\u52A1\u3002",
        "board.tree": "\u79D1\u6280\u6811",
        "board.list": "\u5217\u8868"
      };
      const ZH = {
        "button.expand": "\u5C55\u5F00\u9762\u677F",
        "button.collapse": "\u6536\u8D77\u9762\u677F",
        "panel.title": "\u4EFB\u52A1",
        "panel.body": "\u8FD9\u91CC\u5C06\u6765\u653E\u9762\u677F\u5185\u5BB9\u3002",
        "panel.note": "\u9762\u677F\u4F1A\u4E00\u76F4\u4FDD\u6301\u6253\u5F00\uFF0C\u53EA\u6709\u518D\u6B21\u70B9\u51FB\u4E0A\u9762\u7684\u7BAD\u5934\u6309\u94AE\u624D\u4F1A\u6536\u8D77\u3002",
        "board.count": "\u5171 {n} \u6761 \xB7 \u5DF2\u542F\u7528 {on} \u6761",
        "board.expandAll": "\u5168\u90E8\u5C55\u5F00",
        "board.collapseAll": "\u5168\u90E8\u6536\u8D77",
        "board.off": "\u672A\u542F\u7528",
        "board.empty": "\u8FD8\u6CA1\u6709\u4EFB\u52A1\u3002",
        "board.tree": "\u79D1\u6280\u6811",
        "board.list": "\u5217\u8868"
      };
      const EN = {
        "button.expand": "Expand panel",
        "button.collapse": "Collapse panel",
        "panel.title": "Tasks",
        "panel.body": "Panel content goes here.",
        "panel.note": "The panel stays open until you click the arrow button again.",
        "board.count": "{n} tasks \xB7 {on} enabled",
        "board.expandAll": "Expand all",
        "board.collapseAll": "Collapse all",
        "board.off": "Disabled",
        "board.empty": "No tasks yet.",
        "board.tree": "Tech tree",
        "board.list": "List"
      };
      let localeFace = null;
      let translate = null;
      let pluginRuntime = null;
      function commandSurface() {
        try {
          if (!pluginRuntime) return null;
          const remote = pluginRuntime.remote;
          if (!remote || !remote.commands || typeof remote.commands.execute !== "function") return null;
          return remote.commands;
        } catch (failure) {
          return null;
        }
      }
      function runCommand(line, sessionId) {
        const commands = commandSurface();
        if (!commands) return Promise.reject(new Error("\u547D\u4EE4\u901A\u9053\u4E0D\u53EF\u7528"));
        return commands.execute(sessionId, line, []);
      }
      function commandText(settled) {
        if (!settled) return "";
        if (typeof settled === "string") return settled;
        const seen = [];
        const walk = function(value, depth) {
          if (!value || typeof value !== "object" || depth > 5) return "";
          if (seen.indexOf(value) !== -1) return "";
          seen.push(value);
          if (typeof value.text === "string" && value.text !== "") return value.text;
          const keys = Object.keys(value);
          for (let i = 0; i < keys.length; i += 1) {
            const found = walk(value[keys[i]], depth + 1);
            if (found !== "") return found;
          }
          return "";
        };
        return walk(settled, 0);
      }
      function t(key) {
        if (translate) {
          try {
            const value = translate(key);
            if (typeof value === "string" && value.length > 0 && value !== key) return value;
          } catch (failure) {
          }
        }
        return FALLBACK[key] || key;
      }
      function useLocaleRevision() {
        const pair = React.useState(0);
        const bump = pair[1];
        React.useEffect(
          function() {
            if (!localeFace || typeof localeFace.subscribe !== "function") return void 0;
            const dispose = localeFace.subscribe(function() {
              bump(function(n) {
                return n + 1;
              });
            });
            return typeof dispose === "function" ? dispose : void 0;
          },
          [bump]
        );
      }
      const shadowLight = "0 2px 8px rgba(0, 0, 0, 0.16)";
      const shadowHeavy = "0 8px 24px rgba(0, 0, 0, 0.18)";
      const edgeClickable = "3px solid var(--dsw-alias-border-l2)";
      const edgeSurface = "1px solid var(--dsw-alias-border-l1)";
      function surfaceStyle(extra) {
        return Object.assign({ border: edgeSurface, boxShadow: shadowHeavy }, extra || {});
      }
      function clickableStyle(extra) {
        return Object.assign({ border: edgeClickable, boxShadow: shadowLight }, extra || {});
      }
      const wrapperStyle = {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8,
        width: "100%",
        maxWidth: 1274,
        /* Bottom margin pulls the row down over the composer card so the button
           hangs at the card's top-left corner and travels with its top edge.
           The stack above the card is painted after this row, so the row is
           lifted to keep the overhanging button clickable. */
        margin: "0 auto -40px",
        boxSizing: "border-box",
        position: "relative",
        zIndex: 2,
        /* The overhanging row must not swallow clicks meant for the composer
           area or the other dock rows; only the button and the panel opt in. */
        pointerEvents: "none"
      };
      const buttonSlotStyle = {
        display: "inline-flex",
        marginLeft: -32,
        pointerEvents: "auto"
      };
      const panelStyle = surfaceStyle({
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "calc(100% + 44px)",
        maxHeight: 640,
        boxSizing: "border-box",
        borderRadius: 12,
        background: "var(--dsw-alias-bg-layer-1)",
        padding: "12px 14px 14px",
        color: "var(--dsw-alias-label-primary)",
        pointerEvents: "auto",
        zIndex: 3,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden"
      });
      const titleStyle = {
        fontSize: 13,
        fontWeight: 600,
        lineHeight: "20px",
        color: "var(--dsw-alias-label-primary)"
      };
      const bodyStyle = {
        margin: "6px 0 0",
        fontSize: 12,
        lineHeight: 1.6,
        color: "var(--dsw-alias-label-secondary)"
      };
      const noteStyle = {
        margin: "10px 0 0",
        paddingTop: 10,
        borderTop: "1px solid var(--dsw-alias-border-l1)",
        fontSize: 11,
        lineHeight: 1.5,
        color: "var(--dsw-alias-label-secondary)"
      };
      const SAMPLE_TASKS = [
        {
          id: "01",
          title: "\u5DE5\u4F5C\u533A\u7ED3\u6784",
          kind: "\u9700\u6C42",
          status: "\u5B8C\u6210",
          on: true,
          parent: "",
          summary: "\u516D\u683C\u76EE\u5F55 + git \u4ED3\u5E93",
          links: []
        },
        {
          id: "01/A",
          title: "\u95EE\u9898\uFF1A\u4EA7\u51FA\u7269\u5E73\u94FA\uFF0C\u6CA1\u6709\u53EF\u56DE\u9000\u7684\u70B9",
          kind: "\u95EE\u9898",
          status: "\u63D0\u4EA4",
          on: true,
          parent: "01",
          summary: "\u80FD\u7528\u7684\u3001\u5199\u574F\u7684\u3001\u8BD5\u9A8C\u7684\u3001\u6587\u6863\u5168\u6DF7\u5728\u4E00\u8D77",
          links: []
        },
        {
          id: "01/B-01",
          title: "B-01 \xB7 \u516D\u683C + \u5355\u4ED3\u5E93",
          kind: "\u8BBE\u8BA1",
          status: "\u63D0\u4EA4",
          on: true,
          parent: "01",
          summary: "\u4E00\u6B21\u63D0\u4EA4\u5C31\u662F\u4E00\u4EFD\u53EF\u4EA4\u4ED8\u5FEB\u7167",
          links: []
        },
        {
          id: "01/B-02",
          title: "B-02 \xB7 \u6BCF\u683C\u4E00\u4E2A\u4ED3\u5E93",
          kind: "\u8BBE\u8BA1",
          status: "\u62D2\u7EDD",
          on: false,
          parent: "01",
          summary: "\u5F15\u7528\u6210\u672C\u538B\u8FC7\u56DE\u6EDA\u6536\u76CA",
          links: []
        },
        {
          id: "01/C-01-01",
          title: "C-01-01 \xB7 \u516D\u4E2A\u683C\u5B50\u600E\u4E48\u5207",
          kind: "\u63A5\u53E3",
          status: "\u63D0\u4EA4",
          on: true,
          parent: "01/B-01",
          summary: "\u5F00\u53D1 / \u53D1\u5E03 / \u63A2\u9488 / \u7814\u7A76 / todo / \u8BA1\u5212",
          links: []
        },
        {
          id: "01/D-01-01-01",
          title: "D-01-01-01 \xB7 \u76EE\u5F55\u4E0E git \u521D\u59CB\u5316",
          kind: "\u5B9E\u73B0",
          status: "\u5B8C\u6210",
          on: true,
          parent: "01/C-01-01",
          summary: "\u5355\u4ED3\u5E93\u3001\u4E3B\u5E72\u5355\u4E00\u5386\u53F2",
          links: []
        },
        {
          id: "03",
          title: "\u9632\u6B62\u5916\u90E8\u66F4\u6539",
          kind: "\u9700\u6C42",
          status: "\u9700\u8981\u6388\u6743",
          on: false,
          parent: "",
          summary: "\u5F85\u5B9A\uFF1A\u5FEB\u7167\u5B58\u54EA",
          links: []
        },
        {
          id: "04",
          title: "\u538B\u7F29\u5305\u5DE5\u5177",
          kind: "\u529F\u80FD\u8BF7\u6C42",
          status: "\u9700\u8981\u6388\u6743",
          on: false,
          parent: "",
          summary: "\u5F52\u6863 / \u89E3\u5305\uFF0C\u53EA\u52A8\u526F\u672C",
          links: [{ to: "03", label: "\u4F9D\u8D56" }]
        },
        {
          id: "04/A",
          title: "\u95EE\u9898\uFF1A\u73B0\u5728\u53EA\u80FD\u4E00\u4E2A\u4E2A\u6587\u4EF6\u62F7",
          kind: "\u95EE\u9898",
          status: "\u9700\u8981\u6388\u6743",
          on: false,
          parent: "04",
          summary: "zip / tar \u90FD\u8981\uFF0C\u5148\u8981\u80FD\u770B\u6E05\u5355",
          links: []
        },
        {
          id: "15",
          title: "\u8BA1\u5212\u5373\u63D0\u6848",
          kind: "\u9700\u6C42",
          status: "\u5904\u7406\u4E2D",
          on: true,
          parent: "",
          summary: "\u7236\u5199\u3001\u7528\u6237\u8FC7\u3001\u624D\u6D3E\u53D1",
          links: []
        },
        {
          id: "15/C-\u5F85\u8BAE",
          title: "\u5F85\u8BAE\uFF1A\u4E09\u6B21\u5426\u51B3\u4EE5\u540E\u600E\u4E48\u529E",
          kind: "\u5F85\u8BAE",
          status: "\u9700\u8981\u8865\u5145",
          on: true,
          parent: "15",
          summary: "\u53EF\u80FD\u56E0\u6B64\u6D3E\u751F\u51FA\u4E00\u6761\u65B0\u9700\u6C42",
          links: [{ to: "21", label: "\u6D3E\u751F" }]
        },
        {
          id: "21",
          title: "\u53CC\u8DEF",
          kind: "\u9884\u671F\u4E0D\u7B26",
          status: "\u9700\u8981\u6388\u6743",
          on: false,
          parent: "",
          summary: "\u7531 15 \u7684\u5F85\u8BAE\u6D3E\u751F\u51FA\u6765",
          links: [{ to: "15/C-\u5F85\u8BAE", label: "\u6765\u6E90" }]
        }
      ];
      const TASK_BY_ID = {};
      const TASK_CHILDREN = {};
      SAMPLE_TASKS.forEach(function(node) {
        TASK_BY_ID[node.id] = node;
        const key = node.parent || "";
        if (!TASK_CHILDREN[key]) TASK_CHILDREN[key] = [];
        TASK_CHILDREN[key].push(node);
      });
      function taskDepth(node) {
        let depth = 0;
        let current = node;
        while (current && current.parent) {
          depth += 1;
          current = TASK_BY_ID[current.parent];
        }
        return depth;
      }
      const DEFAULT_COLLAPSED = {};
      SAMPLE_TASKS.forEach(function(node) {
        if ((TASK_CHILDREN[node.id] || []).length > 0 && taskDepth(node) >= 1) {
          DEFAULT_COLLAPSED[node.id] = true;
        }
      });
      const STATUS_GROUPS = {
        "\u672A\u6307\u5B9A": [],
        "\u63D0\u4EA4": ["\u8FDB\u884C"],
        "\u5904\u7406\u4E2D": ["\u8FDB\u884C"],
        "\u9700\u8981\u8865\u5145": ["\u8FDB\u884C", "\u6401\u7F6E"],
        "\u9700\u8981\u6388\u6743": ["\u8FDB\u884C", "\u6401\u7F6E"],
        "\u5B8C\u6210": ["\u5B8C\u6210"],
        "\u5931\u8D25": ["\u5B8C\u6210"],
        "\u53D6\u6D88": ["\u5B8C\u6210"],
        "\u62D2\u7EDD": ["\u5B8C\u6210"]
      };
      const A2A_STATES = {
        "\u672A\u6307\u5B9A": {
          code: "UNSPECIFIED",
          tone: "label-secondary",
          desc: "\u6CA1\u6709\u91C7\u7EB3\u3002\u5199\u51FA\u6765\u4F46\u8FD8\u6CA1\u88AB\u7528\u6237\u8BA4\u53EF\u7684\u8BA1\u5212\u505C\u5728\u8FD9\u91CC\u3002"
        },
        "\u63D0\u4EA4": {
          code: "SUBMITTED",
          tone: "state-idle-primary",
          desc: "\u5DF2\u91C7\u7EB3\uFF0C\u7B49\u5F85\u88AB\u63A5\u53D6\u3002\u53EA\u6709\u8FD9\u4E2A\u72B6\u6001\u80FD\u88AB\u9886\u53D6\u3002"
        },
        "\u5904\u7406\u4E2D": {
          code: "WORKING",
          tone: "state-warn-primary",
          desc: "\u5DF2\u63A5\u53D6\uFF0C\u6B63\u5728\u505A\u3002"
        },
        "\u9700\u8981\u8865\u5145": {
          code: "INPUT_REQUIRED",
          tone: "state-warn-primary",
          desc: "\u6401\u7F6E\uFF1A\u9700\u8981\u7814\u7A76\uFF0C\u6216\u8005\u9700\u8981\u66F4\u591A\u4FE1\u606F\u624D\u80FD\u7EE7\u7EED\u3002"
        },
        "\u9700\u8981\u6388\u6743": {
          code: "AUTH_REQUIRED",
          tone: "state-warn-primary",
          desc: "\u6401\u7F6E\uFF1A\u4EE3\u4EF7\u6BD4\u8F83\u5927\u3001\u4E0D\u4E00\u5B9A\u5408\u9002\u3002\u5148\u786E\u8BA4\u522B\u7684\u8BA1\u5212\uFF0C\u6216\u786E\u8BA4\u5C31\u8D70\u8FD9\u6761\u8DEF\uFF1B\u7B49\u786E\u8BA4\u671F\u95F4\u9700\u8981\u6388\u6743\uFF0C\u4E5F\u53EF\u4EE5\u5148\u8F6C\u53BB\u505A\u522B\u7684\u3002"
        },
        "\u5B8C\u6210": {
          code: "COMPLETED",
          tone: "state-success-primary",
          desc: "\u4EA4\u4ED8\u5B8C\u6210\u3002"
        },
        "\u5931\u8D25": {
          code: "FAILED",
          tone: "state-error-primary",
          desc: "\u786E\u8BA4\u4E0D\u80FD\u7EE7\u7EED\u3002"
        },
        "\u53D6\u6D88": {
          code: "CANCELED",
          tone: "label-secondary",
          desc: "\u7236\u4EFB\u52A1\u7EC8\u7ED3\u540E\uFF0C\u4ECD\u505C\u5728\u8FDB\u884C\u6001\u7684\u4E0B\u6E38\u88AB\u53D6\u6D88\u3002"
        },
        "\u62D2\u7EDD": {
          code: "REJECTED",
          tone: "state-error-primary",
          desc: "\u7528\u6237\u4E3B\u52A8\u5426\u51B3\uFF0C\u8FD9\u4E2A\u65B9\u6848\u4E0D\u518D\u7EE7\u7EED\u3002"
        }
      };
      function statusA2A(status) {
        return A2A_STATES[status] || A2A_STATES["\u672A\u6307\u5B9A"];
      }
      function groupsOf(status) {
        return STATUS_GROUPS[status] || [];
      }
      function groupLabel(status) {
        const groups = groupsOf(status);
        return groups.length > 0 ? groups.join("/") : "\u8349\u7A3F";
      }
      function statusTone(status) {
        return "var(--dsw-alias-" + statusA2A(status).tone + ")";
      }
      const TEMPLATE_DIR = "X:\\temp\\dsh\\\u5F00\u53D1\\taskboard\\templates";
      const STORE_FILE = "C:\\Users\\16229\\.dsh\\taskboard\\plans.jsonl";
      function fileRpc() {
        try {
          const remote = pluginRuntime && pluginRuntime.remote;
          const files = remote && remote.workspaceFiles;
          if (files && typeof files.list === "function" && typeof files.read === "function") return files;
        } catch (failure) {
          return null;
        }
        return null;
      }
      function parseTaskText(text, name) {
        const lines = String(text || "").split(/\r?\n/u);
        const head = {};
        let index = 0;
        if (lines[0] === "---") {
          for (index = 1; index < lines.length; index += 1) {
            if (lines[index] === "---") {
              index += 1;
              break;
            }
            const match = /^([A-Za-z_]+):[ \t]?(.*)$/u.exec(lines[index]);
            if (match) head[match[1]] = match[2].trim();
          }
        }
        const body = lines.slice(index).join("\n").trim();
        const summary = (body.split(/\r?\n/u).map(function(line) {
          return line.replace(/^[#>\-\s]+/u, "").trim();
        }).filter(function(line) {
          return line !== "";
        })[0] || "").slice(0, 80);
        return Object.assign({}, head, {
          id: String(head.id || name || "").replace(/\.md$/u, ""),
          summary,
          body
        });
      }
      const TYPE_TO_KIND = {
        A: "\u95EE\u9898",
        B: "\u8BBE\u8BA1",
        C: "\u63A5\u53E3",
        D: "\u5B9E\u73B0",
        R: "\u7814\u7A76",
        F: "\u590D\u76D8",
        H1: "\u6401\u7F6E\xB7\u6388\u6743",
        H2: "\u6401\u7F6E\xB7\u6388\u6743",
        H3: "\u6401\u7F6E\xB7\u6388\u6743",
        H4: "\u6401\u7F6E\xB7\u8865\u5145",
        H5: "\u6401\u7F6E\xB7\u8865\u5145",
        H6: "\u6401\u7F6E\xB7\u6388\u6743",
        H7: "\u6401\u7F6E\xB7\u6388\u6743",
        H8: "\u6401\u7F6E\xB7\u8865\u5145"
      };
      function fromApi(row) {
        const type = String(row.type || "").toUpperCase();
        const status = Object.prototype.hasOwnProperty.call(A2A_STATES, row.status) ? row.status : "\u672A\u6307\u5B9A";
        const links = String(row.links || "").split(/[,，]/u).map(function(part) {
          return part.trim();
        }).filter(function(part) {
          return part !== "";
        }).map(function(part) {
          const cut = part.split(/[:：]/u);
          return { label: (cut[0] || "\u94FE\u63A5").trim(), to: (cut[1] || "").trim() };
        }).filter(function(link) {
          return link.to !== "";
        });
        return {
          id: row.id,
          /* 原始类型码：编辑时回填表单要用它，不能从 kind 反推（搁置模板 H1..H8 反推不出来）。 */
          typeCode: type,
          title: row.title || row.id,
          kind: TYPE_TO_KIND[type] || "\u8BA1\u5212",
          status,
          on: status === "\u63D0\u4EA4" || status === "\u5904\u7406\u4E2D",
          parent: row.parent || "",
          summary: row.summary || "",
          links,
          workspace: row.workspace || "",
          workspaces: row.workspaces || "",
          permission: row.permission || "",
          note: row.note || ""
        };
      }
      const cardStyle = clickableStyle({
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 10,
        background: "var(--dsw-alias-bg-layer-1)",
        transition: "border-color 120ms ease, background 120ms ease, box-shadow 120ms ease"
      });
      const cardActiveStyle = {
        border: "3px solid var(--dsw-alias-brand-primary)"
      };
      const idChipStyle = {
        flex: "none",
        marginTop: 1,
        padding: "0 5px",
        borderRadius: 5,
        background: "var(--dsw-alias-bg-layer-2)",
        color: "var(--dsw-alias-label-secondary)",
        fontSize: 10.5,
        lineHeight: "16px",
        whiteSpace: "nowrap"
      };
      const kindChipStyle = clickableStyle({
        flex: "none",
        padding: "0 6px",
        borderRadius: 999,
        color: "var(--dsw-alias-label-secondary)",
        fontSize: 10.5,
        lineHeight: "16px",
        whiteSpace: "nowrap"
      });
      const linkChipStyle = clickableStyle({
        padding: "0 7px",
        borderRadius: 999,
        background: "var(--dsw-alias-bg-layer-2)",
        color: "var(--dsw-alias-brand-primary)",
        fontSize: 10.5,
        lineHeight: "17px",
        cursor: "pointer",
        font: "inherit",
        whiteSpace: "nowrap"
      });
      function buttonBase(primary, disabled) {
        return {
          padding: "4px 14px",
          borderRadius: 10,
          font: "inherit",
          fontSize: 12,
          lineHeight: "20px",
          whiteSpace: "nowrap",
          cursor: disabled === true ? "default" : "pointer",
          opacity: disabled === true ? 0.6 : 1,
          border: "3px solid " + (primary ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l2)"),
          background: primary ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-bg-layer-1)",
          color: primary ? "var(--dsw-alias-bg-base)" : "var(--dsw-alias-label-primary)",
          boxShadow: shadowLight
        };
      }
      const childBoxStyle = {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        marginTop: 6,
        marginLeft: 14,
        paddingLeft: 10,
        borderLeft: "1px dashed var(--dsw-alias-border-l1)"
      };
      const caretStyle = clickableStyle({
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        marginTop: 1,
        padding: 0,
        borderRadius: 6,
        background: "var(--dsw-alias-bg-layer-1)",
        color: "var(--dsw-alias-label-secondary)",
        cursor: "pointer",
        font: "inherit"
      });
      function Caret(props) {
        return h(
          "svg",
          {
            viewBox: "0 0 16 16",
            width: 13,
            height: 13,
            "aria-hidden": true,
            focusable: false,
            style: {
              display: "block",
              transform: props.open ? "rotate(90deg)" : "none",
              transition: "transform 120ms ease"
            }
          },
          h("path", {
            d: "M6 3.5 L10.5 8 L6 12.5",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.7,
            strokeLinecap: "round",
            strokeLinejoin: "round"
          })
        );
      }
      const NODE_W = 168;
      const NODE_H = 52;
      function buildGraph(tasks) {
        const taskById = {};
        tasks.forEach(function(item) {
          taskById[item.id] = item;
        });
        const layout = new $o.graphlib.Graph();
        layout.setGraph({ rankdir: "LR", nodesep: 14, ranksep: 46, marginx: 4, marginy: 4 });
        layout.setDefaultEdgeLabel(function() {
          return {};
        });
        tasks.forEach(function(node) {
          layout.setNode(node.id, { width: NODE_W, height: NODE_H });
        });
        const edges = [];
        const drawEdge = function(src, dst, kind, label) {
          edges.push({ src, dst, kind, label });
          layout.setEdge(src, dst);
        };
        const seenLinks = {};
        tasks.forEach(function(node) {
          if (node.parent && taskById[node.parent]) drawEdge(node.parent, node.id, "parent", "");
          (node.links || []).forEach(function(link) {
            if (!taskById[link.to]) return;
            let src = node.id;
            let dst = link.to;
            if (link.label === "\u6D3E\u751F") {
              src = node.id;
              dst = link.to;
            } else if (link.label === "\u6765\u6E90") {
              src = link.to;
              dst = node.id;
            } else {
              src = link.to;
              dst = node.id;
            }
            const key = src < dst ? src + "\0" + dst : dst + "\0" + src;
            if (seenLinks[key]) return;
            seenLinks[key] = true;
            drawEdge(src, dst, "link", link.label);
          });
        });
        $o.layout(layout);
        const byId = {};
        tasks.forEach(function(node) {
          const point = layout.node(node.id);
          byId[node.id] = { node, x: point.x - NODE_W / 2, y: point.y - NODE_H / 2 };
        });
        const box = layout.graph();
        return {
          byId,
          nodes: tasks.map(function(node) {
            return byId[node.id];
          }),
          edges,
          width: Math.max(NODE_W + 8, box.width || 0),
          height: Math.max(NODE_H + 8, box.height || 0)
        };
      }
      function TechTree(props) {
        const graph = props.graph;
        const hoverState = React.useState("");
        const hovered = hoverState[0];
        const setHovered = hoverState[1];
        return h(
          "div",
          { style: { height: 336, overflow: "auto", paddingRight: 4 } },
          h(
            "div",
            { style: { position: "relative", width: graph.width, height: graph.height, margin: "4px 0" } },
            h(
              "svg",
              {
                width: graph.width,
                height: graph.height,
                style: { position: "absolute", left: 0, top: 0, pointerEvents: "none" }
              },
              h(
                "defs",
                null,
                h(
                  "marker",
                  {
                    id: "tt-arrow",
                    viewBox: "0 0 8 8",
                    refX: 7,
                    refY: 4,
                    markerWidth: 7,
                    markerHeight: 7,
                    orient: "auto"
                  },
                  h("path", { d: "M0 0 L8 4 L0 8 Z", fill: "var(--dsw-alias-border-l2)" })
                )
              ),
              graph.edges.map(function(edge) {
                const from = graph.byId[edge.src];
                const to = graph.byId[edge.dst];
                if (!from || !to) return null;
                const x1 = from.x + NODE_W;
                const y1 = from.y + NODE_H / 2;
                const x2 = to.x - 6;
                const y2 = to.y + NODE_H / 2;
                const dx = Math.max(28, Math.abs(x2 - x1) / 2);
                const active = hovered === edge.src || hovered === edge.dst;
                return h("path", {
                  key: "edge-" + edge.src + "-" + edge.dst + "-" + edge.kind,
                  d: "M" + x1 + " " + y1 + " C" + (x1 + dx) + " " + y1 + " " + (x2 - dx) + " " + y2 + " " + x2 + " " + y2,
                  fill: "none",
                  stroke: edge.kind === "link" ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l2)",
                  strokeWidth: active ? 2 : 1.2,
                  strokeDasharray: edge.kind === "link" ? "4 3" : "none",
                  opacity: hovered === "" ? 0.5 : active ? 1 : 0.14,
                  markerEnd: "url(#tt-arrow)"
                });
              })
            ),
            graph.nodes.map(function(placed) {
              const node = placed.node;
              const isHovered = hovered === node.id;
              return h(
                "div",
                {
                  key: "tt-" + node.id,
                  onMouseEnter: function() {
                    setHovered(node.id);
                  },
                  onMouseLeave: function() {
                    setHovered("");
                  },
                  onClick: function() {
                    props.onSelect(node.id);
                  },
                  style: clickableStyle({
                    position: "absolute",
                    left: placed.x,
                    top: placed.y,
                    width: NODE_W,
                    height: NODE_H,
                    boxSizing: "border-box",
                    padding: "7px 9px",
                    cursor: "pointer",
                    border: "3px solid " + (isHovered || props.selected === node.id ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l2)"),
                    borderRadius: 10,
                    background: "var(--dsw-alias-bg-layer-1)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    opacity: node.on ? 1 : 0.62,
                    transition: "border-color 120ms ease, box-shadow 120ms ease"
                  })
                },
                h(
                  "div",
                  { style: { display: "flex", alignItems: "center", gap: 5 } },
                  h("span", { style: idChipStyle }, node.id),
                  h("span", { style: kindChipStyle }, node.kind),
                  h("span", { style: { marginLeft: "auto", fontSize: 11, color: statusTone(node.status) } }, "\u25CF")
                ),
                h(
                  "div",
                  {
                    style: {
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--dsw-alias-label-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }
                  },
                  node.title
                )
              );
            })
          )
        );
      }
      function DetailPane(props) {
        const node = props.node;
        const state = statusA2A(node.status);
        const children = props.tasks.filter(function(item) {
          return item.parent === node.id;
        }).map(function(item) {
          return item.id;
        });
        const outLinks = (node.links || []).map(function(link) {
          return { label: link.label, id: link.to };
        });
        const inLinks = [];
        props.tasks.forEach(function(item) {
          (item.links || []).forEach(function(link) {
            if (link.to === node.id) inLinks.push({ label: link.label, id: item.id });
          });
        });
        const TRANSITIONS = {
          "\u672A\u6307\u5B9A": [{ to: "\u63D0\u4EA4", label: "\u91C7\u7EB3", primary: true }, { to: "\u62D2\u7EDD", label: "\u62D2\u7EDD" }],
          "\u63D0\u4EA4": [
            { to: "\u5904\u7406\u4E2D", label: "\u9886\u53D6", primary: true },
            { to: "\u5B8C\u6210", label: "\u76F4\u63A5\u5B8C\u6210" },
            { to: "\u53D6\u6D88", label: "\u53D6\u6D88" },
            { to: "\u62D2\u7EDD", label: "\u62D2\u7EDD" }
          ],
          "\u5904\u7406\u4E2D": [
            { to: "\u5B8C\u6210", label: "\u5B8C\u6210", primary: true },
            { to: "\u5931\u8D25", label: "\u5931\u8D25" },
            { to: "\u53D6\u6D88", label: "\u53D6\u6D88" },
            { to: "\u9700\u8981\u8865\u5145", label: "\u9700\u8981\u8865\u5145" },
            { to: "\u9700\u8981\u6388\u6743", label: "\u9700\u8981\u6388\u6743" }
          ],
          "\u9700\u8981\u8865\u5145": [
            { to: "\u5904\u7406\u4E2D", label: "\u7EE7\u7EED", primary: true },
            { to: "\u53D6\u6D88", label: "\u53D6\u6D88" },
            { to: "\u62D2\u7EDD", label: "\u62D2\u7EDD" }
          ],
          "\u9700\u8981\u6388\u6743": [
            { to: "\u5904\u7406\u4E2D", label: "\u7EE7\u7EED", primary: true },
            { to: "\u53D6\u6D88", label: "\u53D6\u6D88" },
            { to: "\u62D2\u7EDD", label: "\u62D2\u7EDD" }
          ],
          /* 终态：只有「重开」一条路（T-030）。重开回到「提交」，要重新领。 */
          "\u5B8C\u6210": [{ to: "\u63D0\u4EA4", label: "\u91CD\u5F00", primary: true }],
          "\u5931\u8D25": [{ to: "\u63D0\u4EA4", label: "\u91CD\u5F00", primary: true }],
          "\u53D6\u6D88": [{ to: "\u63D0\u4EA4", label: "\u91CD\u5F00", primary: true }],
          "\u62D2\u7EDD": [{ to: "\u63D0\u4EA4", label: "\u91CD\u5F00", primary: true }]
        };
        const actions = TRANSITIONS[node.status] || [];
        const chip = function(label, target) {
          return h(
            "button",
            {
              key: "rel-" + label + "-" + target,
              type: "button",
              onClick: function() {
                props.onJump(target);
              },
              style: clickableStyle({
                padding: "2px 10px",
                borderRadius: 8,
                font: "inherit",
                fontSize: 11,
                lineHeight: "20px",
                whiteSpace: "nowrap",
                cursor: "pointer",
                background: "var(--dsw-alias-bg-layer-1)",
                color: "var(--dsw-alias-brand-primary)"
              })
            },
            "\u2197 " + label + " \xB7 " + target
          );
        };
        const section = function(title, body) {
          return h(
            "div",
            { style: { borderTop: "1px solid var(--dsw-alias-border-l1)", paddingTop: 10 } },
            h("div", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)", marginBottom: 6 } }, title),
            body
          );
        };
        const relationRows = [
          ["\u7236\u8BA1\u5212", node.parent ? [chip("\u7236", node.parent)] : []],
          ["\u5B50\u8BA1\u5212", children.map(function(id) {
            return chip("\u5B50", id);
          })],
          ["\u6307\u5411", outLinks.map(function(link) {
            return chip(link.label, link.id);
          })],
          ["\u88AB\u6307\u5411", inLinks.map(function(link) {
            return chip(link.label, link.id);
          })]
        ];
        return h(
          "div",
          {
            style: surfaceStyle({
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              /* 占据整个面板的一侧：从面板最上沿到最后下沿，
                 把标题栏（任务 / 计数 / 图例 / 新建 / 刷新）一起盖住。 */
              width: "min(600px, 100%)",
              boxSizing: "border-box",
              borderLeft: "1px solid var(--dsw-alias-border-l1)",
              background: "var(--dsw-alias-bg-layer-1)",
              padding: "12px 14px 14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              overflow: "auto",
              minHeight: 0,
              zIndex: 3
            })
          },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 8 } },
            h("span", { style: idChipStyle }, node.id),
            h("span", { style: kindChipStyle }, node.kind),
            h(
              "span",
              { style: { fontSize: 11, color: statusTone(node.status) } },
              "\u25CF " + node.status + " \xB7 " + state.code + " \xB7 " + groupLabel(node.status)
            ),
            h("span", { style: { flex: 1 } }),
            h(
              "button",
              {
                type: "button",
                onClick: props.onEdit,
                style: Object.assign({}, buttonBase(false), { padding: "2px 12px", marginRight: 8 })
              },
              props.canEdit === true ? "\u7F16\u8F91" : "\u5206\u652F"
            ),
            h(
              "button",
              {
                type: "button",
                onClick: props.onClose,
                style: Object.assign({}, buttonBase(false), { padding: "2px 12px" })
              },
              "\u5173\u95ED"
            )
          ),
          h(
            "div",
            { style: { fontSize: 17, fontWeight: 600, lineHeight: 1.35, color: "var(--dsw-alias-label-primary)" } },
            node.title
          ),
          h(
            "div",
            {
              style: {
                fontSize: 12,
                lineHeight: 1.6,
                color: "var(--dsw-alias-label-secondary)",
                background: "var(--dsw-alias-bg-layer-2)",
                borderRadius: 8,
                padding: "6px 10px"
              }
            },
            h(
              "span",
              { style: { color: statusTone(node.status), fontWeight: 600 } },
              node.status + "\uFF08" + state.code + " \xB7 " + groupLabel(node.status) + "\uFF09"
            ),
            "\u3000" + state.desc
          ),
          actions.length > 0 || props.error ? h(
            "div",
            { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 } },
            actions.map(function(item) {
              return h(
                "button",
                {
                  key: "action-" + item.to,
                  type: "button",
                  disabled: props.busy === true,
                  onClick: function() {
                    props.onState(item.to);
                  },
                  style: buttonBase(item.primary, props.busy)
                },
                item.label
              );
            }),
            props.error ? h(
              "span",
              {
                style: {
                  fontSize: 11,
                  color: "var(--dsw-alias-state-error-primary)",
                  maxWidth: 320,
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }
              },
              props.error
            ) : null
          ) : null,
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 3, fontSize: 12, lineHeight: "20px" } },
            h(
              "div",
              null,
              h("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, "\u542F\u7528\u3000"),
              node.on ? "\u662F\uFF08\u53EF\u88AB\u9886\u53D6\uFF09" : "\u5426\uFF08\u8349\u7A3F/\u5173\u95ED\uFF0C\u4E0D\u53EF\u9886\u53D6\uFF09"
            ),
            h(
              "div",
              null,
              h("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, "\u5B50\u5DE5\u4F5C\u7A7A\u95F4\u3000"),
              node.workspace || "\uFF08\u672A\u6307\u5B9A\uFF0C\u6309\u4F1A\u8BDD\u76EE\u5F55\uFF09"
            ),
            h(
              "div",
              null,
              h("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, "\u989D\u5916\u5DE5\u4F5C\u533A\u3000"),
              node.workspaces || "\uFF08\u65E0\uFF09"
            ),
            h(
              "div",
              null,
              h("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, "\u6743\u9650\u3000"),
              node.permission || "\uFF08\u672A\u6307\u5B9A\uFF09"
            )
          ),
          section(
            "\u5173\u7CFB",
            h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 6 } },
              relationRows.map(function(row) {
                return h(
                  "div",
                  { key: "relrow-" + row[0], style: { display: "flex", gap: 8, alignItems: "flex-start" } },
                  h(
                    "span",
                    { style: { width: 56, flex: "none", fontSize: 11, lineHeight: "24px", color: "var(--dsw-alias-label-secondary)" } },
                    row[0]
                  ),
                  h(
                    "div",
                    { style: { display: "flex", flexWrap: "wrap", gap: 6, flex: 1 } },
                    row[1].length ? row[1] : h("span", { style: { fontSize: 11, lineHeight: "24px", color: "var(--dsw-alias-label-secondary)" } }, "\u2014")
                  )
                );
              })
            )
          ),
          section(
            "\u5907\u6CE8 / \u6401\u7F6E\u7406\u7531",
            h(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: 6 } },
              h(
                "div",
                {
                  style: {
                    fontSize: 12,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    color: node.note ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)"
                  }
                },
                node.note || "\uFF08\u8FD8\u6CA1\u6709\u5907\u6CE8\uFF09"
              ),
              !node.note && (node.status === "\u9700\u8981\u6388\u6743" || node.status === "\u9700\u8981\u8865\u5145") ? h(
                "div",
                { style: { fontSize: 11, color: "var(--dsw-alias-state-warn-primary)" } },
                "\u8FD9\u5F20\u8BA1\u5212\u505C\u5728\u300C" + node.status + "\u300D\uFF0C\u4F46\u6CA1\u6709\u5199\u4E3A\u4EC0\u4E48\u2014\u2014\u5EFA\u8BAE\u8865\u4E00\u53E5\u3002"
              ) : null,
              h(
                "div",
                { style: { display: "flex", gap: 6, alignItems: "flex-start" } },
                h("textarea", {
                  value: props.noteDraft === void 0 ? "" : props.noteDraft,
                  placeholder: "\u5199\u6E05\u4E3A\u4EC0\u4E48\u505C\u5728\u8FD9\u91CC\uFF1A\u5728\u7B49\u8C01\u3001\u7B49\u4EC0\u4E48\u3001\u4EC0\u4E48\u65F6\u5019\u80FD\u7EE7\u7EED\u3002",
                  onChange: function(event) {
                    props.onNoteDraft(event.target.value);
                  },
                  rows: 3,
                  style: Object.assign({}, formInputStyle, {
                    flex: 1,
                    resize: "vertical",
                    fontFamily: "inherit",
                    lineHeight: 1.6
                  })
                }),
                h(
                  "div",
                  { style: { display: "flex", flexDirection: "column", gap: 6 } },
                  h(
                    "button",
                    {
                      type: "button",
                      disabled: props.busy === true,
                      onClick: function() {
                        props.onSaveNote(props.noteDraft === void 0 ? "" : props.noteDraft);
                      },
                      style: buttonBase(true, props.busy)
                    },
                    "\u4FDD\u5B58\u5907\u6CE8"
                  ),
                  props.noteError ? h(
                    "span",
                    {
                      style: {
                        fontSize: 11,
                        color: "var(--dsw-alias-state-error-primary)",
                        maxWidth: 160
                      }
                    },
                    props.noteError
                  ) : null
                )
              )
            )
          ),
          section(
            "\u6B63\u6587",
            h(
              "div",
              { style: { fontSize: 13, lineHeight: 1.7, color: "var(--dsw-alias-label-secondary)" } },
              node.summary,
              props.body ? h("div", { style: { marginTop: 10, whiteSpace: "pre-wrap", color: "var(--dsw-alias-label-primary)" } }, props.body) : null
            )
          )
        );
      }
      function parseTemplateYaml(saw) {
        const lines = String(saw || "").split(/\r?\n/u);
        const out = { name: "", description: "", items: [] };
        let item = null;
        let section = "";
        let blockKey = "";
        let blockLines = [];
        const flushBlock = function() {
          if (item && blockKey) item[blockKey] = blockLines.join("\n").trim();
          blockKey = "";
          blockLines = [];
        };
        lines.forEach(function(raw) {
          if (blockKey) {
            if (raw.trim() === "" || /^\s{4,}/u.test(raw)) {
              blockLines.push(raw.replace(/^\s{4}/u, ""));
              return;
            }
            flushBlock();
          }
          const trimmed = raw.trim();
          if (trimmed === "" || trimmed.charAt(0) === "#") return;
          let match = /^name:\s*(.+)$/u.exec(trimmed);
          if (match && item === null) {
            out.name = match[1].replace(/^["']|["']$/gu, "");
            return;
          }
          match = /^description:\s*(.+)$/u.exec(trimmed);
          if (match && item === null) {
            out.description = match[1].replace(/^["']|["']$/gu, "");
            return;
          }
          match = /^-\s+type:\s*(.+)$/u.exec(trimmed);
          if (match) {
            item = { type: match[1].trim(), required: false };
            out.items.push(item);
            section = "";
            return;
          }
          if (item === null) return;
          if (/^attributes:/u.test(trimmed)) {
            section = "attributes";
            return;
          }
          if (/^validations:/u.test(trimmed)) {
            section = "validations";
            return;
          }
          match = /^([a-z-]+):\s*(.*)$/u.exec(trimmed);
          if (!match) return;
          const key = match[1];
          const value = match[2];
          if (value === "|") {
            blockKey = key;
            blockLines = [];
            return;
          }
          if (key === "required") {
            item.required = value === "true";
            return;
          }
          if (key === "id") {
            item.id = value;
            return;
          }
          if (section === "attributes" && (key === "label" || key === "description" || key === "placeholder" || key === "value")) {
            item[key] = value.replace(/^["']|["']$/gu, "");
          }
        });
        flushBlock();
        return out;
      }
      function parseSections(body) {
        const out = {};
        const lines = String(body || "").split(/\r?\n/u);
        let label = "";
        let buffer = [];
        const flush = function() {
          if (label !== "") out[label.trim()] = buffer.join("\n").trim();
          label = "";
          buffer = [];
        };
        lines.forEach(function(line) {
          const match = /^##\s+(.+)$/u.exec(line);
          if (match) {
            flush();
            label = match[1];
            return;
          }
          if (label !== "") buffer.push(line);
        });
        flush();
        return out;
      }
      const TYPE_LABELS = [
        ["A", "\u95EE\u9898"],
        ["B", "\u8BBE\u8BA1"],
        ["C", "\u63A5\u53E3"],
        ["D", "\u5B9E\u73B0"],
        ["R", "\u7814\u7A76"],
        ["F", "\u590D\u76D8"],
        ["H1", "\u6401\u7F6E \xB7 \u6388\u6743-\u4EE3\u4EF7\u8FC7\u5927"],
        ["H2", "\u6401\u7F6E \xB7 \u6388\u6743-\u7528\u6237\u8F6C\u79FB\u8BDD\u9898"],
        ["H3", "\u6401\u7F6E \xB7 \u6388\u6743-\u65B9\u6848\u7F3A\u9677\u8FC7\u5927"],
        ["H4", "\u6401\u7F6E \xB7 \u8865\u5145-\u7F3A\u7528\u6237\u4FE1\u606F"],
        ["H5", "\u6401\u7F6E \xB7 \u8865\u5145-\u9700\u8981\u5148\u8C03\u7814"],
        ["H6", "\u6401\u7F6E \xB7 \u6388\u6743-\u8D44\u6E90\u88AB\u5360\u7528"],
        ["H7", "\u6401\u7F6E \xB7 \u6388\u6743-\u7F3A\u6743\u9650/\u73AF\u5883"],
        ["H8", "\u6401\u7F6E \xB7 \u8865\u5145-\u5B50\u4EFB\u52A1\u672A\u56DE\u6536"]
      ];
      const formInputStyle = clickableStyle({
        width: "100%",
        boxSizing: "border-box",
        padding: "5px 8px",
        borderRadius: 8,
        background: "var(--dsw-alias-bg-layer-2)",
        color: "var(--dsw-alias-label-primary)",
        font: "inherit",
        fontSize: 12,
        lineHeight: "20px",
        outline: "none"
      });
      function CreateForm(props) {
        const init = props.initial || {};
        const templates = props.templates || {};
        const plans = props.plans || [];
        const initialType = typeof init.type === "string" ? init.type : "C";
        const initialTemplate = initialType !== "" && templates[initialType] ? parseTemplateYaml(templates[initialType]) : null;
        const initialValues = {};
        if (init.body && initialTemplate) {
          const sections = parseSections(init.body);
          initialTemplate.items.forEach(function(item) {
            const key = item.id || item.label || "";
            const found = sections[item.label || ""];
            if (key !== "" && found !== void 0) initialValues[key] = found;
          });
        }
        const titleState = React.useState(init.title || "");
        const title = titleState[0];
        const setTitle = titleState[1];
        const typeState = React.useState(initialType);
        const type = typeState[0];
        const setType = typeState[1];
        const valuesState = React.useState(initialValues);
        const values = valuesState[0];
        const setValues = valuesState[1];
        const workspaceState = React.useState(init.workspace || "");
        const workspace = workspaceState[0];
        const setWorkspace = workspaceState[1];
        const workspacesState = React.useState(init.workspaces || "");
        const workspaces = workspacesState[0];
        const setWorkspaces = workspacesState[1];
        const permissionState = React.useState(init.permission || "");
        const permission = permissionState[0];
        const setPermission = permissionState[1];
        const bodyState = React.useState(init.body || "");
        const body = bodyState[0];
        const setBody = bodyState[1];
        const parentState = React.useState(init.parent || "");
        const parent = parentState[0];
        const setParent = parentState[1];
        const linksState = React.useState(Array.isArray(init.links) ? init.links : []);
        const links = linksState[0];
        const setLinks = linksState[1];
        const errorState = React.useState("");
        const error = errorState[0];
        const setError = errorState[1];
        const template = type !== "" && templates[type] ? parseTemplateYaml(templates[type]) : null;
        const fields = template ? template.items.filter(function(item) {
          return item.type !== "markdown";
        }) : [];
        const updateLink = function(index, patch) {
          const next = links.slice();
          next[index] = Object.assign({}, next[index], patch);
          setLinks(next);
        };
        const submit = function() {
          if (title.trim() === "") {
            setError("\u6807\u9898\u4E0D\u80FD\u4E3A\u7A7A");
            return;
          }
          let text = "";
          if (type !== "") {
            const parts = [];
            let missing = "";
            fields.forEach(function(item) {
              const key = item.id || item.label || "field";
              const value = String(values[key] || "").trim();
              if (value === "") {
                if (item.required && missing === "") missing = item.label || item.id;
                return;
              }
              parts.push("## " + (item.label || item.id) + "\n\n" + value);
            });
            if (missing !== "") {
              setError(missing + " \u662F\u5FC5\u586B");
              return;
            }
            if (parts.length === 0) {
              if (init.body) {
                text = init.body;
              } else {
                setError("\u6A21\u677F\u5B57\u6BB5\u81F3\u5C11\u586B\u4E00\u9879");
                return;
              }
            } else {
              text = parts.join("\n\n");
            }
          } else {
            text = body;
          }
          setError("");
          const seen = {};
          const linkText = links.filter(function(link) {
            if (link.to === "") return false;
            const key = link.label + ":" + link.to;
            if (seen[key]) return false;
            seen[key] = true;
            return true;
          }).map(function(link) {
            return link.label + ":" + link.to;
          }).join(", ");
          props.onSubmit({
            title: title.trim(),
            type,
            body: text,
            parent,
            links: linkText,
            workspace: workspace.trim(),
            workspaces: workspaces.trim(),
            permission
          });
        };
        const optionsFor = function(placeholder) {
          return [{ id: "", title: placeholder }].concat(plans).map(function(item) {
            return h("option", { key: "opt-" + (item.id || "none"), value: item.id }, item.id === "" ? item.title : item.id + " \xB7 " + item.title);
          });
        };
        const lineStyle = { fontSize: 12, color: "var(--dsw-alias-label-secondary)" };
        return h(
          "div",
          {
            style: surfaceStyle({
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              boxSizing: "border-box",
              background: "var(--dsw-alias-bg-layer-1)",
              borderRadius: 12,
              padding: "10px 14px 12px",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              zIndex: 4
            })
          },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 8, padding: "10px 0 8px" } },
            h("span", { style: titleStyle }, props.title || "\u65B0\u5EFA\u8BA1\u5212"),
            h("span", { style: { flex: 1 } }),
            h("button", { type: "button", onClick: props.onCancel, style: Object.assign({}, buttonBase(false), { padding: "2px 12px" }) }, "\u53D6\u6D88")
          ),
          h(
            "div",
            { style: { display: "flex", gap: 18, flex: 1, minHeight: 0 } },
            h(
              "div",
              { style: { width: 440, flex: "none", display: "flex", flexDirection: "column", gap: 8, minHeight: 0, overflow: "auto", paddingRight: 6 } },
              h(
                "div",
                { style: { display: "flex", gap: 8 } },
                h("input", {
                  value: title,
                  placeholder: "\u6807\u9898\uFF08\u4E00\u53E5\u8BDD\uFF09",
                  onChange: function(event) {
                    setTitle(event.target.value);
                  },
                  style: Object.assign({}, formInputStyle, { flex: 1 })
                }),
                h(
                  "select",
                  {
                    value: type,
                    onChange: function(event) {
                      setType(event.target.value);
                    },
                    style: Object.assign({}, formInputStyle, { width: 132, flex: "none" })
                  },
                  [["", "\u7A7A\u6A21\u677F"]].concat(TYPE_LABELS).map(function(pair) {
                    return h("option", { key: "type-" + (pair[0] || "blank"), value: pair[0] }, pair[0] === "" ? pair[1] : pair[0] + " \xB7 " + pair[1]);
                  })
                )
              ),
              h(
                "div",
                { style: { display: "flex", gap: 8, alignItems: "center" } },
                h("span", { style: Object.assign({ width: 48, flex: "none" }, lineStyle) }, "\u7236\u8BA1\u5212"),
                h(
                  "select",
                  {
                    value: parent,
                    onChange: function(event) {
                      setParent(event.target.value);
                    },
                    style: Object.assign({}, formInputStyle, { flex: 1 })
                  },
                  optionsFor("\uFF08\u65E0\uFF0C\u9876\u5C42\uFF09")
                )
              ),
              h(
                "div",
                { style: { display: "flex", gap: 8, alignItems: "center" } },
                h("span", { style: Object.assign({ width: 48, flex: "none" }, lineStyle) }, "\u5DE5\u4F5C\u7A7A\u95F4"),
                h("input", {
                  value: workspace,
                  placeholder: "\u5B50\u5DE5\u4F5C\u7A7A\u95F4\u7EDD\u5BF9\u8DEF\u5F84\uFF08\u7A7A = \u4F1A\u8BDD\u76EE\u5F55\uFF09",
                  onChange: function(event) {
                    setWorkspace(event.target.value);
                  },
                  style: Object.assign({}, formInputStyle, { flex: 1 })
                })
              ),
              h(
                "div",
                { style: { display: "flex", gap: 8, alignItems: "center" } },
                h("span", { style: Object.assign({ width: 48, flex: "none" }, lineStyle) }, "\u989D\u5916"),
                h("input", {
                  value: workspaces,
                  placeholder: "\u989D\u5916\u5DE5\u4F5C\u533A\uFF0C\u9017\u53F7\u5206\u9694\u7684\u7EDD\u5BF9\u8DEF\u5F84\uFF08\u8981\u8BFB\u5199\u7684\u5176\u5B83\u76EE\u5F55\uFF0C\u53EF\u7A7A\uFF09",
                  onChange: function(event) {
                    setWorkspaces(event.target.value);
                  },
                  style: Object.assign({}, formInputStyle, { flex: 1 })
                })
              ),
              h(
                "div",
                { style: { display: "flex", gap: 8, alignItems: "center" } },
                h("span", { style: Object.assign({ width: 48, flex: "none" }, lineStyle) }, "\u6743\u9650"),
                h(
                  "select",
                  {
                    value: permission,
                    onChange: function(event) {
                      setPermission(event.target.value);
                    },
                    style: Object.assign({}, formInputStyle, { flex: 1 })
                  },
                  ["", "\u4EC5\u53EF\u67E5\u770B", "\u5DE5\u4F5C\u533A\u5185\u4FEE\u6539", "\u5B8C\u5168\u6743\u9650", "\u5DE5\u5177\u5168\u5173"].map(function(value) {
                    return h("option", { key: "perm-" + (value || "none"), value }, value === "" ? "\uFF08\u4E0D\u6307\u5B9A\uFF0C\u6309\u4F1A\u8BDD\u6863\u4F4D\uFF09" : value);
                  })
                )
              ),
              h("span", { style: lineStyle }, "\u5173\u8054\uFF08\u7BAD\u5934\u4ECE\u5148\u51B3\u6307\u5411\u4F9D\u8D56\u65B9\uFF09"),
              links.map(function(link, index) {
                return h(
                  "div",
                  { key: "link-row-" + index, style: { display: "flex", gap: 6, alignItems: "center" } },
                  h(
                    "select",
                    {
                      value: link.label,
                      onChange: function(event) {
                        updateLink(index, { label: event.target.value });
                      },
                      style: Object.assign({}, formInputStyle, { width: 128, flex: "none" })
                    },
                    [["\u4F9D\u8D56", "\u4F9D\u8D56\uFF08\u5B83\u5B8C\u6210\u6211\u624D\u80FD\u9886\uFF09"], ["\u6D3E\u751F", "\u6D3E\u751F\uFF08\u6211\u6D3E\u751F\u5B83\uFF09"], ["\u53D6\u4EE3", "\u53D6\u4EE3\uFF08\u66FF\u4EE3\u5B83\uFF09"], ["\u6765\u6E90", "\u6765\u6E90\uFF08\u6211\u6765\u81EA\u5B83\uFF09"]].map(function(pair) {
                      return h("option", { key: "kind-" + pair[0], value: pair[0] }, pair[1]);
                    })
                  ),
                  h(
                    "select",
                    {
                      value: link.to,
                      onChange: function(event) {
                        updateLink(index, { to: event.target.value });
                      },
                      style: Object.assign({}, formInputStyle, { flex: 1 })
                    },
                    optionsFor("\uFF08\u9009\u62E9\u76EE\u6807\uFF09")
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      onClick: function() {
                        const next = links.slice();
                        next.splice(index, 1);
                        setLinks(next);
                      },
                      style: Object.assign({}, buttonBase(false), { padding: "2px 10px" })
                    },
                    "\u5220\u9664"
                  )
                );
              }),
              h(
                "button",
                {
                  type: "button",
                  onClick: function() {
                    setLinks(links.concat([{ label: "\u4F9D\u8D56", to: "" }]));
                  },
                  style: Object.assign({}, buttonBase(false), { alignSelf: "flex-start" })
                },
                "\uFF0B \u6DFB\u52A0\u5173\u8054"
              )
            ),
            h(
              "div",
              { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8, minHeight: 0, overflow: "auto", paddingRight: 6, borderLeft: "1px solid var(--dsw-alias-border-l1)", paddingLeft: 16 } },
              template && type !== "" ? h("div", { style: lineStyle }, template.name + "\uFF1A" + template.description) : null,
              type !== "" ? h(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: 10 } },
                template ? template.items.map(function(item, index) {
                  if (item.type === "markdown") {
                    return h("div", { key: "md-" + index, style: { fontSize: 11, lineHeight: 1.6, color: "var(--dsw-alias-label-secondary)", whiteSpace: "pre-wrap" } }, item.value || "");
                  }
                  const key = item.id || item.label || "field-" + index;
                  const common = {
                    value: values[key] || "",
                    placeholder: item.placeholder || "",
                    onChange: function(event) {
                      const next = Object.assign({}, values);
                      next[key] = event.target.value;
                      setValues(next);
                    }
                  };
                  return h(
                    "label",
                    { key: "f-" + key, style: { display: "flex", flexDirection: "column", gap: 3 } },
                    h("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-primary)" } }, (item.label || item.id) + (item.required ? " *" : "")),
                    item.description ? h("span", { style: lineStyle }, item.description) : null,
                    item.type === "input" ? h("input", Object.assign({}, common, { style: formInputStyle })) : h("textarea", Object.assign({}, common, { rows: 3, style: Object.assign({}, formInputStyle, { resize: "vertical" }) }))
                  );
                }) : h("div", { style: lineStyle }, "\u6A21\u677F\u8FD8\u6CA1\u52A0\u8F7D\u51FA\u6765\uFF08\u68C0\u67E5\u5BBF\u4E3B\u63D2\u4EF6\u662F\u5426\u5728\u8DD1\uFF09")
              ) : h("textarea", {
                value: body,
                placeholder: "\u6B63\u6587\uFF08Markdown\uFF09\u2014\u2014\u7A7A\u6A21\u677F\uFF0C\u4ECE\u96F6\u5199",
                onChange: function(event) {
                  setBody(event.target.value);
                },
                style: Object.assign({}, formInputStyle, { flex: 1, minHeight: 160, resize: "vertical" })
              })
            )
          ),
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--dsw-alias-border-l1)" } },
            h("button", { type: "button", disabled: props.busy === true, onClick: submit, style: buttonBase(true, props.busy) }, props.busy === true ? "\u63D0\u4EA4\u4E2D\u2026" : "\u63D0\u4EA4"),
            error || props.error ? h("span", { style: { fontSize: 11, color: "var(--dsw-alias-state-error-primary)" } }, error || props.error) : null
          )
        );
      }
      function TaskBoard(props) {
        const selectedState = React.useState("");
        const selected = selectedState[0];
        const setSelected = selectedState[1];
        const dataState = React.useState({ tasks: SAMPLE_TASKS, bodies: {}, live: false, error: "" });
        const data = dataState[0];
        const setData = dataState[1];
        const busyState = React.useState(false);
        const busy = busyState[0];
        const setBusy = busyState[1];
        const actionState = React.useState({ busy: false, error: "" });
        const action = actionState[0];
        const setAction = actionState[1];
        const noteState = React.useState({ id: "", draft: "", error: "" });
        const note = noteState[0];
        const setNote = noteState[1];
        const createState = React.useState({ open: false, busy: false, error: "" });
        const create = createState[0];
        const setCreate = createState[1];
        const editState = React.useState("");
        const editId = editState[0];
        const setEditId = editState[1];
        const editModePair = React.useState("edit");
        const editMode = editModePair[0];
        const setEditMode = editModePair[1];
        const templatesState = React.useState({});
        const templates = templatesState[0];
        const setTemplates = templatesState[1];
        const sessionId = props.sessionId;
        const load = React.useCallback(function() {
          if (typeof sessionId !== "string" || sessionId === "") return;
          setBusy(true);
          const files = fileRpc();
          if (files === null) {
            setData({ tasks: SAMPLE_TASKS, bodies: {}, live: false, error: "\u6CA1\u6709\u6587\u4EF6 RPC\uFF08workspaceFiles\uFF09\uFF0C\u8BFB\u4E0D\u5230\u8BA1\u5212\u5E93" });
            setBusy(false);
            return;
          }
          Promise.resolve(files.read(sessionId, STORE_FILE, { limit: 5e3 }, void 0)).then(function(result) {
            if (!result || result.ok !== true) {
              throw new Error("\u8BFB\u53D6\u8BA1\u5212\u5E93\u5931\u8D25\uFF1A" + String(result && result.error && result.error.message || "\u672A\u77E5\u9519\u8BEF"));
            }
            const text = result.value.text || "";
            const map = {};
            text.split(/\r?\n/u).forEach(function(line) {
              if (line.trim() === "") return;
              let event = null;
              try {
                event = JSON.parse(line);
              } catch (failure) {
                return;
              }
              if (!event) return;
              if (event.op === "upsert" && event.task && event.task.id) {
                map[event.task.id] = event.task;
              } else if (event.op === "patch" && event.id && map[event.id]) {
                map[event.id] = Object.assign({}, map[event.id], event.patch);
              }
            });
            const rows = Object.keys(map).sort().map(function(id) {
              return map[id];
            });
            const bodies = {};
            rows.forEach(function(row) {
              bodies[row.id] = row.body || "";
            });
            setData({ tasks: rows.map(fromApi), bodies, live: true, error: "" });
          }).catch(function(error) {
            setData({ tasks: SAMPLE_TASKS, bodies: {}, live: false, error: String(error && error.message || error) });
          }).then(function() {
            setBusy(false);
          });
        }, [sessionId]);
        React.useEffect(
          function() {
            load();
          },
          [load]
        );
        const runState = function(next) {
          if (!activeNodeId) return;
          setAction({ busy: true, error: "" });
          runCommand("/task-state " + activeNodeId + " " + next, sessionId).then(function(settled) {
            const text = commandText(settled);
            if (text.indexOf("\u72B6\u6001\u6539\u4E3A") === -1) setAction({ busy: false, error: text || "\u72B6\u6001\u6CA1\u6539\u6210" });
            else setAction({ busy: false, error: "" });
            load();
          }).catch(function(error) {
            setAction({ busy: false, error: String(error && error.message || error) });
          });
        };
        const saveNote = function(value) {
          if (!activeNodeId) return;
          setNote({ id: activeNodeId, draft: value, error: "", busy: true });
          runCommand("/task-note " + activeNodeId + " " + String(value || ""), sessionId).then(function(settled) {
            const text = commandText(settled);
            let saved = null;
            try {
              saved = JSON.parse(text);
            } catch (failure) {
              saved = null;
            }
            if (saved && typeof saved.note === "string") {
              setNote({ id: activeNodeId, draft: saved.note, error: "" });
            } else {
              setNote({ id: activeNodeId, draft: value, error: text || "\u5907\u6CE8\u6CA1\u4FDD\u5B58\u4E0A" });
            }
            load();
          }).catch(function(error) {
            setNote({ id: activeNodeId, draft: value, error: String(error && error.message || error) });
          });
        };
        const openCreate = function() {
          setEditId("");
          setCreate({ open: true, busy: false, error: "" });
          if (Object.keys(templates).length > 0) return;
          const files = fileRpc();
          if (files === null) {
            setCreate({ open: true, busy: false, error: "\u8BFB\u4E0D\u5230\u6A21\u677F\uFF1A\u6CA1\u6709\u6587\u4EF6 RPC" });
            return;
          }
          const types = [
            "A",
            "B",
            "C",
            "D",
            "R",
            "F",
            "H1",
            "H2",
            "H3",
            "H4",
            "H5",
            "H6",
            "H7",
            "H8"
          ];
          Promise.all(
            types.map(function(type) {
              return Promise.resolve(files.read(sessionId, TEMPLATE_DIR + "\\" + type + ".yml", { limit: 400 }, void 0)).then(function(result) {
                return result && result.ok === true ? [type, result.value.text] : [type, ""];
              }).catch(function() {
                return [type, ""];
              });
            })
          ).then(function(pairs) {
            const map = {};
            pairs.forEach(function(pair) {
              if (pair[1]) map[pair[0]] = pair[1];
            });
            setTemplates(map);
          }).catch(function(error) {
            setCreate({ open: true, busy: false, error: String(error && error.message || error) });
          });
        };
        const submitCreate = function(payload) {
          setCreate({ open: true, busy: true, error: "" });
          runCommand("/task-create " + JSON.stringify(payload), sessionId).then(function(settled) {
            const text = commandText(settled);
            let id = "";
            try {
              id = JSON.parse(text).id || "";
            } catch (failure) {
              id = "";
            }
            setCreate({ open: false, busy: false, error: "" });
            load();
            if (id) setSelected(id);
          }).catch(function(error) {
            setCreate({ open: true, busy: false, error: String(error && error.message || error) });
          });
        };
        const submitUpdate = function(payload) {
          if (!editId) return;
          setCreate({ open: false, busy: true, error: "" });
          const forking = editMode === "fork";
          const line = forking ? "/task-create " + JSON.stringify(Object.assign({}, payload, { status: "\u672A\u6307\u5B9A" })) : "/task-update " + JSON.stringify(Object.assign({ id: editId }, payload));
          runCommand(line, sessionId).then(function(settled) {
            setEditId("");
            if (forking) {
              try {
                const created = JSON.parse(commandText(settled));
                if (created && created.id) setSelected(created.id);
              } catch (failure) {
              }
            }
            load();
          }).catch(function(error) {
            setCreate({ open: false, busy: false, error: String(error && error.message || error) });
          });
        };
        const tasks = data.tasks;
        const graph = React.useMemo(
          function() {
            return buildGraph(tasks);
          },
          [tasks]
        );
        const activeNode = selected && graph.byId[selected] ? graph.byId[selected].node : null;
        const activeId = activeNode ? activeNode.id : "";
        const activeNodeId = activeId;
        const editNode = editId && graph.byId[editId] ? graph.byId[editId].node : null;
        const editInitial = editNode ? {
          id: editNode.id,
          title: editMode === "fork" ? editNode.title + "\uFF08\u5206\u652F\uFF09" : editNode.title,
          type: editNode.typeCode || "",
          body: data.bodies[editNode.id] || "",
          parent: editNode.parent || "",
          workspace: editNode.workspace || "",
          workspaces: editNode.workspaces || "",
          permission: editNode.permission || "",
          links: (editNode.links || []).map(function(link) {
            return { label: link.label, to: link.to };
          }).concat(editMode === "fork" ? [{ label: "\u53D6\u4EE3", to: editNode.id }] : [])
        } : null;
        let enabledCount = 0;
        tasks.forEach(function(node) {
          if (node.on) enabledCount += 1;
        });
        const legendItem = function(key, dashed, label) {
          return h(
            "span",
            {
              key: "legend-" + key,
              style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--dsw-alias-label-secondary)" }
            },
            h(
              "svg",
              { width: 18, height: 8, style: { display: "block" } },
              h("line", {
                x1: 0,
                y1: 4,
                x2: 18,
                y2: 4,
                stroke: dashed ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l2)",
                strokeWidth: 1.5,
                strokeDasharray: dashed ? "4 3" : "none"
              })
            ),
            label
          );
        };
        return h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minHeight: 0,
              flex: 1,
              /* 覆盖层（详情 / 新建 / 编辑）挂在这一层上，才能盖住上面的标题栏；
                 它们需要 absolute 定位，所以这一层必须是定位祖先。 */
              position: "relative"
            }
          },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 8 } },
            h("span", { style: titleStyle }, t("panel.title")),
            h(
              "span",
              { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary)" } },
              t("board.count").replace("{n}", String(tasks.length)).replace("{on}", String(enabledCount))
            ),
            data.live ? null : h(
              "span",
              {
                style: clickableStyle({
                  fontSize: 10.5,
                  padding: "0 6px",
                  borderRadius: 999,
                  color: "var(--dsw-alias-label-secondary)"
                })
              },
              "\u6837\u4F8B\u6570\u636E" + (data.error ? "\uFF1A" + data.error : "")
            ),
            legendItem("parent", false, "\u7236\u5B50"),
            legendItem("link", true, "\u94FE\u63A5"),
            h("span", { style: { flex: 1 } }),
            h(
              "button",
              { type: "button", onClick: openCreate, style: buttonBase(false) },
              "\u65B0\u5EFA"
            ),
            h(
              "button",
              { type: "button", onClick: load, style: buttonBase(false, busy), disabled: busy },
              busy ? "\u5237\u65B0\u4E2D\u2026" : "\u5237\u65B0"
            )
          ),
          h(
            "div",
            { style: { display: "flex", minHeight: 0, flex: 1, position: "relative" } },
            h("div", { style: { flex: 1, minWidth: 0 } }, h(TechTree, { graph, selected, onSelect: setSelected }))
          ),
          editNode ? h(CreateForm, {
            initial: editInitial,
            title: editMode === "fork" ? "\u5206\u652F\u8BA1\u5212\uFF08\u53D6\u4EE3\u539F\u8BA1\u5212\uFF09" : "\u7F16\u8F91\u8BA1\u5212",
            plans: tasks,
            busy: create.busy,
            error: create.error,
            onCancel: function() {
              setEditId("");
            },
            onSubmit: submitUpdate
          }) : create.open ? h(CreateForm, {
            templates,
            plans: tasks,
            busy: create.busy,
            error: create.error,
            onCancel: function() {
              setCreate({ open: false, busy: false, error: "" });
            },
            onSubmit: submitCreate
          }) : activeNode ? h(DetailPane, {
            node: activeNode,
            tasks,
            body: data.bodies[activeId] || "",
            busy: action.busy,
            error: action.error,
            onState: runState,
            onClose: function() {
              setSelected("");
            },
            onJump: setSelected,
            canEdit: activeNode.status === "\u672A\u6307\u5B9A",
            onEdit: function() {
              setEditMode(activeNode.status === "\u672A\u6307\u5B9A" ? "edit" : "fork");
              setEditId(activeNode.id);
            },
            /* 备注草稿：切到另一张计划时自动换成那张的备注。 */
            noteDraft: note.id === activeNode.id ? note.draft : activeNode.note || "",
            noteError: note.id === activeNode.id ? note.error : "",
            onNoteDraft: function(value) {
              setNote({ id: activeNode.id, draft: value, error: "" });
            },
            onSaveNote: saveNote
          }) : null
        );
      }
      function buttonStyle(open, hover) {
        return clickableStyle({
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          padding: 0,
          borderRadius: 9,
          background: open || hover ? "var(--dsw-alias-bg-layer-2)" : "var(--dsw-alias-bg-layer-1)",
          color: open ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)",
          cursor: "pointer",
          font: "inherit",
          transition: "background 120ms ease, color 120ms ease, border-color 120ms ease, box-shadow 120ms ease"
        });
      }
      function Chevron(props) {
        const open = props.open;
        return h(
          "svg",
          {
            viewBox: "0 0 16 16",
            width: 16,
            height: 16,
            "aria-hidden": true,
            focusable: false,
            style: {
              display: "block",
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform 160ms ease"
            }
          },
          h("path", {
            d: "M3.6 10.2 L8 5.8 L12.4 10.2",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.7,
            strokeLinecap: "round",
            strokeLinejoin: "round"
          })
        );
      }
      class PanelBoundary extends React.Component {
        constructor(props) {
          super(props);
          this.state = { error: "" };
        }
        static getDerivedStateFromError(error) {
          return { error: String(error && error.message || error) };
        }
        render() {
          if (this.state.error !== "") {
            return h(
              "div",
              {
                style: {
                  padding: "10px 12px",
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: "var(--dsw-alias-state-error-primary)"
                }
              },
              "\u9762\u677F\u6E32\u67D3\u51FA\u9519\uFF1A" + this.state.error
            );
          }
          return this.props.children;
        }
      }
      function ComposerDrawer(props) {
        const state = React.useState(false);
        const open = state[0];
        const setOpen = state[1];
        const hoverPair = React.useState(false);
        const hover = hoverPair[0];
        const setHover = hoverPair[1];
        useLocaleRevision();
        const toggle = React.useCallback(function() {
          setOpen(function(current) {
            return !current;
          });
        }, [setOpen]);
        const label = open ? t("button.collapse") : t("button.expand");
        const panel = open ? h(
          "section",
          {
            key: "panel",
            id: PANEL_ID,
            role: "region",
            "aria-label": t("panel.title"),
            style: panelStyle
          },
          h(PanelBoundary, null, h(TaskBoard, { sessionId: props.sessionId }))
        ) : null;
        const button = h(
          "button",
          {
            key: "button",
            type: "button",
            onClick: toggle,
            onMouseEnter: function() {
              setHover(true);
            },
            onMouseLeave: function() {
              setHover(false);
            },
            "aria-expanded": open,
            "aria-controls": PANEL_ID,
            "aria-label": label,
            style: buttonStyle(open, hover)
          },
          h(Chevron, { open })
        );
        return h("div", { style: wrapperStyle }, panel, h("div", { style: buttonSlotStyle }, button));
      }
      return {
        inject: ["slots", "remote", "remote.commands", "remote.workspaceFiles"],
        apply(ctx) {
          pluginRuntime = ctx;
          try {
            localeFace = typeof ctx.get === "function" ? ctx.get("locale") : null;
          } catch (failure) {
            localeFace = null;
          }
          if (localeFace && typeof localeFace.register === "function" && typeof localeFace.bind === "function") {
            try {
              ctx.effect(function() {
                return localeFace.register(NS, "en", EN);
              });
              ctx.effect(function() {
                return localeFace.register(NS, "zh", ZH);
              });
              translate = localeFace.bind(NS);
            } catch (failure) {
              translate = null;
            }
          }
          ctx.effect(function() {
            return function() {
              translate = null;
              localeFace = null;
            };
          });
          ctx.slots.inject("conversation.input.dock", function() {
            return ctx.slots.register(
              {
                name: "conversation.input.dock",
                id: "composer-drawer",
                /* Last row of the dock: rows above it (todo / goal / queue) then
                   grow upward without pushing the button off the card's corner. */
                order: 999
              },
              ComposerDrawer
            );
          });
        }
      };
    }
  });
})();
/*! Bundled license information:

@dagrejs/dagre/dist/dagre.esm.js:
  (*! For license information please see dagre.esm.js.LEGAL.txt *)
*/
