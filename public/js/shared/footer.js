/**
 * Shared footer component.
 * Appends a footer with copyright, git commit, and server startup time.
 */

export async function initFooter() {
  let gitCommit = '?';
  let startupTime = '?';
  try {
    const resp = await fetch('/api/info');
    const info = await resp.json();
    gitCommit = info.gitCommit;
    startupTime = new Date(info.startupTime).toLocaleString();
  } catch (e) { /* offline or error */ }

  const footer = document.createElement('footer');
  footer.style.cssText = 'position:fixed;bottom:0;left:0;right:0;padding:6px 16px;background:rgba(0,0,0,0.3);display:flex;justify-content:space-between;align-items:center;font-size:0.7rem;color:#666;z-index:50;';
  footer.innerHTML = `
    <span>InfTec &mdash; martin.meyer@inftec.ch</span>
    <span>commit ${gitCommit} &middot; started ${startupTime}</span>
  `;
  document.body.appendChild(footer);
}
