/* Мини-тест: воспроизводит отрисовку карточки и ищет текстовые узлы «null». */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const moduleUrl = (rel) => pathToFileURL(path.join(ROOT, 'web', 'scripts', rel)).href;

const NODE = { ELEMENT_NODE: 1, TEXT_NODE: 3 };

class FakeNode {
  constructor() {
    this.childNodes = [];
    this.nodeType = 0;
    this._text = '';
  }
  get textContent() {
    return this._text + this.childNodes.map((c) => c.textContent ?? '').join('');
  }
  set textContent(value) {
    this.childNodes = [];
    this._text = String(value);
  }
  append(...kids) {
    for (const kid of kids) {
      if (kid === null || kid === undefined) {
        this.childNodes.push({ nodeType: NODE.TEXT_NODE, textContent: String(kid), literalNull: true });
        continue;
      }
      this.childNodes.push(kid);
    }
  }
  replaceChildren(...kids) { this.childNodes = []; this._text = ''; this.append(...kids); }
  get classList() { return { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  setAttribute() {}
  addEventListener() {}
  get style() { return {}; }
  get dataset() { return {}; }
}
class FakeElement extends FakeNode {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.nodeType = NODE.ELEMENT_NODE; this.attributes = {}; }
}

const registry = new Map();
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  createTextNode: (text) => ({ nodeType: NODE.TEXT_NODE, textContent: String(text) }),
  querySelector: () => null,
  querySelectorAll: () => [],
};
globalThis.window = { innerWidth: 1200 };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(ROOT, 'data', 'materials.json'), 'utf8')) });

const { renderDetail } = await import(moduleUrl('detail.js'));
const store = await import(moduleUrl('store.js'));
await store.init();

/* рендерим каждый раздел каталога в фейковый DOM и ищем текстовые узлы «null» */
const seen = new Set();
let problems = 0;
for (const item of store.state.materials) {
  const host = new FakeNode();
  host.hidden = true;
  renderDetail(host, item, {});

  const walk = (node) => {
    for (let i = 0; i < node.childNodes.length; i += 1) {
      const child = node.childNodes[i];
      if (child.literalNull) {
        problems += 1;
        const parent = node.tagName ? node.tagName.toLowerCase() : 'root';
        const where = `${parent}#${i}`;
        if (!seen.has(where)) {
          seen.add(where);
          const prev = node.childNodes[i - 1];
          const next = node.childNodes[i + 1];
          const label = (n) => (!n ? '—' : n.tagName ? `<${n.tagName.toLowerCase()}>` : JSON.stringify(String(n.textContent).slice(0, 40)));
          console.log(`  литерал null: родитель ${where}, предыдущий ${label(prev)}, следующий ${label(next)}  [${item.id}]`);
        }
      } else if (child.childNodes) {
        walk(child);
      }
    }
  };
  walk(host);
}

console.log(`проверено позиций: ${store.state.materials.length}`);
console.log(problems ? `\nнайдено литералов null: ${problems}` : '\nлитералов null не найдено');
process.exit(problems ? 1 : 0);
