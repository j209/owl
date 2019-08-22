import { Component } from "../component/component";
import { Destination, RouterEnv } from "./Router";

export const LINK_TEMPLATE_NAME = "__owl__-router-link";
export const LINK_TEMPLATE = `
    <a  t-att-class="{'router-link-active': isActive }"
        t-att-href="href"
        t-on-click="navigate">
        <t t-slot="default"/>
    </a>`;

type Props = Destination;

export class Link<Env extends RouterEnv> extends Component<Env, Props, {}> {
  template = LINK_TEMPLATE_NAME;
  href: string = this.env.router.destToPath(this.props);

  async willUpdateProps(nextProps) {
    this.href = this.env.router.destToPath(nextProps);
  }

  get isActive() {
    if (this.env.router.mode === "hash") {
      return (<any>document.location).hash === this.href;
    }
    return (<any>document.location).pathname === this.href;
  }

  navigate(ev) {
    // don't redirect with control keys
    if (ev.metaKey || ev.altKey || ev.ctrlKey || ev.shiftKey) {
      return;
    }
    // don't redirect on right click
    if (ev.button !== undefined && ev.button !== 0) {
      return;
    }
    // don't redirect if `target="_blank"`
    if (ev.currentTarget && ev.currentTarget.getAttribute) {
      const target = ev.currentTarget.getAttribute("target");
      if (/\b_blank\b/i.test(target)) {
        return;
      }
    }
    ev.preventDefault();
    this.env.router.navigate(this.props);
  }
}
