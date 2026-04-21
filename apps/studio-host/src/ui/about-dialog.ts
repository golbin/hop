import { AboutDialog as UpstreamAboutDialog } from '@upstream/ui/about-dialog';

export class AboutDialog extends UpstreamAboutDialog {
  protected override createBody(): HTMLElement {
    const body = super.createBody();
    const version = body.querySelector('.about-version');

    const hopVersion = document.createElement('div');
    hopVersion.className = 'about-hop-version';
    hopVersion.textContent = `HOP ${__HOP_VERSION__}`;

    if (version?.parentNode) {
      version.parentNode.insertBefore(hopVersion, version.nextSibling);
    } else {
      body.appendChild(hopVersion);
    }

    return body;
  }
}
