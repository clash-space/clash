#!/usr/bin/env node
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity();
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path) {
      const ctrl = callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visit_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = visit_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path) {
      const ctrl = await callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visitAsync_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path) {
      if (typeof visitor === "function")
        return visitor(key, node, path);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path);
      return void 0;
    }
    function replaceNode(key, path, node) {
      const parent = path[path.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid2 = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid2);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const { anchors: anchors2, doc, maxAliasCount } = ctx;
        const source = this.resolve(doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        let data = anchors2.get(source);
        if (!data) {
          toJS.toJS(source, null, ctx);
          data = anchors2.get(source);
        }
        if (data?.res === void 0) {
          const msg = "This should not happen: Alias anchor was not resolved?";
          throw new ReferenceError(msg);
        }
        if (maxAliasCount >= 0) {
          data.count += 1;
          if (data.aliasCount === 0)
            data.aliasCount = getAliasCount(doc, source, anchors2);
          if (data.count * data.aliasCount > maxAliasCount) {
            const msg = "Excessive alias count indicates a resource exhaustion attack";
            throw new ReferenceError(msg);
          }
        }
        return data.res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path, value) {
      let v = value;
      for (let i = path.length - 1; i >= 0; --i) {
        const k = path[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path, value) {
        if (isEmptyPath(path))
          this.add(value);
        else {
          const [key, ...rest] = path;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        const [key, ...rest] = path;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        const [key, ...rest] = path;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text;
      if (onFold)
        onFold();
      let res = text.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text.length;
        if (fold === 0)
          res = `
${indent}${text.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text[fold]}\\`;
          res += `
${indent}${text.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text[++i];
        } else {
          do {
            ch = text[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text[start];
        }
      }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start ? str + json.slice(start) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify2(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify2;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify2 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify2.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify2.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/log.js"(exports) {
    "use strict";
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify2 = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify2.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/Pair.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify2 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify3 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify3(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify2.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify2.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/map.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/seq.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/string.js"(exports) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/common/null.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/core/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/json/schema.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    "use strict";
    var node_buffer = __require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports.schema = schema;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/tags.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports.Schema = Schema;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify2 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify2.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify2.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify2.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/doc/Document.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        if (Collection.isEmptyPath(path)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        if (Collection.isEmptyPath(path))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path) {
        if (Collection.isEmptyPath(path))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        if (Collection.isEmptyPath(path)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/errors.js"(exports) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep: sep2, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep2?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep2) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep2 ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep2, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep2 = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep2 + cb;
              sep2 = "";
              break;
            }
            case "newline":
              if (comment)
                sep2 += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key, sep: sep2, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep2?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep2 && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep2 && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep2, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep2 ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep2)
                for (const st of sep2) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep2, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports.composeCollection = composeCollection;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep2 = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep2 + indent.slice(trimIndent) + content;
          sep2 = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep2 === " ")
            sep2 = "\n";
          else if (!prevMoreIndented && sep2 === "\n")
            sep2 = "\n\n";
          value += sep2 + indent.slice(trimIndent) + content;
          sep2 = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep2 === "\n")
            value += "\n";
          else
            sep2 = "\n";
        } else {
          value += sep2 + content;
          sep2 = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return foldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return foldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function foldLines(source) {
      let first, line;
      try {
        first = new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
        line = new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
      } catch {
        first = /(.*?)[ \t]*\r?\n/sy;
        line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
      }
      let match = first.exec(source);
      if (!match)
        return source;
      let res = match[1];
      let sep2 = " ";
      let pos = first.lastIndex;
      line.lastIndex = pos;
      while (match = line.exec(source)) {
        if (match[1] === "") {
          if (sep2 === "\n")
            res += sep2;
          else
            sep2 = "\n";
        } else {
          res += sep2 + match[1];
          sep2 = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep2 + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-node.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify2 = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep: sep2, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep2)
        for (const st of sep2)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports.stringify = stringify2;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path) => {
      let item = cst;
      for (const [field2, index] of path) {
        const tok = item?.[field2];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path) => {
      const parent = visit.itemAtPath(cst, path.slice(0, -1));
      const field2 = path[path.length - 1][0];
      const coll = parent?.[field2];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path, item, visitor) {
      let ctrl = visitor(item, path);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field2 of ["key", "value"]) {
        const token = item[field2];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path.concat([[field2, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field2 === "key")
            ctrl = ctrl(item, path);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
    }
    exports.visit = visit;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/cst.js"(exports) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/lexer.js"(exports) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/line-counter.js"(exports) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i) {
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep2;
          if (scalar.end) {
            sep2 = scalar.end;
            sep2.push(this.sourceToken);
            delete scalar.end;
          } else
            sep2 = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep: sep2 }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep2 = it.sep;
                  sep2.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep: sep2 }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep2 = fc.end.splice(1, fc.end.length);
            sep2.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep: sep2 }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports.Parser = Parser;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse2(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify2(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse2;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument;
    exports.stringify = stringify2;
  }
});

// ../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "../../node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity.isAlias;
    exports.isCollection = identity.isCollection;
    exports.isDocument = identity.isDocument;
    exports.isMap = identity.isMap;
    exports.isNode = identity.isNode;
    exports.isPair = identity.isPair;
    exports.isScalar = identity.isScalar;
    exports.isSeq = identity.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit.visit;
    exports.visitAsync = visit.visitAsync;
  }
});

// src/adapter.ts
import { mkdir, writeFile } from "fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";

// ../../node_modules/.pnpm/zod@3.24.4/node_modules/zod/lib/index.mjs
var util;
(function(util2) {
  util2.assertEqual = (val) => val;
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue2) {
      return issue2.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue2 of error.issues) {
        if (issue2.code === "invalid_union") {
          issue2.unionErrors.map(processError);
        } else if (issue2.code === "invalid_return_type") {
          processError(issue2.returnTypeError);
        } else if (issue2.code === "invalid_arguments") {
          processError(issue2.argumentsError);
        } else if (issue2.path.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue2.path.length) {
            const el = issue2.path[i];
            const terminal = i === issue2.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue2));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue2) => issue2.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
        fieldErrors[sub.path[0]].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};
var errorMap = (issue2, _ctx) => {
  let message;
  switch (issue2.code) {
    case ZodIssueCode.invalid_type:
      if (issue2.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue2.expected}, received ${issue2.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue2.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue2.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue2.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue2.options)}, received '${issue2.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue2.validation === "object") {
        if ("includes" in issue2.validation) {
          message = `Invalid input: must include "${issue2.validation.includes}"`;
          if (typeof issue2.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue2.validation.position}`;
          }
        } else if ("startsWith" in issue2.validation) {
          message = `Invalid input: must start with "${issue2.validation.startsWith}"`;
        } else if ("endsWith" in issue2.validation) {
          message = `Invalid input: must end with "${issue2.validation.endsWith}"`;
        } else {
          util.assertNever(issue2.validation);
        }
      } else if (issue2.validation !== "regex") {
        message = `Invalid ${issue2.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue2.type === "array")
        message = `Array must contain ${issue2.exact ? "exactly" : issue2.inclusive ? `at least` : `more than`} ${issue2.minimum} element(s)`;
      else if (issue2.type === "string")
        message = `String must contain ${issue2.exact ? "exactly" : issue2.inclusive ? `at least` : `over`} ${issue2.minimum} character(s)`;
      else if (issue2.type === "number")
        message = `Number must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${issue2.minimum}`;
      else if (issue2.type === "date")
        message = `Date must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue2.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue2.type === "array")
        message = `Array must contain ${issue2.exact ? `exactly` : issue2.inclusive ? `at most` : `less than`} ${issue2.maximum} element(s)`;
      else if (issue2.type === "string")
        message = `String must contain ${issue2.exact ? `exactly` : issue2.inclusive ? `at most` : `under`} ${issue2.maximum} character(s)`;
      else if (issue2.type === "number")
        message = `Number must be ${issue2.exact ? `exactly` : issue2.inclusive ? `less than or equal to` : `less than`} ${issue2.maximum}`;
      else if (issue2.type === "bigint")
        message = `BigInt must be ${issue2.exact ? `exactly` : issue2.inclusive ? `less than or equal to` : `less than`} ${issue2.maximum}`;
      else if (issue2.type === "date")
        message = `Date must be ${issue2.exact ? `exactly` : issue2.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue2.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue2.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue2);
  }
  return { message };
};
var overrideErrorMap = errorMap;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue2 = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === errorMap ? void 0 : errorMap
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue2);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message === null || message === void 0 ? void 0 : message.message;
})(errorUtil || (errorUtil = {}));
var _ZodEnum_cache;
var _ZodNativeEnum_cache;
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (this._key instanceof Array) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    var _a, _b;
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message !== null && message !== void 0 ? message : ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: (_a = message !== null && message !== void 0 ? message : required_error) !== null && _a !== void 0 ? _a : ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: (_b = message !== null && message !== void 0 ? message : invalid_type_error) !== null && _b !== void 0 ? _b : ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    var _a;
    const ctx = {
      common: {
        issues: [],
        async: (_a = params === null || params === void 0 ? void 0 : params.async) !== null && _a !== void 0 ? _a : false,
        contextualErrorMap: params === null || params === void 0 ? void 0 : params.errorMap
      },
      path: (params === null || params === void 0 ? void 0 : params.path) || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    var _a, _b;
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if ((_b = (_a = err === null || err === void 0 ? void 0 : err.message) === null || _a === void 0 ? void 0 : _a.toLowerCase()) === null || _b === void 0 ? void 0 : _b.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params === null || params === void 0 ? void 0 : params.errorMap,
        async: true
      },
      path: (params === null || params === void 0 ? void 0 : params.path) || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if (!decoded.typ || !decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch (_a) {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch (_a) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    var _a, _b;
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof (options === null || options === void 0 ? void 0 : options.precision) === "undefined" ? null : options === null || options === void 0 ? void 0 : options.precision,
      offset: (_a = options === null || options === void 0 ? void 0 : options.offset) !== null && _a !== void 0 ? _a : false,
      local: (_b = options === null || options === void 0 ? void 0 : options.local) !== null && _b !== void 0 ? _b : false,
      ...errorUtil.errToObj(options === null || options === void 0 ? void 0 : options.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof (options === null || options === void 0 ? void 0 : options.precision) === "undefined" ? null : options === null || options === void 0 ? void 0 : options.precision,
      ...errorUtil.errToObj(options === null || options === void 0 ? void 0 : options.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options === null || options === void 0 ? void 0 : options.position,
      ...errorUtil.errToObj(options === null || options === void 0 ? void 0 : options.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  var _a;
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: (_a = params === null || params === void 0 ? void 0 : params.coerce) !== null && _a !== void 0 ? _a : false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / Math.pow(10, decCount);
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null, min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: (params === null || params === void 0 ? void 0 : params.coerce) || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch (_a) {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  var _a;
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: (_a = params === null || params === void 0 ? void 0 : params.coerce) !== null && _a !== void 0 ? _a : false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: (params === null || params === void 0 ? void 0 : params.coerce) || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: (params === null || params === void 0 ? void 0 : params.coerce) || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    return this._cached = { shape, keys };
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") ;
      else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue2, ctx) => {
          var _a, _b, _c, _d;
          const defaultError = (_c = (_b = (_a = this._def).errorMap) === null || _b === void 0 ? void 0 : _b.call(_a, issue2, ctx).message) !== null && _c !== void 0 ? _c : ctx.defaultError;
          if (issue2.code === "unrecognized_keys")
            return {
              message: (_d = errorUtil.errToObj(message).message) !== null && _d !== void 0 ? _d : defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    util.objectKeys(mask).forEach((key) => {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    });
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    util.objectKeys(this.shape).forEach((key) => {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    });
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    util.objectKeys(this.shape).forEach((key) => {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    });
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    util.objectKeys(this.shape).forEach((key) => {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    });
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [
          ctx.common.contextualErrorMap,
          ctx.schemaErrorMap,
          getErrorMap(),
          errorMap
        ].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [
          ctx.common.contextualErrorMap,
          ctx.schemaErrorMap,
          getErrorMap(),
          errorMap
        ].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  constructor() {
    super(...arguments);
    _ZodEnum_cache.set(this, void 0);
  }
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!__classPrivateFieldGet(this, _ZodEnum_cache, "f")) {
      __classPrivateFieldSet(this, _ZodEnum_cache, new Set(this._def.values), "f");
    }
    if (!__classPrivateFieldGet(this, _ZodEnum_cache, "f").has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
_ZodEnum_cache = /* @__PURE__ */ new WeakMap();
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  constructor() {
    super(...arguments);
    _ZodNativeEnum_cache.set(this, void 0);
  }
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!__classPrivateFieldGet(this, _ZodNativeEnum_cache, "f")) {
      __classPrivateFieldSet(this, _ZodNativeEnum_cache, new Set(util.getValidEnumValues(this._def.values)), "f");
    }
    if (!__classPrivateFieldGet(this, _ZodNativeEnum_cache, "f").has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
_ZodNativeEnum_cache = /* @__PURE__ */ new WeakMap();
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return base;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return base;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({ status: status.value, value: result }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      var _a, _b;
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          var _a2, _b2;
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = (_b2 = (_a2 = params.fatal) !== null && _a2 !== void 0 ? _a2 : fatal) !== null && _b2 !== void 0 ? _b2 : true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = (_b = (_a = params.fatal) !== null && _a !== void 0 ? _a : fatal) !== null && _b !== void 0 ? _b : true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;
var z = /* @__PURE__ */ Object.freeze({
  __proto__: null,
  defaultErrorMap: errorMap,
  setErrorMap,
  getErrorMap,
  makeIssue,
  EMPTY_PATH,
  addIssueToContext,
  ParseStatus,
  INVALID,
  DIRTY,
  OK,
  isAborted,
  isDirty,
  isValid,
  isAsync,
  get util() {
    return util;
  },
  get objectUtil() {
    return objectUtil;
  },
  ZodParsedType,
  getParsedType,
  ZodType,
  datetimeRegex,
  ZodString,
  ZodNumber,
  ZodBigInt,
  ZodBoolean,
  ZodDate,
  ZodSymbol,
  ZodUndefined,
  ZodNull,
  ZodAny,
  ZodUnknown,
  ZodNever,
  ZodVoid,
  ZodArray,
  ZodObject,
  ZodUnion,
  ZodDiscriminatedUnion,
  ZodIntersection,
  ZodTuple,
  ZodRecord,
  ZodMap,
  ZodSet,
  ZodFunction,
  ZodLazy,
  ZodLiteral,
  ZodEnum,
  ZodNativeEnum,
  ZodPromise,
  ZodEffects,
  ZodTransformer: ZodEffects,
  ZodOptional,
  ZodNullable,
  ZodDefault,
  ZodCatch,
  ZodNaN,
  BRAND,
  ZodBranded,
  ZodPipeline,
  ZodReadonly,
  custom,
  Schema: ZodType,
  ZodSchema: ZodType,
  late,
  get ZodFirstPartyTypeKind() {
    return ZodFirstPartyTypeKind;
  },
  coerce,
  any: anyType,
  array: arrayType,
  bigint: bigIntType,
  boolean: booleanType,
  date: dateType,
  discriminatedUnion: discriminatedUnionType,
  effect: effectsType,
  "enum": enumType,
  "function": functionType,
  "instanceof": instanceOfType,
  intersection: intersectionType,
  lazy: lazyType,
  literal: literalType,
  map: mapType,
  nan: nanType,
  nativeEnum: nativeEnumType,
  never: neverType,
  "null": nullType,
  nullable: nullableType,
  number: numberType,
  object: objectType,
  oboolean,
  onumber,
  optional: optionalType,
  ostring,
  pipeline: pipelineType,
  preprocess: preprocessType,
  promise: promiseType,
  record: recordType,
  set: setType,
  strictObject: strictObjectType,
  string: stringType,
  symbol: symbolType,
  transformer: effectsType,
  tuple: tupleType,
  "undefined": undefinedType,
  union: unionType,
  unknown: unknownType,
  "void": voidType,
  NEVER,
  ZodIssueCode,
  quotelessJson,
  ZodError
});

// ../../packages/shared-types/dist/chunk-JZFWVH64.js
var AssetKindSchema = z.enum(["image", "video", "audio", "model"]);
var ResourceIdSchema = z.string().trim().min(1);
var ResourceSchema = z.object({
  id: ResourceIdSchema,
  kind: AssetKindSchema,
  digest: z.object({
    algorithm: z.literal("sha256"),
    value: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict(),
  byteLength: z.number().int().nonnegative(),
  contentType: z.string().trim().min(1).optional()
}).strict();
var ProjectAssetMetadataSchema = z.object({
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  bytes: z.number().int().nonnegative().optional(),
  waveform: z.array(z.number()).optional(),
  contentType: z.string().trim().min(1).optional(),
  frameRate: z.number().positive().optional(),
  videoCodec: z.string().trim().min(1).optional(),
  audioCodec: z.string().trim().min(1).optional(),
  originalName: z.string().trim().min(1).optional()
}).strict();
var ProjectAssetProvenanceSchema = z.object({
  kind: z.enum(["import", "generation", "edit", "render", "admission"]),
  actionRunId: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  prompt: z.string().optional()
}).strict();
var ProjectAssetSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("owned"),
    resourceId: ResourceIdSchema
  }).strict(),
  z.object({
    kind: z.literal("linked"),
    resourceId: ResourceIdSchema,
    origin: z.object({
      scope: z.enum(["global", "catalog", "project"]),
      entryId: z.string().trim().min(1)
    }).strict()
  }).strict()
]);
var ProjectAssetLifecycleSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("active") }).strict(),
  z.object({
    state: z.literal("trashed"),
    deleteOperationId: z.string().trim().min(1),
    deletedAt: z.string().trim().min(1),
    purgeAfter: z.string().trim().min(1)
  }).strict(),
  z.object({
    state: z.literal("purged"),
    deleteOperationId: z.string().trim().min(1),
    deletedAt: z.string().trim().min(1),
    purgedAt: z.string().trim().min(1)
  }).strict()
]);
var ProjectAssetEntrySchema = z.object({
  id: z.string().trim().min(1),
  kind: AssetKindSchema,
  source: ProjectAssetSourceSchema,
  lifecycle: ProjectAssetLifecycleSchema,
  name: z.string().trim().min(1).optional(),
  metadata: ProjectAssetMetadataSchema,
  provenance: ProjectAssetProvenanceSchema.optional()
}).strict();
var GlobalAssetEntrySchema = z.object({
  id: z.string().trim().min(1),
  kind: AssetKindSchema,
  resourceId: ResourceIdSchema,
  lifecycle: ProjectAssetLifecycleSchema,
  name: z.string().trim().min(1).optional(),
  metadata: ProjectAssetMetadataSchema,
  provenance: ProjectAssetProvenanceSchema.optional()
}).strict();
var ActionBindingOwnerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("draft"),
    actionId: z.string().trim().min(1)
  }).strict(),
  z.object({
    kind: z.literal("revision"),
    actionId: z.string().trim().min(1),
    actionRevisionId: z.string().trim().min(1)
  }).strict(),
  z.object({
    kind: z.literal("run"),
    actionId: z.string().trim().min(1),
    actionRevisionId: z.string().trim().min(1),
    actionRunId: z.string().trim().min(1)
  }).strict()
]);
var ActionAssetBindingSchema = z.object({
  id: z.string().trim().min(1),
  owner: ActionBindingOwnerSchema,
  direction: z.enum(["input", "output"]),
  slot: z.string().trim().min(1),
  projectAssetId: z.string().trim().min(1),
  role: z.enum(["primary", "reference", "source"]).optional()
}).strict();
var ResolvedAssetSchema = z.object({
  id: z.string().trim().min(1),
  kind: AssetKindSchema,
  name: z.string().trim().min(1).optional(),
  metadata: ProjectAssetMetadataSchema,
  provenance: ProjectAssetProvenanceSchema.optional(),
  status: z.enum(["uploading", "ready", "downloading", "unavailable", "failed"]),
  url: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  progress: z.number().min(0).max(1).optional(),
  error: z.string().trim().min(1).optional()
}).strict();
var AssetMetadataSchema = z.object({
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  durationMs: z.number().int().optional(),
  bytes: z.number().int().optional(),
  waveform: z.array(z.number()).optional(),
  contentType: z.string().optional(),
  frameRate: z.number().positive().optional(),
  videoCodec: z.string().optional(),
  audioCodec: z.string().optional(),
  contentHash: z.string().optional(),
  localBlobKey: z.string().optional(),
  originalName: z.string().optional(),
  mockText: z.string().optional(),
  transcript: z.string().optional(),
  provider: z.string().optional(),
  requestId: z.string().optional(),
  modelEndpoint: z.string().optional(),
  remoteUrl: z.string().optional(),
  /** Parameters used by a copy-on-write image/video edit. */
  editParams: z.unknown().optional(),
  /** Whether the edit was represented by a visible canvas node or an implicit asset-preview action. */
  editOrigin: z.enum(["canvas-node", "asset-preview"]).optional(),
  /** Validated ActionInvocation envelope that produced this immutable output. */
  actionInvocation: z.unknown().optional()
});
var AssetSourceSchema = z.object({
  assetId: z.string(),
  role: z.enum(["edit-source", "reference", "primary"])
});
var AssetSchema = z.object({
  id: z.string(),
  userId: z.string(),
  kind: AssetKindSchema,
  srcR2Key: z.string(),
  coverR2Key: z.string().nullable().optional(),
  metadata: AssetMetadataSchema.nullable().optional(),
  sourceModel: z.string().nullable().optional(),
  sourcePrompt: z.string().nullable().optional(),
  sourceTaskId: z.string().nullable().optional(),
  sources: z.array(AssetSourceSchema).nullable().optional(),
  signedUrl: z.string().optional(),
  signedUrlExp: z.number().optional(),
  signedCoverUrl: z.string().optional(),
  signedCoverUrlExp: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number()
});
var AssetRefRowSchema = z.object({
  assetId: z.string(),
  projectId: z.string(),
  importedAt: z.number()
});

// ../../packages/shared-types/dist/chunk-GNYSXLHQ.js
var SEGMENT = /^[a-z0-9][a-z0-9-]*$/;
var pluginIdSchema = z.string().trim().superRefine((value, ctx) => {
  const segments = value.split(".");
  if (segments.length !== 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: segments.length < 2 ? `Plugin id ${value} needs a publisher: write it as publisher.name, like clash.google.` : `Plugin id ${value} has ${segments.length} segments; a plugin id is publisher.name.`
    });
    return;
  }
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Plugin id segment ${JSON.stringify(segment)} must be lowercase letters, digits and hyphens, starting with a letter or digit.`
      });
    }
  }
});
var DurationSchema = z.string().trim().regex(
  /^\d+(?:s|m|h|d)$/,
  "Write a duration like 60s, 15m, 12h or 7d."
);
var StorageKeySchema = z.string().trim().min(1);
var PluginAuthFormItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("field"),
    key: StorageKeySchema,
    label: z.string().trim().min(1),
    secret: z.boolean().optional(),
    placeholder: z.string().optional(),
    /** Unset with no default means the account does not work until the user fills it in. */
    default: z.string().optional()
  }).strict(),
  z.object({
    kind: z.literal("choice"),
    key: StorageKeySchema,
    label: z.string().trim().min(1),
    // A menu with nothing on it renders as a control the user cannot satisfy.
    options: z.array(z.object({
      value: z.string().trim().min(1),
      label: z.string().trim().min(1)
    })).nonempty(),
    default: z.string().optional()
  }).strict(),
  z.object({
    kind: z.literal("button"),
    key: StorageKeySchema,
    label: z.string().trim().min(1)
  }).strict(),
  z.object({
    kind: z.literal("notice"),
    text: z.string().trim().min(1)
  }).strict(),
  z.object({
    kind: z.literal("display-code"),
    key: StorageKeySchema,
    label: z.string().trim().min(1)
  }).strict()
]);
var HOST_OWNED_PARAMS = [
  "state",
  "code_challenge",
  "code_challenge_method",
  "redirect_uri",
  // Declared as `clientId`, not smuggled through here, so one spelling reaches the request.
  "client_id",
  "client_secret"
];
var PluginAuthFlowCredentialSchema = z.object({
  /**
   * Where the vendor left the credential once the flow finished.
   *
   * Without this the host gets as far as knowing the sign-in completed and then a person reads the
   * token out with devtools, which is not a product. A fragment never reaches a server, so that
   * case is only readable from a browser the host is driving -- which is also why a `scheme`
   * callback needs no OS-level protocol registration: watching the navigation is enough.
   */
  from: z.enum(["cookie", "query", "fragment", "localStorage"]),
  /** Its name there: a cookie name, a parameter name, a storage key. */
  name: z.string().trim().min(1),
  /** The store key to write it under. */
  storeAs: z.string().trim().min(1)
}).strict();
var PluginAuthFlowSchema = z.object({
  // Opened in the user's browser. A plaintext address would carry the request, and anything echoed
  // back to it, in the clear.
  open: z.string().trim().url().refine(
    (value) => value.startsWith("https://"),
    "A browser flow must open an https address."
  ),
  // The exchange carries the code, the verifier and the client secret. A plaintext endpoint puts
  // all three on the wire.
  tokenUrl: z.string().trim().url().refine(
    (value) => value.startsWith("https://"),
    "A token endpoint must be https."
  ).optional(),
  /**
   * The OAuth client, declared by whoever registered it with the vendor.
   *
   * This identifies the *application* asking for authorization, not the user granting it. The token
   * it obtains represents the user's own access to their own resources -- which is why quota and
   * billing land on the user's project, not on this client, and why there is no reason for a user to
   * bring their own. What is shared is only the application's consent screen and its verification
   * status.
   *
   * It lives in the declaration because a client belongs to the party that registered it: Clash
   * registered the Google one, and an author writing a Notion Provider registers theirs with Notion.
   * First-party Providers are plugins we ship, so they take the same path as any other.
   *
   * Declaring it is not a privilege. A plugin runs unsandboxed with network access, so one intent on
   * sending a user somewhere could open a browser itself. What stays with the host is the part that
   * must not vary: PKCE, `state`, the loopback port, the timeout, and the exchange. The plugin never
   * handles the code or the token; it reads the token back from its store like any other value.
   */
  clientId: z.string().trim().min(1).optional(),
  /**
   * Present because vendors ask for it, not because it is secret.
   *
   * RFC 8252 states plainly that an installed application cannot keep one, which is why PKCE exists
   * and why it is the actual protection here.
   */
  clientSecret: z.string().trim().min(1).optional(),
  /** Vendor-specific: scope, access_type, prompt, audience. */
  params: z.record(z.string()).optional(),
  callback: z.discriminatedUnion("type", [
    /** Binds 127.0.0.1 on a random port. Google requires this for desktop clients; the
     * out-of-band flow was withdrawn in 2022. */
    z.object({ type: z.literal("loopback") }).strict(),
    /** A custom URL scheme, where that is the platform convention. */
    z.object({ type: z.literal("scheme"), scheme: z.string().trim().min(1) }).strict(),
    /** Device-code: show a code, poll until the user finishes elsewhere. */
    z.object({
      type: z.literal("poll-until"),
      url: z.string().trim().url(),
      intervalMs: z.number().int().positive().optional()
    }).strict()
  ]),
  credential: PluginAuthFlowCredentialSchema.optional()
}).strict().superRefine((flow, ctx) => {
  if (flow.clientId && !flow.tokenUrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A flow declaring a clientId must declare the tokenUrl that exchanges the code."
    });
  }
  for (const key of Object.keys(flow.params ?? {})) {
    if (HOST_OWNED_PARAMS.includes(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${key} is set by the host and must not be declared.`,
        path: ["params", key]
      });
    }
  }
});
var PluginAuthRenewSchema = z.union([
  z.object({ before: DurationSchema }).strict(),
  z.object({ every: DurationSchema }).strict()
]);
var PluginAuthImportSchema = z.object({
  format: z.literal("electron-store-aes-256-gcm-v2"),
  /** A subdirectory of the user's application data, not an arbitrary path. */
  appDataSubdirectory: z.string().trim().min(1).refine((value) => !value.startsWith("/") && !value.startsWith("~") && !value.includes(".."), {
    message: "appDataSubdirectory must sit inside the application data directory."
  }),
  configFile: z.string().trim().min(1),
  keyFile: z.string().trim().min(1),
  /** Where the value sits inside the config. Empty would read the whole object, which is not a
   * credential and would be stored as one. */
  tokenPath: z.array(z.string().trim().min(1)).min(1),
  /** The store key to write it under. */
  storeAs: z.string().trim().min(1)
}).strict();
var PluginAuthMethodSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  form: z.array(PluginAuthFormItemSchema).optional(),
  flow: PluginAuthFlowSchema.optional(),
  import: PluginAuthImportSchema.optional(),
  renew: PluginAuthRenewSchema.optional()
}).strict().refine(
  (method) => (method.form?.length ?? 0) > 0 || method.flow !== void 0 || method.import !== void 0,
  // A method with none of the three offers the user a name and nothing to do with it.
  { message: "An auth method must collect something, start a flow, or import a credential." }
);
var PluginAuthDeclarationSchema = z.object({
  methods: z.array(PluginAuthMethodSchema).min(1)
}).strict().superRefine((declaration, ctx) => {
  const seen = /* @__PURE__ */ new Set();
  for (const method of declaration.methods) {
    if (seen.has(method.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["methods"],
        message: `Two auth methods share the id ${method.id}.`
      });
    }
    seen.add(method.id);
  }
});
var AspectRatioSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive()
}).strict();
var AIGC_ACTION_KINDS = ["image", "video", "audio", "text"];
var AigcActionKindSchema = z.enum(AIGC_ACTION_KINDS);
var CANONICAL_RESOLUTION_TIERS = [
  { label: "0.5K (Draft)", value: "0.5K", pixels: 262144 },
  { label: "1K (Fast)", value: "1K", pixels: 1048576 },
  { label: "2K (Balanced)", value: "2K", pixels: 4194304 },
  { label: "4K (High Quality)", value: "4K", pixels: 8294400 }
];
var GPT_IMAGE_RESOLUTION_TIERS = CANONICAL_RESOLUTION_TIERS.filter(
  (tier) => tier.value === "1K" || tier.value === "2K" || tier.value === "4K"
);
var GPT_IMAGE_ASPECT_RATIOS = [
  { label: "1:1", value: "1:1" },
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
  { label: "3:4", value: "3:4" },
  { label: "4:3", value: "4:3" },
  { label: "3:2", value: "3:2" },
  { label: "2:3", value: "2:3" },
  { label: "5:4", value: "5:4" },
  { label: "4:5", value: "4:5" },
  { label: "21:9", value: "21:9" },
  { label: "2:1", value: "2:1" },
  { label: "1:2", value: "1:2" },
  { label: "3:1", value: "3:1" },
  { label: "1:3", value: "1:3" }
];
var ModelKindSchema = AigcActionKindSchema;
var NANO_BANANA_ASPECT_RATIOS = [
  { label: "1:1", value: "1:1" },
  { label: "2:3", value: "2:3" },
  { label: "3:2", value: "3:2" },
  { label: "3:4", value: "3:4" },
  { label: "4:3", value: "4:3" },
  { label: "4:5", value: "4:5" },
  { label: "5:4", value: "5:4" },
  { label: "9:16", value: "9:16" },
  { label: "16:9", value: "16:9" },
  { label: "21:9", value: "21:9" }
];
var NANO_BANANA_LITE_ASPECT_RATIOS = [
  { label: "1:1", value: "1:1" },
  { label: "1:4", value: "1:4" },
  { label: "4:1", value: "4:1" },
  { label: "1:8", value: "1:8" },
  { label: "8:1", value: "8:1" },
  { label: "2:3", value: "2:3" },
  { label: "3:2", value: "3:2" },
  { label: "3:4", value: "3:4" },
  { label: "4:3", value: "4:3" },
  { label: "4:5", value: "4:5" },
  { label: "5:4", value: "5:4" },
  { label: "9:16", value: "9:16" },
  { label: "16:9", value: "16:9" },
  { label: "21:9", value: "21:9" }
];
var NANO_BANANA_RESOLUTIONS = CANONICAL_RESOLUTION_TIERS;
var SORA_ASPECT_RATIOS = [
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" }
];
var CANONICAL_IMAGE_ASPECT_RATIOS = [
  { label: "1:1", value: "1:1" },
  { label: "4:3", value: "4:3" },
  { label: "16:9", value: "16:9" },
  { label: "3:4", value: "3:4" },
  { label: "9:16", value: "9:16" }
];
function aspectRatioParameter(spec) {
  return {
    id: "aspect_ratio",
    label: "Aspect Ratio",
    type: "select",
    ...spec.description ? { description: spec.description } : {},
    ...spec.required === void 0 ? {} : { required: spec.required },
    options: [
      ...spec.auto ? [{ label: spec.auto.label, value: "auto" }] : [],
      ...spec.ratios.map((value) => ({ label: value, value }))
    ],
    defaultValue: spec.defaultValue
  };
}
function durationParameter(spec) {
  return {
    id: "duration",
    label: "Duration",
    type: "select",
    options: [
      ...spec.auto ? [{ label: spec.auto.label, value: "auto" }] : [],
      ...spec.seconds.map((value) => ({ label: `${value}s`, value }))
    ],
    defaultValue: spec.defaultValue
  };
}
function resolutionParameter(spec) {
  return {
    id: "resolution",
    label: "Resolution",
    type: "select",
    options: spec.tiers.map((tier) => ({ label: tier.label, value: tier.value })),
    defaultValue: spec.defaultValue
  };
}
var KLING_ASPECT_RATIOS = [
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
  { label: "1:1", value: "1:1" }
];
var VEO3_ASPECT_RATIOS = [
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" }
];
var VEO3_DURATION_PARAMETER = {
  id: "duration",
  label: "Duration",
  type: "select",
  options: [4, 6, 8].map((value) => ({ label: `${value}s`, value })),
  defaultValue: 4
};
var IMAGEN_ASPECT_RATIOS = [
  { label: "16:9", value: "16:9" },
  { label: "9:16", value: "9:16" },
  { label: "1:1", value: "1:1" },
  { label: "4:3", value: "4:3" },
  { label: "3:4", value: "3:4" }
];
var FLUX3_VIDEO_ASPECT_RATIOS = [
  { label: "Auto", value: "auto" },
  { label: "21:9", value: "21:9" },
  { label: "2:1", value: "2:1" },
  { label: "16:9", value: "16:9" },
  { label: "4:3", value: "4:3" },
  { label: "1:1", value: "1:1" },
  { label: "3:4", value: "3:4" },
  { label: "9:16", value: "9:16" }
];
function flux3VideoParameters(options = {}) {
  const allowAutoDuration = options.allowAutoDuration ?? true;
  return [
    {
      id: "duration",
      label: "Duration",
      type: "select",
      options: [
        ...allowAutoDuration ? [{ label: "Auto", value: "auto" }] : [],
        ...Array.from({ length: 16 }, (_, index) => ({ label: `${index + 5}s`, value: index + 5 }))
      ],
      defaultValue: allowAutoDuration ? "auto" : 5
    },
    {
      id: "aspect_ratio",
      label: "Aspect Ratio",
      type: "select",
      options: FLUX3_VIDEO_ASPECT_RATIOS.map(({ label, value }) => ({ label, value })),
      defaultValue: "auto"
    },
    {
      id: "resolution",
      label: "Resolution",
      type: "select",
      options: [
        { label: "720p", value: "720p" },
        { label: "1080p", value: "1080p" }
      ],
      defaultValue: "720p"
    },
    {
      id: "generate_audio",
      label: "Native audio",
      type: "boolean",
      defaultValue: true
    },
    {
      id: "safety_tolerance",
      label: "Safety tolerance",
      type: "select",
      options: Array.from({ length: 5 }, (_, value) => ({ label: String(value), value })),
      defaultValue: 2
    }
  ];
}
var FLUX3_VIDEO_DEFAULT_PARAMS = {
  duration: "auto",
  aspect_ratio: "auto",
  resolution: "720p",
  generate_audio: true,
  safety_tolerance: 2
};
var FLUX3_KEYFRAME_VIDEO_DEFAULT_PARAMS = {
  ...FLUX3_VIDEO_DEFAULT_PARAMS,
  duration: 5
};
var SEEDANCE_ASPECT_RATIOS = [
  { label: "Auto", value: "auto" },
  { label: "21:9", value: "21:9" },
  { label: "16:9", value: "16:9" },
  { label: "4:3", value: "4:3" },
  { label: "1:1", value: "1:1" },
  { label: "3:4", value: "3:4" },
  { label: "9:16", value: "9:16" }
];
var GEMINI_TTS_VOICES = [
  { label: "Zephyr - Bright", value: "Zephyr" },
  { label: "Puck - Upbeat", value: "Puck" },
  { label: "Charon - Informative", value: "Charon" },
  { label: "Kore - Firm", value: "Kore" },
  { label: "Fenrir - Excitable", value: "Fenrir" },
  { label: "Leda - Youthful", value: "Leda" },
  { label: "Orus - Firm", value: "Orus" },
  { label: "Aoede - Breezy", value: "Aoede" },
  { label: "Callirrhoe - Easy-going", value: "Callirrhoe" },
  { label: "Autonoe - Bright", value: "Autonoe" },
  { label: "Enceladus - Breathy", value: "Enceladus" },
  { label: "Iapetus - Clear", value: "Iapetus" },
  { label: "Umbriel - Easy-going", value: "Umbriel" },
  { label: "Algieba - Smooth", value: "Algieba" },
  { label: "Despina - Smooth", value: "Despina" },
  { label: "Erinome - Clear", value: "Erinome" },
  { label: "Algenib - Gravelly", value: "Algenib" },
  { label: "Rasalgethi - Informative", value: "Rasalgethi" },
  { label: "Laomedeia - Upbeat", value: "Laomedeia" },
  { label: "Achernar - Soft", value: "Achernar" },
  { label: "Alnilam - Firm", value: "Alnilam" },
  { label: "Schedar - Even", value: "Schedar" },
  { label: "Gacrux - Mature", value: "Gacrux" },
  { label: "Pulcherrima - Forward", value: "Pulcherrima" },
  { label: "Achird - Friendly", value: "Achird" },
  { label: "Zubenelgenubi - Casual", value: "Zubenelgenubi" },
  { label: "Vindemiatrix - Gentle", value: "Vindemiatrix" },
  { label: "Sadachbia - Lively", value: "Sadachbia" },
  { label: "Sadaltager - Knowledgeable", value: "Sadaltager" },
  { label: "Sulafat - Warm", value: "Sulafat" }
];
var ModelParameterTypeSchema = z.enum(["select", "slider", "number", "text", "boolean"]);
var BuiltinProviderSchema = z.enum(["local", "official", "fal", "pika", "replicate", "kling", "minimax", "volcengine", "elevenlabs", "suno", "mock", "custom"]);
var ProviderSchema = z.string().trim().regex(
  /^[a-z0-9][a-z0-9._-]*$/,
  "Provider ids must be lowercase plugin-safe identifiers."
);
var ReferenceBindingSchema = z.discriminatedUnion("type", [
  z.object({
    /** Provider receives the prompt and reference collections as separate fields. */
    type: z.literal("grouped-references")
  }),
  z.object({
    /** Preserve text/reference order as native provider content parts. */
    type: z.literal("ordered-content-parts"),
    /** Provider content parts require an explicit semantic role per asset. */
    usesRoles: z.boolean().default(false),
    /** Image/video/audio references are numbered independently when named in text. */
    modalityScopedIndexes: z.boolean().default(false)
  }),
  z.object({
    /** References stay in provider arrays/content, while text addresses them by numbered tokens. */
    type: z.literal("positional-tokens"),
    modalityScopedIndexes: z.boolean().default(true),
    /** Provider-specific token dialect. `{n}` is replaced with the one-based modality index. */
    tokens: z.object({
      image: z.string().min(1).optional(),
      video: z.string().min(1).optional(),
      audio: z.string().min(1).optional()
    }).optional()
  })
]);
var ModelProviderConfigSchema = z.object({
  model_id: z.string(),
  provider: ProviderSchema,
  default: z.boolean().default(false)
});
var ModelParameterSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: ModelParameterTypeSchema,
  description: z.string().optional(),
  /** Provider-fixed output characteristic. It remains visible in the common
   * parameter surface, but UI and external payloads cannot override it. */
  readOnly: z.boolean().optional(),
  required: z.boolean().default(false),
  options: z.array(
    z.object({
      label: z.string(),
      value: z.union([z.string(), z.number()])
    })
  ).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  placeholder: z.string().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional()
});
var ReferenceMediaConstraintsSchema = z.object({
  mimeTypes: z.array(z.string().min(1)).optional(),
  fileExtensions: z.array(z.string().min(1)).optional(),
  maxBytes: z.number().int().positive().optional(),
  minWidth: z.number().int().positive().optional(),
  maxWidth: z.number().int().positive().optional(),
  minHeight: z.number().int().positive().optional(),
  maxHeight: z.number().int().positive().optional(),
  minAspectRatio: z.number().positive().optional(),
  maxAspectRatio: z.number().positive().optional(),
  minDurationMs: z.number().int().nonnegative().optional(),
  maxDurationMs: z.number().int().positive().optional(),
  minFrameRate: z.number().positive().optional(),
  maxFrameRate: z.number().positive().optional(),
  videoCodecs: z.array(z.string().min(1)).optional(),
  audioCodecs: z.array(z.string().min(1)).optional()
});
var RefSpecSchema = z.object({
  max: z.number().int().positive(),
  min: z.number().int().nonnegative().optional(),
  /** When this modality is present, at least one of these companion
   * modalities must also be present. */
  requiresAnyOf: z.array(z.enum(["image", "video", "audio"])).min(1).optional(),
  constraints: ReferenceMediaConstraintsSchema.optional(),
  maxTotalDurationMs: z.number().int().positive().optional()
});
var ModelInputModeSchema = z.object({
  images: RefSpecSchema.optional(),
  videos: RefSpecSchema.optional(),
  audios: RefSpecSchema.optional(),
  /** At least one reference from these modalities must be attached. */
  requiresAnyOf: z.array(z.enum(["image", "video", "audio"])).min(1).optional(),
  /** Maximum total references across image, video, and audio buckets. */
  maxTotalReferences: z.number().int().positive().optional(),
  /** Maximum JSON request body when local media is represented as Base64 Data URIs. */
  maxEmbeddedRequestBytes: z.number().int().positive().optional(),
  /** First / last frame reference pair. Start frame is required, end frame optional. */
  startEnd: z.object({ constraints: ReferenceMediaConstraintsSchema.optional() }).optional()
});
var ModelInputPresentationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("keyframes"),
    /** Provider frame positions are explicit; the Canvas may seed evenly
     * spaced defaults, but users can edit every intermediate anchor. */
    timing: z.literal("explicit"),
    frameRate: z.number().int().positive()
  }),
  z.object({
    type: z.literal("video-continuation")
  })
]);
var ModelInputRuleSchema = z.object({
  requiresPrompt: z.boolean().default(true),
  inputMode: ModelInputModeSchema.default({}),
  /** Modalities that can be @-mentioned inline in the prompt editor.
   *  Does NOT affect form-field inputs (start/end frames, etc.) */
  promptModalities: z.array(z.enum(["text", "image", "video", "audio"])).default(["text"]),
  /** How inline prompt references are represented on the provider wire. */
  referenceBinding: ReferenceBindingSchema.optional(),
  /** Specialized input surface owned by this Model Card. */
  presentation: ModelInputPresentationSchema.optional()
});
var MusicInputMappingSchema = z.object({
  lyricsTarget: z.enum(["prompt", "modelParam"]),
  lyricsParam: z.string().min(1).optional(),
  descriptionParam: z.string().min(1).optional(),
  titleParam: z.string().min(1).optional(),
  maxLyricsCharacters: z.number().int().positive().optional(),
  maxPromptCharacters: z.number().int().positive().optional()
}).superRefine((mapping, ctx) => {
  if (mapping.lyricsTarget === "modelParam" && !mapping.lyricsParam) {
    ctx.addIssue({
      code: "custom",
      path: ["lyricsParam"],
      message: "lyricsParam is required when lyricsTarget is modelParam."
    });
  }
});
var ModelConstraintValueSchema = z.union([z.string(), z.number(), z.boolean()]);
var ModelConstraintFieldSchema = z.string().refine(
  (field2) => field2 === "prompt" || field2 === "lyrics" || field2.startsWith("modelParams."),
  "Constraint fields must be prompt, lyrics, or modelParams.<id>."
);
var ModelConstraintRuleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("required"),
    field: ModelConstraintFieldSchema,
    when: z.array(z.object({
      field: ModelConstraintFieldSchema,
      equals: ModelConstraintValueSchema
    })).default([]),
    message: z.string().min(1).optional()
  }),
  z.object({
    type: z.literal("max-length"),
    field: ModelConstraintFieldSchema,
    max: z.number().int().positive(),
    message: z.string().min(1).optional()
  }),
  z.object({
    type: z.literal("mutually-exclusive"),
    fields: z.array(ModelConstraintFieldSchema).min(2),
    activeValue: ModelConstraintValueSchema,
    inactiveValue: ModelConstraintValueSchema,
    message: z.string().min(1).optional()
  })
]);
var ProviderCredentialRequirementsSchema = z.object({
  /** Every entry is an all-of credential set; satisfying any one set enables the route. */
  anyOf: z.array(z.array(z.string().min(1)).min(1)).min(1),
  /** When true, one account must not configure more than one alternative set. */
  exclusive: z.boolean().optional()
});
var ProviderInputAdaptationSchema = z.object({
  audio: z.object({
    mimeAliases: z.record(z.string().min(1), z.string().min(1))
  }).optional()
});
var ModelProviderImplementationSchema = z.object({
  providerId: ProviderSchema,
  accountId: z.string().optional(),
  upstreamId: z.string(),
  region: z.string().optional(),
  upstreamModel: z.string(),
  apiShape: z.string(),
  /** Function export in the owning Executable Plugin that translates the
   * canonical Card invocation to this provider's wire shape. Legacy built-in
   * routes may omit it until migrated. */
  projectorExportId: z.string().min(1).optional(),
  /** Plugin that owns projectorExportId. The resolver selects an installed
   * exact version and persists it on the Canvas node. */
  projectorPluginId: z.string().min(1).optional(),
  /** Function export that owns the full submit/poll/result lifecycle for a
   * plugin-defined provider. Built-in adapters may omit it. */
  executorExportId: z.string().min(1).optional(),
  /** Plugin that owns executorExportId. Package composition fills this from
   * immutable plugin provenance when omitted in a binding document. */
  executorPluginId: z.string().min(1).optional(),
  priority: z.number().optional(),
  weight: z.number().optional(),
  requiredCredentials: z.array(z.string()).optional(),
  credentialRequirements: ProviderCredentialRequirementsSchema.optional(),
  requiredOAuth: z.array(z.string()).optional(),
  /** Provider-specific override for how inline references bind to prompt text. */
  referenceBinding: ReferenceBindingSchema.optional(),
  /** Provider-specific wire spellings applied after this route is selected. */
  inputAdaptation: ProviderInputAdaptationSchema.optional(),
  /** Full replacements for parameters whose candidates or ranges differ on this provider.
   * Parameters absent from this list are reused from the base model card. */
  parameterOverrides: z.array(ModelParameterSchema).optional(),
  /** Provider-specific defaults paired with parameterOverrides. */
  defaultParamOverrides: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  /** Parameters implemented only by other providers. They are removed from
   * the effective Card instead of being rendered and silently discarded. */
  excludedParameterIds: z.array(z.string().min(1)).optional()
}).superRefine((implementation, ctx) => {
  if (implementation.projectorPluginId && !implementation.projectorExportId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["projectorExportId"],
      message: "projectorExportId is required when projectorPluginId is configured."
    });
  }
  if (implementation.executorPluginId && !implementation.executorExportId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["executorExportId"],
      message: "executorExportId is required when executorPluginId is configured."
    });
  }
});
var ModelCardSchema = z.object({
  id: z.string(),
  aliases: z.array(z.string()).default([]),
  name: z.string(),
  provider: z.string(),
  kind: ModelKindSchema,
  custom: z.boolean().optional(),
  description: z.string().optional(),
  promptGuidance: z.string().optional(),
  parameters: z.array(ModelParameterSchema),
  defaultParams: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  /**
   * Canonical default aspect ratio in our format ("4:3", "16:9", etc.).
   * Required for image and video models. Audio models use "1:1" as placeholder.
   * This is OUR representation — provider-specific values live in parameters/defaultParams.
   */
  defaultAspectRatio: z.string().default("16:9"),
  input: ModelInputRuleSchema.default({
    requiresPrompt: true,
    inputMode: {},
    promptModalities: ["text"]
  }),
  musicInput: MusicInputMappingSchema.optional(),
  /** Shared UI/runtime constraints. Providers may still translate the final
   * valid configuration into different wire shapes. */
  constraints: z.array(ModelConstraintRuleSchema).optional(),
  availableProviders: z.array(ProviderSchema).optional(),
  defaultProvider: ProviderSchema.optional(),
  providerImplementations: z.array(ModelProviderImplementationSchema).optional(),
  /**
   * Upper bound (ms) for a healthy run. NodeProcessor marks a workflow Failed if
   * engine status is still "running" past this point (orphan from miniflare
   * hot-reload, hung provider, etc). Set generously above the 99th-percentile
   * run so legitimately slow jobs never get misclassified.
   */
  maxRuntimeMs: z.number().int().positive().optional()
}).superRefine((model, ctx) => {
  const parameterIds = /* @__PURE__ */ new Set();
  const parametersById = /* @__PURE__ */ new Map();
  const sameCandidate = (left, right) => left === right;
  const validateProviderParameterValue = (parameter, value, path, source) => {
    if (value === void 0) return;
    if (parameter.type === "select") {
      const optionValues = parameter.options?.map((option) => option.value) ?? [];
      if (!optionValues.some((candidate) => sameCandidate(candidate, value))) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `${parameter.label} ${source} must be one of its provider candidates.`
        });
      }
      return;
    }
    if (parameter.type === "number" || parameter.type === "slider") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `${parameter.label} ${source} must be a finite number.`
        });
      } else if (parameter.min !== void 0 && value < parameter.min || parameter.max !== void 0 && value > parameter.max) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `${parameter.label} ${source} must stay within its provider range.`
        });
      }
      return;
    }
    if (parameter.type === "boolean" && typeof value !== "boolean") {
      ctx.addIssue({
        code: "custom",
        path,
        message: `${parameter.label} ${source} must be a boolean.`
      });
    }
    if (parameter.type === "text" && typeof value !== "string") {
      ctx.addIssue({
        code: "custom",
        path,
        message: `${parameter.label} ${source} must be text.`
      });
    }
  };
  for (const [index, parameter] of model.parameters.entries()) {
    if (parameterIds.has(parameter.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["parameters", index, "id"],
        message: "Model parameter ids must be unique."
      });
    }
    parameterIds.add(parameter.id);
    parametersById.set(parameter.id, parameter);
    if (parameter.type === "select") {
      if (!parameter.options?.length) {
        ctx.addIssue({
          code: "custom",
          path: ["parameters", index, "options"],
          message: "Select parameters require at least one candidate."
        });
      }
      const optionValues = parameter.options?.map((option) => option.value) ?? [];
      if (new Set(optionValues.map((value) => `${typeof value}:${String(value)}`)).size !== optionValues.length) {
        ctx.addIssue({
          code: "custom",
          path: ["parameters", index, "options"],
          message: "Select parameter candidate values must be unique."
        });
      }
      for (const [source, value] of [
        ["defaultValue", parameter.defaultValue],
        ["defaultParams", model.defaultParams[parameter.id]]
      ]) {
        if (value !== void 0 && !optionValues.some((candidate) => sameCandidate(candidate, value))) {
          ctx.addIssue({
            code: "custom",
            path: source === "defaultValue" ? ["parameters", index, "defaultValue"] : ["defaultParams", parameter.id],
            message: `${parameter.label} ${source} must be one of its configured candidates.`
          });
        }
      }
    }
    const defaultValue = model.defaultParams[parameter.id] ?? parameter.defaultValue;
    if (parameter.readOnly && defaultValue === void 0) {
      ctx.addIssue({
        code: "custom",
        path: ["parameters", index, "defaultValue"],
        message: `${parameter.label} is read-only and requires a fixed default.`
      });
    }
    if ((parameter.type === "number" || parameter.type === "slider") && defaultValue !== void 0) {
      if (typeof defaultValue !== "number" || !Number.isFinite(defaultValue)) {
        ctx.addIssue({
          code: "custom",
          path: ["defaultParams", parameter.id],
          message: `${parameter.label} default must be a finite number.`
        });
      } else if (parameter.min !== void 0 && defaultValue < parameter.min || parameter.max !== void 0 && defaultValue > parameter.max) {
        ctx.addIssue({
          code: "custom",
          path: ["defaultParams", parameter.id],
          message: `${parameter.label} default must stay within its configured range.`
        });
      }
    }
    if (parameter.type === "boolean" && defaultValue !== void 0 && typeof defaultValue !== "boolean") {
      ctx.addIssue({
        code: "custom",
        path: ["defaultParams", parameter.id],
        message: `${parameter.label} default must be a boolean.`
      });
    }
  }
  const validateConstraintField = (field2, path) => {
    if (!field2.startsWith("modelParams.")) return;
    if (parameterIds.has(field2.slice("modelParams.".length))) return;
    ctx.addIssue({
      code: "custom",
      path,
      message: `Model constraint ${field2} must reference a declared parameter.`
    });
  };
  for (const [index, rule] of (model.constraints ?? []).entries()) {
    if (rule.type === "mutually-exclusive") {
      rule.fields.forEach((field2, fieldIndex) => validateConstraintField(field2, ["constraints", index, "fields", fieldIndex]));
      continue;
    }
    validateConstraintField(rule.field, ["constraints", index, "field"]);
    if (rule.type === "required") {
      rule.when.forEach((condition, conditionIndex) => validateConstraintField(condition.field, ["constraints", index, "when", conditionIndex, "field"]));
    }
  }
  for (const [implementationIndex, implementation] of (model.providerImplementations ?? []).entries()) {
    const overrideIds = /* @__PURE__ */ new Set();
    const overridesById = /* @__PURE__ */ new Map();
    for (const [overrideIndex, parameter] of (implementation.parameterOverrides ?? []).entries()) {
      if (overrideIds.has(parameter.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["providerImplementations", implementationIndex, "parameterOverrides", overrideIndex, "id"],
          message: "Provider parameter override ids must be unique."
        });
      }
      overrideIds.add(parameter.id);
      overridesById.set(parameter.id, parameter);
      if (!parameterIds.has(parameter.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["providerImplementations", implementationIndex, "parameterOverrides", overrideIndex, "id"],
          message: `Provider parameter override ${parameter.id} must reference a declared parameter on the canonical Model Card.`
        });
      }
      if (parameter.type === "select" && !parameter.options?.length) {
        ctx.addIssue({
          code: "custom",
          path: ["providerImplementations", implementationIndex, "parameterOverrides", overrideIndex, "options"],
          message: "Provider select parameter overrides require at least one candidate."
        });
      }
      validateProviderParameterValue(
        parameter,
        parameter.defaultValue,
        ["providerImplementations", implementationIndex, "parameterOverrides", overrideIndex, "defaultValue"],
        "defaultValue"
      );
    }
    const excludedIds = /* @__PURE__ */ new Set();
    for (const [excludedIndex, parameterId] of (implementation.excludedParameterIds ?? []).entries()) {
      const path = ["providerImplementations", implementationIndex, "excludedParameterIds", excludedIndex];
      if (excludedIds.has(parameterId)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: "Provider excluded parameter ids must be unique."
        });
      }
      excludedIds.add(parameterId);
      if (!parameterIds.has(parameterId)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `Provider exclusion ${parameterId} must reference a declared parameter on the canonical Model Card.`
        });
      }
      if (overrideIds.has(parameterId)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `Provider cannot both override and exclude parameter ${parameterId}.`
        });
      }
    }
    for (const [parameterId, value] of Object.entries(implementation.defaultParamOverrides ?? {})) {
      const path = ["providerImplementations", implementationIndex, "defaultParamOverrides", parameterId];
      if (!parameterIds.has(parameterId)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `Provider default override ${parameterId} must reference a declared parameter on the canonical Model Card.`
        });
      }
      if (excludedIds.has(parameterId)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `Provider cannot set a default for excluded parameter ${parameterId}.`
        });
      }
      const effectiveParameter = overridesById.get(parameterId) ?? parametersById.get(parameterId);
      if (effectiveParameter) {
        validateProviderParameterValue(effectiveParameter, value, path, "default override");
      }
    }
  }
  const providers = model.availableProviders ?? [];
  if (providers.length === 0) return;
  if (!model.defaultProvider) {
    ctx.addIssue({
      code: "custom",
      path: ["defaultProvider"],
      message: "defaultProvider is required when availableProviders is set."
    });
    return;
  }
  if (!providers.includes(model.defaultProvider)) {
    ctx.addIssue({
      code: "custom",
      path: ["defaultProvider"],
      message: "defaultProvider must be one of availableProviders."
    });
  }
});
var GEMINI_TTS_PARAMETERS = [
  {
    id: "voice_name",
    label: "Voice",
    type: "select",
    options: [...GEMINI_TTS_VOICES],
    required: false,
    defaultValue: "Kore",
    description: "Google Gemini TTS prebuilt voice."
  }
];
var MINIMAX_H3_IMAGE_CONSTRAINTS = {
  mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  fileExtensions: ["jpg", "jpeg", "png", "webp", "heic", "heif"],
  maxBytes: 30 * 1024 * 1024,
  minWidth: 256,
  maxWidth: 5760,
  minHeight: 256,
  maxHeight: 5760,
  minAspectRatio: 0.4,
  maxAspectRatio: 2.5
};
var MINIMAX_H3_VIDEO_CONSTRAINTS = {
  mimeTypes: ["video/mp4", "video/quicktime"],
  fileExtensions: ["mp4", "mov"],
  maxBytes: 50 * 1024 * 1024,
  minWidth: 256,
  maxWidth: 5760,
  minHeight: 256,
  maxHeight: 5760,
  minAspectRatio: 0.4,
  maxAspectRatio: 2.5,
  minDurationMs: 2e3,
  maxDurationMs: 15e3,
  minFrameRate: 23.976,
  maxFrameRate: 60,
  videoCodecs: ["h264", "avc", "h265", "hevc"],
  audioCodecs: ["aac", "mp3"]
};
var MINIMAX_H3_AUDIO_CONSTRAINTS = {
  // The model accepts WAV and MP3, so `audio/mpeg` belongs here: it is MP3's registered
  // media type and rejecting it would refuse a file the model can read. MiniMax derives a
  // filename from the mime and will not take the `.mpeg` that `audio/mpeg` yields, so the
  // transport spells it `audio/mp3` on the wire -- a provider dialect, like `adaptive`.
  mimeTypes: ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"],
  fileExtensions: ["wav", "mp3"],
  maxBytes: 15 * 1024 * 1024,
  minDurationMs: 2e3,
  maxDurationMs: 15e3
};
var MINIMAX_H3_MAX_EMBEDDED_REQUEST_BYTES = 64 * 1024 * 1024;
var SEEDANCE_IMAGE_CONSTRAINTS = {
  mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff", "image/gif", "image/heic", "image/heif"],
  fileExtensions: ["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff", "gif", "heic", "heif"],
  maxBytes: 30 * 1024 * 1024,
  minWidth: 300,
  maxWidth: 6e3,
  minHeight: 300,
  maxHeight: 6e3,
  minAspectRatio: 0.4,
  maxAspectRatio: 2.5
};
var SEEDANCE_VIDEO_CONSTRAINTS = {
  mimeTypes: ["video/mp4", "video/quicktime"],
  fileExtensions: ["mp4", "mov"],
  maxBytes: 200 * 1024 * 1024,
  minDurationMs: 2e3,
  minFrameRate: 24,
  maxFrameRate: 60
};
var SEEDANCE_AUDIO_CONSTRAINTS = {
  mimeTypes: ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"],
  fileExtensions: ["wav", "mp3"],
  maxBytes: 15 * 1024 * 1024,
  minDurationMs: 2e3
};
var SEEDANCE_MAX_EMBEDDED_REQUEST_BYTES = 64 * 1024 * 1024;
var SEED_AUDIO_IMAGE_CONSTRAINTS = {
  mimeTypes: ["image/jpeg", "image/png", "image/webp"],
  fileExtensions: ["jpg", "jpeg", "png", "webp"],
  maxBytes: 10 * 1024 * 1024
};
var SEED_AUDIO_AUDIO_CONSTRAINTS = {
  mimeTypes: ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/pcm", "audio/ogg", "audio/opus"],
  fileExtensions: ["wav", "mp3", "pcm", "ogg", "opus"],
  maxBytes: 10 * 1024 * 1024,
  maxDurationMs: 3e4
};
var GROUPED_REFERENCE_BINDING = {
  type: "grouped-references"
};
var ORDERED_REFERENCE_BINDING = {
  type: "ordered-content-parts",
  usesRoles: false,
  modalityScopedIndexes: false
};
var POSITIONAL_REFERENCE_BINDING = {
  type: "positional-tokens",
  modalityScopedIndexes: true
};
var PIKA_2026_TEXT_MODEL_CARDS = [
  ["gpt-5.6-sol", "GPT-5.6 Sol", "OpenAI"],
  ["claude-sonnet-5", "Claude Sonnet 5", "Anthropic"],
  ["gemini-3.6-flash", "Gemini 3.6 Flash", "Google"],
  ["deepseek-v4-pro", "DeepSeek V4 Pro", "DeepSeek"],
  ["kimi-k3", "Kimi K3", "Moonshot AI"],
  ["glm-5.2", "GLM-5.2", "Z.ai"]
].map(([id2, name, provider]) => ({
  id: id2,
  name,
  provider,
  availableProviders: ["pika"],
  defaultProvider: "pika",
  kind: "text",
  defaultAspectRatio: "1:1",
  description: `${name} through Pika API Club's current 2026 catalog.`,
  parameters: [{
    id: "system_prompt",
    label: "System prompt",
    type: "text",
    defaultValue: ""
  }],
  defaultParams: { system_prompt: "" },
  input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
  maxRuntimeMs: 5 * 60 * 1e3
}));
var MODEL_CARD_DEFINITIONS = [
  ...PIKA_2026_TEXT_MODEL_CARDS,
  {
    id: "seedream-5-pro",
    name: "Seedream 5.0 Pro",
    provider: "ByteDance",
    availableProviders: ["pika"],
    defaultProvider: "pika",
    kind: "image",
    defaultAspectRatio: "16:9",
    description: "Seedream 5.0 Pro image generation and editing from the current Pika catalog.",
    parameters: [
      { id: "resolution", label: "Resolution", type: "select", options: ["2K", "4K"].map((value) => ({ label: value, value })), defaultValue: "2K" },
      { id: "count", label: "Count", type: "number", min: 1, max: 4, step: 1, defaultValue: 1 }
    ],
    defaultParams: { resolution: "2K", count: 1 },
    input: { requiresPrompt: true, inputMode: { images: { max: 10 } }, promptModalities: ["text", "image"], referenceBinding: GROUPED_REFERENCE_BINDING }
  },
  {
    id: "grok-imagine-quality",
    name: "Grok Imagine Image Quality",
    provider: "xAI",
    availableProviders: ["pika"],
    defaultProvider: "pika",
    kind: "image",
    defaultAspectRatio: "16:9",
    description: "High-quality Grok Imagine image generation and editing.",
    parameters: [{ id: "count", label: "Count", type: "number", min: 1, max: 4, step: 1, defaultValue: 1 }],
    defaultParams: { count: 1 },
    input: { requiresPrompt: true, inputMode: { images: { max: 1 } }, promptModalities: ["text", "image"], referenceBinding: GROUPED_REFERENCE_BINDING }
  },
  {
    id: "grok-imagine-video-1.5",
    name: "Grok Imagine Video 1.5",
    provider: "xAI",
    availableProviders: ["pika"],
    defaultProvider: "pika",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Grok Imagine 1.5 image-to-video from the current Pika catalog.",
    parameters: [{ id: "duration", label: "Duration", type: "select", options: [5, 10].map((value) => ({ label: `${value}s`, value })), defaultValue: 5 }],
    defaultParams: { duration: 5 },
    input: { requiresPrompt: true, inputMode: { startEnd: {} }, promptModalities: ["text", "image"], referenceBinding: GROUPED_REFERENCE_BINDING }
  },
  {
    id: "lyria-3-pro",
    name: "Lyria 3 Pro",
    provider: "Google",
    availableProviders: ["pika"],
    defaultProvider: "pika",
    kind: "audio",
    defaultAspectRatio: "1:1",
    description: "Google Lyria 3 Pro music generation from the current Pika catalog.",
    parameters: [
      {
        id: "duration",
        label: "Duration",
        type: "number",
        min: 10,
        max: 180,
        step: 1,
        defaultValue: 30
      }
    ],
    defaultParams: { duration: 30 },
    input: { requiresPrompt: true, inputMode: {} }
  },
  {
    id: "minimax-speech-2.8-hd",
    name: "MiniMax Speech 2.8 HD",
    provider: "MiniMax",
    availableProviders: ["pika"],
    defaultProvider: "pika",
    kind: "audio",
    defaultAspectRatio: "1:1",
    description: "MiniMax Speech 2.8 HD text-to-speech from the current Pika catalog.",
    parameters: [
      {
        id: "voice_id",
        label: "Voice ID",
        type: "text",
        defaultValue: "English_Graceful_Lady"
      }
    ],
    defaultParams: { voice_id: "English_Graceful_Lady" },
    input: { requiresPrompt: true, inputMode: {} }
  },
  // ─── Image: Nano Banana 2 (fal.ai) ──────────────────────────
  {
    id: "nano-banana-2",
    name: "Nano Banana 2",
    aliases: ["gemini-3.1-flash-image"],
    provider: "Google",
    availableProviders: ["official", "fal", "pika", "replicate"],
    defaultProvider: "official",
    kind: "image",
    defaultAspectRatio: "16:9",
    description: "State-of-the-art fast image generation and editing.",
    parameters: [
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: NANO_BANANA_ASPECT_RATIOS.map((r) => ({
          label: r.label,
          value: r.value
        })),
        defaultValue: "16:9"
      },
      {
        id: "resolution",
        label: "Resolution",
        type: "select",
        options: NANO_BANANA_RESOLUTIONS.map((s) => ({
          label: s.label,
          value: s.value
        })),
        defaultValue: "1K"
      },
      {
        id: "count",
        label: "Count",
        type: "number",
        min: 1,
        max: 4,
        step: 1,
        defaultValue: 1,
        description: "How many images to generate."
      }
    ],
    defaultParams: {
      aspect_ratio: "16:9",
      resolution: "1K",
      count: 1
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 8 } },
      promptModalities: ["text", "image"],
      referenceBinding: GROUPED_REFERENCE_BINDING
    }
  },
  // ─── Image: Nano Banana 2 Lite (Google) ────────────────────
  {
    id: "nano-banana-2-lite",
    name: "Nano Banana 2 Lite",
    aliases: ["gemini-3.1-flash-lite-image"],
    provider: "Google",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "image",
    defaultAspectRatio: "16:9",
    description: "Fast Gemini 3.1 Flash-Lite image generation.",
    parameters: [
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: NANO_BANANA_LITE_ASPECT_RATIOS.map((r) => ({ label: r.label, value: r.value })),
        defaultValue: "16:9"
      }
    ],
    defaultParams: {
      aspect_ratio: "16:9"
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 14 } }, promptModalities: ["text", "image"], referenceBinding: GROUPED_REFERENCE_BINDING }
  },
  // ─── Image: GPT Image 2 (OpenAI) ────────────────────────────
  {
    id: "gpt-image-2",
    name: "GPT Image 2",
    provider: "OpenAI",
    availableProviders: ["official", "fal", "pika", "replicate"],
    defaultProvider: "official",
    kind: "image",
    defaultAspectRatio: "1:1",
    description: "OpenAI GPT Image 2 \u2014 high-quality image generation and editing.",
    parameters: [
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: GPT_IMAGE_ASPECT_RATIOS.map((r) => ({
          label: r.label,
          value: r.value
        })),
        defaultValue: "1:1"
      },
      {
        id: "resolution",
        label: "Resolution",
        type: "select",
        options: GPT_IMAGE_RESOLUTION_TIERS.map((t) => ({
          label: t.label,
          value: t.value
        })),
        defaultValue: "2K"
      },
      {
        id: "quality",
        label: "Quality",
        type: "select",
        options: [
          { label: "Auto", value: "auto" },
          { label: "Low", value: "low" },
          { label: "Medium", value: "medium" },
          { label: "High", value: "high" }
        ],
        defaultValue: "auto"
      },
      {
        id: "output_format",
        label: "Format",
        type: "select",
        options: [
          { label: "PNG", value: "png" },
          { label: "JPEG", value: "jpeg" },
          { label: "WebP", value: "webp" }
        ],
        defaultValue: "png"
      },
      {
        // gpt-image-2 does not support transparent backgrounds.
        id: "background",
        label: "Background",
        type: "select",
        options: [
          { label: "Auto", value: "auto" },
          { label: "Opaque", value: "opaque" }
        ],
        defaultValue: "auto"
      },
      {
        id: "moderation",
        label: "Moderation",
        type: "select",
        options: [
          { label: "Auto", value: "auto" },
          { label: "Low", value: "low" }
        ],
        defaultValue: "auto"
      },
      {
        id: "count",
        label: "Count",
        type: "number",
        min: 1,
        max: 4,
        step: 1,
        defaultValue: 1
      }
    ],
    defaultParams: {
      size: "auto",
      quality: "auto",
      output_format: "png",
      background: "auto",
      moderation: "auto",
      count: 1
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 16 } },
      promptModalities: ["text", "image"],
      referenceBinding: GROUPED_REFERENCE_BINDING
    },
    maxRuntimeMs: 3 * 60 * 1e3
  },
  // ─── Image: Seedream 4.5 (fal.ai) ───────────────────────────
  {
    id: "seedream-4.5",
    name: "Seedream 4.5",
    provider: "ByteDance",
    availableProviders: ["fal"],
    defaultProvider: "fal",
    kind: "image",
    defaultAspectRatio: "1:1",
    description: "ByteDance Seedream 4.5 image generation and editing through fal.ai.",
    parameters: [
      aspectRatioParameter({
        ratios: CANONICAL_IMAGE_ASPECT_RATIOS.map((r) => r.value),
        defaultValue: "auto",
        auto: { label: "Auto" }
      }),
      {
        // Seedream's own tier, kept separate from the ratio the way minimax-h3
        // already separates them. Folding both into one `image_size` enum made
        // "Auto 2K" look like an aspect ratio.
        id: "resolution",
        label: "Resolution",
        type: "select",
        options: [
          { label: "2K", value: "2K" },
          { label: "4K", value: "4K" }
        ],
        defaultValue: "2K"
      },
      {
        id: "count",
        label: "Count",
        type: "number",
        min: 1,
        max: 4,
        step: 1,
        defaultValue: 1
      },
      {
        id: "max_images",
        label: "Images per generation",
        type: "number",
        min: 1,
        max: 4,
        step: 1,
        defaultValue: 1
      }
    ],
    defaultParams: {
      image_size: "auto_2K",
      count: 1,
      max_images: 1
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 10 } }, promptModalities: ["text", "image"], referenceBinding: GROUPED_REFERENCE_BINDING },
    maxRuntimeMs: 4 * 60 * 1e3
  },
  // ─── Image: FLUX Schnell (fal.ai) ────────────────────────────
  {
    id: "flux-schnell",
    name: "FLUX Schnell",
    provider: "fal.ai",
    availableProviders: ["fal", "replicate"],
    defaultProvider: "fal",
    kind: "image",
    defaultAspectRatio: "16:9",
    description: "Ultra-fast image generation, ~1s per image.",
    parameters: [
      aspectRatioParameter({
        ratios: CANONICAL_IMAGE_ASPECT_RATIOS.map((r) => r.value),
        defaultValue: "16:9"
      }),
      {
        id: "num_inference_steps",
        label: "Steps",
        type: "number",
        min: 1,
        max: 12,
        step: 1,
        defaultValue: 4,
        description: "More steps = higher quality but slower."
      },
      {
        id: "count",
        label: "Count",
        type: "number",
        min: 1,
        max: 4,
        step: 1,
        defaultValue: 1
      }
    ],
    defaultParams: {
      image_size: "landscape_16_9",
      num_inference_steps: 4,
      count: 1
    },
    input: { requiresPrompt: true, inputMode: {} }
  },
  // ─── Image: FLUX Dev (fal.ai) ────────────────────────────────
  {
    id: "flux-dev",
    name: "FLUX Dev",
    provider: "fal.ai",
    availableProviders: ["fal"],
    defaultProvider: "fal",
    kind: "image",
    defaultAspectRatio: "16:9",
    description: "High-quality image generation with great prompt following.",
    parameters: [
      aspectRatioParameter({
        ratios: CANONICAL_IMAGE_ASPECT_RATIOS.map((r) => r.value),
        defaultValue: "16:9"
      }),
      {
        id: "num_inference_steps",
        label: "Steps",
        type: "number",
        min: 1,
        max: 50,
        step: 1,
        defaultValue: 28,
        description: "More steps = higher quality but slower."
      },
      {
        id: "guidance_scale",
        label: "Guidance Scale",
        type: "slider",
        min: 1,
        max: 20,
        step: 0.5,
        defaultValue: 3.5,
        description: "How closely to follow the prompt."
      },
      {
        id: "count",
        label: "Count",
        type: "number",
        min: 1,
        max: 4,
        step: 1,
        defaultValue: 1
      }
    ],
    defaultParams: {
      image_size: "landscape_16_9",
      num_inference_steps: 28,
      guidance_scale: 3.5,
      count: 1
    },
    input: { requiresPrompt: true, inputMode: {} }
  },
  // ─── Video: Pika 2.5 (Pika API Club) ───────────────────────
  {
    id: "pika-2.5",
    name: "Pika 2.5",
    provider: "Pika",
    availableProviders: ["pika"],
    defaultProvider: "pika",
    kind: "video",
    defaultAspectRatio: "1:1",
    description: "Pika 2.5 text-to-video and image-to-video through the Pika API Club.",
    parameters: [
      {
        id: "duration",
        label: "Duration",
        type: "select",
        options: [{ label: "5s", value: 5 }],
        defaultValue: 5
      },
      {
        id: "resolution",
        label: "Resolution",
        type: "select",
        options: [{ label: "720p", value: "720p" }, { label: "1080p", value: "1080p" }],
        defaultValue: "720p"
      },
      {
        id: "negative_prompt",
        label: "Negative prompt",
        type: "text",
        required: false
      },
      {
        id: "seed",
        label: "Seed",
        type: "number",
        required: false
      }
    ],
    defaultParams: {
      duration: 5,
      resolution: "720p"
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 1 } } }
  },
  // ─── Video: Sora 2 (fal.ai) ─────────────────────────────────
  {
    // Single card — provider auto-routes to /text-to-video or /image-to-video.
    id: "sora-2",
    name: "Sora 2",
    provider: "fal.ai",
    availableProviders: ["fal"],
    defaultProvider: "fal",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "OpenAI Sora 2 \u2014 text-to-video or animate a still image.",
    parameters: [
      {
        id: "duration",
        label: "Duration",
        type: "select",
        options: [
          { label: "4s", value: 4 },
          { label: "8s", value: 8 },
          { label: "12s", value: 12 },
          { label: "16s", value: 16 },
          { label: "20s", value: 20 }
        ],
        defaultValue: 4
      },
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: SORA_ASPECT_RATIOS.map((r) => ({ label: r.label, value: r.value })),
        defaultValue: "16:9"
      },
      {
        id: "resolution",
        label: "Resolution",
        type: "select",
        options: [{ label: "720p", value: "720p" }, { label: "1080p", value: "1080p" }],
        defaultValue: "720p"
      }
    ],
    defaultParams: {
      duration: 4,
      aspect_ratio: "16:9",
      resolution: "720p"
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 1 } } }
  },
  // ─── Video: Seedance 2.0 image-to-video ────────────────────
  // Start frame required, end frame optional — the native shape of
  // bytedance/seedance-2.0/image-to-video (a single image is just the start
  // slot; optional end slot constrains the final frame).
  {
    id: "seedance-2-startend",
    name: "Seedance 2.0 (Start/End)",
    provider: "fal.ai",
    availableProviders: ["volcengine", "fal", "pika", "replicate"],
    defaultProvider: "volcengine",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Seedance 2.0 \u2014 animate from a start frame, optionally constrained to a target end frame.",
    parameters: [
      {
        id: "duration",
        label: "Duration",
        type: "select",
        options: [
          { label: "Auto", value: "auto" },
          { label: "4s", value: 4 },
          { label: "6s", value: 6 },
          { label: "8s", value: 8 },
          { label: "10s", value: 10 },
          { label: "15s", value: 15 }
        ],
        defaultValue: "auto"
      },
      {
        id: "resolution",
        label: "Resolution",
        type: "select",
        options: [
          { label: "480p", value: "480p" },
          { label: "720p", value: "720p" }
        ],
        defaultValue: "720p"
      },
      {
        id: "generate_audio",
        label: "Native audio",
        type: "boolean",
        defaultValue: true
      },
      {
        id: "seed",
        label: "Seed",
        type: "number",
        required: false,
        description: "Optional deterministic seed. The same seed may still produce minor variations."
      }
    ],
    defaultParams: {
      duration: "auto",
      resolution: "720p",
      generate_audio: true
    },
    input: {
      requiresPrompt: true,
      inputMode: {
        startEnd: { constraints: SEEDANCE_IMAGE_CONSTRAINTS },
        maxEmbeddedRequestBytes: SEEDANCE_MAX_EMBEDDED_REQUEST_BYTES
      }
    }
  },
  // ─── Video: Seedance 2.0 reference-to-video ────────────────
  // Separate endpoint with multi-modal refs. Up to 15 total files across
  // images (≤9), videos (≤3), audios (≤3). Positional prompt references
  // (@Image1, @Video2, @Audio1).
  {
    id: "seedance-2-ref",
    aliases: ["seedance-2-text"],
    name: "Seedance 2.0 (\u5168\u80FD\u53C2\u8003)",
    provider: "ByteDance",
    availableProviders: ["volcengine", "fal", "pika", "replicate"],
    defaultProvider: "volcengine",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Seedance 2.0 all-purpose generation with optional image, video, and audio references.",
    parameters: [
      {
        id: "duration",
        label: "Duration",
        type: "select",
        options: [
          { label: "Auto", value: "auto" },
          { label: "4s", value: 4 },
          { label: "6s", value: 6 },
          { label: "8s", value: 8 },
          { label: "10s", value: 10 },
          { label: "15s", value: 15 }
        ],
        defaultValue: "auto"
      },
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: SEEDANCE_ASPECT_RATIOS.map((r) => ({
          label: r.label,
          value: r.value
        })),
        defaultValue: "auto"
      },
      {
        id: "resolution",
        label: "Resolution",
        type: "select",
        options: [
          { label: "480p", value: "480p" },
          { label: "720p", value: "720p" }
        ],
        defaultValue: "720p"
      },
      {
        id: "generate_audio",
        label: "Native audio",
        type: "boolean",
        defaultValue: true
      },
      {
        id: "seed",
        label: "Seed",
        type: "number",
        required: false,
        description: "Optional deterministic seed. The same seed may still produce minor variations."
      },
      {
        id: "edit_mode",
        label: "Edit referenced video",
        type: "boolean",
        required: false,
        description: "Edit the attached video instead of generating a new clip from references.",
        defaultValue: false
      }
    ],
    defaultParams: {
      duration: "auto",
      aspect_ratio: "auto",
      resolution: "720p",
      generate_audio: true,
      edit_mode: false
    },
    input: {
      requiresPrompt: true,
      referenceBinding: POSITIONAL_REFERENCE_BINDING,
      inputMode: {
        images: { max: 9, constraints: SEEDANCE_IMAGE_CONSTRAINTS },
        videos: {
          max: 3,
          constraints: { ...SEEDANCE_VIDEO_CONSTRAINTS, maxDurationMs: 15e3 },
          maxTotalDurationMs: 15e3
        },
        audios: {
          max: 3,
          requiresAnyOf: ["image", "video"],
          constraints: { ...SEEDANCE_AUDIO_CONSTRAINTS, maxDurationMs: 15e3 },
          maxTotalDurationMs: 15e3
        },
        maxTotalReferences: 15,
        maxEmbeddedRequestBytes: SEEDANCE_MAX_EMBEDDED_REQUEST_BYTES
      },
      promptModalities: ["text", "image", "video", "audio"]
    }
  },
  // ─── Video: Seedance 2.0 continuation ─────────────────────
  {
    id: "seedance-2-extend",
    name: "Seedance 2.0 (Video Extension)",
    provider: "ByteDance",
    availableProviders: ["volcengine"],
    defaultProvider: "volcengine",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Continue one to three ordered source videos with Seedance 2.0.",
    parameters: [
      {
        id: "duration",
        label: "Duration",
        type: "select",
        options: [
          { label: "Auto", value: "auto" },
          ...Array.from({ length: 12 }, (_, index) => ({
            label: `${index + 4}s`,
            value: index + 4
          }))
        ],
        defaultValue: "auto"
      },
      {
        id: "resolution",
        label: "Resolution",
        type: "select",
        options: ["480p", "720p", "1080p", "4k"].map((value) => ({
          label: value,
          value
        })),
        defaultValue: "720p"
      },
      {
        id: "generate_audio",
        label: "Native audio",
        type: "boolean",
        defaultValue: true
      }
    ],
    defaultParams: { duration: "auto", resolution: "720p", generate_audio: true },
    input: {
      requiresPrompt: true,
      inputMode: {
        videos: {
          min: 1,
          max: 3,
          constraints: { ...SEEDANCE_VIDEO_CONSTRAINTS, maxDurationMs: 15e3 },
          maxTotalDurationMs: 15e3
        },
        maxTotalReferences: 3,
        maxEmbeddedRequestBytes: SEEDANCE_MAX_EMBEDDED_REQUEST_BYTES
      },
      promptModalities: ["text", "video"],
      referenceBinding: POSITIONAL_REFERENCE_BINDING,
      presentation: { type: "video-continuation" }
    },
    maxRuntimeMs: 30 * 60 * 1e3
  },
  // ─── Video: Seedance 2.5 all-purpose reference ─────────────
  {
    id: "seedance-2.5-ref",
    aliases: ["seedance-2.5-text"],
    name: "Seedance 2.5 (\u5168\u80FD\u53C2\u8003)",
    provider: "ByteDance",
    availableProviders: ["volcengine"],
    defaultProvider: "volcengine",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Seedance 2.5 all-purpose generation with optional image, video, and audio references.",
    parameters: [
      {
        id: "duration",
        label: "Duration",
        type: "select",
        options: [
          { label: "Auto", value: "auto" },
          ...Array.from({ length: 27 }, (_, index) => ({
            label: `${index + 4}s`,
            value: index + 4
          }))
        ],
        defaultValue: 5
      },
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: ["auto", "1:1", "3:4", "16:9", "4:3", "9:16", "21:9"].map((value) => ({
          label: value === "auto" ? "Auto" : value,
          value
        })),
        defaultValue: "16:9"
      },
      {
        id: "resolution",
        label: "Resolution",
        type: "select",
        options: [
          { label: "480p", value: "480p" },
          { label: "720p", value: "720p" }
        ],
        defaultValue: "720p"
      },
      {
        id: "generate_audio",
        label: "Native audio",
        type: "boolean",
        defaultValue: true
      },
      {
        id: "edit_mode",
        label: "Edit referenced video",
        type: "boolean",
        required: false,
        description: "Edit the attached video instead of generating a new clip from references.",
        defaultValue: false
      }
    ],
    defaultParams: {
      duration: 5,
      aspect_ratio: "16:9",
      resolution: "720p",
      generate_audio: true,
      edit_mode: false
    },
    input: {
      requiresPrompt: true,
      referenceBinding: POSITIONAL_REFERENCE_BINDING,
      inputMode: {
        images: { max: 30, constraints: SEEDANCE_IMAGE_CONSTRAINTS },
        videos: {
          max: 10,
          constraints: { ...SEEDANCE_VIDEO_CONSTRAINTS, maxDurationMs: 3e4 },
          maxTotalDurationMs: 3e4
        },
        audios: {
          max: 10,
          constraints: { ...SEEDANCE_AUDIO_CONSTRAINTS, maxDurationMs: 3e4 },
          maxTotalDurationMs: 3e4
        },
        maxTotalReferences: 50,
        maxEmbeddedRequestBytes: SEEDANCE_MAX_EMBEDDED_REQUEST_BYTES
      },
      promptModalities: ["text", "image", "video", "audio"]
    },
    maxRuntimeMs: 30 * 60 * 1e3
  },
  // ─── Video: Seedance 2.5 first / last frame ────────────────
  {
    id: "seedance-2.5-startend",
    name: "Seedance 2.5 (Start / End Frame)",
    provider: "ByteDance",
    availableProviders: ["volcengine"],
    defaultProvider: "volcengine",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Animate from a required start frame toward an optional end frame with Seedance 2.5.",
    parameters: [
      {
        id: "duration",
        label: "Duration",
        type: "select",
        options: [
          { label: "Auto", value: "auto" },
          ...Array.from({ length: 27 }, (_, index) => ({
            label: `${index + 4}s`,
            value: index + 4
          }))
        ],
        defaultValue: 5
      },
      {
        id: "resolution",
        label: "Resolution",
        type: "select",
        options: [
          { label: "480p", value: "480p" },
          { label: "720p", value: "720p" }
        ],
        defaultValue: "720p"
      },
      {
        id: "generate_audio",
        label: "Native audio",
        type: "boolean",
        defaultValue: true
      }
    ],
    defaultParams: { duration: 5, resolution: "720p", generate_audio: true },
    input: {
      requiresPrompt: true,
      inputMode: {
        startEnd: { constraints: SEEDANCE_IMAGE_CONSTRAINTS },
        maxEmbeddedRequestBytes: SEEDANCE_MAX_EMBEDDED_REQUEST_BYTES
      },
      promptModalities: ["text"]
    },
    maxRuntimeMs: 30 * 60 * 1e3
  },
  // ─── Video: Seedance 2.5 continuation ─────────────────────
  {
    id: "seedance-2.5-extend",
    name: "Seedance 2.5 (Video Extension)",
    provider: "ByteDance",
    availableProviders: ["volcengine"],
    defaultProvider: "volcengine",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Continue one to ten ordered source videos with Seedance 2.5.",
    parameters: [
      {
        id: "duration",
        label: "Duration",
        type: "select",
        options: [
          { label: "Auto", value: "auto" },
          ...Array.from({ length: 27 }, (_, index) => ({
            label: `${index + 4}s`,
            value: index + 4
          }))
        ],
        defaultValue: "auto"
      },
      {
        id: "resolution",
        label: "Resolution",
        type: "select",
        options: ["480p", "720p"].map((value) => ({ label: value, value })),
        defaultValue: "720p"
      },
      {
        id: "generate_audio",
        label: "Native audio",
        type: "boolean",
        defaultValue: true
      }
    ],
    defaultParams: {
      duration: "auto",
      resolution: "720p",
      generate_audio: true
    },
    input: {
      requiresPrompt: true,
      inputMode: {
        videos: {
          min: 1,
          max: 10,
          constraints: { ...SEEDANCE_VIDEO_CONSTRAINTS, maxDurationMs: 3e4 },
          maxTotalDurationMs: 3e4
        },
        maxTotalReferences: 10,
        maxEmbeddedRequestBytes: SEEDANCE_MAX_EMBEDDED_REQUEST_BYTES
      },
      promptModalities: ["text", "video"],
      referenceBinding: POSITIONAL_REFERENCE_BINDING,
      presentation: { type: "video-continuation" }
    },
    maxRuntimeMs: 30 * 60 * 1e3
  },
  // ─── Video: MiniMax H3 all-purpose reference ───────────────
  {
    id: "minimax-h3",
    name: "MiniMax H3 (\u5168\u80FD\u53C2\u8003)",
    aliases: ["MiniMax-H3", "hailuo-3", "minimax-hailuo-3", "minimax-h3-ref", "minimax-h3-reference"],
    provider: "MiniMax",
    availableProviders: ["minimax", "fal", "pika"],
    defaultProvider: "minimax",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "MiniMax H3 all-purpose generation with optional ordered image, video, and audio references.",
    parameters: [
      {
        id: "duration",
        label: "Duration",
        type: "select",
        options: Array.from({ length: 12 }, (_, index) => ({
          label: `${index + 4}s`,
          value: index + 4
        })),
        defaultValue: 5
      },
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: [
          { label: "Auto", value: "adaptive" },
          ...["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].map((value) => ({ label: value, value }))
        ],
        defaultValue: "adaptive"
      },
      {
        id: "resolution",
        label: "Resolution",
        type: "select",
        options: [{ label: "768P", value: "768P" }, { label: "2K", value: "2K" }],
        defaultValue: "2K"
      }
    ],
    defaultParams: {
      duration: 5,
      aspect_ratio: "adaptive",
      resolution: "2K"
    },
    input: {
      requiresPrompt: true,
      referenceBinding: {
        type: "ordered-content-parts",
        usesRoles: true,
        modalityScopedIndexes: true
      },
      inputMode: {
        images: { max: 9, constraints: MINIMAX_H3_IMAGE_CONSTRAINTS },
        videos: { max: 3, constraints: MINIMAX_H3_VIDEO_CONSTRAINTS, maxTotalDurationMs: 15e3 },
        audios: { max: 3, requiresAnyOf: ["image", "video"], constraints: MINIMAX_H3_AUDIO_CONSTRAINTS, maxTotalDurationMs: 15e3 },
        maxTotalReferences: 12,
        maxEmbeddedRequestBytes: MINIMAX_H3_MAX_EMBEDDED_REQUEST_BYTES
      },
      promptModalities: ["text", "image", "video", "audio"]
    },
    maxRuntimeMs: 15 * 60 * 1e3
  },
  // ─── Video: MiniMax H3 first / last frame ──────────────────
  {
    id: "minimax-h3-startend",
    name: "MiniMax H3 (Start / End Frame)",
    aliases: ["minimax-h3-start-end"],
    provider: "MiniMax",
    availableProviders: ["minimax", "fal", "pika"],
    defaultProvider: "minimax",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Animate from a required start frame toward an optional end frame with MiniMax H3.",
    promptGuidance: "Use start and end frames with matching aspect ratios. The output ratio follows the input frames.",
    parameters: [
      {
        id: "duration",
        label: "Duration",
        type: "select",
        options: Array.from({ length: 12 }, (_, index) => ({
          label: `${index + 4}s`,
          value: index + 4
        })),
        defaultValue: 5
      },
      {
        id: "resolution",
        label: "Resolution",
        type: "select",
        options: [{ label: "768P", value: "768P" }, { label: "2K", value: "2K" }],
        defaultValue: "2K"
      }
    ],
    defaultParams: {
      duration: 5,
      resolution: "2K"
    },
    input: {
      requiresPrompt: true,
      inputMode: {
        startEnd: { constraints: MINIMAX_H3_IMAGE_CONSTRAINTS },
        maxEmbeddedRequestBytes: MINIMAX_H3_MAX_EMBEDDED_REQUEST_BYTES
      },
      promptModalities: ["text"]
    },
    maxRuntimeMs: 15 * 60 * 1e3
  },
  // ─── Video: Kling 3 Pro (fal.ai) — first frame + optional end frame ────
  {
    id: "kling-3",
    name: "Kling 3 Pro",
    provider: "fal.ai",
    availableProviders: ["kling", "fal", "pika"],
    defaultProvider: "kling",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Kling 3 Pro \u2014 first + optional end frame, with native audio.",
    parameters: [
      durationParameter({
        seconds: Array.from({ length: 13 }, (_, index) => index + 3),
        defaultValue: 5
      }),
      {
        id: "generate_audio",
        label: "Native audio",
        type: "boolean",
        defaultValue: true
      }
    ],
    defaultParams: {
      duration: 5,
      generate_audio: true
    },
    input: { requiresPrompt: true, inputMode: { startEnd: {} } }
  },
  // ─── Video: FLUX 3 (BFL official + fal.ai) ─────────────────
  {
    id: "flux-3-video",
    aliases: ["flux3-video", "flux-3"],
    name: "FLUX 3 Video",
    provider: "Black Forest Labs",
    availableProviders: ["official", "fal", "pika"],
    defaultProvider: "official",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "FLUX 3 text-to-video with synchronized audio and clips up to 20 seconds.",
    parameters: flux3VideoParameters(),
    defaultParams: FLUX3_VIDEO_DEFAULT_PARAMS,
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
    maxRuntimeMs: 30 * 60 * 1e3
  },
  {
    id: "flux-3-video-keyframes",
    aliases: ["flux3-keyframes", "flux-3-image-to-video"],
    name: "FLUX 3 Video (Keyframes)",
    provider: "Black Forest Labs",
    availableProviders: ["official", "fal"],
    defaultProvider: "official",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Animate one image or connect up to ten ordered keyframes with FLUX 3.",
    parameters: flux3VideoParameters({ allowAutoDuration: false }),
    defaultParams: FLUX3_KEYFRAME_VIDEO_DEFAULT_PARAMS,
    input: {
      requiresPrompt: true,
      inputMode: { images: { min: 1, max: 10 }, maxTotalReferences: 10 },
      promptModalities: ["text", "image"],
      referenceBinding: { type: "grouped-references" },
      presentation: { type: "keyframes", timing: "explicit", frameRate: 24 }
    },
    maxRuntimeMs: 30 * 60 * 1e3
  },
  {
    id: "flux-3-video-continue",
    aliases: ["flux3-continue", "flux-3-extend-video"],
    name: "FLUX 3 Video (Continue)",
    provider: "Black Forest Labs",
    availableProviders: ["official", "fal"],
    defaultProvider: "official",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Continue one existing MP4 clip from its final frames with synchronized audio.",
    parameters: flux3VideoParameters(),
    defaultParams: FLUX3_VIDEO_DEFAULT_PARAMS,
    input: {
      requiresPrompt: true,
      inputMode: {
        videos: {
          min: 1,
          max: 1,
          constraints: {
            mimeTypes: ["video/mp4"],
            fileExtensions: ["mp4"],
            maxBytes: 50 * 1024 * 1024,
            maxDurationMs: 15e3
          }
        },
        maxTotalReferences: 1
      },
      promptModalities: ["text", "video"],
      referenceBinding: { type: "grouped-references" },
      presentation: { type: "video-continuation" }
    },
    maxRuntimeMs: 30 * 60 * 1e3
  },
  // ─── Image: Recraft V4 Pro (fal.ai) ──────────────────────────
  {
    id: "recraft-v4",
    name: "Recraft V4",
    provider: "fal.ai",
    availableProviders: ["fal", "pika"],
    defaultProvider: "fal",
    kind: "image",
    defaultAspectRatio: "16:9",
    description: "Designer-grade image generation with color control and text rendering.",
    parameters: [
      aspectRatioParameter({
        ratios: CANONICAL_IMAGE_ASPECT_RATIOS.map((r) => r.value),
        defaultValue: "16:9"
      })
    ],
    defaultParams: {
      image_size: "square_hd"
    },
    input: { requiresPrompt: true, inputMode: {} }
  },
  // ─── Image: FLUX 2 Pro (fal.ai) ──────────────────────────────
  {
    id: "flux-2-pro",
    name: "FLUX 2 Pro",
    provider: "fal.ai",
    availableProviders: ["fal"],
    defaultProvider: "fal",
    kind: "image",
    defaultAspectRatio: "4:3",
    description: "Latest FLUX flagship \u2014 high-quality image generation.",
    parameters: [
      aspectRatioParameter({
        ratios: CANONICAL_IMAGE_ASPECT_RATIOS.map((r) => r.value),
        defaultValue: "16:9"
      }),
      {
        id: "safety_tolerance",
        label: "Safety Tolerance",
        type: "select",
        options: [
          { label: "Strict (1)", value: "1" },
          { label: "Moderate (2)", value: "2" },
          { label: "Balanced (3)", value: "3" },
          { label: "Relaxed (4)", value: "4" },
          { label: "Permissive (5)", value: "5" }
        ],
        defaultValue: "2"
      }
    ],
    defaultParams: {
      image_size: "landscape_4_3",
      safety_tolerance: "2"
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 8 } },
      promptModalities: ["text", "image"],
      referenceBinding: GROUPED_REFERENCE_BINDING
    }
  },
  // ─── Image: Nano Banana Pro (Google) ────────────────────────
  {
    id: "nano-banana-pro",
    name: "Nano Banana Pro",
    aliases: ["gemini-3-pro-image"],
    provider: "Google",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "image",
    defaultAspectRatio: "16:9",
    description: "Highest quality Google image generation and editing.",
    parameters: [
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: IMAGEN_ASPECT_RATIOS.map((r) => ({ label: r.label, value: r.value })),
        defaultValue: "16:9"
      }
    ],
    defaultParams: {
      aspect_ratio: "16:9"
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 8 } }, promptModalities: ["text", "image"], referenceBinding: GROUPED_REFERENCE_BINDING }
  },
  // ─── Video: Veo 3.1 (Google native via Vercel AI SDK) ──────
  //
  // Veo 3.1 Vertex pricing is identical across input modes (only variant +
  // audio on/off differ), so we only split cards where the input *contract*
  // conflicts. Specifically:
  //   - text-only + reference-image workflows share one card, since the
  //     reference-image rule (`images.max: 3`) already covers "zero refs" as
  //     the text-only case.
  //   - startEnd (first frame required, last optional) is a separate card
  //     because the `startEnd` contract has a required slot that can't
  //     coexist with optional ref images in the same UI.
  //
  // Text-only video variants are intentionally not published as product
  // cards. A video card must expose at least one meaningful reference input.
  {
    id: "veo-3.1",
    name: "Veo 3.1",
    provider: "Google",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Google Veo 3.1 \u2014 text-to-video, optionally with 1\u20133 reference subject images.",
    parameters: [
      VEO3_DURATION_PARAMETER,
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: VEO3_ASPECT_RATIOS.map((r) => ({ label: r.label, value: r.value })),
        defaultValue: "16:9"
      },
      {
        id: "generate_audio",
        label: "Generate Audio",
        type: "boolean",
        defaultValue: true,
        description: "Include natively generated audio."
      }
    ],
    defaultParams: {
      duration: 4,
      aspect_ratio: "16:9",
      generate_audio: true
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 3 } } }
  },
  {
    id: "veo-3.1-startend",
    name: "Veo 3.1 (Start/End)",
    provider: "Google",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Google Veo 3.1 \u2014 first-and-last-frame interpolation between two key frames.",
    parameters: [
      VEO3_DURATION_PARAMETER,
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: VEO3_ASPECT_RATIOS.map((r) => ({ label: r.label, value: r.value })),
        defaultValue: "16:9"
      },
      {
        id: "generate_audio",
        label: "Generate Audio",
        type: "boolean",
        defaultValue: true,
        description: "Include natively generated audio."
      }
    ],
    defaultParams: {
      duration: 4,
      aspect_ratio: "16:9",
      generate_audio: true
    },
    input: { requiresPrompt: true, inputMode: { startEnd: {} } }
  },
  {
    id: "veo-3.1-fast",
    name: "Veo 3.1 Fast",
    provider: "Google",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Google Veo 3.1 Fast \u2014 text-to-video, optionally with 1\u20133 reference subject images.",
    parameters: [
      VEO3_DURATION_PARAMETER,
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: VEO3_ASPECT_RATIOS.map((r) => ({ label: r.label, value: r.value })),
        defaultValue: "16:9"
      },
      {
        id: "generate_audio",
        label: "Generate Audio",
        type: "boolean",
        defaultValue: true,
        description: "Include natively generated audio."
      }
    ],
    defaultParams: {
      duration: 4,
      aspect_ratio: "16:9",
      generate_audio: true
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 3 } } }
  },
  {
    id: "veo-3.1-fast-startend",
    name: "Veo 3.1 Fast (Start/End)",
    provider: "Google",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Google Veo 3.1 Fast \u2014 first-and-last-frame interpolation between two key frames.",
    parameters: [
      VEO3_DURATION_PARAMETER,
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: VEO3_ASPECT_RATIOS.map((r) => ({ label: r.label, value: r.value })),
        defaultValue: "16:9"
      },
      {
        id: "generate_audio",
        label: "Generate Audio",
        type: "boolean",
        defaultValue: true,
        description: "Include natively generated audio."
      }
    ],
    defaultParams: {
      duration: 4,
      aspect_ratio: "16:9",
      generate_audio: true
    },
    input: { requiresPrompt: true, inputMode: { startEnd: {} } }
  },
  {
    id: "gemini-omni-flash",
    name: "Gemini Omni Flash",
    aliases: ["gemini-omni-flash-preview"],
    provider: "Google",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Google Gemini Omni Flash preview \u2014 text-to-video generation with native audio output.",
    promptGuidance: "Describe scene, motion, camera, lighting, timing, and desired audio.",
    parameters: [
      {
        id: "duration",
        label: "Duration",
        type: "select",
        options: Array.from({ length: 8 }, (_, index) => ({
          label: `${index + 3}s`,
          value: index + 3
        })),
        defaultValue: 5
      },
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: [
          { label: "16:9", value: "16:9" },
          { label: "9:16", value: "9:16" }
        ],
        defaultValue: "16:9"
      },
      {
        id: "resolution",
        label: "Resolution",
        type: "select",
        readOnly: true,
        options: [{ label: "720p", value: "720p" }],
        defaultValue: "720p"
      },
      {
        id: "frame_rate",
        label: "Frame Rate",
        type: "select",
        readOnly: true,
        options: [{ label: "24 fps", value: 24 }],
        defaultValue: 24
      },
      {
        id: "native_audio",
        label: "Native Audio",
        type: "boolean",
        readOnly: true,
        defaultValue: true,
        description: "Gemini Omni Flash always returns generated audio with the video."
      }
    ],
    defaultParams: {
      duration: 5,
      aspect_ratio: "16:9",
      resolution: "720p",
      frame_rate: 24,
      native_audio: true
    },
    // The captured Interactions request is text-only. Do not advertise reference media until a
    // real accepted request establishes the wire shape; the Provider adapter fails closed too.
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
    maxRuntimeMs: 15 * 60 * 1e3
  },
  // ─── Text ────────────────────────────────────────────────────
  {
    id: "minimax-m3",
    aliases: ["MiniMax-M3"],
    name: "MiniMax M3",
    provider: "MiniMax",
    availableProviders: ["minimax"],
    defaultProvider: "minimax",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "General-purpose text generation with MiniMax M3.",
    parameters: [
      {
        id: "system_prompt",
        label: "System prompt",
        type: "text",
        placeholder: "Optional instructions for tone, format, or role",
        defaultValue: ""
      }
    ],
    defaultParams: { system_prompt: "" },
    input: {
      requiresPrompt: true,
      inputMode: {},
      promptModalities: ["text"]
    },
    maxRuntimeMs: 5 * 60 * 1e3
  },
  // ─── Text ────────────────────────────────────────────────────
  {
    id: "gpt-5.4",
    name: "GPT-5.4 Text",
    provider: "OpenAI",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "General-purpose text generation. Accepts image context alongside the prompt (vision).",
    parameters: [
      {
        id: "system_prompt",
        label: "System prompt",
        type: "text",
        placeholder: "Optional instructions for tone, format, or role",
        defaultValue: ""
      }
    ],
    defaultParams: {
      system_prompt: ""
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 10 } },
      referenceBinding: ORDERED_REFERENCE_BINDING,
      promptModalities: ["text", "image"]
    },
    maxRuntimeMs: 5 * 60 * 1e3
  },
  {
    id: "openai-compatible-text",
    name: "OpenAI-compatible",
    provider: "OpenAI-compatible",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "Use any OpenAI-compatible chat endpoint.",
    parameters: [
      {
        id: "model_name",
        label: "Model",
        type: "text",
        placeholder: "gpt-5.4 or provider/model",
        defaultValue: "gpt-5.4"
      },
      {
        id: "system_prompt",
        label: "System prompt",
        type: "text",
        placeholder: "Optional instructions for tone, format, or role",
        defaultValue: ""
      }
    ],
    defaultParams: {
      model_name: "gpt-5.4",
      system_prompt: ""
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 10 } },
      referenceBinding: ORDERED_REFERENCE_BINDING,
      promptModalities: ["text", "image"]
    },
    maxRuntimeMs: 5 * 60 * 1e3
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    provider: "Google",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "Google Gemini 3.5 Flash \u2014 near-Pro agentic capability at Flash-tier speed and cost.",
    parameters: [
      {
        id: "system_prompt",
        label: "System prompt",
        type: "text",
        placeholder: "Optional instructions for tone, format, or role",
        defaultValue: ""
      }
    ],
    defaultParams: {
      system_prompt: ""
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 16 }, videos: { max: 1 }, audios: { max: 1 } },
      referenceBinding: ORDERED_REFERENCE_BINDING,
      promptModalities: ["text", "image", "video", "audio"]
    },
    maxRuntimeMs: 5 * 60 * 1e3
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    provider: "Google",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "Google Gemini 3.1 Pro \u2014 flagship multimodal reasoning across text, image, video, and audio inputs.",
    parameters: [
      {
        id: "system_prompt",
        label: "System prompt",
        type: "text",
        placeholder: "Optional instructions for tone, format, or role",
        defaultValue: ""
      }
    ],
    defaultParams: {
      system_prompt: ""
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 16 }, videos: { max: 1 }, audios: { max: 1 } },
      referenceBinding: ORDERED_REFERENCE_BINDING,
      promptModalities: ["text", "image", "video", "audio"]
    },
    maxRuntimeMs: 5 * 60 * 1e3
  },
  {
    id: "gemini-3-flash",
    name: "Gemini 3 Flash",
    provider: "Google",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "Faster, cheaper Gemini 3 Flash \u2014 multimodal across text, image, video, and audio inputs.",
    parameters: [
      {
        id: "system_prompt",
        label: "System prompt",
        type: "text",
        placeholder: "Optional instructions for tone, format, or role",
        defaultValue: ""
      }
    ],
    defaultParams: {
      system_prompt: ""
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 16 }, videos: { max: 1 }, audios: { max: 1 } },
      referenceBinding: ORDERED_REFERENCE_BINDING,
      promptModalities: ["text", "image", "video", "audio"]
    },
    maxRuntimeMs: 5 * 60 * 1e3
  },
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash-Lite",
    provider: "Google",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "Google Gemini 3.1 Flash-Lite \u2014 low-latency, high-volume text generation with multimodal inputs.",
    parameters: [
      {
        id: "system_prompt",
        label: "System prompt",
        type: "text",
        placeholder: "Optional instructions for tone, format, or role",
        defaultValue: ""
      }
    ],
    defaultParams: {
      system_prompt: ""
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 16 }, videos: { max: 1 }, audios: { max: 1 } },
      referenceBinding: ORDERED_REFERENCE_BINDING,
      promptModalities: ["text", "image", "video", "audio"]
    },
    maxRuntimeMs: 5 * 60 * 1e3
  },
  {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    provider: "Anthropic",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "Anthropic Claude Sonnet 4 text generation. Accepts image context alongside the prompt.",
    parameters: [
      {
        id: "system_prompt",
        label: "System prompt",
        type: "text",
        placeholder: "Optional instructions for tone, format, or role",
        defaultValue: ""
      }
    ],
    defaultParams: {
      system_prompt: ""
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 20 } },
      referenceBinding: ORDERED_REFERENCE_BINDING,
      promptModalities: ["text", "image"]
    },
    maxRuntimeMs: 5 * 60 * 1e3
  },
  {
    id: "anthropic-compatible-text",
    name: "Anthropic-compatible",
    provider: "Anthropic-compatible",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "Use any Anthropic-compatible messages endpoint.",
    parameters: [
      {
        id: "model_name",
        label: "Model",
        type: "text",
        placeholder: "claude-sonnet-4-20250514",
        defaultValue: "claude-sonnet-4-20250514"
      },
      {
        id: "system_prompt",
        label: "System prompt",
        type: "text",
        placeholder: "Optional instructions for tone, format, or role",
        defaultValue: ""
      }
    ],
    defaultParams: {
      model_name: "claude-sonnet-4-20250514",
      system_prompt: ""
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 20 } },
      referenceBinding: ORDERED_REFERENCE_BINDING,
      promptModalities: ["text", "image"]
    },
    maxRuntimeMs: 5 * 60 * 1e3
  },
  // ─── Transcription: audio in, text out ───────────────────────
  {
    id: "sensevoice-small-asr",
    name: "SenseVoice Small",
    provider: "Local",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "Fast local transcription optimized for Mandarin and Chinese-English speech, with Cantonese, Japanese, and Korean support.",
    promptGuidance: "Recommended for Chinese voice input and mixed Chinese-English recordings. Use Whisper Large v3 Turbo when broader multilingual coverage matters more.",
    parameters: [],
    defaultParams: {
      asr_model: "iic/SenseVoiceSmall"
    },
    input: {
      requiresPrompt: false,
      inputMode: { audios: { max: 1, min: 1 } },
      promptModalities: ["audio"]
    },
    maxRuntimeMs: 2 * 60 * 1e3
  },
  {
    id: "whisper-large-v3-turbo-asr",
    name: "Whisper Large v3 Turbo",
    provider: "OpenAI",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "High-accuracy multilingual transcription optimized for Apple Silicon with MLX and word-level timestamps.",
    promptGuidance: "Best for multilingual interviews, dialogue, and production audio where accurate word timing matters.",
    parameters: [],
    defaultParams: {
      asr_model: "mlx-community/whisper-large-v3-turbo"
    },
    input: {
      requiresPrompt: false,
      inputMode: { audios: { max: 1, min: 1 } },
      promptModalities: ["audio"]
    },
    maxRuntimeMs: 10 * 60 * 1e3
  },
  {
    id: "whisper-small-asr",
    name: "Whisper Small",
    provider: "OpenAI",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "A lighter multilingual Whisper model for lower-memory Macs, with real word-level timestamps.",
    promptGuidance: "Choose this on 8 GB Macs or for faster drafts; use Whisper Large v3 Turbo when accuracy matters more.",
    parameters: [],
    defaultParams: {
      asr_model: "mlx-community/whisper-small-mlx"
    },
    input: {
      requiresPrompt: false,
      inputMode: { audios: { max: 1, min: 1 } },
      promptModalities: ["audio"]
    },
    maxRuntimeMs: 10 * 60 * 1e3
  },
  {
    id: "parakeet-tdt-0.6b-v3-asr",
    name: "Parakeet TDT 0.6B v3",
    provider: "NVIDIA",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "Fast local transcription for 25 European languages with real word-level timestamps. Approx. 2.5 GB download; does not support Chinese.",
    promptGuidance: "Use for supported European-language audio on Apple Silicon. It does not support Chinese; choose SenseVoice or Whisper for Chinese recordings.",
    parameters: [],
    defaultParams: {
      asr_model: "mlx-community/parakeet-tdt-0.6b-v3"
    },
    input: {
      requiresPrompt: false,
      inputMode: { audios: { max: 1, min: 1 } },
      promptModalities: ["audio"]
    },
    maxRuntimeMs: 20 * 60 * 1e3
  },
  {
    id: "vibevoice-asr",
    name: "VibeVoice ASR",
    provider: "Microsoft",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "Advanced long-form transcription with speaker diarization, segment timestamps, and Whisper word alignment.",
    promptGuidance: "Use for meetings, podcasts, and long multi-speaker recordings. This is a large download and also requires Whisper Small for word alignment.",
    parameters: [],
    defaultParams: {
      asr_model: "mlx-community/VibeVoice-ASR-4bit",
      alignment_model: "mlx-community/whisper-small-mlx"
    },
    input: {
      requiresPrompt: false,
      inputMode: { audios: { max: 1, min: 1 } },
      promptModalities: ["audio"]
    },
    maxRuntimeMs: 60 * 60 * 1e3
  },
  // ─── Audio ───────────────────────────────────────────────────
  {
    id: "gemini-3.1-flash-tts",
    name: "Gemini 3.1 Flash TTS",
    provider: "Google",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "audio",
    defaultAspectRatio: "1:1",
    description: "Google Gemini TTS preview for low-latency controllable single-speaker audio.",
    parameters: GEMINI_TTS_PARAMETERS,
    defaultParams: {
      voice_name: "Kore"
    },
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
    maxRuntimeMs: 5 * 60 * 1e3
  },
  {
    id: "kokoro-82m-tts",
    name: "Kokoro 82M",
    provider: "Hexgrad",
    kind: "audio",
    defaultAspectRatio: "1:1",
    description: "High-quality lightweight local speech with multilingual voices, accelerated by MLX on Apple Silicon.",
    promptGuidance: "Choose a voice whose language prefix matches the script: a/b for English, z for Mandarin, and j for Japanese.",
    parameters: [
      {
        id: "voice_name",
        label: "Voice",
        type: "select",
        options: [
          { label: "Heart \xB7 US English", value: "af_heart" },
          { label: "Bella \xB7 US English", value: "af_bella" },
          { label: "Adam \xB7 US English", value: "am_adam" },
          { label: "Emma \xB7 British English", value: "bf_emma" },
          { label: "Xiaobei \xB7 Mandarin", value: "zf_xiaobei" },
          { label: "Yunxi \xB7 Mandarin", value: "zm_yunxi" },
          { label: "Alpha \xB7 Japanese", value: "jf_alpha" }
        ],
        defaultValue: "af_heart"
      },
      {
        id: "speed",
        label: "Speed",
        type: "slider",
        min: 0.6,
        max: 1.6,
        step: 0.05,
        defaultValue: 1
      }
    ],
    defaultParams: {
      tts_model: "mlx-community/Kokoro-82M-4bit",
      voice_name: "af_heart",
      speed: 1
    },
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
    maxRuntimeMs: 10 * 60 * 1e3
  },
  {
    id: "piper-huayan-tts",
    name: "Piper Huayan",
    provider: "Local",
    kind: "audio",
    defaultAspectRatio: "1:1",
    description: "Downloadable Mandarin voice running fully on-device with Piper ONNX.",
    parameters: [
      {
        id: "speed",
        label: "Speed",
        type: "slider",
        min: 0.6,
        max: 1.6,
        step: 0.05,
        defaultValue: 1
      }
    ],
    defaultParams: {
      tts_model: "zh_CN-huayan-medium",
      voice_name: "huayan",
      speed: 1
    },
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
    maxRuntimeMs: 2 * 60 * 1e3
  },
  {
    id: "piper-lessac-tts",
    name: "Piper Lessac",
    provider: "Local",
    kind: "audio",
    defaultAspectRatio: "1:1",
    description: "Downloadable English voice running fully on-device with Piper ONNX.",
    parameters: [
      {
        id: "speed",
        label: "Speed",
        type: "slider",
        min: 0.6,
        max: 1.6,
        step: 0.05,
        defaultValue: 1
      }
    ],
    defaultParams: {
      tts_model: "en_US-lessac-medium",
      voice_name: "lessac",
      speed: 1
    },
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
    maxRuntimeMs: 2 * 60 * 1e3
  },
  {
    id: "gemini-2.5-pro-tts",
    name: "Gemini 2.5 Pro TTS",
    provider: "Google",
    availableProviders: ["official"],
    defaultProvider: "official",
    kind: "audio",
    defaultAspectRatio: "1:1",
    description: "Google Gemini TTS with higher control for scripts, narration, and structured speech.",
    parameters: GEMINI_TTS_PARAMETERS,
    defaultParams: {
      voice_name: "Kore"
    },
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
    maxRuntimeMs: 5 * 60 * 1e3
  },
  {
    id: "minimax-tts",
    name: "MiniMax TTS",
    provider: "MiniMax",
    availableProviders: ["minimax", "fal"],
    defaultProvider: "minimax",
    kind: "audio",
    defaultAspectRatio: "1:1",
    description: "High-quality Chinese and English text-to-speech.",
    parameters: [
      {
        id: "voice_id",
        label: "Voice",
        type: "select",
        options: [
          { label: "Female - Warm", value: "female-warm" },
          { label: "Female - Energetic", value: "female-energetic" },
          { label: "Male - Calm", value: "male-calm" },
          { label: "Male - Storyteller", value: "male-storyteller" }
        ],
        defaultValue: "female-warm"
      },
      {
        id: "speed",
        label: "Speed",
        type: "slider",
        min: 0.5,
        max: 2,
        step: 0.1,
        defaultValue: 1,
        description: "Speech speed multiplier"
      },
      {
        id: "pitch",
        label: "Pitch",
        type: "slider",
        min: -12,
        max: 12,
        step: 1,
        defaultValue: 0,
        description: "Voice pitch adjustment (semitones)"
      }
    ],
    defaultParams: {
      voice_id: "female-warm",
      speed: 1,
      pitch: 0
    },
    input: { requiresPrompt: true, inputMode: {} }
  },
  {
    id: "minimax-music-3",
    name: "MiniMax Music 3.0",
    aliases: ["music-3.0", "minimax-music-3.0"],
    provider: "MiniMax",
    availableProviders: ["minimax", "fal", "pika"],
    defaultProvider: "minimax",
    kind: "audio",
    defaultAspectRatio: "1:1",
    description: "Generate complete songs or instrumentals with MiniMax Music 3.0.",
    promptGuidance: "Describe the music in Prompt. Enter lyrics directly in Lyrics, or leave it empty to use automatic lyrics or instrumental mode.",
    parameters: [
      {
        id: "lyrics_optimizer",
        label: "Automatic lyrics",
        type: "boolean",
        defaultValue: false,
        description: "Generate lyrics automatically from the prompt when no lyrics are provided."
      },
      {
        id: "is_instrumental",
        label: "Instrumental",
        type: "boolean",
        defaultValue: false
      },
      {
        id: "sample_rate",
        label: "Sample Rate",
        type: "select",
        options: [16e3, 24e3, 32e3, 44100].map((value) => ({
          label: value === 44100 ? "44.1 kHz" : `${value / 1e3} kHz`,
          value
        })),
        defaultValue: 44100
      },
      {
        id: "bitrate",
        label: "Bitrate",
        type: "select",
        options: [32e3, 64e3, 128e3, 256e3].map((value) => ({
          label: `${value / 1e3} kbps`,
          value
        })),
        defaultValue: 256e3
      },
      {
        id: "format",
        label: "Audio Format",
        type: "select",
        options: [
          { label: "MP3", value: "mp3" },
          { label: "WAV", value: "wav" },
          { label: "PCM", value: "pcm" }
        ],
        defaultValue: "mp3"
      },
      {
        id: "aigc_watermark",
        label: "Audible Watermark",
        type: "boolean",
        defaultValue: false,
        description: "Append the provider AIGC watermark to the end of the generated audio."
      }
    ],
    defaultParams: {
      lyrics_optimizer: false,
      is_instrumental: false,
      sample_rate: 44100,
      bitrate: 256e3,
      format: "mp3",
      aigc_watermark: false
    },
    input: { requiresPrompt: false, inputMode: {}, promptModalities: ["text"] },
    musicInput: {
      lyricsTarget: "modelParam",
      lyricsParam: "lyrics",
      maxLyricsCharacters: 3500,
      maxPromptCharacters: 2e3
    },
    constraints: [
      {
        type: "mutually-exclusive",
        fields: ["modelParams.lyrics_optimizer", "modelParams.is_instrumental"],
        activeValue: true,
        inactiveValue: false,
        message: "Automatic lyrics and Instrumental cannot be enabled together."
      },
      {
        type: "required",
        field: "lyrics",
        when: [
          { field: "modelParams.lyrics_optimizer", equals: false },
          { field: "modelParams.is_instrumental", equals: false }
        ],
        message: "Lyrics are required unless Automatic lyrics or Instrumental is enabled."
      },
      {
        type: "required",
        field: "prompt",
        when: [{ field: "modelParams.is_instrumental", equals: true }],
        message: "Prompt is required for instrumental music."
      },
      {
        type: "max-length",
        field: "prompt",
        max: 2e3,
        message: "Prompt accepts at most 2000 characters."
      },
      {
        type: "max-length",
        field: "lyrics",
        max: 3500,
        message: "Lyrics accept at most 3500 characters."
      }
    ],
    maxRuntimeMs: 10 * 60 * 1e3
  },
  {
    id: "suno-v5.5",
    name: "Suno V5.5",
    provider: "Suno API",
    availableProviders: ["suno"],
    defaultProvider: "suno",
    kind: "audio",
    defaultAspectRatio: "1:1",
    description: "Generate complete songs with Suno V5.5 through SunoAPI.org.",
    promptGuidance: "Describe the musical style in Prompt. Enter lyrics directly in Lyrics; the action label is used as the song title.",
    parameters: [
      {
        id: "instrumental",
        label: "Instrumental",
        type: "boolean",
        defaultValue: false
      },
      {
        id: "style",
        label: "Style",
        type: "text",
        placeholder: "Optional genre, mood, instrumentation, or vocal style",
        defaultValue: ""
      },
      {
        id: "title",
        label: "Title",
        type: "text",
        placeholder: "Optional song title",
        defaultValue: ""
      }
    ],
    defaultParams: {
      instrumental: false,
      style: "",
      title: ""
    },
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
    musicInput: {
      lyricsTarget: "prompt",
      descriptionParam: "style",
      titleParam: "title"
    },
    maxRuntimeMs: 10 * 60 * 1e3
  },
  {
    id: "elevenlabs-tts",
    name: "ElevenLabs TTS",
    provider: "ElevenLabs",
    availableProviders: ["elevenlabs"],
    defaultProvider: "elevenlabs",
    kind: "audio",
    defaultAspectRatio: "1:1",
    description: "Ultra-realistic voice synthesis with emotional range.",
    parameters: [
      {
        id: "voice_id",
        label: "Voice",
        type: "select",
        options: [
          { label: "Rachel - Calm", value: "rachel" },
          { label: "Drew - Professional", value: "drew" },
          { label: "Clyde - Warm", value: "clyde" },
          { label: "Paul - Narrator", value: "paul" }
        ],
        defaultValue: "rachel"
      },
      {
        id: "model_id",
        label: "Model",
        type: "select",
        options: [
          { label: "Eleven v3", value: "eleven_v3" },
          { label: "Multilingual v2", value: "eleven_multilingual_v2" },
          { label: "Flash v2.5", value: "eleven_flash_v2_5" }
        ],
        defaultValue: "eleven_v3"
      },
      {
        id: "stability",
        label: "Stability",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.5,
        description: "Voice consistency (0=variable, 1=stable)"
      },
      {
        id: "similarity_boost",
        label: "Similarity",
        type: "slider",
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.75,
        description: "How closely to match the original voice"
      }
    ],
    defaultParams: {
      voice_id: "rachel",
      model_id: "eleven_v3",
      stability: 0.5,
      similarity_boost: 0.75
    },
    input: { requiresPrompt: true, inputMode: {} }
  },
  // ─── Image: Kling Omni ─────────────────────────────────────
  // Kling's omni image models take a prompt plus up to ten reference images and
  // render at a named resolution tier rather than explicit dimensions.
  {
    id: "kling-image-o1",
    name: "Kling Image O1",
    provider: "Kuaishou",
    availableProviders: ["kling"],
    defaultProvider: "kling",
    kind: "image",
    defaultAspectRatio: "1:1",
    description: "Kling O1 image generation with optional reference images.",
    parameters: [
      aspectRatioParameter({
        ratios: ["21:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16"],
        defaultValue: "auto",
        auto: { label: "Auto" }
      }),
      resolutionParameter({
        tiers: [{ label: "1K", value: "1K" }, { label: "2K", value: "2K" }],
        defaultValue: "1K"
      })
    ],
    defaultParams: { aspect_ratio: "auto", resolution: "1K" },
    input: {
      requiresPrompt: true,
      referenceBinding: { type: "grouped-references" },
      inputMode: { images: { max: 10 } },
      promptModalities: ["text", "image"]
    }
  },
  {
    id: "kling-image-o3",
    name: "Kling Image O3",
    provider: "Kuaishou",
    availableProviders: ["kling"],
    defaultProvider: "kling",
    kind: "image",
    defaultAspectRatio: "1:1",
    description: "Kling O3 omni image generation with optional reference images.",
    parameters: [
      aspectRatioParameter({
        ratios: ["21:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16"],
        defaultValue: "auto",
        auto: { label: "Auto" }
      }),
      resolutionParameter({
        tiers: [{ label: "1K", value: "1K" }, { label: "2K", value: "2K" }],
        defaultValue: "1K"
      })
    ],
    defaultParams: { aspect_ratio: "auto", resolution: "1K" },
    input: {
      requiresPrompt: true,
      referenceBinding: { type: "grouped-references" },
      inputMode: { images: { max: 10 } },
      promptModalities: ["text", "image"]
    }
  },
  // ─── Image: Midjourney ─────────────────────────────────────
  // Midjourney is prompt-driven: aspect ratio and the styling knobs below are
  // expressed as `--ar`, `--stylize`, `--chaos`, and `--weird` flags appended to the
  // prompt, so the Card declares them as parameters and the transport renders the
  // flags. `stylize` spans 0-1000 and `chaos`/`weird` 0-100 in Midjourney's own docs.
  {
    id: "midjourney-7",
    name: "Midjourney 7",
    provider: "Midjourney",
    kind: "image",
    defaultAspectRatio: "1:1",
    description: "Midjourney v7 image generation with optional image prompts.",
    parameters: [
      aspectRatioParameter({
        ratios: ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"],
        defaultValue: "1:1"
      }),
      {
        id: "stylize",
        label: "Stylize",
        type: "number",
        min: 0,
        max: 1e3,
        step: 1,
        defaultValue: 100
      },
      {
        id: "chaos",
        label: "Chaos",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 0
      },
      {
        id: "weird",
        label: "Weird",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 0
      }
    ],
    defaultParams: { aspect_ratio: "1:1", stylize: 100, chaos: 0, weird: 0 },
    input: {
      requiresPrompt: true,
      referenceBinding: { type: "grouped-references" },
      inputMode: { images: { max: 5 } },
      promptModalities: ["text", "image"]
    }
  },
  {
    id: "midjourney-8.1",
    name: "Midjourney 8.1",
    provider: "Midjourney",
    kind: "image",
    defaultAspectRatio: "1:1",
    description: "Midjourney v8.1 image generation with optional image prompts.",
    parameters: [
      aspectRatioParameter({
        ratios: ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"],
        defaultValue: "1:1"
      }),
      {
        id: "stylize",
        label: "Stylize",
        type: "number",
        min: 0,
        max: 1e3,
        step: 1,
        defaultValue: 100
      },
      {
        id: "chaos",
        label: "Chaos",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 0
      },
      {
        id: "weird",
        label: "Weird",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 0
      }
    ],
    defaultParams: { aspect_ratio: "1:1", stylize: 100, chaos: 0, weird: 0 },
    input: {
      requiresPrompt: true,
      referenceBinding: { type: "grouped-references" },
      inputMode: { images: { max: 5 } },
      promptModalities: ["text", "image"]
    }
  },
  {
    id: "midjourney-niji-7",
    name: "Midjourney Niji 7",
    provider: "Midjourney",
    kind: "image",
    defaultAspectRatio: "1:1",
    description: "Midjourney Niji 7, the anime-oriented model, with optional image prompts.",
    parameters: [
      aspectRatioParameter({
        ratios: ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"],
        defaultValue: "1:1"
      }),
      {
        id: "stylize",
        label: "Stylize",
        type: "number",
        min: 0,
        max: 1e3,
        step: 1,
        defaultValue: 100
      },
      {
        id: "chaos",
        label: "Chaos",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 0
      },
      {
        id: "weird",
        label: "Weird",
        type: "number",
        min: 0,
        max: 100,
        step: 1,
        defaultValue: 0
      }
    ],
    defaultParams: { aspect_ratio: "1:1", stylize: 100, chaos: 0, weird: 0 },
    input: {
      requiresPrompt: true,
      referenceBinding: { type: "grouped-references" },
      inputMode: { images: { max: 5 } },
      promptModalities: ["text", "image"]
    }
  },
  // ─── Video: Seedance 2.0 speed tiers ───────────────────────
  // Fast and mini are the same generation contract as Seedance 2.0 at lower cost, so
  // they mirror its parameters and reference limits.
  {
    id: "seedance-2-fast-ref",
    name: "Seedance 2.0 Fast (\u5168\u80FD\u53C2\u8003)",
    provider: "ByteDance",
    availableProviders: ["volcengine"],
    defaultProvider: "volcengine",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Seedance 2.0 Fast all-purpose generation with optional image, video, and audio references.",
    parameters: [
      durationParameter({
        seconds: [4, 6, 8, 10, 15],
        defaultValue: "auto",
        auto: { label: "Auto" }
      }),
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: SEEDANCE_ASPECT_RATIOS.map((r) => ({
          label: r.label,
          value: r.value
        })),
        defaultValue: "auto"
      },
      resolutionParameter({
        tiers: [
          { label: "480p", value: "480p" },
          { label: "720p", value: "720p" }
        ],
        defaultValue: "720p"
      }),
      {
        id: "generate_audio",
        label: "Native audio",
        type: "boolean",
        defaultValue: false
      }
    ],
    defaultParams: {
      duration: "auto",
      aspect_ratio: "auto",
      resolution: "720p",
      generate_audio: false
    },
    input: {
      requiresPrompt: true,
      referenceBinding: POSITIONAL_REFERENCE_BINDING,
      inputMode: {
        images: { max: 9 },
        videos: { max: 3 },
        audios: { max: 3 },
        maxTotalReferences: 12
      },
      promptModalities: ["text", "image", "video", "audio"]
    }
  },
  {
    id: "seedance-2-fast-startend",
    name: "Seedance 2.0 Fast (\u9996\u5C3E\u5E27)",
    provider: "ByteDance",
    availableProviders: ["volcengine"],
    defaultProvider: "volcengine",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Seedance 2.0 Fast animation between a first and an optional last frame.",
    parameters: [
      durationParameter({
        seconds: [4, 6, 8, 10, 15],
        defaultValue: "auto",
        auto: { label: "Auto" }
      }),
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: SEEDANCE_ASPECT_RATIOS.map((r) => ({
          label: r.label,
          value: r.value
        })),
        defaultValue: "auto"
      },
      resolutionParameter({
        tiers: [
          { label: "480p", value: "480p" },
          { label: "720p", value: "720p" }
        ],
        defaultValue: "720p"
      }),
      {
        id: "generate_audio",
        label: "Native audio",
        type: "boolean",
        defaultValue: false
      }
    ],
    defaultParams: {
      duration: "auto",
      aspect_ratio: "auto",
      resolution: "720p",
      generate_audio: false
    },
    input: { requiresPrompt: true, inputMode: { startEnd: {} } }
  },
  {
    id: "seedance-2-mini-ref",
    name: "Seedance 2.0 Mini (\u5168\u80FD\u53C2\u8003)",
    provider: "ByteDance",
    availableProviders: ["volcengine"],
    defaultProvider: "volcengine",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Seedance 2.0 Mini all-purpose generation with optional image, video, and audio references.",
    parameters: [
      durationParameter({
        seconds: [4, 6, 8, 10, 15],
        defaultValue: "auto",
        auto: { label: "Auto" }
      }),
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: SEEDANCE_ASPECT_RATIOS.map((r) => ({
          label: r.label,
          value: r.value
        })),
        defaultValue: "auto"
      },
      resolutionParameter({
        tiers: [
          { label: "480p", value: "480p" },
          { label: "720p", value: "720p" }
        ],
        defaultValue: "720p"
      }),
      {
        id: "generate_audio",
        label: "Native audio",
        type: "boolean",
        defaultValue: false
      }
    ],
    defaultParams: {
      duration: "auto",
      aspect_ratio: "auto",
      resolution: "720p",
      generate_audio: false
    },
    input: {
      requiresPrompt: true,
      referenceBinding: POSITIONAL_REFERENCE_BINDING,
      inputMode: {
        images: { max: 9 },
        videos: { max: 3 },
        audios: { max: 3 },
        maxTotalReferences: 12
      },
      promptModalities: ["text", "image", "video", "audio"]
    }
  },
  {
    id: "seedance-2-mini-startend",
    name: "Seedance 2.0 Mini (\u9996\u5C3E\u5E27)",
    provider: "ByteDance",
    availableProviders: ["volcengine"],
    defaultProvider: "volcengine",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Seedance 2.0 Mini animation between a first and an optional last frame.",
    parameters: [
      durationParameter({
        seconds: [4, 6, 8, 10, 15],
        defaultValue: "auto",
        auto: { label: "Auto" }
      }),
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: SEEDANCE_ASPECT_RATIOS.map((r) => ({
          label: r.label,
          value: r.value
        })),
        defaultValue: "auto"
      },
      resolutionParameter({
        tiers: [
          { label: "480p", value: "480p" },
          { label: "720p", value: "720p" }
        ],
        defaultValue: "720p"
      }),
      {
        id: "generate_audio",
        label: "Native audio",
        type: "boolean",
        defaultValue: false
      }
    ],
    defaultParams: {
      duration: "auto",
      aspect_ratio: "auto",
      resolution: "720p",
      generate_audio: false
    },
    input: { requiresPrompt: true, inputMode: { startEnd: {} } }
  },
  // ─── Video: Kling Omni ─────────────────────────────────────
  // Kling's omni video models accept image and video references, render in a `std` or
  // `pro` mode, and can stitch several shots from one prompt.
  {
    id: "kling-video-o1",
    name: "Kling Video O1",
    provider: "Kuaishou",
    availableProviders: ["kling"],
    defaultProvider: "kling",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Kling O1 video generation with optional image and video references.",
    parameters: [
      durationParameter({ seconds: [5, 10], defaultValue: 5 }),
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: KLING_ASPECT_RATIOS.map((r) => ({ label: r.label, value: r.value })),
        defaultValue: "16:9"
      },
      {
        id: "mode",
        label: "Mode",
        type: "select",
        options: [{ label: "Standard", value: "std" }, { label: "Pro", value: "pro" }],
        defaultValue: "pro"
      },
      { id: "multi_shot", label: "Multi-shot", type: "boolean", defaultValue: false }
    ],
    defaultParams: { duration: 5, aspect_ratio: "16:9", mode: "pro", multi_shot: false },
    input: {
      requiresPrompt: true,
      referenceBinding: { type: "grouped-references" },
      inputMode: { images: { max: 4 }, videos: { max: 1 } },
      promptModalities: ["text", "image", "video"]
    }
  },
  {
    id: "kling-video-o3",
    name: "Kling Video O3",
    provider: "Kuaishou",
    availableProviders: ["kling"],
    defaultProvider: "kling",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Kling O3 omni video generation with optional image and video references and native audio.",
    parameters: [
      durationParameter({ seconds: [5, 10], defaultValue: 5 }),
      {
        id: "aspect_ratio",
        label: "Aspect Ratio",
        type: "select",
        options: KLING_ASPECT_RATIOS.map((r) => ({ label: r.label, value: r.value })),
        defaultValue: "16:9"
      },
      {
        id: "mode",
        label: "Mode",
        type: "select",
        options: [{ label: "Standard", value: "std" }, { label: "Pro", value: "pro" }],
        defaultValue: "pro"
      },
      { id: "generate_audio", label: "Native audio", type: "boolean", defaultValue: false },
      { id: "multi_shot", label: "Multi-shot", type: "boolean", defaultValue: false }
    ],
    defaultParams: { duration: 5, aspect_ratio: "16:9", mode: "pro", generate_audio: false, multi_shot: false },
    input: {
      requiresPrompt: true,
      referenceBinding: { type: "grouped-references" },
      inputMode: { images: { max: 4 }, videos: { max: 1 } },
      promptModalities: ["text", "image", "video"]
    }
  },
  // ─── Video: driven performance ─────────────────────────────
  // These take a subject and a driver rather than a prompt alone: Avatar animates one
  // portrait from a speech clip, and the motion-control models transfer the motion of
  // a source video onto a still.
  {
    id: "kling-avatar",
    name: "Kling Avatar",
    provider: "Kuaishou",
    availableProviders: ["kling"],
    defaultProvider: "kling",
    kind: "video",
    defaultAspectRatio: "9:16",
    description: "Animate one portrait image so it speaks a supplied audio clip.",
    parameters: [
      {
        id: "mode",
        label: "Mode",
        type: "select",
        options: [{ label: "Standard", value: "std" }, { label: "Pro", value: "pro" }],
        defaultValue: "std"
      }
    ],
    defaultParams: { mode: "std" },
    input: {
      requiresPrompt: false,
      referenceBinding: { type: "grouped-references" },
      inputMode: { images: { max: 1 }, audios: { max: 1 } },
      promptModalities: ["text", "image", "audio"]
    }
  },
  {
    id: "kling-motion-control",
    name: "Kling Motion Control",
    provider: "Kuaishou",
    availableProviders: ["kling"],
    defaultProvider: "kling",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Transfer the motion of a source video onto a still character image.",
    parameters: [
      {
        id: "mode",
        label: "Mode",
        type: "select",
        options: [{ label: "Standard", value: "std" }, { label: "Pro", value: "pro" }],
        defaultValue: "std"
      },
      {
        id: "keep_original_sound",
        label: "Keep original sound",
        type: "select",
        options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
        defaultValue: "yes"
      },
      {
        id: "character_orientation",
        label: "Character orientation",
        type: "select",
        options: [
          { label: "Follow video", value: "video" },
          { label: "Follow image", value: "image" }
        ],
        defaultValue: "video"
      }
    ],
    defaultParams: { mode: "std", keep_original_sound: "yes", character_orientation: "video" },
    input: {
      requiresPrompt: false,
      referenceBinding: { type: "grouped-references" },
      inputMode: { images: { max: 1 }, videos: { max: 1 } },
      promptModalities: ["text", "image", "video"]
    }
  },
  {
    id: "jimeng-motion-control-2",
    name: "Jimeng Motion Control 2.0",
    provider: "ByteDance",
    kind: "video",
    defaultAspectRatio: "16:9",
    description: "Transfer the motion of a source video onto a still image with Jimeng 2.0.",
    parameters: [],
    defaultParams: {},
    input: {
      requiresPrompt: false,
      referenceBinding: { type: "grouped-references" },
      inputMode: { images: { max: 1 }, videos: { max: 1 } },
      promptModalities: ["text", "image", "video"]
    }
  },
  // ─── Audio: Seed Audio ─────────────────────────────────────
  // Seed Audio accepts pure text, one image, or up to three audio references. Image and
  // audio references are mutually exclusive; the executable Provider enforces that rule.
  {
    id: "seed-audio-1",
    name: "Seed Audio 1.0",
    provider: "ByteDance",
    availableProviders: ["volcengine-speech"],
    defaultProvider: "volcengine-speech",
    kind: "audio",
    defaultAspectRatio: "1:1",
    description: "Generate expressive speech, sound effects, and complete audio scenes from text and optional references.",
    promptGuidance: "Refer to audio inputs as @\u97F3\u98911, @\u97F3\u98912, and @\u97F3\u98913. A Voice ID counts as an audio reference. A request may use audio references or one image, but not both.",
    parameters: [
      {
        id: "voice_id",
        label: "Voice ID",
        type: "text",
        defaultValue: "",
        description: "Optional Doubao TTS or voice-clone speaker ID."
      },
      { id: "speed", label: "Speed", type: "slider", min: 0.5, max: 2, step: 0.05, defaultValue: 1 },
      { id: "volume", label: "Volume", type: "slider", min: 0.5, max: 2, step: 0.05, defaultValue: 1 },
      { id: "pitch", label: "Pitch", type: "slider", min: -12, max: 12, step: 1, defaultValue: 0 },
      {
        id: "sample_rate",
        label: "Sample Rate",
        type: "select",
        options: [8e3, 16e3, 24e3, 32e3, 44100, 48e3].map((value) => ({
          label: value === 44100 ? "44.1 kHz" : `${value / 1e3} kHz`,
          value
        }))
      },
      {
        id: "format",
        label: "Audio Format",
        type: "select",
        options: [
          { label: "WAV", value: "wav" },
          { label: "MP3", value: "mp3" },
          { label: "PCM", value: "pcm" },
          { label: "Ogg Opus", value: "ogg_opus" }
        ],
        defaultValue: "wav"
      }
    ],
    defaultParams: { voice_id: "", speed: 1, volume: 1, pitch: 0, format: "wav" },
    input: {
      requiresPrompt: true,
      referenceBinding: {
        type: "positional-tokens",
        modalityScopedIndexes: true,
        tokens: { audio: "@\u97F3\u9891{n}" }
      },
      inputMode: {
        audios: { max: 3, constraints: SEED_AUDIO_AUDIO_CONSTRAINTS },
        images: { max: 1, constraints: SEED_AUDIO_IMAGE_CONSTRAINTS },
        maxTotalReferences: 3
      },
      promptModalities: ["text", "audio", "image"]
    },
    constraints: [
      {
        type: "max-length",
        field: "prompt",
        max: 3e3,
        message: "Seed Audio prompts support at most 3000 characters."
      }
    ]
  },
  // ─── Audio: music ──────────────────────────────────────────
  // Music generation is length-driven rather than duration-per-shot: the request names
  // how long the finished track should be.
  {
    id: "elevenlabs-music-v2",
    name: "ElevenLabs Music v2",
    provider: "ElevenLabs",
    availableProviders: ["elevenlabs"],
    defaultProvider: "elevenlabs",
    kind: "audio",
    defaultAspectRatio: "1:1",
    description: "Generate a music track from a text description, optionally instrumental.",
    parameters: [
      durationParameter({ seconds: [30, 60, 90, 120, 180, 240, 300], defaultValue: 60 }),
      { id: "is_instrumental", label: "Instrumental only", type: "boolean", defaultValue: false }
    ],
    defaultParams: { duration: 60, is_instrumental: false },
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] }
  },
  {
    id: "music-cover",
    name: "Music Cover",
    provider: "MiniMax",
    availableProviders: ["minimax"],
    defaultProvider: "minimax",
    kind: "audio",
    defaultAspectRatio: "1:1",
    description: "Re-perform a supplied track, optionally with new lyrics.",
    parameters: [
      { id: "lyrics", label: "Lyrics", type: "text", defaultValue: "" }
    ],
    defaultParams: { lyrics: "" },
    input: {
      requiresPrompt: true,
      referenceBinding: { type: "grouped-references" },
      inputMode: { audios: { max: 1 } },
      promptModalities: ["text", "audio"]
    }
  }
];
var SEEDANCE_2_FAL_PARAMETER_OVERRIDES = [
  {
    id: "duration",
    label: "Duration",
    type: "select",
    required: false,
    options: [
      { label: "Auto", value: "auto" },
      ...Array.from({ length: 12 }, (_, index) => ({ label: `${index + 4}s`, value: index + 4 }))
    ],
    defaultValue: "auto"
  }
];
var MINIMAX_H3_FAL_PARAMETER_OVERRIDES = [{
  id: "duration",
  label: "Duration",
  type: "select",
  required: false,
  options: Array.from({ length: 11 }, (_, index) => ({
    label: `${index + 5}s`,
    value: index + 5
  })),
  defaultValue: 5
}];
var MINIMAX_H3_FAL_OMNI_PARAMETER_OVERRIDES = [
  ...MINIMAX_H3_FAL_PARAMETER_OVERRIDES,
  {
    id: "aspect_ratio",
    label: "Aspect Ratio",
    type: "select",
    required: false,
    description: "Auto is supported when at least one image, video, or audio reference is attached.",
    options: [
      { label: "Auto (with reference)", value: "adaptive" },
      ...["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].map((value) => ({ label: value, value }))
    ],
    defaultValue: "16:9"
  }
];
var SEEDANCE_2_VOLCENGINE_PARAMETER_OVERRIDES = [
  {
    id: "duration",
    label: "Duration",
    type: "select",
    required: false,
    options: [
      { label: "Auto", value: "auto" },
      ...Array.from({ length: 12 }, (_, index) => ({
        label: `${index + 4}s`,
        value: index + 4
      }))
    ],
    defaultValue: "auto"
  },
  {
    id: "resolution",
    label: "Resolution",
    type: "select",
    required: false,
    options: ["480p", "720p", "1080p", "4k"].map((value) => ({
      label: value,
      value
    })),
    defaultValue: "720p"
  }
];
var SEEDANCE_VOLCENGINE_ASPECT_RATIO_PARAMETER = {
  id: "aspect_ratio",
  label: "Aspect Ratio",
  type: "select",
  required: false,
  options: [
    ...["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].map((value) => ({
      label: value,
      value
    })),
    { label: "Auto", value: "auto" }
  ],
  defaultValue: "auto"
};
var SEEDANCE_2_5_VOLCENGINE_COMMON_PARAMETER_OVERRIDES = [
  {
    id: "duration",
    label: "Duration",
    type: "select",
    required: false,
    options: [
      { label: "Auto", value: "auto" },
      ...Array.from({ length: 27 }, (_, index) => ({
        label: `${index + 4}s`,
        value: index + 4
      }))
    ],
    defaultValue: "auto"
  },
  {
    id: "resolution",
    label: "Resolution",
    type: "select",
    required: false,
    options: ["480p", "720p"].map((value) => ({ label: value, value })),
    defaultValue: "720p"
  }
];
var MODEL_PROVIDER_IMPLEMENTATION_ROWS = [
  ["sensevoice-small-asr", "local", "local", "local-asr", "iic/SenseVoiceSmall", 1],
  ["whisper-large-v3-turbo-asr", "local", "local", "local-asr", "mlx-community/whisper-large-v3-turbo", 1],
  ["whisper-small-asr", "local", "local", "local-asr", "mlx-community/whisper-small-mlx", 1],
  ["parakeet-tdt-0.6b-v3-asr", "local", "local", "local-asr", "mlx-community/parakeet-tdt-0.6b-v3", 1],
  ["vibevoice-asr", "local", "local", "local-asr", "mlx-community/VibeVoice-ASR-4bit", 1],
  ["kokoro-82m-tts", "local", "local", "local-tts", "mlx-community/Kokoro-82M-4bit", 1],
  ["piper-huayan-tts", "local", "local", "local-tts", "zh_CN-huayan-medium", 1],
  ["piper-lessac-tts", "local", "local", "local-tts", "en_US-lessac-medium", 1],
  ["flux-schnell", "fal", "fal", "fal", "fal-ai/flux/schnell", 20, { credentials: ["apiKey"] }],
  ["flux-dev", "fal", "fal", "fal", "fal-ai/flux/dev", 20, { credentials: ["apiKey"] }],
  ["gpt-image-2", "fal", "fal", "fal", "openai/gpt-image-2", 20, { credentials: ["apiKey"] }],
  ["nano-banana-2", "fal", "fal", "fal", "fal-ai/nano-banana-2", 20, { credentials: ["apiKey"] }],
  ["seedream-4.5", "fal", "fal", "fal", "fal-ai/bytedance/seedream/v4.5/text-to-image", 20, { credentials: ["apiKey"] }],
  ["recraft-v4", "fal", "fal", "fal", "fal-ai/recraft/v4/pro/text-to-image", 20, { credentials: ["apiKey"] }],
  ["flux-2-pro", "fal", "fal", "fal", "fal-ai/flux-2-pro", 20, { credentials: ["apiKey"] }],
  ["sora-2", "fal", "fal", "fal", "fal-ai/sora-2/text-to-video", 20, { credentials: ["apiKey"] }],
  ["kling-3", "fal", "fal", "fal", "fal-ai/kling-video/v3/pro/image-to-video", 20, { credentials: ["apiKey"] }],
  ["flux-3-video", "fal", "fal", "fal", "blackforestlabs/flux-3/text-to-video", 20, { credentials: ["apiKey"] }],
  ["flux-3-video-keyframes", "fal", "fal", "fal", "blackforestlabs/flux-3/keyframes-to-video", 20, { credentials: ["apiKey"] }],
  ["flux-3-video-continue", "fal", "fal", "fal", "blackforestlabs/flux-3/extend-video", 20, { credentials: ["apiKey"] }],
  [
    "seedance-2-startend",
    "fal",
    "fal",
    "fal",
    "bytedance/seedance-2.0/image-to-video",
    20,
    {
      credentials: ["apiKey"],
      parameterOverrides: SEEDANCE_2_FAL_PARAMETER_OVERRIDES,
      defaultParamOverrides: { duration: "auto" }
    }
  ],
  [
    "seedance-2-ref",
    "fal",
    "fal",
    "fal",
    "bytedance/seedance-2.0/reference-to-video",
    20,
    {
      credentials: ["apiKey"],
      parameterOverrides: SEEDANCE_2_FAL_PARAMETER_OVERRIDES,
      defaultParamOverrides: { duration: "auto" },
      excludedParameterIds: ["edit_mode"],
      referenceBinding: {
        type: "positional-tokens",
        modalityScopedIndexes: true,
        tokens: { image: "@Image{n}", video: "@Video{n}", audio: "@Audio{n}" }
      }
    }
  ],
  ["minimax-tts", "fal", "fal", "fal", "fal-ai/minimax/speech-02-hd", 20, { credentials: ["apiKey"] }],
  ["pika-2.5", "pika", "pika", "pika", "pika/pika-2.5/image-to-video", 18, { credentials: ["apiKey"] }],
  ["nano-banana-2", "pika", "pika", "pika", "google/gemini-3.1-flash-image/text-to-image", 18, { credentials: ["apiKey"] }],
  ["gpt-image-2", "pika", "pika", "pika", "openai/gpt-image-2/text-to-image", 18, { credentials: ["apiKey"] }],
  ["seedance-2-startend", "pika", "pika", "pika", "bytedance/seedance-2.0/image-to-video", 18, {
    credentials: ["apiKey"],
    excludedParameterIds: ["seed"]
  }],
  ["seedance-2-ref", "pika", "pika", "pika", "bytedance/seedance-2.0/reference-to-video", 18, {
    credentials: ["apiKey"],
    excludedParameterIds: ["seed", "edit_mode"],
    referenceBinding: {
      type: "positional-tokens",
      modalityScopedIndexes: true,
      tokens: { image: "@Image{n}", video: "@Video{n}", audio: "@Audio{n}" }
    }
  }],
  ["minimax-h3", "pika", "pika", "pika", "minimax/h3/reference-to-video", 18, {
    credentials: ["apiKey"],
    referenceBinding: {
      type: "positional-tokens",
      modalityScopedIndexes: true,
      tokens: { image: "@Image{n}", video: "@Video{n}", audio: "@Audio{n}" }
    }
  }],
  ["minimax-h3-startend", "pika", "pika", "pika", "minimax/h3/image-to-video", 18, { credentials: ["apiKey"] }],
  ["minimax-music-3", "pika", "pika", "pika", "minimax/minimax-music-3.0/text-to-audio", 18, {
    credentials: ["apiKey"],
    excludedParameterIds: ["aigc_watermark"]
  }],
  ["gpt-5.6-sol", "pika", "pika", "pika-chat", "openai/gpt-5.6-sol", 18, { credentials: ["apiKey"] }],
  ["claude-sonnet-5", "pika", "pika", "pika-chat", "anthropic/claude-sonnet-5", 18, { credentials: ["apiKey"] }],
  ["gemini-3.6-flash", "pika", "pika", "pika-chat", "google/gemini-3.6-flash", 18, { credentials: ["apiKey"] }],
  ["deepseek-v4-pro", "pika", "pika", "pika-chat", "deepseek/deepseek-v4-pro", 18, { credentials: ["apiKey"] }],
  ["kimi-k3", "pika", "pika", "pika-chat", "moonshotai/kimi-k3", 18, { credentials: ["apiKey"] }],
  ["glm-5.2", "pika", "pika", "pika-chat", "z-ai/glm-5.2", 18, { credentials: ["apiKey"] }],
  ["seedream-5-pro", "pika", "pika", "pika", "bytedance/seedream-5.0-pro/text-to-image", 18, { credentials: ["apiKey"] }],
  ["grok-imagine-quality", "pika", "pika", "pika", "x-ai/grok-imagine-image-quality/text-to-image", 18, { credentials: ["apiKey"] }],
  ["grok-imagine-video-1.5", "pika", "pika", "pika", "x-ai/grok-imagine-video-1.5/image-to-video", 18, { credentials: ["apiKey"] }],
  ["flux-3-video", "pika", "pika", "pika", "black-forest-labs/flux-3-video/text-to-video", 18, { credentials: ["apiKey"] }],
  ["kling-3", "pika", "pika", "pika", "kling/kling-3.0/text-to-video", 18, { credentials: ["apiKey"] }],
  ["recraft-v4", "pika", "pika", "pika", "recraft/recraft-4.1/text-to-image", 22, { credentials: ["apiKey"] }],
  ["lyria-3-pro", "pika", "pika", "pika", "google/lyria-3-pro/text-to-audio", 18, { credentials: ["apiKey"] }],
  ["minimax-speech-2.8-hd", "pika", "pika", "pika", "minimax/minimax-speech-2.8-hd/text-to-speech", 18, { credentials: ["apiKey"] }],
  ["nano-banana-2", "replicate", "replicate", "replicate", "google/nano-banana-2", 25, { credentials: ["apiKey"] }],
  ["gpt-image-2", "replicate", "replicate", "replicate", "openai/gpt-image-2", 25, { credentials: ["apiKey"] }],
  ["flux-schnell", "replicate", "replicate", "replicate", "black-forest-labs/flux-schnell", 25, { credentials: ["apiKey"] }],
  ["seedance-2-startend", "replicate", "replicate", "replicate", "bytedance/seedance-2.0", 25, {
    credentials: ["apiKey"],
    excludedParameterIds: ["seed"]
  }],
  ["seedance-2-ref", "replicate", "replicate", "replicate", "bytedance/seedance-2.0", 25, {
    credentials: ["apiKey"],
    excludedParameterIds: ["seed", "edit_mode"],
    referenceBinding: {
      type: "positional-tokens",
      modalityScopedIndexes: true,
      tokens: { image: "[Image{n}]", video: "[Video{n}]", audio: "[Audio{n}]" }
    }
  }],
  // `anyOf`, because Google accepts either credential and an account holds one or the other. A plain
  // `credentials` list means all of them, and duplicating the route per credential makes one model
  // match two conformance targets -- the ambiguity check is right to refuse that.
  //
  // The eleven `google-agent-platform` routes this replaces expressed the same thing by inventing a
  // second upstream, and carried no executor: a request that matched one found nothing to run, our
  // own gate demanded a service account, found none, and hilo-hub answered instead. The asset looked
  // exactly like a successful Google generation.
  [
    "nano-banana-2",
    "official",
    "google-ai-studio",
    "google-ai-studio",
    "gemini-3.1-flash-image",
    12,
    {
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
      region: "global",
      credentialRequirements: { anyOf: [["apiKey"], ["serviceAccountKey"]] }
    }
  ],
  ["flux-3-video", "official", "bfl", "bfl", "flux-3-video", 10, { region: "global", credentials: ["apiKey"] }],
  ["flux-3-video-keyframes", "official", "bfl", "bfl", "flux-3-video", 10, { region: "global", credentials: ["apiKey"] }],
  ["flux-3-video-continue", "official", "bfl", "bfl", "flux-3-video", 10, { region: "global", credentials: ["apiKey"] }],
  [
    "nano-banana-pro",
    "official",
    "google-ai-studio",
    "google-ai-studio",
    "gemini-3-pro-image",
    12,
    {
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
      region: "global",
      credentialRequirements: { anyOf: [["apiKey"], ["serviceAccountKey"]] }
    }
  ],
  [
    "gemini-3.1-flash-tts",
    "official",
    "google-ai-studio",
    "google-ai-studio",
    "gemini-3.1-flash-tts-preview",
    10,
    {
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
      region: "global",
      credentialRequirements: { anyOf: [["apiKey"], ["serviceAccountKey"]] }
    }
  ],
  [
    "gemini-2.5-pro-tts",
    "official",
    "google-ai-studio",
    "google-ai-studio",
    "gemini-2.5-pro-tts",
    10,
    {
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
      region: "global",
      credentialRequirements: { anyOf: [["apiKey"], ["serviceAccountKey"]] }
    }
  ],
  [
    "nano-banana-2-lite",
    "official",
    "google-ai-studio",
    "google-ai-studio",
    "gemini-3.1-flash-lite-image",
    10,
    {
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
      region: "global",
      credentialRequirements: { anyOf: [["apiKey"], ["serviceAccountKey"]] }
    }
  ],
  [
    "veo-3.1",
    "official",
    "google-ai-studio",
    "google-ai-studio",
    "veo-3.1-generate-001",
    10,
    {
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
      region: "global",
      credentialRequirements: { anyOf: [["apiKey"], ["serviceAccountKey"]] }
    }
  ],
  [
    "veo-3.1-startend",
    "official",
    "google-ai-studio",
    "google-ai-studio",
    "veo-3.1-generate-001",
    10,
    {
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
      region: "global",
      credentialRequirements: { anyOf: [["apiKey"], ["serviceAccountKey"]] }
    }
  ],
  [
    "veo-3.1-fast",
    "official",
    "google-ai-studio",
    "google-ai-studio",
    "veo-3.1-fast-generate-001",
    10,
    {
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
      region: "global",
      credentialRequirements: { anyOf: [["apiKey"], ["serviceAccountKey"]] }
    }
  ],
  [
    "veo-3.1-fast-startend",
    "official",
    "google-ai-studio",
    "google-ai-studio",
    "veo-3.1-fast-generate-001",
    10,
    {
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
      region: "global",
      credentialRequirements: { anyOf: [["apiKey"], ["serviceAccountKey"]] }
    }
  ],
  // Two surfaces serve this model and they take different credentials, both measured:
  //   aiplatform  /v1beta1/projects/{p}/locations/global/interactions -> 401, wants a Bearer token
  //   generativelanguage /v1beta/interactions                         -> 403, routed, wants the
  //                                                                      project's Gemini API on
  // A service account is the unattended way to hold a token; the Developer API takes a key directly.
  // generateContent refuses the model on either host: 400 "only supported in the Interactions API".
  [
    "gemini-omni-flash",
    "official",
    "google-ai-studio",
    "google-ai-studio-interactions",
    "gemini-omni-flash-preview",
    10,
    {
      region: "global",
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
      credentialRequirements: {
        anyOf: [["serviceAccountKey"], ["apiKey"], ["baseUrl"]],
        exclusive: true
      }
    }
  ],
  [
    "gemini-3.5-flash",
    "official",
    "google-ai-studio",
    "google-ai-studio",
    "gemini-3.5-flash",
    10,
    {
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
      region: "global",
      credentialRequirements: { anyOf: [["apiKey"], ["serviceAccountKey"]] }
    }
  ],
  [
    "gemini-3.1-pro",
    "official",
    "google-ai-studio",
    "google-ai-studio",
    "gemini-3.1-pro-preview",
    10,
    {
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
      region: "global",
      credentialRequirements: { anyOf: [["apiKey"], ["serviceAccountKey"]] }
    }
  ],
  [
    "gemini-3-flash",
    "official",
    "google-ai-studio",
    "google-ai-studio",
    "gemini-3-flash-preview",
    10,
    {
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
      region: "global",
      credentialRequirements: { anyOf: [["apiKey"], ["serviceAccountKey"]] }
    }
  ],
  // The eleven `google-agent-platform` routes that followed are gone. Google is one Provider:
  // the same key, the same SDK, and a surface the account picks with its `service` field. They
  // also carried no executor binding, so the split was not merely redundant -- a request that
  // matched one found no executor, our own gate demanded a service account, and hilo-hub answered
  // instead. The asset looked exactly like a successful Google generation.
  [
    "gemini-3.1-flash-lite",
    "official",
    "google-ai-studio",
    "google-ai-studio",
    "gemini-3.1-flash-lite",
    10,
    {
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
      region: "global",
      credentialRequirements: { anyOf: [["apiKey"], ["serviceAccountKey"]] }
    }
  ],
  ["gpt-image-2", "official", "openai", "openai-images", "gpt-image-2", 10, { region: "global", credentials: ["apiKey"] }],
  ["gpt-5.4", "official", "openai", "openai-compatible", "gpt-5.4", 10, { region: "global", credentials: ["apiKey"] }],
  ["openai-compatible-text", "official", "openai", "openai-compatible", "gpt-5.4", 15, { region: "global", credentials: ["apiKey"] }],
  ["claude-sonnet-4", "official", "anthropic", "anthropic-compatible", "claude-sonnet-4-20250514", 10, { region: "global", credentials: ["apiKey"] }],
  ["anthropic-compatible-text", "official", "anthropic", "anthropic-compatible", "claude-sonnet-4-20250514", 15, { region: "global", credentials: ["apiKey"] }],
  ["kling-3", "kling", "kling", "kling", "kling-v3", 8, { credentials: ["accessKey", "secretKey"] }],
  [
    "seed-audio-1",
    "volcengine-speech",
    "volcengine-speech",
    "volcengine-speech",
    "seed-audio-1.0",
    9,
    {
      credentials: ["apiKey"],
      executorPluginId: "clash.volcengine",
      executorExportId: "volcengine-speech-execute"
    }
  ],
  [
    "seedance-2-startend",
    "volcengine",
    "volcengine",
    "modelark",
    "doubao-seedance-2-0-260128",
    9,
    {
      credentials: ["apiKey"],
      executorPluginId: "clash.volcengine",
      executorExportId: "volcengine-execute",
      parameterOverrides: SEEDANCE_2_VOLCENGINE_PARAMETER_OVERRIDES,
      defaultParamOverrides: { duration: "auto", resolution: "720p" },
      excludedParameterIds: ["seed"]
    }
  ],
  [
    "seedance-2-ref",
    "volcengine",
    "volcengine",
    "modelark",
    "doubao-seedance-2-0-260128",
    9,
    {
      credentials: ["apiKey"],
      executorPluginId: "clash.volcengine",
      executorExportId: "volcengine-execute",
      parameterOverrides: [...SEEDANCE_2_VOLCENGINE_PARAMETER_OVERRIDES, SEEDANCE_VOLCENGINE_ASPECT_RATIO_PARAMETER],
      defaultParamOverrides: {
        duration: "auto",
        aspect_ratio: "auto",
        resolution: "720p"
      },
      excludedParameterIds: ["seed"],
      referenceBinding: {
        type: "positional-tokens",
        modalityScopedIndexes: true,
        tokens: { image: "@\u56FE\u50CF{n}", video: "@\u89C6\u9891{n}", audio: "@\u97F3\u9891{n}" }
      }
    }
  ],
  [
    "seedance-2-extend",
    "volcengine",
    "volcengine",
    "modelark",
    "doubao-seedance-2-0-260128",
    9,
    {
      credentials: ["apiKey"],
      executorPluginId: "clash.volcengine",
      executorExportId: "volcengine-execute",
      referenceBinding: {
        type: "positional-tokens",
        modalityScopedIndexes: true,
        tokens: { image: "@\u56FE\u50CF{n}", video: "@\u89C6\u9891{n}", audio: "@\u97F3\u9891{n}" }
      }
    }
  ],
  [
    "seedance-2.5-ref",
    "volcengine",
    "volcengine",
    "modelark",
    "doubao-seedance-2-5-260628",
    9,
    {
      credentials: ["apiKey"],
      executorPluginId: "clash.volcengine",
      executorExportId: "volcengine-execute",
      parameterOverrides: [...SEEDANCE_2_5_VOLCENGINE_COMMON_PARAMETER_OVERRIDES, SEEDANCE_VOLCENGINE_ASPECT_RATIO_PARAMETER],
      defaultParamOverrides: {
        duration: "auto",
        aspect_ratio: "auto",
        resolution: "720p"
      },
      referenceBinding: {
        type: "positional-tokens",
        modalityScopedIndexes: true,
        tokens: { image: "@\u56FE\u50CF{n}", video: "@\u89C6\u9891{n}", audio: "@\u97F3\u9891{n}" }
      }
    }
  ],
  [
    "seedance-2.5-startend",
    "volcengine",
    "volcengine",
    "modelark",
    "doubao-seedance-2-5-260628",
    9,
    {
      credentials: ["apiKey"],
      executorPluginId: "clash.volcengine",
      executorExportId: "volcengine-execute",
      parameterOverrides: SEEDANCE_2_5_VOLCENGINE_COMMON_PARAMETER_OVERRIDES,
      defaultParamOverrides: {
        duration: "auto",
        resolution: "720p"
      }
    }
  ],
  [
    "seedance-2.5-extend",
    "volcengine",
    "volcengine",
    "modelark",
    "doubao-seedance-2-5-260628",
    9,
    {
      credentials: ["apiKey"],
      executorPluginId: "clash.volcengine",
      executorExportId: "volcengine-execute",
      referenceBinding: {
        type: "positional-tokens",
        modalityScopedIndexes: true,
        tokens: { image: "@\u56FE\u50CF{n}", video: "@\u89C6\u9891{n}", audio: "@\u97F3\u9891{n}" }
      }
    }
  ],
  [
    "minimax-m3",
    "minimax",
    "minimax",
    "minimax",
    "MiniMax-M3",
    8,
    {
      credentials: ["apiKey"],
      executorPluginId: "clash.minimax",
      executorExportId: "minimax-execute"
    }
  ],
  [
    "minimax-tts",
    "minimax",
    "minimax",
    "minimax",
    "speech-02-hd",
    8,
    {
      credentials: ["apiKey"],
      executorPluginId: "clash.minimax",
      executorExportId: "minimax-execute"
    }
  ],
  [
    "minimax-music-3",
    "minimax",
    "minimax",
    "minimax",
    "music-3.0",
    8,
    {
      credentials: ["apiKey"],
      executorPluginId: "clash.minimax",
      executorExportId: "minimax-execute"
    }
  ],
  [
    "minimax-h3",
    "minimax",
    "minimax",
    "minimax",
    "MiniMax-H3",
    8,
    {
      credentials: ["apiKey"],
      executorPluginId: "clash.minimax",
      executorExportId: "minimax-execute"
    }
  ],
  [
    "minimax-h3-startend",
    "minimax",
    "minimax",
    "minimax",
    "MiniMax-H3",
    8,
    {
      credentials: ["apiKey"],
      executorPluginId: "clash.minimax",
      executorExportId: "minimax-execute"
    }
  ],
  [
    "minimax-music-3",
    "fal",
    "fal",
    "fal",
    "fal-ai/minimax-music/v3",
    9,
    {
      credentials: ["apiKey"],
      excludedParameterIds: ["aigc_watermark"]
    }
  ],
  [
    "minimax-h3",
    "fal",
    "fal",
    "fal",
    "minimax/h3/reference-to-video",
    9,
    {
      credentials: ["apiKey"],
      referenceBinding: {
        type: "positional-tokens",
        modalityScopedIndexes: true,
        tokens: { image: "Image {n}", video: "Video {n}", audio: "Audio {n}" }
      },
      parameterOverrides: MINIMAX_H3_FAL_OMNI_PARAMETER_OVERRIDES,
      defaultParamOverrides: { duration: 5, aspect_ratio: "16:9" }
    }
  ],
  [
    "minimax-h3-startend",
    "fal",
    "fal",
    "fal",
    "minimax/h3/image-to-video",
    9,
    {
      credentials: ["apiKey"],
      parameterOverrides: MINIMAX_H3_FAL_PARAMETER_OVERRIDES,
      defaultParamOverrides: { duration: 5 }
    }
  ],
  ["suno-v5.5", "suno", "suno", "suno", "V5_5", 8, { credentials: ["apiKey", "callbackUrl"] }],
  ["elevenlabs-tts", "elevenlabs", "elevenlabs", "elevenlabs", "eleven_v3", 8, { credentials: ["apiKey"] }]
];
function implementationFromRow(row) {
  const [, providerId, upstreamId, apiShape, upstreamModel, priority, options] = row;
  return {
    providerId,
    upstreamId,
    ...options?.region ? { region: options.region } : {},
    upstreamModel,
    apiShape,
    priority,
    ...options?.credentials?.length ? { requiredCredentials: [...options.credentials] } : {},
    ...options?.credentialRequirements ? {
      credentialRequirements: {
        ...options.credentialRequirements,
        anyOf: options.credentialRequirements.anyOf.map((credentials) => [...credentials])
      }
    } : {},
    ...options?.oauth?.length ? { requiredOAuth: [...options.oauth] } : {},
    ...options?.referenceBinding ? { referenceBinding: options.referenceBinding } : {},
    ...options?.inputAdaptation ? {
      inputAdaptation: {
        ...options.inputAdaptation.audio ? {
          audio: {
            mimeAliases: {
              ...options.inputAdaptation.audio.mimeAliases
            }
          }
        } : {}
      }
    } : {},
    // Which plugin executor owns this route's submit/poll lifecycle. Without this the executors are
    // built, tested and unreachable, and the host answers from its own path instead.
    ...options?.executorExportId ? { executorExportId: options.executorExportId } : {},
    ...options?.executorPluginId ? { executorPluginId: options.executorPluginId } : {},
    ...options?.parameterOverrides?.length ? { parameterOverrides: options.parameterOverrides } : {},
    ...options?.defaultParamOverrides ? { defaultParamOverrides: options.defaultParamOverrides } : {},
    ...options?.excludedParameterIds?.length ? { excludedParameterIds: [...options.excludedParameterIds] } : {},
    ...options?.projectorExportId ? { projectorExportId: options.projectorExportId } : {},
    ...options?.projectorPluginId ? { projectorPluginId: options.projectorPluginId } : {}
  };
}
function modelProviderImplementationsById(rows) {
  const byId = {};
  for (const row of rows) {
    const [modelId] = row;
    byId[modelId] = [...byId[modelId] ?? [], implementationFromRow(row)];
  }
  return byId;
}
var MODEL_PROVIDER_IMPLEMENTATIONS_BY_ID = modelProviderImplementationsById(MODEL_PROVIDER_IMPLEMENTATION_ROWS);
var MODEL_CARD_DEFINITIONS_WITH_PROVIDER_IMPLEMENTATIONS = MODEL_CARD_DEFINITIONS.map((model) => ({
  ...model,
  constraints: model.constraints ?? [],
  ...MODEL_PROVIDER_IMPLEMENTATIONS_BY_ID[model.id] ? { providerImplementations: MODEL_PROVIDER_IMPLEMENTATIONS_BY_ID[model.id] } : {}
}));
var MODEL_CARDS = z.array(ModelCardSchema).parse(MODEL_CARD_DEFINITIONS_WITH_PROVIDER_IMPLEMENTATIONS);
var MODEL_IDS = new Set(MODEL_CARDS.map((model) => model.id));
var MODEL_ALIAS_TO_ID = /* @__PURE__ */ new Map();
for (const model of MODEL_CARDS) {
  for (const alias of model.aliases) {
    MODEL_ALIAS_TO_ID.set(alias, model.id);
  }
}
var MOCK_MODEL_CARDS = z.array(ModelCardSchema).parse([
  {
    id: "mock-image-model",
    name: "Mock Image Model",
    provider: "Clash Mock",
    availableProviders: ["mock"],
    defaultProvider: "mock",
    kind: "image",
    defaultAspectRatio: "1:1",
    description: "Deterministic image model used by provider routing tests.",
    parameters: [],
    defaultParams: {},
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
    providerImplementations: [
      {
        providerId: "mock",
        upstreamId: "mock",
        upstreamModel: "fal-ai/mock-image",
        apiShape: "fal",
        priority: 1
      }
    ]
  },
  {
    id: "mock-text-model",
    name: "Mock Text Model",
    provider: "Clash Mock",
    availableProviders: ["mock"],
    defaultProvider: "mock",
    kind: "text",
    defaultAspectRatio: "1:1",
    description: "Deterministic text model used by provider routing tests.",
    parameters: [],
    defaultParams: {},
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
    providerImplementations: [
      {
        providerId: "mock",
        upstreamId: "mock",
        upstreamModel: "mock/text-completion",
        apiShape: "openai-compatible",
        priority: 1
      }
    ]
  }
]);
var PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
var SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
var SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
function isSafePluginRelativePath(value) {
  if (!value || value.startsWith("/") || value.startsWith("\\")) return false;
  if (value.includes("\\") || value.includes("\0")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
var PluginRelativePathSchema = z.string().trim().min(1).refine(
  isSafePluginRelativePath,
  "Plugin paths must be relative and cannot contain dot segments."
);
var ExecutablePluginRuntimeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("local"),
    transport: z.literal("stdio"),
    /**
     * Which interpreter the host launches.
     *
     * A closed enum rather than a command line: the host owns the launch protocol,
     * stdio framing, and process lifecycle for each supported runtime. A plugin that
     * could name an arbitrary command would no longer have a predictable adapter.
     *
     * Optional only so the two manifests written before this field existed keep
     * loading; `resolvePluginLanguage` falls back to the entrypoint extension.
     * New drafts always declare it.
     */
    language: z.enum(["node", "python"]).optional(),
    entrypoint: PluginRelativePathSchema,
    args: z.array(z.string()).default([]),
    /**
     * Declares that the entrypoint is derived from source.
     *
     * Present means the host compiles `source` into `entrypoint` before validating,
     * contract-testing, or activating, so a stale bundle cannot be packaged. Absent
     * means the entrypoint is authored directly and the host never overwrites it --
     * which is the normal case for Python, and for a hand-written `.mjs`.
     */
    build: z.object({
      source: PluginRelativePathSchema
    }).strict().optional()
  }),
  z.object({
    kind: z.literal("hosted"),
    transport: z.literal("http"),
    endpoint: z.string().url()
  })
]);
var ExecutablePluginCardExportSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  kind: z.enum(["model-card", "action-card"]),
  path: PluginRelativePathSchema
}).strict();
var ExecutablePluginProviderExportSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  kind: z.literal("provider"),
  path: PluginRelativePathSchema
}).strict();
var ExecutablePluginModelBindingExportSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  kind: z.literal("model-provider-binding"),
  path: PluginRelativePathSchema
}).strict();
var ExecutableActionPresentationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("form")
  }).strict(),
  z.object({
    type: z.literal("dialog"),
    size: z.enum(["sm", "md", "lg", "xl"]).default("lg"),
    title: z.string().trim().min(1).optional()
  }).strict(),
  z.object({
    type: z.literal("workspace"),
    resourceUri: z.string().regex(/^ui:\/\/[a-z0-9][a-z0-9._/-]*$/)
  }).strict()
]);
var ExecutableActionCardSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  parameters: z.array(ModelParameterSchema).default([]),
  outputType: z.enum(["image", "video", "audio", "text"]),
  input: ModelInputRuleSchema.default({
    requiresPrompt: true,
    inputMode: {},
    promptModalities: ["text"]
  }),
  constraints: z.array(ModelConstraintRuleSchema).optional(),
  presentation: ExecutableActionPresentationSchema.default({ type: "form" }),
  functionExportId: z.string().trim().regex(PLUGIN_ID_PATTERN),
  maxRuntimeMs: z.number().int().positive().optional()
}).strict().superRefine((action, ctx) => {
  const parameterIds = /* @__PURE__ */ new Set();
  for (const [index, parameter] of action.parameters.entries()) {
    if (parameterIds.has(parameter.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parameters", index, "id"],
        message: "Action parameter ids must be unique."
      });
    }
    parameterIds.add(parameter.id);
    if (parameter.type === "select") {
      const candidates = parameter.options?.map((option) => option.value) ?? [];
      if (candidates.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parameters", index, "options"],
          message: "Select parameters require at least one candidate."
        });
      }
      if (new Set(candidates.map((value) => `${typeof value}:${String(value)}`)).size !== candidates.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parameters", index, "options"],
          message: "Select parameter candidate values must be unique."
        });
      }
      if (parameter.defaultValue !== void 0 && !candidates.some((value) => value === parameter.defaultValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parameters", index, "defaultValue"],
          message: `${parameter.label} defaultValue must be one of its configured candidates.`
        });
      }
    }
    if (parameter.readOnly && parameter.defaultValue === void 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parameters", index, "defaultValue"],
        message: `${parameter.label} is read-only and requires a fixed default.`
      });
    }
    if ((parameter.type === "number" || parameter.type === "slider") && parameter.defaultValue !== void 0) {
      if (typeof parameter.defaultValue !== "number" || !Number.isFinite(parameter.defaultValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parameters", index, "defaultValue"],
          message: `${parameter.label} default must be a finite number.`
        });
      } else if (parameter.min !== void 0 && parameter.defaultValue < parameter.min || parameter.max !== void 0 && parameter.defaultValue > parameter.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parameters", index, "defaultValue"],
          message: `${parameter.label} default must stay within its configured range.`
        });
      }
    }
    if (parameter.type === "boolean" && parameter.defaultValue !== void 0 && typeof parameter.defaultValue !== "boolean") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parameters", index, "defaultValue"],
        message: `${parameter.label} default must be a boolean.`
      });
    }
  }
  const validateConstraintField = (field2, path) => {
    if (!field2.startsWith("modelParams.")) return;
    if (parameterIds.has(field2.slice("modelParams.".length))) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: `Action constraint ${field2} must reference a declared parameter.`
    });
  };
  for (const [index, rule] of (action.constraints ?? []).entries()) {
    if (rule.type === "mutually-exclusive") {
      rule.fields.forEach((field2, fieldIndex) => validateConstraintField(field2, ["constraints", index, "fields", fieldIndex]));
      continue;
    }
    validateConstraintField(rule.field, ["constraints", index, "field"]);
    if (rule.type === "required") {
      rule.when.forEach((condition, conditionIndex) => validateConstraintField(condition.field, ["constraints", index, "when", conditionIndex, "field"]));
    }
  }
});
var ExecutablePluginCardDocumentSchema = z.discriminatedUnion("kind", [
  z.object({
    apiVersion: z.literal("clash.card/v1"),
    kind: z.literal("model-card"),
    spec: ModelCardSchema
  }).strict(),
  z.object({
    apiVersion: z.literal("clash.card/v1"),
    kind: z.literal("action-card"),
    spec: ExecutableActionCardSchema
  }).strict()
]).superRefine((document, ctx) => {
  if (document.kind !== "model-card") return;
  document.spec.providerImplementations?.forEach((implementation, index) => {
    if (implementation.accountId === void 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["spec", "providerImplementations", index, "accountId"],
      message: "Plugin model Cards cannot select a Provider account; the Host selects it at runtime."
    });
  });
});
var ExecutablePluginProviderDefinitionSchema = z.object({
  /**
   * What this provider needs to authenticate, and how to draw it.
   *
   * Optional because a provider may need nothing -- a local model has no credential. Present, it is
   * the whole of what the host knows: it renders the form, stores the answers opaquely, wakes the
   * plugin on the declared schedule, and never learns what any of the values mean.
   */
  auth: PluginAuthDeclarationSchema.optional(),
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  upstreamId: z.string().trim().regex(PLUGIN_ID_PATTERN),
  apiShape: z.string().trim().regex(PLUGIN_ID_PATTERN),
  executorExportId: z.string().trim().regex(PLUGIN_ID_PATTERN),
  /**
   * Route values every binding of this provider inherits.
   *
   * A binding carries two facts: which catalogue model it routes, and the name that
   * model has upstream. The rest of the route -- provider id, upstream, api shape,
   * executor, credentials, priority -- belongs to the provider. Repeating it per
   * binding produced no information and one real hazard: a single mistyped copy
   * yields a route pointing at the wrong upstream while every sibling looks correct.
   */
  bindingDefaults: z.object({
    priority: z.number().nonnegative().optional(),
    weight: z.number().nonnegative().optional(),
    region: z.string().trim().min(1).optional()
  }).strict().optional()
}).strict();
var ExecutablePluginProviderDocumentSchema = z.object({
  apiVersion: z.literal("clash.provider/v1"),
  kind: z.literal("provider"),
  spec: ExecutablePluginProviderDefinitionSchema
}).strict();
var ExecutablePluginModelBindingSpecSchema = z.intersection(
  z.object({
    id: z.string().trim().regex(PLUGIN_ID_PATTERN),
    modelId: z.string().trim().min(1)
  }),
  ModelProviderImplementationSchema
).superRefine((binding, ctx) => {
  if (binding.accountId === void 0) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["accountId"],
    message: "Plugin model bindings cannot select a Provider account; the Host selects it at runtime."
  });
});
var ExecutablePluginModelBindingInputSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN).optional(),
  modelId: z.string().trim().min(1, "A binding must name the model it routes (modelId)."),
  upstreamModel: z.string().trim().min(1, "A binding must name its upstreamModel."),
  providerId: z.string().trim().min(1).optional(),
  upstreamId: z.string().trim().min(1).optional(),
  apiShape: z.string().trim().min(1).optional(),
  executorExportId: z.string().trim().min(1).optional(),
  requiredOAuth: z.array(z.string()).optional(),
  priority: z.number().optional(),
  weight: z.number().optional(),
  region: z.string().trim().min(1).optional()
}).passthrough().superRefine((binding, ctx) => {
  if (binding.accountId === void 0) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["accountId"],
    message: "Plugin model bindings cannot select a Provider account; the Host selects it at runtime."
  });
});
var ExecutablePluginModelBindingDocumentSchema = z.object({
  apiVersion: z.literal("clash.binding/v1"),
  kind: z.literal("model-provider-binding"),
  spec: ExecutablePluginModelBindingSpecSchema
}).strict();
var PLUGIN_ENTRY_OPERATIONS = ["submit", "poll", "callback"];
var PluginEntryOperationSchema = z.enum(PLUGIN_ENTRY_OPERATIONS);
var ExecutablePluginHostDependencySchema = z.enum([
  "public-asset-storage"
]);
var ExecutablePluginFunctionExportSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  kind: z.enum(["action", "provider-projector", "provider-executor"]),
  /** Defaults to submit-only: the simplest plugin declares nothing and gets the simplest contract. */
  operations: z.array(PluginEntryOperationSchema).nonempty().default(["submit"]),
  /** Optional machine capabilities this one entry point requires before it may run. */
  requires: z.array(ExecutablePluginHostDependencySchema).default([])
}).strict().superRefine((entry, ctx) => {
  if (!entry.operations.includes("submit")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["operations"],
      message: "An entry must handle submit; nothing can be polled that was never started."
    });
  }
  if (entry.operations.includes("callback") && !entry.operations.includes("poll")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["operations"],
      message: "An entry handling callbacks must also handle poll. A callback that never arrives is an ordinary event -- providers drop them and networks partition -- and without a poll to fall back on the work is lost."
    });
  }
});
var ExecutablePluginCardRegistrationSchema = z.object({
  pluginId: pluginIdSchema,
  version: z.string().trim().regex(SEMVER_PATTERN),
  schemaHash: z.string().regex(SHA256_PATTERN),
  runtime: ExecutablePluginRuntimeSchema,
  document: ExecutablePluginCardDocumentSchema
}).strict();
var ExecutablePluginArtifactRegistrationBaseSchema = z.object({
  pluginId: pluginIdSchema,
  version: z.string().trim().regex(SEMVER_PATTERN),
  schemaHash: z.string().regex(SHA256_PATTERN),
  runtime: ExecutablePluginRuntimeSchema
});
var ExecutablePluginProviderRegistrationSchema = ExecutablePluginArtifactRegistrationBaseSchema.extend({
  document: ExecutablePluginProviderDocumentSchema
}).strict();
var ExecutablePluginModelBindingRegistrationSchema = ExecutablePluginArtifactRegistrationBaseSchema.extend({
  document: ExecutablePluginModelBindingDocumentSchema
}).strict();
var ExecutablePluginBindingSchema = z.object({
  pluginId: pluginIdSchema,
  version: z.string().trim().regex(SEMVER_PATTERN),
  exportId: z.string().trim().regex(PLUGIN_ID_PATTERN),
  schemaHash: z.string().regex(SHA256_PATTERN)
}).strict();
var ExecutablePluginJsonValueSchema = z.lazy(
  () => z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(ExecutablePluginJsonValueSchema),
    z.record(ExecutablePluginJsonValueSchema)
  ])
);
var ExecutablePluginAssetHandleObjectSchema = z.object({
  assetId: z.string().trim().min(1),
  uri: z.string().regex(/^clash-asset:\/\/.+/),
  kind: AssetKindSchema,
  mediaType: z.string().trim().min(1).optional(),
  /**
   * Where the bytes are, when the host has not stored them yet.
   *
   * A generation plugin ends up with a link its upstream published, and returning it through the
   * asset channel keeps the media type a declared field instead of a hand-rolled one. Absent for a
   * handle that names an asset the host already holds.
   */
  url: z.string().url().optional(),
  /** Who can fetch `url`. The host cannot retrieve an address only the plugin can see. */
  reach: z.enum(["public", "private"]).optional()
}).strict();
var ExecutablePluginAssetHandleSchema = ExecutablePluginAssetHandleObjectSchema.superRefine((handle, ctx) => {
  if (handle.url && !handle.reach) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An asset handle with a url must state its reach."
    });
  }
  if (!handle.url && handle.reach) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "An asset handle's reach applies to a url."
    });
  }
});
var ExecutablePluginAssetReadResultSchema = z.object({
  handle: z.string().trim().min(1),
  kind: AssetKindSchema,
  mediaType: z.string().trim().min(1).optional(),
  byteLength: z.number().int().nonnegative(),
  /** Fetchable by the plugin. A `clash-asset://` handle is the request, not an answer. */
  url: z.string().url().refine((value) => !value.startsWith("clash-asset://"), {
    message: "asset.read url must be fetchable, not another asset handle."
  }).optional(),
  /**
   * Who can fetch `url`.
   *
   * `public` means the provider can retrieve it directly, so it may be forwarded upstream.
   * `private` means only this plugin process can -- a local asset served on loopback, say --
   * and forwarding it would hand the provider an address that answers for somebody else.
   * Both are `https?://` strings, so nothing downstream can tell them apart by inspection.
   */
  reach: z.enum(["public", "private"]).optional(),
  dataBase64: z.string().optional()
}).strict().superRefine((result, ctx) => {
  if (Boolean(result.url) === Boolean(result.dataBase64)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "asset.read returns exactly one of url or dataBase64."
    });
  }
  if (result.url && !result.reach) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "asset.read url requires a reach of public or private."
    });
  }
  if (result.dataBase64 && result.reach) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "asset.read reach applies to a url; bytes have none."
    });
  }
});
var ExecutablePluginReferenceBaseSchema = z.object({
  slot: z.string().trim().min(1),
  index: z.number().int().nonnegative()
});
var ExecutablePluginReferenceSchema = z.union([
  ExecutablePluginReferenceBaseSchema.extend({
    asset: ExecutablePluginAssetHandleSchema
  }).strict(),
  ExecutablePluginReferenceBaseSchema.extend({
    text: z.object({
      nodeId: z.string().trim().min(1),
      value: z.string()
    }).strict()
  }).strict()
]);
var ExecutablePluginInvocationSchema = z.object({
  protocol: z.literal("clash.plugin.invoke/v1"),
  invocationId: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  nodeId: z.string().trim().min(1).optional(),
  target: ExecutablePluginBindingSchema.extend({
    kind: z.enum(["action", "provider-projector", "provider-executor"])
  }),
  input: z.object({
    values: z.record(ExecutablePluginJsonValueSchema).default({}),
    references: z.array(ExecutablePluginReferenceSchema).default([])
  }).strict(),
  actor: z.object({
    kind: z.enum(["user", "agent", "system"]),
    id: z.string().trim().min(1).optional()
  }).strict(),
  /**
   * Which translation the host wants: start the work, or report on work already started.
   *
   * A plugin at this level only converts shapes. `submit` turns Clash's request into the provider's
   * request and reads back an id; `poll` turns that id into the provider's status request and reads
   * back a verdict. Neither waits. The loop, the interval, the retry budget, and the durability are
   * the host's, because none of them differ by provider -- and because only the host survives its
   * own restart.
   *
   * Stated as a field rather than inferred from an absent one: a plugin that mistakes a status
   * query for a submission bills the user twice.
   */
  operation: z.enum(["submit", "poll", "callback"]).default("submit"),
  /**
   * Where the provider should report completion, issued by the host at submit time.
   *
   * The plugin cannot supply this. It has no address: a `local` plugin listens on nothing, and a
   * short-lived translator has nowhere to keep a listener even if it did. The same reasoning already
   * governs upload targets -- the host issues the address, so reachability holds by construction
   * rather than by a plugin's claim about itself.
   *
   * Absent when the host cannot receive callbacks, which is the local single-user case today. A
   * plugin that sees no callback URL submits for polling instead; both paths end in `accepted`.
   */
  callbackUrl: z.string().url().optional(),
  /** The opaque state the plugin returned when it accepted the work. Required by `poll`. */
  pollState: ExecutablePluginJsonValueSchema.optional(),
  /**
   * The provider's own callback body, verbatim, for the plugin to translate.
   *
   * The host receives this on the address it issued and cannot read it: the payload is in the
   * provider's shape, which is exactly the thing this plugin exists to translate. So the host routes
   * it back rather than parsing it, and the plugin answers with the same `completed` or `failed` it
   * would have returned from a poll.
   */
  callbackPayload: ExecutablePluginJsonValueSchema.optional(),
  /**
   * The callback request's headers, so the plugin can decide whether to believe it.
   *
   * Providers sign callbacks, and they sign them in headers -- an HMAC over the raw body, a
   * timestamp, a key id. Only the plugin knows which scheme this provider uses, so only the plugin
   * can verify, and it cannot verify from a body alone. Withholding these would leave one defence
   * standing: that the address is hard to guess. An address travels through the provider's logs,
   * any proxy in between, and a referrer header, so it is a weak thing to rest on by itself.
   *
   * A plugin that cannot verify a callback returns `failed`, and the work stays pending until a poll
   * settles it. Refusing to believe an unverified message is not a failure to make progress -- the
   * poll path is still there, and it authenticates in the other direction.
   */
  callbackHeaders: z.record(z.string()).optional()
}).strict().superRefine((invocation, ctx) => {
  if (invocation.operation === "poll" && invocation.pollState === void 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pollState"],
      message: "A poll must carry the state the plugin returned when it accepted the work."
    });
  }
  if (invocation.operation === "submit" && invocation.pollState !== void 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pollState"],
      message: "A submit starts new work and cannot carry poll state."
    });
  }
  if (invocation.operation === "callback" && invocation.callbackPayload === void 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["callbackPayload"],
      message: "A callback must carry the body the provider sent."
    });
  }
  if (invocation.operation !== "callback" && invocation.callbackHeaders !== void 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["callbackHeaders"],
      message: "callbackHeaders belongs to a callback."
    });
  }
  if (invocation.operation !== "callback" && invocation.callbackPayload !== void 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["callbackPayload"],
      message: "callbackPayload belongs to a callback."
    });
  }
  if (invocation.operation !== "submit" && invocation.callbackUrl !== void 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["callbackUrl"],
      message: "A callback address is issued when the work is submitted, not afterwards."
    });
  }
});
var ExecutablePluginOutputSchema = z.union([
  z.object({
    slot: z.string().trim().min(1),
    kind: z.literal("asset"),
    asset: ExecutablePluginAssetHandleSchema
  }).strict(),
  z.object({
    slot: z.string().trim().min(1),
    kind: z.literal("value"),
    value: ExecutablePluginJsonValueSchema
  }).strict()
]);
var ExecutablePluginFailureCodeSchema = z.enum([
  "invalid_request",
  "authentication_failed",
  "permission_denied",
  "content_rejected",
  "rate_limited",
  "quota_exhausted",
  "provider_unavailable",
  "provider_failed",
  "task_not_found",
  "task_expired",
  "transport_timeout",
  "transport_error",
  "invalid_response",
  "execution_failed",
  "contract_violation",
  "cancelled",
  "plugin_unavailable",
  "deadline_exceeded",
  "output_persistence_failed",
  "publication_failed"
]);
var ExecutablePluginFailureErrorSchema = z.object({
  /** Stable Clash category. Provider-specific spellings belong in `providerCode`. */
  code: ExecutablePluginFailureCodeSchema,
  message: z.string().trim().min(1),
  retryable: z.boolean(),
  /** Whether the provider definitely rejected, may have accepted, or later failed the work. */
  requestState: z.enum(["rejected", "unknown", "accepted"]),
  providerCode: z.string().trim().min(1).optional(),
  details: ExecutablePluginJsonValueSchema.optional()
}).strict();
var ExecutablePluginResultSchema = z.discriminatedUnion("status", [
  z.object({
    protocol: z.literal("clash.plugin.result/v1"),
    invocationId: z.string().trim().min(1),
    status: z.literal("completed"),
    outputs: z.array(ExecutablePluginOutputSchema).default([])
  }).strict(),
  /**
   * The provider took the work and has not finished it.
   *
   * A blocking call keeps the upstream's task id in its own stack, so a host that stops mid-flight
   * cannot find the work again -- the node stays pending forever and the generation is already
   * billed. Naming the task hands the host something durable to resume from, and moves the retry
   * loop out of every plugin that currently rewrites it.
   *
   * How the host learns the answer is deliberately unspecified here. Polling and a cloud callback
   * differ only in what wakes the host; the plugin's shape is the same either way.
   */
  z.object({
    protocol: z.literal("clash.plugin.result/v1"),
    invocationId: z.string().trim().min(1),
    status: z.literal("accepted"),
    /**
     * Whatever this plugin needs to ask about the work again, stored verbatim and handed back.
     *
     * Not an id, because plenty of providers have no id: one returns a status URL, another needs a
     * region alongside a job name, a third hands back a cursor. Any of those fits here, and the host
     * reads none of it -- it persists the value and returns it on the next poll. Naming a field
     * `taskId` would have forced every provider without one to fake it.
     */
    pollState: ExecutablePluginJsonValueSchema,
    /** How long to wait before asking again, when the provider says. */
    retryAfterMs: z.number().int().positive().optional()
  }).strict(),
  z.object({
    protocol: z.literal("clash.plugin.result/v1"),
    invocationId: z.string().trim().min(1),
    status: z.literal("failed"),
    error: ExecutablePluginFailureErrorSchema
  }).strict()
]);
var ExecutablePluginBrokerOperationSchema = z.union([
  z.object({
    kind: z.literal("asset.read"),
    asset: ExecutablePluginAssetHandleSchema
  }).strict(),
  /**
   * Somewhere to put bytes that is not this message.
   *
   * `asset.write` with `dataBase64` carries a result inside the frame that announces it -- one
   * 30-second video is 3,470,456 characters that way, held at once by the plugin, the pipe and the
   * host. A slot separates them: the host names a place, the plugin streams to it, and the frame
   * carries a handle.
   *
   * The size is required so the host can refuse before the bytes arrive rather than after.
   */
  /**
   * Read one value this plugin stored for this account.
   *
   * There is no plugin id and no account id in the request, and adding either would make the
   * binding forgeable. The host knows both from the spawn: it started this process for this
   * account, and the answer is scoped to that pair before the key is looked at.
   *
   * The value is opaque. The host does not know what a vendor's auth looks like -- Google wants an
   * api key on one surface and a bearer token on another, kling wants an access key and a secret --
   * and enumerating those here would mean editing the host every time a vendor changes its mind.
   */
  z.object({
    kind: z.literal("store.get"),
    key: z.string().trim().min(1)
  }).strict(),
  /** Write one back. Renewal is plugin code: it refreshes a token and stores it where it found it. */
  z.object({
    kind: z.literal("store.put"),
    key: z.string().trim().min(1),
    value: z.string(),
    secret: z.boolean().optional(),
    expiresAt: z.string().datetime().optional()
  }).strict(),
  z.object({
    kind: z.literal("asset.upload-slot"),
    slot: z.string().trim().min(1),
    assetKind: AssetKindSchema,
    mediaType: z.string().trim().min(1).optional(),
    /**
     * How many bytes are coming, when the plugin holds them.
     *
     * Announced ahead of the payload so the host can refuse an oversized upload before receiving
     * it rather than after.
     */
    byteLength: z.number().int().positive().optional(),
    /**
     * Where the bytes are, when the vendor answered with a link.
     *
     * A URL has no byte count until someone fetches it, and fetching it only to satisfy a schema
     * pays for the transfer twice -- the host is the side that knows whether it wants a copy. This
     * was required-`byteLength`-only, so the url form failed with "Cannot read properties of
     * undefined (reading 'byteLength')" the first time a real vendor answered with a link, after
     * the generation had completed and been paid for.
     */
    url: z.string().trim().url().refine(
      (value) => value.startsWith("https://"),
      "The host will fetch this address, so it must be https."
    ).optional()
  }).strict().refine(
    (operation) => operation.byteLength !== void 0 || operation.url !== void 0,
    // Neither is a request for storage with nothing to store, and opens a slot that can only ever
    // be abandoned.
    { message: "An upload slot needs either a byte count or a url." }
  ),
  z.object({
    kind: z.literal("asset.write"),
    slot: z.string().trim().min(1),
    assetKind: AssetKindSchema,
    mediaType: z.string().trim().min(1).optional(),
    /**
     * Where the result already lives, for the host to fetch once.
     *
     * A generation plugin normally ends up with a link the upstream published, and passing that
     * through means the bytes cross the wire exactly once and never touch the plugin. Without this
     * field the only ways to return such a result were to download it and re-encode it inline, or
     * to smuggle the link through a free-form `kind: "value"` output -- which is what
     * `hilo-hub-media` does, and why its media type is hardcoded per model kind instead of read
     * from the response.
     */
    url: z.string().url().optional(),
    /** Who can fetch `url`. A host cannot retrieve an address only the plugin can see. */
    reach: z.enum(["public", "private"]).optional(),
    /** Set when the bytes were already streamed to a slot; the write only names them. */
    assetId: z.string().trim().min(1).optional(),
    dataBase64: z.string().regex(
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      "Plugin asset data must be canonical base64."
    ).optional()
  }).strict().superRefine((operation, ctx) => {
    const sources = [operation.url, operation.dataBase64, operation.assetId].filter((source) => source !== void 0).length;
    if (sources !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "asset.write requires exactly one of url, dataBase64 or assetId."
      });
    }
    if (operation.url && !operation.reach) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "asset.write url requires a reach of public or private."
      });
    }
    if (!operation.url && operation.reach) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "asset.write reach applies to a url."
      });
    }
  }),
  z.object({
    kind: z.literal("codex.image.generate"),
    prompt: z.string().trim().min(1).max(2e4),
    aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"]).default("1:1"),
    slot: z.string().trim().min(1),
    references: z.array(ExecutablePluginAssetHandleObjectSchema.extend({
      kind: z.literal("image")
    }).strict()).max(5).default([])
  }).strict()
]);
var ExecutablePluginBrokerRequestSchema = z.object({
  protocol: z.literal("clash.plugin.broker-request/v1"),
  requestId: z.string().trim().min(1),
  invocationId: z.string().trim().min(1),
  operation: ExecutablePluginBrokerOperationSchema
}).strict();
var ExecutablePluginBrokerResponseSchema = z.discriminatedUnion("status", [
  z.object({
    protocol: z.literal("clash.plugin.broker-response/v1"),
    requestId: z.string().trim().min(1),
    status: z.literal("ok"),
    result: ExecutablePluginJsonValueSchema
  }).strict(),
  z.object({
    protocol: z.literal("clash.plugin.broker-response/v1"),
    requestId: z.string().trim().min(1),
    status: z.literal("error"),
    error: z.object({
      code: z.string().trim().min(1),
      message: z.string().trim().min(1)
    }).strict()
  }).strict()
]);
var ExecutablePluginContractBrokerFixtureSchema = z.object({
  operation: ExecutablePluginBrokerOperationSchema,
  response: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      result: ExecutablePluginJsonValueSchema
    }).strict(),
    z.object({
      status: z.literal("error"),
      error: z.object({
        code: z.string().trim().min(1),
        message: z.string().trim().min(1)
      }).strict()
    }).strict()
  ])
}).strict();
var ExecutablePluginContractTestDocumentSchema = z.object({
  apiVersion: z.literal("clash.plugin.contract-test/v1"),
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  description: z.string().trim().min(1).optional(),
  target: z.object({
    exportId: z.string().trim().regex(PLUGIN_ID_PATTERN),
    kind: z.enum(["action", "provider-projector", "provider-executor"])
  }).strict(),
  context: z.object({
    projectId: z.string().trim().min(1).default("contract-test-project"),
    nodeId: z.string().trim().min(1).optional()
  }).strict().default({ projectId: "contract-test-project" }),
  input: z.object({
    values: z.record(ExecutablePluginJsonValueSchema).default({}),
    references: z.array(ExecutablePluginReferenceSchema).default([])
  }).strict(),
  /**
   * Which half of an executor this case exercises.
   *
   * A poll is a different translation from a submit, with a different input and a different set of
   * answers, so a suite that can only describe submits leaves the resuming path uncovered -- and
   * that is the path that runs after a restart, when nobody is watching.
   */
  operation: z.enum(["submit", "poll", "callback"]).default("submit"),
  /** The state a poll is asking about, as the plugin would have returned it. */
  pollState: ExecutablePluginJsonValueSchema.optional(),
  brokerFixtures: z.array(ExecutablePluginContractBrokerFixtureSchema).default([]),
  expect: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("completed"),
      outputs: z.array(ExecutablePluginOutputSchema).default([])
    }).strict(),
    // Pinning what a submit hands back is the only way to catch a plugin that silently changes how
    // its own poll state is shaped, which would strand every generation already in flight.
    z.object({
      status: z.literal("accepted"),
      pollState: ExecutablePluginJsonValueSchema
    }).strict(),
    z.object({
      status: z.literal("failed"),
      error: ExecutablePluginFailureErrorSchema
    }).strict()
  ]),
  timeoutMs: z.number().int().positive().max(12e4).default(1e4)
}).strict();
var ExecutablePluginContributionsSchema = z.object({
  cards: z.array(ExecutablePluginCardExportSchema).default([]),
  providers: z.array(ExecutablePluginProviderExportSchema).default([]),
  modelBindings: z.array(ExecutablePluginModelBindingExportSchema).default([]),
  functions: z.array(ExecutablePluginFunctionExportSchema).default([]),
  hostTools: z.array(z.enum(["codex.imagegen"])).default([])
}).strict();
var ExecutablePluginManifestSchema = z.object({
  apiVersion: z.literal("clash.plugin/v1"),
  /** `publisher.name`, like clash.google. The version travels beside it, never inside it. */
  id: pluginIdSchema,
  version: z.string().trim().regex(SEMVER_PATTERN),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  runtime: ExecutablePluginRuntimeSchema,
  contributes: ExecutablePluginContributionsSchema,
  contractTests: z.array(PluginRelativePathSchema).default([]),
  author: z.string().trim().min(1).optional(),
  repository: z.string().trim().min(1).optional()
}).strict().superRefine((manifest, ctx) => {
  for (const [key, values] of [
    ["cards", manifest.contributes.cards],
    ["providers", manifest.contributes.providers],
    ["modelBindings", manifest.contributes.modelBindings],
    ["functions", manifest.contributes.functions]
  ]) {
    const ids = /* @__PURE__ */ new Set();
    for (const value of values) {
      if (ids.has(value.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contributes", key],
          message: `Plugin ${key} contribution ids must be unique.`
        });
      }
      ids.add(value.id);
    }
  }
  const cardPaths = /* @__PURE__ */ new Set();
  for (const card of manifest.contributes.cards) {
    if (cardPaths.has(card.path)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contributes", "cards"],
        message: "Plugin Card contribution paths must be unique."
      });
    }
    cardPaths.add(card.path);
  }
  const artifactPaths = new Set(cardPaths);
  for (const artifact of [
    ...manifest.contributes.providers,
    ...manifest.contributes.modelBindings
  ]) {
    if (artifactPaths.has(artifact.path)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contributes"],
        message: "Plugin declarative artifact paths must be unique."
      });
    }
    artifactPaths.add(artifact.path);
  }
  const contractTestPaths = /* @__PURE__ */ new Set();
  for (const path of manifest.contractTests) {
    if (contractTestPaths.has(path)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contractTests"],
        message: "Plugin contract test paths must be unique."
      });
    }
    contractTestPaths.add(path);
  }
});
var ExecutablePluginActivationReceiptSchema = z.object({
  apiVersion: z.literal("clash.plugin.activation/v1"),
  pluginId: pluginIdSchema,
  version: z.string().trim().regex(SEMVER_PATTERN),
  schemaHash: z.string().regex(SHA256_PATTERN),
  contentHash: z.string().regex(SHA256_PATTERN),
  activatedAt: z.string().datetime()
}).strict();

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/Options.js
var ignoreOverride = /* @__PURE__ */ Symbol("Let zodToJsonSchema decide on which parser to use");
var defaultOptions = {
  name: void 0,
  $refStrategy: "root",
  basePath: ["#"],
  effectStrategy: "input",
  pipeStrategy: "all",
  dateStrategy: "format:date-time",
  mapStrategy: "entries",
  removeAdditionalStrategy: "passthrough",
  allowedAdditionalProperties: true,
  rejectedAdditionalProperties: false,
  definitionPath: "definitions",
  target: "jsonSchema7",
  strictUnions: false,
  definitions: {},
  errorMessages: false,
  markdownDescription: false,
  patternStrategy: "escape",
  applyRegexFlags: false,
  emailStrategy: "format:email",
  base64Strategy: "contentEncoding:base64",
  nameStrategy: "ref",
  openAiAnyTypeName: "OpenAiAnyType"
};
var getDefaultOptions = (options) => typeof options === "string" ? {
  ...defaultOptions,
  name: options
} : {
  ...defaultOptions,
  ...options
};

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/Refs.js
var getRefs = (options) => {
  const _options = getDefaultOptions(options);
  const currentPath = _options.name !== void 0 ? [..._options.basePath, _options.definitionPath, _options.name] : _options.basePath;
  return {
    ..._options,
    flags: { hasReferencedOpenAiAnyType: false },
    currentPath,
    propertyPath: void 0,
    seen: new Map(Object.entries(_options.definitions).map(([name, def]) => [
      def._def,
      {
        def: def._def,
        path: [..._options.basePath, _options.definitionPath, name],
        // Resolution of references will be forced even though seen, so it's ok that the schema is undefined here for now.
        jsonSchema: void 0
      }
    ]))
  };
};

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/errorMessages.js
function addErrorMessage(res, key, errorMessage, refs) {
  if (!refs?.errorMessages)
    return;
  if (errorMessage) {
    res.errorMessage = {
      ...res.errorMessage,
      [key]: errorMessage
    };
  }
}
function setResponseValueAndErrors(res, key, value, errorMessage, refs) {
  res[key] = value;
  addErrorMessage(res, key, errorMessage, refs);
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/getRelativePath.js
var getRelativePath = (pathA, pathB) => {
  let i = 0;
  for (; i < pathA.length && i < pathB.length; i++) {
    if (pathA[i] !== pathB[i])
      break;
  }
  return [(pathA.length - i).toString(), ...pathB.slice(i)].join("/");
};

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/any.js
function parseAnyDef(refs) {
  if (refs.target !== "openAi") {
    return {};
  }
  const anyDefinitionPath = [
    ...refs.basePath,
    refs.definitionPath,
    refs.openAiAnyTypeName
  ];
  refs.flags.hasReferencedOpenAiAnyType = true;
  return {
    $ref: refs.$refStrategy === "relative" ? getRelativePath(anyDefinitionPath, refs.currentPath) : anyDefinitionPath.join("/")
  };
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/array.js
function parseArrayDef(def, refs) {
  const res = {
    type: "array"
  };
  if (def.type?._def && def.type?._def?.typeName !== ZodFirstPartyTypeKind.ZodAny) {
    res.items = parseDef(def.type._def, {
      ...refs,
      currentPath: [...refs.currentPath, "items"]
    });
  }
  if (def.minLength) {
    setResponseValueAndErrors(res, "minItems", def.minLength.value, def.minLength.message, refs);
  }
  if (def.maxLength) {
    setResponseValueAndErrors(res, "maxItems", def.maxLength.value, def.maxLength.message, refs);
  }
  if (def.exactLength) {
    setResponseValueAndErrors(res, "minItems", def.exactLength.value, def.exactLength.message, refs);
    setResponseValueAndErrors(res, "maxItems", def.exactLength.value, def.exactLength.message, refs);
  }
  return res;
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/bigint.js
function parseBigintDef(def, refs) {
  const res = {
    type: "integer",
    format: "int64"
  };
  if (!def.checks)
    return res;
  for (const check of def.checks) {
    switch (check.kind) {
      case "min":
        if (refs.target === "jsonSchema7") {
          if (check.inclusive) {
            setResponseValueAndErrors(res, "minimum", check.value, check.message, refs);
          } else {
            setResponseValueAndErrors(res, "exclusiveMinimum", check.value, check.message, refs);
          }
        } else {
          if (!check.inclusive) {
            res.exclusiveMinimum = true;
          }
          setResponseValueAndErrors(res, "minimum", check.value, check.message, refs);
        }
        break;
      case "max":
        if (refs.target === "jsonSchema7") {
          if (check.inclusive) {
            setResponseValueAndErrors(res, "maximum", check.value, check.message, refs);
          } else {
            setResponseValueAndErrors(res, "exclusiveMaximum", check.value, check.message, refs);
          }
        } else {
          if (!check.inclusive) {
            res.exclusiveMaximum = true;
          }
          setResponseValueAndErrors(res, "maximum", check.value, check.message, refs);
        }
        break;
      case "multipleOf":
        setResponseValueAndErrors(res, "multipleOf", check.value, check.message, refs);
        break;
    }
  }
  return res;
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/boolean.js
function parseBooleanDef() {
  return {
    type: "boolean"
  };
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/branded.js
function parseBrandedDef(_def, refs) {
  return parseDef(_def.type._def, refs);
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/catch.js
var parseCatchDef = (def, refs) => {
  return parseDef(def.innerType._def, refs);
};

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/date.js
function parseDateDef(def, refs, overrideDateStrategy) {
  const strategy = overrideDateStrategy ?? refs.dateStrategy;
  if (Array.isArray(strategy)) {
    return {
      anyOf: strategy.map((item, i) => parseDateDef(def, refs, item))
    };
  }
  switch (strategy) {
    case "string":
    case "format:date-time":
      return {
        type: "string",
        format: "date-time"
      };
    case "format:date":
      return {
        type: "string",
        format: "date"
      };
    case "integer":
      return integerDateParser(def, refs);
  }
}
var integerDateParser = (def, refs) => {
  const res = {
    type: "integer",
    format: "unix-time"
  };
  if (refs.target === "openApi3") {
    return res;
  }
  for (const check of def.checks) {
    switch (check.kind) {
      case "min":
        setResponseValueAndErrors(
          res,
          "minimum",
          check.value,
          // This is in milliseconds
          check.message,
          refs
        );
        break;
      case "max":
        setResponseValueAndErrors(
          res,
          "maximum",
          check.value,
          // This is in milliseconds
          check.message,
          refs
        );
        break;
    }
  }
  return res;
};

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/default.js
function parseDefaultDef(_def, refs) {
  return {
    ...parseDef(_def.innerType._def, refs),
    default: _def.defaultValue()
  };
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/effects.js
function parseEffectsDef(_def, refs) {
  return refs.effectStrategy === "input" ? parseDef(_def.schema._def, refs) : parseAnyDef(refs);
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/enum.js
function parseEnumDef(def) {
  return {
    type: "string",
    enum: Array.from(def.values)
  };
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/intersection.js
var isJsonSchema7AllOfType = (type) => {
  if ("type" in type && type.type === "string")
    return false;
  return "allOf" in type;
};
function parseIntersectionDef(def, refs) {
  const allOf = [
    parseDef(def.left._def, {
      ...refs,
      currentPath: [...refs.currentPath, "allOf", "0"]
    }),
    parseDef(def.right._def, {
      ...refs,
      currentPath: [...refs.currentPath, "allOf", "1"]
    })
  ].filter((x) => !!x);
  let unevaluatedProperties = refs.target === "jsonSchema2019-09" ? { unevaluatedProperties: false } : void 0;
  const mergedAllOf = [];
  allOf.forEach((schema) => {
    if (isJsonSchema7AllOfType(schema)) {
      mergedAllOf.push(...schema.allOf);
      if (schema.unevaluatedProperties === void 0) {
        unevaluatedProperties = void 0;
      }
    } else {
      let nestedSchema = schema;
      if ("additionalProperties" in schema && schema.additionalProperties === false) {
        const { additionalProperties, ...rest } = schema;
        nestedSchema = rest;
      } else {
        unevaluatedProperties = void 0;
      }
      mergedAllOf.push(nestedSchema);
    }
  });
  return mergedAllOf.length ? {
    allOf: mergedAllOf,
    ...unevaluatedProperties
  } : void 0;
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/literal.js
function parseLiteralDef(def, refs) {
  const parsedType = typeof def.value;
  if (parsedType !== "bigint" && parsedType !== "number" && parsedType !== "boolean" && parsedType !== "string") {
    return {
      type: Array.isArray(def.value) ? "array" : "object"
    };
  }
  if (refs.target === "openApi3") {
    return {
      type: parsedType === "bigint" ? "integer" : parsedType,
      enum: [def.value]
    };
  }
  return {
    type: parsedType === "bigint" ? "integer" : parsedType,
    const: def.value
  };
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/string.js
var emojiRegex2 = void 0;
var zodPatterns = {
  /**
   * `c` was changed to `[cC]` to replicate /i flag
   */
  cuid: /^[cC][^\s-]{8,}$/,
  cuid2: /^[0-9a-z]+$/,
  ulid: /^[0-9A-HJKMNP-TV-Z]{26}$/,
  /**
   * `a-z` was added to replicate /i flag
   */
  email: /^(?!\.)(?!.*\.\.)([a-zA-Z0-9_'+\-\.]*)[a-zA-Z0-9_+-]@([a-zA-Z0-9][a-zA-Z0-9\-]*\.)+[a-zA-Z]{2,}$/,
  /**
   * Constructed a valid Unicode RegExp
   *
   * Lazily instantiate since this type of regex isn't supported
   * in all envs (e.g. React Native).
   *
   * See:
   * https://github.com/colinhacks/zod/issues/2433
   * Fix in Zod:
   * https://github.com/colinhacks/zod/commit/9340fd51e48576a75adc919bff65dbc4a5d4c99b
   */
  emoji: () => {
    if (emojiRegex2 === void 0) {
      emojiRegex2 = RegExp("^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$", "u");
    }
    return emojiRegex2;
  },
  /**
   * Unused
   */
  uuid: /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/,
  /**
   * Unused
   */
  ipv4: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
  ipv4Cidr: /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/,
  /**
   * Unused
   */
  ipv6: /^(([a-f0-9]{1,4}:){7}|::([a-f0-9]{1,4}:){0,6}|([a-f0-9]{1,4}:){1}:([a-f0-9]{1,4}:){0,5}|([a-f0-9]{1,4}:){2}:([a-f0-9]{1,4}:){0,4}|([a-f0-9]{1,4}:){3}:([a-f0-9]{1,4}:){0,3}|([a-f0-9]{1,4}:){4}:([a-f0-9]{1,4}:){0,2}|([a-f0-9]{1,4}:){5}:([a-f0-9]{1,4}:){0,1})([a-f0-9]{1,4}|(((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2}))\.){3}((25[0-5])|(2[0-4][0-9])|(1[0-9]{2})|([0-9]{1,2})))$/,
  ipv6Cidr: /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
  base64: /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/,
  base64url: /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/,
  nanoid: /^[a-zA-Z0-9_-]{21}$/,
  jwt: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/
};
function parseStringDef(def, refs) {
  const res = {
    type: "string"
  };
  if (def.checks) {
    for (const check of def.checks) {
      switch (check.kind) {
        case "min":
          setResponseValueAndErrors(res, "minLength", typeof res.minLength === "number" ? Math.max(res.minLength, check.value) : check.value, check.message, refs);
          break;
        case "max":
          setResponseValueAndErrors(res, "maxLength", typeof res.maxLength === "number" ? Math.min(res.maxLength, check.value) : check.value, check.message, refs);
          break;
        case "email":
          switch (refs.emailStrategy) {
            case "format:email":
              addFormat(res, "email", check.message, refs);
              break;
            case "format:idn-email":
              addFormat(res, "idn-email", check.message, refs);
              break;
            case "pattern:zod":
              addPattern(res, zodPatterns.email, check.message, refs);
              break;
          }
          break;
        case "url":
          addFormat(res, "uri", check.message, refs);
          break;
        case "uuid":
          addFormat(res, "uuid", check.message, refs);
          break;
        case "regex":
          addPattern(res, check.regex, check.message, refs);
          break;
        case "cuid":
          addPattern(res, zodPatterns.cuid, check.message, refs);
          break;
        case "cuid2":
          addPattern(res, zodPatterns.cuid2, check.message, refs);
          break;
        case "startsWith":
          addPattern(res, RegExp(`^${escapeLiteralCheckValue(check.value, refs)}`), check.message, refs);
          break;
        case "endsWith":
          addPattern(res, RegExp(`${escapeLiteralCheckValue(check.value, refs)}$`), check.message, refs);
          break;
        case "datetime":
          addFormat(res, "date-time", check.message, refs);
          break;
        case "date":
          addFormat(res, "date", check.message, refs);
          break;
        case "time":
          addFormat(res, "time", check.message, refs);
          break;
        case "duration":
          addFormat(res, "duration", check.message, refs);
          break;
        case "length":
          setResponseValueAndErrors(res, "minLength", typeof res.minLength === "number" ? Math.max(res.minLength, check.value) : check.value, check.message, refs);
          setResponseValueAndErrors(res, "maxLength", typeof res.maxLength === "number" ? Math.min(res.maxLength, check.value) : check.value, check.message, refs);
          break;
        case "includes": {
          addPattern(res, RegExp(escapeLiteralCheckValue(check.value, refs)), check.message, refs);
          break;
        }
        case "ip": {
          if (check.version !== "v6") {
            addFormat(res, "ipv4", check.message, refs);
          }
          if (check.version !== "v4") {
            addFormat(res, "ipv6", check.message, refs);
          }
          break;
        }
        case "base64url":
          addPattern(res, zodPatterns.base64url, check.message, refs);
          break;
        case "jwt":
          addPattern(res, zodPatterns.jwt, check.message, refs);
          break;
        case "cidr": {
          if (check.version !== "v6") {
            addPattern(res, zodPatterns.ipv4Cidr, check.message, refs);
          }
          if (check.version !== "v4") {
            addPattern(res, zodPatterns.ipv6Cidr, check.message, refs);
          }
          break;
        }
        case "emoji":
          addPattern(res, zodPatterns.emoji(), check.message, refs);
          break;
        case "ulid": {
          addPattern(res, zodPatterns.ulid, check.message, refs);
          break;
        }
        case "base64": {
          switch (refs.base64Strategy) {
            case "format:binary": {
              addFormat(res, "binary", check.message, refs);
              break;
            }
            case "contentEncoding:base64": {
              setResponseValueAndErrors(res, "contentEncoding", "base64", check.message, refs);
              break;
            }
            case "pattern:zod": {
              addPattern(res, zodPatterns.base64, check.message, refs);
              break;
            }
          }
          break;
        }
        case "nanoid": {
          addPattern(res, zodPatterns.nanoid, check.message, refs);
        }
        case "toLowerCase":
        case "toUpperCase":
        case "trim":
          break;
        default:
          /* @__PURE__ */ ((_) => {
          })(check);
      }
    }
  }
  return res;
}
function escapeLiteralCheckValue(literal, refs) {
  return refs.patternStrategy === "escape" ? escapeNonAlphaNumeric(literal) : literal;
}
var ALPHA_NUMERIC = new Set("ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxyz0123456789");
function escapeNonAlphaNumeric(source) {
  let result = "";
  for (let i = 0; i < source.length; i++) {
    if (!ALPHA_NUMERIC.has(source[i])) {
      result += "\\";
    }
    result += source[i];
  }
  return result;
}
function addFormat(schema, value, message, refs) {
  if (schema.format || schema.anyOf?.some((x) => x.format)) {
    if (!schema.anyOf) {
      schema.anyOf = [];
    }
    if (schema.format) {
      schema.anyOf.push({
        format: schema.format,
        ...schema.errorMessage && refs.errorMessages && {
          errorMessage: { format: schema.errorMessage.format }
        }
      });
      delete schema.format;
      if (schema.errorMessage) {
        delete schema.errorMessage.format;
        if (Object.keys(schema.errorMessage).length === 0) {
          delete schema.errorMessage;
        }
      }
    }
    schema.anyOf.push({
      format: value,
      ...message && refs.errorMessages && { errorMessage: { format: message } }
    });
  } else {
    setResponseValueAndErrors(schema, "format", value, message, refs);
  }
}
function addPattern(schema, regex, message, refs) {
  if (schema.pattern || schema.allOf?.some((x) => x.pattern)) {
    if (!schema.allOf) {
      schema.allOf = [];
    }
    if (schema.pattern) {
      schema.allOf.push({
        pattern: schema.pattern,
        ...schema.errorMessage && refs.errorMessages && {
          errorMessage: { pattern: schema.errorMessage.pattern }
        }
      });
      delete schema.pattern;
      if (schema.errorMessage) {
        delete schema.errorMessage.pattern;
        if (Object.keys(schema.errorMessage).length === 0) {
          delete schema.errorMessage;
        }
      }
    }
    schema.allOf.push({
      pattern: stringifyRegExpWithFlags(regex, refs),
      ...message && refs.errorMessages && { errorMessage: { pattern: message } }
    });
  } else {
    setResponseValueAndErrors(schema, "pattern", stringifyRegExpWithFlags(regex, refs), message, refs);
  }
}
function stringifyRegExpWithFlags(regex, refs) {
  if (!refs.applyRegexFlags || !regex.flags) {
    return regex.source;
  }
  const flags = {
    i: regex.flags.includes("i"),
    m: regex.flags.includes("m"),
    s: regex.flags.includes("s")
    // `.` matches newlines
  };
  const source = flags.i ? regex.source.toLowerCase() : regex.source;
  let pattern = "";
  let isEscaped = false;
  let inCharGroup = false;
  let inCharRange = false;
  for (let i = 0; i < source.length; i++) {
    if (isEscaped) {
      pattern += source[i];
      isEscaped = false;
      continue;
    }
    if (flags.i) {
      if (inCharGroup) {
        if (source[i].match(/[a-z]/)) {
          if (inCharRange) {
            pattern += source[i];
            pattern += `${source[i - 2]}-${source[i]}`.toUpperCase();
            inCharRange = false;
          } else if (source[i + 1] === "-" && source[i + 2]?.match(/[a-z]/)) {
            pattern += source[i];
            inCharRange = true;
          } else {
            pattern += `${source[i]}${source[i].toUpperCase()}`;
          }
          continue;
        }
      } else if (source[i].match(/[a-z]/)) {
        pattern += `[${source[i]}${source[i].toUpperCase()}]`;
        continue;
      }
    }
    if (flags.m) {
      if (source[i] === "^") {
        pattern += `(^|(?<=[\r
]))`;
        continue;
      } else if (source[i] === "$") {
        pattern += `($|(?=[\r
]))`;
        continue;
      }
    }
    if (flags.s && source[i] === ".") {
      pattern += inCharGroup ? `${source[i]}\r
` : `[${source[i]}\r
]`;
      continue;
    }
    pattern += source[i];
    if (source[i] === "\\") {
      isEscaped = true;
    } else if (inCharGroup && source[i] === "]") {
      inCharGroup = false;
    } else if (!inCharGroup && source[i] === "[") {
      inCharGroup = true;
    }
  }
  try {
    new RegExp(pattern);
  } catch {
    console.warn(`Could not convert regex pattern at ${refs.currentPath.join("/")} to a flag-independent form! Falling back to the flag-ignorant source`);
    return regex.source;
  }
  return pattern;
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/record.js
function parseRecordDef(def, refs) {
  if (refs.target === "openAi") {
    console.warn("Warning: OpenAI may not support records in schemas! Try an array of key-value pairs instead.");
  }
  if (refs.target === "openApi3" && def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodEnum) {
    return {
      type: "object",
      required: def.keyType._def.values,
      properties: def.keyType._def.values.reduce((acc, key) => ({
        ...acc,
        [key]: parseDef(def.valueType._def, {
          ...refs,
          currentPath: [...refs.currentPath, "properties", key]
        }) ?? parseAnyDef(refs)
      }), {}),
      additionalProperties: refs.rejectedAdditionalProperties
    };
  }
  const schema = {
    type: "object",
    additionalProperties: parseDef(def.valueType._def, {
      ...refs,
      currentPath: [...refs.currentPath, "additionalProperties"]
    }) ?? refs.allowedAdditionalProperties
  };
  if (refs.target === "openApi3") {
    return schema;
  }
  if (def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodString && def.keyType._def.checks?.length) {
    const { type, ...keyType } = parseStringDef(def.keyType._def, refs);
    return {
      ...schema,
      propertyNames: keyType
    };
  } else if (def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodEnum) {
    return {
      ...schema,
      propertyNames: {
        enum: def.keyType._def.values
      }
    };
  } else if (def.keyType?._def.typeName === ZodFirstPartyTypeKind.ZodBranded && def.keyType._def.type._def.typeName === ZodFirstPartyTypeKind.ZodString && def.keyType._def.type._def.checks?.length) {
    const { type, ...keyType } = parseBrandedDef(def.keyType._def, refs);
    return {
      ...schema,
      propertyNames: keyType
    };
  }
  return schema;
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/map.js
function parseMapDef(def, refs) {
  if (refs.mapStrategy === "record") {
    return parseRecordDef(def, refs);
  }
  const keys = parseDef(def.keyType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "items", "items", "0"]
  }) || parseAnyDef(refs);
  const values = parseDef(def.valueType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "items", "items", "1"]
  }) || parseAnyDef(refs);
  return {
    type: "array",
    maxItems: 125,
    items: {
      type: "array",
      items: [keys, values],
      minItems: 2,
      maxItems: 2
    }
  };
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/nativeEnum.js
function parseNativeEnumDef(def) {
  const object = def.values;
  const actualKeys = Object.keys(def.values).filter((key) => {
    return typeof object[object[key]] !== "number";
  });
  const actualValues = actualKeys.map((key) => object[key]);
  const parsedTypes = Array.from(new Set(actualValues.map((values) => typeof values)));
  return {
    type: parsedTypes.length === 1 ? parsedTypes[0] === "string" ? "string" : "number" : ["string", "number"],
    enum: actualValues
  };
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/never.js
function parseNeverDef(refs) {
  return refs.target === "openAi" ? void 0 : {
    not: parseAnyDef({
      ...refs,
      currentPath: [...refs.currentPath, "not"]
    })
  };
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/null.js
function parseNullDef(refs) {
  return refs.target === "openApi3" ? {
    enum: ["null"],
    nullable: true
  } : {
    type: "null"
  };
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/union.js
var primitiveMappings = {
  ZodString: "string",
  ZodNumber: "number",
  ZodBigInt: "integer",
  ZodBoolean: "boolean",
  ZodNull: "null"
};
function parseUnionDef(def, refs) {
  if (refs.target === "openApi3")
    return asAnyOf(def, refs);
  const options = def.options instanceof Map ? Array.from(def.options.values()) : def.options;
  if (options.every((x) => x._def.typeName in primitiveMappings && (!x._def.checks || !x._def.checks.length))) {
    const types = options.reduce((types2, x) => {
      const type = primitiveMappings[x._def.typeName];
      return type && !types2.includes(type) ? [...types2, type] : types2;
    }, []);
    return {
      type: types.length > 1 ? types : types[0]
    };
  } else if (options.every((x) => x._def.typeName === "ZodLiteral" && !x.description)) {
    const types = options.reduce((acc, x) => {
      const type = typeof x._def.value;
      switch (type) {
        case "string":
        case "number":
        case "boolean":
          return [...acc, type];
        case "bigint":
          return [...acc, "integer"];
        case "object":
          if (x._def.value === null)
            return [...acc, "null"];
        case "symbol":
        case "undefined":
        case "function":
        default:
          return acc;
      }
    }, []);
    if (types.length === options.length) {
      const uniqueTypes = types.filter((x, i, a) => a.indexOf(x) === i);
      return {
        type: uniqueTypes.length > 1 ? uniqueTypes : uniqueTypes[0],
        enum: options.reduce((acc, x) => {
          return acc.includes(x._def.value) ? acc : [...acc, x._def.value];
        }, [])
      };
    }
  } else if (options.every((x) => x._def.typeName === "ZodEnum")) {
    return {
      type: "string",
      enum: options.reduce((acc, x) => [
        ...acc,
        ...x._def.values.filter((x2) => !acc.includes(x2))
      ], [])
    };
  }
  return asAnyOf(def, refs);
}
var asAnyOf = (def, refs) => {
  const anyOf = (def.options instanceof Map ? Array.from(def.options.values()) : def.options).map((x, i) => parseDef(x._def, {
    ...refs,
    currentPath: [...refs.currentPath, "anyOf", `${i}`]
  })).filter((x) => !!x && (!refs.strictUnions || typeof x === "object" && Object.keys(x).length > 0));
  return anyOf.length ? { anyOf } : void 0;
};

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/nullable.js
function parseNullableDef(def, refs) {
  if (["ZodString", "ZodNumber", "ZodBigInt", "ZodBoolean", "ZodNull"].includes(def.innerType._def.typeName) && (!def.innerType._def.checks || !def.innerType._def.checks.length)) {
    if (refs.target === "openApi3") {
      return {
        type: primitiveMappings[def.innerType._def.typeName],
        nullable: true
      };
    }
    return {
      type: [
        primitiveMappings[def.innerType._def.typeName],
        "null"
      ]
    };
  }
  if (refs.target === "openApi3") {
    const base2 = parseDef(def.innerType._def, {
      ...refs,
      currentPath: [...refs.currentPath]
    });
    if (base2 && "$ref" in base2)
      return { allOf: [base2], nullable: true };
    return base2 && { ...base2, nullable: true };
  }
  const base = parseDef(def.innerType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "anyOf", "0"]
  });
  return base && { anyOf: [base, { type: "null" }] };
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/number.js
function parseNumberDef(def, refs) {
  const res = {
    type: "number"
  };
  if (!def.checks)
    return res;
  for (const check of def.checks) {
    switch (check.kind) {
      case "int":
        res.type = "integer";
        addErrorMessage(res, "type", check.message, refs);
        break;
      case "min":
        if (refs.target === "jsonSchema7") {
          if (check.inclusive) {
            setResponseValueAndErrors(res, "minimum", check.value, check.message, refs);
          } else {
            setResponseValueAndErrors(res, "exclusiveMinimum", check.value, check.message, refs);
          }
        } else {
          if (!check.inclusive) {
            res.exclusiveMinimum = true;
          }
          setResponseValueAndErrors(res, "minimum", check.value, check.message, refs);
        }
        break;
      case "max":
        if (refs.target === "jsonSchema7") {
          if (check.inclusive) {
            setResponseValueAndErrors(res, "maximum", check.value, check.message, refs);
          } else {
            setResponseValueAndErrors(res, "exclusiveMaximum", check.value, check.message, refs);
          }
        } else {
          if (!check.inclusive) {
            res.exclusiveMaximum = true;
          }
          setResponseValueAndErrors(res, "maximum", check.value, check.message, refs);
        }
        break;
      case "multipleOf":
        setResponseValueAndErrors(res, "multipleOf", check.value, check.message, refs);
        break;
    }
  }
  return res;
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/object.js
function parseObjectDef(def, refs) {
  const forceOptionalIntoNullable = refs.target === "openAi";
  const result = {
    type: "object",
    properties: {}
  };
  const required = [];
  const shape = def.shape();
  for (const propName in shape) {
    let propDef = shape[propName];
    if (propDef === void 0 || propDef._def === void 0) {
      continue;
    }
    let propOptional = safeIsOptional(propDef);
    if (propOptional && forceOptionalIntoNullable) {
      if (propDef._def.typeName === "ZodOptional") {
        propDef = propDef._def.innerType;
      }
      if (!propDef.isNullable()) {
        propDef = propDef.nullable();
      }
      propOptional = false;
    }
    const parsedDef = parseDef(propDef._def, {
      ...refs,
      currentPath: [...refs.currentPath, "properties", propName],
      propertyPath: [...refs.currentPath, "properties", propName]
    });
    if (parsedDef === void 0) {
      continue;
    }
    result.properties[propName] = parsedDef;
    if (!propOptional) {
      required.push(propName);
    }
  }
  if (required.length) {
    result.required = required;
  }
  const additionalProperties = decideAdditionalProperties(def, refs);
  if (additionalProperties !== void 0) {
    result.additionalProperties = additionalProperties;
  }
  return result;
}
function decideAdditionalProperties(def, refs) {
  if (def.catchall._def.typeName !== "ZodNever") {
    return parseDef(def.catchall._def, {
      ...refs,
      currentPath: [...refs.currentPath, "additionalProperties"]
    });
  }
  switch (def.unknownKeys) {
    case "passthrough":
      return refs.allowedAdditionalProperties;
    case "strict":
      return refs.rejectedAdditionalProperties;
    case "strip":
      return refs.removeAdditionalStrategy === "strict" ? refs.allowedAdditionalProperties : refs.rejectedAdditionalProperties;
  }
}
function safeIsOptional(schema) {
  try {
    return schema.isOptional();
  } catch {
    return true;
  }
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/optional.js
var parseOptionalDef = (def, refs) => {
  if (refs.currentPath.toString() === refs.propertyPath?.toString()) {
    return parseDef(def.innerType._def, refs);
  }
  const innerSchema = parseDef(def.innerType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "anyOf", "1"]
  });
  return innerSchema ? {
    anyOf: [
      {
        not: parseAnyDef(refs)
      },
      innerSchema
    ]
  } : parseAnyDef(refs);
};

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/pipeline.js
var parsePipelineDef = (def, refs) => {
  if (refs.pipeStrategy === "input") {
    return parseDef(def.in._def, refs);
  } else if (refs.pipeStrategy === "output") {
    return parseDef(def.out._def, refs);
  }
  const a = parseDef(def.in._def, {
    ...refs,
    currentPath: [...refs.currentPath, "allOf", "0"]
  });
  const b = parseDef(def.out._def, {
    ...refs,
    currentPath: [...refs.currentPath, "allOf", a ? "1" : "0"]
  });
  return {
    allOf: [a, b].filter((x) => x !== void 0)
  };
};

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/promise.js
function parsePromiseDef(def, refs) {
  return parseDef(def.type._def, refs);
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/set.js
function parseSetDef(def, refs) {
  const items = parseDef(def.valueType._def, {
    ...refs,
    currentPath: [...refs.currentPath, "items"]
  });
  const schema = {
    type: "array",
    uniqueItems: true,
    items
  };
  if (def.minSize) {
    setResponseValueAndErrors(schema, "minItems", def.minSize.value, def.minSize.message, refs);
  }
  if (def.maxSize) {
    setResponseValueAndErrors(schema, "maxItems", def.maxSize.value, def.maxSize.message, refs);
  }
  return schema;
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/tuple.js
function parseTupleDef(def, refs) {
  if (def.rest) {
    return {
      type: "array",
      minItems: def.items.length,
      items: def.items.map((x, i) => parseDef(x._def, {
        ...refs,
        currentPath: [...refs.currentPath, "items", `${i}`]
      })).reduce((acc, x) => x === void 0 ? acc : [...acc, x], []),
      additionalItems: parseDef(def.rest._def, {
        ...refs,
        currentPath: [...refs.currentPath, "additionalItems"]
      })
    };
  } else {
    return {
      type: "array",
      minItems: def.items.length,
      maxItems: def.items.length,
      items: def.items.map((x, i) => parseDef(x._def, {
        ...refs,
        currentPath: [...refs.currentPath, "items", `${i}`]
      })).reduce((acc, x) => x === void 0 ? acc : [...acc, x], [])
    };
  }
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/undefined.js
function parseUndefinedDef(refs) {
  return {
    not: parseAnyDef(refs)
  };
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/unknown.js
function parseUnknownDef(refs) {
  return parseAnyDef(refs);
}

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parsers/readonly.js
var parseReadonlyDef = (def, refs) => {
  return parseDef(def.innerType._def, refs);
};

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/selectParser.js
var selectParser = (def, typeName, refs) => {
  switch (typeName) {
    case ZodFirstPartyTypeKind.ZodString:
      return parseStringDef(def, refs);
    case ZodFirstPartyTypeKind.ZodNumber:
      return parseNumberDef(def, refs);
    case ZodFirstPartyTypeKind.ZodObject:
      return parseObjectDef(def, refs);
    case ZodFirstPartyTypeKind.ZodBigInt:
      return parseBigintDef(def, refs);
    case ZodFirstPartyTypeKind.ZodBoolean:
      return parseBooleanDef();
    case ZodFirstPartyTypeKind.ZodDate:
      return parseDateDef(def, refs);
    case ZodFirstPartyTypeKind.ZodUndefined:
      return parseUndefinedDef(refs);
    case ZodFirstPartyTypeKind.ZodNull:
      return parseNullDef(refs);
    case ZodFirstPartyTypeKind.ZodArray:
      return parseArrayDef(def, refs);
    case ZodFirstPartyTypeKind.ZodUnion:
    case ZodFirstPartyTypeKind.ZodDiscriminatedUnion:
      return parseUnionDef(def, refs);
    case ZodFirstPartyTypeKind.ZodIntersection:
      return parseIntersectionDef(def, refs);
    case ZodFirstPartyTypeKind.ZodTuple:
      return parseTupleDef(def, refs);
    case ZodFirstPartyTypeKind.ZodRecord:
      return parseRecordDef(def, refs);
    case ZodFirstPartyTypeKind.ZodLiteral:
      return parseLiteralDef(def, refs);
    case ZodFirstPartyTypeKind.ZodEnum:
      return parseEnumDef(def);
    case ZodFirstPartyTypeKind.ZodNativeEnum:
      return parseNativeEnumDef(def);
    case ZodFirstPartyTypeKind.ZodNullable:
      return parseNullableDef(def, refs);
    case ZodFirstPartyTypeKind.ZodOptional:
      return parseOptionalDef(def, refs);
    case ZodFirstPartyTypeKind.ZodMap:
      return parseMapDef(def, refs);
    case ZodFirstPartyTypeKind.ZodSet:
      return parseSetDef(def, refs);
    case ZodFirstPartyTypeKind.ZodLazy:
      return () => def.getter()._def;
    case ZodFirstPartyTypeKind.ZodPromise:
      return parsePromiseDef(def, refs);
    case ZodFirstPartyTypeKind.ZodNaN:
    case ZodFirstPartyTypeKind.ZodNever:
      return parseNeverDef(refs);
    case ZodFirstPartyTypeKind.ZodEffects:
      return parseEffectsDef(def, refs);
    case ZodFirstPartyTypeKind.ZodAny:
      return parseAnyDef(refs);
    case ZodFirstPartyTypeKind.ZodUnknown:
      return parseUnknownDef(refs);
    case ZodFirstPartyTypeKind.ZodDefault:
      return parseDefaultDef(def, refs);
    case ZodFirstPartyTypeKind.ZodBranded:
      return parseBrandedDef(def, refs);
    case ZodFirstPartyTypeKind.ZodReadonly:
      return parseReadonlyDef(def, refs);
    case ZodFirstPartyTypeKind.ZodCatch:
      return parseCatchDef(def, refs);
    case ZodFirstPartyTypeKind.ZodPipeline:
      return parsePipelineDef(def, refs);
    case ZodFirstPartyTypeKind.ZodFunction:
    case ZodFirstPartyTypeKind.ZodVoid:
    case ZodFirstPartyTypeKind.ZodSymbol:
      return void 0;
    default:
      return /* @__PURE__ */ ((_) => void 0)(typeName);
  }
};

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/parseDef.js
function parseDef(def, refs, forceResolution = false) {
  const seenItem = refs.seen.get(def);
  if (refs.override) {
    const overrideResult = refs.override?.(def, refs, seenItem, forceResolution);
    if (overrideResult !== ignoreOverride) {
      return overrideResult;
    }
  }
  if (seenItem && !forceResolution) {
    const seenSchema = get$ref(seenItem, refs);
    if (seenSchema !== void 0) {
      return seenSchema;
    }
  }
  const newItem = { def, path: refs.currentPath, jsonSchema: void 0 };
  refs.seen.set(def, newItem);
  const jsonSchemaOrGetter = selectParser(def, def.typeName, refs);
  const jsonSchema = typeof jsonSchemaOrGetter === "function" ? parseDef(jsonSchemaOrGetter(), refs) : jsonSchemaOrGetter;
  if (jsonSchema) {
    addMeta(def, refs, jsonSchema);
  }
  if (refs.postProcess) {
    const postProcessResult = refs.postProcess(jsonSchema, def, refs);
    newItem.jsonSchema = jsonSchema;
    return postProcessResult;
  }
  newItem.jsonSchema = jsonSchema;
  return jsonSchema;
}
var get$ref = (item, refs) => {
  switch (refs.$refStrategy) {
    case "root":
      return { $ref: item.path.join("/") };
    case "relative":
      return { $ref: getRelativePath(refs.currentPath, item.path) };
    case "none":
    case "seen": {
      if (item.path.length < refs.currentPath.length && item.path.every((value, index) => refs.currentPath[index] === value)) {
        console.warn(`Recursive reference detected at ${refs.currentPath.join("/")}! Defaulting to any`);
        return parseAnyDef(refs);
      }
      return refs.$refStrategy === "seen" ? parseAnyDef(refs) : void 0;
    }
  }
};
var addMeta = (def, refs, jsonSchema) => {
  if (def.description) {
    jsonSchema.description = def.description;
    if (refs.markdownDescription) {
      jsonSchema.markdownDescription = def.description;
    }
  }
  return jsonSchema;
};

// ../../node_modules/.pnpm/zod-to-json-schema@3.24.6_zod@3.24.4/node_modules/zod-to-json-schema/dist/esm/zodToJsonSchema.js
var zodToJsonSchema = (schema, options) => {
  const refs = getRefs(options);
  let definitions = typeof options === "object" && options.definitions ? Object.entries(options.definitions).reduce((acc, [name2, schema2]) => ({
    ...acc,
    [name2]: parseDef(schema2._def, {
      ...refs,
      currentPath: [...refs.basePath, refs.definitionPath, name2]
    }, true) ?? parseAnyDef(refs)
  }), {}) : void 0;
  const name = typeof options === "string" ? options : options?.nameStrategy === "title" ? void 0 : options?.name;
  const main = parseDef(schema._def, name === void 0 ? refs : {
    ...refs,
    currentPath: [...refs.basePath, refs.definitionPath, name]
  }, false) ?? parseAnyDef(refs);
  const title = typeof options === "object" && options.name !== void 0 && options.nameStrategy === "title" ? options.name : void 0;
  if (title !== void 0) {
    main.title = title;
  }
  if (refs.flags.hasReferencedOpenAiAnyType) {
    if (!definitions) {
      definitions = {};
    }
    if (!definitions[refs.openAiAnyTypeName]) {
      definitions[refs.openAiAnyTypeName] = {
        // Skipping "object" as no properties can be defined and additionalProperties must be "false"
        type: ["string", "number", "integer", "boolean", "array", "null"],
        items: {
          $ref: refs.$refStrategy === "relative" ? "1" : [
            ...refs.basePath,
            refs.definitionPath,
            refs.openAiAnyTypeName
          ].join("/")
        }
      };
    }
  }
  const combined = name === void 0 ? definitions ? {
    ...main,
    [refs.definitionPath]: definitions
  } : main : {
    $ref: [
      ...refs.$refStrategy === "relative" ? [] : refs.basePath,
      refs.definitionPath,
      name
    ].join("/"),
    [refs.definitionPath]: {
      ...definitions,
      [name]: main
    }
  };
  if (refs.target === "jsonSchema7") {
    combined.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (refs.target === "jsonSchema2019-09" || refs.target === "openAi") {
    combined.$schema = "https://json-schema.org/draft/2019-09/schema#";
  }
  if (refs.target === "openAi" && ("anyOf" in combined || "oneOf" in combined || "allOf" in combined || "type" in combined && Array.isArray(combined.type))) {
    console.warn("Warning: OpenAI may not support schemas with unions as roots! Try wrapping it in an object property.");
  }
  return combined;
};

// ../../packages/shared-types/dist/chunk-RUA5QFGJ.js
var TIMELINE_KEYFRAME_INTERPOLATIONS = ["hold", "linear"];
var DEFAULT_TIMELINE_KEYFRAME_INTERPOLATION = "linear";
var TIMELINE_KEYFRAME_SAMPLING_POLICY = Object.freeze({
  frameSpace: "item-local",
  interpolationOwner: "left-keyframe",
  beforeFirstKeyframe: "use-first-keyframe-value",
  afterLastKeyframe: "use-last-keyframe-value",
  emptyChannelFallback: "matching-static-field",
  storageOrder: "ascending-frame-recommended-runtime-sorts"
});
var TIMELINE_MASK_SHAPE_ANNOTATIONS = {
  rectangle: {
    label: "Rectangle",
    renderPrimitive: "rectangle"
  },
  ellipse: {
    label: "Ellipse",
    renderPrimitive: "ellipse"
  }
};
var TIMELINE_MASK_SHAPES = Object.freeze(
  Object.keys(TIMELINE_MASK_SHAPE_ANNOTATIONS)
);
var TIMELINE_MASK_FEATHER_BLUR_DIVISOR = 600;
function defineTimelineMaskField(annotation2) {
  return {
    ...annotation2,
    schema: annotation2.schema.describe(annotation2.description)
  };
}
var FiniteMaskVectorSchema = z.tuple([
  z.number().finite(),
  z.number().finite()
]);
var NonNegativeMaskVectorSchema = z.tuple([
  z.number().finite().nonnegative(),
  z.number().finite().nonnegative()
]);
var TIMELINE_MASK_FIELD_ANNOTATIONS = {
  shape: defineTimelineMaskField({
    schema: z.enum(TIMELINE_MASK_SHAPES),
    defaultValue: "rectangle",
    exampleValue: "ellipse",
    unit: `enum:${TIMELINE_MASK_SHAPES.join("|")}`,
    description: "Mask primitive. Shape changes are static; they are not keyframe channels.",
    invalidValueDescription: `must be ${TIMELINE_MASK_SHAPES.join(" or ")}`,
    staticControl: {
      kind: "select",
      label: "Shape",
      ariaLabel: "Mask shape",
      options: TIMELINE_MASK_SHAPE_ANNOTATIONS
    }
  }),
  position: defineTimelineMaskField({
    schema: FiniteMaskVectorSchema,
    defaultValue: [50, 50],
    unit: "percent-of-rendered-item-bounds",
    description: "Clip-local [x, y] center in percent of the rendered item bounds; values outside 0..100 move the mask beyond the clip.",
    invalidValueDescription: "must be a finite [x, y] tuple",
    animation: {
      channel: "maskPosition",
      valueKind: "vector",
      label: "Mask position",
      axisLabels: ["X", "Y"],
      axisAriaLabels: ["Mask center X percent", "Mask center Y percent"],
      axisInputs: [{ step: 1 }, { step: 1 }],
      exampleValues: [[30, 50], [70, 50]]
    }
  }),
  size: defineTimelineMaskField({
    schema: NonNegativeMaskVectorSchema,
    defaultValue: [70, 70],
    unit: "percent-of-rendered-item-bounds",
    description: "Clip-local [width, height] in percent of the rendered item bounds.",
    invalidValueDescription: "must be a non-negative finite [width, height] tuple",
    animation: {
      channel: "maskSize",
      valueKind: "vector",
      label: "Mask size",
      axisLabels: ["W", "H"],
      axisAriaLabels: ["Mask width percent", "Mask height percent"],
      axisInputs: [{ step: 1, min: 0 }, { step: 1, min: 0 }],
      exampleValues: [[70, 70], [35, 35]]
    }
  }),
  rotation: defineTimelineMaskField({
    schema: z.number().finite(),
    defaultValue: 0,
    unit: "degrees",
    description: "Clockwise mask rotation in degrees.",
    invalidValueDescription: "must be finite",
    animation: {
      channel: "maskRotation",
      valueKind: "scalar",
      label: "Mask rotation",
      ariaLabel: "Mask rotation in degrees",
      input: { step: 1 },
      exampleValues: [0, 25]
    }
  }),
  feather: defineTimelineMaskField({
    schema: z.number().finite().min(0).max(100),
    defaultValue: 0,
    exampleValue: 8,
    unit: "amount-0..100",
    description: "Edge feather amount from 0 through 100, mapped proportionally to the shorter rendered mask dimension.",
    invalidValueDescription: "must be between 0 and 100",
    animation: {
      channel: "maskFeather",
      valueKind: "scalar",
      label: "Mask feather",
      ariaLabel: "Mask feather percent",
      input: { step: 1, min: 0, max: 100 },
      exampleValues: [0, 30]
    }
  }),
  inverted: defineTimelineMaskField({
    schema: z.boolean(),
    defaultValue: false,
    unit: "boolean",
    description: "False reveals the mask interior; true reveals the exterior. Inversion is static, not keyframed.",
    invalidValueDescription: "must be boolean",
    staticControl: {
      kind: "toggle",
      label: "Invert",
      ariaLabel: "Invert mask"
    }
  })
};
var timelineMaskSchemaShape = Object.fromEntries(
  Object.entries(TIMELINE_MASK_FIELD_ANNOTATIONS).map(([field2, annotation2]) => [
    field2,
    annotation2.schema
  ])
);
var TimelineItemMaskSchema = z.object(timelineMaskSchemaShape).strict().describe("TimelineItemMask");
var TIMELINE_MASK_FIELDS = Object.freeze(
  Object.keys(TIMELINE_MASK_FIELD_ANNOTATIONS)
);
var TIMELINE_MASK_ANIMATION_BINDINGS = Object.freeze(
  Object.entries(TIMELINE_MASK_FIELD_ANNOTATIONS).flatMap(([field2, annotation2]) => "animation" in annotation2 && annotation2.animation ? [{
    field: field2,
    valueSchema: annotation2.schema,
    ...annotation2.animation
  }] : [])
);
var TIMELINE_MASK_VECTOR_ANIMATION_BINDINGS = Object.freeze(
  TIMELINE_MASK_ANIMATION_BINDINGS.filter(
    (binding) => binding.valueKind === "vector"
  )
);
var TIMELINE_MASK_SCALAR_ANIMATION_BINDINGS = Object.freeze(
  TIMELINE_MASK_ANIMATION_BINDINGS.filter(
    (binding) => binding.valueKind === "scalar"
  )
);
var TIMELINE_MASK_STATIC_CONTROL_BINDINGS = Object.freeze(
  Object.entries(TIMELINE_MASK_FIELD_ANNOTATIONS).flatMap(([field2, annotation2]) => "staticControl" in annotation2 && annotation2.staticControl ? [{
    field: field2,
    control: annotation2.staticControl
  }] : [])
);
var TIMELINE_MASK_KEYFRAME_CHANNELS = Object.freeze(
  TIMELINE_MASK_ANIMATION_BINDINGS.map(({ channel }) => channel)
);
var DEFAULT_TIMELINE_ITEM_MASK = Object.freeze(
  Object.fromEntries(
    Object.entries(TIMELINE_MASK_FIELD_ANNOTATIONS).map(([field2, annotation2]) => [
      field2,
      annotation2.defaultValue
    ])
  )
);
var TIMELINE_MASK_APPLIES_TO_ITEM_TYPES = Object.freeze([
  "video",
  "image",
  "solid",
  "text",
  "sticker",
  "composition",
  "derived-overlay"
]);
var TIMELINE_MASK_EXCLUDED_ITEM_TYPES = Object.freeze([
  "audio",
  "transition"
]);
var TIMELINE_MASK_CAPABILITY_ANNOTATION = {
  id: "clipMask",
  yamlPath: "tracks[].items[]",
  appliesToItemTypes: TIMELINE_MASK_APPLIES_TO_ITEM_TYPES,
  excludedItemTypes: TIMELINE_MASK_EXCLUDED_ITEM_TYPES,
  fields: TIMELINE_MASK_FIELD_ANNOTATIONS,
  staticFields: TIMELINE_MASK_FIELDS,
  animatedChannels: TIMELINE_MASK_KEYFRAME_CHANNELS,
  defaultMask: DEFAULT_TIMELINE_ITEM_MASK,
  featherBlurDivisor: TIMELINE_MASK_FEATHER_BLUR_DIVISOR,
  semantics: {
    geometryUnits: TIMELINE_MASK_FIELD_ANNOTATIONS.position.unit,
    rotationUnit: TIMELINE_MASK_FIELD_ANNOTATIONS.rotation.unit,
    featherRange: [
      TIMELINE_MASK_FIELD_ANNOTATIONS.feather.animation.input.min,
      TIMELINE_MASK_FIELD_ANNOTATIONS.feather.animation.input.max
    ],
    frameSpace: TIMELINE_KEYFRAME_SAMPLING_POLICY.frameSpace,
    validFrameRange: "0..durationInFrames-1",
    interpolation: TIMELINE_KEYFRAME_INTERPOLATIONS,
    interpolationOwner: TIMELINE_KEYFRAME_SAMPLING_POLICY.interpolationOwner,
    defaultNewKeyframeInterpolation: DEFAULT_TIMELINE_KEYFRAME_INTERPOLATION,
    beforeFirstKeyframe: TIMELINE_KEYFRAME_SAMPLING_POLICY.beforeFirstKeyframe,
    afterLastKeyframe: TIMELINE_KEYFRAME_SAMPLING_POLICY.afterLastKeyframe,
    emptyChannelFallback: "matching-item.mask-field",
    duplicateFrames: "rejected-per-channel",
    keyframeStorageOrder: TIMELINE_KEYFRAME_SAMPLING_POLICY.storageOrder,
    positiveRotation: "clockwise",
    featherModel: `blur-stddev=min(rendered-mask-width,rendered-mask-height)*feather/${TIMELINE_MASK_FEATHER_BLUR_DIVISOR}`,
    staticOnlyFields: TIMELINE_MASK_STATIC_CONTROL_BINDINGS.map(({ field: field2 }) => field2),
    requiresStaticMask: true,
    fallback: "Each animated mask channel falls back to the matching item.mask field when the channel is absent or empty."
  },
  operations: {
    addOrReplaceMask: `write all ${TIMELINE_MASK_FIELDS.length} item.mask fields`,
    updateStaticFallback: "edit the matching item.mask field",
    removeMask: "omit item.mask and remove every mask* keyframe channel",
    upsertKeyframe: "replace the entry at the same item-local frame or insert a sorted entry",
    setKeyframeInterpolation: "replace the current keyframe interpolation with hold or linear",
    removeKeyframe: "remove the entry and omit the channel when it becomes empty"
  },
  runtimeBehavior: {
    previewExportParity: true,
    timelineMarkers: "derived-from-mask-keyframe-channels",
    undoRedoPersistence: "editor-history-not-a-dsl-field",
    moveKeyframePolicy: "preserve-item-local-frames",
    trimSplitRippleKeyframePolicy: "sample-new-boundaries-then-slice-and-shift-item-local-keys",
    transitionSampling: "referenced-item-local",
    maskedClipMergePolicy: "never-merge-contiguous-items"
  }
};
var FiniteVectorSchema = z.tuple([z.number().finite(), z.number().finite()]);
var NonNegativeVectorSchema = z.tuple([
  z.number().finite().nonnegative(),
  z.number().finite().nonnegative()
]);
var TIMELINE_TRANSFORM_KEYFRAME_ANNOTATIONS = {
  position: {
    valueKind: "vector",
    valueSchema: FiniteVectorSchema,
    description: "Item transform position [x, y] in rendered pixels.",
    source: "transform"
  },
  scale: {
    valueKind: "vector",
    valueSchema: NonNegativeVectorSchema,
    description: "Item transform scale [x, y] as non-negative multipliers.",
    source: "transform"
  },
  rotation: {
    valueKind: "scalar",
    valueSchema: z.number().finite(),
    description: "Item transform rotation in degrees.",
    source: "transform"
  },
  opacity: {
    valueKind: "scalar",
    valueSchema: z.number().finite().min(0).max(1),
    description: "Item opacity from 0 through 1.",
    source: "transform"
  }
};
var timelineMaskKeyframeAnnotations = Object.fromEntries(
  TIMELINE_MASK_ANIMATION_BINDINGS.map((binding) => [
    binding.channel,
    {
      valueKind: binding.valueKind,
      valueSchema: binding.valueSchema,
      description: `${binding.label} animated in ${binding.field === "position" || binding.field === "size" ? "percent of the rendered item bounds" : binding.field === "rotation" ? "clockwise degrees" : "the 0 through 100 feather range"}.`,
      source: "mask",
      maskField: binding.field
    }
  ])
);
var TIMELINE_KEYFRAME_CHANNEL_ANNOTATIONS = Object.freeze({
  ...TIMELINE_TRANSFORM_KEYFRAME_ANNOTATIONS,
  ...timelineMaskKeyframeAnnotations
});
var TIMELINE_KEYFRAME_CHANNELS = Object.freeze(
  Object.keys(TIMELINE_KEYFRAME_CHANNEL_ANNOTATIONS)
);
var TimelineKeyframeInterpolationSchema = z.enum(TIMELINE_KEYFRAME_INTERPOLATIONS).describe("Interpolation from this keyframe to the next keyframe.");
var TimelineKeyframeFrameSchema = z.number().int().nonnegative().describe("item-local frame. It must be less than the owning item's durationInFrames.");
function timelineKeyframeSchema(valueSchema) {
  return z.object({
    frame: TimelineKeyframeFrameSchema,
    value: valueSchema,
    interpolation: TimelineKeyframeInterpolationSchema
  }).strict();
}
var TimelineVectorKeyframeSchema = timelineKeyframeSchema(
  FiniteVectorSchema
);
var TimelineScalarKeyframeSchema = timelineKeyframeSchema(
  z.number().finite()
);
var timelineItemKeyframesSchemaShape = Object.fromEntries(
  Object.entries(TIMELINE_KEYFRAME_CHANNEL_ANNOTATIONS).map(([channel, annotation2]) => [
    channel,
    z.array(timelineKeyframeSchema(annotation2.valueSchema)).describe(annotation2.description).optional()
  ])
);
var TimelineItemKeyframesSchema = z.object(timelineItemKeyframesSchemaShape).strict().describe("TimelineItemKeyframes");
function timelineKeyframeFrameIssues(keyframes, durationInFrames) {
  const issues = [];
  for (const channel of TIMELINE_KEYFRAME_CHANNELS) {
    const entries = keyframes?.[channel];
    if (!entries) continue;
    const seenFrames = /* @__PURE__ */ new Set();
    entries.forEach((keyframe, index) => {
      if (!Number.isInteger(keyframe.frame) || keyframe.frame < 0 || keyframe.frame >= durationInFrames) {
        issues.push({ channel, index, frame: keyframe.frame, reason: "range" });
      } else if (seenFrames.has(keyframe.frame)) {
        issues.push({ channel, index, frame: keyframe.frame, reason: "duplicate" });
      }
      if (typeof keyframe.frame === "number") seenFrames.add(keyframe.frame);
    });
  }
  return issues;
}
var TIMELINE_DSL_RUNTIME_CONSUMERS = [
  "asset-loader",
  "audio-ducking",
  "audio-mix",
  "canvas-link",
  "caption-export",
  "caption-generation",
  "composition-runtime",
  "derivation",
  "editor",
  "effect-runtime",
  "export",
  "future-renderer",
  "migration",
  "persistence",
  "preview",
  "render",
  "timeline-semantics",
  "transcript",
  "yaml"
];
function timelineDslAnnotatedObjectShape(fields, options = {}) {
  const requiredness = options.requiredness ?? "authored";
  return Object.fromEntries(
    Object.entries(fields).map(([name, annotation2]) => {
      const executable = options.overrides?.[name] ?? annotation2.schema.describe(annotation2.description);
      const required = requiredness === "runtime" ? annotation2.required : requiredness === "authored" ? annotation2.authoredRequired : false;
      return [name, required ? executable : executable.optional()];
    })
  );
}
function field(schema, description, options) {
  return {
    schema,
    description,
    ...options,
    authoredRequired: options.authoredRequired ?? options.required
  };
}
var authored = (schema, description, options) => field(schema, description, { ...options, authored: true });
var derived = (schema, description, options) => field(schema, description, { ...options, authored: false });
var TIMELINE_DSL_ITEM_TYPES = [
  "video",
  "audio",
  "image",
  "solid",
  "text",
  "sticker",
  "composition",
  "derived-overlay",
  "transition"
];
var TIMELINE_DSL_TRACK_CATEGORIES = [
  "effect",
  "text",
  "visual",
  "primary",
  "audio"
];
var TIMELINE_DSL_TRACK_ROLES = [
  "primary-video",
  "b-roll",
  "overlay",
  "subtitle",
  "narration",
  "dialogue",
  "music",
  "sfx",
  "transition",
  "mixed"
];
var TIMELINE_DSL_CATEGORY_ALLOWED_ITEM_TYPES = {
  effect: ["composition", "transition"],
  text: ["text"],
  visual: ["video", "image", "solid", "sticker", "composition", "derived-overlay"],
  primary: ["video", "image", "solid"],
  audio: ["audio"]
};
var TIMELINE_DSL_ROLE_ALLOWED_ITEM_TYPES = {
  "primary-video": ["video", "image", "solid"],
  "b-roll": ["video", "image", "solid"],
  overlay: ["video", "image", "solid", "text", "sticker", "composition", "derived-overlay"],
  subtitle: ["text"],
  narration: ["audio", "video"],
  dialogue: ["audio", "video"],
  music: ["audio"],
  sfx: ["audio"],
  transition: ["transition"],
  mixed: TIMELINE_DSL_ITEM_TYPES
};
var TIMELINE_DSL_ROLE_CATEGORIES = {
  "primary-video": "primary",
  "b-roll": "visual",
  overlay: "visual",
  subtitle: "text",
  narration: "audio",
  dialogue: "audio",
  music: "audio",
  sfx: "audio",
  transition: "effect",
  mixed: null
};
var TIMELINE_MEDIA_FITS = ["fill", "cover", "contain"];
var TIMELINE_TEXT_ALIGNMENTS = ["left", "center", "right"];
var TIMELINE_CAPTION_POSITIONS = ["bottom", "top", "center"];
var TIMELINE_CLIP_ANIMATION_TYPES = [
  "fade",
  "zoom-in",
  "zoom-out",
  "slide-left",
  "slide-right",
  "slide-up",
  "slide-down"
];
var TIMELINE_COMPOSITION_KINDS = ["motion-graphics", "custom"];
var TIMELINE_COMPOSITION_RUNTIMES = ["html", "react", "remotion"];
var TIMELINE_DERIVED_MEDIA_TYPES = ["image", "video"];
var TIMELINE_DERIVATION_KINDS = [
  "trim",
  "crop",
  "caption-burn",
  "transcode",
  "other"
];
var TIMELINE_TRANSITION_TYPES = [
  "crossfade",
  "push-left",
  "push-right",
  "slide-up",
  "slide-down",
  "wipe-left",
  "wipe-right",
  "circle-wipe",
  "zoom-in"
];
var NonEmptyStringSchema = z.string().min(1);
var FiniteNumberSchema = z.number().finite();
var NonnegativeFrameSchema = z.number().int().nonnegative();
var PositiveFrameSchema = z.number().int().positive();
var CssColorSchema = z.string().min(1);
var TIMELINE_ITEM_TRANSFORM_SEMANTICS = {
  position: {
    fields: ["properties.x", "properties.y"],
    unit: "composition-pixels",
    origin: "composition-center"
  },
  staticSize: {
    fields: ["properties.width", "properties.height"],
    unit: "unitless-source-size-multiplier",
    outputPixels: false,
    defaults: { width: 1, height: 1 },
    oneByOneBehavior: "contain-fit-within-composition"
  },
  animatedScale: {
    field: "keyframes.scale",
    unit: "unitless-multiplier-of-static-size"
  }
};
var TimelineItemPropertiesSchema = z.object({
  x: FiniteNumberSchema.describe(
    "Horizontal center offset in composition pixels; 0 is the composition center."
  ),
  y: FiniteNumberSchema.describe(
    "Vertical center offset in composition pixels; 0 is the composition center."
  ),
  width: FiniteNumberSchema.describe(
    "Unitless multiplier of resolved source natural width; not output pixels. When width and height are both 1, the renderer contain-fits the source within the composition."
  ),
  height: FiniteNumberSchema.describe(
    "Unitless multiplier of resolved source natural height; not output pixels. When width and height are both 1, the renderer contain-fits the source within the composition."
  ),
  rotation: FiniteNumberSchema.describe("Clockwise rotation in degrees.").optional(),
  opacity: z.number().finite().min(0).max(1).describe("Unitless opacity from 0 through 1.").optional()
});
var TimelineEffectParamValueSchema = z.union([
  z.string(),
  FiniteNumberSchema,
  z.boolean(),
  z.tuple([FiniteNumberSchema, FiniteNumberSchema])
]);
var TimelineEffectInstanceRefSchema = z.object({
  effectId: z.string().regex(/^[a-z0-9]+(?:[._/-][a-z0-9]+)+$/),
  effectVersion: z.number().int().positive(),
  params: z.record(TimelineEffectParamValueSchema).optional()
});
var TimelineMediaFitSchema = z.enum(TIMELINE_MEDIA_FITS);
var TimelineClipAnimationSchema = z.object({
  type: z.enum(TIMELINE_CLIP_ANIMATION_TYPES),
  durationInFrames: PositiveFrameSchema
});
var TimelineAudioDuckingSchema = z.object({
  amountDb: z.number().finite().min(-60).max(0),
  attackFrames: NonnegativeFrameSchema,
  releaseFrames: NonnegativeFrameSchema
});
var TimelineCaptionCueSchema = z.object({
  id: NonEmptyStringSchema,
  startFrame: NonnegativeFrameSchema,
  durationInFrames: PositiveFrameSchema,
  text: z.string(),
  wordIds: z.array(NonEmptyStringSchema).optional(),
  sourceStartFrame: NonnegativeFrameSchema.optional(),
  sourceEndFrame: NonnegativeFrameSchema.optional()
});
var TimelineCaptionWordReferenceSchema = z.object({
  id: NonEmptyStringSchema,
  text: z.string(),
  assetId: NonEmptyStringSchema.optional(),
  assetWordId: NonEmptyStringSchema.optional(),
  clipId: NonEmptyStringSchema.optional(),
  trackId: NonEmptyStringSchema.optional(),
  sourceStartFrame: NonnegativeFrameSchema,
  sourceEndFrame: NonnegativeFrameSchema,
  confidence: z.number().finite().min(0).max(1).optional()
});
var TimelineSourceToOutputFrameMapSchema = z.object({
  sourceStartFrame: NonnegativeFrameSchema,
  sourceEndFrame: NonnegativeFrameSchema,
  outputStartFrame: NonnegativeFrameSchema,
  outputEndFrame: NonnegativeFrameSchema
});
var TimelineTypographyStyleSchema = z.object({
  color: CssColorSchema.optional(),
  fontSize: z.number().finite().positive().optional(),
  fontFamily: NonEmptyStringSchema.optional(),
  fontWeight: z.union([z.string(), FiniteNumberSchema]).optional(),
  backgroundColor: CssColorSchema.optional(),
  position: z.enum(TIMELINE_CAPTION_POSITIONS).optional()
});
var TimelineEditorTranscriptWordSchema = z.object({
  id: NonEmptyStringSchema,
  text: z.string(),
  startMs: z.number().finite().nonnegative(),
  endMs: z.number().finite().nonnegative(),
  confidence: z.number().finite().min(0).max(1).optional(),
  speakerId: NonEmptyStringSchema.optional()
});
var TimelineEditorAssetTranscriptSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("clash.editor.asset-transcript"),
  assetId: NonEmptyStringSchema,
  text: z.string(),
  durationMs: z.number().finite().nonnegative(),
  words: z.array(TimelineEditorTranscriptWordSchema),
  backendId: NonEmptyStringSchema.optional(),
  modelId: NonEmptyStringSchema.optional(),
  language: NonEmptyStringSchema.optional()
});
var TimelineMediaAssetRefSchema = z.object({
  assetId: NonEmptyStringSchema
});
var TimelineSequenceSchema = z.object({
  baseUrl: NonEmptyStringSchema,
  frameCount: PositiveFrameSchema,
  fps: z.number().finite().positive()
});
var TimelineDerivedAssetSchema = z.object({
  kind: z.enum(TIMELINE_DERIVATION_KINDS),
  description: z.string().optional(),
  parameters: z.record(z.unknown()).optional()
});
var noControl = { surface: "none" };
var timelineControl = { surface: "timeline" };
var propertiesControl = { surface: "properties-panel" };
var rootFields = {
  compositionWidth: authored(z.number().finite().positive(), "Composition width in output pixels.", {
    required: true,
    authoredRequired: false,
    editor: { ...propertiesControl, control: "composition-size" },
    runtimeConsumers: ["editor", "preview", "render", "export"],
    defaultValue: 1920
  }),
  compositionHeight: authored(z.number().finite().positive(), "Composition height in output pixels.", {
    required: true,
    authoredRequired: false,
    editor: { ...propertiesControl, control: "composition-size" },
    runtimeConsumers: ["editor", "preview", "render", "export"],
    defaultValue: 1080
  }),
  fps: authored(z.number().finite().positive(), "Timeline frames per second.", {
    required: true,
    authoredRequired: false,
    editor: propertiesControl,
    runtimeConsumers: ["editor", "preview", "render", "export", "transcript"],
    defaultValue: 30
  }),
  durationInFrames: authored(PositiveFrameSchema, "Composition duration in Timeline frames.", {
    required: true,
    authoredRequired: false,
    editor: propertiesControl,
    runtimeConsumers: ["editor", "preview", "render", "export"],
    defaultValue: 300
  }),
  primaryTrackId: authored(NonEmptyStringSchema.nullable(), "Id of the track that defines the semantic primary edit.", {
    required: false,
    editor: timelineControl,
    runtimeConsumers: ["editor", "timeline-semantics", "transcript", "export"],
    defaultValue: null
  }),
  tracks: authored(z.array(z.unknown()), "Ordered Timeline track collection.", {
    required: true,
    editor: timelineControl,
    runtimeConsumers: ["editor", "preview", "render", "export", "yaml"],
    relation: "tracks"
  }),
  assetTranscripts: derived(z.record(TimelineEditorAssetTranscriptSchema), "Persisted word-level transcripts keyed by asset id; agents must preserve entries they do not edit.", {
    required: false,
    editor: noControl,
    runtimeConsumers: ["editor", "transcript", "caption-generation", "persistence"],
    defaultValue: {}
  }),
  mediaAssetRefs: derived(z.array(TimelineMediaAssetRefSchema), "Host-owned media asset references required to rehydrate Timeline assets; agents must preserve them.", {
    required: false,
    editor: noControl,
    runtimeConsumers: ["editor", "asset-loader", "persistence"],
    defaultValue: []
  })
};
var trackFields = {
  id: authored(NonEmptyStringSchema, "Stable track id, unique within the Timeline.", {
    required: true,
    editor: timelineControl,
    runtimeConsumers: ["editor", "preview", "render", "yaml"]
  }),
  name: authored(z.string(), "Human-readable track name.", {
    required: true,
    authoredRequired: false,
    editor: timelineControl,
    runtimeConsumers: ["editor"],
    defaultValue: ""
  }),
  role: authored(z.enum(TIMELINE_DSL_TRACK_ROLES), "Semantic purpose of the track.", {
    required: false,
    editor: timelineControl,
    runtimeConsumers: ["editor", "timeline-semantics", "audio-ducking", "transcript"]
  }),
  category: authored(z.enum(TIMELINE_DSL_TRACK_CATEGORIES), "Structural lane category controlling order and allowed item types.", {
    required: false,
    editor: timelineControl,
    runtimeConsumers: ["editor", "timeline-semantics", "render"]
  }),
  items: authored(z.array(z.unknown()), "Ordered items placed on this track.", {
    required: true,
    editor: timelineControl,
    runtimeConsumers: ["editor", "preview", "render", "yaml"],
    relation: "items"
  }),
  hidden: authored(z.boolean(), "Whether the track is hidden from preview and render.", {
    required: false,
    editor: timelineControl,
    runtimeConsumers: ["editor", "preview", "render"],
    defaultValue: false
  }),
  locked: authored(z.boolean(), "Whether interactive editor mutations are locked.", {
    required: false,
    editor: timelineControl,
    runtimeConsumers: ["editor"],
    defaultValue: false
  })
};
var itemBaseFields = {
  id: authored(NonEmptyStringSchema, "Stable item id, globally unique within the Timeline.", {
    required: true,
    editor: timelineControl,
    runtimeConsumers: ["editor", "preview", "render", "yaml"]
  }),
  type: authored(z.enum(TIMELINE_DSL_ITEM_TYPES), "Discriminant selecting the item field contract and renderer.", {
    required: true,
    editor: timelineControl,
    runtimeConsumers: ["editor", "preview", "render", "export", "yaml"]
  }),
  from: authored(z.union([z.number().finite().nonnegative(), NonEmptyStringSchema]), "Composition-absolute start frame or a relative authoring expression such as prev+15.", {
    required: true,
    editor: timelineControl,
    runtimeConsumers: ["editor", "preview", "render", "yaml"]
  }),
  durationInFrames: authored(PositiveFrameSchema, "Positive item duration in Timeline frames.", {
    required: true,
    editor: timelineControl,
    runtimeConsumers: ["editor", "preview", "render", "export"]
  }),
  assetId: authored(NonEmptyStringSchema, "Stable D1 media asset row id.", {
    required: false,
    editor: noControl,
    runtimeConsumers: ["asset-loader", "preview", "render"]
  }),
  sourceNodeId: authored(NonEmptyStringSchema, "Canvas node id used to resolve linked source media.", {
    required: false,
    editor: noControl,
    runtimeConsumers: ["asset-loader", "canvas-link", "render"]
  }),
  properties: authored(TimelineItemPropertiesSchema, "Static item transform: x/y are composition-center pixel offsets; width/height are unitless source-size multipliers, never output pixels.", {
    required: false,
    editor: propertiesControl,
    runtimeConsumers: ["editor", "preview", "render", "export"],
    defaultValue: { x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1 },
    appliesToItemTypes: TIMELINE_MASK_APPLIES_TO_ITEM_TYPES,
    applicabilityRuleId: "timeline.properties.item-type"
  }),
  keyframes: authored(TimelineItemKeyframesSchema, "Seek-safe item-local transform and mask keyframe channels.", {
    required: false,
    editor: propertiesControl,
    runtimeConsumers: ["editor", "preview", "render", "export"],
    appliesToItemTypes: TIMELINE_MASK_APPLIES_TO_ITEM_TYPES,
    applicabilityRuleId: "timeline.keyframes.item-type",
    applicabilityMessage: "keyframes are only valid on visual transform items"
  }),
  mask: authored(TimelineItemMaskSchema, "Resolution-independent clip-local rectangle or ellipse mask.", {
    required: false,
    editor: propertiesControl,
    runtimeConsumers: ["editor", "preview", "render", "export"],
    appliesToItemTypes: TIMELINE_MASK_APPLIES_TO_ITEM_TYPES,
    applicabilityRuleId: "timeline.clip-mask.item-type",
    applicabilityMessage: "mask is only valid on visual items"
  }),
  effects: authored(z.array(TimelineEffectInstanceRefSchema), "Ordered, version-pinned declarative clip effect stack.", {
    required: false,
    editor: propertiesControl,
    runtimeConsumers: ["effect-runtime", "preview", "render", "export"],
    defaultValue: []
  }),
  bakedAssetPath: derived(NonEmptyStringSchema, "Rendered replacement used when an external NLE cannot reproduce an effect stack.", {
    required: false,
    editor: noControl,
    runtimeConsumers: ["export"]
  }),
  fromExpr: derived(NonEmptyStringSchema, "Opaque memo of the relative expression that produced the resolved numeric from value.", {
    required: false,
    editor: noControl,
    runtimeConsumers: ["yaml"]
  })
};
var itemTypeFields = {
  solid: {
    color: authored(CssColorSchema, "CSS fill color for the generated solid.", {
      required: true,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"]
    })
  },
  text: {
    text: authored(z.string(), "Rendered plain text or synthesized caption text.", {
      required: true,
      authoredRequired: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render", "transcript"],
      defaultValue: ""
    }),
    color: authored(CssColorSchema, "Plain-text CSS color.", {
      required: true,
      authoredRequired: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: "#ffffff"
    }),
    fontSize: authored(z.number().finite().positive(), "Plain-text font size in rendered pixels.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: 60
    }),
    fontFamily: authored(NonEmptyStringSchema, "Plain-text CSS font family.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: "Arial"
    }),
    fontWeight: authored(z.union([z.string(), FiniteNumberSchema]), "Plain-text CSS font weight.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: "bold"
    }),
    textAlign: authored(z.enum(TIMELINE_TEXT_ALIGNMENTS), "Horizontal plain-text alignment.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: "center"
    }),
    letterSpacingPx: authored(FiniteNumberSchema, "Plain-text letter spacing in rendered pixels.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: 0
    }),
    lineHeight: authored(z.number().finite().positive(), "Unitless plain-text line-height multiplier.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: 1.1
    }),
    cues: authored(z.array(TimelineCaptionCueSchema), "Timed caption cues for structured subtitle text.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render", "transcript", "caption-export"]
    }),
    language: authored(NonEmptyStringSchema, "BCP-47-style language hint for caption text.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["transcript", "caption-export"]
    }),
    wordRefs: authored(z.array(TimelineCaptionWordReferenceSchema), "Source-word lineage for synchronized caption edits.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["transcript", "caption-export"]
    }),
    sourceToOutputMap: authored(z.array(TimelineSourceToOutputFrameMapSchema), "Source-to-output frame lineage for structured captions.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["transcript", "caption-export"]
    }),
    style: authored(TimelineTypographyStyleSchema, "Structured-caption typography and screen position.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render", "caption-export"]
    })
  },
  video: {
    src: authored(NonEmptyStringSchema, "Resolved local or application media source.", {
      required: true,
      authoredRequired: false,
      editor: noControl,
      runtimeConsumers: ["asset-loader", "preview", "render"]
    }),
    mediaFit: authored(TimelineMediaFitSchema, "How source pixels fit the transformed item bounds.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: "fill"
    }),
    sourceStartInFrames: authored(NonnegativeFrameSchema, "Frames skipped from the beginning of source media.", {
      required: false,
      editor: timelineControl,
      runtimeConsumers: ["preview", "render", "transcript"],
      defaultValue: 0
    }),
    audioGainDb: authored(z.number().finite().min(-60).max(12), "Canonical clip audio gain in decibels.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render", "audio-mix"],
      defaultValue: 0
    }),
    volume: authored(z.number().finite().nonnegative(), "Legacy linear audio gain alias.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["preview", "render", "migration"],
      deprecated: "Use audioGainDb for new writes."
    }),
    waveform: derived(z.array(FiniteNumberSchema), "Cached normalized waveform peaks.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["editor"]
    }),
    entranceAnimation: authored(TimelineClipAnimationSchema, "Seek-safe visual entrance animation.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"]
    }),
    exitAnimation: authored(TimelineClipAnimationSchema, "Seek-safe visual exit animation.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"]
    }),
    videoFadeIn: authored(NonnegativeFrameSchema, "Video fade-in duration in frames.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: 0
    }),
    videoFadeOut: authored(NonnegativeFrameSchema, "Video fade-out duration in frames.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: 0
    }),
    audioFadeInFrames: authored(NonnegativeFrameSchema, "Canonical audio fade-in duration in frames.", {
      required: false,
      editor: timelineControl,
      runtimeConsumers: ["preview", "render", "audio-mix"],
      defaultValue: 0
    }),
    audioFadeOutFrames: authored(NonnegativeFrameSchema, "Canonical audio fade-out duration in frames.", {
      required: false,
      editor: timelineControl,
      runtimeConsumers: ["preview", "render", "audio-mix"],
      defaultValue: 0
    }),
    audioFadeIn: authored(NonnegativeFrameSchema, "Legacy audio fade-in alias in frames.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["preview", "render", "migration"],
      deprecated: "Use audioFadeInFrames for new writes."
    }),
    audioFadeOut: authored(NonnegativeFrameSchema, "Legacy audio fade-out alias in frames.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["preview", "render", "migration"],
      deprecated: "Use audioFadeOutFrames for new writes."
    }),
    videoFadeInColor: authored(CssColorSchema, "Color faded out over the video fade-in window.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["preview", "render"]
    }),
    videoFadeOutColor: authored(CssColorSchema, "Color faded in over the video fade-out window.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["preview", "render"]
    })
  },
  audio: {
    src: authored(NonEmptyStringSchema, "Resolved local or application audio source.", {
      required: true,
      authoredRequired: false,
      editor: noControl,
      runtimeConsumers: ["asset-loader", "preview", "render"]
    }),
    sourceStartInFrames: authored(NonnegativeFrameSchema, "Frames skipped from the beginning of source audio.", {
      required: false,
      editor: timelineControl,
      runtimeConsumers: ["preview", "render", "transcript"],
      defaultValue: 0
    }),
    audioGainDb: authored(z.number().finite().min(-60).max(12), "Canonical clip audio gain in decibels.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render", "audio-mix"],
      defaultValue: 0
    }),
    audioDucking: authored(TimelineAudioDuckingSchema, "Automatic music ducking amount and ramps.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render", "audio-mix"]
    }),
    volume: authored(z.number().finite().nonnegative(), "Legacy linear audio gain alias.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["preview", "render", "migration"],
      deprecated: "Use audioGainDb for new writes."
    }),
    waveform: derived(z.array(FiniteNumberSchema), "Cached normalized waveform peaks.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["editor"]
    }),
    audioFadeInFrames: authored(NonnegativeFrameSchema, "Canonical audio fade-in duration in frames.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render", "audio-mix"],
      defaultValue: 0
    }),
    audioFadeOutFrames: authored(NonnegativeFrameSchema, "Canonical audio fade-out duration in frames.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render", "audio-mix"],
      defaultValue: 0
    }),
    audioFadeIn: authored(NonnegativeFrameSchema, "Legacy audio fade-in alias in frames.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["preview", "render", "migration"],
      deprecated: "Use audioFadeInFrames for new writes."
    }),
    audioFadeOut: authored(NonnegativeFrameSchema, "Legacy audio fade-out alias in frames.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["preview", "render", "migration"],
      deprecated: "Use audioFadeOutFrames for new writes."
    })
  },
  image: {
    src: authored(NonEmptyStringSchema, "Resolved local or application image source.", {
      required: true,
      authoredRequired: false,
      editor: noControl,
      runtimeConsumers: ["asset-loader", "preview", "render"]
    }),
    mediaFit: authored(TimelineMediaFitSchema, "How source pixels fit the transformed item bounds.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: "fill"
    }),
    imageFadeIn: authored(NonnegativeFrameSchema, "Image fade-in duration in frames.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: 0
    }),
    imageFadeOut: authored(NonnegativeFrameSchema, "Image fade-out duration in frames.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: 0
    }),
    imageFadeInColor: authored(CssColorSchema, "Color faded out over the image fade-in window.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"]
    }),
    imageFadeOutColor: authored(CssColorSchema, "Color faded in over the image fade-out window.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"]
    })
  },
  sticker: {
    src: authored(NonEmptyStringSchema, "Animated image or sequence source.", {
      required: true,
      authoredRequired: false,
      editor: noControl,
      runtimeConsumers: ["asset-loader", "preview", "render"]
    }),
    mediaFit: authored(TimelineMediaFitSchema, "How sticker pixels fit the transformed item bounds.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: "contain"
    }),
    sequence: authored(TimelineSequenceSchema, "Optional still-frame sequence metadata.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["persistence", "future-renderer"]
    })
  },
  composition: {
    compositionKind: authored(z.enum(TIMELINE_COMPOSITION_KINDS), "Composition domain label; motion-graphics must resolve a live Remotion Canvas component.", {
      required: true,
      editor: propertiesControl,
      runtimeConsumers: ["composition-runtime", "preview", "render"]
    }),
    runtime: authored(z.enum(TIMELINE_COMPOSITION_RUNTIMES), "Runtime used by the composition source.", {
      required: true,
      editor: propertiesControl,
      runtimeConsumers: ["composition-runtime", "preview", "render"]
    }),
    compositionId: authored(NonEmptyStringSchema, "Stable composition implementation id.", {
      required: true,
      editor: propertiesControl,
      runtimeConsumers: ["composition-runtime", "preview", "render"]
    }),
    sourcePath: authored(NonEmptyStringSchema, "User-owned local project path for the composition source.", {
      required: true,
      editor: noControl,
      runtimeConsumers: ["composition-runtime", "preview", "render"]
    }),
    renderedAssetPath: derived(NonEmptyStringSchema, "Host-produced rendered preview/export asset path for legacy React composition states, preserved by agents.", {
      required: false,
      editor: noControl,
      runtimeConsumers: ["preview", "render", "export"]
    }),
    spec: authored(z.record(z.unknown()), "Optional runtime configuration for legacy custom compositions; motion graphics use Canvas Remotion component source instead.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["composition-runtime", "preview", "render"]
    })
  },
  "derived-overlay": {
    mediaType: authored(z.enum(TIMELINE_DERIVED_MEDIA_TYPES), "Media kind produced by the derivation.", {
      required: true,
      editor: noControl,
      runtimeConsumers: ["asset-loader", "preview", "render"]
    }),
    src: authored(NonEmptyStringSchema, "Immutable derived media source.", {
      required: true,
      authoredRequired: false,
      editor: noControl,
      runtimeConsumers: ["asset-loader", "preview", "render"]
    }),
    mediaFit: authored(TimelineMediaFitSchema, "How derived pixels fit the transformed item bounds.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"],
      defaultValue: "fill"
    }),
    sourceAssetId: authored(NonEmptyStringSchema, "Immutable lineage id of the source asset.", {
      required: true,
      editor: noControl,
      runtimeConsumers: ["asset-loader", "derivation", "export"]
    }),
    derivedAssetId: authored(NonEmptyStringSchema, "Distinct id of the derived copy-on-write asset.", {
      required: true,
      editor: noControl,
      runtimeConsumers: ["asset-loader", "derivation", "export"]
    }),
    derivation: authored(TimelineDerivedAssetSchema, "Operation and parameters that produced this immutable overlay.", {
      required: true,
      editor: noControl,
      runtimeConsumers: ["derivation", "export"]
    })
  },
  transition: {
    transitionType: authored(z.enum(TIMELINE_TRANSITION_TYPES), "Built-in transition renderer.", {
      required: true,
      editor: propertiesControl,
      runtimeConsumers: ["preview", "render"]
    }),
    fromItemId: authored(NonEmptyStringSchema, "Id of the visual clip leaving the screen.", {
      required: true,
      editor: timelineControl,
      runtimeConsumers: ["timeline-semantics", "preview", "render"]
    }),
    toItemId: authored(NonEmptyStringSchema, "Id of the visual clip entering the screen.", {
      required: true,
      editor: timelineControl,
      runtimeConsumers: ["timeline-semantics", "preview", "render"]
    }),
    effect: authored(TimelineEffectInstanceRefSchema, "Optional SDK transition effect that supersedes the built-in renderer.", {
      required: false,
      editor: propertiesControl,
      runtimeConsumers: ["effect-runtime", "preview", "render", "export"]
    })
  }
};
var TIMELINE_DSL_FIELD_ANNOTATIONS = {
  root: rootFields,
  track: trackFields,
  itemBase: itemBaseFields,
  itemTypes: itemTypeFields
};
function serializableFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([name, annotation2]) => {
      const { schema: _schema, ...serializable } = annotation2;
      return [name, serializable];
    })
  );
}
var TIMELINE_DSL_FIELD_CATALOG = {
  version: 1,
  root: { fields: serializableFields(rootFields) },
  track: { fields: serializableFields(trackFields) },
  itemBase: { fields: serializableFields(itemBaseFields) },
  itemTypes: Object.fromEntries(
    Object.entries(itemTypeFields).map(([type, fields]) => [
      type,
      { fields: serializableFields(fields) }
    ])
  )
};
var IdentifierSchema = z.string().trim().min(1);
var FiniteNumberSchema2 = z.number().finite();
var FrameSchema = z.number().finite().int().nonnegative();
var PositiveFrameSchema2 = z.number().finite().int().positive();
var PositionSchema = z.object({
  x: FiniteNumberSchema2,
  y: FiniteNumberSchema2
}).strict();
var TimelineDocumentEnvelopeSchema = z.object({
  tracks: z.array(z.unknown())
}).passthrough();
var TimelineOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project") }).strict(),
  z.object({
    kind: z.literal("canvas-action"),
    canvasId: IdentifierSchema,
    actionNodeId: IdentifierSchema
  }).strict()
]);
var ProjectTimelineEntitySchema = z.object({
  id: IdentifierSchema,
  name: IdentifierSchema,
  owner: TimelineOwnerSchema,
  revisionId: IdentifierSchema,
  state: z.unknown()
}).passthrough();
var TimelineIssueSchema = z.object({
  severity: z.enum(["error", "warning"]).optional(),
  code: IdentifierSchema,
  message: z.string().min(1),
  path: z.string()
}).passthrough();
var TimelineSchemaOutputSchema = z.object({
  schemaVersion: z.union([z.number().int().positive(), IdentifierSchema]),
  contractFingerprint: IdentifierSchema,
  jsonSchema: z.record(z.string(), z.unknown())
}).passthrough();
var TimelineValidationOutputSchema = z.object({
  ok: z.boolean(),
  issues: z.array(TimelineIssueSchema).default([]),
  contractFingerprint: IdentifierSchema.optional(),
  sources: z.array(IdentifierSchema).optional()
}).passthrough();
var TimelineProjectionOutputSchema = z.object({
  pulled: z.literal(true),
  projectId: IdentifierSchema,
  timelineId: IdentifierSchema,
  revisionId: IdentifierSchema,
  owner: TimelineOwnerSchema,
  filePath: IdentifierSchema,
  timelineHash: IdentifierSchema
}).passthrough();
var TimelineApplyOutputSchema = z.object({
  applied: z.literal(true),
  projectId: IdentifierSchema,
  timelineId: IdentifierSchema,
  revisionId: IdentifierSchema,
  owner: TimelineOwnerSchema,
  filePath: IdentifierSchema,
  sources: z.array(IdentifierSchema),
  timelineHash: IdentifierSchema
}).passthrough();
var TimelineRenderTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project-assets") }).strict(),
  z.object({
    kind: z.literal("canvas"),
    canvasId: IdentifierSchema,
    actionNodeId: IdentifierSchema
  }).strict()
]);
var TimelineRenderReceiptSchema = z.object({
  submitted: z.literal(true),
  completed: z.boolean(),
  timelineId: IdentifierSchema,
  sourceTimelineRevisionId: IdentifierSchema,
  renderNodeId: IdentifierSchema,
  target: TimelineRenderTargetSchema,
  status: z.enum(["pending", "completed", "failed"]),
  asset: z.object({
    id: IdentifierSchema,
    signedUrl: IdentifierSchema.optional(),
    srcR2Key: IdentifierSchema.optional()
  }).passthrough().optional(),
  error: z.string().min(1).optional()
}).passthrough();
var timelineEditorItemVariantSchemas = TIMELINE_DSL_ITEM_TYPES.map((type) => z.object({
  ...timelineDslAnnotatedObjectShape(
    TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase,
    {
      requiredness: "runtime",
      overrides: {
        type: z.literal(type),
        from: FrameSchema
      }
    }
  ),
  ...timelineDslAnnotatedObjectShape(
    TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes[type],
    { requiredness: "runtime" }
  )
}).strict());
var TimelineItemEnvelopeSchema = z.discriminatedUnion(
  "type",
  timelineEditorItemVariantSchemas
);
var TimelineTrackEnvelopeSchema = z.object(timelineDslAnnotatedObjectShape(
  TIMELINE_DSL_FIELD_ANNOTATIONS.track,
  {
    requiredness: "runtime",
    overrides: { items: z.array(TimelineItemEnvelopeSchema) }
  }
)).strict();
var TimelineAssetEnvelopeSchema = z.object({
  id: IdentifierSchema,
  name: IdentifierSchema,
  type: z.enum(["video", "audio", "image"]),
  src: IdentifierSchema,
  createdAt: FiniteNumberSchema2
}).passthrough();
var TimelineTranscriptEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("clash.editor.asset-transcript"),
  assetId: IdentifierSchema,
  text: z.string(),
  durationMs: FrameSchema,
  words: z.array(z.object({
    id: IdentifierSchema,
    text: z.string(),
    startMs: FrameSchema,
    endMs: PositiveFrameSchema2
  }).passthrough())
}).passthrough();
var TimelineEditorStateEnvelopeSchema = z.object({
  tracks: z.array(TimelineTrackEnvelopeSchema)
}).passthrough();
var TimelineCommandOutputSchema = z.object({
  ok: z.boolean(),
  dsl: TimelineDocumentEnvelopeSchema,
  issues: z.array(TimelineIssueSchema)
}).passthrough();
function annotation(options) {
  return Object.freeze({
    ...options,
    preconditions: Object.freeze([...options.preconditions]),
    runtimeConsumers: Object.freeze([...options.runtimeConsumers]),
    ...options.surfaceBindings ? { surfaceBindings: Object.freeze([...options.surfaceBindings]) } : {},
    ...options.inputContractRefs ? { inputContractRefs: Object.freeze({ ...options.inputContractRefs }) } : {}
  });
}
function agentOperation(options) {
  return annotation({ ...options, public: true });
}
var agent = {
  "timeline.open": agentOperation({
    id: "timeline.open",
    kind: "agent",
    inputSchema: z.object({ timelineId: IdentifierSchema.optional() }).strict(),
    outputSchema: z.object({
      cwd: IdentifierSchema,
      timelines: z.array(ProjectTimelineEntitySchema),
      selected: ProjectTimelineEntitySchema.optional()
    }).passthrough(),
    access: "read",
    readOnly: true,
    cas: "none",
    readProof: "records-observation",
    preconditions: ["The current cwd resolves to a Project replica."],
    description: "Open the interactive Timeline app with an optionally selected Project Timeline.",
    runtimeConsumers: ["mcp", "timeline-app", "agent-runtime"],
    surfaceBindings: ["mcp:clash_timeline_open"],
    agentCallable: true
  }),
  "timeline.schema": agentOperation({
    id: "timeline.schema",
    kind: "agent",
    inputSchema: z.object({}).strict(),
    outputSchema: TimelineSchemaOutputSchema,
    access: "read",
    readOnly: true,
    cas: "none",
    readProof: "none",
    preconditions: ["The installed Timeline contract is available."],
    description: "Return the machine-readable Timeline DSL contract and its fingerprint.",
    runtimeConsumers: ["cli", "mcp", "agent-runtime", "documentation-generator"],
    surfaceBindings: ["cli:timeline schema", "mcp:clash_timeline_schema"],
    agentCallable: true
  }),
  "timeline.validate": agentOperation({
    id: "timeline.validate",
    kind: "agent",
    inputSchema: z.object({
      document: z.union([z.string(), TimelineDocumentEnvelopeSchema]),
      format: z.enum(["yaml", "json", "object"]).optional()
    }).strict(),
    outputSchema: TimelineValidationOutputSchema,
    access: "read",
    readOnly: true,
    cas: "none",
    readProof: "none",
    preconditions: ["The authored document is syntactically readable as YAML, JSON, or an object."],
    description: "Validate authored Timeline DSL without applying or mutating a Project Timeline.",
    runtimeConsumers: ["cli", "mcp", "agent-runtime", "timeline-semantics"],
    surfaceBindings: ["cli:timeline validate", "mcp:clash_timeline_validate"],
    inputContractRefs: { document: "TIMELINE_DSL_DEFINITION.jsonSchema" },
    agentCallable: true
  }),
  "timeline.list": agentOperation({
    id: "timeline.list",
    kind: "entity",
    inputSchema: z.object({ standalone: z.boolean().optional() }).strict(),
    outputSchema: z.array(ProjectTimelineEntitySchema),
    access: "read",
    readOnly: true,
    cas: "none",
    readProof: "records-observation",
    preconditions: ["The current cwd resolves to a Project replica."],
    description: "List Project Timeline entities and record observations for later writes.",
    runtimeConsumers: ["cli", "mcp", "local-host", "agent-runtime"],
    surfaceBindings: ["cli:timeline list", "mcp:clash_timeline_list"],
    agentCallable: true
  }),
  "timeline.get": agentOperation({
    id: "timeline.get",
    kind: "entity",
    inputSchema: z.object({ timelineId: IdentifierSchema }).strict(),
    outputSchema: z.object({ timeline: ProjectTimelineEntitySchema }).strict(),
    access: "read",
    readOnly: true,
    cas: "none",
    readProof: "records-observation",
    preconditions: ["The requested Timeline exists in the current Project replica."],
    description: "Read one complete Project Timeline state and its revision for a later typed save.",
    runtimeConsumers: ["mcp", "local-host", "agent-runtime"],
    surfaceBindings: ["mcp:clash_timeline_get"],
    agentCallable: true
  }),
  "timeline.create": agentOperation({
    id: "timeline.create",
    kind: "entity",
    inputSchema: z.object({
      id: IdentifierSchema,
      name: IdentifierSchema,
      state: TimelineDocumentEnvelopeSchema.optional()
    }).strict(),
    outputSchema: ProjectTimelineEntitySchema,
    access: "write",
    readOnly: false,
    cas: "host-enforced",
    readProof: "none",
    preconditions: ["The Project-scoped Timeline id does not already exist."],
    description: "Create a standalone Project Timeline through the authoritative local host.",
    runtimeConsumers: ["cli", "mcp", "local-host", "project-workspace"],
    surfaceBindings: ["cli:timeline create", "mcp:clash_timeline_create"],
    inputContractRefs: { state: "TIMELINE_DSL_DEFINITION.jsonSchema" },
    agentCallable: true
  }),
  "timeline.save": agentOperation({
    id: "timeline.save",
    kind: "entity",
    inputSchema: z.object({
      timelineId: IdentifierSchema,
      baseRevisionId: IdentifierSchema,
      state: TimelineDocumentEnvelopeSchema
    }).strict(),
    outputSchema: TimelineApplyOutputSchema,
    access: "write",
    readOnly: false,
    cas: "host-enforced",
    readProof: "requires-observation",
    preconditions: [
      "The Timeline was read and baseRevisionId still matches its current revision.",
      "The complete state passes the canonical structural and semantic contract."
    ],
    description: "Validate and save a complete typed Timeline state with an explicit base revision.",
    runtimeConsumers: ["mcp", "local-host", "agent-runtime", "timeline-semantics"],
    surfaceBindings: ["mcp:clash_timeline_save"],
    inputContractRefs: { state: "TIMELINE_DSL_DEFINITION.jsonSchema" },
    agentCallable: true
  }),
  "timeline.attach": agentOperation({
    id: "timeline.attach",
    kind: "entity",
    inputSchema: z.object({
      timelineId: IdentifierSchema,
      canvasId: IdentifierSchema,
      actionNodeId: IdentifierSchema.optional(),
      position: PositionSchema.optional()
    }).strict(),
    outputSchema: ProjectTimelineEntitySchema,
    access: "write",
    readOnly: false,
    cas: "host-enforced",
    readProof: "requires-observation",
    preconditions: [
      "The Timeline was observed through list or pull and remains at that revision.",
      "The Timeline is standalone and the target Canvas exists.",
      "The Timeline Action node id is unused."
    ],
    description: "Move a standalone Timeline into a Canvas as a Timeline Action.",
    runtimeConsumers: ["cli", "mcp", "local-host", "project-workspace", "canvas"],
    surfaceBindings: ["cli:timeline attach", "mcp:clash_timeline_attach"],
    agentCallable: true
  }),
  "timeline.detach": agentOperation({
    id: "timeline.detach",
    kind: "entity",
    inputSchema: z.object({ timelineId: IdentifierSchema }).strict(),
    outputSchema: ProjectTimelineEntitySchema,
    access: "write",
    readOnly: false,
    cas: "host-enforced",
    readProof: "requires-observation",
    preconditions: [
      "The Timeline was observed through list or pull and remains at that revision.",
      "The Timeline is currently owned by a Canvas Timeline Action."
    ],
    description: "Detach a Canvas-owned Timeline back to the Project root.",
    runtimeConsumers: ["cli", "mcp", "local-host", "project-workspace", "canvas"],
    surfaceBindings: ["cli:timeline detach", "mcp:clash_timeline_detach"],
    agentCallable: true
  }),
  "timeline.copy": agentOperation({
    id: "timeline.copy",
    kind: "entity",
    inputSchema: z.object({
      sourceTimelineId: IdentifierSchema,
      targetCanvasId: IdentifierSchema,
      newTimelineId: IdentifierSchema.optional(),
      newActionNodeId: IdentifierSchema.optional(),
      position: PositionSchema.optional()
    }).strict(),
    outputSchema: ProjectTimelineEntitySchema,
    access: "write",
    readOnly: false,
    cas: "host-enforced",
    readProof: "requires-observation",
    preconditions: [
      "The source Timeline was observed and remains at that revision.",
      "The source is a Canvas-owned Timeline Action and the target Canvas exists.",
      "The new Timeline and Action node ids are unused."
    ],
    description: "Copy a Timeline Action into another Canvas using copy-on-write identity.",
    runtimeConsumers: ["cli", "mcp", "local-host", "project-workspace", "canvas"],
    surfaceBindings: ["cli:timeline copy", "mcp:clash_timeline_copy"],
    agentCallable: true
  }),
  "timeline.render": agentOperation({
    id: "timeline.render",
    kind: "agent",
    inputSchema: z.object({
      timelineId: IdentifierSchema,
      wait: z.boolean().optional(),
      timeoutMs: z.number().int().min(1e3).optional()
    }).strict(),
    outputSchema: TimelineRenderReceiptSchema,
    access: "write",
    readOnly: false,
    cas: "none",
    readProof: "records-observation",
    preconditions: [
      "The Timeline exists and contains at least one renderable item.",
      "The local daemon has a healthy packaged Remotion rendering backend."
    ],
    description: "Submit the current Timeline revision to the daemon renderer and optionally wait for persisted Asset readback.",
    runtimeConsumers: ["cli", "mcp", "local-host", "remotion-renderer", "agent-runtime"],
    surfaceBindings: ["cli:timeline render", "mcp:clash_timeline_render"],
    agentCallable: true
  }),
  "timeline.pull": agentOperation({
    id: "timeline.pull",
    kind: "projection",
    inputSchema: z.object({ timelineId: IdentifierSchema }).strict(),
    outputSchema: TimelineProjectionOutputSchema,
    access: "read",
    readOnly: true,
    cas: "none",
    readProof: "records-observation",
    preconditions: ["The Timeline exists in the current Project replica."],
    description: "Project the current Timeline revision to agent-editable YAML and record its observation.",
    runtimeConsumers: ["cli", "local-host", "yaml-projection", "agent-runtime"],
    surfaceBindings: ["cli:timeline pull"],
    agentCallable: true
  }),
  "timeline.apply": agentOperation({
    id: "timeline.apply",
    kind: "projection",
    inputSchema: z.object({
      timelineId: IdentifierSchema,
      document: z.union([z.string(), TimelineDocumentEnvelopeSchema]),
      format: z.enum(["yaml", "json", "object"]).optional()
    }).strict(),
    outputSchema: TimelineApplyOutputSchema,
    access: "write",
    readOnly: false,
    cas: "host-enforced",
    readProof: "requires-observation",
    preconditions: [
      "The Timeline was pulled or listed and remains at that revision.",
      "The complete authored document passes structural and semantic validation.",
      "Any immutable downstream dependency guard permits the revision advance."
    ],
    description: "Validate an authored projection and atomically advance the Project Timeline revision.",
    runtimeConsumers: ["cli", "local-host", "yaml-projection", "timeline-semantics"],
    surfaceBindings: ["cli:timeline apply"],
    inputContractRefs: { document: "TIMELINE_DSL_DEFINITION.jsonSchema" },
    agentCallable: true
  })
};
var editorCommandDefaults = {
  kind: "editor-command",
  outputSchema: TimelineCommandOutputSchema,
  access: "write",
  readOnly: false,
  cas: "none",
  readProof: "none",
  runtimeConsumers: ["remotion-core", "editor", "agent-runtime"],
  public: true,
  agentCallable: true
};
var editorCommands = {
  "timeline.command.add_clip": annotation({
    ...editorCommandDefaults,
    id: "timeline.command.add_clip",
    inputSchema: z.object({
      type: z.literal("add_clip"),
      trackId: IdentifierSchema,
      sourceNodeId: IdentifierSchema,
      assetId: IdentifierSchema.optional(),
      itemType: z.enum(["video", "audio", "image", "text"]),
      from: FrameSchema,
      durationInFrames: PositiveFrameSchema2,
      id: IdentifierSchema.optional(),
      text: z.string().optional()
    }).strict(),
    preconditions: [
      "The target track exists and accepts the requested item type.",
      "The source node resolves for media clips."
    ],
    description: "Add one validated clip to a Timeline draft."
  }),
  "timeline.command.trim_clip": annotation({
    ...editorCommandDefaults,
    id: "timeline.command.trim_clip",
    inputSchema: z.object({
      type: z.literal("trim_clip"),
      trackId: IdentifierSchema,
      itemId: IdentifierSchema,
      from: FrameSchema,
      durationInFrames: PositiveFrameSchema2
    }).strict(),
    preconditions: ["The target track and item exist and the requested duration is positive."],
    description: "Trim and reposition one clip in a Timeline draft."
  }),
  "timeline.command.split_clip": annotation({
    ...editorCommandDefaults,
    id: "timeline.command.split_clip",
    inputSchema: z.object({
      type: z.literal("split_clip"),
      trackId: IdentifierSchema,
      itemId: IdentifierSchema,
      splitFrame: FrameSchema
    }).strict(),
    preconditions: ["The target item exists and the split frame lies strictly inside its bounds."],
    description: "Split one clip at an absolute Timeline frame."
  })
};
var itemUpdateFields = {
  ...TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase,
  ...Object.assign({}, ...Object.values(TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes))
};
var ItemUpdatesSchema = z.object(timelineDslAnnotatedObjectShape(
  itemUpdateFields,
  {
    requiredness: "partial",
    overrides: { from: FrameSchema }
  }
)).strict().refine(
  (updates) => Object.keys(updates).length > 0,
  "At least one item field must be updated."
);
var TrackUpdatesSchema = z.object(timelineDslAnnotatedObjectShape(
  TIMELINE_DSL_FIELD_ANNOTATIONS.track,
  {
    requiredness: "partial",
    overrides: { items: z.array(TimelineItemEnvelopeSchema) }
  }
)).strict().refine(
  (updates) => Object.keys(updates).length > 0,
  "At least one track field must be updated."
);
function editorAction(id2, inputSchema, description, preconditions = ["A Timeline editor draft is loaded."]) {
  return annotation({
    id: id2,
    kind: "editor-action",
    inputSchema,
    outputSchema: TimelineEditorStateEnvelopeSchema,
    access: "write",
    readOnly: false,
    cas: "none",
    readProof: "none",
    preconditions,
    description,
    runtimeConsumers: ["remotion-core", "remotion-ui", "editor-history"],
    public: true,
    agentCallable: false
  });
}
function actionWithPayload(type, payload) {
  return z.object({ type: z.literal(type), payload }).strict();
}
function actionWithoutPayload(type) {
  return z.object({ type: z.literal(type) }).strict();
}
var editorActions = {
  "timeline.action.ADD_TRACK": editorAction(
    "timeline.action.ADD_TRACK",
    actionWithPayload("ADD_TRACK", TimelineTrackEnvelopeSchema),
    "Append a compatible track to the local Timeline draft."
  ),
  "timeline.action.INSERT_TRACK": editorAction(
    "timeline.action.INSERT_TRACK",
    actionWithPayload("INSERT_TRACK", z.object({
      track: TimelineTrackEnvelopeSchema,
      index: FrameSchema
    }).strict()),
    "Insert a compatible track at a requested editor index."
  ),
  "timeline.action.REMOVE_TRACK": editorAction(
    "timeline.action.REMOVE_TRACK",
    actionWithPayload("REMOVE_TRACK", IdentifierSchema),
    "Remove a track from the local Timeline draft.",
    ["The target track exists and editor primary-track invariants can be preserved."]
  ),
  "timeline.action.SET_PRIMARY_TRACK": editorAction(
    "timeline.action.SET_PRIMARY_TRACK",
    actionWithPayload("SET_PRIMARY_TRACK", IdentifierSchema),
    "Choose the Timeline track that anchors semantic edits.",
    ["The target track exists and is eligible to be primary."]
  ),
  "timeline.action.UPDATE_TRACK": editorAction(
    "timeline.action.UPDATE_TRACK",
    actionWithPayload("UPDATE_TRACK", z.object({
      id: IdentifierSchema,
      updates: TrackUpdatesSchema
    }).strict()),
    "Update authored properties of one Timeline track.",
    ["The target track exists and the update preserves category and primary-track invariants."]
  ),
  "timeline.action.REORDER_TRACKS": editorAction(
    "timeline.action.REORDER_TRACKS",
    actionWithPayload("REORDER_TRACKS", z.array(TimelineTrackEnvelopeSchema)),
    "Replace the local track ordering with a complete ordered track list.",
    ["Every current track is represented exactly once and category ordering remains valid."]
  ),
  "timeline.action.ADD_ITEM": editorAction(
    "timeline.action.ADD_ITEM",
    actionWithPayload("ADD_ITEM", z.object({
      trackId: IdentifierSchema,
      item: TimelineItemEnvelopeSchema
    }).strict()),
    "Append one item to a compatible Timeline track.",
    ["The target track exists, accepts the item type, and the item id is unique."]
  ),
  "timeline.action.MOVE_ITEM": editorAction(
    "timeline.action.MOVE_ITEM",
    actionWithPayload("MOVE_ITEM", z.object({
      sourceTrackId: IdentifierSchema,
      targetTrackId: IdentifierSchema,
      itemId: IdentifierSchema,
      from: FrameSchema
    }).strict()),
    "Move an item between compatible tracks at an absolute frame.",
    ["Both tracks and the item exist, and the target track accepts the item type."]
  ),
  "timeline.action.REMOVE_ITEM": editorAction(
    "timeline.action.REMOVE_ITEM",
    actionWithPayload("REMOVE_ITEM", z.object({
      trackId: IdentifierSchema,
      itemId: IdentifierSchema
    }).strict()),
    "Remove an item and reconcile its parent track.",
    ["The target track and item exist."]
  ),
  "timeline.action.UPDATE_ITEM": editorAction(
    "timeline.action.UPDATE_ITEM",
    actionWithPayload("UPDATE_ITEM", z.object({
      trackId: IdentifierSchema,
      itemId: IdentifierSchema,
      updates: ItemUpdatesSchema
    }).strict()),
    "Update authored fields on one Timeline item.",
    ["The target item exists and the update remains valid for its discriminated item type."]
  ),
  "timeline.action.SPLIT_ITEM": editorAction(
    "timeline.action.SPLIT_ITEM",
    actionWithPayload("SPLIT_ITEM", z.object({
      trackId: IdentifierSchema,
      itemId: IdentifierSchema,
      splitFrame: FrameSchema
    }).strict()),
    "Split an item at an absolute Timeline frame and slice its keyframes.",
    ["The split frame lies strictly inside the target item bounds."]
  ),
  "timeline.action.RIPPLE_DELETE_RANGE": editorAction(
    "timeline.action.RIPPLE_DELETE_RANGE",
    actionWithPayload("RIPPLE_DELETE_RANGE", z.object({
      startFrame: FrameSchema,
      endFrame: PositiveFrameSchema2
    }).strict().refine(
      ({ startFrame, endFrame }) => endFrame > startFrame,
      "endFrame must be greater than startFrame."
    )),
    "Delete an absolute frame range and close the resulting gap.",
    ["The requested range is non-empty and lies within the editable Timeline."]
  ),
  "timeline.action.RESTORE_TIMELINE_SNAPSHOT": editorAction(
    "timeline.action.RESTORE_TIMELINE_SNAPSHOT",
    actionWithPayload("RESTORE_TIMELINE_SNAPSHOT", z.object({
      tracks: z.array(TimelineTrackEnvelopeSchema),
      durationInFrames: PositiveFrameSchema2
    }).strict()),
    "Restore persistent Timeline fields from an editor history snapshot.",
    ["The snapshot was produced by the current editor history contract."]
  ),
  "timeline.action.SELECT_ITEM": editorAction(
    "timeline.action.SELECT_ITEM",
    actionWithPayload("SELECT_ITEM", IdentifierSchema.nullable()),
    "Select or clear one Timeline item in the editor session."
  ),
  "timeline.action.SELECT_TRACK": editorAction(
    "timeline.action.SELECT_TRACK",
    actionWithPayload("SELECT_TRACK", IdentifierSchema.nullable()),
    "Select or clear one Timeline track in the editor session."
  ),
  "timeline.action.SET_CURRENT_FRAME": editorAction(
    "timeline.action.SET_CURRENT_FRAME",
    actionWithPayload("SET_CURRENT_FRAME", FrameSchema),
    "Seek the editor playhead to an absolute Timeline frame."
  ),
  "timeline.action.SET_PLAYING": editorAction(
    "timeline.action.SET_PLAYING",
    actionWithPayload("SET_PLAYING", z.boolean()),
    "Start or stop editor preview playback."
  ),
  "timeline.action.SET_ZOOM": editorAction(
    "timeline.action.SET_ZOOM",
    actionWithPayload("SET_ZOOM", z.number().finite().positive()),
    "Set the Timeline viewport zoom level."
  ),
  "timeline.action.ADD_ASSET": editorAction(
    "timeline.action.ADD_ASSET",
    actionWithPayload("ADD_ASSET", TimelineAssetEnvelopeSchema),
    "Add a media asset to the local editor asset collection.",
    ["The asset id is not already present in the editor collection."]
  ),
  "timeline.action.UPSERT_ASSET": editorAction(
    "timeline.action.UPSERT_ASSET",
    actionWithPayload("UPSERT_ASSET", TimelineAssetEnvelopeSchema),
    "Insert or replace a media asset in the local editor collection."
  ),
  "timeline.action.SET_ASSET_TRANSCRIPT": editorAction(
    "timeline.action.SET_ASSET_TRANSCRIPT",
    actionWithPayload("SET_ASSET_TRANSCRIPT", TimelineTranscriptEnvelopeSchema),
    "Store an asset transcript and synchronize linked subtitle text.",
    ["The transcript word timings are expressed in the referenced immutable asset."]
  ),
  "timeline.action.REMOVE_ASSET": editorAction(
    "timeline.action.REMOVE_ASSET",
    actionWithPayload("REMOVE_ASSET", IdentifierSchema),
    "Remove a media asset from the local editor asset collection."
  ),
  "timeline.action.SET_COMPOSITION_SIZE": editorAction(
    "timeline.action.SET_COMPOSITION_SIZE",
    actionWithPayload("SET_COMPOSITION_SIZE", z.object({
      width: z.number().finite().int().positive(),
      height: z.number().finite().int().positive()
    }).strict()),
    "Set positive pixel dimensions for the Timeline composition."
  ),
  "timeline.action.SET_DURATION": editorAction(
    "timeline.action.SET_DURATION",
    actionWithPayload("SET_DURATION", PositiveFrameSchema2),
    "Set the Timeline composition duration in frames."
  ),
  "timeline.action.UNDO": editorAction(
    "timeline.action.UNDO",
    actionWithoutPayload("UNDO"),
    "Restore the previous persistent Timeline history snapshot.",
    ["The editor history has at least one past snapshot or an active changed group."]
  ),
  "timeline.action.REDO": editorAction(
    "timeline.action.REDO",
    actionWithoutPayload("REDO"),
    "Restore the next persistent Timeline history snapshot.",
    ["The editor history has at least one future snapshot."]
  ),
  "timeline.action.BEGIN_HISTORY_GROUP": editorAction(
    "timeline.action.BEGIN_HISTORY_GROUP",
    actionWithoutPayload("BEGIN_HISTORY_GROUP"),
    "Begin grouping related editor mutations into one undo step."
  ),
  "timeline.action.END_HISTORY_GROUP": editorAction(
    "timeline.action.END_HISTORY_GROUP",
    actionWithoutPayload("END_HISTORY_GROUP"),
    "Commit the active editor mutation group as one undo step.",
    ["A Timeline editor history group is active."]
  )
};
var TIMELINE_OPERATION_REGISTRY = Object.freeze({
  agent: Object.freeze(agent),
  editorCommands: Object.freeze(editorCommands),
  editorActions: Object.freeze(editorActions)
});
function catalogGroup(group) {
  return Object.fromEntries(
    Object.entries(group).map(([id2, value]) => {
      const { inputSchema: _inputSchema, outputSchema: _outputSchema, ...metadata } = value;
      return [id2, {
        ...metadata,
        inputJsonSchema: zodToJsonSchema(value.inputSchema, {
          target: "jsonSchema7"
        }),
        outputJsonSchema: zodToJsonSchema(value.outputSchema, {
          target: "jsonSchema7"
        })
      }];
    })
  );
}
var TIMELINE_OPERATION_CATALOG = Object.freeze({
  agent: Object.freeze(catalogGroup(agent)),
  editorCommands: Object.freeze(catalogGroup(editorCommands)),
  editorActions: Object.freeze(catalogGroup(editorActions))
});
var OFFSET_RE = /^(.+?)\s*([+-])\s*([0-9]+(?:\.[0-9]+)?)$/;
var BARE_ID_RE = /^[A-Za-z0-9_.:-]+$/;
function parseFromExpression(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { kind: "absolute", value: Math.max(0, raw) };
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === "start") return { kind: "absolute", value: 0 };
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return { kind: "absolute", value: Math.max(0, numeric) };
  }
  const match = trimmed.match(OFFSET_RE);
  if (match) {
    const refId = (match[1] ?? "").trim();
    if (refId) {
      const magnitude = Number.parseFloat(match[3] ?? "0");
      const offset = Number.isFinite(magnitude) ? match[2] === "-" ? -magnitude : magnitude : 0;
      return { kind: "reference", refId, offset };
    }
  }
  if (BARE_ID_RE.test(trimmed)) {
    return { kind: "reference", refId: trimmed, offset: 0 };
  }
  return null;
}
var TIMELINE_DSL_GLOBAL_SEMANTIC_RULES = [
  {
    id: "timeline.track.duplicate-id",
    kind: "unique-field",
    objectPath: "tracks[]",
    field: "id"
  },
  {
    id: "timeline.item.duplicate-id",
    kind: "unique-field-global",
    objectPath: "tracks[].items[]",
    field: "id"
  },
  {
    id: "timeline.primary-track.reference",
    kind: "reference",
    objectPath: "primaryTrackId",
    targetPath: "tracks[].id"
  },
  {
    id: "timeline.primary-track.category",
    kind: "referenced-object-field",
    objectPath: "primaryTrackId",
    field: "category",
    allowedValues: ["primary"]
  },
  {
    id: "timeline.track.category-item-mismatch",
    kind: "allowed-item-types",
    objectPath: "tracks[]",
    discriminator: "category"
  },
  {
    id: "timeline.track.role-item-mismatch",
    kind: "allowed-item-types",
    objectPath: "tracks[]",
    discriminator: "role"
  },
  {
    id: "timeline.track.role-category",
    kind: "owner-field-consistency",
    objectPath: "tracks[]",
    fields: ["role", "category"],
    mapping: TIMELINE_DSL_ROLE_CATEGORIES
  },
  {
    id: "timeline.track.category-order",
    kind: "ordered-enum",
    objectPath: "tracks[]",
    field: "category",
    order: TIMELINE_DSL_TRACK_CATEGORIES
  },
  {
    id: "timeline.track.mixed-categories",
    kind: "single-structural-category",
    objectPath: "tracks[]"
  },
  {
    id: "timeline.item.from-expression",
    kind: "expression-grammar",
    objectPath: "tracks[].items[]",
    field: "from"
  },
  {
    id: "timeline.item.frame-integer",
    kind: "integer-frame",
    objectPath: "tracks[].items[]",
    field: "from"
  },
  {
    id: "timeline.item.from-reference",
    kind: "reference",
    objectPath: "tracks[].items[].from",
    targetPath: "tracks[].items[].id"
  },
  {
    id: "timeline.item.from-cycle",
    kind: "acyclic-reference",
    objectPath: "tracks[].items[].from"
  },
  {
    id: "timeline.item.source-required",
    kind: "requires-any-field",
    objectPath: "tracks[].items[]",
    fields: ["src", "assetId", "sourceNodeId"]
  },
  {
    id: "timeline.item.animation-duration",
    kind: "maximum-by-owner-field",
    objectPath: "tracks[].items[]",
    fields: [
      "entranceAnimation.durationInFrames",
      "exitAnimation.durationInFrames"
    ],
    maximumPath: "durationInFrames"
  },
  {
    id: "timeline.item.scale-unit",
    kind: "maximum-absolute-value",
    objectPath: "tracks[].items[]",
    fields: ["properties.width", "properties.height"],
    maximum: 4,
    unit: "unitless-source-size-multiplier"
  },
  {
    id: "timeline.audio.ducking-track-role",
    kind: "field-requires-owner-value",
    objectPath: "tracks[].items[]",
    field: "audioDucking",
    ownerField: "role",
    ownerValue: "music"
  },
  {
    id: "timeline.composition.local-path",
    kind: "local-path",
    objectPath: "tracks[].items[]",
    fields: ["sourcePath", "renderedAssetPath"]
  },
  {
    id: "timeline.composition.preview-contract",
    kind: "conditional-required",
    objectPath: "tracks[].items[]"
  },
  {
    id: "timeline.caption.structured",
    kind: "conditional-required",
    objectPath: "tracks[].items[]"
  },
  {
    id: "timeline.caption.lineage",
    kind: "cross-field-lineage",
    objectPath: "tracks[].items[]"
  },
  {
    id: "timeline.derived-overlay.local-path",
    kind: "local-path",
    objectPath: "tracks[].items[]",
    fields: ["src"]
  },
  {
    id: "timeline.derived-overlay.copy-on-write",
    kind: "distinct-fields",
    objectPath: "tracks[].items[]",
    fields: ["sourceAssetId", "derivedAssetId"]
  },
  {
    id: "timeline.transition.reference",
    kind: "references",
    objectPath: "tracks[].items[]",
    fields: ["fromItemId", "toItemId"]
  },
  {
    id: "timeline.transition.continuity",
    kind: "same-track-contiguous-references",
    objectPath: "tracks[].items[]"
  },
  {
    id: "timeline.transition.centered-range",
    kind: "centered-on-reference-boundary",
    objectPath: "tracks[].items[]"
  },
  {
    id: "timeline.transition.duration-handles",
    kind: "maximum-by-reference-handles",
    objectPath: "tracks[].items[]"
  }
];
function issue(ruleId, path, message) {
  return { ruleId, path, message };
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isLocalProjectPath(value) {
  if (!nonEmptyString(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return false;
  return !value.split(/[\\/]+/).includes("..");
}
function structuralCategory(type) {
  if (type === "composition" || type === "transition") return "effect";
  if (type === "text") return "text";
  if (type === "audio") return "audio";
  return "visual";
}
function pushReferenceCycleIssues(indexedItems, itemById, issues) {
  const references = /* @__PURE__ */ new Map();
  for (const indexed of indexedItems) {
    if (typeof indexed.item.from !== "string") continue;
    const expression = parseFromExpression(indexed.item.from);
    if (expression?.kind === "reference" && expression.refId !== "prev") {
      references.set(indexed.item.id, expression.refId);
    }
  }
  const complete = /* @__PURE__ */ new Set();
  for (const indexed of indexedItems) {
    if (complete.has(indexed.item.id)) continue;
    const path = [];
    const positions = /* @__PURE__ */ new Map();
    let cursor = indexed.item.id;
    while (cursor && references.has(cursor) && !complete.has(cursor)) {
      const existing = positions.get(cursor);
      if (existing !== void 0) {
        for (const cyclicId of path.slice(existing)) {
          const cyclic = itemById.get(cyclicId);
          if (!cyclic) continue;
          issues.push(
            issue(
              "timeline.item.from-cycle",
              ["tracks", cyclic.trackIndex, "items", cyclic.itemIndex, "from"],
              `from expression for ${cyclicId} participates in a reference cycle`
            )
          );
        }
        break;
      }
      positions.set(cursor, path.length);
      path.push(cursor);
      cursor = references.get(cursor);
    }
    path.forEach((id2) => complete.add(id2));
  }
}
function validateTransition(indexed, itemById, issues) {
  const { item, trackIndex, itemIndex } = indexed;
  if (item.type !== "transition") return;
  const itemPath = ["tracks", trackIndex, "items", itemIndex];
  const fromId = item.fromItemId;
  const toId = item.toItemId;
  const from = nonEmptyString(fromId) ? itemById.get(fromId) : void 0;
  const to = nonEmptyString(toId) ? itemById.get(toId) : void 0;
  if (!from || !to) {
    issues.push(
      issue(
        "timeline.transition.reference",
        [...itemPath],
        "transition must reference two existing Timeline items"
      )
    );
    return;
  }
  const transitionClipTypes = /* @__PURE__ */ new Set([
    "video",
    "image",
    "solid",
    "text"
  ]);
  const boundary = typeof from.item.from === "number" ? from.item.from + from.item.durationInFrames : Number.NaN;
  if (from.track.id !== to.track.id || !transitionClipTypes.has(from.item.type) || !transitionClipTypes.has(to.item.type) || boundary !== to.item.from) {
    issues.push(
      issue(
        "timeline.transition.continuity",
        [...itemPath],
        "transition references must be contiguous visual clips on the same track"
      )
    );
    return;
  }
  if (typeof item.from === "number") {
    const expectedFrom = boundary - Math.floor(item.durationInFrames / 2);
    if (item.from !== expectedFrom) {
      issues.push(
        issue(
          "timeline.transition.centered-range",
          [...itemPath, "from"],
          `transition range must be centered on frame ${boundary}`
        )
      );
    }
  }
  const maximum = Math.max(
    1,
    Math.min(from.item.durationInFrames, to.item.durationInFrames) * 2
  );
  if (item.durationInFrames > maximum) {
    issues.push(
      issue(
        "timeline.transition.duration-handles",
        [...itemPath, "durationInFrames"],
        `transition duration cannot exceed ${maximum} frames for these clips`
      )
    );
  }
}
function validFrameRange(start, end) {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start;
}
function validateCaption(indexed, issues) {
  const { item, track, trackIndex, itemIndex } = indexed;
  if (item.type !== "text" || track.role !== "subtitle" && !Array.isArray(item.cues))
    return;
  const itemPath = ["tracks", trackIndex, "items", itemIndex];
  const cues = Array.isArray(item.cues) ? item.cues : [];
  const wordRefs = Array.isArray(item.wordRefs) ? item.wordRefs : [];
  const mappings = Array.isArray(item.sourceToOutputMap) ? item.sourceToOutputMap : [];
  if (cues.length === 0 || wordRefs.length === 0 || mappings.length === 0) {
    issues.push(
      issue(
        "timeline.caption.structured",
        [...itemPath],
        "structured caption text requires non-empty cues, wordRefs, and sourceToOutputMap"
      )
    );
    return;
  }
  const wordIds = /* @__PURE__ */ new Set();
  wordRefs.forEach((word, wordIndex) => {
    if (nonEmptyString(word.id)) wordIds.add(word.id);
    if (!nonEmptyString(word.id) || !validFrameRange(word.sourceStartFrame, word.sourceEndFrame)) {
      issues.push(
        issue(
          "timeline.caption.lineage",
          [...itemPath, "wordRefs", wordIndex],
          "caption word reference requires an id and a valid source frame range"
        )
      );
    }
  });
  mappings.forEach((mapping, mappingIndex) => {
    if (!validFrameRange(mapping.sourceStartFrame, mapping.sourceEndFrame) || !validFrameRange(mapping.outputStartFrame, mapping.outputEndFrame)) {
      issues.push(
        issue(
          "timeline.caption.lineage",
          [...itemPath, "sourceToOutputMap", mappingIndex],
          "caption source-to-output mapping requires valid source and output frame ranges"
        )
      );
    }
  });
  cues.forEach((cue, cueIndex) => {
    const cueStart = cue.startFrame;
    const cueDuration = cue.durationInFrames;
    const cueEnd = typeof cueStart === "number" && typeof cueDuration === "number" ? cueStart + cueDuration : Number.NaN;
    const cueWordIds = Array.isArray(cue.wordIds) ? cue.wordIds : [];
    const covered = mappings.some(
      (mapping) => validFrameRange(mapping.sourceStartFrame, mapping.sourceEndFrame) && validFrameRange(mapping.outputStartFrame, mapping.outputEndFrame) && typeof cue.sourceStartFrame === "number" && typeof cue.sourceEndFrame === "number" && typeof cueStart === "number" && cue.sourceStartFrame >= mapping.sourceStartFrame && cue.sourceEndFrame <= mapping.sourceEndFrame && cueStart >= mapping.outputStartFrame && cueEnd <= mapping.outputEndFrame
    );
    if (!nonEmptyString(cue.id) || !nonEmptyString(cue.text) || !Number.isInteger(cueStart) || !Number.isInteger(cueDuration) || cueStart < 0 || cueDuration <= 0 || cueEnd > item.durationInFrames || !validFrameRange(cue.sourceStartFrame, cue.sourceEndFrame) || cueWordIds.length === 0 || cueWordIds.some(
      (wordId) => !nonEmptyString(wordId) || !wordIds.has(wordId)
    ) || !covered) {
      issues.push(
        issue(
          "timeline.caption.lineage",
          [...itemPath, "cues", cueIndex],
          "caption cue must fit the item and be covered by valid source word and frame lineage"
        )
      );
    }
  });
}
function createSemanticEvaluationContext(timeline) {
  const indexedItems = [];
  const itemById = /* @__PURE__ */ new Map();
  timeline.tracks.forEach((track, trackIndex) => {
    track.items.forEach((item, itemIndex) => {
      const indexed = { item, track, trackIndex, itemIndex };
      indexedItems.push(indexed);
      if (!itemById.has(item.id)) itemById.set(item.id, indexed);
    });
  });
  return { timeline, indexedItems, itemById };
}
function evaluateStructuralSemanticRules(context) {
  const { timeline, itemById } = context;
  const issues = [];
  const trackIds = /* @__PURE__ */ new Set();
  const itemIds = /* @__PURE__ */ new Set();
  let previousCategoryRank = -1;
  timeline.tracks.forEach((track, trackIndex) => {
    if (trackIds.has(track.id)) {
      issues.push(
        issue(
          "timeline.track.duplicate-id",
          ["tracks", trackIndex, "id"],
          `track id ${track.id} is duplicated`
        )
      );
    }
    trackIds.add(track.id);
    if (track.category) {
      const rank = TIMELINE_DSL_TRACK_CATEGORIES.indexOf(track.category);
      if (rank < previousCategoryRank) {
        issues.push(
          issue(
            "timeline.track.category-order",
            ["tracks", trackIndex, "category"],
            "track categories must follow effect, text, visual, primary, audio order"
          )
        );
      }
      previousCategoryRank = Math.max(previousCategoryRank, rank);
    }
    if (track.role && track.category) {
      const expectedCategory = TIMELINE_DSL_ROLE_CATEGORIES[track.role];
      if (expectedCategory !== null && expectedCategory !== track.category) {
        issues.push(
          issue(
            "timeline.track.role-category",
            ["tracks", trackIndex, "category"],
            `track role ${track.role} requires category ${expectedCategory}`
          )
        );
      }
    }
    const structuralCategories = new Set(
      track.items.map((item) => structuralCategory(item.type))
    );
    const legacyPrimary = timeline.primaryTrackId === track.id || track.role === "primary-video";
    const primaryCompatible = track.items.every(
      (item) => TIMELINE_DSL_CATEGORY_ALLOWED_ITEM_TYPES.primary.includes(item.type)
    );
    if (!track.category && structuralCategories.size > 1 && !(legacyPrimary && primaryCompatible)) {
      issues.push(
        issue(
          "timeline.track.mixed-categories",
          ["tracks", trackIndex, "items"],
          `track ${track.id} mixes incompatible structural item categories`
        )
      );
    }
    track.items.forEach((item, itemIndex) => {
      const itemPath = ["tracks", trackIndex, "items", itemIndex];
      if (itemIds.has(item.id)) {
        issues.push(
          issue(
            "timeline.item.duplicate-id",
            [...itemPath, "id"],
            `Timeline item id ${item.id} is duplicated`
          )
        );
      }
      itemIds.add(item.id);
      if (track.category) {
        const allowed = TIMELINE_DSL_CATEGORY_ALLOWED_ITEM_TYPES[track.category];
        if (!allowed.includes(item.type)) {
          issues.push(
            issue(
              "timeline.track.category-item-mismatch",
              [...itemPath],
              `track category ${track.category} cannot contain ${item.type} items`
            )
          );
        }
      }
      if (track.role) {
        const allowed = TIMELINE_DSL_ROLE_ALLOWED_ITEM_TYPES[track.role];
        if (!allowed.includes(item.type)) {
          issues.push(
            issue(
              "timeline.track.role-item-mismatch",
              [...itemPath],
              `track role ${track.role} cannot contain ${item.type} items`
            )
          );
        }
      }
      const expression = parseFromExpression(item.from);
      const negativeNumericString = typeof item.from === "string" && Number.isFinite(Number(item.from.trim())) && Number(item.from.trim()) < 0;
      if (!expression || negativeNumericString) {
        issues.push(
          issue(
            "timeline.item.from-expression",
            [...itemPath, "from"],
            "from must be a non-negative frame or a valid Timeline relative expression"
          )
        );
      } else if (expression.kind === "reference" && expression.refId !== "prev" && !itemById.has(expression.refId)) {
        issues.push(
          issue(
            "timeline.item.from-reference",
            [...itemPath, "from"],
            `from expression references unknown item ${expression.refId}`
          )
        );
      }
      if (expression && (expression.kind === "absolute" ? !Number.isInteger(expression.value) : !Number.isInteger(expression.offset))) {
        issues.push(
          issue(
            "timeline.item.frame-integer",
            [...itemPath, "from"],
            "Timeline frame positions and expression offsets must be integers"
          )
        );
      }
      if (["video", "audio", "image", "sticker"].includes(item.type)) {
        if (![item.src, item.assetId, item.sourceNodeId].some(nonEmptyString)) {
          issues.push(
            issue(
              "timeline.item.source-required",
              [...itemPath],
              `${item.type} item must provide src, assetId, or sourceNodeId`
            )
          );
        }
      }
      for (const animationField of [
        "entranceAnimation",
        "exitAnimation"
      ]) {
        const animation = item[animationField];
        if (animation && typeof animation.durationInFrames === "number" && animation.durationInFrames > item.durationInFrames) {
          issues.push(
            issue(
              "timeline.item.animation-duration",
              [...itemPath, animationField, "durationInFrames"],
              `${animationField} cannot exceed the owning item duration`
            )
          );
        }
      }
      const properties = item.properties;
      for (const field2 of ["width", "height"]) {
        const value = properties?.[field2];
        if (typeof value === "number" && Math.abs(value) > 4) {
          issues.push(
            issue(
              "timeline.item.scale-unit",
              [...itemPath, "properties", field2],
              `properties.${field2} is a unitless source-size multiplier, not pixels, and must be at most 4`
            )
          );
        }
      }
      if (item.type === "audio" && item.audioDucking !== void 0 && track.role !== "music") {
        issues.push(
          issue(
            "timeline.audio.ducking-track-role",
            [...itemPath, "audioDucking"],
            "audioDucking is only valid for audio items on a music track"
          )
        );
      }
      if (item.type === "composition") {
        if (!isLocalProjectPath(item.sourcePath)) {
          issues.push(
            issue(
              "timeline.composition.local-path",
              [...itemPath, "sourcePath"],
              "composition sourcePath must be a local project path"
            )
          );
        }
        if (item.renderedAssetPath !== void 0 && !isLocalProjectPath(item.renderedAssetPath)) {
          issues.push(
            issue(
              "timeline.composition.local-path",
              [...itemPath, "renderedAssetPath"],
              "composition renderedAssetPath must be a local project path"
            )
          );
        }
        if (item.compositionKind === "motion-graphics" && item.runtime !== "remotion") {
          issues.push(
            issue(
              "timeline.composition.preview-contract",
              [...itemPath, "runtime"],
              "motion-graphics compositions must use Remotion with a live Canvas sourceNodeId"
            )
          );
        }
        if (item.runtime === "remotion" && (typeof item.sourceNodeId !== "string" || item.sourceNodeId.length === 0)) {
          issues.push(
            issue(
              "timeline.composition.preview-contract",
              [...itemPath, "sourceNodeId"],
              "Remotion compositions require a live Canvas sourceNodeId"
            )
          );
        }
        if (item.runtime === "react" && !isLocalProjectPath(item.renderedAssetPath)) {
          issues.push(
            issue(
              "timeline.composition.preview-contract",
              [...itemPath, "renderedAssetPath"],
              "React compositions require a local renderedAssetPath"
            )
          );
        }
      }
      if (item.type === "derived-overlay") {
        if (!isLocalProjectPath(item.src)) {
          issues.push(
            issue(
              "timeline.derived-overlay.local-path",
              [...itemPath, "src"],
              "derived overlay src must be a local project or asset path"
            )
          );
        }
        if (item.sourceAssetId === item.derivedAssetId || nonEmptyString(item.assetId) && item.assetId !== item.derivedAssetId) {
          issues.push(
            issue(
              "timeline.derived-overlay.copy-on-write",
              [...itemPath],
              "derived overlay source and derived identities must be distinct and assetId must identify the derived copy"
            )
          );
        }
      }
    });
  });
  return issues;
}
function evaluatePrimaryTrackSemanticRules(context) {
  const { timeline } = context;
  const issues = [];
  if (nonEmptyString(timeline.primaryTrackId)) {
    const primaryTrack = timeline.tracks.find(
      (track) => track.id === timeline.primaryTrackId
    );
    if (!primaryTrack) {
      issues.push(
        issue(
          "timeline.primary-track.reference",
          ["primaryTrackId"],
          "primaryTrackId must reference an existing track"
        )
      );
    } else if (primaryTrack.category && primaryTrack.category !== "primary") {
      issues.push(
        issue(
          "timeline.primary-track.category",
          ["primaryTrackId"],
          "primaryTrackId must reference a primary category track"
        )
      );
    }
  }
  return issues;
}
function evaluateReferenceCycleSemanticRules(context) {
  const issues = [];
  pushReferenceCycleIssues(context.indexedItems, context.itemById, issues);
  return issues;
}
function evaluateCaptionSemanticRules(context) {
  const issues = [];
  context.indexedItems.forEach((indexed) => validateCaption(indexed, issues));
  return issues;
}
function evaluateTransitionSemanticRules(context) {
  const issues = [];
  context.indexedItems.forEach(
    (indexed) => validateTransition(indexed, context.itemById, issues)
  );
  return issues;
}
var TIMELINE_DSL_GLOBAL_SEMANTIC_EVALUATORS = Object.freeze({
  "timeline.track.duplicate-id": evaluateStructuralSemanticRules,
  "timeline.item.duplicate-id": evaluateStructuralSemanticRules,
  "timeline.primary-track.reference": evaluatePrimaryTrackSemanticRules,
  "timeline.primary-track.category": evaluatePrimaryTrackSemanticRules,
  "timeline.track.category-item-mismatch": evaluateStructuralSemanticRules,
  "timeline.track.role-item-mismatch": evaluateStructuralSemanticRules,
  "timeline.track.role-category": evaluateStructuralSemanticRules,
  "timeline.track.category-order": evaluateStructuralSemanticRules,
  "timeline.track.mixed-categories": evaluateStructuralSemanticRules,
  "timeline.item.from-expression": evaluateStructuralSemanticRules,
  "timeline.item.frame-integer": evaluateStructuralSemanticRules,
  "timeline.item.from-reference": evaluateStructuralSemanticRules,
  "timeline.item.from-cycle": evaluateReferenceCycleSemanticRules,
  "timeline.item.source-required": evaluateStructuralSemanticRules,
  "timeline.item.animation-duration": evaluateStructuralSemanticRules,
  "timeline.item.scale-unit": evaluateStructuralSemanticRules,
  "timeline.audio.ducking-track-role": evaluateStructuralSemanticRules,
  "timeline.composition.local-path": evaluateStructuralSemanticRules,
  "timeline.composition.preview-contract": evaluateStructuralSemanticRules,
  "timeline.caption.structured": evaluateCaptionSemanticRules,
  "timeline.caption.lineage": evaluateCaptionSemanticRules,
  "timeline.derived-overlay.local-path": evaluateStructuralSemanticRules,
  "timeline.derived-overlay.copy-on-write": evaluateStructuralSemanticRules,
  "timeline.transition.reference": evaluateTransitionSemanticRules,
  "timeline.transition.continuity": evaluateTransitionSemanticRules,
  "timeline.transition.centered-range": evaluateTransitionSemanticRules,
  "timeline.transition.duration-handles": evaluateTransitionSemanticRules
});
function timelineDslSemanticIssues(input) {
  const context = createSemanticEvaluationContext(input);
  const issues = [];
  const compositeEvaluators = new Set(
    Object.values(TIMELINE_DSL_GLOBAL_SEMANTIC_EVALUATORS)
  );
  for (const evaluator of compositeEvaluators)
    issues.push(...evaluator(context));
  return issues;
}
var itemVariantSchemas = TIMELINE_DSL_ITEM_TYPES.map((type) => {
  const baseShape = timelineDslAnnotatedObjectShape(
    TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase,
    {
      overrides: {
        type: z.literal(type).describe(TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase.type.description)
      }
    }
  );
  const variantShape = timelineDslAnnotatedObjectShape(
    TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes[type]
  );
  return z.object({ ...baseShape, ...variantShape }).passthrough();
});
var TimelineDslItemVariantSchema = z.discriminatedUnion(
  "type",
  itemVariantSchemas
);
var itemFieldOwners = /* @__PURE__ */ new Map();
for (const type of TIMELINE_DSL_ITEM_TYPES) {
  for (const fieldName of Object.keys(
    TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes[type]
  )) {
    const owners = itemFieldOwners.get(fieldName) ?? /* @__PURE__ */ new Set();
    owners.add(type);
    itemFieldOwners.set(fieldName, owners);
  }
}
var maskKeyframeChannels = new Set(TIMELINE_MASK_KEYFRAME_CHANNELS);
var itemBaseFieldApplicabilityRules = Object.entries(
  TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase
).flatMap(
  ([fieldName, annotation2]) => annotation2.appliesToItemTypes && annotation2.applicabilityRuleId ? [
    {
      id: annotation2.applicabilityRuleId,
      kind: "allowed-item-types-when-present",
      objectPath: "tracks[].items[]",
      field: fieldName,
      allowedItemTypes: annotation2.appliesToItemTypes,
      ...annotation2.applicabilityMessage ? { message: annotation2.applicabilityMessage } : {}
    }
  ] : []
);
var clipMaskRequiresMaskRule = {
  id: "timeline.clip-mask.requires-mask",
  kind: "requires-field-when-any-channel-present",
  objectPath: "tracks[].items[]",
  channelContainer: "keyframes",
  channels: TIMELINE_MASK_KEYFRAME_CHANNELS,
  requiredField: "mask"
};
var timelineKeyframeRangeRule = {
  id: "timeline.keyframes.frame-range",
  kind: "frame-range-by-owner-duration",
  objectPath: "tracks[].items[]",
  channelContainer: "keyframes",
  channels: TIMELINE_KEYFRAME_CHANNELS,
  key: "frame",
  minimum: 0,
  exclusiveMaximumPath: "durationInFrames"
};
var timelineKeyframeUniqueFrameRule = {
  id: "timeline.keyframes.unique-frame",
  kind: "unique-key-by-channel",
  objectPath: "tracks[].items[]",
  channelContainer: "keyframes",
  channels: TIMELINE_KEYFRAME_CHANNELS,
  key: "frame"
};
var timelineItemFieldApplicabilityRule = {
  id: "timeline.item.field-applicability",
  kind: "field-applicability-by-discriminator",
  objectPath: "tracks[].items[]",
  discriminator: "type",
  registry: "fieldCatalog.itemTypes"
};
var TIMELINE_DSL_SEMANTIC_RULES = {
  version: 2,
  rules: [
    ...itemBaseFieldApplicabilityRules,
    clipMaskRequiresMaskRule,
    timelineKeyframeRangeRule,
    timelineKeyframeUniqueFrameRule,
    timelineItemFieldApplicabilityRule,
    ...TIMELINE_DSL_GLOBAL_SEMANTIC_RULES
  ]
};
function hasMaskKeyframes(keyframes) {
  return Object.keys(keyframes ?? {}).some(
    (channel) => maskKeyframeChannels.has(channel)
  );
}
function timelineMaskKeyframeSemanticIssues(item) {
  const issues = [];
  for (const rule of itemBaseFieldApplicabilityRules) {
    if (Object.prototype.hasOwnProperty.call(item, rule.field) && item[rule.field] !== void 0 && !rule.allowedItemTypes.includes(item.type)) {
      issues.push({
        ruleId: rule.id,
        path: [rule.field],
        message: rule.message ?? `${rule.field} is only valid on ${rule.allowedItemTypes.join(", ")} items`
      });
    }
  }
  if (!item.mask && hasMaskKeyframes(item.keyframes)) {
    issues.push({
      ruleId: clipMaskRequiresMaskRule.id,
      path: ["keyframes"],
      message: "mask keyframes require a mask"
    });
  }
  for (const frameIssue of timelineKeyframeFrameIssues(
    item.keyframes,
    item.durationInFrames
  )) {
    issues.push({
      ruleId: frameIssue.reason === "duplicate" ? timelineKeyframeUniqueFrameRule.id : timelineKeyframeRangeRule.id,
      path: ["keyframes", frameIssue.channel, frameIssue.index, "frame"],
      message: frameIssue.reason === "duplicate" ? `duplicate keyframe at item-local frame ${frameIssue.frame}` : `item-local frame must be between 0 and ${item.durationInFrames - 1}`
    });
  }
  return issues;
}
var TimelineDslItemSchema = TimelineDslItemVariantSchema.superRefine(
  (item, ctx) => {
    const typedItem = item;
    for (const [fieldName, owners] of itemFieldOwners) {
      if (Object.prototype.hasOwnProperty.call(typedItem, fieldName) && !owners.has(typedItem.type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [fieldName],
          message: `${fieldName} is not valid on ${typedItem.type} items`,
          params: { ruleId: timelineItemFieldApplicabilityRule.id }
        });
      }
    }
    for (const issue2 of timelineMaskKeyframeSemanticIssues(typedItem)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: issue2.path,
        message: issue2.message,
        params: { ruleId: issue2.ruleId }
      });
    }
  }
).describe("TimelineDslItem");
var TimelineDslTrackSchema = z.object(
  timelineDslAnnotatedObjectShape(TIMELINE_DSL_FIELD_ANNOTATIONS.track, {
    overrides: { items: z.array(TimelineDslItemSchema) }
  })
).passthrough().describe("TimelineDslTrack");
var TimelineDslSchemaBase = z.object(
  timelineDslAnnotatedObjectShape(TIMELINE_DSL_FIELD_ANNOTATIONS.root, {
    overrides: { tracks: z.array(TimelineDslTrackSchema) }
  })
).passthrough();
var TimelineDslSchema = TimelineDslSchemaBase.superRefine(
  (timeline, context) => {
    for (const semanticIssue of timelineDslSemanticIssues(timeline)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: semanticIssue.path,
        message: semanticIssue.message,
        params: { ruleId: semanticIssue.ruleId }
      });
    }
  }
).describe("TimelineDsl");
var timelineDslJsonSchema = zodToJsonSchema(TimelineDslSchema, {
  name: "TimelineDsl",
  target: "jsonSchema7"
});
var timelineItemMaskJsonSchema = zodToJsonSchema(TimelineItemMaskSchema, {
  name: "TimelineItemMask",
  target: "jsonSchema7"
});
var timelineItemKeyframesJsonSchema = zodToJsonSchema(
  TimelineItemKeyframesSchema,
  {
    name: "TimelineItemKeyframes",
    target: "jsonSchema7"
  }
);
function jsonSchemaObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Timeline DSL JSON Schema is missing ${label}`);
  }
  return value;
}
function jsonSchemaObjectAtPath(root, path) {
  let current = root;
  for (const segment of path) {
    current = jsonSchemaObject(current, path.join("."))[segment];
  }
  return jsonSchemaObject(current, path.join("."));
}
var timelineDslJsonSchemaDefinitions = jsonSchemaObjectAtPath(
  timelineDslJsonSchema,
  ["definitions"]
);
timelineDslJsonSchemaDefinitions.TimelineItemMask = jsonSchemaObjectAtPath(
  timelineItemMaskJsonSchema,
  ["definitions", "TimelineItemMask"]
);
timelineDslJsonSchemaDefinitions.TimelineItemKeyframes = jsonSchemaObjectAtPath(
  timelineItemKeyframesJsonSchema,
  ["definitions", "TimelineItemKeyframes"]
);
var timelineDslItemJsonSchema = jsonSchemaObjectAtPath(
  timelineDslJsonSchema,
  [
    "definitions",
    "TimelineDsl",
    "properties",
    "tracks",
    "items",
    "properties",
    "items",
    "items"
  ]
);
timelineDslItemJsonSchema.allOf = [
  ...itemBaseFieldApplicabilityRules.map((rule) => ({
    if: { required: [rule.field] },
    then: {
      properties: {
        type: { enum: [...rule.allowedItemTypes] }
      }
    }
  })),
  {
    if: {
      required: [clipMaskRequiresMaskRule.channelContainer],
      properties: {
        [clipMaskRequiresMaskRule.channelContainer]: {
          anyOf: clipMaskRequiresMaskRule.channels.map((channel) => ({
            required: [channel]
          }))
        }
      }
    },
    then: { required: [clipMaskRequiresMaskRule.requiredField] }
  }
];
var timelineDslJsonSchemaFragments = {
  TimelineItemMask: timelineItemMaskJsonSchema,
  TimelineItemKeyframes: timelineItemKeyframesJsonSchema
};
var timelineMaskExample = Object.fromEntries(
  Object.entries(TIMELINE_MASK_FIELD_ANNOTATIONS).map(([field2, annotation2]) => [
    field2,
    "exampleValue" in annotation2 ? annotation2.exampleValue : annotation2.defaultValue
  ])
);
var timelineMaskKeyframesExample = Object.fromEntries(
  TIMELINE_MASK_ANIMATION_BINDINGS.map((binding, bindingIndex) => [
    binding.channel,
    [
      { frame: 0, value: binding.exampleValues[0], interpolation: "linear" },
      {
        frame: 59,
        value: binding.exampleValues[1],
        interpolation: bindingIndex === 0 ? "hold" : "linear"
      }
    ]
  ])
);
var TIMELINE_MASK_KEYFRAMES_DSL_EXAMPLE = {
  compositionWidth: 1920,
  compositionHeight: 1080,
  fps: 30,
  durationInFrames: 60,
  tracks: [
    {
      id: "visual-overlays",
      name: "Visual overlays",
      category: "visual",
      items: [
        {
          id: "masked-image",
          type: "image",
          from: 0,
          durationInFrames: 60,
          sourceNodeId: "source-image-node",
          mask: timelineMaskExample,
          keyframes: timelineMaskKeyframesExample
        }
      ]
    }
  ]
};
var timelineMaskDslFeature = {
  yamlPath: TIMELINE_MASK_CAPABILITY_ANNOTATION.yamlPath,
  appliesToItemTypes: TIMELINE_MASK_CAPABILITY_ANNOTATION.appliesToItemTypes,
  excludedItemTypes: TIMELINE_MASK_CAPABILITY_ANNOTATION.excludedItemTypes,
  staticFields: TIMELINE_MASK_CAPABILITY_ANNOTATION.staticFields,
  animatedChannels: TIMELINE_MASK_CAPABILITY_ANNOTATION.animatedChannels,
  defaultMask: TIMELINE_MASK_CAPABILITY_ANNOTATION.defaultMask,
  fieldDefinitions: Object.fromEntries(
    Object.entries(TIMELINE_MASK_FIELD_ANNOTATIONS).map(
      ([field2, annotation2]) => [
        field2,
        {
          description: annotation2.description,
          invalidValueDescription: annotation2.invalidValueDescription,
          unit: annotation2.unit,
          defaultValue: annotation2.defaultValue,
          animatedChannel: "animation" in annotation2 ? annotation2.animation?.channel ?? null : null
        }
      ]
    )
  ),
  operations: TIMELINE_MASK_CAPABILITY_ANNOTATION.operations,
  runtimeBehavior: TIMELINE_MASK_CAPABILITY_ANNOTATION.runtimeBehavior,
  semantics: TIMELINE_MASK_CAPABILITY_ANNOTATION.semantics
};
function canonicalTimelineDslContractJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalTimelineDslContractJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, entry]) => entry !== void 0).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(
      ([key, entry]) => `${JSON.stringify(key)}:${canonicalTimelineDslContractJson(entry)}`
    ).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function timelineDslContractFingerprint(value) {
  const canonical = canonicalTimelineDslContractJson(value);
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
var timelineDslSerializableDefinition = {
  schemaVersion: 7,
  format: "clash.timeline.yaml",
  description: "Agent-facing Timeline YAML DSL. Pull before editing and apply with the matching read proof.",
  fieldCatalog: TIMELINE_DSL_FIELD_CATALOG,
  operationCatalog: TIMELINE_OPERATION_CATALOG,
  taxonomy: {
    itemTypes: TIMELINE_DSL_ITEM_TYPES,
    trackCategories: TIMELINE_DSL_TRACK_CATEGORIES,
    trackRoles: TIMELINE_DSL_TRACK_ROLES,
    categoryAllowedItemTypes: TIMELINE_DSL_CATEGORY_ALLOWED_ITEM_TYPES,
    roleAllowedItemTypes: TIMELINE_DSL_ROLE_ALLOWED_ITEM_TYPES,
    roleCategories: TIMELINE_DSL_ROLE_CATEGORIES,
    runtimeConsumers: TIMELINE_DSL_RUNTIME_CONSUMERS,
    mediaFits: TIMELINE_MEDIA_FITS,
    clipAnimationTypes: TIMELINE_CLIP_ANIMATION_TYPES,
    textAlignments: TIMELINE_TEXT_ALIGNMENTS,
    captionPositions: TIMELINE_CAPTION_POSITIONS,
    compositionKinds: TIMELINE_COMPOSITION_KINDS,
    compositionRuntimes: TIMELINE_COMPOSITION_RUNTIMES,
    derivedMediaTypes: TIMELINE_DERIVED_MEDIA_TYPES,
    derivationKinds: TIMELINE_DERIVATION_KINDS,
    transitionTypes: TIMELINE_TRANSITION_TYPES
  },
  validation: {
    structuralContract: "jsonSchema",
    semanticContract: "jsonSchema.x-clash-semantic-rules",
    typescriptFunction: "validateTimelineDsl(state)",
    cliCommand: "clash timeline validate --file <path> --json",
    mcpTool: "clash_timeline_validate"
  },
  jsonSchema: {
    ...timelineDslJsonSchema,
    "x-clash-fragments": timelineDslJsonSchemaFragments,
    "x-clash-features": {
      clipMask: timelineMaskDslFeature,
      itemTransform: TIMELINE_ITEM_TRANSFORM_SEMANTICS
    },
    "x-clash-semantic-rules": TIMELINE_DSL_SEMANTIC_RULES
  },
  features: {
    clipMask: timelineMaskDslFeature,
    itemTransform: TIMELINE_ITEM_TRANSFORM_SEMANTICS
  },
  examples: {
    maskKeyframes: TIMELINE_MASK_KEYFRAMES_DSL_EXAMPLE
  }
};
var TIMELINE_DSL_DEFINITION = {
  ...timelineDslSerializableDefinition,
  contractFingerprint: timelineDslContractFingerprint(
    timelineDslSerializableDefinition
  )
};

// ../../packages/shared-types/dist/chunk-QEJHP4RV.js
var TIMELINE_LIBRARY_CATEGORIES = [
  "text",
  "stickers",
  "sound-effects",
  "transitions",
  "fx",
  "zoom",
  "luts",
  "audio-fx",
  "captions",
  "filters",
  "adjustments"
];
var TimelineLibraryGroupIdSchema = z.enum([
  "recommended",
  "text",
  "graphics",
  "transitions",
  "visual-effects",
  "color-looks",
  "audio"
]);
var StableCatalogIdSchema = z.string().regex(
  /^[a-z0-9][a-z0-9._:/-]*$/,
  "Catalog ids must be stable lower-case identifiers."
);
var VersionSchema = z.number().int().positive();
var TimelineLibraryCollectionQuerySchema = z.object({
  categories: z.array(z.enum(TIMELINE_LIBRARY_CATEGORIES)).min(1).optional(),
  tags: z.array(z.string().min(1)).min(1).optional(),
  favoriteOnly: z.literal(true).optional()
}).strict().refine(
  (query) => Boolean(query.favoriteOnly || query.categories?.length || query.tags?.length),
  "A collection query must select a category, tag, or favorites."
);
var TimelineLibraryCollectionSchema = z.object({
  id: StableCatalogIdSchema,
  label: z.string().min(1),
  groupId: TimelineLibraryGroupIdSchema,
  parentId: StableCatalogIdSchema.optional(),
  query: TimelineLibraryCollectionQuerySchema
}).strict();
var TimelineLibraryDeliverySchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("bundled") }).strict(),
  z.object({ state: z.literal("remote") }).strict(),
  z.object({
    state: z.literal("downloading"),
    progress: z.number().min(0).max(1)
  }).strict(),
  z.object({ state: z.literal("installed") }).strict(),
  z.object({
    state: z.literal("failed"),
    message: z.string().min(1)
  }).strict()
]);
var TimelineLibraryItemViewStateSchema = z.object({
  itemId: StableCatalogIdSchema,
  favorite: z.boolean(),
  access: z.enum(["free", "entitled", "requires-upgrade"]),
  delivery: TimelineLibraryDeliverySchema
}).strict();
var TimelineLibraryProvenanceSchema = z.object({
  provider: z.string().min(1),
  upstreamId: z.string().min(1).optional(),
  sourceUrl: z.string().url().optional(),
  license: z.string().min(1).optional(),
  adapted: z.boolean().optional()
}).strict();
var TimelineLibraryBaseShape = {
  id: StableCatalogIdSchema,
  version: VersionSchema,
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)),
  thumbnail: z.object({
    kind: z.enum(["image", "video"]),
    src: z.string().min(1)
  }).strict().optional(),
  provenance: TimelineLibraryProvenanceSchema.optional(),
  agent: z.object({
    description: z.string().min(1),
    searchTerms: z.array(z.string().min(1)),
    catalogFirst: z.literal(true)
  }).strict().optional()
};
var EffectRefSchema = z.object({
  kind: z.literal("effect-ref"),
  effectId: StableCatalogIdSchema,
  effectVersion: VersionSchema,
  params: z.record(z.unknown()).optional()
}).strict();
var CaptionStyleSchema = z.object({
  fontFamily: z.string().min(1).optional(),
  fontSize: z.number().positive().optional(),
  fontWeight: z.union([z.string().min(1), z.number().positive()]).optional(),
  color: z.string().min(1).optional(),
  backgroundColor: z.string().min(1).optional(),
  position: z.enum(["bottom", "top", "center"]).optional()
}).strict();
var TextLibraryItemSchema = z.object({
  ...TimelineLibraryBaseShape,
  category: z.literal("text"),
  artifact: z.object({
    kind: z.literal("text-preset"),
    text: z.string().min(1),
    color: z.string().min(1),
    fontSize: z.number().positive().optional(),
    fontFamily: z.string().min(1).optional(),
    fontWeight: z.string().min(1).optional()
  }).strict(),
  apply: z.object({ kind: z.literal("insert-text-item") }).strict()
}).strict();
var StickerLibraryItemSchema = z.object({
  ...TimelineLibraryBaseShape,
  category: z.literal("stickers"),
  artifact: z.object({
    kind: z.literal("sticker-asset"),
    src: z.string().min(1),
    assetId: StableCatalogIdSchema.optional()
  }).strict(),
  apply: z.object({ kind: z.literal("insert-sticker-item") }).strict()
}).strict();
var SoundEffectLibraryItemSchema = z.object({
  ...TimelineLibraryBaseShape,
  category: z.literal("sound-effects"),
  artifact: z.object({
    kind: z.literal("audio-asset"),
    assetId: StableCatalogIdSchema
  }).strict(),
  apply: z.object({
    kind: z.literal("insert-audio-item")
  }).strict()
}).strict();
var TransitionLibraryItemSchema = z.object({
  ...TimelineLibraryBaseShape,
  category: z.literal("transitions"),
  artifact: EffectRefSchema,
  apply: z.object({
    kind: z.literal("attach-transition"),
    binding: z.literal("between-items")
  }).strict()
}).strict();
var VisualEffectLibraryItemSchema = z.object({
  ...TimelineLibraryBaseShape,
  category: z.literal("fx"),
  artifact: EffectRefSchema,
  apply: z.object({
    kind: z.literal("attach-visual-effect"),
    binding: z.literal("item-or-range")
  }).strict()
}).strict();
var ZoomLibraryItemSchema = z.object({
  ...TimelineLibraryBaseShape,
  category: z.literal("zoom"),
  artifact: EffectRefSchema,
  apply: z.object({
    kind: z.literal("attach-visual-effect"),
    binding: z.literal("track-range")
  }).strict()
}).strict();
var LutLibraryItemSchema = z.object({
  ...TimelineLibraryBaseShape,
  category: z.literal("luts"),
  artifact: z.discriminatedUnion("kind", [
    EffectRefSchema,
    z.object({
      kind: z.literal("lut-asset"),
      assetId: StableCatalogIdSchema
    }).strict()
  ]),
  apply: z.object({
    kind: z.literal("attach-color-look"),
    binding: z.literal("item")
  }).strict()
}).strict();
var AudioEffectLibraryItemSchema = z.object({
  ...TimelineLibraryBaseShape,
  category: z.literal("audio-fx"),
  artifact: z.object({
    kind: z.literal("audio-processor-ref"),
    processorId: StableCatalogIdSchema,
    processorVersion: VersionSchema,
    params: z.record(z.unknown()).optional()
  }).strict(),
  apply: z.object({
    kind: z.literal("attach-audio-effect"),
    binding: z.literal("audio-item-or-track")
  }).strict()
}).strict();
var CaptionLibraryItemSchema = z.object({
  ...TimelineLibraryBaseShape,
  category: z.literal("captions"),
  artifact: z.object({
    kind: z.literal("caption-style"),
    style: CaptionStyleSchema
  }).strict(),
  apply: z.object({ kind: z.literal("update-caption-style") }).strict()
}).strict();
var FilterLibraryItemSchema = z.object({
  ...TimelineLibraryBaseShape,
  category: z.literal("filters"),
  artifact: EffectRefSchema,
  apply: z.object({
    kind: z.literal("attach-color-look"),
    binding: z.literal("item")
  }).strict()
}).strict();
var AdjustmentLibraryItemSchema = z.object({
  ...TimelineLibraryBaseShape,
  category: z.literal("adjustments"),
  artifact: EffectRefSchema,
  apply: z.object({
    kind: z.literal("attach-visual-effect"),
    binding: z.literal("item")
  }).strict()
}).strict();
var TimelineLibraryItemSchema = z.discriminatedUnion("category", [
  TextLibraryItemSchema,
  StickerLibraryItemSchema,
  SoundEffectLibraryItemSchema,
  TransitionLibraryItemSchema,
  VisualEffectLibraryItemSchema,
  ZoomLibraryItemSchema,
  LutLibraryItemSchema,
  AudioEffectLibraryItemSchema,
  CaptionLibraryItemSchema,
  FilterLibraryItemSchema,
  AdjustmentLibraryItemSchema
]);

// ../../packages/shared-types/dist/index.js
import { LoroMap as LoroMap5 } from "loro-crdt";

// ../../packages/shared-layout/dist/index.js
var ACTION_BADGE_NODE_SIZE = Object.freeze({
  width: 260,
  height: 58
});

// ../../packages/shared-types/dist/index.js
import { LoroMap as LoroMap4 } from "loro-crdt";
import { LoroMap as LoroMap2 } from "loro-crdt";
import { LoroMap } from "loro-crdt";
import { LoroMap as LoroMap3 } from "loro-crdt";
var import_yaml = __toESM(require_dist(), 1);
import { LoroDoc } from "loro-crdt";
var AgentAnnotationSurfaceSchema = z.enum([
  "canvas",
  "timeline",
  "director-stage",
  // Project assets annotated from the workspace sidebar / asset views.
  "asset"
]);
var AgentAnnotationVisualRectSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().positive().max(1),
  height: z.number().finite().positive().max(1)
});
var AgentAnnotationSelectionSchema = z.object({
  kind: z.literal("text-quote"),
  exact: z.string().trim().min(1).max(4e3),
  prefix: z.string().max(256).optional(),
  suffix: z.string().max(256).optional(),
  visualRects: z.array(AgentAnnotationVisualRectSchema).max(32).optional()
});
var AgentAnnotationTargetSchema = z.object({
  projectId: z.string().trim().min(1),
  surface: AgentAnnotationSurfaceSchema,
  surfaceId: z.string().trim().min(1),
  surfaceLabel: z.string().trim().min(1),
  revisionId: z.string().trim().min(1).optional(),
  objectId: z.string().trim().min(1),
  objectType: z.string().trim().min(1),
  objectLabel: z.string().trim().min(1),
  parentId: z.string().trim().min(1).optional(),
  objectPath: z.string().trim().min(1),
  capabilities: z.array(z.enum(["read", "modify"])).min(1),
  selection: AgentAnnotationSelectionSchema.optional(),
  /** Asset backing the annotated object, when it has one — lets chat surfaces show a media preview. */
  previewAssetId: z.string().trim().min(1).optional()
});
var AgentAnnotationDraftSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.literal("agent-annotation"),
  note: z.string().max(4e3),
  target: AgentAnnotationTargetSchema
});
var AgentAnnotationPromptPayloadSchema = z.object({
  version: z.literal(1),
  kind: z.literal("clash-agent-annotations"),
  annotations: z.array(AgentAnnotationDraftSchema).min(1)
});
var FrameRangeSchema = z.object({
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(0)
});
var AudioBeatSchema = z.object({
  frame: z.number().int().min(0),
  timeSeconds: z.number().min(0),
  confidence: z.number().min(0).max(1),
  bar: z.number().int().positive().optional(),
  beatInBar: z.number().int().positive().optional(),
  downbeat: z.boolean().optional()
});
var AudioEnergyPointSchema = z.object({
  frame: z.number().int().min(0),
  timeSeconds: z.number().min(0),
  rms: z.number().min(0),
  normalized: z.number().min(0).max(1),
  novelty: z.number().min(0).max(1),
  impact: z.number().min(0).max(1)
});
var AudioSectionSchema = z.object({
  id: z.string().min(1),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(0),
  label: z.string().min(1),
  semanticLabel: z.enum([
    "intro",
    "verse",
    "pre-chorus",
    "chorus",
    "bridge",
    "drop",
    "buildup",
    "breakdown",
    "outro",
    "instrumental",
    "detected-beats",
    "unknown"
  ]).optional(),
  semanticConfidence: z.number().min(0).max(1).optional(),
  reviewRequired: z.boolean().optional(),
  semanticSource: z.string().min(1).optional(),
  energy: z.number().min(0).max(1).optional(),
  novelty: z.number().min(0).max(1).optional(),
  impact: z.number().min(0).max(1).optional(),
  cutDensity: z.enum(["hold", "medium", "fast"]).optional()
});
var AudioBeatMetadataSchema = z.object({
  kind: z.literal("audio.beat-analysis"),
  bpm: z.number().positive(),
  fps: z.number().positive(),
  beats: z.array(AudioBeatSchema),
  sections: z.array(AudioSectionSchema).default([]),
  energyCurve: z.array(AudioEnergyPointSchema).default([])
});
var AudioStemTypeSchema = z.enum(["vocal", "instrumental", "drums", "bass", "other"]);
var AudioStemAssetSchema = z.object({
  stemAssetId: z.string().min(1),
  stemType: AudioStemTypeSchema,
  filePath: z.string().min(1),
  fileHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  codec: z.string().min(1).optional(),
  durationSeconds: z.number().positive().optional(),
  sampleRate: z.number().int().positive().optional(),
  channels: z.number().int().positive().optional()
});
var AudioStemSeparationMetadataSchema = z.object({
  kind: z.literal("audio.stem-separation"),
  separationId: z.string().min(1),
  sourceAssetId: z.string().min(1),
  sourcePath: z.string().min(1).optional(),
  backendId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
  stems: z.array(AudioStemAssetSchema).min(1),
  vocalStemAssetId: z.string().min(1).optional(),
  decisionLog: z.array(z.string().min(1)).default([])
});
var LyricsAlignmentUnitSchema = z.object({
  lineId: z.string().min(1),
  wordId: z.string().min(1).optional(),
  text: z.string().min(1),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  startFrame: z.number().int().min(0).optional(),
  endFrame: z.number().int().min(0).optional(),
  confidence: z.number().min(0).max(1),
  source: z.string().min(1)
}).refine((unit) => unit.endMs > unit.startMs, {
  message: "lyrics alignment unit endMs must be greater than startMs",
  path: ["endMs"]
});
var LyricsUnmatchedRangeSchema = z.object({
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  text: z.string().optional(),
  reason: z.string().optional()
}).refine((range) => range.endMs > range.startMs, {
  message: "lyrics unmatched range endMs must be greater than startMs",
  path: ["endMs"]
});
var LyricsAlignmentMetadataSchema = z.object({
  kind: z.literal("audio.lyrics-alignment"),
  fps: z.number().positive(),
  lyricsSource: z.string().min(1),
  vocalStemAssetId: z.string().min(1).optional(),
  units: z.array(LyricsAlignmentUnitSchema).min(1),
  unmatchedRanges: z.array(LyricsUnmatchedRangeSchema).default([])
});
var AsrTimedWordSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  confidence: z.number().min(0).max(1).optional(),
  speakerId: z.string().min(1).optional()
}).refine((word) => word.endMs > word.startMs, {
  message: "ASR word endMs must be greater than startMs",
  path: ["endMs"]
});
var AsrTimedSegmentSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  wordIds: z.array(z.string().min(1)),
  speakerId: z.string().min(1).optional()
}).refine((segment) => segment.endMs > segment.startMs, {
  message: "ASR segment endMs must be greater than startMs",
  path: ["endMs"]
});
var AsrTimedTranscriptSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("clash.asr.timed-transcript"),
  timebase: z.literal("milliseconds"),
  alignment: z.literal("word"),
  text: z.string().min(1),
  backendId: z.string().min(1),
  modelId: z.string().min(1),
  language: z.string().min(1).optional(),
  durationMs: z.number().int().min(0),
  words: z.array(AsrTimedWordSchema).min(1),
  segments: z.array(AsrTimedSegmentSchema)
}).superRefine((transcript, context) => {
  const wordIds = /* @__PURE__ */ new Set();
  let previousStartMs = -1;
  let maxEndMs = 0;
  transcript.words.forEach((word, index) => {
    if (wordIds.has(word.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate ASR word id: ${word.id}`,
        path: ["words", index, "id"]
      });
    }
    wordIds.add(word.id);
    if (word.startMs < previousStartMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ASR words must be ordered by startMs",
        path: ["words", index, "startMs"]
      });
    }
    previousStartMs = word.startMs;
    maxEndMs = Math.max(maxEndMs, word.endMs);
  });
  if (transcript.durationMs < maxEndMs) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ASR durationMs must cover every word",
      path: ["durationMs"]
    });
  }
  transcript.segments.forEach((segment, segmentIndex) => {
    segment.wordIds.forEach((wordId, wordIndex) => {
      if (!wordIds.has(wordId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `ASR segment references unknown word id: ${wordId}`,
          path: ["segments", segmentIndex, "wordIds", wordIndex]
        });
      }
    });
  });
});
var TranscriptWordSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(0),
  confidence: z.number().min(0).max(1).optional(),
  speakerId: z.string().min(1).optional()
});
var AsrTranscriptMetadataSchema = z.object({
  kind: z.literal("asr-transcript"),
  sourcePath: z.string().min(1),
  sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  backendId: z.string().min(1),
  modelId: z.string().min(1),
  language: z.string().min(1).optional(),
  durationFrames: z.number().int().min(0).optional(),
  wordCount: z.number().int().nonnegative(),
  averageConfidence: z.number().min(0).max(1).optional()
});
var TextCutSchema = z.object({
  id: z.string().min(1),
  sourceStartFrame: z.number().int().min(0),
  sourceEndFrame: z.number().int().min(0),
  outputStartFrame: z.number().int().min(0),
  outputEndFrame: z.number().int().min(0),
  action: z.enum(["keep", "delete", "review"]),
  reason: z.string().optional(),
  requiresReview: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
  detectionSource: z.string().min(1).optional()
});
var CaptionCueSchema = z.object({
  id: z.string().min(1),
  startFrame: z.number().int().min(0),
  durationInFrames: z.number().int().positive(),
  text: z.string().min(1),
  wordIds: z.array(z.string()).optional(),
  sourceStartFrame: z.number().int().min(0).optional(),
  sourceEndFrame: z.number().int().min(0).optional()
});
var TalkingHeadMetadataSchema = z.object({
  kind: z.literal("talking-head.analysis"),
  fps: z.number().positive(),
  asr: AsrTranscriptMetadataSchema.optional(),
  words: z.array(TranscriptWordSchema),
  cuts: z.array(TextCutSchema).default([]),
  captionCues: z.array(CaptionCueSchema).default([]),
  disfluencies: z.array(z.object({
    id: z.string().optional(),
    wordId: z.string().optional(),
    startFrame: z.number().int().min(0).optional(),
    endFrame: z.number().int().min(0).optional(),
    text: z.string().optional(),
    type: z.enum(["filler", "silence", "tone-particle", "repeat"]),
    requiresReview: z.boolean().default(false),
    confidence: z.number().min(0).max(1).optional(),
    detectionSource: z.string().min(1).optional()
  })).default([])
});
var RightsMetadataSchema = z.object({
  license: z.string().min(1),
  attribution: z.string().min(1),
  redistributionAllowed: z.boolean(),
  derivativeAllowed: z.boolean()
});
var ReferenceShotSchema = FrameRangeSchema.extend({
  id: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).default([])
});
var ReferenceVideoMetadataSchema = z.object({
  kind: z.literal("reference-video.analysis"),
  sourceUrl: z.string().min(1),
  rights: RightsMetadataSchema,
  shots: z.array(ReferenceShotSchema).default([]),
  nonCopyingQa: z.object({
    status: z.enum(["passed", "requires-review", "failed"]),
    similarityScore: z.number().min(0).max(1).optional()
  }).optional()
});
var ReferenceDownloadSourceLedgerSchema = z.object({
  sourceUrl: z.string().min(1),
  license: z.string().min(1),
  attribution: z.string().min(1),
  allowedUses: z.array(z.string().min(1)).default(["analysis-only"]),
  redistributionAllowed: z.boolean(),
  derivativeAllowed: z.boolean()
});
var ReferenceDownloadFileSchema = z.object({
  path: z.string().min(1),
  mediaType: z.enum(["video", "audio", "image", "metadata", "unknown"]),
  sizeBytes: z.number().int().nonnegative().optional()
});
var ReferenceDownloadMetadataBaseSchema = z.object({
  kind: z.literal("reference.download"),
  sourceUrl: z.string().min(1),
  tool: z.literal("yt-dlp"),
  outputDir: z.string().min(1),
  downloadedFiles: z.array(ReferenceDownloadFileSchema).min(1),
  rawReferenceQuarantine: z.literal(true),
  finalExportAllowed: z.boolean(),
  sourceLedger: ReferenceDownloadSourceLedgerSchema,
  decisionLog: z.array(z.string().min(1)).default([])
});
function hasReferenceDownloadFinalExportRights(metadata) {
  return !metadata.finalExportAllowed || metadata.sourceLedger.redistributionAllowed && metadata.sourceLedger.derivativeAllowed;
}
var ReferenceDownloadMetadataSchema = ReferenceDownloadMetadataBaseSchema.refine(
  hasReferenceDownloadFinalExportRights,
  {
    message: "final export requires derivative and redistribution rights",
    path: ["finalExportAllowed"]
  }
);
var VisualMomentCandidateSchema = z.object({
  id: z.string().min(1),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  peakMs: z.number().min(0),
  startFrame: z.number().int().min(0).optional(),
  endFrame: z.number().int().min(0).optional(),
  peakFrame: z.number().int().min(0).optional(),
  sceneIndex: z.number().int().min(0),
  motion: z.number().min(0).max(1),
  quality: z.number().min(0).max(1),
  action: z.number().min(0).max(1).optional(),
  emotion: z.number().min(0).max(1).optional(),
  semantic: z.string().min(1).optional(),
  tags: z.array(z.string()).default([])
}).refine((candidate) => candidate.endMs > candidate.startMs, {
  message: "visual moment endMs must be greater than startMs",
  path: ["endMs"]
});
var VideoVisualMomentMetadataSchema = z.object({
  kind: z.literal("video.visual-moments"),
  sourceVideoAssetId: z.string().min(1),
  fps: z.number().positive(),
  sourcePath: z.string().min(1).optional(),
  sceneChanges: z.array(z.number().int().min(0)).default([]),
  candidates: z.array(VisualMomentCandidateSchema).min(1)
});
var CharacterReferenceViewKindSchema = z.enum([
  "front",
  "side",
  "back",
  "three-quarter",
  "expression"
]);
var CharacterReferenceViewSchema = z.object({
  view: CharacterReferenceViewKindSchema,
  assetId: z.string().min(1),
  path: z.string().min(1),
  locked: z.boolean().default(true),
  copyOnWriteRequired: z.boolean().default(true)
});
var ImageStoryboardMetadataSchema = z.object({
  kind: z.literal("image.storyboard-consistency"),
  characters: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    referenceAssetIds: z.array(z.string()).min(1),
    requiredViews: z.array(CharacterReferenceViewKindSchema).default([]),
    referenceViews: z.array(CharacterReferenceViewSchema).default([])
  })).default([]),
  scenes: z.array(z.object({
    id: z.string().min(1),
    referenceAssetIds: z.array(z.string()).default([]),
    prompt: z.string().min(1)
  })).default([]),
  panels: z.array(z.object({
    id: z.string().min(1),
    sceneId: z.string().min(1),
    characterIds: z.array(z.string()).default([]),
    assetId: z.string().min(1),
    path: z.string().min(1).optional(),
    consistencyScore: z.number().min(0).max(1).optional()
  })).default([])
});
var SemanticReferenceRoleKindSchema = z.enum([
  "identity-front",
  "identity-side",
  "identity-back",
  "identity-three-quarter",
  "identity-expression",
  "scene-plate",
  "style-frame",
  "logo-lock",
  "product-packshot"
]);
var SemanticReferenceDownstreamUsageSchema = z.enum([
  "identity-reference",
  "scene-reference",
  "style-reference",
  "brand-lock",
  "product-reference"
]);
var SemanticReferenceRoleSchema = z.object({
  roleId: z.string().min(1),
  assetId: z.string().min(1),
  role: SemanticReferenceRoleKindSchema,
  subjectId: z.string().min(1).optional(),
  path: z.string().min(1),
  locked: z.boolean(),
  copyOnWriteRequired: z.boolean(),
  downstreamUsage: SemanticReferenceDownstreamUsageSchema,
  constraints: z.array(z.string().min(1)).default([])
});
var SemanticReferenceRolesMetadataSchema = z.object({
  kind: z.literal("image.semantic-reference-roles"),
  roles: z.array(SemanticReferenceRoleSchema).min(1)
});
var ProductLogoQaReferenceSchema = z.object({
  roleId: z.string().min(1),
  assetId: z.string().min(1),
  role: z.enum(["logo-lock", "product-packshot"]),
  subjectId: z.string().min(1).optional(),
  path: z.string().min(1),
  locked: z.boolean(),
  copyOnWriteRequired: z.boolean(),
  constraints: z.array(z.string().min(1)).default([])
});
var ProductLogoQaCheckKindSchema = z.enum([
  "logo-presence",
  "glyph-lock",
  "brand-color",
  "packshot-presence",
  "claim-text",
  "material-finish",
  "packaging-layout"
]);
var ProductLogoQaCheckSchema = z.object({
  id: z.string().min(1),
  roleId: z.string().min(1),
  referenceAssetId: z.string().min(1),
  check: ProductLogoQaCheckKindSchema,
  status: z.enum(["pass", "requires-review", "fail"]),
  required: z.boolean().default(true),
  expected: z.string().min(1),
  actual: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  deltaE: z.number().min(0).optional(),
  evidence: z.string().min(1).optional()
});
var ProductLogoQaMetadataSchema = z.object({
  kind: z.literal("image.product-logo-qa"),
  targetAssetId: z.string().min(1),
  referencePackAssetId: z.string().min(1).optional(),
  requiredReferenceAssetIds: z.array(z.string().min(1)).min(1),
  references: z.array(ProductLogoQaReferenceSchema).min(1),
  checks: z.array(ProductLogoQaCheckSchema).min(1),
  verdict: z.enum(["pass", "requires-review", "fail"]),
  blockedReasons: z.array(z.string().min(1)).default([]),
  copyOnWriteRequired: z.boolean()
});
var AnalysisBackendBenchmarkMetricSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  weight: z.number().positive().default(1),
  higherIsBetter: z.boolean().default(true),
  status: z.enum(["pass", "fail"])
});
var AnalysisBackendBenchmarkCandidateSchema = z.object({
  backendId: z.string().min(1),
  capability: z.string().min(1),
  resultPath: z.string().min(1),
  metrics: z.array(AnalysisBackendBenchmarkMetricSchema).min(1),
  weightedScore: z.number().min(0).max(1),
  status: z.enum(["pass", "fail"])
});
var AnalysisBackendBenchmarkMetadataSchema = z.object({
  kind: z.literal("analysis.backend-benchmark"),
  benchmarkId: z.string().min(1),
  targetCapability: z.string().min(1),
  fixtureSetPath: z.string().min(1),
  candidates: z.array(AnalysisBackendBenchmarkCandidateSchema).min(1),
  selectedBackendId: z.string().min(1).optional(),
  verdict: z.enum(["pass", "requires-review", "fail"]),
  blockedReasons: z.array(z.string().min(1)).default([]),
  decisionLog: z.array(z.string().min(1)).default([])
});
var ImageEmbeddingDistanceMetricSchema = z.enum(["cosine", "dot", "euclidean"]);
var ImageEmbeddingBaselineForSchema = z.enum([
  "identity",
  "product",
  "scene",
  "style",
  "logo"
]);
var ImageEmbeddingStoreItemSchema = z.object({
  assetId: z.string().min(1),
  roleId: z.string().min(1).optional(),
  subjectId: z.string().min(1).optional(),
  path: z.string().min(1),
  vectorPath: z.string().min(1),
  vectorHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  dimension: z.number().int().positive(),
  baselineFor: z.array(ImageEmbeddingBaselineForSchema).min(1),
  locked: z.boolean(),
  copyOnWriteRequired: z.boolean(),
  tags: z.array(z.string().min(1)).default([])
});
var ImageEmbeddingStoreMetadataSchema = z.object({
  kind: z.literal("image.embedding-store"),
  embeddingSetId: z.string().min(1),
  modelId: z.string().min(1),
  dimension: z.number().int().positive(),
  distanceMetric: ImageEmbeddingDistanceMetricSchema,
  items: z.array(ImageEmbeddingStoreItemSchema).min(1),
  copyOnWriteRequired: z.boolean()
});
var ImageComfyuiApiFormatSchema = z.enum(["comfyui-api-json", "comfyui-ui-json"]);
var ImageComfyuiModelTypeSchema = z.enum([
  "checkpoint",
  "vae",
  "lora",
  "controlnet",
  "upscaler",
  "embedding",
  "other"
]);
var ImageComfyuiModelReferenceSchema = z.object({
  name: z.string().min(1),
  type: ImageComfyuiModelTypeSchema,
  path: z.string().min(1).optional(),
  hash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  license: z.string().min(1).optional()
});
var ImageComfyuiCustomNodeSchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  hash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional()
});
var ImageComfyuiInputKindSchema = z.enum([
  "text",
  "image",
  "mask",
  "latent",
  "seed",
  "number",
  "model",
  "lora",
  "controlnet",
  "other"
]);
var ImageComfyuiInputSlotSchema = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  inputName: z.string().min(1),
  kind: ImageComfyuiInputKindSchema,
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  assetId: z.string().min(1).optional(),
  path: z.string().min(1).optional()
});
var ImageComfyuiOutputStatusSchema = z.enum(["planned", "materialized"]);
var ImageComfyuiOutputMediaTypeSchema = z.enum(["image", "image-sequence", "mask", "metadata"]);
var ImageComfyuiOutputSchema = z.object({
  outputAssetId: z.string().min(1),
  nodeId: z.string().min(1),
  outputName: z.string().min(1).optional(),
  mediaType: ImageComfyuiOutputMediaTypeSchema,
  path: z.string().min(1),
  fileHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  status: ImageComfyuiOutputStatusSchema
});
var ImageComfyuiExecutionSchema = z.object({
  mode: z.enum(["planned", "completed", "failed"]),
  runnerId: z.string().min(1).optional(),
  promptId: z.string().min(1).optional(),
  executedAt: z.string().min(1).optional()
});
var ImageComfyuiRunnerMetadataSchema = z.object({
  kind: z.literal("image.comfyui-runner"),
  workflowId: z.string().min(1),
  workflowPath: z.string().min(1),
  workflowHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  apiFormat: ImageComfyuiApiFormatSchema,
  backendId: z.string().min(1).optional(),
  models: z.array(ImageComfyuiModelReferenceSchema).default([]),
  customNodes: z.array(ImageComfyuiCustomNodeSchema).default([]),
  inputs: z.array(ImageComfyuiInputSlotSchema).default([]),
  outputs: z.array(ImageComfyuiOutputSchema).min(1),
  execution: ImageComfyuiExecutionSchema.default({ mode: "planned" }),
  decisionLog: z.array(z.string().min(1)).default([])
});
var StoryboardPromptSchema = z.object({
  id: z.string().min(1),
  panelId: z.string().min(1),
  sceneId: z.string().min(1),
  characterIds: z.array(z.string()).default([]),
  prompt: z.string().min(1),
  negativePrompt: z.string().optional(),
  outputAssetId: z.string().min(1),
  outputPath: z.string().min(1),
  modelHint: z.string().optional()
});
var StoryboardPromptPackSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("clash.storyboard.prompt-pack"),
  storyboardAssetId: z.string().min(1),
  prompts: z.array(StoryboardPromptSchema).min(1)
});
var SafeZonesSchema = z.object({
  top: z.number().int().min(0),
  right: z.number().int().min(0),
  bottom: z.number().int().min(0),
  left: z.number().int().min(0)
});
var AdDeliveryVariantSchema = z.object({
  id: z.string().min(1),
  platform: z.string().min(1),
  durationSeconds: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspectRatio: z.string().min(1),
  safeZones: SafeZonesSchema,
  subtitlesRequired: z.boolean().default(true),
  loudnessTarget: z.string().min(1).default("platform-default")
});
var AdPackshotSpecSchema = z.object({
  required: z.boolean().default(true),
  assetId: z.string().min(1),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(0)
});
var AdEndCardSpecSchema = z.object({
  required: z.boolean().default(true),
  durationFrames: z.number().int().positive(),
  cta: z.string().min(1),
  disclaimer: z.string().min(1).optional(),
  qrRequired: z.boolean().default(false)
});
var AdDeliveryMetadataSchema = z.object({
  kind: z.literal("ad.delivery-spec"),
  brand: z.string().min(1),
  fps: z.number().positive(),
  platforms: z.array(z.string().min(1)).min(1),
  variants: z.array(AdDeliveryVariantSchema).min(1),
  packshot: AdPackshotSpecSchema,
  endCard: AdEndCardSpecSchema,
  rightsLedgerAssetId: z.string().min(1).optional()
});
var AdDeliveryChecklistItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean()
});
var AdDeliverySpecProjectionSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("clash.ad.delivery-spec.projection"),
  targetAssetId: z.string().min(1),
  brand: z.string().min(1),
  fps: z.number().positive(),
  platforms: z.array(z.string().min(1)).min(1),
  variants: z.array(AdDeliveryVariantSchema).min(1),
  packshot: AdPackshotSpecSchema,
  endCard: AdEndCardSpecSchema,
  rightsLedgerAssetId: z.string().min(1).optional(),
  checklist: z.array(AdDeliveryChecklistItemSchema).default([])
});
var AdDeliveryExportProbeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  durationSeconds: z.number().positive(),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  videoCodec: z.string().min(1).optional(),
  audioCodec: z.string().min(1).optional()
});
var AdDeliverySafeZoneViolationSchema = z.object({
  frame: z.number().int().min(0).optional(),
  description: z.string().min(1),
  severity: z.enum(["warning", "error"]).default("error")
});
var AdDeliveryVisualQaReportSchema = z.object({
  captionsPresent: z.boolean(),
  safeZoneViolations: z.array(AdDeliverySafeZoneViolationSchema).default([]),
  packshotVisible: z.boolean(),
  endCardVisible: z.boolean(),
  disclaimerVisible: z.boolean().optional(),
  ctaVisible: z.boolean().optional(),
  logoLockupVisible: z.boolean().optional(),
  finalFrameHolds: z.boolean().optional()
});
var AdDeliveryExportValidationCheckSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pass", "fail"]),
  required: z.boolean(),
  severity: z.enum(["error", "warning"]).default("error"),
  expected: z.string().min(1),
  actual: z.string().min(1)
});
var AdDeliveryExportValidationReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("clash.ad.delivery-export-validation"),
  targetAssetId: z.string().min(1),
  brand: z.string().min(1),
  variant: AdDeliveryVariantSchema,
  renderedPath: z.string().min(1),
  probe: AdDeliveryExportProbeSchema,
  visualQa: AdDeliveryVisualQaReportSchema.optional(),
  checks: z.array(AdDeliveryExportValidationCheckSchema).min(1),
  verdict: z.enum(["pass", "fail"])
});
var AdVisualQaCheckKindSchema = z.enum([
  "captions-present",
  "safe-zone",
  "packshot-visible",
  "end-card-visible",
  "disclaimer-visible",
  "disclaimer-ocr",
  "cta-visible",
  "logo-lockup-visible",
  "final-frame-hold"
]);
var AdVisualQaCheckSchema = z.object({
  id: z.string().min(1),
  check: AdVisualQaCheckKindSchema,
  status: z.enum(["pass", "fail", "requires-review"]),
  required: z.boolean().default(true),
  expected: z.string().min(1),
  actual: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  frame: z.number().int().min(0).optional(),
  evidencePath: z.string().min(1).optional()
});
var AdVisualQaMetadataSchema = z.object({
  kind: z.literal("ad.visual-qa"),
  targetAssetId: z.string().min(1),
  variantId: z.string().min(1),
  renderedPath: z.string().min(1),
  evidencePath: z.string().min(1),
  checks: z.array(AdVisualQaCheckSchema).min(1),
  verdict: z.enum(["pass", "requires-review", "fail"]),
  blockedReasons: z.array(z.string().min(1)).default([]),
  visualQa: AdDeliveryVisualQaReportSchema,
  decisionLog: z.array(z.string().min(1)).default([])
});
var ContentCredentialModeSchema = z.enum(["unsigned-manifest", "signed-c2pa", "external"]);
var ContentCredentialSignatureStatusSchema = z.enum(["unsigned", "signed", "external", "failed"]);
var ContentCredentialIngredientRelationshipSchema = z.enum([
  "source",
  "reference",
  "generated-input",
  "model",
  "metadata"
]);
var ContentCredentialIngredientSchema = z.object({
  assetId: z.string().min(1).optional(),
  path: z.string().min(1),
  relationship: ContentCredentialIngredientRelationshipSchema,
  hash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  title: z.string().min(1).optional(),
  rights: z.string().min(1).optional()
});
var ContentCredentialActionSchema = z.object({
  actionId: z.string().min(1).optional(),
  action: z.string().min(1),
  softwareAgent: z.string().min(1).optional(),
  when: z.string().min(1).optional()
});
var ContentCredentialAssertionSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  path: z.string().min(1).optional(),
  hash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional()
});
var ContentCredentialsMetadataSchema = z.object({
  kind: z.literal("provenance.content-credentials"),
  credentialId: z.string().min(1),
  targetAssetId: z.string().min(1),
  targetPath: z.string().min(1).optional(),
  targetHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  mode: ContentCredentialModeSchema,
  signatureStatus: ContentCredentialSignatureStatusSchema,
  c2paManifestPath: z.string().min(1).optional(),
  c2paManifestHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  issuer: z.string().min(1).optional(),
  ingredients: z.array(ContentCredentialIngredientSchema).default([]),
  actions: z.array(ContentCredentialActionSchema).default([]),
  assertions: z.array(ContentCredentialAssertionSchema).default([]),
  decisionLog: z.array(z.string().min(1)).default([])
});
var ProductionMetadataBaseSchema = z.discriminatedUnion("kind", [
  AudioBeatMetadataSchema,
  AudioStemSeparationMetadataSchema,
  LyricsAlignmentMetadataSchema,
  TalkingHeadMetadataSchema,
  ReferenceVideoMetadataSchema,
  ReferenceDownloadMetadataBaseSchema,
  VideoVisualMomentMetadataSchema,
  ImageStoryboardMetadataSchema,
  SemanticReferenceRolesMetadataSchema,
  ProductLogoQaMetadataSchema,
  AnalysisBackendBenchmarkMetadataSchema,
  ImageEmbeddingStoreMetadataSchema,
  ImageComfyuiRunnerMetadataSchema,
  AdDeliveryMetadataSchema,
  AdVisualQaMetadataSchema,
  ContentCredentialsMetadataSchema
]);
var ProductionMetadataSchema = ProductionMetadataBaseSchema.superRefine((metadata, context) => {
  if (metadata.kind === "reference.download" && !hasReferenceDownloadFinalExportRights(metadata)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "final export requires derivative and redistribution rights",
      path: ["finalExportAllowed"]
    });
  }
});
var AssetMetadataFillActionSchema = z.object({
  actionId: z.string().min(1),
  targetAssetId: z.string().min(1),
  metadataKind: z.string().min(1),
  metadata: ProductionMetadataSchema,
  producer: z.string().min(1),
  createdAt: z.string().optional()
});
var SourceHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
var TimelineTranscriptSourceSchema = z.object({
  assetId: z.string().min(1),
  transcriptSourcePath: z.string().min(1),
  transcriptSourceHash: SourceHashSchema,
  transcriptRevision: z.string().min(1).optional()
});
var TimelineTranscriptWordSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  assetId: z.string().min(1),
  assetWordId: z.string().min(1),
  clipId: z.string().min(1),
  trackId: z.string().min(1).optional(),
  sourceStartFrame: z.number().int().min(0),
  sourceEndFrame: z.number().int().min(0),
  timelineStartFrame: z.number().int().min(0),
  timelineEndFrame: z.number().int().min(0),
  confidence: z.number().min(0).max(1).optional(),
  speakerId: z.string().min(1).optional()
}).superRefine((word, context) => {
  if (word.sourceEndFrame <= word.sourceStartFrame) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "timeline transcript sourceEndFrame must be greater than sourceStartFrame",
      path: ["sourceEndFrame"]
    });
  }
  if (word.timelineEndFrame <= word.timelineStartFrame) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "timeline transcript timelineEndFrame must be greater than timelineStartFrame",
      path: ["timelineEndFrame"]
    });
  }
});
var TimelineTranscriptProjectionSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("clash.timeline.transcript.projection"),
  timelineId: z.string().min(1),
  timelineRevision: z.string().min(1),
  fps: z.number().positive(),
  durationFrames: z.number().int().min(0),
  text: z.string(),
  sources: z.array(TimelineTranscriptSourceSchema).min(1),
  words: z.array(TimelineTranscriptWordSchema)
}).superRefine((projection, context) => {
  const sourceAssetIds = new Set(projection.sources.map((source) => source.assetId));
  const sourceIds = /* @__PURE__ */ new Set();
  projection.sources.forEach((source, index) => {
    if (sourceIds.has(source.assetId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate timeline transcript source asset: ${source.assetId}`,
        path: ["sources", index, "assetId"]
      });
    }
    sourceIds.add(source.assetId);
  });
  const wordIds = /* @__PURE__ */ new Set();
  let previousTimelineStart = -1;
  projection.words.forEach((word, index) => {
    if (wordIds.has(word.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate timeline transcript word id: ${word.id}`,
        path: ["words", index, "id"]
      });
    }
    wordIds.add(word.id);
    if (!sourceAssetIds.has(word.assetId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `timeline transcript word references unknown asset: ${word.assetId}`,
        path: ["words", index, "assetId"]
      });
    }
    if (word.timelineStartFrame < previousTimelineStart) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeline transcript words must be ordered by timelineStartFrame",
        path: ["words", index, "timelineStartFrame"]
      });
    }
    if (word.timelineEndFrame > projection.durationFrames) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeline transcript word exceeds durationFrames",
        path: ["words", index, "timelineEndFrame"]
      });
    }
    previousTimelineStart = word.timelineStartFrame;
  });
});
var TimelineTranscriptClipInputSchema = z.object({
  clipId: z.string().min(1),
  trackId: z.string().min(1).optional(),
  assetId: z.string().min(1),
  timelineStartFrame: z.number().int().min(0),
  sourceStartFrame: z.number().int().min(0),
  sourceEndFrame: z.number().int().min(0),
  playbackRate: z.number().positive().default(1),
  transcript: z.object({
    sourcePath: z.string().min(1),
    sourceHash: SourceHashSchema,
    revision: z.string().min(1).optional(),
    words: z.array(TranscriptWordSchema)
  })
}).refine((clip) => clip.sourceEndFrame > clip.sourceStartFrame, {
  message: "timeline transcript clip sourceEndFrame must be greater than sourceStartFrame",
  path: ["sourceEndFrame"]
});
var BuildTimelineTranscriptProjectionInputSchema = z.object({
  timelineId: z.string().min(1),
  timelineRevision: z.string().min(1),
  fps: z.number().positive(),
  durationFrames: z.number().int().min(0),
  clips: z.array(TimelineTranscriptClipInputSchema).min(1)
});
var DirectorReferenceAspectRatioSchema = z.enum([
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "1:1"
]);
var DirectorReferenceVector3Schema = z.tuple([
  z.number(),
  z.number(),
  z.number()
]);
var DirectorReferenceCameraOpticsSchema = z.object({
  projection: z.enum(["perspective", "orthographic"]),
  focalLengthMm: z.number().positive(),
  sensorWidthMm: z.number().positive(),
  sensorHeightMm: z.number().positive(),
  focusDistanceM: z.number().positive(),
  fStop: z.number().positive(),
  shutterAngleDegrees: z.number().positive(),
  iso: z.number().positive(),
  nearClipM: z.number().positive(),
  farClipM: z.number().positive()
});
var DirectorReferenceCameraSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  position: DirectorReferenceVector3Schema,
  rotation: DirectorReferenceVector3Schema,
  fov: z.number().positive(),
  targetObjectId: z.string().min(1).optional(),
  targetObjectIds: z.array(z.string().min(1)).optional(),
  targetOffset: DirectorReferenceVector3Schema.optional(),
  optics: DirectorReferenceCameraOpticsSchema.optional()
});
var DirectorReferenceShotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cameraId: z.string().min(1),
  startTime: z.number().nonnegative(),
  sequenceStartTime: z.number().nonnegative().optional(),
  durationSeconds: z.number().positive(),
  aspectRatio: DirectorReferenceAspectRatioSchema,
  transition: z.enum(["cut", "dissolve"]).default("cut"),
  storyBeatIds: z.array(z.string().min(1)).optional(),
  actionClipIds: z.array(z.string().min(1)).optional(),
  cameraMove: z.object({
    preset: z.string().min(1),
    easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"])
  }).optional()
});
var DirectorReferenceStillSchema = z.object({
  assetId: z.string().min(1),
  cameraId: z.string().min(1),
  shotId: z.string().min(1),
  aspectRatio: DirectorReferenceAspectRatioSchema,
  stageRevisionId: z.string().min(1),
  timeSeconds: z.number().nonnegative().optional(),
  sequenceTimeSeconds: z.number().nonnegative().optional()
});
var DirectorReferenceVideoSchema = z.object({
  assetId: z.string().min(1),
  mimeType: z.string().min(1)
});
var DirectorReferencePacketSchema = z.object({
  schemaVersion: z.literal(1),
  stageId: z.string().min(1),
  stageRevisionId: z.string().min(1),
  exportedAt: z.string().datetime(),
  aspectRatio: DirectorReferenceAspectRatioSchema,
  durationSeconds: z.number().positive(),
  fps: z.number().int().positive(),
  scope: z.object({
    kind: z.enum(["sequence", "shot", "shot-selection"]),
    selectedShotIds: z.array(z.string().min(1)).min(1)
  }).optional(),
  cameraIds: z.array(z.string().min(1)).min(1),
  cameraSpec: z.object({
    cameras: z.array(DirectorReferenceCameraSchema)
  }).optional(),
  referenceVideo: DirectorReferenceVideoSchema,
  referenceStills: z.array(DirectorReferenceStillSchema),
  shotSpec: z.object({
    shots: z.array(DirectorReferenceShotSchema)
  })
});
var ActionFamilySchema = z.enum(["generate", "edit", "custom"]);
var ActionExecutorSchema = z.enum([
  "model",
  "client-render",
  "server-transform",
  "runtime"
]);
var ActionOperationSpecSchema = z.object({
  id: z.string().min(1),
  executor: ActionExecutorSchema,
  outputKind: AssetKindSchema
});
var ActionSpecSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  family: ActionFamilySchema,
  inputKinds: z.array(AssetKindSchema).min(1),
  operations: z.array(ActionOperationSpecSchema).min(1)
});
var ActionInvocationModeSchema = z.enum(["explicit", "implicit"]);
var ActionSurfaceSchema = z.enum(["canvas", "asset-preview"]);
var ACTION_INVOCATION_MODE = {
  Explicit: "explicit",
  Implicit: "implicit"
};
function invocationModeForSurface(surface) {
  return surface === "canvas" ? ACTION_INVOCATION_MODE.Explicit : ACTION_INVOCATION_MODE.Implicit;
}
var ASSET_ACTION_ID = {
  ImageEditor: "image-editor",
  VideoClipper: "video-clipper"
};
var CropRectSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive()
});
var ImageEditParamsSchema = z.object({
  crop: CropRectSchema.optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional()
});
var VideoClipParamsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("screenshot"), frameTimeSec: z.number().nonnegative() }),
  z.object({
    mode: z.literal("crop"),
    startSec: z.number().nonnegative(),
    endSec: z.number().positive()
  })
]).superRefine((value, context) => {
  if (value.mode === "crop" && value.endSec <= value.startSec) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "endSec must be greater than startSec",
      path: ["endSec"]
    });
  }
});
var BUILT_IN_ASSET_ACTION_SPECS = {
  [ASSET_ACTION_ID.ImageEditor]: ActionSpecSchema.parse({
    id: ASSET_ACTION_ID.ImageEditor,
    version: "1",
    name: "Image Editor",
    family: "edit",
    inputKinds: ["image"],
    operations: [
      { id: "transform", executor: "client-render", outputKind: "image" }
    ]
  }),
  [ASSET_ACTION_ID.VideoClipper]: ActionSpecSchema.parse({
    id: ASSET_ACTION_ID.VideoClipper,
    version: "1",
    name: "Video Clipper",
    family: "edit",
    inputKinds: ["video"],
    operations: [
      { id: "screenshot", executor: "client-render", outputKind: "image" },
      { id: "crop", executor: "server-transform", outputKind: "video" }
    ]
  })
};
var InvocationBaseSchema = z.object({
  projectId: z.string().min(1),
  mode: ActionInvocationModeSchema,
  surface: ActionSurfaceSchema
});
var ImageEditActionInvocationSchema = InvocationBaseSchema.extend({
  actionId: z.literal(ASSET_ACTION_ID.ImageEditor),
  source: z.object({ assetId: z.string().min(1), kind: z.literal("image") }),
  params: ImageEditParamsSchema
});
var VideoEditActionInvocationSchema = InvocationBaseSchema.extend({
  actionId: z.literal(ASSET_ACTION_ID.VideoClipper),
  source: z.object({ assetId: z.string().min(1), kind: z.literal("video") }),
  params: VideoClipParamsSchema
});
var AssetEditActionInvocationSchema = z.discriminatedUnion("actionId", [
  ImageEditActionInvocationSchema,
  VideoEditActionInvocationSchema
]).refine((value) => value.mode === invocationModeForSurface(value.surface), {
  message: "Invocation mode must match its surface",
  path: ["mode"]
});
var PositionSchema2 = z.object({
  x: z.number(),
  y: z.number()
});
var RF_NODE_TYPE = {
  /** Text / markdown content */
  Text: "text",
  /** Container group */
  Group: "group",
  /** Image asset (completed generation or upload) */
  Image: "image",
  /** Video asset (completed generation or upload) */
  Video: "video",
  /** Audio asset (completed generation or upload) */
  Audio: "audio",
  /** Agent-authored Remotion TSX component with live Canvas/Timeline preview */
  RemotionComponent: "remotion-component",
  /** Generation node — renders as ActionBadge */
  ActionBadge: "action-badge"
};
var ACTION_TYPE = {
  ImageGen: "image-gen",
  VideoGen: "video-gen",
  AudioGen: "audio-gen",
  TextGen: "text-gen",
  /** Custom actions provided by local agents. Full actionType: "custom:<action-id>" */
  Custom: "custom"
};
var AGENT_NODE_TYPE_MAP = {
  text: { rfType: RF_NODE_TYPE.Text },
  group: { rfType: RF_NODE_TYPE.Group },
  image: { rfType: RF_NODE_TYPE.Image },
  video: { rfType: RF_NODE_TYPE.Video },
  audio: { rfType: RF_NODE_TYPE.Audio },
  remotion: { rfType: RF_NODE_TYPE.RemotionComponent },
  image_gen: { rfType: RF_NODE_TYPE.ActionBadge, actionType: ACTION_TYPE.ImageGen },
  video_gen: { rfType: RF_NODE_TYPE.ActionBadge, actionType: ACTION_TYPE.VideoGen },
  audio_gen: { rfType: RF_NODE_TYPE.ActionBadge, actionType: ACTION_TYPE.AudioGen },
  text_gen: { rfType: RF_NODE_TYPE.ActionBadge, actionType: ACTION_TYPE.TextGen }
};
var NodeStatusSchema = z.enum([
  "idle",
  "pending",
  "generating",
  "completed",
  "failed"
]);
var NodeDataSchema = z.object({
  label: z.string().optional(),
  content: z.string().optional(),
  /** Stable component export id for a remotion-component Canvas node. */
  componentId: z.string().min(1).optional(),
  /** Product-scaffold preview/render width for a remotion-component node. */
  compositionWidth: z.number().int().positive().optional(),
  /** Product-scaffold preview/render height for a remotion-component node. */
  compositionHeight: z.number().int().positive().optional(),
  /** Product-scaffold frame rate for a remotion-component node. */
  fps: z.number().positive().optional(),
  /** Product-scaffold duration for a remotion-component node. */
  durationInFrames: z.number().int().positive().optional(),
  /** Direct text entered in a music action's dedicated Lyrics input. */
  lyrics: z.string().optional(),
  description: z.string().optional(),
  prompt: z.string().optional(),
  src: z.string().optional(),
  url: z.string().optional(),
  thumbnail: z.string().optional(),
  poster: z.string().optional(),
  status: NodeStatusSchema.optional(),
  assetId: z.string().optional(),
  stageId: z.string().optional(),
  /** Latest registered reference-video output from a Director Stage node. */
  outputVideoAssetId: z.string().optional(),
  outputVideoDurationSeconds: z.number().optional(),
  outputVideoFps: z.number().optional(),
  outputVideoStageRevisionId: z.string().optional(),
  /** Canonical, revision-pinned Director output for downstream generation. */
  directorReferencePacket: DirectorReferencePacketSchema.optional(),
  /** Ordered, individually rendered Shot packets selected for batch generation. */
  directorShotReferencePackets: z.array(DirectorReferencePacketSchema).optional(),
  selectedDirectorShotIds: z.array(z.string().min(1)).optional(),
  /** Per-output lineage back to the exact Stage revision and Shot. */
  sourceDirectorStageId: z.string().min(1).optional(),
  sourceDirectorStageRevisionId: z.string().min(1).optional(),
  sourceDirectorStageShotId: z.string().min(1).optional(),
  sourceDirectorStageShotIds: z.array(z.string().min(1)).optional(),
  sourceDirectorStageCameraId: z.string().min(1).optional(),
  /** Shared Canvas group identity for independently regeneratable Shot outputs. */
  directorShotGroupId: z.string().min(1).optional(),
  taskId: z.string().optional(),
  actionType: z.string().optional(),
  upstreamNodeIds: z.array(z.string()).optional(),
  duration: z.number().optional(),
  model: z.string().optional(),
  modelId: z.string().optional(),
  modelParams: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  referenceImageUrls: z.array(z.string()).optional(),
  error: z.string().optional(),
  sourceNodeId: z.string().optional(),
  /** Custom action ID (e.g. "style-transfer") for custom:* action types */
  customActionId: z.string().optional(),
  /** User-configured parameters for custom actions */
  customActionParams: z.record(z.unknown()).optional(),
  /** Immutable plugin export/version/schema used by this node. */
  pluginBinding: ExecutablePluginBindingSchema.optional(),
  // ─── Actor attribution (Phase 0 multi-actor billing) ────────
  // Stamped by the creation site (web UI / ACP tool / CLI). For
  // legacy nodes created before this rollout these are absent —
  // NodeProcessor surfaces missing attribution as a clear node
  // failure rather than silently falling back to the project owner.
  /** 'user' or 'agent' — who placed this node on the canvas. */
  actorType: z.enum(["user", "agent"]).optional(),
  /** The accountable human user id. Always set for new nodes; for
   *  actorType='agent' this is the agent's owner / claimer. */
  actorUserId: z.string().optional(),
  /** agent member id when actorType='agent'. */
  actorAgentId: z.string().optional(),
  /** Structured understanding results (ASR transcription, visual analysis, etc.).
   *  Keys are overwritten, not merged — each key is independently owned. */
  understanding: z.object({
    transcription: z.object({
      text: z.string(),
      segments: z.array(z.object({
        start: z.number(),
        end: z.number(),
        text: z.string()
      }))
    }).optional(),
    visual: z.object({
      description: z.string().optional(),
      shots: z.array(z.object({
        start: z.number(),
        end: z.number(),
        description: z.string()
      })).optional(),
      tags: z.array(z.string()).optional()
    }).optional()
  }).passthrough().optional()
}).passthrough();
var UpstreamRefSchema = z.object({
  nodeId: z.string(),
  edgeId: z.string(),
  type: z.string().default("default"),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional()
});
var CanvasNodeSchema = z.object({
  id: z.string(),
  canvasId: z.string(),
  type: z.string(),
  position: PositionSchema2,
  data: NodeDataSchema,
  upstream: z.array(UpstreamRefSchema).default([]),
  parentId: z.string().optional(),
  extent: z.literal("parent").optional()
});
var CanvasEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.string().default("default"),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional()
});
var LoroDocumentStateSchema = z.object({
  canvases: z.record(z.string(), z.object({
    id: z.string(),
    name: z.string(),
    position: z.number()
  })),
  nodes: z.record(z.string(), CanvasNodeSchema),
  tasks: z.record(z.string(), z.any())
});
var NodeType = {
  Text: "text",
  Group: "group",
  Image: "image",
  Video: "video",
  Audio: "audio",
  ImageGen: "image_gen",
  VideoGen: "video_gen",
  AudioGen: "audio_gen",
  TextGen: "text_gen"
};
var ALL_NODE_TYPES = Object.values(NodeType);
var CONTENT_NODE_TYPES = [NodeType.Text, NodeType.Group];
var GENERATION_NODE_TYPES = [NodeType.ImageGen, NodeType.VideoGen, NodeType.AudioGen, NodeType.TextGen];
var CustomActionParameterSchema = ModelParameterSchema;
var CustomActionSecretSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  required: z.boolean().default(true)
});
var ACTION_PROVIDER_IDS = [
  "fal",
  "replicate",
  "official",
  "openai",
  "google-ai-studio",
  "google-agent-platform",
  "anthropic",
  "elevenlabs"
];
var ACTION_PROVIDER_ALIASES = {
  fal: "fal",
  "fal.ai": "fal",
  falai: "fal",
  replicate: "replicate",
  replica: "replicate",
  "replicate.com": "replicate",
  official: "official",
  native: "official",
  openai: "openai",
  "openai.com": "openai",
  "google-ai-studio": "google-ai-studio",
  aistudio: "google-ai-studio",
  "ai-studio": "google-ai-studio",
  "google-agent-platform": "google-agent-platform",
  "agent-platform": "google-agent-platform",
  anthropic: "anthropic",
  claude: "anthropic",
  elevenlabs: "elevenlabs",
  "eleven-labs": "elevenlabs",
  "elevenlabs.io": "elevenlabs"
};
var ACTION_PROVIDER_PRESETS = {
  fal: {
    id: "fal",
    label: "fal.ai",
    defaultSecretId: "FAL_API_KEY",
    secretLabel: "fal.ai API key",
    secretDescription: "API key used to call the fal.ai model provider.",
    docsUrl: "https://fal.ai/dashboard/keys"
  },
  replicate: {
    id: "replicate",
    label: "Replicate",
    defaultSecretId: "REPLICATE_API_TOKEN",
    secretLabel: "Replicate API token",
    secretDescription: "API key used to call the Replicate model provider.",
    docsUrl: "https://replicate.com/account/api-tokens"
  },
  official: {
    id: "official",
    label: "Official API",
    defaultSecretId: "OFFICIAL_API_KEY",
    secretLabel: "Official provider API key",
    secretDescription: "API key used to call the official model provider."
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultSecretId: "OPENAI_API_KEY",
    secretLabel: "OpenAI API key",
    secretDescription: "API key used to call the official OpenAI API.",
    docsUrl: "https://platform.openai.com/api-keys"
  },
  "google-ai-studio": {
    id: "google-ai-studio",
    label: "Google AI Studio",
    defaultSecretId: "GOOGLE_AI_STUDIO_API_KEY",
    secretLabel: "Google AI Studio API key",
    secretDescription: "API key used to call Google AI Studio models.",
    docsUrl: "https://aistudio.google.com/apikey"
  },
  "google-agent-platform": {
    id: "google-agent-platform",
    label: "Google Cloud Agent Platform",
    defaultSecretId: "GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON",
    secretLabel: "Google Cloud service account JSON",
    secretDescription: "Service account JSON used to call Google Cloud Agent Platform models."
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    defaultSecretId: "ANTHROPIC_API_KEY",
    secretLabel: "Anthropic API key",
    secretDescription: "API key used to call the official Anthropic API.",
    docsUrl: "https://console.anthropic.com/settings/keys"
  },
  elevenlabs: {
    id: "elevenlabs",
    label: "ElevenLabs",
    defaultSecretId: "ELEVENLABS_API_KEY",
    secretLabel: "ElevenLabs API key",
    secretDescription: "API key used to call the official ElevenLabs API.",
    docsUrl: "https://elevenlabs.io/app/settings/api-keys"
  }
};
function normalizeActionProviderId(value) {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/^@/, "");
  return ACTION_PROVIDER_ALIASES[key] ?? null;
}
function normalizeActionProviderRef(value) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  return normalizeActionProviderId(raw) ?? raw.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
function providerLabel(provider) {
  const preset = ACTION_PROVIDER_PRESETS[provider];
  if (preset) return preset.label;
  return provider.split(/[-_\s.]+/).filter(Boolean).map((part) => part.length <= 4 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)).join(" ");
}
var ActionProviderIdSchema = z.preprocess(
  (value) => normalizeActionProviderId(value) ?? value,
  z.enum(ACTION_PROVIDER_IDS)
);
var ActionProviderRefSchema = z.preprocess(
  (value) => normalizeActionProviderRef(value) ?? value,
  z.string().min(1)
);
var CustomActionModelSchema = z.object({
  /** Provider-facing model id, e.g. `fal-ai/flux-pro` or `gpt-image-1`. */
  id: z.string(),
  /** Common MaaS / official provider preset, or a user-defined provider id. */
  provider: ActionProviderRefSchema,
  /** Optional display name when the provider id is too terse. */
  name: z.string().optional(),
  /** Override the provider preset key name, e.g. `OPENAI_API_KEY` for provider=`official`. */
  secretId: z.string().optional(),
  /** Optional provider base URL for action handlers that support configurable endpoints. */
  baseUrl: z.string().optional(),
  /** Optional provider endpoint/path for action handlers that route multiple models. */
  endpoint: z.string().optional()
}).passthrough();
function mergeActionProviderSecrets(def) {
  const secrets = [...def.secrets ?? []];
  const provider = def.model?.provider;
  if (provider) {
    const preset = ACTION_PROVIDER_PRESETS[provider];
    const id2 = def.model?.secretId || preset?.defaultSecretId;
    if (id2 && !secrets.some((secret) => secret.id === id2)) {
      const label = providerLabel(provider);
      secrets.push({
        id: id2,
        label: preset?.secretLabel ?? `${label} API key`,
        description: preset?.secretDescription ?? `API key used to call the ${label} model provider.`,
        required: true
      });
    }
  }
  return { ...def, secrets };
}
var CustomActionDefinitionBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  parameters: z.array(CustomActionParameterSchema).default([]),
  outputType: z.enum(["image", "video", "audio", "text"]),
  input: ModelInputRuleSchema.optional(),
  constraints: z.array(ModelConstraintRuleSchema).default([]),
  presentation: ExecutableActionPresentationSchema.default({ type: "form" }),
  maxRuntimeMs: z.number().int().positive().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  /** Execution runtime: 'local' = Python SDK via WebSocket, 'worker' = deployed CF Worker via HTTP */
  runtime: z.enum(["local", "worker"]).default("local"),
  /** Semver version */
  version: z.string().optional(),
  /** Action author name */
  author: z.string().optional(),
  /** Source repository (e.g. "github:user/repo") */
  repository: z.string().optional(),
  /** CF Worker URL for runtime='worker' actions */
  workerUrl: z.string().optional(),
  /** User variables this action needs (e.g. API keys). Platform injects at runtime. */
  secrets: z.array(CustomActionSecretSchema).default([]),
  /** Exact hosted/local executable plugin version represented by this action. */
  pluginBinding: ExecutablePluginBindingSchema.optional(),
  /** Provider/model binding used by MaaS-compatible actions. */
  model: CustomActionModelSchema.optional(),
  /** Discovery tags */
  tags: z.array(z.string()).optional(),
  /** Modalities that can be @-mentioned inline in the prompt editor */
  promptModalities: z.array(z.enum(["text", "image", "video", "audio"])).default(["text"]),
  /**
   * runtime_id of the local runtime that registered this action. The server
   * stamps this from the connecting WS client's `x-runtime-id` header, which
   * the python SDK forwards from the CLASH_RUNTIME_ID env var (set by the
   * local-api host when it spawns each action subprocess).
   *
   * Custom actions are a property of THE USER'S MACHINE — when the runtime
   * is offline, NodeProcessor refuses to dispatch the action and the node
   * lands in `status: failed` with a clear error. This field is the link
   * back to the runtime row that the deriveRuntimeStatus check consults.
   */
  registeredByRuntime: z.string().optional(),
  /**
   * Project ids this action attaches to. `"*"` (the default) means every
   * project the user is in. This declaration lives in the manifest so the
   * install endpoint can echo the user's intent forward and the bridge can
   * spawn one subprocess per attached project.
   *
   * NOTE: As of this change the bridge still spawns a single subprocess per
   * action (no `CLASH_PROJECT_ID` pinning). The field is reserved — it will
   * be honored on the next bridge restart in a future change that wires
   * per-project spawning.
   */
  attachedProjects: z.array(z.string()).default(["*"])
});
var CustomActionDefinitionSchema = CustomActionDefinitionBaseSchema.transform((def) => {
  const input = def.input ?? ModelInputRuleSchema.parse({
    requiresPrompt: def.promptModalities.includes("text"),
    inputMode: Object.fromEntries(
      ["image", "video", "audio"].filter((modality) => def.promptModalities.includes(modality)).map((modality) => [
        modality === "image" ? "images" : modality === "video" ? "videos" : "audios",
        { max: Number.MAX_SAFE_INTEGER }
      ])
    ),
    promptModalities: def.promptModalities
  });
  return mergeActionProviderSecrets({
    ...def,
    input,
    promptModalities: input.promptModalities
  });
});
var NodeInfoSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.unknown()),
  parent_id: z.string().nullish()
});
var EdgeInfoSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  source_handle: z.string().nullish(),
  target_handle: z.string().nullish()
});
var ProjectContextSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    type: z.string(),
    data: z.record(z.unknown()),
    position: z.object({ x: z.number().default(0), y: z.number().default(0) }),
    parentId: z.string().nullish()
  })),
  edges: z.array(z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    type: z.string().nullish()
  }))
});
var DirectorStageVector3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite()
]);
var DirectorStageTransformSchema = z.object({
  position: DirectorStageVector3Schema,
  rotation: DirectorStageVector3Schema,
  scale: DirectorStageVector3Schema
});
var DirectorStagePoseSchema = z.object({
  preset: z.string().min(1),
  joints: z.record(DirectorStageVector3Schema)
});
var DirectorStageAttachmentSocketSchema = z.enum([
  "origin",
  "seat",
  "saddle"
]);
var DirectorStageAttachmentSchema = z.object({
  parentId: z.string().min(1),
  socket: DirectorStageAttachmentSocketSchema,
  offset: DirectorStageTransformSchema
});
var DirectorStageObjectBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  visible: z.boolean(),
  color: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  attachment: DirectorStageAttachmentSchema.optional(),
  transform: DirectorStageTransformSchema
});
var DirectorStagePropTypeSchema = z.enum([
  "chair",
  "table",
  "sofa",
  "crate",
  "barrel",
  "floor-lamp"
]);
var DirectorStageSetTypeSchema = z.enum([
  "wall",
  "doorway",
  "window",
  "platform",
  "cyclorama",
  "tree",
  "rock"
]);
var DirectorStageVehicleTypeSchema = z.enum([
  "car",
  "van",
  "motorcycle",
  "bicycle",
  "boat"
]);
var DirectorStageLightTypeSchema = z.enum([
  "point",
  "spot",
  "directional"
]);
var DirectorStageObjectSchema = z.discriminatedUnion("kind", [
  DirectorStageObjectBaseSchema.extend({
    kind: z.literal("mannequin"),
    mannequin: z.object({
      bodyType: z.enum([
        "neutral",
        "masculine",
        "feminine",
        "broad",
        "athletic",
        "slender",
        "youth",
        "child",
        "chibi"
      ]),
      bodyShape: z.number().finite().min(-1).max(1).optional(),
      pose: DirectorStagePoseSchema
    })
  }),
  DirectorStageObjectBaseSchema.extend({
    kind: z.literal("primitive"),
    primitive: z.object({
      shape: z.enum(["box", "sphere", "cylinder", "cone", "plane", "capsule", "torus", "stair", "arch"])
    })
  }),
  DirectorStageObjectBaseSchema.extend({
    kind: z.literal("creature"),
    creature: z.object({
      species: z.literal("horse"),
      build: z.enum(["warmblood", "draft", "pony"]),
      gait: z.enum(["auto", "idle", "walk", "trot", "gallop"])
    })
  }),
  DirectorStageObjectBaseSchema.extend({
    kind: z.literal("prop"),
    prop: z.object({ type: DirectorStagePropTypeSchema })
  }),
  DirectorStageObjectBaseSchema.extend({
    kind: z.literal("set"),
    set: z.object({ type: DirectorStageSetTypeSchema })
  }),
  DirectorStageObjectBaseSchema.extend({
    kind: z.literal("vehicle"),
    vehicle: z.object({ type: DirectorStageVehicleTypeSchema })
  }),
  DirectorStageObjectBaseSchema.extend({
    kind: z.literal("light"),
    light: z.object({
      type: DirectorStageLightTypeSchema,
      intensity: z.number().finite().min(0).max(100),
      range: z.number().finite().positive().max(1e3),
      angle: z.number().finite().min(0.05).max(Math.PI / 2)
    })
  }),
  DirectorStageObjectBaseSchema.extend({
    kind: z.literal("crowd"),
    crowd: z.object({
      rows: z.number().int().min(1).max(50),
      columns: z.number().int().min(1).max(50),
      spacing: z.number().positive(),
      bodyType: z.enum(["neutral", "masculine", "feminine", "broad", "athletic", "slender"])
    })
  }),
  DirectorStageObjectBaseSchema.extend({
    kind: z.literal("model"),
    model: z.object({
      assetId: z.string().min(1),
      animation: z.object({
        jointCount: z.number().int().positive(),
        clipNames: z.array(z.string().min(1)).min(1),
        actionMap: z.record(z.string().min(1), z.string().min(1))
      }).optional()
    })
  })
]);
var DirectorStageCameraSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  position: DirectorStageVector3Schema,
  rotation: DirectorStageVector3Schema,
  fov: z.number().min(1).max(179),
  targetObjectId: z.string().min(1).optional(),
  targetObjectIds: z.array(z.string().min(1)).min(1).optional(),
  targetOffset: DirectorStageVector3Schema.optional(),
  optics: z.object({
    projection: z.enum(["perspective", "orthographic"]),
    focalLengthMm: z.number().positive().max(1e3),
    sensorWidthMm: z.number().positive().max(1e3),
    sensorHeightMm: z.number().positive().max(1e3),
    focusDistanceM: z.number().nonnegative(),
    fStop: z.number().positive().max(128),
    shutterAngleDegrees: z.number().positive().max(360),
    iso: z.number().positive().max(1e6),
    nearClipM: z.number().positive(),
    farClipM: z.number().positive()
  }).refine(
    (optics) => optics.farClipM > optics.nearClipM,
    { message: "Camera far clip must be greater than near clip" }
  ).optional()
});
var DirectorStageAspectRatioSchema = z.enum([
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "1:1"
]);
var DirectorStageShotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cameraId: z.string().min(1),
  sequenceShotId: z.string().min(1).optional(),
  assetId: z.string().min(1),
  aspectRatio: DirectorStageAspectRatioSchema,
  stageRevisionId: z.string().min(1),
  createdAt: z.string().datetime(),
  timeSeconds: z.number().nonnegative().optional()
});
var DirectorStageCameraRigPathSchema = z.object({
  interpolation: z.enum(["linear", "catmull-rom"]),
  points: z.array(DirectorStageVector3Schema).min(2)
});
var DirectorStageCameraRigOrientationSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("fixed-target"),
    target: DirectorStageVector3Schema
  }),
  z.object({
    mode: z.literal("target-object"),
    objectId: z.string().min(1),
    offset: DirectorStageVector3Schema.optional(),
    sampling: z.enum(["shot-start", "live"]).default("shot-start")
  }),
  z.object({
    mode: z.literal("keyed"),
    startRotation: DirectorStageVector3Schema,
    endRotation: DirectorStageVector3Schema
  })
]);
var DirectorStageCameraRigLensSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("locked"),
    focalLengthMm: z.number().positive().max(1e3)
  }),
  z.object({
    mode: z.literal("animated"),
    startFocalLengthMm: z.number().positive().max(1e3),
    endFocalLengthMm: z.number().positive().max(1e3)
  })
]);
var DirectorStageCameraRigSchema = z.object({
  kind: z.enum(["dolly", "truck", "pedestal", "pan", "tilt", "orbit", "crane"]),
  settleInSeconds: z.number().nonnegative(),
  settleOutSeconds: z.number().nonnegative(),
  path: DirectorStageCameraRigPathSchema.optional(),
  orbit: z.object({
    pivot: DirectorStageVector3Schema,
    radius: z.number().positive(),
    height: z.number().finite(),
    startAngleDegrees: z.number().finite(),
    endAngleDegrees: z.number().finite()
  }).optional(),
  orientation: DirectorStageCameraRigOrientationSchema,
  lens: DirectorStageCameraRigLensSchema,
  maxAngularVelocityDegPerSecond: z.number().positive().optional(),
  maxAngularAccelerationDegPerSecondSquared: z.number().positive().optional()
}).superRefine((rig, context) => {
  if (rig.kind === "orbit" && !rig.orbit) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["orbit"],
      message: "Orbit camera rigs require physical orbit parameters"
    });
  } else if (rig.kind !== "orbit" && !rig.path) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["path"],
      message: "Non-orbit camera rigs require a camera path"
    });
  }
});
var DirectorStageShotCompositionSchema = z.object({
  primarySubjectId: z.string().min(1),
  secondarySubjectIds: z.array(z.string().min(1)).optional(),
  headroomRatio: z.number().min(0).max(0.5),
  leadRoomRatio: z.number().min(0).max(0.5),
  minimumCameraDistanceM: z.number().positive(),
  minimumSubjectSeparationM: z.number().nonnegative(),
  axis: z.object({
    fromObjectId: z.string().min(1),
    toObjectId: z.string().min(1),
    cameraSide: z.enum(["left", "right"])
  }).optional()
});
var DirectorStageSequenceShotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cameraId: z.string().min(1),
  startTime: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  aspectRatio: DirectorStageAspectRatioSchema,
  transition: z.enum(["cut", "dissolve"]).default("cut"),
  storyBeatIds: z.array(z.string().min(1)).optional(),
  actionClipIds: z.array(z.string().min(1)).optional(),
  cameraMove: z.object({
    preset: z.string().min(1),
    easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]),
    rig: DirectorStageCameraRigSchema.optional()
  }).optional(),
  composition: DirectorStageShotCompositionSchema.optional()
});
var DirectorStageSignedAxisSchema = z.enum([
  "+X",
  "-X",
  "+Y",
  "-Y",
  "+Z",
  "-Z"
]);
var DirectorStageMotionAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  assetId: z.string().min(1),
  sourceFormat: z.enum(["gltf", "glb", "fbx", "bvh"]),
  clipName: z.string().min(1),
  durationSeconds: z.number().positive().optional(),
  sourceRig: z.object({
    profileId: z.string().min(1),
    skeletonType: z.enum(["biped", "quadruped", "other"]),
    restPose: z.enum(["t-pose", "a-pose", "unknown"]),
    upAxis: DirectorStageSignedAxisSchema,
    forwardAxis: DirectorStageSignedAxisSchema,
    metersPerUnit: z.number().positive(),
    rootBone: z.string().min(1),
    hipsBone: z.string().min(1).optional(),
    boneMap: z.record(z.string().min(1), z.string().min(1)).optional()
  }),
  tags: z.array(z.string().min(1)).optional()
});
var DirectorStageAnimationKeyframeSchema = z.object({
  id: z.string().min(1),
  time: z.number().nonnegative(),
  value: z.union([z.number(), DirectorStageVector3Schema]),
  interpolation: z.enum(["hold", "linear", "bezier"]).default("linear")
});
var DirectorStageAnimationTrackSchema = z.object({
  id: z.string().min(1),
  targetId: z.string().min(1),
  property: z.enum([
    "position",
    "rotation",
    "scale",
    "fov",
    "focalLengthMm",
    "focusDistanceM",
    "fStop"
  ]),
  keyframes: z.array(DirectorStageAnimationKeyframeSchema)
});
var DirectorStageActionNameSchema = z.enum([
  "idle",
  "walk",
  "run",
  "sit",
  "crouch",
  "kneel",
  "wave",
  "point",
  "think",
  "hands-up",
  "interact",
  "ride",
  "talk",
  "dance",
  "jump",
  "roll",
  "pickup",
  "push",
  "punch",
  "swim",
  "drive",
  "death"
]);
var DirectorStageActionLayerSchema = z.enum([
  "full-body",
  "upper-body"
]);
var DirectorStageActionClipSchema = z.object({
  id: z.string().min(1),
  targetId: z.string().min(1),
  action: DirectorStageActionNameSchema,
  layer: DirectorStageActionLayerSchema.default("full-body"),
  startTime: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  blendInSeconds: z.number().nonnegative().default(0.2),
  blendOutSeconds: z.number().nonnegative().default(0.2),
  playbackRate: z.number().positive().default(1),
  motionAssetId: z.string().min(1).optional(),
  sourceStartSeconds: z.number().nonnegative().optional(),
  sourceDurationSeconds: z.number().positive().optional(),
  loopMode: z.enum(["once", "repeat", "hold"]).optional(),
  rootMotionMode: z.enum(["apply", "in-place", "extract"]).optional(),
  retargeting: z.object({
    mode: z.enum(["direct", "humanoid"]),
    targetRigProfileId: z.string().min(1)
  }).optional()
});
var DirectorStageStoryBeatSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  startTime: z.number().nonnegative(),
  durationSeconds: z.number().positive(),
  participantIds: z.array(z.string().min(1)).min(1),
  dialogue: z.object({
    speakerId: z.string().min(1),
    text: z.string().min(1)
  }).optional()
});
var DirectorStageCameraCueSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cameraId: z.string().min(1),
  startTime: z.number().nonnegative(),
  durationSeconds: z.number().positive()
});
var DirectorStageWorkingVolumePresetSchema = z.enum([
  "compact",
  "standard",
  "large",
  "custom"
]);
var DirectorStageWorkingVolumeSchema = z.object({
  mode: z.literal("bounded-box"),
  preset: DirectorStageWorkingVolumePresetSchema,
  // Three uses X/Y/Z, so the stored order is width/height/depth.
  size: z.tuple([
    z.number().finite().positive().max(500),
    z.number().finite().positive().max(100),
    z.number().finite().positive().max(500)
  ]),
  // World-space center of the floor plane. The box center is derived at half height.
  origin: DirectorStageVector3Schema
});
var DirectorStageEnvironmentCalibrationSchema = z.object({
  projection: z.literal("equirectangular"),
  capturePosition: DirectorStageVector3Schema,
  captureRotation: DirectorStageVector3Schema,
  horizonV: z.number().min(0).max(1),
  forwardU: z.number().min(0).max(1),
  gridCellMeters: z.number().positive(),
  workingVolume: DirectorStageWorkingVolumeSchema.optional()
});
var DirectorStageStateSchema = z.object({
  schemaVersion: z.literal(1),
  scene: z.object({
    backgroundColor: z.string().min(1),
    environmentAssetId: z.string().min(1).optional(),
    environmentRotation: DirectorStageVector3Schema.optional(),
    environmentCalibration: DirectorStageEnvironmentCalibrationSchema.optional(),
    grid: z.object({
      visible: z.boolean(),
      snap: z.boolean(),
      size: z.number().positive()
    })
  }),
  objects: z.array(DirectorStageObjectSchema),
  cameras: z.array(DirectorStageCameraSchema),
  shots: z.array(DirectorStageShotSchema),
  shotSequence: z.array(DirectorStageSequenceShotSchema).optional(),
  motionAssets: z.array(DirectorStageMotionAssetSchema).optional(),
  activeCameraId: z.string().min(1).optional(),
  animation: z.object({
    durationSeconds: z.number().positive(),
    fps: z.number().int().positive(),
    tracks: z.array(DirectorStageAnimationTrackSchema),
    actionClips: z.array(DirectorStageActionClipSchema).optional(),
    storyBeats: z.array(DirectorStageStoryBeatSchema).optional(),
    cameraCues: z.array(DirectorStageCameraCueSchema).optional()
  }).optional()
});
var directorStageContractSchemas = {
  state: { schema: DirectorStageStateSchema, name: "DirectorStageState" },
  object: { schema: DirectorStageObjectSchema, name: "DirectorStageObject" },
  camera: { schema: DirectorStageCameraSchema, name: "DirectorStageCamera" }
};
var directorStageJsonSchemas = Object.fromEntries(
  Object.entries(directorStageContractSchemas).map(([contract, definition]) => [
    contract,
    zodToJsonSchema(definition.schema, {
      name: definition.name,
      target: "jsonSchema7"
    })
  ])
);
function directorDefaultAttachmentOffset(socket) {
  if (socket === "saddle") {
    return {
      position: [0, 1.62, -0.08],
      rotation: [0, 0, 0],
      scale: [1, 1, 1]
    };
  }
  if (socket === "seat") {
    return {
      position: [0, 0.78, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1]
    };
  }
  return {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  };
}
function attachmentGraphError(objects) {
  const byId = new Map(objects.map((object) => [object.id, object]));
  for (const object of objects) {
    const attachment = object.attachment;
    if (!attachment) continue;
    const parent = byId.get(attachment.parentId);
    if (!parent) return `Attachment parent ${attachment.parentId} not found`;
    if (attachment.socket === "saddle") {
      if (parent.kind !== "creature" || parent.creature.species !== "horse") {
        return "Saddle attachments require a horse parent";
      }
      if (object.kind !== "mannequin") {
        return "Saddle attachments require a mannequin child";
      }
    }
    const visited = /* @__PURE__ */ new Set([object.id]);
    let cursor = parent;
    while (cursor) {
      if (visited.has(cursor.id)) return "Attachment would create a cycle";
      visited.add(cursor.id);
      cursor = cursor.attachment ? byId.get(cursor.attachment.parentId) : void 0;
    }
  }
  return void 0;
}
function applyDirectorStageCommand(state, command2) {
  const parsedState = DirectorStageStateSchema.safeParse(state);
  if (!parsedState.success) {
    return { ok: false, error: parsedState.error.issues[0]?.message ?? "Invalid Director Stage state" };
  }
  const next = structuredClone(parsedState.data);
  if (command2.op === "object.add") {
    const object = DirectorStageObjectSchema.safeParse(command2.object);
    if (!object.success) {
      return { ok: false, error: object.error.issues[0]?.message ?? "Invalid Director Stage object" };
    }
    if (next.objects.some((candidate) => candidate.id === object.data.id)) {
      return { ok: false, error: `Object ${object.data.id} already exists` };
    }
    next.objects.push(object.data);
    const attachmentError = attachmentGraphError(next.objects);
    if (attachmentError) return { ok: false, error: attachmentError };
  }
  if (command2.op === "object.addMany") {
    if (command2.objects.length === 0) return { ok: false, error: "At least one object is required" };
    const parsedObjects = [];
    for (const candidate of command2.objects) {
      const object = DirectorStageObjectSchema.safeParse(candidate);
      if (!object.success) {
        return { ok: false, error: object.error.issues[0]?.message ?? "Invalid Director Stage object" };
      }
      parsedObjects.push(object.data);
    }
    const ids = new Set(next.objects.map((object) => object.id));
    for (const object of parsedObjects) {
      if (ids.has(object.id)) return { ok: false, error: `Object ${object.id} already exists` };
      ids.add(object.id);
    }
    next.objects.push(...parsedObjects);
    const attachmentError = attachmentGraphError(next.objects);
    if (attachmentError) return { ok: false, error: attachmentError };
  }
  if (command2.op === "object.update") {
    const objectIndex = next.objects.findIndex((candidate) => candidate.id === command2.objectId);
    if (objectIndex < 0) return { ok: false, error: `Object ${command2.objectId} not found` };
    const current = next.objects[objectIndex];
    const patch = command2.patch;
    const raw = {
      ...current,
      ...patch.name !== void 0 ? { name: patch.name } : {},
      ...patch.visible !== void 0 ? { visible: patch.visible } : {},
      ...patch.color !== void 0 ? { color: patch.color } : {},
      ...patch.groupId !== void 0 ? { groupId: patch.groupId } : {},
      transform: {
        ...current.transform,
        ...patch.transform ?? {}
      }
    };
    if (patch.pose !== void 0 || patch.bodyType !== void 0 || patch.bodyShape !== void 0) {
      if (current.kind !== "mannequin") {
        return { ok: false, error: `Object ${command2.objectId} does not support mannequin patches` };
      }
      raw.mannequin = {
        ...current.mannequin,
        ...patch.bodyType !== void 0 ? { bodyType: patch.bodyType } : {},
        ...patch.bodyShape !== void 0 ? { bodyShape: patch.bodyShape } : {},
        ...patch.pose !== void 0 ? { pose: patch.pose } : {}
      };
    }
    if (patch.creatureBuild !== void 0 || patch.creatureGait !== void 0) {
      if (current.kind !== "creature") {
        return { ok: false, error: `Object ${command2.objectId} does not support creature patches` };
      }
      raw.creature = {
        ...current.creature,
        ...patch.creatureBuild !== void 0 ? { build: patch.creatureBuild } : {},
        ...patch.creatureGait !== void 0 ? { gait: patch.creatureGait } : {}
      };
    }
    if (patch.propType !== void 0) {
      if (current.kind !== "prop") {
        return { ok: false, error: `Object ${command2.objectId} does not support prop patches` };
      }
      raw.prop = { ...current.prop, type: patch.propType };
    }
    if (patch.setType !== void 0) {
      if (current.kind !== "set") {
        return { ok: false, error: `Object ${command2.objectId} does not support set patches` };
      }
      raw.set = { ...current.set, type: patch.setType };
    }
    if (patch.vehicleType !== void 0) {
      if (current.kind !== "vehicle") {
        return { ok: false, error: `Object ${command2.objectId} does not support vehicle patches` };
      }
      raw.vehicle = { ...current.vehicle, type: patch.vehicleType };
    }
    if (patch.lightType !== void 0 || patch.lightIntensity !== void 0 || patch.lightRange !== void 0 || patch.lightAngle !== void 0) {
      if (current.kind !== "light") {
        return { ok: false, error: `Object ${command2.objectId} does not support light patches` };
      }
      raw.light = {
        ...current.light,
        ...patch.lightType !== void 0 ? { type: patch.lightType } : {},
        ...patch.lightIntensity !== void 0 ? { intensity: patch.lightIntensity } : {},
        ...patch.lightRange !== void 0 ? { range: patch.lightRange } : {},
        ...patch.lightAngle !== void 0 ? { angle: patch.lightAngle } : {}
      };
    }
    const updated = DirectorStageObjectSchema.safeParse(raw);
    if (!updated.success) {
      return { ok: false, error: updated.error.issues[0]?.message ?? "Invalid Director Stage object patch" };
    }
    next.objects[objectIndex] = updated.data;
  }
  if (command2.op === "object.group") {
    const ids = new Set(command2.objectIds);
    const missing = command2.objectIds.find((id2) => !next.objects.some((object) => object.id === id2));
    if (missing) return { ok: false, error: `Object ${missing} not found` };
    if (!command2.groupId.trim()) return { ok: false, error: "Group id is required" };
    next.objects = next.objects.map(
      (object) => ids.has(object.id) ? { ...object, groupId: command2.groupId } : object
    );
  }
  if (command2.op === "object.ungroup") {
    next.objects = next.objects.map((object) => {
      if (object.groupId !== command2.groupId) return object;
      const { groupId: _groupId, ...ungrouped } = object;
      return ungrouped;
    });
  }
  if (command2.op === "object.attach") {
    const objectIndex = next.objects.findIndex((object) => object.id === command2.objectId);
    if (objectIndex < 0) return { ok: false, error: `Object ${command2.objectId} not found` };
    if (!next.objects.some((object) => object.id === command2.parentId)) {
      return { ok: false, error: `Object ${command2.parentId} not found` };
    }
    const attachment = DirectorStageAttachmentSchema.safeParse({
      parentId: command2.parentId,
      socket: command2.socket,
      offset: command2.offset ?? directorDefaultAttachmentOffset(command2.socket)
    });
    if (!attachment.success) {
      return { ok: false, error: attachment.error.issues[0]?.message ?? "Invalid attachment" };
    }
    next.objects[objectIndex] = {
      ...next.objects[objectIndex],
      attachment: attachment.data
    };
    const attachmentError = attachmentGraphError(next.objects);
    if (attachmentError) return { ok: false, error: attachmentError };
  }
  if (command2.op === "object.detach") {
    const objectIndex = next.objects.findIndex((object) => object.id === command2.objectId);
    if (objectIndex < 0) return { ok: false, error: `Object ${command2.objectId} not found` };
    const current = next.objects[objectIndex];
    if (!current.attachment) return { ok: false, error: `Object ${command2.objectId} is not attached` };
    const { attachment: _attachment, ...detached } = current;
    next.objects[objectIndex] = detached;
  }
  if (command2.op === "object.remove") {
    if (!next.objects.some((object) => object.id === command2.objectId)) {
      return { ok: false, error: `Object ${command2.objectId} not found` };
    }
    next.objects = next.objects.filter((object) => object.id !== command2.objectId).map((object) => {
      if (object.attachment?.parentId !== command2.objectId) return object;
      const { attachment: _attachment, ...detached } = object;
      return detached;
    });
    next.cameras = next.cameras.map((camera) => {
      const remainingTargetObjectIds = camera.targetObjectIds?.filter(
        (targetId) => targetId !== command2.objectId
      );
      if (camera.targetObjectId !== command2.objectId && remainingTargetObjectIds?.length === camera.targetObjectIds?.length) {
        return camera;
      }
      const {
        targetObjectId: _targetObjectId,
        targetObjectIds: _targetObjectIds,
        targetOffset: _targetOffset,
        ...unbound
      } = camera;
      return {
        ...unbound,
        ...camera.targetObjectId !== command2.objectId ? { targetObjectId: camera.targetObjectId } : {},
        ...remainingTargetObjectIds?.length ? { targetObjectIds: remainingTargetObjectIds } : {},
        ...camera.targetObjectId !== command2.objectId || remainingTargetObjectIds?.length ? { targetOffset: camera.targetOffset } : {}
      };
    });
    if (next.animation) {
      next.animation.tracks = next.animation.tracks.filter(
        (track) => track.targetId !== command2.objectId
      );
      next.animation.actionClips = next.animation.actionClips?.filter(
        (clip) => clip.targetId !== command2.objectId
      );
      next.animation.storyBeats = next.animation.storyBeats?.filter((beat) => beat.dialogue?.speakerId !== command2.objectId).map((beat) => ({
        ...beat,
        participantIds: beat.participantIds.filter(
          (participantId) => participantId !== command2.objectId
        )
      })).filter((beat) => beat.participantIds.length > 0);
    }
  }
  if (command2.op === "camera.add") {
    const camera = DirectorStageCameraSchema.safeParse(command2.camera);
    if (!camera.success) {
      return { ok: false, error: camera.error.issues[0]?.message ?? "Invalid Director Stage camera" };
    }
    if (next.cameras.some((candidate) => candidate.id === camera.data.id)) {
      return { ok: false, error: `Camera ${camera.data.id} already exists` };
    }
    if (camera.data.targetObjectId && !next.objects.some((object) => object.id === camera.data.targetObjectId)) {
      return {
        ok: false,
        error: `Camera ${camera.data.id} targets missing object ${camera.data.targetObjectId}`
      };
    }
    const missingGroupTarget = camera.data.targetObjectIds?.find(
      (targetId) => !next.objects.some((object) => object.id === targetId)
    );
    if (missingGroupTarget) {
      return {
        ok: false,
        error: `Camera ${camera.data.id} targets missing object ${missingGroupTarget}`
      };
    }
    next.cameras.push(camera.data);
  }
  if (command2.op === "camera.update") {
    const cameraIndex = next.cameras.findIndex((candidate) => candidate.id === command2.cameraId);
    if (cameraIndex < 0) return { ok: false, error: `Camera ${command2.cameraId} not found` };
    const updated = DirectorStageCameraSchema.safeParse({
      ...next.cameras[cameraIndex],
      ...command2.patch,
      id: command2.cameraId
    });
    if (!updated.success) {
      return { ok: false, error: updated.error.issues[0]?.message ?? "Invalid Director Stage camera patch" };
    }
    if (updated.data.targetObjectId && !next.objects.some((object) => object.id === updated.data.targetObjectId)) {
      return {
        ok: false,
        error: `Camera ${command2.cameraId} targets missing object ${updated.data.targetObjectId}`
      };
    }
    const missingGroupTarget = updated.data.targetObjectIds?.find(
      (targetId) => !next.objects.some((object) => object.id === targetId)
    );
    if (missingGroupTarget) {
      return {
        ok: false,
        error: `Camera ${command2.cameraId} targets missing object ${missingGroupTarget}`
      };
    }
    next.cameras[cameraIndex] = updated.data;
  }
  if (command2.op === "camera.remove") {
    if (!next.cameras.some((camera) => camera.id === command2.cameraId)) {
      return { ok: false, error: `Camera ${command2.cameraId} not found` };
    }
    if (next.shots.some((shot) => shot.cameraId === command2.cameraId)) {
      return { ok: false, error: `Camera ${command2.cameraId} has captured shots` };
    }
    if (next.shotSequence?.some((shot) => shot.cameraId === command2.cameraId)) {
      return { ok: false, error: `Camera ${command2.cameraId} is used by the shot sequence` };
    }
    next.cameras = next.cameras.filter((camera) => camera.id !== command2.cameraId);
    if (next.activeCameraId === command2.cameraId) delete next.activeCameraId;
    if (next.animation) {
      next.animation.tracks = next.animation.tracks.filter(
        (track) => track.targetId !== command2.cameraId
      );
      next.animation.cameraCues = next.animation.cameraCues?.filter(
        (cue) => cue.cameraId !== command2.cameraId
      );
    }
  }
  if (command2.op === "shot.register") {
    const shot = DirectorStageShotSchema.safeParse(command2.shot);
    if (!shot.success) {
      return { ok: false, error: shot.error.issues[0]?.message ?? "Invalid Director Stage shot" };
    }
    if (next.shots.some((candidate) => candidate.id === shot.data.id)) {
      return { ok: false, error: `Shot ${shot.data.id} already exists` };
    }
    if (!next.cameras.some((camera) => camera.id === shot.data.cameraId)) {
      return { ok: false, error: `Shot ${shot.data.id} uses missing camera ${shot.data.cameraId}` };
    }
    next.shots.push(shot.data);
  }
  if (command2.op === "sequence-shot.upsert") {
    const shot = DirectorStageSequenceShotSchema.safeParse(command2.shot);
    if (!shot.success) {
      return { ok: false, error: shot.error.issues[0]?.message ?? "Invalid sequence shot" };
    }
    if (!next.cameras.some((camera) => camera.id === shot.data.cameraId)) {
      return { ok: false, error: `Shot ${shot.data.id} uses missing camera ${shot.data.cameraId}` };
    }
    if (shot.data.startTime + shot.data.durationSeconds > command2.durationSeconds + Number.EPSILON) {
      return {
        ok: false,
        error: `Shot ${shot.data.id} ends after the ${command2.durationSeconds}s sequence`
      };
    }
    const shots = [...next.shotSequence ?? []];
    const existingIndex = shots.findIndex((candidate) => candidate.id === shot.data.id);
    if (existingIndex >= 0) shots[existingIndex] = shot.data;
    else shots.push(shot.data);
    shots.sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id));
    next.shotSequence = shots;
    const animation = next.animation ?? {
      durationSeconds: command2.durationSeconds,
      fps: command2.fps,
      tracks: []
    };
    animation.durationSeconds = command2.durationSeconds;
    animation.fps = command2.fps;
    next.animation = animation;
  }
  if (command2.op === "sequence-shot.remove") {
    if (!next.shotSequence?.some((shot) => shot.id === command2.shotId)) {
      return { ok: false, error: `Sequence shot ${command2.shotId} not found` };
    }
    next.shotSequence = next.shotSequence.filter((shot) => shot.id !== command2.shotId);
  }
  if (command2.op === "motion.upsert") {
    const motion = DirectorStageMotionAssetSchema.safeParse(command2.motion);
    if (!motion.success) {
      return { ok: false, error: motion.error.issues[0]?.message ?? "Invalid motion asset" };
    }
    const motions = [...next.motionAssets ?? []];
    const existingIndex = motions.findIndex((candidate) => candidate.id === motion.data.id);
    if (existingIndex >= 0) motions[existingIndex] = motion.data;
    else motions.push(motion.data);
    motions.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    next.motionAssets = motions;
  }
  if (command2.op === "motion.remove") {
    if (!next.motionAssets?.some((motion) => motion.id === command2.motionId)) {
      return { ok: false, error: `Motion asset ${command2.motionId} not found` };
    }
    if (next.animation?.actionClips?.some((clip) => clip.motionAssetId === command2.motionId)) {
      return { ok: false, error: `Motion asset ${command2.motionId} is used by an action clip` };
    }
    next.motionAssets = next.motionAssets.filter((motion) => motion.id !== command2.motionId);
  }
  if (command2.op === "scene.update") {
    next.scene = {
      ...next.scene,
      ...command2.patch.backgroundColor !== void 0 ? { backgroundColor: command2.patch.backgroundColor } : {},
      ...command2.patch.environmentAssetId !== void 0 ? { environmentAssetId: command2.patch.environmentAssetId } : {},
      ...command2.patch.environmentRotation !== void 0 ? { environmentRotation: command2.patch.environmentRotation } : {},
      ...command2.patch.environmentCalibration !== void 0 ? { environmentCalibration: command2.patch.environmentCalibration } : {},
      grid: {
        ...next.scene.grid,
        ...command2.patch.grid ?? {}
      }
    };
  }
  if (command2.op === "keyframe.upsert") {
    const targetExists = next.objects.some((object) => object.id === command2.track.targetId) || next.cameras.some((camera) => camera.id === command2.track.targetId);
    if (!targetExists) {
      return { ok: false, error: `Animation target ${command2.track.targetId} not found` };
    }
    const parsedKeyframe = DirectorStageAnimationKeyframeSchema.safeParse(command2.keyframe);
    if (!parsedKeyframe.success) {
      return { ok: false, error: parsedKeyframe.error.issues[0]?.message ?? "Invalid keyframe" };
    }
    const animation = next.animation ?? {
      durationSeconds: command2.durationSeconds,
      fps: command2.fps,
      tracks: []
    };
    animation.durationSeconds = command2.durationSeconds;
    animation.fps = command2.fps;
    let track = animation.tracks.find((candidate) => candidate.id === command2.track.id);
    if (!track) {
      track = { ...command2.track, keyframes: [] };
      animation.tracks.push(track);
    } else if (track.targetId !== command2.track.targetId || track.property !== command2.track.property) {
      return { ok: false, error: `Track ${command2.track.id} identity does not match` };
    }
    const existingIndex = track.keyframes.findIndex(
      (keyframe) => keyframe.id === parsedKeyframe.data.id
    );
    if (existingIndex >= 0) track.keyframes[existingIndex] = parsedKeyframe.data;
    else track.keyframes.push(parsedKeyframe.data);
    track.keyframes.sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
    animation.tracks.sort((left, right) => left.id.localeCompare(right.id));
    next.animation = animation;
  }
  if (command2.op === "keyframe.remove") {
    const animation = next.animation;
    const track = animation?.tracks.find((candidate) => candidate.id === command2.trackId);
    if (!animation || !track) {
      return { ok: false, error: `Animation track ${command2.trackId} not found` };
    }
    if (!track.keyframes.some((keyframe) => keyframe.id === command2.keyframeId)) {
      return { ok: false, error: `Keyframe ${command2.keyframeId} not found` };
    }
    track.keyframes = track.keyframes.filter(
      (keyframe) => keyframe.id !== command2.keyframeId
    );
    if (track.keyframes.length === 0) {
      animation.tracks = animation.tracks.filter(
        (candidate) => candidate.id !== command2.trackId
      );
    }
  }
  if (command2.op === "action.upsert") {
    const target = next.objects.find((object) => object.id === command2.clip.targetId);
    const actionCapable = target?.kind === "mannequin" || target?.kind === "model" && Boolean(target.model.animation);
    if (!actionCapable) {
      return { ok: false, error: `Action target ${command2.clip.targetId} must be an action-capable object` };
    }
    const parsedClip = DirectorStageActionClipSchema.safeParse(command2.clip);
    if (!parsedClip.success) {
      return { ok: false, error: parsedClip.error.issues[0]?.message ?? "Invalid action clip" };
    }
    if (parsedClip.data.motionAssetId && !next.motionAssets?.some((motion) => motion.id === parsedClip.data.motionAssetId)) {
      return {
        ok: false,
        error: `Motion asset ${parsedClip.data.motionAssetId} not found`
      };
    }
    if (parsedClip.data.startTime + parsedClip.data.durationSeconds > command2.durationSeconds + Number.EPSILON) {
      return {
        ok: false,
        error: `Action clip ${parsedClip.data.id} ends after the ${command2.durationSeconds}s animation`
      };
    }
    const animation = next.animation ?? {
      durationSeconds: command2.durationSeconds,
      fps: command2.fps,
      tracks: []
    };
    animation.durationSeconds = command2.durationSeconds;
    animation.fps = command2.fps;
    const actionClips = [...animation.actionClips ?? []];
    const existingIndex = actionClips.findIndex((clip) => clip.id === parsedClip.data.id);
    if (existingIndex >= 0) actionClips[existingIndex] = parsedClip.data;
    else actionClips.push(parsedClip.data);
    actionClips.sort((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id));
    animation.actionClips = actionClips;
    next.animation = animation;
  }
  if (command2.op === "action.remove") {
    if (!next.animation?.actionClips?.some((clip) => clip.id === command2.clipId)) {
      return { ok: false, error: `Action clip ${command2.clipId} not found` };
    }
    next.animation.actionClips = next.animation.actionClips.filter(
      (clip) => clip.id !== command2.clipId
    );
  }
  const validated = DirectorStageStateSchema.safeParse(next);
  if (!validated.success) {
    return { ok: false, error: validated.error.issues[0]?.message ?? "Invalid Director Stage command result" };
  }
  return { ok: true, state: validated.data };
}
var id = z.string().trim().min(1);
var actorClientType = z.enum(["browser", "cli", "mcp", "agent"]).optional();
var observed = {
  actorClientType,
  observedVersion: id.optional(),
  ifMatch: id.optional()
};
var position = z.object({ x: z.number().finite(), y: z.number().finite() });
var primitiveParameter = z.union([z.string(), z.number().finite(), z.boolean()]);
var command = (action, shape = {}) => z.object({ action: z.literal(action), ...shape }).passthrough();
var addCommand = z.object({
  action: z.literal("add"),
  canvasId: id.optional(),
  type: z.enum([
    "text",
    "group",
    "remotion",
    "image_gen",
    "video_gen",
    "audio_gen",
    "text_gen"
  ]),
  label: id,
  content: z.string().optional(),
  prompt: z.string().optional(),
  parentId: id.optional(),
  modelId: id.optional(),
  actionId: id.optional(),
  refs: z.array(id).optional(),
  params: z.record(id, primitiveParameter).optional(),
  actorClientType,
  actorAgentId: id.optional()
}).strict();
var ProjectHostCommandSchema = z.discriminatedUnion("action", [
  command("list_canvases"),
  command("create_canvas", { canvasId: id, name: id }),
  command("rename_canvas", { canvasId: id, name: id, ...observed }),
  command("delete_canvas", { canvasId: id, ...observed }),
  command("list_timelines"),
  command("validate_timeline", { document: z.unknown() }),
  command("list_timeline_renders", {
    status: z.enum(["completed", "all"]).optional()
  }),
  command("create_timeline", {
    timelineId: id,
    name: id,
    state: z.unknown().optional()
  }),
  command("update_timeline_state", {
    timelineId: id,
    state: z.unknown(),
    ...observed
  }),
  command("attach_timeline", {
    timelineId: id,
    canvasId: id,
    actionNodeId: id.optional(),
    position: position.optional(),
    ...observed
  }),
  command("detach_timeline", { timelineId: id, ...observed }),
  command("copy_timeline_action", {
    sourceTimelineId: id,
    targetCanvasId: id,
    newTimelineId: id.optional(),
    newActionNodeId: id.optional(),
    position: position.optional(),
    ...observed
  }),
  command("request_timeline_render", {
    timelineId: id,
    actorAgentId: id.optional(),
    ...observed
  }),
  command("list_director_stages"),
  command("create_director_stage", {
    stageId: id,
    name: id,
    state: z.unknown().optional()
  }),
  command("update_director_stage_state", {
    stageId: id,
    state: z.unknown(),
    ...observed
  }),
  command("attach_director_stage", {
    stageId: id,
    canvasId: id,
    actionNodeId: id.optional(),
    position: position.optional(),
    ...observed
  }),
  command("detach_director_stage", { stageId: id, ...observed }),
  command("capture_director_stage", {
    stageId: id,
    frames: z.array(z.object({
      label: id,
      timeSeconds: z.number().finite().nonnegative(),
      aspectRatio: z.enum(["16:9", "9:16", "4:3", "3:4", "1:1"])
    }).strict()).min(1).max(12),
    longEdge: z.number().int().min(256).max(4096),
    ...observed
  }),
  command("list", { canvasId: id.optional(), type: id.optional() }),
  command("edges", { canvasId: id.optional() }),
  command("batch_delete_plan", {
    canvasId: id.optional(),
    nodeIds: z.array(id).min(1)
  }),
  command("get", { canvasId: id.optional(), nodeId: id }),
  addCommand,
  command("update", {
    canvasId: id.optional(),
    nodeId: id,
    label: z.string().optional(),
    content: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    ...observed
  }),
  command("move", {
    canvasId: id.optional(),
    nodeId: id,
    position,
    ...observed
  }),
  command("copy_node", {
    canvasId: id.optional(),
    nodeId: id,
    newNodeId: id.optional(),
    ...observed
  }),
  command("text_cas_update", {
    canvasId: id.optional(),
    projectId: id.optional(),
    nodeId: id,
    content: z.string(),
    cwd: id.optional(),
    filePath: id.optional(),
    parentRevisionId: id.optional(),
    actor: z.unknown().optional(),
    ...observed
  }),
  command("text_cow_replace", {
    canvasId: id.optional(),
    projectId: id.optional(),
    nodeId: id,
    content: z.string(),
    cwd: id.optional(),
    filePath: id.optional(),
    parentRevisionId: id.optional(),
    label: z.string().optional(),
    newNodeId: id.optional(),
    actor: z.unknown().optional(),
    ...observed
  }),
  command("delete", { canvasId: id.optional(), nodeId: id, ...observed }),
  command("delete_batch", {
    canvasId: id.optional(),
    nodeIds: z.array(id).min(1),
    ...observed
  }),
  command("asset_cow_replace", {
    canvasId: id.optional(),
    nodeId: id,
    assetId: id,
    newNodeId: id.optional(),
    label: z.string().optional(),
    ...observed
  }),
  command("search", {
    canvasId: id.optional(),
    query: z.string(),
    types: z.array(id).nullable().optional()
  }),
  command("execute", {
    canvasId: id.optional(),
    nodeId: id,
    providerAccountId: id.optional(),
    ...observed
  }),
  command("ensure_edge", { canvasId: id.optional(), source: id, target: id }),
  command("ping")
]);
var AtomicTaskTypeSchema = z.enum([
  "image_gen",
  // Generate image
  "video_gen",
  // Generate video
  "audio_gen",
  // Generate audio
  "text_gen",
  // Generate text
  "description",
  // Generate description for asset
  "understand"
  // Comprehensive understanding (ASR + visual analysis)
]);
var ImageGenParamsSchema = z.object({
  prompt: z.string(),
  model: z.string().default("nano-banana-pro"),
  model_params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  reference_images: z.array(z.string()).optional(),
  aspect_ratio: z.string().optional()
});
var VideoGenParamsSchema = z.object({
  prompt: z.string(),
  image_r2_key: z.string().optional(),
  duration: z.union([z.number(), z.string()]).default(5),
  model: z.string().default("kling-image2video"),
  model_params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  reference_images: z.array(z.string()).optional(),
  reference_mode: z.string().optional(),
  aspect_ratio: z.string().optional(),
  resolution: z.string().optional(),
  negative_prompt: z.string().optional(),
  cfg_scale: z.number().optional()
});
var AudioGenParamsSchema = z.object({
  prompt: z.string(),
  model: z.string().default("gemini-3.1-flash-tts"),
  model_params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
});
var TextGenParamsSchema = z.object({
  prompt: z.string(),
  model: z.string().default("gpt-5.4"),
  model_params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
});
var DescriptionParamsSchema = z.object({
  r2_key: z.string(),
  mime_type: z.string()
});
var UnderstandParamsSchema = z.object({
  r2_key: z.string(),
  mime_type: z.string(),
  language: z.string().optional()
});
var AtomicTaskRequestSchema = z.discriminatedUnion("task_type", [
  z.object({ task_type: z.literal("image_gen"), params: ImageGenParamsSchema }),
  z.object({ task_type: z.literal("video_gen"), params: VideoGenParamsSchema }),
  z.object({ task_type: z.literal("audio_gen"), params: AudioGenParamsSchema }),
  z.object({ task_type: z.literal("text_gen"), params: TextGenParamsSchema }),
  z.object({ task_type: z.literal("description"), params: DescriptionParamsSchema }),
  z.object({ task_type: z.literal("understand"), params: UnderstandParamsSchema })
]);
var AtomicTaskResultSchema = z.object({
  success: z.boolean(),
  r2_key: z.string().optional(),
  external_task_id: z.string().optional(),
  data: z.record(z.any()).optional(),
  error: z.string().optional()
});
var DOStepStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed"
]);
var DOStateSchema = z.object({
  task_id: z.string(),
  project_id: z.string(),
  node_id: z.string(),
  current_step: z.string(),
  step_status: DOStepStatusSchema,
  retry_count: z.number().default(0),
  max_retries: z.number().default(3),
  results: z.record(z.any()).default({}),
  error: z.string().optional(),
  created_at: z.number(),
  updated_at: z.number()
});
var CredentialSourceKindSchema = z.enum([
  "field",
  "choice",
  "button",
  "display-code"
]);
var GOOGLE_PLATFORMS = {
  "ai-studio": "https://generativelanguage.googleapis.com",
  "agent-platform": "https://aiplatform.googleapis.com"
};
var GooglePlatformSchema = z.enum(
  Object.keys(GOOGLE_PLATFORMS)
);
var AccountSettingOptionSchema = z.object({
  value: z.string().trim().min(1),
  /** What the person choosing reads. Names the service, not our identifier for it. */
  label: z.string().trim().min(1)
}).strict();
var AccountSettingSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  /** A closed set makes this a choice; without it the setting is free text. */
  options: z.array(AccountSettingOptionSchema).nonempty().optional(),
  /** What the setting is when nobody said. Must be one of the options, when there are options. */
  defaultValue: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional()
}).strict().superRefine((setting, ctx) => {
  if (setting.options && setting.defaultValue && !setting.options.some((option) => option.value === setting.defaultValue)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultValue"],
      message: `Default "${setting.defaultValue}" is not one of the options. A default outside the set would be stored, pass validation, and then match nothing downstream.`
    });
  }
});
var DynamicProviderIdSchema = z.string().trim().regex(
  /^[a-z0-9][a-z0-9._-]*$/,
  "Provider ecosystem ids must be lowercase plugin-safe identifiers."
);
var BuiltinModelUpstreamIdSchema = z.enum([
  "local",
  "mock",
  "fal",
  "bfl",
  "pika",
  "google-ai-studio",
  "google-agent-platform",
  "openai",
  "anthropic",
  "openrouter",
  "replicate",
  "kling",
  "minimax",
  "volcengine",
  "elevenlabs",
  "suno"
]);
var ModelUpstreamIdSchema = DynamicProviderIdSchema;
var BuiltinModelUpstreamApiShapeSchema = z.enum([
  "local-asr",
  "local-tts",
  "fal",
  "bfl",
  "pika",
  "pika-chat",
  "google-agent-platform",
  "google-ai-studio",
  "google-ai-studio-interactions",
  "openai-images",
  "openai-compatible",
  "anthropic-compatible",
  "replicate",
  "kling",
  "minimax",
  "modelark",
  "elevenlabs",
  "suno"
]);
var ModelUpstreamApiShapeSchema = DynamicProviderIdSchema;
var BuiltinProviderOAuthIdSchema = z.never();
var ProviderOAuthIdSchema = DynamicProviderIdSchema;
var BuiltinProviderAccountIdSchema = z.enum([
  "local",
  "official",
  "fal",
  "pika",
  "replicate",
  "kling",
  "minimax",
  "volcengine",
  "elevenlabs",
  "suno",
  "mock",
  "custom"
]);
var ModelCardProviderBindingSchema = z.object({
  providerAccountId: z.string().trim().min(1),
  upstreamModel: z.string().trim().min(1)
});
var UserModelCardConfigSchema = z.object({
  modelId: z.string().trim().min(1),
  custom: z.boolean().default(false),
  name: z.string().trim().min(1).optional(),
  kind: z.literal("text").default("text"),
  description: z.string().trim().optional(),
  promptGuidance: z.string().trim().optional(),
  providerBindings: z.array(ModelCardProviderBindingSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
function falMock(modelCode, kind, upstreamModel) {
  return {
    modelCode,
    kind,
    providerId: "mock",
    upstreamId: "mock",
    upstreamModel,
    apiShape: "fal",
    priority: 1
  };
}
var FAL_IMAGE_ROUTES = [
  ["flux-schnell", "fal-ai/flux/schnell"],
  ["flux-dev", "fal-ai/flux/dev"],
  ["gpt-image-2", "openai/gpt-image-2"],
  ["nano-banana-2", "fal-ai/nano-banana-2"],
  ["seedream-4.5", "fal-ai/bytedance/seedream/v4.5/text-to-image"],
  ["recraft-v4", "fal-ai/recraft/v4/pro/text-to-image"],
  ["flux-2-pro", "fal-ai/flux-2-pro"]
];
var FAL_VIDEO_ROUTES = [
  ["sora-2", "fal-ai/sora-2/text-to-video"],
  ["kling-3", "fal-ai/kling-video/v3/pro/image-to-video"],
  ["seedance-2-startend", "bytedance/seedance-2.0/image-to-video"],
  ["seedance-2-ref", "bytedance/seedance-2.0/reference-to-video"]
];
var GOOGLE_IMAGE_ROUTES = [
  ["nano-banana-2", "gemini-3.1-flash-image"],
  ["nano-banana-pro", "gemini-3-pro-image"]
];
var GOOGLE_VIDEO_ROUTES = [
  ["veo-3.1", "veo-3.1-generate-001"],
  ["veo-3.1-startend", "veo-3.1-generate-001"],
  ["veo-3.1-fast", "veo-3.1-fast-generate-001"],
  ["veo-3.1-fast-startend", "veo-3.1-fast-generate-001"]
];
function routesFromModelCard(model) {
  return (model.providerImplementations ?? []).map((implementation) => ({
    modelCode: model.id,
    kind: model.kind,
    providerId: implementation.providerId,
    ...implementation.accountId ? { accountId: implementation.accountId } : {},
    ...implementation.region ? { region: implementation.region } : {},
    upstreamId: ModelUpstreamIdSchema.parse(implementation.upstreamId),
    upstreamModel: implementation.upstreamModel,
    apiShape: ModelUpstreamApiShapeSchema.parse(implementation.apiShape),
    priority: implementation.priority ?? 100,
    ...implementation.weight !== void 0 ? { weight: implementation.weight } : {},
    ...implementation.requiredCredentials?.length ? { requiredCredentials: [...implementation.requiredCredentials] } : {},
    ...implementation.credentialRequirements ? {
      credentialRequirements: {
        ...implementation.credentialRequirements,
        anyOf: implementation.credentialRequirements.anyOf.map((credentials) => [...credentials])
      }
    } : {},
    ...implementation.requiredOAuth?.length ? { requiredOAuth: implementation.requiredOAuth.map((provider) => ProviderOAuthIdSchema.parse(provider)) } : {},
    ...implementation.referenceBinding ?? model.input.referenceBinding ? { referenceBinding: implementation.referenceBinding ?? model.input.referenceBinding } : {},
    ...implementation.inputAdaptation ? {
      inputAdaptation: {
        ...implementation.inputAdaptation.audio ? {
          audio: {
            mimeAliases: { ...implementation.inputAdaptation.audio.mimeAliases }
          }
        } : {}
      }
    } : {},
    ...implementation.parameterOverrides?.length ? { parameterOverrides: implementation.parameterOverrides.map((parameter) => ({ ...parameter })) } : {},
    ...implementation.defaultParamOverrides ? { defaultParamOverrides: { ...implementation.defaultParamOverrides } } : {},
    ...implementation.excludedParameterIds?.length ? { excludedParameterIds: [...implementation.excludedParameterIds] } : {},
    ...implementation.projectorPluginId ? { projectorPluginId: implementation.projectorPluginId } : {},
    ...implementation.projectorExportId ? { projectorExportId: implementation.projectorExportId } : {},
    ...implementation.executorPluginId ? { executorPluginId: implementation.executorPluginId } : {},
    ...implementation.executorExportId ? { executorExportId: implementation.executorExportId } : {}
  }));
}
function routesFromModelCards(models) {
  return models.flatMap(routesFromModelCard);
}
var MODEL_DECLARED_ROUTES = routesFromModelCards(MODEL_CARDS);
var MOCK_DECLARED_ROUTES = routesFromModelCards(MOCK_MODEL_CARDS);
var MOCK_ROUTES = [
  ...FAL_IMAGE_ROUTES.map(([modelCode, upstreamModel]) => falMock(modelCode, "image", upstreamModel)),
  ...FAL_VIDEO_ROUTES.map(([modelCode, upstreamModel]) => falMock(modelCode, "video", upstreamModel)),
  ...GOOGLE_IMAGE_ROUTES.map(([modelCode]) => falMock(modelCode, "image", "fal-ai/nano-banana-2")),
  ...GOOGLE_VIDEO_ROUTES.map(([modelCode]) => falMock(modelCode, "video", modelCode.includes("fast") ? "fal-ai/veo3/fast" : "fal-ai/veo3")),
  falMock("minimax-tts", "audio", "fal-ai/minimax/speech-02-hd"),
  falMock("elevenlabs-tts", "audio", "fal-ai/minimax/speech-02-hd")
];
var MODEL_UPSTREAM_ROUTES = [
  ...MODEL_DECLARED_ROUTES,
  ...MOCK_DECLARED_ROUTES,
  ...MOCK_ROUTES
];
var MediaTranscriptMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("media.transcript"),
  backendId: z.string().min(1),
  modelId: z.string().min(1),
  language: z.string().min(1).optional(),
  /** The media this grid was transcribed from. */
  sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  /**
   * The word grid itself. Downstream wordIds only mean anything against this,
   * and it survives a reflow of `text` or `segments` unchanged.
   */
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  /**
   * Where the full body is stored. Distinct from `contentHash` on purpose: this
   * addresses the whole document, so restating the same grid moves it.
   */
  bodyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  summary: z.object({
    wordCount: z.number().int().nonnegative(),
    durationMs: z.number().int().min(0),
    segmentCount: z.number().int().nonnegative().optional(),
    averageConfidence: z.number().min(0).max(1).optional()
  })
});
var MediaRenderLineageMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("media.render-lineage"),
  /** The entity rendered, e.g. a Director Stage or a Timeline. */
  sourceEntityKind: z.string().min(1),
  sourceEntityId: z.string().min(1),
  /** The exact revision rendered, so a later edit cannot be mistaken for this one. */
  sourceRevisionId: z.string().min(1),
  /** Where in the entity's own time this frame was taken, when it has time. */
  timeSeconds: z.number().nonnegative().optional(),
  /** Which renderer produced it. */
  renderer: z.string().min(1).optional(),
  /** The media file this describes. */
  sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
});
var MediaDescriptionMetadataSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("media.description"),
  text: z.string().min(1),
  language: z.string().min(1).optional(),
  /** Which model or person wrote it. */
  producerModelId: z.string().min(1).optional(),
  /** The media file this describes. */
  sourceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
});
var declaredKinds = /* @__PURE__ */ new Map();
function registerAssetMetadataKind(declaration) {
  const issuesFor = (probe) => {
    const result = declaration.schema.safeParse(probe);
    return result.success ? [] : result.error.issues;
  };
  const complainsAbout = (issues, field3) => issues.some((issue2) => issue2.path.length === 1 && issue2.path[0] === field3);
  if (complainsAbout(issuesFor({ schemaVersion: 1, kind: declaration.kind }), "kind")) {
    throw new Error(
      `Asset metadata kind ${declaration.kind} must declare a schema that pins its own kind`
    );
  }
  if (!complainsAbout(issuesFor({ kind: declaration.kind }), "schemaVersion")) {
    throw new Error(
      `Asset metadata kind ${declaration.kind} must declare a schemaVersion`
    );
  }
  declaredKinds.set(declaration.kind, declaration);
}
var FillActionEnvelopeSchema = z.object({
  actionId: z.string().min(1),
  targetAssetId: z.string().min(1),
  metadataKind: z.string().min(1),
  metadata: z.object({ kind: z.string().min(1) }).passthrough(),
  producer: z.string().min(1),
  createdAt: z.string().optional()
});
registerAssetMetadataKind({
  kind: "media.transcript",
  schema: MediaTranscriptMetadataSchema
});
registerAssetMetadataKind({
  kind: "media.description",
  schema: MediaDescriptionMetadataSchema
});
registerAssetMetadataKind({
  kind: "media.render-lineage",
  schema: MediaRenderLineageMetadataSchema
});
var CATEGORY_ALLOWED_ITEM_TYPES = Object.fromEntries(
  Object.entries(TIMELINE_DSL_CATEGORY_ALLOWED_ITEM_TYPES).map(([category, itemTypes]) => [
    category,
    new Set(itemTypes)
  ])
);
var CLIP_ANIMATION_TYPES = new Set(TIMELINE_CLIP_ANIMATION_TYPES);
var TextRevisionActorSchema = z.object({
  actorType: z.enum(["user", "agent"]),
  actorUserId: z.string(),
  actorAgentId: z.string().optional()
});
var TextRevisionContentDescriptorSchema = z.object({
  kind: z.literal("text-revision-content"),
  stored: z.literal(true).optional(),
  contentHash: z.string(),
  mediaType: z.literal("text/markdown"),
  url: z.string(),
  immutable: z.literal(true),
  storage: z.object({
    kind: z.literal("content-addressed-revision-blob"),
    registry: z.literal("text_revisions"),
    mediaAsset: z.literal(false),
    agentWritable: z.literal(false)
  })
});
var TextAppliedRevisionSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("clash.text.revision"),
  textId: z.string(),
  revisionId: z.string(),
  parentRevisionId: z.string().optional(),
  projectId: z.string(),
  nodeId: z.string(),
  createdAt: z.string(),
  contentHash: z.string(),
  hashAlgorithm: z.literal("sha256-64"),
  sourceFilePath: z.string(),
  sourceFileHash: z.string(),
  actor: TextRevisionActorSchema.optional()
});
var TextRevisionHistoryEntrySchema = TextAppliedRevisionSchema.extend({
  content: TextRevisionContentDescriptorSchema.optional()
});
var AssetStatusSchema = z.enum([
  "uploading",
  // 上传中
  "generating",
  // 生成中 → 触发 GenPipeline
  "completed",
  // 资源就绪 → 触发 DescribePipeline
  "fin",
  // 全部完成
  "failed"
  // 失败
]);
var TaskStateSchema = z.enum([
  "pending",
  // 等待提交
  "submitted",
  // 已提交，等待 poll
  "completed",
  // 完成
  "failed"
  // 失败
]);
var PipelineTaskDefSchema = z.object({
  id: z.string(),
  // 任务 ID (在 pipeline 内唯一)
  taskType: z.string(),
  // Python API task_type
  // params 从 node data 和 previous task results 构建
  // 用 {{xxx}} 模板语法引用
  paramsTemplate: z.record(z.string()).optional()
});
var SuperstepDefSchema = z.object({
  id: z.string(),
  // superstep ID
  tasks: z.array(PipelineTaskDefSchema)
});
var PipelineDefSchema = z.object({
  id: z.string(),
  // pipeline ID (e.g., 'image_gen', 'describe')
  nodeType: z.string(),
  // 适用的节点类型 (e.g., 'image', 'video')
  fromStatus: AssetStatusSchema,
  // 入口状态
  toStatus: AssetStatusSchema,
  // 出口状态
  supersteps: z.array(SuperstepDefSchema)
});
var TaskRuntimeStateSchema = z.object({
  id: z.string(),
  state: TaskStateSchema,
  externalTaskId: z.string().optional(),
  result: z.record(z.any()).optional(),
  error: z.string().optional(),
  submittedAt: z.number().optional(),
  completedAt: z.number().optional()
});
var PipelineRuntimeStateSchema = z.object({
  pipelineId: z.string(),
  currentSuperstep: z.number(),
  tasks: z.record(TaskRuntimeStateSchema),
  // taskId → state
  startedAt: z.number(),
  completedAt: z.number().optional()
});
var ProviderUsageStatusSchema = z.enum(["submitted", "completed", "failed"]);
var ProviderUsagePricingSourceSchema = z.enum(["pika-catalog", "unavailable"]);
var ProviderUsageAuditEventSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  providerId: z.string().min(1),
  providerAccountId: z.string().min(1).optional(),
  modelId: z.string().min(1),
  operation: z.string().min(1),
  taskId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  actorType: z.enum(["user", "agent"]).optional(),
  actorUserId: z.string().min(1).optional(),
  actorAgentId: z.string().min(1).optional(),
  providerRequestId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
  status: ProviderUsageStatusSchema,
  estimatedCostMicroUsd: z.number().int().nonnegative().optional(),
  estimateComplete: z.boolean(),
  currency: z.literal("USD"),
  pricingSource: ProviderUsagePricingSourceSchema,
  billingBasis: z.record(z.string(), z.unknown()),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  occurredAt: z.string().datetime()
});

// src/adapter.ts
import {
  createProjectHostClient
} from "@clash/shared-runtime/project-host-client";
function directorWorkspaceCwd(input) {
  const candidate = input.cwd?.trim() || process.env.CLASH_WORKSPACE_ROOT || process.env.CODEX_WORKSPACE_ROOT || process.cwd();
  return isAbsolute(candidate) ? candidate : resolve(candidate);
}
function projectionSegment(stageId) {
  return stageId.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+/, "") || "stage";
}
function requiredInputString(input, key) {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${String(key)} is required`);
  return value.trim();
}
function requiredInputRecord(input, key) {
  const value = input[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  return value;
}
function requiredRecordString(value, key, label) {
  const field2 = value[key];
  if (typeof field2 !== "string" || !field2.trim()) throw new Error(`${label} is required`);
  return field2.trim();
}
function requiredRecordNumber(value, key, label) {
  const field2 = value[key];
  if (typeof field2 !== "number" || !Number.isFinite(field2)) throw new Error(`${label} is required`);
  return field2;
}
function directorCommand(name, input) {
  switch (name) {
    case "clash_director_object_add":
      return { op: "object.add", object: requiredInputRecord(input, "object") };
    case "clash_director_object_update":
      return { op: "object.update", objectId: requiredInputString(input, "objectId"), patch: requiredInputRecord(input, "patch") };
    case "clash_director_object_remove":
      return { op: "object.remove", objectId: requiredInputString(input, "objectId") };
    case "clash_director_object_group":
      return { op: "object.group", groupId: requiredInputString(input, "groupId"), objectIds: input.objectIds ?? [] };
    case "clash_director_object_ungroup":
      return { op: "object.ungroup", groupId: requiredInputString(input, "groupId") };
    case "clash_director_camera_add":
      return { op: "camera.add", camera: requiredInputRecord(input, "camera") };
    case "clash_director_camera_update":
      return { op: "camera.update", cameraId: requiredInputString(input, "cameraId"), patch: requiredInputRecord(input, "patch") };
    case "clash_director_camera_remove":
      return { op: "camera.remove", cameraId: requiredInputString(input, "cameraId") };
    case "clash_director_scene_update":
      return { op: "scene.update", patch: requiredInputRecord(input, "scene") };
    case "clash_director_keyframe_upsert": {
      const keyframe = requiredInputRecord(input, "keyframe");
      return {
        op: "keyframe.upsert",
        durationSeconds: requiredRecordNumber(keyframe, "durationSeconds", "keyframe.durationSeconds"),
        fps: requiredRecordNumber(keyframe, "fps", "keyframe.fps"),
        track: {
          id: requiredRecordString(keyframe, "trackId", "keyframe.trackId"),
          targetId: requiredRecordString(keyframe, "targetId", "keyframe.targetId"),
          property: requiredRecordString(keyframe, "property", "keyframe.property")
        },
        keyframe: {
          id: requiredRecordString(keyframe, "id", "keyframe.id"),
          time: requiredRecordNumber(keyframe, "time", "keyframe.time"),
          value: keyframe.value,
          ...keyframe.interpolation !== void 0 ? { interpolation: keyframe.interpolation } : {}
        }
      };
    }
    case "clash_director_keyframe_remove": {
      const keyframe = requiredInputRecord(input, "keyframe");
      return {
        op: "keyframe.remove",
        trackId: requiredRecordString(keyframe, "trackId", "keyframe.trackId"),
        keyframeId: requiredRecordString(keyframe, "id", "keyframe.id")
      };
    }
    case "clash_director_action_upsert": {
      const action = requiredInputRecord(input, "action");
      const { timelineDurationSeconds: _duration, fps: _fps, ...clip } = action;
      return {
        op: "action.upsert",
        durationSeconds: requiredRecordNumber(action, "timelineDurationSeconds", "action.timelineDurationSeconds"),
        fps: requiredRecordNumber(action, "fps", "action.fps"),
        clip
      };
    }
    case "clash_director_action_remove":
      return { op: "action.remove", clipId: requiredInputString(input, "actionId") };
    default:
      throw new Error(`Director operation ${name} is not a state mutation`);
  }
}
function hostValue(value) {
  if (!value.error) return value;
  const code = typeof value.code === "string" ? `${value.code}: ` : "";
  throw new Error(`${code}${value.error}`);
}
async function writeDirectorProjection(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
function captureOutputDirectory(input, stageId) {
  const cwd = directorWorkspaceCwd(input);
  const output = input.outputDir?.trim() ? resolve(cwd, input.outputDir) : join(cwd, "director-stages", projectionSegment(stageId), "captures");
  const path = relative(cwd, output);
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error("Director capture output directory must stay inside the project cwd");
  }
  return output;
}
function createDirectorAdapter(options = {}) {
  const client = options.client ?? createProjectHostClient();
  const writeProjection = options.writeProjection ?? writeDirectorProjection;
  const observations = /* @__PURE__ */ new Map();
  const key = (projectId, stageId) => `${projectId}\0${stageId}`;
  const context = (input) => client.resolveContext({ cwd: input.cwd, projectId: input.projectId });
  const request = async (input, command2) => {
    const result = await client.request({ cwd: input.cwd, projectId: input.projectId, command: command2 });
    return { projectId: result.projectId, value: hostValue(result.value) };
  };
  const requireObservation = async (input, stageId) => {
    const resolved = await context(input);
    const observation = observations.get(key(resolved.projectId, stageId));
    if (!observation) {
      throw new Error(`READ_REQUIRED: Read Director Stage ${stageId} with clash_director_get before mutating it.`);
    }
    return observation;
  };
  const list = async (input) => {
    const result = await request(input, { action: "list_director_stages" });
    const stages = Array.isArray(result.value.stages) ? result.value.stages.filter((entry) => Boolean(
      entry && typeof entry === "object" && typeof entry.id === "string"
    )) : [];
    const versions = result.value.versions && typeof result.value.versions === "object" ? result.value.versions : {};
    for (const stage of stages) {
      const receipt = versions[stage.id];
      if (typeof receipt === "string") {
        observations.set(key(result.projectId, stage.id), {
          receipt,
          ...stage.revisionId ? { revisionId: stage.revisionId } : {}
        });
      }
    }
    return stages;
  };
  const get = async (input) => {
    const stageId = requiredInputString(input, "stageId");
    const stage = (await list(input)).find((candidate) => candidate.id === stageId);
    if (!stage) throw new Error(`Director Stage ${stageId} not found`);
    return stage;
  };
  const save = async (input) => {
    const stageId = requiredInputString(input, "stageId");
    const baseRevisionId = requiredInputString(input, "baseRevisionId");
    const parsed = DirectorStageStateSchema.safeParse(input.state);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid Director Stage state");
    const observed2 = await requireObservation(input, stageId);
    if (observed2.revisionId && observed2.revisionId !== baseRevisionId) {
      throw new Error(`STALE_READ: Director Stage ${stageId} was read at ${observed2.revisionId}, not ${baseRevisionId}`);
    }
    const filePath = join(
      directorWorkspaceCwd(input),
      "director-stages",
      `${projectionSegment(stageId)}.director-stage.json`
    );
    await writeProjection(filePath, `${JSON.stringify(parsed.data, null, 2)}
`);
    const result = await request(input, {
      action: "update_director_stage_state",
      stageId,
      state: parsed.data,
      actorClientType: "mcp",
      observedVersion: observed2.receipt,
      ifMatch: observed2.receipt
    });
    const receipt = typeof result.value.readToken === "string" ? result.value.readToken : typeof result.value.version === "string" ? result.value.version : void 0;
    const nextStage = result.value.stage && typeof result.value.stage === "object" ? result.value.stage : void 0;
    if (receipt) observations.set(key(result.projectId, stageId), {
      receipt,
      ...typeof nextStage?.revisionId === "string" ? { revisionId: nextStage.revisionId } : {}
    });
    return result.value;
  };
  return {
    list,
    get,
    async create(input) {
      return (await request(input, {
        action: "create_director_stage",
        stageId: requiredInputString(input, "stageId"),
        name: requiredInputString(input, "name")
      })).value;
    },
    save,
    async attach(input) {
      const stageId = requiredInputString(input, "stageId");
      const observed2 = await requireObservation(input, stageId);
      return (await request(input, {
        action: "attach_director_stage",
        stageId,
        canvasId: requiredInputString(input, "canvasId"),
        ...input.nodeId?.trim() ? { actionNodeId: input.nodeId.trim() } : {},
        actorClientType: "mcp",
        observedVersion: observed2.receipt,
        ifMatch: observed2.receipt
      })).value;
    },
    async detach(input) {
      const stageId = requiredInputString(input, "stageId");
      const observed2 = await requireObservation(input, stageId);
      return (await request(input, {
        action: "detach_director_stage",
        stageId,
        actorClientType: "mcp",
        observedVersion: observed2.receipt,
        ifMatch: observed2.receipt
      })).value;
    },
    async mutate(name, input) {
      const stage = await get(input);
      if (!stage.revisionId) throw new Error(`Director Stage ${stage.id} did not expose a revisionId`);
      const applied = applyDirectorStageCommand(stage.state, directorCommand(name, input));
      if (!applied.ok) throw new Error(applied.error);
      return save({ ...input, baseRevisionId: stage.revisionId, state: applied.state });
    },
    async capture(input) {
      const stageId = requiredInputString(input, "stageId");
      if (!Array.isArray(input.times) || input.times.length === 0) throw new Error("times is required");
      const labels = input.labels?.length ? input.labels : input.times.map((_, index) => `frame-${String(index + 1).padStart(3, "0")}`);
      if (labels.length !== input.times.length) throw new Error("labels count must match times");
      const observed2 = await requireObservation(input, stageId);
      const frames = input.times.map((timeSeconds, index) => ({
        label: labels[index],
        timeSeconds,
        aspectRatio: input.aspectRatio ?? "16:9"
      }));
      const result = await request(input, {
        action: "capture_director_stage",
        stageId,
        frames,
        longEdge: input.longEdge ?? 1920,
        actorClientType: "mcp",
        observedVersion: observed2.receipt,
        ifMatch: observed2.receipt
      });
      const outputDir = captureOutputDirectory(input, stageId);
      const capturedFrames = Array.isArray(result.value.frames) ? result.value.frames : [];
      const persistedFrames = [];
      for (const raw of capturedFrames) {
        if (!raw || typeof raw !== "object") continue;
        const frame = raw;
        if (typeof frame.label !== "string" || typeof frame.dataBase64 !== "string") continue;
        const path = join(outputDir, `${projectionSegment(frame.label)}.png`);
        await writeProjection(path, Buffer.from(frame.dataBase64, "base64"));
        const { dataBase64: _data, ...publicFrame } = frame;
        persistedFrames.push({ ...publicFrame, path });
      }
      const receiptPath = join(outputDir, "capture.json");
      const receipt = { ...result.value, frames: persistedFrames, receiptPath };
      await writeProjection(receiptPath, `${JSON.stringify(receipt, null, 2)}
`);
      return receipt;
    }
  };
}
export {
  createDirectorAdapter,
  directorWorkspaceCwd
};
