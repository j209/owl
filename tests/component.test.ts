import { Component, WEnv } from "../src/component";
import {
  makeDeferred,
  makeTestFixture,
  makeTestWEnv,
  nextMicroTick,
  nextTick,
  normalize
} from "../demo/static/tests/helpers";

//------------------------------------------------------------------------------
// Setup and helpers
//------------------------------------------------------------------------------

// We create before each test:
// - fixture: a div, appended to the DOM, intended to be the target of dom
//   manipulations.  Note that it is removed after each test.
// - env: a WEnv, necessary to create new widgets

let fixture: HTMLElement;
let env: WEnv;

beforeEach(() => {
  fixture = makeTestFixture();
  env = makeTestWEnv();
  env.qweb.addTemplate(
    "counter",
    `<div><t t-esc="state.counter"/><button t-on-click="inc">Inc</button></div>`
  );
  env.qweb.addTemplate("widgetA", `<div>Hello<t t-widget="b"/></div>`);
  env.qweb.addTemplate("widgetB", `<div>world</div>`);
  env.qweb.addTemplate("default", "<div/>");
});

afterEach(() => {
  fixture.remove();
});

class Widget extends Component<WEnv, {}, {}> {}

function children(w: Widget): Widget[] {
  const childrenMap = w.__widget__.children;
  return Object.keys(childrenMap).map(id => childrenMap[id]);
}

// Test widgets
class Counter extends Widget {
  // class Counter extends Widget<WEnv, {}, {counter: number}> {
  template = "counter";
  state = {
    counter: 0
  };

  inc() {
    this.updateState({ counter: this.state.counter + 1 });
  }
}

class WidgetA extends Widget {
  template = "widgetA";
  widgets = { b: WidgetB };
}

class WidgetB extends Widget {
  template = "widgetB";
}

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe("basic widget properties", () => {
  test("has no el after creation", async () => {
    const widget = new Widget(env);
    expect(widget.el).toBe(null);
  });

  test("can be mounted", async () => {
    const widget = new Widget(env);
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div></div>");
  });

  test("can be clicked on and updated", async () => {
    const counter = new Counter(env);
    const target = document.createElement("div");
    await counter.mount(target);
    expect(target.innerHTML).toBe("<div>0<button>Inc</button></div>");
    const button = (<HTMLElement>counter.el).getElementsByTagName("button")[0];
    await button.click();
    await nextMicroTick();
    expect(target.innerHTML).toBe("<div>1<button>Inc</button></div>");
  });

  test("widget style and classname", async () => {
    class StyledWidget extends Widget {
      inlineTemplate = `<div style="font-weight:bold;" class="some-class">world</div>`;
    }
    const widget = new StyledWidget(env);
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe(
      `<div style="font-weight:bold;" class="some-class">world</div>`
    );
  });

  test("updateState before first render does not trigger a render", async () => {
    let renderCalls = 0;
    class TestW extends Widget {
      async willStart() {
        this.updateState({});
      }
      async _render() {
        renderCalls++;
        return super._render();
      }
    }
    const widget = new TestW(env);
    await widget.mount(fixture);
    expect(renderCalls).toBe(1);
  });

  test("updateState does not allow adding extra keys", async () => {
    const widget = new Widget(env);
    try {
      await widget.updateState({ extra: 1 });
    } catch (e) {
      expect(e.message).toMatch("Invalid key:");
    }
  });

  test("keeps a reference to env", async () => {
    const widget = new Widget(env);
    expect(widget.env).toBe(env);
  });

  test("do not remove previously rendered dom if not necessary", async () => {
    const widget = new Widget(env);
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe(`<div></div>`);
    widget.el!.appendChild(document.createElement("span"));
    expect(fixture.innerHTML).toBe(`<div><span></span></div>`);
    widget.render();
    expect(fixture.innerHTML).toBe(`<div><span></span></div>`);
  });
});

describe("lifecycle hooks", () => {
  test("willStart hook is called", async () => {
    let willstart = false;
    class HookWidget extends Widget {
      async willStart() {
        willstart = true;
      }
    }
    const widget = new HookWidget(env);
    await widget.mount(fixture);
    expect(willstart).toBe(true);
  });

  test("mounted hook is not called if not in DOM", async () => {
    let mounted = false;
    class HookWidget extends Widget {
      async mounted() {
        mounted = true;
      }
    }
    const widget = new HookWidget(env);
    const target = document.createElement("div");
    await widget.mount(target);
    expect(mounted).toBe(false);
  });

  test("mounted hook is called if mounted in DOM", async () => {
    let mounted = false;
    class HookWidget extends Widget {
      async mounted() {
        mounted = true;
      }
    }
    const widget = new HookWidget(env);
    await widget.mount(fixture);
    expect(mounted).toBe(true);
  });

  test("willStart hook is called on subwidget", async () => {
    let ok = false;
    class ParentWidget extends Widget {
      inlineTemplate = `<div><t t-widget="child"/></div>`;
      widgets = { child: ChildWidget };
    }
    class ChildWidget extends Widget {
      async willStart() {
        ok = true;
      }
    }
    const widget = new ParentWidget(env);
    await widget.mount(fixture);
    expect(ok).toBe(true);
  });

  test("mounted hook is called on subwidgets, in proper order", async () => {
    expect.assertions(4);
    let parentMounted = false;
    let childMounted = false;
    class ParentWidget extends Widget {
      inlineTemplate = `<div><t t-widget="child"/></div>`;
      widgets = { child: ChildWidget };
      mounted() {
        expect(childMounted).toBe(false);
        parentMounted = true;
      }
    }
    class ChildWidget extends Widget {
      mounted() {
        expect(document.body.contains(this.el)).toBe(true);
        expect(parentMounted).toBe(true);
        childMounted = true;
      }
    }
    const widget = new ParentWidget(env);
    await widget.mount(fixture);
    expect(childMounted).toBe(true);
  });

  test("willStart, mounted on subwidget rendered after main is mounted in some other position", async () => {
    expect.assertions(3);
    let hookCounter = 0;
    // the t-else part in the template is important. This is
    // necessary to have a situation that could confuse the vdom
    // patching algorithm
    class ParentWidget extends Widget {
      inlineTemplate = `
          <div>
            <t t-if="state.ok">
              <t t-widget="child"/>
            </t>
            <t t-else="1">
              <div/>
            </t>
          </div>`;
      state = { ok: false };
      widgets = { child: ChildWidget };
    }
    class ChildWidget extends Widget {
      async willStart() {
        hookCounter++;
      }
      mounted() {
        expect(hookCounter).toBe(1);
        hookCounter++;
      }
    }
    const widget = new ParentWidget(env);
    await widget.mount(fixture);
    expect(hookCounter).toBe(0); // sub widget not created yet
    await widget.updateState({ ok: true });
    expect(hookCounter).toBe(2);
  });

  test("mounted hook is correctly called on subwidgets created in mounted hook", async done => {
    // the issue here is that the parent widget creates in the
    // mounted hook a new widget, which means that it modifies
    // in place its list of children. But this list of children is currently
    // being visited, so the mount action of the parent could cause a mount
    // action of the new child widget, even though it is not ready yet.
    expect.assertions(1);
    const target = document.createElement("div");
    document.body.appendChild(target);
    class ParentWidget extends Widget {
      mounted() {
        const child = new ChildWidget(this);
        child.mount(this.el!);
      }
    }
    class ChildWidget extends Widget {
      mounted() {
        expect(this.el).toBeTruthy();
        done();
      }
    }
    const widget = new ParentWidget(env);
    await widget.mount(target);
  });

  test("widgets are unmounted and destroyed if no longer in DOM", async () => {
    let steps: string[] = [];
    class ParentWidget extends Widget {
      state = { ok: true };
      inlineTemplate = `<div>
        <t t-if="state.ok"><t t-widget="child"/></t>
      </div>`;
      widgets = { child: ChildWidget };
    }

    class ChildWidget extends Widget {
      constructor(parent) {
        super(parent);
        steps.push("init");
      }
      async willStart() {
        steps.push("willstart");
      }
      mounted() {
        steps.push("mounted");
      }
      willUnmount() {
        steps.push("willunmount");
      }
      destroyed() {
        steps.push("destroyed");
      }
    }
    const widget = new ParentWidget(env);
    await widget.mount(fixture);
    expect(steps).toEqual(["init", "willstart", "mounted"]);
    await widget.updateState({ ok: false });
    expect(steps).toEqual([
      "init",
      "willstart",
      "mounted",
      "willunmount",
      "destroyed"
    ]);
  });

  test("hooks are called in proper order in widget creation/destruction", async () => {
    let steps: string[] = [];
    class ParentWidget extends Widget {
      inlineTemplate = `<div><t t-widget="child"/></div>`;
      widgets = { child: ChildWidget };
      constructor(parent) {
        super(parent);
        steps.push("p init");
      }
      async willStart() {
        steps.push("p willstart");
      }
      mounted() {
        steps.push("p mounted");
      }
      willUnmount() {
        steps.push("p willunmount");
      }
      destroyed() {
        steps.push("p destroyed");
      }
    }

    class ChildWidget extends Widget {
      constructor(parent) {
        super(parent);
        steps.push("c init");
      }
      async willStart() {
        steps.push("c willstart");
      }
      mounted() {
        steps.push("c mounted");
      }
      willUnmount() {
        steps.push("c willunmount");
      }
      destroyed() {
        steps.push("c destroyed");
      }
    }
    const widget = new ParentWidget(env);
    await widget.mount(fixture);
    widget.destroy();
    expect(steps).toEqual([
      "p init",
      "p willstart",
      "c init",
      "c willstart",
      "p mounted",
      "c mounted",
      "c willunmount",
      "c destroyed",
      "p willunmount",
      "p destroyed"
    ]);
  });

  test("shouldUpdate hook prevent rerendering", async () => {
    let shouldUpdate = false;
    class TestWidget extends Widget {
      inlineTemplate = `<div><t t-esc="props.val"/></div>`;
      shouldUpdate() {
        return shouldUpdate;
      }
    }
    const widget = new TestWidget(env, { val: 42 });
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>42</div>");
    await widget.updateProps({ val: 123 });
    expect(fixture.innerHTML).toBe("<div>42</div>");
    shouldUpdate = true;
    await widget.updateProps({ val: 666 });
    expect(fixture.innerHTML).toBe("<div>666</div>");
  });
});

describe("destroy method", () => {
  test("destroy remove the widget from the DOM", async () => {
    const widget = new Widget(env);
    await widget.mount(fixture);
    expect(document.contains(widget.el)).toBe(true);
    widget.destroy();
    expect(document.contains(widget.el)).toBe(false);
    expect(widget.__widget__.isMounted).toBe(false);
    expect(widget.__widget__.isDestroyed).toBe(true);
  });

  test("destroying a widget twice only call destroyed once", async () => {
    let count = 0;
    class TestWidget extends Widget {
      destroyed() {
        count++;
      }
    }
    const widget = new TestWidget(env);
    await widget.mount(fixture);
    widget.destroy();
    expect(count).toBe(1);
    widget.destroy();
    expect(count).toBe(1);
  });

  test("destroying a parent also destroys its children", async () => {
    const parent = new WidgetA(env);
    await parent.mount(fixture);

    const child = children(parent)[0];

    expect(child.__widget__.isDestroyed).toBe(false);
    parent.destroy();
    expect(child.__widget__.isDestroyed).toBe(true);
  });

  test("destroy remove the parent/children link", async () => {
    const parent = new WidgetA(env);
    await parent.mount(fixture);

    const child = children(parent)[0];
    expect(child.__widget__.parent).toBe(parent);
    expect(children(parent).length).toBe(1);
    child.destroy();
    expect(child.__widget__.parent).toBe(null);
    expect(children(parent).length).toBe(0);
  });

  test("destroying a widget before willStart is done", async () => {
    let def = makeDeferred();
    let isRendered = false;
    class DelayedWidget extends Widget {
      willStart() {
        return def;
      }
    }
    expect(fixture.innerHTML).toBe("");
    const widget = new DelayedWidget(env);
    widget.mount(fixture);
    expect(widget.__widget__.isStarted).toBe(false);
    expect(widget.__widget__.isMounted).toBe(false);
    expect(widget.__widget__.isDestroyed).toBe(false);
    widget.destroy();
    expect(widget.__widget__.isMounted).toBe(false);
    expect(widget.__widget__.isStarted).toBe(false);
    expect(widget.__widget__.isDestroyed).toBe(true);
    def.resolve();
    await nextTick();

    expect(widget.__widget__.isStarted).toBe(false);
    expect(widget.__widget__.isMounted).toBe(false);
    expect(widget.__widget__.isDestroyed).toBe(true);
    expect(widget.__widget__.vnode).toBe(null);
    expect(fixture.innerHTML).toBe("");
    expect(isRendered).toBe(false);
  });
});

describe("composition", () => {
  test("a widget with a sub widget", async () => {
    const widget = new WidgetA(env);
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>Hello<div>world</div></div>");
    expect(children(widget)[0].__widget__.parent).toBe(widget);
  });

  test("t-refs on widget are widgets", async () => {
    class WidgetC extends Widget {
      inlineTemplate = `<div>Hello<t t-ref="mywidgetb" t-widget="b"/></div>`;
      widgets = { b: WidgetB };
    }
    const widget = new WidgetC(env);
    await widget.mount(fixture);
    expect(widget.refs.mywidgetb instanceof WidgetB).toBe(true);
  });

  test("modifying a sub widget", async () => {
    class ParentWidget extends Widget {
      inlineTemplate = `<div><t t-widget="Counter"/></div>`;
      widgets = { Counter };
    }
    const widget = new ParentWidget(env);
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe(
      "<div><div>0<button>Inc</button></div></div>"
    );
    const button = fixture.getElementsByTagName("button")[0];
    await button.click();
    await nextMicroTick();
    expect(fixture.innerHTML).toBe(
      "<div><div>1<button>Inc</button></div></div>"
    );
  });

  test("parent's elm for a children === children's elm, even after rerender", async () => {
    const widget = new WidgetA(env);
    await widget.mount(fixture);

    expect((<any>widget.__widget__.vnode!.children![1]).elm).toBe(
      (<any>children(widget)[0].__widget__.vnode).elm
    );
    await children(widget)[0].render();
    expect((<any>widget.__widget__.vnode!.children![1]).elm).toBe(
      (<any>children(widget)[0].__widget__.vnode).elm
    );
  });

  test("parent env is propagated to child widgets", async () => {
    const widget = new WidgetA(env);
    await widget.mount(fixture);

    expect(children(widget)[0].env).toBe(env);
  });

  test("rerendering a widget with a sub widget", async () => {
    class ParentWidget extends Widget {
      inlineTemplate = `<div><t t-widget="Counter"/></div>`;
      widgets = { Counter };
    }
    const widget = new ParentWidget(env);
    await widget.mount(fixture);
    const button = fixture.getElementsByTagName("button")[0];
    await button.click();
    await nextMicroTick();
    expect(fixture.innerHTML).toBe(
      "<div><div>1<button>Inc</button></div></div>"
    );
    await widget.render();
    expect(fixture.innerHTML).toBe(
      "<div><div>1<button>Inc</button></div></div>"
    );
  });

  test("sub widgets are destroyed if no longer in dom, then recreated", async () => {
    class ParentWidget extends Widget {
      state = { ok: true };
      inlineTemplate = `<div><t t-if="state.ok"><t t-widget="counter"/></t></div>`;
      widgets = { counter: Counter };
    }
    const widget = new ParentWidget(env);
    await widget.mount(fixture);
    const button = fixture.getElementsByTagName("button")[0];
    await button.click();
    await nextMicroTick();
    expect(fixture.innerHTML).toBe(
      "<div><div>1<button>Inc</button></div></div>"
    );
    await widget.updateState({ ok: false });
    expect(fixture.innerHTML).toBe("<div></div>");
    await widget.updateState({ ok: true });
    expect(fixture.innerHTML).toBe(
      "<div><div>0<button>Inc</button></div></div>"
    );
  });

  test("sub widgets with t-keep-alive are not destroyed if no longer in dom", async () => {
    class ParentWidget extends Widget {
      state = { ok: true };
      inlineTemplate = `<div><t t-if="state.ok"><t t-widget="counter" t-keep-alive="1"/></t></div>`;
      widgets = { counter: Counter };
    }
    const widget = new ParentWidget(env);
    await widget.mount(fixture);
    const button = fixture.getElementsByTagName("button")[0];
    await button.click();
    await nextMicroTick();
    expect(fixture.innerHTML).toBe(
      "<div><div>1<button>Inc</button></div></div>"
    );
    const counter = children(widget)[0];
    expect(counter.__widget__.isMounted).toBe(true);
    await widget.updateState({ ok: false });
    expect(fixture.innerHTML).toBe("<div></div>");
    expect(counter.__widget__.isMounted).toBe(false);
    await widget.updateState({ ok: true });
    expect(counter.__widget__.isMounted).toBe(true);
    expect(fixture.innerHTML).toBe(
      "<div><div>1<button>Inc</button></div></div>"
    );
  });

  test("sub widgets dom state with t-keep-alive is preserved", async () => {
    class ParentWidget extends Widget {
      state = { ok: true };
      inlineTemplate = `<div><t t-if="state.ok"><t t-widget="InputWidget" t-keep-alive="1"/></t></div>`;
      widgets = { InputWidget };
    }
    class InputWidget extends Widget {
      inlineTemplate = "<input/>";
    }
    const widget = new ParentWidget(env);
    await widget.mount(fixture);
    const input = fixture.getElementsByTagName("input")[0];
    input.value = "test";
    await widget.updateState({ ok: false });
    expect(fixture.innerHTML).toBe("<div></div>");
    await widget.updateState({ ok: true });
    expect(fixture.innerHTML).toBe("<div><input></div>");
    const input2 = fixture.getElementsByTagName("input")[0];
    expect(input).toBe(input2);
    expect(input2.value).toBe("test");
  });

  test("sub widgets rendered in a loop", async () => {
    class ChildWidget extends Widget {
      inlineTemplate = `<span><t t-esc="props.n"/></span>`;
    }

    class Parent extends Widget {
      inlineTemplate = `
        <div>
          <t t-foreach="state.numbers" t-as="number">
            <t t-widget="ChildWidget" t-props="{n: number}"/>
          </t>
        </div>`;
      state = {
        numbers: [1, 2, 3]
      };
      widgets = { ChildWidget };
    }
    const parent = new Parent(env);
    await parent.mount(fixture);
    expect(normalize(fixture.innerHTML)).toBe(
      normalize(`
      <div>
        <span>1</span>
        <span>2</span>
        <span>3</span>
      </div>
    `)
    );
  });

  test("sub widgets with some state rendered in a loop", async () => {
    let n = 1;
    class ChildWidget extends Widget {
      inlineTemplate = `<span><t t-esc="state.n"/></span>`;
      constructor(parent) {
        super(parent);
        this.state = { n };
        n++;
      }
    }

    env.qweb.addTemplate(
      "parent",
      `<div>
          <t t-foreach="state.numbers" t-as="number">
            <t t-widget="ChildWidget" t-att-key="number"/>
          </t>
        </div>`
    );
    class Parent extends Widget {
      template = "parent";
      state = {
        numbers: [1, 2, 3]
      };
      widgets = { ChildWidget };
    }
    const parent = new Parent(env);
    await parent.mount(fixture);
    await parent.updateState({ numbers: [1, 3] });
    expect(normalize(fixture.innerHTML)).toBe(
      normalize(`
      <div>
        <span>1</span>
        <span>3</span>
      </div>
    `)
    );
    expect(env.qweb.templates.parent.toString()).toMatchSnapshot();
  });

  test("sub widgets between t-ifs", async () => {
    // this confuses the patching algorithm...
    class ChildWidget extends Widget {
      inlineTemplate = `<span>child</span>`;
    }

    class Parent extends Widget {
      inlineTemplate = `<div>
            <h1 t-if="state.flag">hey</h1>
            <h2 t-else="1">noo</h2>
            <span><t t-widget="ChildWidget"/></span>
            <t t-if="state.flag"><span>test</span></t>
        </div>`;
      state = { flag: false };
      widgets = { ChildWidget };
    }
    const parent = new Parent(env);
    await parent.mount(fixture);
    const child = children(parent)[0];
    await parent.updateState({ flag: true });
    expect(children(parent)[0]).toBe(child);
    expect(child.__widget__.isDestroyed).toBe(false);
    expect(normalize(fixture.innerHTML)).toBe(
      normalize(`
      <div>
        <h1>hey</h1>
        <span><span>child</span></span>
        <span>test</span>
      </div>
    `)
    );
  });
});

describe("props evaluation (with t-props directive)", () => {
  test("explicit object prop", async () => {
    class Parent extends Widget {
      inlineTemplate = `<div><t t-widget="child" t-props="{value: state.val}"/></div>`;
      widgets = { child: Child };
      state = { val: 42 };
    }

    class Child extends Widget {
      inlineTemplate = `<span><t t-esc="state.someval"/></span>`;
      state: { someval: number };
      constructor(parent: Parent, props: { value: number }) {
        super(parent);
        this.state = { someval: props.value };
      }
    }

    const widget = new Parent(env);
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>42</span></div>");
  });

  test("object prop value", async () => {
    class Parent extends Widget {
      inlineTemplate = `<div><t t-widget="child" t-props="state"/></div>`;
      widgets = { child: Child };
      state = { val: 42 };
    }

    class Child extends Widget {
      inlineTemplate = `<span><t t-esc="state.someval"/></span>`;
      state: { someval: number };
      constructor(parent: Parent, props: { val: number }) {
        super(parent);
        this.state = { someval: props.val };
      }
    }

    const widget = new Parent(env);
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>42</span></div>");
  });
});

describe("other directives with t-widget", () => {
  test("t-on works as expected", async () => {
    let n = 0;
    class ParentWidget extends Widget {
      inlineTemplate = `<div><t t-widget="child" t-on-customevent="someMethod"/></div>`;
      widgets = { child: Child };
      someMethod(arg) {
        expect(arg).toBe(43);
        n++;
      }
    }
    class Child extends Widget {}
    const widget = new ParentWidget(env);
    await widget.mount(fixture);
    let child = children(widget)[0];
    expect(n).toBe(0);
    child.trigger("customevent", 43);
    expect(n).toBe(1);
    child.destroy();
    child.trigger("customevent", 43);
    expect(n).toBe(1);
  });

  test("t-if works with t-widget", async () => {
    class ParentWidget extends Widget {
      inlineTemplate = `<div><t t-widget="child" t-if="state.flag"/></div>`;
      widgets = { child: Child };
      state = { flag: true };
    }
    class Child extends Widget {
      inlineTemplate = "<span>hey</span>";
    }

    const widget = new ParentWidget(env);
    await widget.mount(fixture);

    expect(fixture.innerHTML).toBe("<div><span>hey</span></div>");

    await widget.updateState({ flag: false });
    expect(fixture.innerHTML).toBe("<div></div>");

    await widget.updateState({ flag: true });
    expect(fixture.innerHTML).toBe("<div><span>hey</span></div>");
  });

  test("t-else works with t-widget", async () => {
    class ParentWidget extends Widget {
      inlineTemplate = `
        <div>
          <div t-if="state.flag">somediv</div>
          <t t-else="1" t-widget="child"/>
        </div>`;
      widgets = { child: Child };
      state = { flag: true };
    }
    class Child extends Widget {
      inlineTemplate = "<span>hey</span>";
    }

    const widget = new ParentWidget(env);
    await widget.mount(fixture);

    expect(normalize(fixture.innerHTML)).toBe("<div><div>somediv</div></div>");

    await widget.updateState({ flag: false });
    expect(normalize(fixture.innerHTML)).toBe("<div><span>hey</span></div>");
  });
});

describe("random stuff/miscellaneous", () => {
  test("widget after a t-foreach", async () => {
    // this test makes sure that the foreach directive does not pollute sub
    // context with the inLoop variable, which is then used in the t-widget
    // directive as a key
    class Test extends Widget {
      inlineTemplate = `<div><t t-foreach="2">txt</t><t t-widget="widget"/></div>`;
      widgets = { widget: Widget };
    }
    const widget = new Test(env);
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div>txttxt<div></div></div>");
  });

  test("updating widget immediately", async () => {
    // in this situation, we protect against a bug that occurred: because of the
    // interplay between widgets and vnodes, a sub widget vnode was patched
    // twice.
    class Parent extends Widget {
      inlineTemplate = `<div><t t-widget="child" t-props="{flag:state.flag}"/></div>`;
      widgets = { child: Child };
      state = { flag: false };
    }

    class Child extends Widget {
      inlineTemplate = `<span>abc<t t-if="props.flag">def</t></span>`;
    }

    const widget = new Parent(env);
    await widget.mount(fixture);
    expect(fixture.innerHTML).toBe("<div><span>abc</span></div>");
    await widget.updateState({ flag: true });
    expect(fixture.innerHTML).toBe("<div><span>abcdef</span></div>");
  });

  test("snapshotting compiled code", async () => {
    env.qweb.addTemplate(
      "parent",
      `<div><t t-widget="child" t-key="somestring" t-props="{flag:state.flag}"/></div>`
    );
    class Parent extends Widget {
      inlineTemplate = "parent";
      widgets = { child: Child };
      state = { flag: false };
    }

    class Child extends Widget {
      inlineTemplate = `<span>abc<t t-if="props.flag">def</t></span>`;
    }

    const widget = new Parent(env);
    await widget.mount(fixture);
    expect(env.qweb.templates.parent.toString()).toMatchSnapshot();
  });
});

describe("async rendering", () => {
  test("destroying a widget before start is over", async () => {
    let def = makeDeferred();
    class W extends Widget {
      inlineTemplate = "invalid><";
      willStart(): Promise<void> {
        return def;
      }
    }
    const w = new W(env);
    w.mount(fixture);
    expect(w.__widget__.isDestroyed).toBe(false);
    expect(w.__widget__.isMounted).toBe(false);
    expect(w.__widget__.isStarted).toBe(false);
    w.destroy();
    def.resolve();
    await nextTick();
    expect(w.__widget__.isDestroyed).toBe(true);
    expect(w.__widget__.isMounted).toBe(false);
    expect(w.__widget__.isStarted).toBe(false);
  });

  test("destroying/recreating a subwidget with different props (if start is not over)", async () => {
    let def = makeDeferred();
    let n = 0;
    class W extends Widget {
      inlineTemplate = `<div><t t-if="state.val > 1"><t t-widget="Child" t-props="{val: state.val}"/></t></div>`;
      widgets = { Child };
      state = { val: 1 };
    }

    class Child extends Widget {
      inlineTemplate = `<span>child:<t t-esc="props.val"/></span>`;
      constructor(parent, props) {
        super(parent, props);
        n++;
      }
      willStart(): Promise<void> {
        return def;
      }
    }
    const w = new W(env);
    await w.mount(fixture);
    expect(n).toBe(0);
    w.updateState({ val: 2 });
    expect(n).toBe(1);
    await nextTick();
    w.updateState({ val: 3 });
    expect(n).toBe(2);
    def.resolve();
    await nextTick();
    expect(children(w).length).toBe(1);
    expect(fixture.innerHTML).toBe("<div><span>child:3</span></div>");
  });

  test("creating two async widgets, scenario 1", async () => {
    let defA = makeDeferred();
    let defB = makeDeferred();

    class ChildA extends Widget {
      inlineTemplate = "<span>a</span>";
      willStart(): Promise<void> {
        return defA;
      }
    }

    class ChildB extends Widget {
      inlineTemplate = "<span>b</span>";
      willStart(): Promise<void> {
        return defB;
      }
    }
    class Parent extends Widget {
      inlineTemplate = `
        <div>
          <t t-if="state.flagA"><t t-widget="ChildA"/></t>
          <t t-if="state.flagB"><t t-widget="ChildB"/></t>
        </div>`;
      widgets = { ChildA, ChildB };
      state = { flagA: false, flagB: false };
    }
    const parent = new Parent(env);
    await parent.mount(fixture);
    expect(fixture.innerHTML.replace(/\r?\n|\r|\s+/g, "")).toBe("<div></div>");
    parent.updateState({ flagA: true });
    await nextTick();
    expect(fixture.innerHTML.replace(/\r?\n|\r|\s+/g, "")).toBe("<div></div>");
    parent.updateState({ flagB: true });
    await nextTick();
    expect(fixture.innerHTML.replace(/\r?\n|\r|\s+/g, "")).toBe("<div></div>");
    defB.resolve();
    expect(fixture.innerHTML.replace(/\r?\n|\r|\s+/g, "")).toBe("<div></div>");
    defA.resolve();
    await nextTick();
    expect(fixture.innerHTML.replace(/\r?\n|\r|\s+/g, "")).toBe(
      "<div><span>a</span><span>b</span></div>"
    );
  });

  test("creating two async widgets, scenario 2", async () => {
    let defA = makeDeferred();
    let defB = makeDeferred();

    class ChildA extends Widget {
      inlineTemplate = `<span>a<t t-esc="props.val"/></span>`;
      updateProps(props): Promise<void> {
        return defA.then(() => super.updateProps(props));
      }
    }
    class ChildB extends Widget {
      inlineTemplate = `<span>b<t t-esc="props.val"/></span>`;
      willStart(): Promise<void> {
        return defB;
      }
    }

    class Parent extends Widget {
      inlineTemplate = `
        <div>
          <t t-widget="ChildA" t-props="{val:state.valA}"/>
          <t t-if="state.flagB"><t t-widget="ChildB" t-props="{val:state.valB}"/></t>
        </div>`;
      widgets = { ChildA, ChildB };
      state = { valA: 1, valB: 2, flagB: false };
    }
    const parent = new Parent(env);
    await parent.mount(fixture);
    expect(fixture.innerHTML.replace(/\r?\n|\r|\s+/g, "")).toBe(
      "<div><span>a1</span></div>"
    );
    parent.updateState({ valA: 2 });
    await nextTick();
    expect(fixture.innerHTML.replace(/\r?\n|\r|\s+/g, "")).toBe(
      "<div><span>a1</span></div>"
    );
    parent.updateState({ flagB: true });
    await nextTick();
    expect(fixture.innerHTML.replace(/\r?\n|\r|\s+/g, "")).toBe(
      "<div><span>a1</span></div>"
    );
    defB.resolve();
    expect(fixture.innerHTML.replace(/\r?\n|\r|\s+/g, "")).toBe(
      "<div><span>a1</span></div>"
    );
    defA.resolve();
    await nextTick();
    expect(fixture.innerHTML.replace(/\r?\n|\r|\s+/g, "")).toBe(
      "<div><span>a2</span><span>b2</span></div>"
    );
  });
});